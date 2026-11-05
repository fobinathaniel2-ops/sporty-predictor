# Put it online: GitHub + Vercel

Vercel has no hard disk and no background process, so in hosted mode:
- the data lives in **Upstash Redis** (free, added from the Vercel dashboard);
- **GitHub Actions** is the scheduler: every ~5 minutes it calls the app's update steps (live scores, data refresh,
  Gemini picks, web-found matches).
The phone/Termux way of running it (`node server.js`) still works exactly as before.

## 1. Keys and a secret
- football-data.org key, Gemini key (as before).
- `CRON_SECRET`: any long random text that protects the update endpoint. Make one with:
  `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

## 2. Put the code on GitHub (from Termux)
```
pkg install -y git gh
gh auth login                      # choose GitHub.com, HTTPS, "Login with a web browser"
cd ~/sporty-predictor
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git init -b main
git add .
git commit -m "Predictx"
gh repo create sporty-predictor --public --source=. --push
```
Use a **public** repo: GitHub Actions is free and unlimited there, and no keys are stored in the code.
(A private repo only gets 2,000 free minutes a month, so change the schedule in `.github/workflows/update.yml` to every 30 minutes.)

## 3. Deploy on Vercel
1. vercel.com → **Add New → Project** → import `sporty-predictor` from GitHub. Leave every build setting as it is.
2. Before pressing Deploy, open **Environment Variables** and add:
   `FOOTBALL_DATA_KEY`, `GEMINI_API_KEY`, `CRON_SECRET` (the secret from step 1). Optional: `LEAGUES`, `AI_DAILY_CAP`.
3. Deploy. Then open the project → **Storage** → **Create Database** → **Upstash Redis** (free plan) → connect it to this project.
   This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
4. **Deployments → ⋯ → Redeploy** so the app picks up the database.

## 4. Turn on the scheduler (GitHub)
Repository → **Settings → Secrets and variables → Actions → New repository secret**:
- `SITE_URL` = your Vercel address, e.g. `https://sporty-predictor.vercel.app`
- `CRON_SECRET` = the same secret as in Vercel

Then **Actions → Update data → Run workflow**, set repeats to `15` for the first fill (it loads each competition
slowly because the free football-data.org plan allows 10 requests a minute). After that it runs by itself.

## 5. Check
Open `https://YOUR-SITE.vercel.app/api/status`. `configured: true` and growing match counts mean it works.

## Good to know
- Scores refresh when someone opens the app (at most once a minute) and on every scheduler run. In-play picks
  and result checking happen on scheduler runs, so they can lag by 5–15 minutes. For a steadier clock, add a free job at
  cron-job.org that calls `https://YOUR-SITE.vercel.app/api/cron?step=live` every minute with the header
  `Authorization: Bearer YOUR_CRON_SECRET`.
- GitHub pauses scheduled workflows in a public repo after 60 days without any repository activity; re-enable it in the Actions tab.
- Free Upstash plans have a monthly command limit. The app reads the database about once per 20 seconds per active server, so
  heavy public traffic may need a paid plan.
- Vercel's free plan allows 60 seconds per call, so the updates run in small pieces. That is what the repeats are for.
