-- Pehla Kadam schema, version 1.
-- Reference data (instruments, brokers, corporate actions) is seeded from src/market.js.
-- Ledger tables (demat_accounts .. scam_answers) are rebuilt from each learner's
-- validated snapshot in one transaction, so they always match what the app shows.

-- Reference data -------------------------------------------------------------
CREATE TABLE instruments (
  symbol   TEXT PRIMARY KEY,
  isin     TEXT NOT NULL UNIQUE CHECK (length(isin) = 12),
  name_en  TEXT NOT NULL,
  name_hi  TEXT NOT NULL
);

CREATE TABLE brokers (
  id     TEXT PRIMARY KEY,
  dp_id  TEXT NOT NULL UNIQUE CHECK (length(dp_id) = 8),
  name   TEXT NOT NULL
);

CREATE TABLE corporate_actions (
  id          TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL REFERENCES instruments(symbol),
  kind        TEXT NOT NULL CHECK (kind IN ('div','bonus','split')),
  record_day  INTEGER NOT NULL,
  amount      REAL,      -- dividend per share (div only)
  ratio       INTEGER    -- new shares per old share (bonus/split only)
);

-- People ---------------------------------------------------------------------
CREATE TABLE users (
  id           INTEGER PRIMARY KEY,
  role         TEXT NOT NULL CHECK (role IN ('learner','mentor')),
  name         TEXT NOT NULL,
  login        TEXT NOT NULL UNIQUE,   -- learner: 10-digit mobile, mentor: lower-cased email
  secret_hash  TEXT NOT NULL,          -- scrypt hash of PIN (learner) or password (mentor)
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,        -- sha256 of the bearer token; the token itself is never stored
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE cohorts (
  id          INTEGER PRIMARY KEY,
  mentor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  join_code   TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE cohort_members (
  cohort_id  INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (cohort_id, user_id)
);
CREATE INDEX cohort_members_user ON cohort_members(user_id);

-- Sync -----------------------------------------------------------------------
CREATE TABLE snapshots (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,        -- optimistic-concurrency revision
  state_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Depository ledger ----------------------------------------------------------
CREATE TABLE demat_accounts (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bo_id       TEXT NOT NULL CHECK (length(bo_id) = 16),
  broker_id   TEXT NOT NULL REFERENCES brokers(id),
  sim_day     INTEGER NOT NULL CHECK (sim_day BETWEEN 0 AND 59),
  cash        REAL NOT NULL,
  net_worth   REAL NOT NULL,           -- computed by the server from prices, not taken from the client
  xp          INTEGER NOT NULL DEFAULT 0,
  lang        TEXT NOT NULL CHECK (lang IN ('en','hi'))
);

CREATE TABLE holdings (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL REFERENCES instruments(symbol),
  qty          INTEGER NOT NULL CHECK (qty >= 0),
  pledged_qty  INTEGER NOT NULL DEFAULT 0 CHECK (pledged_qty >= 0 AND pledged_qty <= qty),
  avg_price    REAL NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE transactions (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,      -- position in the learner's activity log
  sim_day       INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('BUY','CR','SELL','PAYIN','DIV','BONUS','SPLIT','PLG','UPLG')),
  symbol        TEXT NOT NULL REFERENCES instruments(symbol),
  qty           INTEGER NOT NULL,
  price         REAL,
  amount        REAL,
  demat_delta   INTEGER NOT NULL DEFAULT 0,   -- change in shares held in the demat account
  pledge_delta  INTEGER NOT NULL DEFAULT 0,   -- change in pledged shares
  cash_delta    REAL NOT NULL DEFAULT 0,      -- change in trading-account cash
  PRIMARY KEY (user_id, seq)
);
CREATE INDEX transactions_kind ON transactions(kind);

CREATE TABLE settlement_queue (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('B','S')),
  symbol      TEXT NOT NULL REFERENCES instruments(symbol),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  price       REAL NOT NULL,
  trade_day   INTEGER NOT NULL,
  settle_day  INTEGER NOT NULL,         -- always trade_day + 1 (T+1)
  PRIMARY KEY (user_id, order_id)
);

CREATE TABLE ca_entitlements (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ca_id            TEXT NOT NULL REFERENCES corporate_actions(id),
  qty_held         INTEGER NOT NULL,
  cash_credited    REAL NOT NULL DEFAULT 0,
  shares_credited  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ca_id)
);

CREATE TABLE nominees (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  relation   INTEGER NOT NULL CHECK (relation BETWEEN 0 AND 7),
  share_pct  INTEGER NOT NULL DEFAULT 100 CHECK (share_pct BETWEEN 1 AND 100)
);

CREATE TABLE votes (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol   TEXT NOT NULL REFERENCES instruments(symbol),
  choice   TEXT NOT NULL CHECK (choice IN ('for','against','abs')),
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE alerts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  sim_day    INTEGER NOT NULL,
  template   TEXT NOT NULL,
  sender     TEXT NOT NULL CHECK (sender IN ('cdsl','broker','co')),
  vars_json  TEXT NOT NULL,
  PRIMARY KEY (user_id, seq)
);

CREATE TABLE milestones (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  sim_day  INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE lessons_read (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson   TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson)
);

CREATE TABLE scam_answers (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_index  INTEGER NOT NULL CHECK (message_index BETWEEN 0 AND 4),
  answer         TEXT NOT NULL CHECK (answer IN ('safe','scam')),
  correct        INTEGER NOT NULL CHECK (correct IN (0,1)),
  PRIMARY KEY (user_id, message_index)
);
