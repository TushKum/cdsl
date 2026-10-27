# Pehla Kadam (पहला कदम)

A learn-by-doing investing sandbox for first-time investors, built for the CDSL Reimagine Ideathon 2026.

**Website:** `index.html` is the landing page (Hindi/English) that explains the idea, with real screenshots in `assets/`.
**Prototype:** `app/index.html` is the app itself. It's one file with no backend, no build step and no API keys; open it in any browser.

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
| Scam Shield | 5 WhatsApp/SMS messages to judge, red flags, how to check SEBI registration |

* ₹1,00,000 of virtual money, 10 large Indian companies, 60 simulated trading days (seeded random walk, labelled "simulated").
* Full Hindi/English toggle. All strings, lessons, scam messages and resolutions are in one `T` object.
* State is saved to `localStorage` (wrapped in try/catch). Use Profile → Reset demo to start over.

All names, numbers, messages and prices are simulated. No real account is opened.
