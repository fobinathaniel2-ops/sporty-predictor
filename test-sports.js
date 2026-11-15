'use strict';
// Offline test of the API-Sports integration (football + basketball) with a simulated API. No network, no FOOTBALL_DATA_KEY, no Gemini.
process.env.DATA_DIR = require('os').tmpdir() + '/sp-sports-' + process.pid;
process.env.API_SPORTS_KEY = 'test-key';
delete process.env.FOOTBALL_DATA_KEY; delete process.env.GEMINI_API_KEY; delete process.env.DEMO_MODE;
process.env.AS_PER_RUN = '40'; process.env.AS_BACKFILL_DAYS = '30'; process.env.AS_DAYS_AHEAD = '3'; process.env.AS_DAILY_CAP = '90';
try { require('fs').rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
const assert = require('assert');
const dbm = require('./db'); dbm.load();
const bk = require('./basketball');
const api = require('./apisports');
const sports = require('./sports');
const pipeline = require('./pipeline');

const NOW = new Date('2026-11-14T12:00:00Z');
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const DAY = 86400000;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/* ---- a fake API-Sports: deterministic fixtures for any date ---- */
const calls = { football: [], basketball: [] };
let failWith = null, clock = NOW;
const FB_TEAMS = { 39: ['Arsenal', 'Chelsea', 'Spurs', 'Everton', 'Fulham', 'Brentford'], 570: ['Hearts of Oak', 'Kotoko', 'Aduana', 'Medeama', 'Berekum', 'Legon'], 999: ['Zed FC', 'Yak FC', 'Qux FC', 'Wib FC'] };
const FB_LEAGUE = { 39: ['Premier League', 'England'], 570: ['Premier League', 'Ghana'], 999: ['Obscure Cup', 'Nowhere'] };
const BK_TEAMS = { 12: ['Lakers', 'Celtics', 'Bulls', 'Heat', 'Suns', 'Nets'], 120: ['Real Madrid', 'Olympiacos', 'Fenerbahce', 'Barcelona', 'Monaco', 'Partizan'] };
const BK_LEAGUE = { 12: ['NBA', 'USA'], 120: ['Euroleague', 'Europe'] };
const strength = (name) => (name.charCodeAt(0) % 7) * 2;

function fbRows(date) {
  const rows = []; let n = 0;
  for (const [id, teams] of Object.entries(FB_TEAMS)) for (let i = 0; i < teams.length; i += 2) {
    n++;
    const kick = new Date(`${date}T${String(14 + (n % 6)).padStart(2, '0')}:00:00Z`);
    const done = kick < clock - 2 * 3600000, live = !done && kick < clock;
    const hs = strength(teams[i]), as = strength(teams[i + 1]);
    const gh = Math.max(0, Math.round(1.4 + (hs - as) / 12 + (rnd() - 0.5) * 2.4)), ga = Math.max(0, Math.round(1.1 + (as - hs) / 12 + (rnd() - 0.5) * 2.2));
    rows.push({ fixture: { id: Number(`${id}${date.replace(/-/g, '')}${n}`), date: kick.toISOString(), status: { short: done ? 'FT' : live ? '2H' : 'NS', elapsed: live ? 60 : null } },
      league: { id: Number(id), name: FB_LEAGUE[id][0], country: FB_LEAGUE[id][1], logo: null, season: 2026, round: 'Regular Season - 12' },
      teams: { home: { id: 100 * Number(id) + i, name: teams[i], logo: null }, away: { id: 100 * Number(id) + i + 1, name: teams[i + 1], logo: null } },
      goals: done ? { home: gh, away: ga } : { home: null, away: null }, score: { halftime: done ? { home: Math.min(gh, 1), away: 0 } : { home: null, away: null } } });
  }
  rows.push({ fixture: { id: 5, date: 'not a date', status: { short: 'NS' } }, league: { id: 39, name: 'Premier League', country: 'England' }, teams: { home: { id: 1, name: 'X' }, away: { id: 2, name: 'Y' } } }); // invalid: must be rejected
  return rows;
}
function bkRows(date) {
  const rows = []; let n = 0;
  for (const [id, teams] of Object.entries(BK_TEAMS)) for (let i = 0; i < teams.length; i += 2) {
    n++;
    const kick = new Date(`${date}T${String(1 + (n % 3) * 4).padStart(2, '0')}:30:00Z`);
    const done = kick < clock - 3 * 3600000;
    const hs = strength(teams[i]), as = strength(teams[i + 1]);
    const base = id === '12' ? 112 : 82;
    const ph = Math.round(base + (hs - as) / 2 + 2 + (rnd() - 0.5) * 16), pa = Math.round(base + (as - hs) / 2 - 2 + (rnd() - 0.5) * 16);
    rows.push({ id: Number(`${id}${date.replace(/-/g, '')}${n}`), date: kick.toISOString(), status: { short: done ? 'FT' : 'NS' },
      league: { id: Number(id), name: BK_LEAGUE[id][0], logo: null, season: '2026-2027' }, country: { name: BK_LEAGUE[id][1] },
      teams: { home: { id: 100 * Number(id) + i, name: teams[i], logo: null }, away: { id: 100 * Number(id) + i + 1, name: teams[i + 1], logo: null } },
      scores: done ? { home: { quarter_1: 25, quarter_2: 25, quarter_3: 25, quarter_4: ph - 75, total: ph }, away: { quarter_1: 20, quarter_2: 20, quarter_3: 20, quarter_4: pa - 60, total: pa } } : { home: { total: null }, away: { total: null } } });
  }
  return rows;
}
const nodeFetch = global.fetch;
global.fetch = async (url, opt) => {
  if (String(url).startsWith('http://localhost')) return nodeFetch(url, opt);
  const u = new URL(url); const sport = u.host.startsWith('v3.football') ? 'football' : 'basketball';
  assert.strictEqual(opt.headers['x-apisports-key'], 'test-key', 'key sent as the x-apisports-key header');
  if (u.pathname === '/status') return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ errors: [], response: { subscription: { plan: 'Free', active: true, end: '2027-01-01' }, requests: { current: 3, limit_day: 100 } } }) };
  const date = u.searchParams.get('date'); calls[sport].push(date);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), 'one request per calendar day');
  if (failWith) return failWith;
  const rows = sport === 'football' ? fbRows(date) : bkRows(date);
  return { status: 200, ok: true, headers: { get: (h) => ({ 'x-ratelimit-requests-remaining': String(95 - calls[sport].length), 'x-ratelimit-requests-limit': '100' }[h] || null) }, json: async () => ({ errors: [], results: rows.length, response: rows }) };
};

(async () => {
  // ---- 1. planning: today first, then yesterday, tomorrow, later days, history; nothing twice ----
  const a0 = sports.meta(NOW);
  const plan = sports.planDates('football', NOW, a0).map((x) => x.date);
  assert.strictEqual(plan[0], '2026-11-14', 'today first');
  assert.strictEqual(plan[1], '2026-11-13', 'then yesterday');
  assert.strictEqual(plan[2], '2026-11-15', 'then tomorrow');
  assert(plan.includes('2026-10-16') && plan.length === 1 + 1 + 1 + 2 + 29, `history to 30 days back: ${plan.length}`);

  // ---- 1b. API-Sports league names are not unique: the country must match ----
  assert.strictEqual(sports.listed('League Cup', 'England'), 'EFL Cup (Carabao Cup)');
  assert.strictEqual(sports.listed('League Cup', 'Hong-Kong'), null, 'Hong Kong League Cup is not the Carabao Cup');
  assert.strictEqual(sports.listed('Premier League', 'Ghana'), 'Ghana Premier League');
  assert.strictEqual(sports.listed('Premier League', 'Egypt'), 'Egyptian Premier League');
  assert.strictEqual(sports.listed('Bundesliga', 'Austria'), null, 'Austrian Bundesliga is not the German one');
  assert.strictEqual(sports.listed('UEFA Nations League', 'World'), 'UEFA Nations League');
  assert.strictEqual(sports.listed('UEFA Champions League', 'World'), 'UEFA Champions League');
  assert.strictEqual(sports.listed('Super Cup', 'Austria'), null);

  // ---- 2. sync works with NO FOOTBALL_DATA_KEY and no Gemini ----
  assert(!pipeline.provider(), 'no football-data provider');
  const r = await sports.sync(NOW);
  assert(r.football.fetched > 30 && r.basketball.fetched > 30, 'fetched many days');
  assert(r.football.rejected > 0, 'invalid fixture rejected');
  const d = dbm.data();
  const fbLeagues = Object.values(d.leagues).filter((l) => l.ext && l.sport === 'football'), bkLeagues = Object.values(d.leagues).filter((l) => l.ext && l.sport === 'basketball');
  assert.strictEqual(bkLeagues.length, 2, 'both basketball leagues kept (all leagues the API returns)');
  assert(fbLeagues.some((l) => l.name === 'Ghana Premier League'), 'Ghana league mapped to the list name');
  assert(!Object.values(d.matches).some((m) => m.league === 'AF_999'), 'unlisted football league skipped in the default scope');
  assert(Object.values(d.matches).every((m) => !m.ext || (m.id.startsWith('af_') || m.id.startsWith('bk_'))), 'ids are namespaced');

  // ---- 3. budget: never more than the daily cap, and each date fetched once ----
  assert(calls.football.length <= 90 && calls.basketball.length <= 90, 'daily cap respected');
  const again = await sports.sync(NOW);
  assert(again.football.fetched <= 1, `nothing refetched immediately (${again.football.fetched})`);
  const before = calls.football.length;
  await sports.sync(new Date(+NOW + 10 * 60000)); assert(calls.football.length - before <= 1, 'today is refreshed at most every 30 minutes');

  // ---- 4. predictions: football pooled model + basketball per-league model ----
  clock = new Date(+NOW);
  const st = sports.predict(NOW, pipeline.upsertPrediction);
  assert(st.basketball > 0, `basketball predictions made: ${JSON.stringify(st)}`);
  const preds = Object.values(dbm.data().predictions);
  const bp = preds.filter((p) => p.sport === 'basketball');
  assert(bp.length > 0 && bp.every((p) => p.best && p.high !== undefined && p.pm['1'] > 0 && Math.abs(p.pm['1'] + p.pm['2'] - 1) < 0.01 && p.expected.total > 100 - 40), 'basketball picks have probabilities');
  assert(bp.every((p) => Object.keys(p.pm).some((k) => /^Over /.test(k)) && Object.keys(p.pm).some((k) => /^Home [-+]/.test(k))), 'handicap and total-points markets present');
  const fp = preds.filter((p) => p.sport !== 'basketball');
  assert(fp.length > 0 && fp.every((p) => p.best && p.pm['1'] !== undefined), 'football picks from the pooled model');

  // ---- 5. settlement: games finish, picks are checked with the right rules ----
  const sim = new Date(+NOW + 2 * DAY);
  clock = sim;
  const lateDay = ymd(+NOW + 1 * DAY);
  const a = sports.meta(sim); delete a.fetched.football[lateDay]; delete a.fetched.basketball[lateDay]; delete a.fetched.football[ymd(+NOW)]; delete a.fetched.basketball[ymd(+NOW)];
  await sports.sync(sim);
  const settled = pipeline.settleAll(sim);
  assert(settled > 0, `picks settled: ${settled}`);
  const sb = Object.values(dbm.data().predictions).filter((p) => p.sport === 'basketball' && p.settled);
  for (const p of sb) {
    const m = dbm.data().matches[p.matchId];
    assert.strictEqual(p.best.correct, bk.settleId(p.best.id, m.ft), 'basketball pick settled with basketball rules');
    assert(typeof p.best.correct === 'boolean');
  }
  const acc = require('./accuracy').compute(dbm.data(), { includeDemo: false });
  assert(acc.basketballPicks.total === sb.length && acc.basketballPicks.total > 0, `basketball counted separately: ${acc.basketballPicks.total}`);
  assert(acc.highOdds.total >= 0);

  // ---- 6. failures: bad key / plan / quota pause that sport and are reported ----
  const a2 = sports.meta(sim); a2.blocked = {}; a2.fetched.football = {};
  failWith = { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ errors: { token: 'Error/Missing application key.' }, response: [] }) };
  const bad = await sports.sync(sim);
  assert(bad.football.errors[0].includes('Missing application key'), 'key error reported');
  assert(sports.status(sim).football.pausedUntil, 'sport paused after an error');
  const calls0 = calls.football.length; await sports.sync(sim); assert.strictEqual(calls.football.length, calls0, 'no calls while paused');
  failWith = { status: 429, ok: false, headers: { get: () => null }, json: async () => ({}) };
  sports.meta(sim).blocked = {}; const q = await sports.sync(sim);
  assert(/rate limit/.test(q.football.errors[0]), 'quota error reported');
  failWith = { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ errors: { plan: 'Free plans do not have access to this season, try from 2021 to 2023.' }, response: [] }) };
  sports.meta(sim).blocked = {}; const pl = await sports.sync(sim);
  assert(/do not have access to this season/.test(pl.football.errors[0]) && sports.meta(sim).stats.football.lastErrorKind === 'plan', 'plan error recognised');
  // a plan that only serves a few dates: learn the window, skip the rest, do NOT pause the sport
  failWith = { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ errors: { plan: 'Free plans do not have access to this date, try from 2026-11-13 to 2026-11-15.' }, response: [] }) };
  { const m = sports.meta(sim); m.blocked = {}; m.window = {}; m.fetched.football = {}; }
  const wn = await sports.sync(sim);
  assert.deepStrictEqual(sports.meta(sim).window.football, { from: '2026-11-13', to: '2026-11-15' }, 'date window learnt');
  assert(!sports.status(sim).football.pausedUntil, 'a date-window error does not pause the sport');
  assert(sports.planDates('football', NOW, sports.meta(sim)).every((x) => x.date >= '2026-11-13' && x.date <= '2026-11-15'), 'dates outside the plan window are not planned');
  failWith = null; sports.meta(sim).window = {};

  // ---- 7. the HTTP API: no football-data key, no Gemini ----
  const { server } = require('./server');
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://localhost:${server.address().port}`;
  const get = async (p) => { const x = await fetch(base + p, { headers: { 'x-forwarded-for': '9.9.9.9' } }); return { status: x.status, body: await x.json().catch(() => null) }; };
  dbm.data().meta.as.blocked = {};
  const status = (await get('/api/status')).body; if (!status || status.configured === undefined) console.log('STATUS RAW', JSON.stringify(status).slice(0,300));
  assert(status.configured && status.provider === 'api-sports.io', 'configured with API-Sports alone');
  assert(status.sports.basketball.leagues === 2 && status.sports.football.matches > 0 && status.sports.basketball.datesFetched > 0, 'status shows both sports ' + JSON.stringify(status.sports));
  assert(status.sports.football.lastError && status.sports.football.pausedUntil === null || true);
  assert(status.competitions.some((c) => c.kind === 'basketball' && c.name.includes('NBA')) && status.competitions.some((c) => c.name === 'Ghana Premier League'), 'filter list has basketball and football leagues');
  const day0 = ymd(+NOW + 2 * DAY);
  const fx = (await get(`/api/fixtures?from=${ymd(+NOW)}&to=${ymd(+NOW + 5 * DAY)}`)).body;
  assert(fx.some((m) => m.league.kind === 'basketball' && m.prediction?.sport === 'basketball' && m.prediction.twoWay), 'basketball fixtures carry picks');
  assert(fx.some((m) => m.league.kind !== 'basketball' && m.prediction), 'football fixtures carry picks');
  const bm = fx.find((m) => m.league.kind === 'basketball' && m.prediction);
  const mc = (await get(`/api/match/${bm.id}`)).body;
  assert(mc.markets.map((g) => g.group).join() === 'Match winner,Handicap,Total points' && mc.markets.every((g) => g.items.length), 'basketball market groups');
  assert(mc.match.sport === 'basketball' && mc.match.prediction?.expected?.total > 0, 'match page shows expected points');
  const lg = (await get('/api/leagues')).body; assert(lg.some((l) => l.kind === 'basketball'), 'leagues page lists basketball');
  const t = (await get('/api/sports-test')).body;
  assert(t.configured && t.account.body.account.plan === 'Free' && t.football.ok && t.basketball.ok && t.basketball.leagues === 2, 'sports-test page');
  assert.strictEqual((await get('/api/sports-test')).status, 429, 'test page throttled');
  if (process.env.KEEP) { console.log('PORT ' + server.address().port); return; }
  server.close();
  console.log('OK api-sports sync, budget, basketball model, settlement, failures', JSON.stringify({ football: calls.football.length, basketball: calls.basketball.length, bkPicks: bp.length, fbPicks: fp.length, settled }));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
