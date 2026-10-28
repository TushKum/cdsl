# Pehla Kadam (पहला कदम)

A learn-by-doing investing sandbox for first-time investors, built for the CDSL Reimagine Ideathon 2026.

| Path | What it is |
|---|---|
| `index.html` | Landing page (Hindi/English) with real screenshots in `assets/` |
| `app/index.html` | The app. One file; open it in any browser and it works fully offline. |
| `mentor/` | Facilitator portal: groups, join codes and per-learner progress (needs the server) |
| `insights/` | Public, anonymous learning statistics (needs the server) |
| `server/` | Node.js + SQLite backend: accounts, sync, depository ledger tables, groups, analytics |
| `tools/build_hosted.py` | Builds the claude.ai-hosted copy (app as the main page, built-in database) into `dist/hosted/` |
| `pitch/` | Pitch deck for the judges (PowerPoint, 14 slides with speaker notes) |

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

## Hosted on claude.ai (built-in database)
The claude.ai-hosted copy needs no server. `python3 tools/build_hosted.py` writes `dist/hosted/`:
- the **app** as the page the link opens
- the landing page at `about/`
- the screenshots

When that page runs inside claude.ai, the app uses the page's own database instead of the Node server:
- **Backup:** each signed-in viewer's progress saves automatically to their private `data/users/<id>/` space, so it follows them to any device. There is no PIN.
- **Facilitators:** a summary (name, day, worth, steps, lessons, scam answers, nominee yes/no; never PAN, Aadhaar, mobile or trades) goes to `members/<id>`, readable only by people with **edit access** to the page. They use the in-app **Facilitator view** (`#mentor`) to create groups and follow learners.
- **Insights:** the same summary without the name goes to `anon/<id>`, which every viewer reads for the in-app **Insights** page (`#insights`).

Access rules declared at publish:

| Path | Read | Write |
|---|---|---|
| `groups` | view | admin |
| `members` | admin | admin |
| `members/{self}` | interact | interact |
| `anon` | view | admin |
| `anon/{self}` | (view) | interact |

Pages using claude.ai's database can only be opened by signed-in members of the owner's organization. The writes come from the browser, so the server-side trade checks below do not apply there.

## Backend (`server/`)

Node.js 22.13+ with Express and the built-in `node:sqlite` module, so there is nothing native to compile.

```bash
cd server
npm install
npm run seed     # optional: a demo facilitator, a demo group and 14 demo learners
npm start        # http://localhost:3000 serves the website, the app and the API
npm test         # 24 tests: price parity with the app, validation, the HTTP API and a free-plan start
```

`npm run seed` prints the demo logins: facilitator `demo.mentor@example.com` / `demo-mentor-2026` (change it with `DEMO_MENTOR_PASSWORD`), and every demo learner uses PIN `2026`. Demo users are flagged `is_demo` and the insights page says how many are included. Running the seed again replaces them.

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `server/data/pehla-kadam.db` | SQLite file (created on first start; migrations run automatically) |
| `CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API. Auth uses bearer tokens, not cookies. |
| `EPHEMERAL_STORAGE` | off | Set to `true` when the database does not survive restarts; the app and portals then warn people |
| `SEED_DEMO` | off | Set to `true` to load the demo group on start whenever it is missing |

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

### Deploy to Render (free plan)
`render.yaml` is set up for Render's free plan:
1. On render.com choose **New → Blueprint**, connect GitHub and pick this repo (branch `main`).
2. Render proposes one free web service, `pehla-kadam`, built from the root `Dockerfile`. Click **Apply**.
3. When it is live, `https://<your-service>.onrender.com` serves the website, `/app/`, `/mentor/`, `/insights/` and the API.

What the free plan means:
- **Data is temporary.** Free services have no disk, so the SQLite file lives in `/tmp` and is wiped whenever the service restarts, sleeps or redeploys. `EPHEMERAL_STORAGE=true` makes the app, the facilitator portal and the insights page say so. Learners never lose progress on their own phone: if the server was wiped, the app keeps the local copy and asks them to turn backup on again.
- **Demo data reloads itself.** `SEED_DEMO=true` loads the demo facilitator (`demo.mentor@example.com` / `demo-mentor-2026`), the demo group and 14 demo learners on every start, so judges always see a populated portal and insights page.
- **It sleeps after about 15 idle minutes.** The first visit after that takes up to a minute while Render wakes it. The app and portals show "Waking up the server" and keep retrying.

| Setting | Free plan value | Meaning |
|---|---|---|
| `DB_FILE` | `/tmp/pehla-kadam.db` | Where SQLite writes |
| `EPHEMERAL_STORAGE` | `true` | Tell people that server data is temporary |
| `SEED_DEMO` | `true` | Load the demo group whenever it is missing |

**For lasting data**, upgrade the service to a paid instance, add a disk mounted at `/data`, set `DB_FILE=/data/pehla-kadam.db`, and remove `EPHEMERAL_STORAGE` (and `SEED_DEMO` if you do not want demo users). Any other host that runs Docker works the same way.

To use the server from the GitHub Pages copy of the site, open the app or a portal once with `?api=https://<your-service>.onrender.com` added to the address; it is remembered in that browser.
