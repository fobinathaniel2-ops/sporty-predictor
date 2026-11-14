'use strict';
// Client for API-Sports (api-sports.io): football fixtures and basketball games, one request per calendar day for ALL leagues.
// Docs: https://www.api-football.com/documentation-v3 and https://api-sports.io/documentation/basketball/v1
// Everything is normalised into the same match shape the rest of the app uses. Nothing is invented: a field the API did not send stays null.

const BASE = { football: 'https://v3.football.api-sports.io', basketball: 'https://v1.basketball.api-sports.io' };

class ApiSportsError extends Error { constructor(msg, kind = 'error') { super(msg); this.kind = kind; } } // kind: key | plan | quota | error

const key = () => (process.env.API_SPORTS_KEY || process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY || '').trim();
const enabled = () => !!key();

/** One GET. Returns {rows, remaining, limit}. Throws ApiSportsError with a readable reason. */
async function call(sport, path, params = {}) {
  if (!enabled()) throw new ApiSportsError('API_SPORTS_KEY is not set', 'key');
  const url = `${BASE[sport]}${path}?${new URLSearchParams(params)}`;
  let r;
  try { r = await fetch(url, { headers: { 'x-apisports-key': key(), accept: 'application/json' }, signal: AbortSignal.timeout(Number(process.env.AS_TIMEOUT_MS || 15000)) }); }
  catch (e) { throw new ApiSportsError(`${sport} request failed: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`); }
  let j = null;
  try { j = await r.json(); } catch { /* handled below */ }
  const remaining = Number(r.headers.get('x-ratelimit-requests-remaining'));
  const limit = Number(r.headers.get('x-ratelimit-requests-limit'));
  if (r.status === 401 || r.status === 403) throw new ApiSportsError(`API-Sports refused the key (HTTP ${r.status})`, 'key');
  if (r.status === 429) throw new ApiSportsError('API-Sports rate limit reached (HTTP 429)', 'quota');
  if (!r.ok || !j) throw new ApiSportsError(`API-Sports HTTP ${r.status}`);
  const errs = j.errors && (Array.isArray(j.errors) ? j.errors : Object.entries(j.errors).map(([k, v]) => `${k}: ${v}`));
  if (errs && errs.length) {
    const msg = errs.map(String).join('; ').slice(0, 300);
    const kind = /token|key|subscription|account|suspend/i.test(msg) ? 'key' : /request|limit|quota/i.test(msg) ? 'quota' : /plan|season|access|free/i.test(msg) ? 'plan' : 'error';
    throw new ApiSportsError(`API-Sports: ${msg}`, kind);
  }
  return { rows: Array.isArray(j.response) ? j.response : [], remaining: Number.isFinite(remaining) ? remaining : null, limit: Number.isFinite(limit) ? limit : null };
}

const FOOTBALL_STATUS = { NS: 'SCHEDULED', TBD: 'SCHEDULED', '1H': 'LIVE', HT: 'LIVE', '2H': 'LIVE', ET: 'LIVE', BT: 'LIVE', P: 'LIVE', LIVE: 'LIVE', INT: 'LIVE', SUSP: 'OTHER',
  FT: 'FINISHED', AET: 'FINISHED', PEN: 'FINISHED', PST: 'OTHER', CANC: 'OTHER', ABD: 'OTHER', AWD: 'OTHER', WO: 'OTHER' };
const BASKET_STATUS = { NS: 'SCHEDULED', Q1: 'LIVE', Q2: 'LIVE', Q3: 'LIVE', Q4: 'LIVE', OT: 'LIVE', BT: 'LIVE', HT: 'LIVE', FT: 'FINISHED', AOT: 'FINISHED',
  POST: 'OTHER', CANC: 'OTHER', SUSP: 'OTHER', AWD: 'OTHER', ABD: 'OTHER' };

const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const iso = (v) => { const t = new Date(v); return v && !isNaN(t) ? t.toISOString() : null; };
const nm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** API-Football fixture -> {sport, league:{id,name,country,logo}, match}. Returns null for rows we cannot use. */
function normaliseFootball(f) {
  const id = f?.fixture?.id, date = iso(f?.fixture?.date);
  const h = f?.teams?.home, a = f?.teams?.away;
  if (!id || !date || !h?.id || !a?.id || !nm(h.name) || !nm(a.name) || !f?.league?.id) return null;
  const status = FOOTBALL_STATUS[f.fixture?.status?.short] || 'OTHER';
  const gh = int(f.goals?.home), ga = int(f.goals?.away);
  const hh = int(f.score?.halftime?.home), ha = int(f.score?.halftime?.away);
  return {
    sport: 'football',
    league: { id: f.league.id, name: nm(f.league.name), country: nm(f.league.country), logo: f.league.logo || null, season: f.league.season || null, round: nm(f.league.round) || null },
    match: {
      id: `af_${id}`, date, status, matchday: null, stage: nm(f.league.round) || null, season: Number(f.league.season) || new Date(date).getUTCFullYear(),
      home: { id: `af_t${h.id}`, name: nm(h.name), crest: h.logo || null }, away: { id: `af_t${a.id}`, name: nm(a.name), crest: a.logo || null },
      ft: status === 'FINISHED' && gh !== null && ga !== null ? [gh, ga] : null, ht: hh !== null && ha !== null ? [hh, ha] : null,
      minute: int(f.fixture?.status?.elapsed), ext: true, sport: 'football', apiStatus: f.fixture?.status?.short || null,
    },
  };
}

/** API-Basketball game -> same shape. Points are stored where football stores goals. */
function normaliseBasketball(g) {
  const id = g?.id, date = iso(g?.date) || (g?.timestamp ? new Date(g.timestamp * 1000).toISOString() : null);
  const h = g?.teams?.home, a = g?.teams?.away;
  if (!id || !date || !h?.id || !a?.id || !nm(h.name) || !nm(a.name) || !g?.league?.id) return null;
  const status = BASKET_STATUS[g.status?.short] || 'OTHER';
  const ph = int(g.scores?.home?.total), pa = int(g.scores?.away?.total);
  const q = (side) => [1, 2, 3, 4].map((n) => int(g.scores?.[side]?.[`quarter_${n}`]));
  const quarters = q('home').every((x) => x !== null) && q('away').every((x) => x !== null) ? { home: q('home'), away: q('away') } : null;
  return {
    sport: 'basketball',
    league: { id: g.league.id, name: nm(g.league.name), country: nm(g.country?.name), logo: g.league.logo || null, season: g.league.season || null, round: null },
    match: {
      id: `bk_${id}`, date, status, matchday: null, stage: nm(g.stage) || nm(g.week) || null, season: new Date(date).getUTCFullYear(),
      home: { id: `bk_t${h.id}`, name: nm(h.name), crest: h.logo || null }, away: { id: `bk_t${a.id}`, name: nm(a.name), crest: a.logo || null },
      ft: status === 'FINISHED' && ph !== null && pa !== null ? [ph, pa] : null, ht: null, quarters,
      ext: true, sport: 'basketball', apiStatus: g.status?.short || null,
    },
  };
}

/** All fixtures / games of one UTC calendar day (YYYY-MM-DD), every league. One request. */
async function day(sport, date) {
  const r = await call(sport, sport === 'football' ? '/fixtures' : '/games', { date, timezone: 'UTC' });
  const norm = sport === 'football' ? normaliseFootball : normaliseBasketball;
  const items = [], rejected = [];
  for (const row of r.rows) { const x = norm(row); if (x) items.push(x); else rejected.push(row?.fixture?.id || row?.id || '?'); }
  return { items, rejected: rejected.length, total: r.rows.length, remaining: r.remaining, limit: r.limit };
}

/** The account status endpoint: free to call (does not use the daily quota). Used by the test page. */
async function account() {
  const r = await fetch(`${BASE.football}/status`, { headers: { 'x-apisports-key': key() }, signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => null);
  return { http: r.status, body: j && (j.response && !Array.isArray(j.response) ? { account: { firstname: undefined, plan: j.response.subscription?.plan, active: j.response.subscription?.active, end: j.response.subscription?.end }, requests: j.response.requests } : j) };
}

module.exports = { enabled, call, day, account, normaliseFootball, normaliseBasketball, ApiSportsError, BASE };
