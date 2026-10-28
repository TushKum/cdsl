'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const sim = require('../src/sim');

let server, base, db;
test.before(async () => {
  db = open(':memory:');
  server = createApp(db, { staticRoot: path.join(__dirname, '..', '..'), loginMax: 1000 }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); db.close(); });

async function api(method, url, body, token){
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
function journey(){
  const S = sim.onboard(sim.fresh('hi'), { name:'Sunita Sharma', mobile:'9876543210', broker:'b3' });
  sim.buy(S, 'ITC', 20); sim.buy(S, 'INFY', 10); sim.days(S, 9); sim.pledge(S, 'INFY', 5);
  sim.nominee(S, 'Priya Sharma', 0); sim.scam(S, ['scam','safe','scam','scam','scam']); sim.buy(S, 'TCS', 2);
  return S;
}

test('health and reference data', async () => {
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200); assert.equal(h.body.ok, true); assert.equal(h.body.schema_version, 1);
  const m = await api('GET', '/api/market');
  assert.equal(m.body.instruments.length, 10); assert.equal(m.body.corporate_actions.length, 3); assert.equal(m.body.brokers.length, 3);
});

test('learner account, sync, conflict and ledger', async () => {
  const reg = await api('POST', '/api/learners/register', { name:'Sunita Sharma', mobile:'9876543210', pin:'4821' });
  assert.equal(reg.status, 201); const token = reg.body.token;
  assert.equal((await api('POST', '/api/learners/register', { name:'X', mobile:'9876543210', pin:'1111' })).status, 409);
  assert.equal((await api('POST', '/api/learners/register', { name:'X', mobile:'12345', pin:'1111' })).status, 400);
  assert.equal((await api('POST', '/api/learners/login', { mobile:'9876543210', pin:'0000' })).status, 401);
  assert.equal((await api('POST', '/api/learners/login', { mobile:'9876543210', pin:'4821' })).status, 200);

  assert.equal((await api('GET', '/api/me/state', undefined, token)).status, 404);
  const S = journey();
  const put = await api('PUT', '/api/me/state', { rev:0, state:S }, token);
  assert.equal(put.status, 200, JSON.stringify(put.body)); assert.equal(put.body.rev, 1);
  assert.ok(put.body.net_worth > 0);

  // A second device still on rev 0 gets a conflict with the newer copy
  const stale = await api('PUT', '/api/me/state', { rev:0, state:sim.fresh('en') }, token);
  assert.equal(stale.status, 409); assert.equal(stale.body.rev, 1); assert.equal(stale.body.state.kyc.name, 'Sunita Sharma');

  // Tampered progress is refused and nothing changes
  const bad = JSON.parse(JSON.stringify(S)); bad.cash += 50000;
  const r422 = await api('PUT', '/api/me/state', { rev:1, state:bad }, token);
  assert.equal(r422.status, 422); assert.ok(r422.body.errors.some(e => e.path === 'cash'));

  const got = await api('GET', '/api/me/state', undefined, token);
  assert.equal(got.body.rev, 1); assert.deepEqual(got.body.state, S);

  const l = (await api('GET', '/api/me/ledger', undefined, token)).body;
  assert.equal(l.account.bo_id, S.boId); assert.equal(l.account.broker, 'Kiran Capital');
  const infy = l.holdings.find(h => h.symbol === 'INFY');
  assert.equal(infy.qty, 20); assert.equal(infy.pledged_qty, 5);
  assert.equal(l.settlement_queue.length, 1); assert.equal(l.settlement_queue[0].settle_day, l.settlement_queue[0].trade_day + 1);
  assert.equal(l.transactions.length, S.tx.length);
  assert.ok(l.entitlements.some(e => e.ca_id === 'c1' && e.cash_credited === 130));
  assert.equal(l.nominee.name, 'Priya Sharma');

  // Logging out kills the token
  assert.equal((await api('POST', '/api/logout', undefined, token)).status, 204);
  assert.equal((await api('GET', '/api/me', undefined, token)).status, 401);
});

test('mentor groups, joining and the group report', async () => {
  const m = await api('POST', '/api/mentors/register', { name:'Rekha (facilitator)', email:'Rekha@Example.com', password:'long-enough-pw' });
  assert.equal(m.status, 201);
  assert.equal((await api('POST', '/api/mentors/login', { email:'rekha@example.com', password:'long-enough-pw' })).status, 200);
  const c = await api('POST', '/api/cohorts', { name:'Nashik batch' }, m.body.token);
  assert.equal(c.status, 201); assert.match(c.body.cohort.join_code, /^[A-Z2-9]{6}$/);

  const learner = (await api('POST', '/api/learners/register', { name:'Asha', mobile:'9123456780', pin:'1234' })).body.token;
  assert.equal((await api('POST', '/api/me/cohort', { code:'NOPE00' }, learner)).status, 404);
  const j = await api('POST', '/api/me/cohort', { code:c.body.cohort.join_code.toLowerCase() }, learner);
  assert.equal(j.status, 200); assert.equal(j.body.cohort.mentor, 'Rekha (facilitator)');
  const S = journey(); S.kyc.mob = '9123456780';
  assert.equal((await api('PUT', '/api/me/state', { rev:0, state:S }, learner)).status, 200);

  const rep = await api('GET', `/api/cohorts/${c.body.cohort.id}`, undefined, m.body.token);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.members.length, 1);
  const row = rep.body.members[0];
  assert.equal(row.name, 'Asha'); assert.equal(row.has_nominee, true); assert.equal(row.scam_correct, 4);
  assert.equal(rep.body.weak_spots.scam[4].accuracy_pct, 0);
  assert.equal(rep.body.weak_spots.milestones.find(x => x.key === 'pledge').pct, 100);

  // Roles and ownership are enforced
  assert.equal((await api('GET', '/api/cohorts', undefined, learner)).status, 403);
  const other = (await api('POST', '/api/mentors/register', { name:'Other', email:'other@example.com', password:'long-enough-pw' })).body.token;
  assert.equal((await api('GET', `/api/cohorts/${c.body.cohort.id}`, undefined, other)).status, 404);
  assert.equal((await api('PUT', '/api/me/state', { rev:0, state:S }, m.body.token)).status, 403);
});

test('public stats are anonymous aggregates', async () => {
  const s = (await api('GET', '/api/stats')).body;
  assert.ok(s.learners >= 2);
  assert.equal(s.language.hi, s.learners);
  assert.equal(s.milestones.length, 10); assert.equal(s.scam.length, 5);
  assert.ok(!JSON.stringify(s).includes('Sunita'));
});

test('errors are JSON and bad input is handled', async () => {
  const r = await fetch(base + '/api/learners/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{bad' });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'bad_request');
  assert.equal((await api('GET', '/api/nope')).status, 404);
  assert.equal((await api('PUT', '/api/me/state', { rev:0, state:{} })).status, 401);
});

test('CORS preflight is answered for the API', async () => {
  const r = await fetch(base + '/api/me/state', { method:'OPTIONS', headers:{ Origin:'https://tushkum.github.io', 'Access-Control-Request-Method':'PUT' } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('serves the website but not the server folder', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200); assert.match(await home.text(), /Pehla Kadam/);
  assert.equal((await fetch(base + '/app/')).status, 200);
  assert.equal((await fetch(base + '/server/package.json')).status, 404);
  assert.equal((await fetch(base + '/server/data/pehla-kadam.db')).status, 404);
});

test('login attempts are rate limited', async () => {
  const d = open(':memory:');
  const s = createApp(d, { staticRoot: null, loginMax: 3 }).listen(0);
  await new Promise(r => s.once('listening', r));
  const u = `http://127.0.0.1:${s.address().port}/api/learners/login`;
  const codes = [];
  for(let i=0;i<5;i++) codes.push((await fetch(u, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{"mobile":"9876543210","pin":"0000"}' })).status);
  s.close(); d.close();
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
});
