'use strict';
// Read-side queries: one learner's ledger, a mentor's cohort, and public aggregates.
const M = require('./market');

const pct = (a, b) => b ? Math.round(a/b*1000)/10 : 0;

function learnerLedger(db, userId){
  const acct = db.prepare(`SELECT d.bo_id, d.broker_id, b.name AS broker, b.dp_id, d.sim_day, d.cash, d.net_worth, d.xp, d.lang
    FROM demat_accounts d JOIN brokers b ON b.id = d.broker_id WHERE d.user_id = ?`).get(userId);
  if(!acct) return null;
  return {
    account: acct,
    holdings: db.prepare(`SELECT h.symbol, i.isin, i.name_en, h.qty, h.pledged_qty, h.avg_price FROM holdings h
      JOIN instruments i ON i.symbol = h.symbol WHERE h.user_id = ? ORDER BY h.symbol`).all(userId),
    settlement_queue: db.prepare('SELECT order_id, side, symbol, qty, price, trade_day, settle_day FROM settlement_queue WHERE user_id = ?').all(userId),
    transactions: db.prepare(`SELECT seq, sim_day, kind, symbol, qty, price, amount, demat_delta, pledge_delta, cash_delta
      FROM transactions WHERE user_id = ? ORDER BY seq`).all(userId),
    entitlements: db.prepare(`SELECT e.ca_id, c.kind, c.symbol, c.record_day, e.qty_held, e.cash_credited, e.shares_credited
      FROM ca_entitlements e JOIN corporate_actions c ON c.id = e.ca_id WHERE e.user_id = ?`).all(userId),
    nominee: db.prepare('SELECT name, relation, share_pct FROM nominees WHERE user_id = ?').get(userId) || null,
    votes: db.prepare('SELECT symbol, choice FROM votes WHERE user_id = ?').all(userId)
  };
}

// One row per learner with the progress numbers a facilitator needs
function memberRows(db, where, args){
  return db.prepare(`SELECT u.id, u.name, u.is_demo, s.updated_at AS last_sync,
      d.sim_day, d.net_worth, d.cash, d.xp, d.lang,
      (SELECT count(*) FROM milestones m WHERE m.user_id = u.id) AS steps,
      (SELECT count(*) FROM lessons_read l WHERE l.user_id = u.id) AS lessons,
      (SELECT count(*) FROM scam_answers a WHERE a.user_id = u.id) AS scam_answered,
      (SELECT sum(correct) FROM scam_answers a WHERE a.user_id = u.id) AS scam_correct,
      EXISTS (SELECT 1 FROM nominees n WHERE n.user_id = u.id) AS has_nominee
    FROM users u LEFT JOIN demat_accounts d ON d.user_id = u.id LEFT JOIN snapshots s ON s.user_id = u.id
    WHERE u.role = 'learner' AND ${where} ORDER BY u.name`).all(...args).map(r => ({
      ...r,
      return_pct: r.net_worth == null ? null : Math.round((r.net_worth/M.START_CASH - 1)*10000)/100,
      market_pct: r.sim_day == null ? null : Math.round((M.marketValue(r.sim_day)/M.START_CASH - 1)*10000)/100,
      has_nominee: !!r.has_nominee, is_demo: !!r.is_demo, scam_correct: r.scam_correct || 0
    }));
}

// Where a group of learners is stuck: milestones, lessons and scam messages
function weakSpots(db, where, args){
  const n = db.prepare(`SELECT count(*) AS n FROM users u JOIN demat_accounts d ON d.user_id = u.id WHERE ${where}`).get(...args).n;
  const ms = db.prepare(`SELECT m.key, count(*) AS done FROM milestones m JOIN users u ON u.id = m.user_id
    JOIN demat_accounts d ON d.user_id = u.id WHERE ${where} GROUP BY m.key`).all(...args);
  const ls = db.prepare(`SELECT l.lesson, count(*) AS done FROM lessons_read l JOIN users u ON u.id = l.user_id
    JOIN demat_accounts d ON d.user_id = u.id WHERE ${where} GROUP BY l.lesson`).all(...args);
  const sc = db.prepare(`SELECT a.message_index, count(*) AS answered, sum(a.correct) AS correct FROM scam_answers a
    JOIN users u ON u.id = a.user_id WHERE ${where} GROUP BY a.message_index`).all(...args);
  const msMap = Object.fromEntries(ms.map(r => [r.key, r.done])), lsMap = Object.fromEntries(ls.map(r => [r.lesson, r.done]));
  return {
    learners: n,
    milestones: M.MILESTONES.map(k => ({ key:k, done: msMap[k] || 0, pct: pct(msMap[k] || 0, n) })),
    lessons: M.LESSONS.map(k => ({ key:k, done: lsMap[k] || 0, pct: pct(lsMap[k] || 0, n) })).sort((a, b) => a.done - b.done),
    scam: M.SCAM_KEY.map((ans, i) => { const r = sc.find(x => x.message_index === i) || { answered:0, correct:0 };
      return { message_index:i, correct_answer:ans, answered:r.answered, correct:r.correct || 0, accuracy_pct: pct(r.correct || 0, r.answered) }; })
  };
}

function cohortReport(db, cohortId){
  const where = 'u.id IN (SELECT user_id FROM cohort_members WHERE cohort_id = ?)';
  return { members: memberRows(db, where, [cohortId]), weak_spots: weakSpots(db, where, [cohortId]) };
}

// Public, anonymous aggregates: no names, no per-learner rows
function publicStats(db){
  const where = "u.role = 'learner'";
  const totals = db.prepare(`SELECT count(*) AS learners, sum(u.is_demo) AS demo,
      round(avg(d.sim_day) + 1, 1) AS avg_day, round(avg(d.net_worth), 2) AS avg_worth
    FROM users u JOIN demat_accounts d ON d.user_id = u.id WHERE ${where}`).get();
  const lang = db.prepare(`SELECT d.lang, count(*) AS n FROM demat_accounts d JOIN users u ON u.id = d.user_id WHERE ${where} GROUP BY d.lang`).all();
  const nominee = db.prepare(`SELECT count(*) AS n FROM nominees n JOIN users u ON u.id = n.user_id WHERE ${where}`).get().n;
  const pledged = db.prepare(`SELECT count(DISTINCT h.user_id) AS n FROM holdings h JOIN users u ON u.id = h.user_id WHERE ${where} AND h.pledged_qty > 0`).get().n;
  const beat = db.prepare(`SELECT d.sim_day, d.net_worth FROM demat_accounts d JOIN users u ON u.id = d.user_id WHERE ${where}`).all()
    .filter(r => r.net_worth > M.marketValue(r.sim_day)).length;
  const learners = totals.learners || 0;
  return {
    learners, demo_learners: totals.demo || 0,
    avg_sim_day: totals.avg_day, avg_net_worth: totals.avg_worth,
    language: { en: (lang.find(r => r.lang==='en') || {}).n || 0, hi: (lang.find(r => r.lang==='hi') || {}).n || 0 },
    nominee_pct: pct(nominee, learners), pledged_pct: pct(pledged, learners), beat_market_pct: pct(beat, learners),
    ...weakSpots(db, where, []),
    generated_at: new Date().toISOString()
  };
}

module.exports = { learnerLedger, cohortReport, publicStats };
