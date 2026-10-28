'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/market');
const sim = require('../src/sim');
const { validateState } = require('../src/validate');
const { journey, PEOPLE } = require('../src/seed');

function sample(){
  const S = sim.onboard(sim.fresh('en'), { name:'Test Learner', mobile:'9876543210' });
  sim.buy(S, 'ITC', 20); sim.buy(S, 'INFY', 10); sim.buy(S, 'ASIANPAINT', 4);
  sim.days(S, 5); sim.sell(S, 'ITC', 5); sim.days(S, 4);
  sim.pledge(S, 'INFY', 10); sim.days(S, 5);
  sim.nominee(S, 'Priya', 0); sim.vote(S, 'ITC', 'for'); sim.scam(S, ['scam','safe','scam','scam','safe']);
  sim.buy(S, 'TCS', 2);
  return S;
}
const clone = o => JSON.parse(JSON.stringify(o));
const msgs = r => r.errors.map(e => e.path + ': ' + e.message).join('\n');

test('a full journey is accepted and net worth is computed by the server', () => {
  const S = sample(), r = validateState(S);
  assert.ok(r.ok, msgs(r));
  assert.equal(r.derived.q.INFY, 20);            // 1:1 bonus applied
  assert.equal(r.derived.pl.INFY, 10);           // pledged after the bonus
  assert.equal(r.derived.q.ASIANPAINT, 20);      // 1 -> 5 split
  assert.ok(r.derived.entitlements.c1.cash > 0); // ITC dividend
  assert.equal(S.pend.length, 1);                // TCS still waiting for T+1
});

test('every demo learner is valid', () => {
  PEOPLE.forEach((p, i) => { const r = validateState(journey(i, p)); assert.ok(r.ok, p[0] + '\n' + msgs(r)); });
});

test('a fresh, not-yet-onboarded state is accepted', () => {
  assert.ok(validateState(sim.fresh('hi')).ok);
});

test('invented cash is rejected', () => {
  const S = sample(); S.cash += 5000;
  const r = validateState(S); assert.equal(r.ok, false); assert.match(msgs(r), /^cash/m);
});

test('a trade at a made-up price is rejected', () => {
  const S = clone(sample()); const b = S.tx.find(x => x.k === 'BUY'); b.px = 1; b.amt = b.q;
  assert.match(msgs(validateState(S)), /simulated price/);
});

test('shares credited without a purchase are rejected', () => {
  const S = sample(); S.tx.push({ k:'CR', sym:'TCS', q:100, dq:100, d:S.day }); S.hold.TCS = { q:100, avg:1, pl:0 };
  assert.match(msgs(validateState(S)), /T\+1/);
});

test('selling pledged shares is rejected', () => {
  const S = sim.onboard(sim.fresh('en'), { name:'X', mobile:'9876543210' });
  sim.buy(S, 'ITC', 10); sim.nextDay(S); sim.pledge(S, 'ITC', 10);
  S.tx.push({ k:'SELL', sym:'ITC', q:5, px:M.price('ITC', S.day), amt:5*M.price('ITC', S.day), dq:-5, d:S.day });
  assert.match(msgs(validateState(S)), /free/);
});

test('an unsettled old order is rejected', () => {
  const S = sim.onboard(sim.fresh('en'), { name:'X', mobile:'9876543210' });
  sim.buy(S, 'ITC', 10); S.day = 3;   // skipped settlement
  assert.match(msgs(validateState(S)), /never settled/);
});

test('a dividend paid twice is rejected', () => {
  const S = sample(); const d = S.tx.find(x => x.k === 'DIV');
  S.tx.splice(S.tx.indexOf(d) + 1, 0, { ...d }); S.cash += d.amt;
  assert.equal(validateState(S).ok, false);
});

test('bad shapes are rejected without throwing', () => {
  for(const bad of [null, 5, 'x', [], { v:2 }, { ...sample(), tx: 'nope' }, { ...sample(), day: 99 }, { ...sample(), boId: '1' }])
    assert.equal(validateState(bad).ok, false);
});
