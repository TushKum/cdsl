'use strict';
// Rebuilds a learner's ledger tables from a validated snapshot.
// Called inside the same transaction that stores the snapshot.
const M = require('./market');

const LEDGER_TABLES = ['demat_accounts','holdings','transactions','settlement_queue','ca_entitlements','nominees','votes','alerts','milestones','lessons_read','scam_answers'];

function cashDelta(x){ return x.k==='BUY' ? -x.amt : (x.k==='PAYIN' || x.k==='DIV') ? x.amt : 0; }

function writeLedger(db, userId, s, derived){
  for(const t of LEDGER_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  if(s.onb < 4 || !derived) return;

  db.prepare(`INSERT INTO demat_accounts (user_id, bo_id, broker_id, sim_day, cash, net_worth, xp, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, s.boId, s.broker, s.day, derived.cash, derived.netWorth, s.xp, s.lang);

  const h = db.prepare('INSERT INTO holdings (user_id, symbol, qty, pledged_qty, avg_price) VALUES (?, ?, ?, ?, ?)');
  for(const [sym, qty] of Object.entries(derived.q)) if(qty > 0) h.run(userId, sym, qty, derived.pl[sym] || 0, s.hold[sym].avg);

  const t = db.prepare(`INSERT INTO transactions (user_id, seq, sim_day, kind, symbol, qty, price, amount, demat_delta, pledge_delta, cash_delta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  s.tx.forEach((x, i) => t.run(userId, i, x.d, x.k, x.sym, x.q, x.px ?? null, x.amt ?? null, x.dq || 0, x.dp || 0, cashDelta(x)));

  const sq = db.prepare(`INSERT INTO settlement_queue (user_id, order_id, side, symbol, qty, price, trade_day, settle_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  s.pend.forEach(p => sq.run(userId, p.id, p.side, p.sym, p.q, p.px, p.d, p.d + 1));

  const ce = db.prepare(`INSERT INTO ca_entitlements (user_id, ca_id, qty_held, cash_credited, shares_credited) VALUES (?, ?, ?, ?, ?)`);
  for(const [id, e] of Object.entries(derived.entitlements)) ce.run(userId, id, e.qty_held, e.cash, e.shares);

  if(s.nominee) db.prepare('INSERT INTO nominees (user_id, name, relation, share_pct) VALUES (?, ?, ?, 100)').run(userId, s.nominee.name.trim(), s.nominee.rel);

  const v = db.prepare('INSERT INTO votes (user_id, symbol, choice) VALUES (?, ?, ?)');
  for(const [sym, c] of Object.entries(s.votes)) v.run(userId, sym, c);

  const a = db.prepare('INSERT INTO alerts (user_id, seq, sim_day, template, sender, vars_json) VALUES (?, ?, ?, ?, ?, ?)');
  s.sms.forEach((m, i) => a.run(userId, i, m.d, m.k, m.f, JSON.stringify(m.v)));

  const ms = db.prepare('INSERT INTO milestones (user_id, key, sim_day) VALUES (?, ?, ?)');
  for(const [k, d] of Object.entries(s.ms)) ms.run(userId, k, d - 1);

  const l = db.prepare('INSERT INTO lessons_read (user_id, lesson) VALUES (?, ?)');
  for(const k of Object.keys(s.learned)) if(s.learned[k]) l.run(userId, k);

  const sc = db.prepare('INSERT INTO scam_answers (user_id, message_index, answer, correct) VALUES (?, ?, ?, ?)');
  s.scam.ans.forEach((ans, i) => { if(ans) sc.run(userId, i, ans, ans === M.SCAM_KEY[i] ? 1 : 0); });
}

module.exports = { writeLedger, LEDGER_TABLES };
