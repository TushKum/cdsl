'use strict';
// Plays learner actions the same way app/index.html does, producing states the
// API accepts. Used by the demo seed and by the tests; it is not used to serve requests.
const M = require('./market');

const r2 = v => Math.round(v*100)/100;

function fresh(lang){
  return {v:1, lang:lang||'en', onb:0, kyc:{name:'',pan:'',aad:'',mob:''}, broker:null, boId:'', tpin:'',
    cash:M.START_CASH, day:0, hold:{}, pend:[], tx:[], sms:[], xp:0, learned:{}, ms:{},
    nominee:null, nomSkip:false, votes:{}, scam:{i:0,ans:[]}, scamDone:false, caSeen:{},
    plBase:0, warnDay:-9, cert:false, smsRead:0, seq:1};
}
function milestone(S, k){ if(!S.ms[k]){ S.ms[k] = S.day+1; S.xp += 50; } }
function sms(S, k, v, f){ S.sms.push({ d:S.day, k, v:v||{}, f:f||'cdsl' }); }

function onboard(S, { name, mobile, pan, broker = 'b1', client = '00012345' }){
  const b = M.BROKERS.find(x => x.id === broker);
  S.kyc = { name, pan: pan || 'ABCPD1234K', aad: '9' + mobile + '0', mob: mobile };
  S.broker = broker; S.boId = b.dp + client; S.tpin = '123456'; S.onb = 4;
  sms(S, 'sms_welcome'); milestone(S, 'onboard');
  return S;
}
function buy(S, sym, q){
  const px = M.price(sym, S.day), amt = q*px;
  if(amt > S.cash) throw new Error(`not enough cash to buy ${q} ${sym}`);
  S.cash = r2(S.cash - amt);
  S.pend.push({ id:S.seq++, side:'B', sym, q, px, d:S.day });
  S.tx.push({ k:'BUY', sym, q, px, amt, d:S.day });
  milestone(S, 'buy');
}
function sell(S, sym, q){
  const h = S.hold[sym];
  if(!h || h.q - h.pl < q) throw new Error(`not enough free ${sym} to sell`);
  const px = M.price(sym, S.day), amt = q*px;
  h.q -= q; if(h.q <= 0 && h.pl <= 0) delete S.hold[sym];
  S.pend.push({ id:S.seq++, side:'S', sym, q, px, d:S.day });
  S.tx.push({ k:'SELL', sym, q, px, amt, dq:-q, d:S.day });
  sms(S, 'sms_dr', { sym, q, date:S.day }); milestone(S, 'sell');
}
function nextDay(S){
  if(S.day >= M.PLAY-1) return false;
  S.day++;
  let settledBuy = false;
  S.pend = S.pend.filter(p => {
    if(p.d >= S.day) return true;
    if(p.side === 'B'){
      const h = S.hold[p.sym] || (S.hold[p.sym] = { q:0, avg:0, pl:0 });
      h.avg = (h.q*h.avg + p.q*p.px)/(h.q + p.q); h.q += p.q;
      S.tx.push({ k:'CR', sym:p.sym, q:p.q, dq:p.q, d:S.day });
      sms(S, 'sms_cr', { sym:p.sym, q:p.q, date:S.day }); settledBuy = true;
    } else {
      const amt = p.q*p.px; S.cash = r2(S.cash + amt);
      S.tx.push({ k:'PAYIN', sym:p.sym, q:p.q, amt, d:S.day });
      sms(S, 'sms_pay', { sym:p.sym, amt }, 'broker');
    }
    return false;
  });
  M.CA.filter(c => c.day === S.day).forEach(c => {
    const h = S.hold[c.sym];
    if(h && h.q > 0){
      if(c.type === 'div'){
        const amt = r2(h.q*c.amt); S.cash = r2(S.cash + amt);
        S.tx.push({ k:'DIV', sym:c.sym, q:h.q, amt, d:S.day });
        sms(S, 'sms_div', { sym:c.sym, q:h.q, amt }, 'co');
      } else {
        const add = h.q*(c.f-1), addPl = h.pl*(c.f-1);
        h.q += add; h.pl += addPl; h.avg = h.avg/c.f;
        S.tx.push({ k:c.type === 'bonus' ? 'BONUS' : 'SPLIT', sym:c.sym, q:add, dq:add, dp:addPl, d:S.day });
        sms(S, c.type === 'bonus' ? 'sms_bonus' : 'sms_split', { sym:c.sym, q:add });
      }
    }
    S.caSeen[c.id] = 1;
  });
  if(settledBuy) milestone(S, 'settle');
  if(M.CA.some(c => c.day === S.day)) milestone(S, 'corp');
  return true;
}
function days(S, n){ for(let i=0;i<n;i++) nextDay(S); }
function pledge(S, sym, q){
  const h = S.hold[sym]; if(!h || h.q - h.pl < q) throw new Error(`not enough free ${sym} to pledge`);
  h.pl += q; S.tx.push({ k:'PLG', sym, q, dp:q, d:S.day });
  sms(S, 'sms_plg', { sym, q }); milestone(S, 'pledge');
}
function nominee(S, name, rel){ S.nominee = { name, rel }; sms(S, 'sms_nom'); milestone(S, 'nominee'); }
function vote(S, sym, choice){ S.votes[sym] = choice; sms(S, 'sms_vote', { sym }); milestone(S, 'vote'); }
function learn(S, keys){ keys.forEach(k => { if(!S.learned[k]){ S.learned[k] = 1; S.xp += 10; } }); }
function scam(S, answers){
  S.scam = { i:answers.length, ans:answers.slice() };
  if(answers.length === 5){ S.scamDone = true; S.xp += 20*answers.filter((a, i) => a === M.SCAM_KEY[i]).length; milestone(S, 'scam'); }
}

module.exports = { fresh, onboard, buy, sell, nextDay, days, pledge, nominee, vote, learn, scam, milestone };
