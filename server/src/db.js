'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const M = require('./market');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function open(file){
  if(file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if(file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  seedReference(db);
  return db;
}

// Runs fn inside a transaction; rolls back if it throws.
function tx(db, fn){
  db.exec('BEGIN IMMEDIATE');
  try{ const out = fn(); db.exec('COMMIT'); return out; }
  catch(e){ db.exec('ROLLBACK'); throw e; }
}

function migrate(db){
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`);
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  for(const f of files){
    const version = parseInt(f, 10);
    if(done.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, f);
    });
  }
}

// Reference tables mirror src/market.js so the ledger can use foreign keys.
function seedReference(db){
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO instruments (symbol, isin, name_en, name_hi) VALUES (?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET isin = excluded.isin, name_en = excluded.name_en, name_hi = excluded.name_hi`);
    M.STOCKS.forEach(s => ins.run(s.s, s.isin, s.n, s.hn));
    const br = db.prepare(`INSERT INTO brokers (id, dp_id, name) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET dp_id = excluded.dp_id, name = excluded.name`);
    M.BROKERS.forEach(b => br.run(b.id, b.dp, b.name));
    const ca = db.prepare(`INSERT INTO corporate_actions (id, symbol, kind, record_day, amount, ratio) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, kind = excluded.kind, record_day = excluded.record_day,
        amount = excluded.amount, ratio = excluded.ratio`);
    M.CA.forEach(c => ca.run(c.id, c.sym, c.type, c.day, c.amt ?? null, c.f ?? null));
  });
}

module.exports = { open, tx };
