'use strict';
const path = require('node:path');
const express = require('express');
const M = require('./market');
const { tx } = require('./db');
const A = require('./auth');
const { validateState } = require('./validate');
const { writeLedger } = require('./ledger');
const S = require('./stats');

class HttpError extends Error {
  constructor(status, code, message, extra){ super(message); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (msg, extra) => new HttpError(400, 'bad_request', msg, extra);

function createApp(db, opts = {}){
  const app = express();
  const root = opts.staticRoot === undefined ? path.join(__dirname, '..', '..') : opts.staticRoot;
  const origins = (opts.corsOrigins || process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const loginLimit = A.rateLimiter({ windowMs: 15*60*1000, max: opts.loginMax || 20 });
  const ephemeral = !!opts.ephemeral;
  let statsCache = null;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // CORS for the API, so a copy of the site on GitHub Pages can talk to a deployed server.
  // Auth uses a bearer token, not cookies, so allowing other origins does not expose sessions.
  app.use('/api', (req, res, next) => {
    const o = req.get('Origin');
    if(o && (origins.includes('*') || origins.includes(o))){
      res.set('Access-Control-Allow-Origin', origins.includes('*') ? '*' : o);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if(req.method === 'OPTIONS') return res.sendStatus(204);
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  const auth = role => (req, res, next) => {
    const h = req.get('Authorization') || '';
    const user = A.userFromToken(db, h.startsWith('Bearer ') ? h.slice(7) : '');
    if(!user) return next(new HttpError(401, 'unauthorized', 'Log in to continue.'));
    if(role && user.role !== role) return next(new HttpError(403, 'forbidden', `Only ${role}s can do this.`));
    req.user = user; req.token = h.slice(7);
    next();
  };
  const str = (v, name, min, max) => {
    if(typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw bad(`${name} must be ${min}-${max} characters.`);
    return v.trim();
  };

  /* ---------- Public ---------- */
  app.get('/api/health', (req, res) => {
    const v = db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v;
    res.json({ ok: true, service: 'pehla-kadam', schema_version: v, ephemeral });
  });

  app.get('/api/market', (req, res) => {
    res.json({
      sim_days: M.PLAY, start_cash: M.START_CASH, haircut_pct: M.HAIRCUT,
      instruments: db.prepare('SELECT symbol, isin, name_en, name_hi FROM instruments ORDER BY symbol').all(),
      brokers: db.prepare('SELECT id, dp_id, name FROM brokers ORDER BY id').all(),
      corporate_actions: db.prepare('SELECT id, symbol, kind, record_day, amount, ratio FROM corporate_actions ORDER BY record_day').all()
    });
  });

  app.get('/api/stats', (req, res) => {
    if(!statsCache || Date.now() - statsCache.at > 30000) statsCache = { at: Date.now(), body: { ...S.publicStats(db), ephemeral } };
    res.json(statsCache.body);
  });

  /* ---------- Accounts ---------- */
  app.post('/api/learners/register', loginLimit, (req, res) => {
    const name = str(req.body.name, 'Name', 1, 80);
    const mobile = String(req.body.mobile || '');
    const pin = String(req.body.pin || '');
    if(!/^[6-9]\d{9}$/.test(mobile)) throw bad('Mobile must be 10 digits starting with 6, 7, 8 or 9.');
    if(!/^\d{4,6}$/.test(pin)) throw bad('PIN must be 4 to 6 digits.');
    if(db.prepare('SELECT 1 FROM users WHERE login = ?').get(mobile)) throw new HttpError(409, 'exists', 'This mobile number already has an account. Log in instead.');
    const out = tx(db, () => {
      const id = db.prepare("INSERT INTO users (role, name, login, secret_hash) VALUES ('learner', ?, ?, ?)").run(name, mobile, A.hashSecret(pin)).lastInsertRowid;
      return { ...A.createSession(db, id), user: { id: Number(id), role: 'learner', name } };
    });
    res.status(201).json(out);
  });

  app.post('/api/mentors/register', loginLimit, (req, res) => {
    const name = str(req.body.name, 'Name', 1, 80);
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw bad('Enter a valid email address.');
    if(password.length < 8 || password.length > 200) throw bad('Password must be at least 8 characters.');
    if(db.prepare('SELECT 1 FROM users WHERE login = ?').get(email)) throw new HttpError(409, 'exists', 'This email already has an account. Log in instead.');
    const out = tx(db, () => {
      const id = db.prepare("INSERT INTO users (role, name, login, secret_hash) VALUES ('mentor', ?, ?, ?)").run(name, email, A.hashSecret(password)).lastInsertRowid;
      return { ...A.createSession(db, id), user: { id: Number(id), role: 'mentor', name } };
    });
    res.status(201).json(out);
  });

  const login = role => (req, res) => {
    const id = role === 'learner' ? String(req.body.mobile || '') : String(req.body.email || '').trim().toLowerCase();
    const secret = String(role === 'learner' ? req.body.pin || '' : req.body.password || '');
    const u = db.prepare('SELECT id, role, name, secret_hash FROM users WHERE login = ? AND role = ?').get(id, role);
    const ok = A.verifySecret(secret, u ? u.secret_hash : A.DUMMY) && !!u;
    if(!ok) throw new HttpError(401, 'bad_credentials', role === 'learner' ? 'Mobile number or PIN is wrong.' : 'Email or password is wrong.');
    res.json({ ...A.createSession(db, u.id), user: { id: u.id, role: u.role, name: u.name } });
  };
  app.post('/api/learners/login', loginLimit, login('learner'));
  app.post('/api/mentors/login', loginLimit, login('mentor'));

  app.post('/api/logout', auth(), (req, res) => { A.deleteSession(db, req.token); res.status(204).end(); });

  app.get('/api/me', auth(), (req, res) => {
    const u = req.user;
    if(u.role === 'learner'){
      const cohort = db.prepare(`SELECT c.id, c.name, m.name AS mentor FROM cohort_members cm JOIN cohorts c ON c.id = cm.cohort_id
        JOIN users m ON m.id = c.mentor_id WHERE cm.user_id = ?`).get(u.id) || null;
      const snap = db.prepare('SELECT rev, updated_at FROM snapshots WHERE user_id = ?').get(u.id) || null;
      return res.json({ user: u, cohort, snapshot: snap });
    }
    res.json({ user: u, cohorts: cohortList(u.id) });
  });

  /* ---------- Learner sync ---------- */
  app.get('/api/me/state', auth('learner'), (req, res) => {
    const r = db.prepare('SELECT rev, state_json, updated_at FROM snapshots WHERE user_id = ?').get(req.user.id);
    if(!r) throw new HttpError(404, 'no_snapshot', 'Nothing has been backed up yet.');
    res.json({ rev: r.rev, updated_at: r.updated_at, state: JSON.parse(r.state_json) });
  });

  app.put('/api/me/state', auth('learner'), (req, res) => {
    const { rev, state } = req.body || {};
    if(!Number.isInteger(rev) || rev < 0) throw bad('rev must be a non-negative integer.');
    const check = validateState(state);
    if(!check.ok) throw new HttpError(422, 'invalid_state', 'The progress could not be saved because it does not add up.', { errors: check.errors });
    const out = tx(db, () => {
      const cur = db.prepare('SELECT rev, state_json, updated_at FROM snapshots WHERE user_id = ?').get(req.user.id);
      const curRev = cur ? cur.rev : 0;
      if(rev !== curRev) throw new HttpError(409, 'conflict', 'Newer progress was saved from another device.',
        { rev: curRev, updated_at: cur && cur.updated_at, state: cur ? JSON.parse(cur.state_json) : null });
      const next = curRev + 1;
      db.prepare(`INSERT INTO snapshots (user_id, rev, state_json, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        ON CONFLICT(user_id) DO UPDATE SET rev = excluded.rev, state_json = excluded.state_json, updated_at = excluded.updated_at`)
        .run(req.user.id, next, JSON.stringify(state));
      writeLedger(db, req.user.id, state, check.derived);
      return { rev: next, net_worth: check.derived ? check.derived.netWorth : null };
    });
    statsCache = null;
    res.json(out);
  });

  app.get('/api/me/ledger', auth('learner'), (req, res) => {
    const l = S.learnerLedger(db, req.user.id);
    if(!l) throw new HttpError(404, 'no_account', 'No demat account has been synced yet.');
    res.json(l);
  });

  app.post('/api/me/cohort', auth('learner'), (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const c = db.prepare(`SELECT c.id, c.name, m.name AS mentor FROM cohorts c JOIN users m ON m.id = c.mentor_id WHERE c.join_code = ?`).get(code);
    if(!c) throw new HttpError(404, 'no_cohort', 'No group has this code. Check it with your facilitator.');
    tx(db, () => {
      db.prepare('DELETE FROM cohort_members WHERE user_id = ?').run(req.user.id);
      db.prepare('INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)').run(c.id, req.user.id);
    });
    res.json({ cohort: c });
  });

  app.delete('/api/me/cohort', auth('learner'), (req, res) => {
    db.prepare('DELETE FROM cohort_members WHERE user_id = ?').run(req.user.id);
    res.status(204).end();
  });

  /* ---------- Mentors ---------- */
  function cohortList(mentorId){
    return db.prepare(`SELECT c.id, c.name, c.join_code, c.created_at, count(cm.user_id) AS members FROM cohorts c
      LEFT JOIN cohort_members cm ON cm.cohort_id = c.id WHERE c.mentor_id = ? GROUP BY c.id ORDER BY c.created_at, c.id`).all(mentorId);
  }
  app.get('/api/cohorts', auth('mentor'), (req, res) => res.json({ cohorts: cohortList(req.user.id) }));

  app.post('/api/cohorts', auth('mentor'), (req, res) => {
    const name = str(req.body.name, 'Group name', 1, 80);
    let code;
    do code = A.joinCode(); while(db.prepare('SELECT 1 FROM cohorts WHERE join_code = ?').get(code));
    const id = db.prepare('INSERT INTO cohorts (mentor_id, name, join_code) VALUES (?, ?, ?)').run(req.user.id, name, code).lastInsertRowid;
    res.status(201).json({ cohort: { id: Number(id), name, join_code: code, members: 0 } });
  });

  app.get('/api/cohorts/:id', auth('mentor'), (req, res) => {
    const c = db.prepare('SELECT id, name, join_code, created_at FROM cohorts WHERE id = ? AND mentor_id = ?').get(Number(req.params.id), req.user.id);
    if(!c) throw new HttpError(404, 'no_cohort', 'Group not found.');
    res.json({ cohort: c, ...S.cohortReport(db, c.id) });
  });

  app.delete('/api/cohorts/:id', auth('mentor'), (req, res) => {
    const r = db.prepare('DELETE FROM cohorts WHERE id = ? AND mentor_id = ?').run(Number(req.params.id), req.user.id);
    if(!r.changes) throw new HttpError(404, 'no_cohort', 'Group not found.');
    res.status(204).end();
  });

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'No such API route.')));

  /* ---------- Website ---------- */
  if(root){
    app.use((req, res, next) => /^\/(server|node_modules)(\/|$)/.test(req.path) ? res.status(404).end() : next());
    app.use(express.static(root, { dotfiles: 'ignore', extensions: ['html'] }));
  }

  // Errors: JSON for the API, plain status elsewhere
  app.use((e, req, res, next) => { // eslint-disable-line no-unused-vars
    if(e.type === 'entity.parse.failed') e = bad('Request body is not valid JSON.');
    if(e.type === 'entity.too.large') e = new HttpError(413, 'too_large', 'Request body is too large.');
    if(!(e instanceof HttpError)){
      console.error(e);
      e = new HttpError(500, 'server_error', 'Something went wrong on the server.');
    }
    res.status(e.status).json({ error: e.code, message: e.message, ...(e.extra || {}) });
  });

  return app;
}

module.exports = { createApp };
