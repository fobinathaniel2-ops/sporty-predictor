# Sporty Predictor v6

Online hosting (GitHub + Vercel): see `DEPLOY.md`.

Football analytics: live scores, match centre, league tables, team profiles, statistics, and an AI analyst
(Gemini picks + web research) on real data from football-data.org. Runs on Node 18+ with no npm packages.

## Termux
    termux-setup-storage
    pkg update -y && pkg install -y nodejs unzip
    unzip -o ~/storage/downloads/sporty-predictor.zip -d ~
    cd ~/sporty-predictor
    termux-wake-lock
    export FOOTBALL_DATA_KEY=your_key
    export GEMINI_API_KEY=your_key     # optional
    node server.js
Open http://localhost:3000 in the phone browser (add to home screen to install it). No `npm install` is needed.

## Options (environment variables)
Competitions are fixed to the list in `competitions.js`. LEAGUES (e.g. PL,PD,CL or ALL, limited to that list) · PIPELINE_HOURS · HORIZON_DAYS (days ahead to pick, default 28) · GEMINI_MODEL · AI_SEARCH=0 · AI_WEB=0 (turn off web match discovery) · AI_WEB_DAYS (default 4) · AI_WEB_MAX (picks per run, default 24) · AI_DAILY_CAP · PORT · DATA_DIR · LIVE_POLL_SEC · DEMO_MODE=1 (simulated data, for testing only)

## Notes
- Picks are saved before kick-off and never changed. Accuracy counts only picks verified against real results.
- Early payout picks (1UP / 2UP) are included as markets; they are settled exactly when the goal timeline is available.
- Data is stored in `data/` as JSON files. Keys stay on the server.
- To edit the interface: `web/` holds the React source; `./build.sh` rebuilds `public/app.js` (needs esbuild).
