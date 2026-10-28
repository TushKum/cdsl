'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashSecret(secret){
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifySecret(secret, stored){
  const [algo, salt, hash] = String(stored).split('$');
  if(algo !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(secret, Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
// A dummy hash so a login for an unknown user costs the same time as a wrong secret.
const DUMMY = hashSecret('not-a-real-secret');

function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

function createSession(db, userId){
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS*864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  return { token, expires_at: expires };
}

function userFromToken(db, token){
  if(!token) return null;
  return db.prepare(`SELECT u.id, u.role, u.name, u.login FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')`).get(sha256(token)) || null;
}

function deleteSession(db, token){ db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token)); }

// Simple fixed-window limiter, kept in memory; enough for one server process.
function rateLimiter({ windowMs, max }){
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip + '|' + req.path, now = Date.now();
    let h = hits.get(key);
    if(!h || now - h.start > windowMs){ h = { start: now, n: 0 }; hits.set(key, h); }
    h.n++;
    if(hits.size > 10000) for(const [k, v] of hits) if(now - v.start > windowMs) hits.delete(k);
    if(h.n > max){
      res.set('Retry-After', String(Math.ceil((h.start + windowMs - now)/1000)));
      return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Wait a few minutes and try again.' });
    }
    next();
  };
}

function joinCode(){
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so codes read cleanly aloud
  let s = ''; const b = crypto.randomBytes(6);
  for(let i=0;i<6;i++) s += A[b[i] % A.length];
  return s;
}

module.exports = { hashSecret, verifySecret, DUMMY, createSession, userFromToken, deleteSession, rateLimiter, joinCode };
