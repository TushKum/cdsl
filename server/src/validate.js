'use strict';
// Checks a learner's synced app state before it is stored.
// Shape checks come first; then the activity log is replayed against the
// server's own market prices, so a client cannot invent cash, shares or prices.
const M = require('./market');

const EPS = 0.05;              // rupee tolerance for floating-point sums
const MAX_TX = 3000, MAX_SMS = 4000;
const KINDS = new Set(['BUY','CR','SELL','PAYIN','DIV','BONUS','SPLIT','PLG','UPLG']);
const SMS_FROM = new Set(['cdsl','broker','co']);

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const near = (a, b) => Math.abs(a - b) <= EPS;
const r2 = v => Math.round(v*100)/100;  // the app rounds cash to paise after every change
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateState(s){
  const errors = [];
  const err = (path, msg) => { if(errors.length < 50) errors.push({ path, message: msg }); };

  if(!isObj(s)) return { ok:false, errors:[{ path:'state', message:'must be an object' }] };
  if(s.v !== 1) err('v', 'unsupported state version');
  if(!['en','hi'].includes(s.lang)) err('lang', 'must be "en" or "hi"');
  if(!isInt(s.onb, 0, 4)) err('onb', 'must be an integer 0-4');
  if(!isInt(s.day, 0, M.PLAY-1)) err('day', `must be an integer 0-${M.PLAY-1}`);
  if(!isNum(s.cash)) err('cash', 'must be a number');
  if(!isInt(s.xp, 0, 1e6)) err('xp', 'must be a non-negative integer');
  if(!Array.isArray(s.tx) || s.tx.length > MAX_TX) err('tx', `must be an array of at most ${MAX_TX} entries`);
  if(!Array.isArray(s.pend)) err('pend', 'must be an array');
  if(!isObj(s.hold)) err('hold', 'must be an object');
  if(!Array.isArray(s.sms) || s.sms.length > MAX_SMS) err('sms', `must be an array of at most ${MAX_SMS} entries`);
  if(errors.length) return { ok:false, errors };

  // Before onboarding is finished there is no demat account, so there must be no activity.
  if(s.onb < 4){
    if(s.tx.length || s.pend.length || Object.keys(s.hold).length) err('onb', 'activity found before the account was opened');
    if(!near(s.cash, M.START_CASH)) err('cash', 'cash changed before the account was opened');
    return errors.length ? { ok:false, errors } : { ok:true, errors, derived:null };
  }

  // Account details
  const k = s.kyc;
  if(!isObj(k)) err('kyc', 'must be an object');
  else {
    if(typeof k.name !== 'string' || !k.name.trim() || k.name.length > 80) err('kyc.name', 'must be 1-80 characters');
    if(!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(k.pan || '')) err('kyc.pan', 'must look like ABCDE1234F');
    if(!/^[6-9]\d{9}$/.test(k.mob || '')) err('kyc.mob', 'must be a 10-digit mobile number');
  }
  const broker = M.BROKERS.find(b => b.id === s.broker);
  if(!broker) err('broker', 'unknown broker');
  if(!/^\d{16}$/.test(s.boId || '')) err('boId', 'must be 16 digits');
  else if(broker && !s.boId.startsWith(broker.dp)) err('boId', 'first 8 digits must be the broker’s DP ID');
  if(s.nominee != null){
    if(!isObj(s.nominee) || typeof s.nominee.name !== 'string' || !s.nominee.name.trim() || s.nominee.name.length > 80 || !isInt(s.nominee.rel, 0, 7))
      err('nominee', 'must have a name and a relation 0-7');
  }
  if(!isObj(s.votes)) err('votes', 'must be an object');
  else for(const [sym, c] of Object.entries(s.votes)){
    if(!M.SMAP[sym]) err(`votes.${sym}`, 'unknown company');
    if(!['for','against','abs'].includes(c)) err(`votes.${sym}`, 'must be for, against or abs');
  }
  if(!isObj(s.ms)) err('ms', 'must be an object');
  else for(const [key, d] of Object.entries(s.ms)){
    if(!M.MILESTONES.includes(key)) err(`ms.${key}`, 'unknown milestone');
    if(!isInt(d, 1, M.PLAY)) err(`ms.${key}`, 'must be a day number');
  }
  if(!isObj(s.learned)) err('learned', 'must be an object');
  else for(const key of Object.keys(s.learned)) if(!M.LESSONS.includes(key)) err(`learned.${key}`, 'unknown lesson');
  if(!isObj(s.scam) || !Array.isArray(s.scam.ans) || s.scam.ans.length > 5 || s.scam.ans.some(a => a != null && a !== 'safe' && a !== 'scam'))
    err('scam', 'answers must be "safe" or "scam"');
  s.sms.forEach((m, i) => {
    if(!isObj(m) || typeof m.k !== 'string' || !/^sms_[a-z]+$/.test(m.k) || !isInt(m.d, 0, M.PLAY-1) || !SMS_FROM.has(m.f) || !isObj(m.v))
      err(`sms[${i}]`, 'malformed alert');
  });
  if(errors.length) return { ok:false, errors };

  // Replay the activity log in order
  let cash = M.START_CASH, lastDay = 0;
  const q = {}, pl = {}, buys = [], sells = [], ent = {};
  s.tx.forEach((x, i) => {
    const at = `tx[${i}]`;
    if(!isObj(x) || !KINDS.has(x.k)) return err(at, 'unknown kind');
    if(!M.SMAP[x.sym]) return err(at, 'unknown company');
    if(!isInt(x.d, 0, s.day)) return err(at, 'day out of range');
    if(x.d < lastDay) return err(at, 'entries must be in date order');
    lastDay = x.d;
    if(!isInt(x.q, 1, 1e7)) return err(at, 'quantity must be a positive whole number');
    const held = q[x.sym] || 0, pled = pl[x.sym] || 0;
    switch(x.k){
      case 'BUY': {
        const p = M.price(x.sym, x.d);
        if(!near(x.px, p)) return err(at, `price must be today’s simulated price ${p}`);
        if(!near(x.amt, x.q*p)) return err(at, 'amount must equal quantity × price');
        cash = r2(cash - x.amt);
        if(cash < -EPS) return err(at, 'not enough cash for this purchase');
        buys.push({ sym:x.sym, q:x.q, px:x.px, d:x.d });
        break;
      }
      case 'CR': {
        const j = buys.findIndex(b => b.sym === x.sym && b.q === x.q && b.d + 1 === x.d);
        if(j < 0) return err(at, 'demat credit without a purchase on the previous day (T+1)');
        if(x.dq !== x.q) return err(at, 'credit must add the bought quantity');
        buys.splice(j, 1);
        q[x.sym] = held + x.q;
        break;
      }
      case 'SELL': {
        const p = M.price(x.sym, x.d);
        if(!near(x.px, p)) return err(at, `price must be today’s simulated price ${p}`);
        if(!near(x.amt, x.q*p)) return err(at, 'amount must equal quantity × price');
        if(x.dq !== -x.q) return err(at, 'sale must debit the sold quantity');
        if(held - pled < x.q) return err(at, 'cannot sell more than the free (unpledged, settled) shares');
        q[x.sym] = held - x.q;
        sells.push({ sym:x.sym, q:x.q, px:x.px, d:x.d });
        break;
      }
      case 'PAYIN': {
        const j = sells.findIndex(b => b.sym === x.sym && b.q === x.q && b.d + 1 === x.d);
        if(j < 0) return err(at, 'sale money without a sale on the previous day (T+1)');
        if(!near(x.amt, sells[j].q*sells[j].px)) return err(at, 'sale money must equal the sale amount');
        sells.splice(j, 1);
        cash = r2(cash + x.amt);
        break;
      }
      case 'DIV': case 'BONUS': case 'SPLIT': {
        const type = { DIV:'div', BONUS:'bonus', SPLIT:'split' }[x.k];
        const c = M.CA.find(c => c.type === type && c.sym === x.sym && c.day === x.d);
        if(!c) return err(at, 'no such corporate action on this day');
        if(ent[c.id]) return err(at, 'corporate action applied twice');
        if(type === 'div'){
          if(x.q !== held) return err(at, 'dividend must be on the shares held on the record date');
          if(!near(x.amt, held*c.amt)) return err(at, 'dividend amount must be shares × dividend per share');
          cash = r2(cash + x.amt);
          ent[c.id] = { qty_held: held, cash: x.amt, shares: 0 };
        } else {
          const add = held*(c.f-1), addPl = pled*(c.f-1);
          if(x.dq !== add || x.q !== add) return err(at, `must credit ${add} new shares`);
          if((x.dp || 0) !== addPl) return err(at, 'pledged quantity must scale too');
          q[x.sym] = held + add; pl[x.sym] = pled + addPl;
          ent[c.id] = { qty_held: held, cash: 0, shares: add };
        }
        break;
      }
      case 'PLG':
        if(x.dp !== x.q) return err(at, 'pledge must lock the pledged quantity');
        if(held - pled < x.q) return err(at, 'cannot pledge more than the free shares');
        pl[x.sym] = pled + x.q;
        break;
      case 'UPLG':
        if(x.dp !== -x.q || pled !== x.q) return err(at, 'release must unlock all pledged shares of the company');
        pl[x.sym] = 0;
        break;
    }
  });
  if(errors.length) return { ok:false, errors };

  // What the replay produced must match what the client claims
  if(!near(cash, s.cash)) err('cash', `does not match the activity log (expected ${cash.toFixed(2)})`);
  const syms = new Set([...Object.keys(q), ...Object.keys(s.hold)]);
  for(const sym of syms){
    const h = s.hold[sym], wantQ = q[sym] || 0, wantPl = pl[sym] || 0;
    if(!M.SMAP[sym]){ err(`hold.${sym}`, 'unknown company'); continue; }
    const gotQ = h ? h.q : 0, gotPl = h ? h.pl : 0;
    if(gotQ !== wantQ) err(`hold.${sym}.q`, `does not match the activity log (expected ${wantQ})`);
    if(gotPl !== wantPl) err(`hold.${sym}.pl`, `does not match the activity log (expected ${wantPl})`);
    if(h && !(isNum(h.avg) && h.avg >= 0)) err(`hold.${sym}.avg`, 'must be a non-negative number');
  }
  // Orders still waiting for T+1 must be exactly the unsettled trades from today
  const open = [...buys.map(b => ({ ...b, side:'B' })), ...sells.map(b => ({ ...b, side:'S' }))];
  const pend = s.pend.slice();
  for(const o of open){
    if(o.d !== s.day){ err('pend', `a ${o.side==='B'?'purchase':'sale'} from day ${o.d+1} was never settled`); continue; }
    const j = pend.findIndex(p => isObj(p) && p.side === o.side && p.sym === o.sym && p.q === o.q && p.d === o.d && near(p.px, o.px));
    if(j < 0) err('pend', `missing pending ${o.side==='B'?'purchase':'sale'} of ${o.q} ${o.sym}`);
    else pend.splice(j, 1);
  }
  if(pend.length) err('pend', 'pending orders that are not in the activity log');
  if(s.pend.some(p => !isInt(p.id, 1, 1e9))) err('pend', 'each pending order needs a numeric id');
  if(errors.length) return { ok:false, errors };

  let netWorth = cash;
  for(const sym of Object.keys(q)) netWorth += q[sym]*M.price(sym, s.day);
  for(const o of open) netWorth += o.side==='B' ? o.q*M.price(o.sym, s.day) : o.q*o.px;
  return { ok:true, errors, derived:{ cash, q, pl, entitlements: ent, netWorth: Math.round(netWorth*100)/100 } };
}

module.exports = { validateState };
