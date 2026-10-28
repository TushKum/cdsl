'use strict';
// The server must price trades exactly like the app, or valid progress would be rejected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../src/market');

function appMarket(){
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'index.html'), 'utf8');
  const start = html.indexOf('/* ---------------- Market data'), end = html.indexOf('/* ---------------- State & storage');
  assert.ok(start > 0 && end > start, 'market block not found in app/index.html');
  const ctx = {};
  vm.runInNewContext(html.slice(start, end) + ';this.out = {PX, RAW, STOCKS, CA, BROKERS, MS, LESSON_ORDER, HIST, PLAY, START_CASH, HAIRCUT};', ctx);
  return JSON.parse(JSON.stringify(ctx.out)); // copy out of the vm realm so deepEqual compares values
}

test('server prices match the app exactly', () => {
  const a = appMarket();
  assert.deepEqual(JSON.parse(JSON.stringify(a.PX)), JSON.parse(JSON.stringify(M.PX)));
  assert.deepEqual(JSON.parse(JSON.stringify(a.RAW)), JSON.parse(JSON.stringify(M.RAW)));
  assert.equal(a.HIST, M.HIST); assert.equal(a.PLAY, M.PLAY); assert.equal(a.START_CASH, M.START_CASH); assert.equal(a.HAIRCUT, M.HAIRCUT);
});

test('reference data matches the app', () => {
  const a = appMarket();
  assert.deepEqual(a.STOCKS.map(s => [s.s, s.isin, s.n, s.hn]), M.STOCKS.map(s => [s.s, s.isin, s.n, s.hn]));
  assert.deepEqual(JSON.parse(JSON.stringify(a.CA)), M.CA);
  assert.deepEqual(a.BROKERS.map(b => [b.id, b.dp]), M.BROKERS.map(b => [b.id, b.dp]));
  assert.deepEqual([...a.MS], M.MILESTONES);
  assert.deepEqual([...a.LESSON_ORDER].sort(), [...M.LESSONS].sort());
});

test('scam answer key matches the app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'index.html'), 'utf8');
  const en = html.slice(html.indexOf('SC:['), html.indexOf('L:{'));
  const answers = [...en.matchAll(/a:'(safe|scam)'/g)].map(m => m[1]);
  assert.deepEqual(answers, M.SCAM_KEY);
});
