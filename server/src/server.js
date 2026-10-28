'use strict';
const path = require('node:path');
const { open } = require('./db');
const { createApp } = require('./app');
const { seedDemo, hasDemo } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pehla-kadam.db');

const flag = name => /^(1|true|yes)$/i.test(process.env[name] || '');
// EPHEMERAL_STORAGE: the database file does not survive restarts (e.g. Render's free plan).
// The API reports it so the app and portals can warn people.
const ephemeral = flag('EPHEMERAL_STORAGE');

const db = open(DB_FILE);
// SEED_DEMO: load the demo facilitator, group and learners whenever they are missing,
// so a free instance that lost its data on restart still has something to show.
if(flag('SEED_DEMO') && !hasDemo(db)){
  const out = seedDemo(db);
  console.log(`Loaded demo data (group code ${out.code})`);
}
const server = createApp(db, { ephemeral }).listen(PORT, () => {
  console.log(`Pehla Kadam server on http://localhost:${PORT}  (database: ${DB_FILE})`);
});

function stop(){
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
