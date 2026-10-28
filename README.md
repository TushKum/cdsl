# Pehla Kadam (पहला कदम)

A learn-by-doing investing sandbox for first-time investors, built for the CDSL Reimagine Ideathon 2026.

| Path | What it is |
|---|---|
| `index.html` | Landing page (Hindi/English) with real screenshots in `assets/` |
| `app/index.html` | The app. One file; open it in any browser and it works fully offline. |
| `mentor/` | Facilitator portal: groups, join codes and per-learner progress (needs the server) |
| `insights/` | Public, anonymous learning statistics (needs the server) |
| `server/` | Node.js + SQLite backend: accounts, sync, depository ledger tables, groups, analytics |

The app never needs the server. When it is opened from a running server, **Profile → Cloud backup** appears and learners can back up, restore on another phone and join a facilitator's group.

### Publish on GitHub Pages
1. Merge this branch into `main`.
2. Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**, Save.
3. After a minute the site is live at `https://tushkum.github.io/cdsl/`, with the prototype at `/cdsl/app/`.

GitHub Pages needs a public repo on the free plan.

## What it teaches
It's not a trading game. Each action explains what happens at the depository layer:

| Flow | What you learn |
|---|---|
| Onboarding (KYC → broker → BO ID) | Trading vs demat account, broker vs DP vs depository, BO ID, TPIN |
| Buy / sell | Market orders, T+1 settlement, CDSL credit/debit SMS alerts, TPIN/eDIS approval |
| Portfolio & CAS | Avg price and gain/loss, a monthly Consolidated Account Statement rebuilt from demat movements |
| Corporate actions | Dividend (day 5), 1:1 bonus (day 9), 1→5 split (day 13), each with a lesson card |
| Pledge | OTP-confirmed pledge, locked shares that stay in your name, haircut, margin-drop warnings |
| Nomination | Nominee form; skipping it shows what happens without a nominee |
| E-voting | A 3-line AGM resolution summary with For/Against/Abstain voting |
| Learner dashboard | Your worth vs an equal-weight market benchmark and vs keeping cash (with hover and a table view), where your money is, a diversification tip, income from corporate actions, learning progress and a safety check |
| Full-page dashboard (`app/index.html#dashboard`) | Wide dashboard: worth vs market vs cash with period picker, daily change bars, holdings table, depository activity ledger with T/T+1 tags and filters, corporate-action income, alerts, learning and safety. Shows a labelled example learner before you start; updates live from another tab. |
| Scam Shield | 5 WhatsApp/SMS messages to judge, red flags, how to check SEBI registration |

* ₹1,00,000 of virtual money, 10 large Indian companies, 60 simulated trading days (seeded random walk, labelled "simulated").
* Full Hindi/English toggle. All strings, lessons, scam messages and resolutions are in one `T` object.
* State is saved to `localStorage` (wrapped in try/catch). Use Profile → Reset demo to start over.

All names, numbers, messages and prices are simulated. No real account is opened.

## Backend (`server/`)

Node.js 22.13+ with Express and the built-in `node:sqlite` module, so there is nothing native to compile.

```bash
cd server
npm install
npm run seed     # optional: a demo facilitator, a demo group and 14 demo learners
npm start        # http://localhost:3000 serves the website, the app and the API
npm test         # 21 tests: price parity with the app, validation and the HTTP API
```

`npm run seed` prints the demo logins: facilitator `demo.mentor@example.com` / `demo-mentor-2026` (change it with `DEMO_MENTOR_PASSWORD`), and every demo learner uses PIN `2026`. Demo users are flagged `is_demo` and the insights page says how many are included. Running the seed again replaces them.

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `server/data/pehla-kadam.db` | SQLite file (created on first start; migrations run automatically) |
| `CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API. Auth uses bearer tokens, not cookies. |

### How sync stays honest
The app runs the simulation; the server checks it. Every `PUT /api/me/state` is replayed against the server's own copy of the price engine (`src/market.js`, kept identical to the app by `test/market.test.js`):
- each trade must use that day's simulated price, and cash can never go below zero;
- every demat credit and every sale payout must be exactly T+1 after its trade;
- dividends, bonus and split credits must match the corporate action and the shares held on the record date;
- you cannot sell or pledge more than your free shares;
- the final cash, holdings and pending orders must equal what the log produces.

Anything that does not add up is refused with `422` and a list of reasons. Net worth is computed by the server, never taken from the client. Each save carries the revision it was based on; a stale device gets `409` with the newer copy, which the app then loads.

### Database
Schema: `server/migrations/001_init.sql`. Every valid save rebuilds the learner's ledger rows in the same transaction that stores the snapshot.

| Group | Tables |
|---|---|
| Reference | `instruments` (ISIN), `brokers` (DP ID), `corporate_actions` |
| People | `users` (learner or mentor; scrypt-hashed PIN/password), `sessions` (sha256 of bearer token, 30-day expiry), `cohorts`, `cohort_members` |
| Sync | `snapshots` (state JSON + revision) |
| Depository ledger | `demat_accounts` (BO ID, cash, server-computed net worth), `holdings` (qty, pledged qty), `transactions` (demat, pledge and cash deltas), `settlement_queue` (T+1), `ca_entitlements`, `nominees`, `votes`, `alerts`, `milestones`, `lessons_read`, `scam_answers` |

### API
All bodies are JSON. Authenticated routes take `Authorization: Bearer <token>`.

| Route | Who | Does |
|---|---|---|
| `GET /api/health` | anyone | Server and schema version |
| `GET /api/market` | anyone | Instruments, brokers, corporate actions |
| `GET /api/stats` | anyone | Anonymous aggregates (no names); cached 30 s |
| `POST /api/learners/register` · `/login` | anyone | `{name, mobile, pin}` · `{mobile, pin}` → token. Logins are rate-limited. |
| `POST /api/mentors/register` · `/login` | anyone | `{name, email, password}` · `{email, password}` → token |
| `POST /api/logout` | signed in | Ends the session |
| `GET /api/me` | signed in | Profile, plus group (learner) or groups (mentor) |
| `GET /api/me/state` · `PUT /api/me/state` | learner | Read or save progress `{rev, state}`; `409` on a stale rev, `422` if it does not add up |
| `GET /api/me/ledger` | learner | Account, holdings, settlement queue, transactions, entitlements, nominee, votes |
| `POST /api/me/cohort` · `DELETE /api/me/cohort` | learner | Join a group with `{code}` · leave it |
| `GET /api/cohorts` · `POST /api/cohorts` | mentor | List groups · create one `{name}` (returns a 6-letter join code) |
| `GET /api/cohorts/:id` · `DELETE /api/cohorts/:id` | mentor (owner) | Group report (members, weak spots) · delete the group |

### Deploy
The repo root has a `Dockerfile` that serves everything from one container, and a `render.yaml` blueprint for [Render](https://render.com) with a 1 GB disk mounted at `/data` for the SQLite file (persistent disks need a paid instance). Any host that runs Docker and keeps `/data` works the same way.

To use a deployed server from the GitHub Pages copy of the site, open the app or portal once with `?api=https://your-server` added to the address; it is remembered in that browser.
