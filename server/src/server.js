'use strict';
const path = require('node:path');
const { open } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pehla-kadam.db');

const db = open(DB_FILE);
const server = createApp(db).listen(PORT, () => {
  console.log(`Pehla Kadam server on http://localhost:${PORT}  (database: ${DB_FILE})`);
});

function stop(){
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
