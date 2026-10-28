'use strict';
// Render free plan: no disk, data in /tmp, demo data reloaded on every start.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { open } = require('../src/db');
const { seedDemo, hasDemo } = require('../src/seed');

test('seedDemo is repeatable and replaces the old demo data', () => {
  const db = open(':memory:');
  assert.equal(hasDemo(db), false);
  const a = seedDemo(db), b = seedDemo(db);
  assert.notEqual(a.code, undefined);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE is_demo = 1 AND role = 'learner'").get().n, 14);
  assert.equal(db.prepare('SELECT count(*) AS n FROM cohorts').get().n, 1);
  assert.equal(db.prepare('SELECT join_code FROM cohorts').get().join_code, b.code);
  assert.equal(hasDemo(db), true);
  db.close();
});

async function startServer(env){
  const port = 30000 + Math.floor(Math.random()*20000);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')],
    { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  for(let i=0;i<50;i++){
    try{ const r = await fetch(`http://127.0.0.1:${port}/api/health`); if(r.ok) return { child, base:`http://127.0.0.1:${port}`, log:() => out }; }catch(e){}
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill(); throw new Error('server did not start:\n' + out);
}
function stop(child){ return new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); }); }

test('a free-plan start loads demo data, reports temporary storage and survives a wipe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-free-')), DB_FILE = path.join(dir, 'pehla-kadam.db');
  const env = { DB_FILE, EPHEMERAL_STORAGE: 'true', SEED_DEMO: 'true' };
  let s = await startServer(env);
  try{
    const h = await (await fetch(s.base + '/api/health')).json();
    assert.equal(h.ephemeral, true);
    const st = await (await fetch(s.base + '/api/stats')).json();
    assert.equal(st.ephemeral, true); assert.equal(st.demo_learners, 14);
    const login = await fetch(s.base + '/api/mentors/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email:'demo.mentor@example.com', password:'demo-mentor-2026' }) });
    assert.equal(login.status, 200);
  } finally { await stop(s.child); }

  // Restart with the same file: demo data is not duplicated
  s = await startServer(env);
  try{ assert.equal((await (await fetch(s.base + '/api/stats')).json()).demo_learners, 14); }
  finally { await stop(s.child); }

  // Render wipes /tmp on sleep or redeploy: the next start reloads the demo group from nothing
  fs.rmSync(dir, { recursive: true, force: true });
  s = await startServer(env);
  try{ assert.equal((await (await fetch(s.base + '/api/stats')).json()).demo_learners, 14); }
  finally { await stop(s.child); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('without the flags the server stays empty and reports durable storage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-paid-'));
  const s = await startServer({ DB_FILE: path.join(dir, 'x.db'), EPHEMERAL_STORAGE: '', SEED_DEMO: '' });
  try{
    assert.equal((await (await fetch(s.base + '/api/health')).json()).ephemeral, false);
    assert.equal((await (await fetch(s.base + '/api/stats')).json()).learners, 0);
  } finally { await stop(s.child); fs.rmSync(dir, { recursive: true, force: true }); }
});
