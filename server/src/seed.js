'use strict';
// Adds a demo facilitator, one demo group and 14 demo learners with varied progress.
// Every demo user is flagged is_demo = 1 and the public stats report how many there are.
// Run again safely: existing demo users are removed first.
const path = require('node:path');
const { open, tx } = require('./db');
const A = require('./auth');
const M = require('./market');
const sim = require('./sim');
const { validateState } = require('./validate');
const { writeLedger } = require('./ledger');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pehla-kadam.db');
const MENTOR_EMAIL = 'demo.mentor@example.com';
const MENTOR_PASSWORD = process.env.DEMO_MENTOR_PASSWORD || 'demo-mentor-2026';
const LEARNER_PIN = '2026';

// Each learner gets a different path through the app so the group report has something to show.
const PEOPLE = [
  ['Sunita Sharma','hi', 9], ['Asha Verma','hi', 8], ['Meena Patil','en', 7], ['Kavita Yadav','hi', 6], ['Rekha Joshi','hi', 9],
  ['Pooja Gupta','en', 5], ['Lakshmi Iyer','en', 4], ['Farah Khan','hi', 3], ['Anita Das','hi', 7], ['Geeta Rawat','hi', 2],
  ['Neha Singh','en', 6], ['Savita Kumari','hi', 1], ['Ritu Malhotra','en', 8], ['Shabana Shaikh','hi', 4]
];

function rng(seed){ let a = seed; return () => { a = (a*1103515245 + 12345) & 0x7fffffff; return a/0x7fffffff; }; }

function journey(i, [name, lang, depth]){
  const r = rng(1000 + i), S = sim.fresh(lang);
  sim.onboard(S, { name, mobile: '98' + String(10000000 + i*7919).slice(-8), pan: 'ABCP' + 'DEFGHJKLMNPRST'[i] + String(1000 + i*37).slice(-4) + 'K',
    broker: ['b1','b2','b3'][i % 3], client: String(40000000 + i*1013) });
  const picks = M.STOCKS.map(s => s.s).sort(() => r() - .5).slice(0, 2 + Math.floor(r()*3));
  if(depth >= 2){ picks.forEach(sym => { const q = Math.max(1, Math.floor((8000 + r()*9000)/M.price(sym, 0))); sim.buy(S, sym, q); }); }
  if(depth >= 3 && !picks.includes('ITC')) sim.buy(S, 'ITC', 10 + Math.floor(r()*20));
  sim.days(S, depth >= 2 ? 2 + Math.floor(r()*3) : 1);
  sim.learn(S, ['accounts','kyc','boid','order','settlement','alerts'].slice(0, 1 + Math.min(5, depth)));
  if(depth >= 4){ sim.days(S, 6 + Math.floor(r()*6)); const h = Object.keys(S.hold)[0]; if(h && S.hold[h].q > 2) sim.sell(S, h, 1); sim.nextDay(S); sim.learn(S, ['tpin','cas','dividend']); sim.milestone(S, 'cas'); }
  if(depth >= 5){ const h = Object.keys(S.hold).find(k => S.hold[k].q - S.hold[k].pl >= 2); if(h && r() > .35) sim.pledge(S, h, Math.floor(S.hold[h].q/2)); sim.learn(S, ['pledge','bonus','split']); }
  if(depth >= 6 || r() > .7) sim.nominee(S, ['Priya','Rohan','Kiran','Meera'][i % 4] + ' ' + name.split(' ')[1], i % 8);
  if(depth >= 7){ const h = Object.keys(S.hold)[0]; if(h) sim.vote(S, h, ['for','for','against','abs'][i % 4]); sim.learn(S, ['nominee','evoting','pnl']); }
  if(depth >= 3){
    const ans = M.SCAM_KEY.map((a, k) => (r() < (k === 4 ? .45 : k === 1 ? .7 : .9)) ? a : (a === 'safe' ? 'scam' : 'safe'));
    sim.scam(S, depth >= 5 ? ans : ans.slice(0, 2 + (i % 3)));
  }
  sim.days(S, depth*3 + Math.floor(r()*6));
  if(depth >= 8) sim.learn(S, ['bench','scam']);
  S.smsRead = Math.max(0, S.sms.length - Math.floor(r()*4));
  return S;
}

function main(){
  const db = open(DB_FILE);
  const out = tx(db, () => {
    db.prepare('DELETE FROM users WHERE is_demo = 1').run();
    const mentorId = db.prepare("INSERT INTO users (role, name, login, secret_hash, is_demo) VALUES ('mentor', ?, ?, ?, 1)")
      .run('Demo Facilitator', MENTOR_EMAIL, A.hashSecret(MENTOR_PASSWORD)).lastInsertRowid;
    let code; do code = A.joinCode(); while(db.prepare('SELECT 1 FROM cohorts WHERE join_code = ?').get(code));
    const cohortId = db.prepare('INSERT INTO cohorts (mentor_id, name, join_code) VALUES (?, ?, ?)').run(mentorId, 'Indore SHG batch (demo)', code).lastInsertRowid;
    PEOPLE.forEach((p, i) => {
      const S = journey(i, p), check = validateState(S);
      if(!check.ok) throw new Error(`demo learner ${p[0]} failed validation: ${JSON.stringify(check.errors)}`);
      const id = db.prepare("INSERT INTO users (role, name, login, secret_hash, is_demo) VALUES ('learner', ?, ?, ?, 1)").run(p[0], S.kyc.mob, A.hashSecret(LEARNER_PIN)).lastInsertRowid;
      db.prepare('INSERT INTO snapshots (user_id, rev, state_json) VALUES (?, 1, ?)').run(id, JSON.stringify(S));
      writeLedger(db, id, S, check.derived);
      db.prepare('INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)').run(cohortId, id);
    });
    return { code, first: db.prepare("SELECT login FROM users WHERE is_demo = 1 AND role = 'learner' ORDER BY id LIMIT 1").get().login };
  });
  db.close();
  console.log(`Seeded ${PEOPLE.length} demo learners into ${DB_FILE}`);
  console.log(`  Facilitator login: ${MENTOR_EMAIL} / ${MENTOR_PASSWORD}`);
  console.log(`  Demo group join code: ${out.code}`);
  console.log(`  Example learner login: mobile ${out.first}, PIN ${LEARNER_PIN}`);
}

if(require.main === module) main();
module.exports = { journey, PEOPLE };
