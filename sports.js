'use strict';
// API-Sports sync: football and basketball matches for ALL leagues the plan returns, one request per calendar day per sport.
// Works without FOOTBALL_DATA_KEY. Every request is counted against a daily budget so the free plan (100 requests a day per sport) is never exceeded.

const dbm = require('./db');
const engine = require('./engine');
const bk = require('./basketball');
const comps = require('./competitions');
const api = require('./apisports');

const DAY = 86400000, HOUR = 3600000;
const SPORTS = ['football', 'basketball'];
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
const cfg = () => ({
  ahead: Math.min(10, num('AS_DAYS_AHEAD', 5)), back: Math.min(60, num('AS_BACKFILL_DAYS', 30)), perRun: Math.max(1, num('AS_PER_RUN', 4)),
  cap: num('AS_DAILY_CAP', 90), todayMin: num('AS_TODAY_MIN', 30), tomorrowH: num('AS_TOMORROW_HOURS', 3), laterH: num('AS_LATER_HOURS', 6),
  scope: String(process.env.AS_FOOTBALL_SCOPE || 'listed').toLowerCase() === 'all' ? 'all' : 'listed',
  basketball: process.env.AS_BASKETBALL !== '0', football: process.env.AS_FOOTBALL !== '0',
});

const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (s) => new Date(`${s}T00:00:00Z`).getTime();

/** Bookkeeping kept in db.meta.as: requests used today, when each date was last fetched, last success / failure. */
function meta(now = new Date()) {
  const m = dbm.data().meta;
  const today = ymd(now);
  if (!m.as) m.as = {};
  const a = m.as;
  if (a.day !== today) { a.day = today; a.used = { football: 0, basketball: 0 }; a.blocked = {}; } // a new UTC day: fresh budget
  a.used = a.used || { football: 0, basketball: 0 }; a.blocked = a.blocked || {};
  a.fetched = a.fetched || { football: {}, basketball: {} };
  a.stats = a.stats || { football: {}, basketball: {} };
  return a;
}

/**
 * Which dates to fetch now, most important first. Pure function (tested):
 *   today (every todayMin) > yesterday until final > tomorrow > later days > older days (history for the models).
 * A past date is "final" once it was fetched at least 3 hours after that day ended.
 */
function planDates(sport, now, a, c = cfg()) {
  const fetched = a.fetched[sport] || {};
  const today = ymd(now);
  const out = [];
  const age = (d) => (fetched[d] ? now - new Date(fetched[d].at) : Infinity);
  const final = (d) => fetched[d] && new Date(fetched[d].at) >= dayStart(d) + DAY + 3 * HOUR;
  const add = (offset, prio, ok) => { const d = ymd(dayStart(today) + offset * DAY); if (ok(d)) out.push({ date: d, prio: prio + (offset > 0 ? offset : -offset) / 100 }); };
  add(0, 0, (d) => age(d) > c.todayMin * 60000);
  add(-1, 1, (d) => !final(d));
  add(1, 2, (d) => age(d) > c.tomorrowH * HOUR);
  for (let i = 2; i <= c.ahead; i++) add(i, 3, (d) => age(d) > c.laterH * HOUR);
  for (let i = 2; i <= c.back; i++) add(-i, 4, (d) => !final(d) && !fetched[d]); // history: fetched once, newest first
  return out.sort((x, y) => x.prio - y.prio);
}

/** Where each national competition on the list is played. API-Sports names are not unique ("League Cup" exists in many countries). */
const WHERE = {
  'English Premier League': /^england$/i, 'English Championship': /^england$/i, 'FA Cup': /^england$/i, 'EFL Cup (Carabao Cup)': /^england$/i,
  'Spanish La Liga': /^spain$/i, 'Copa del Rey': /^spain$/i, 'Italian Serie A': /^italy$/i, 'Coppa Italia': /^italy$/i,
  'German Bundesliga': /^germany$/i, 'DFB-Pokal': /^germany$/i, 'French Ligue 1': /^france$/i, 'Coupe de France': /^france$/i,
  'Portuguese Primeira Liga': /^portugal$/i, 'Dutch Eredivisie': /^netherlands$/i, 'KNVB Cup': /^netherlands$/i, 'Belgian Pro League': /^belgium$/i,
  'Scottish Premiership': /^scotland$/i, 'Ghana Premier League': /^ghana$/i, 'Nigeria Premier Football League': /^nigeria$/i,
  'South African Premiership': /^south-?africa$/i, 'Egyptian Premier League': /^egypt$/i, 'Moroccan Botola Pro': /^morocco$/i,
  'Saudi Pro League': /^saudi-?arabia$/i, 'Major League Soccer (MLS)': /^(usa|united-?states)$/i, 'Brazilian Série A': /^brazil$/i, 'Argentine Primera División': /^argentina$/i,
};
const INTERNATIONAL = /^(world|europe|africa|asia|south-?america|north-america|central-america|oceania|international)$/i;
/** The list entry for an API-Sports league, or null when the name matches but the country does not. */
function listed(name, country) {
  const canon = comps.canonical(name, country);
  const entry = canon && (canon.name ? canon : comps.LIST.find((c) => c.name === canon));
  if (!entry) return null;
  const ok = WHERE[entry.name] ? WHERE[entry.name].test(String(country || '').trim()) : INTERNATIONAL.test(String(country || '').trim());
  return ok ? entry.name : null;
}

/** League for a fetched row, or null when this app should not keep it. */
function leagueFor(item, c, d) {
  const L = item.league;
  if (item.sport === 'football') {
    const canonName = listed(L.name, L.country);
    if (c.scope === 'listed' && !canonName) return { skip: 'not on the competition list' };
    const name = canonName || (L.country && !/^world$/i.test(L.country) ? `${L.name} (${L.country})` : L.name);
    // competitions the football-data.org feed already covers are left to it, so nothing appears twice
    const covered = Object.values(d.leagues).some((x) => !x.ext && !x.web && !x.demo && x.name === name);
    if (covered) return { skip: 'already covered by football-data.org' };
    return { code: `AF_${L.id}`, name, country: L.country, kind: 'football' };
  }
  const name = L.country && !/^world$/i.test(L.country) && !L.name.includes(L.country) ? `${L.name} (${L.country})` : L.name;
  return { code: `BK_${L.id}`, name, country: L.country, kind: 'basketball' };
}

/** Stores the fetched rows. Returns counts. Existing predictions are never touched here. */
function ingest(items, now, c = cfg()) {
  const d = dbm.data();
  const n = { added: 0, updated: 0, skipped: 0, leagues: 0 };
  for (const it of items) {
    const lg = leagueFor(it, c, d);
    if (lg.skip) { n.skipped++; continue; }
    if (!d.leagues[lg.code]) n.leagues++;
    d.leagues[lg.code] = { ...(d.leagues[lg.code] || {}), code: lg.code, name: lg.name, country: lg.country || '', emblem: it.league.logo, web: true, ext: true, sport: lg.kind, apiId: it.league.id };
    for (const t of [it.match.home, it.match.away]) d.teams[t.id] = { ...(d.teams[t.id] || {}), id: t.id, name: t.name, crest: t.crest };
    const prev = d.matches[it.match.id];
    if (prev) n.updated++; else n.added++;
    d.matches[it.match.id] = { ...(prev || {}), ...it.match, league: lg.code };
  }
  return n;
}

/** Drops old stored games and the picks that belonged to them (history older than 40 days is not used). */
function prune(now) {
  const d = dbm.data(), cut = +now - 40 * DAY;
  for (const [id, m] of Object.entries(d.matches)) if (m.ext && new Date(m.date) < cut) { delete d.matches[id]; delete d.predictions[id]; }
  for (const [code, l] of Object.entries(d.leagues)) if (l.ext && !Object.values(d.matches).some((m) => m.league === code)) delete d.leagues[code];
}

/**
 * One sync run. timeLeft(): milliseconds left in this run. Returns what happened per sport.
 * A failure stops that sport for a while (key problem 30 min, plan problem 60 min, daily quota until tomorrow, other 5 min).
 */
async function sync(now = new Date(), { timeLeft = () => Infinity } = {}) {
  const c = cfg();
  const out = { enabled: api.enabled() };
  if (!api.enabled()) return out;
  const a = meta(now);
  for (const sport of SPORTS) {
    if (!c[sport]) continue;
    const st = a.stats[sport];
    const res = out[sport] = { fetched: 0, rows: 0, added: 0, updated: 0, skipped: 0, rejected: 0, errors: [] };
    const blockedUntil = a.blocked[sport];
    if (blockedUntil && now < new Date(blockedUntil)) { res.blocked = `paused until ${blockedUntil}: ${st.lastError || ''}`; continue; }
    const plan = planDates(sport, now, a, c);
    for (const { date } of plan.slice(0, c.perRun)) {
      if (a.used[sport] >= c.cap) { res.errors.push(`daily budget of ${c.cap} requests reached`); break; }
      if (timeLeft() < 8000) break;
      const t0 = Date.now();
      try {
        a.used[sport]++; // counted before the call: a failed call may still use quota
        const r = await api.day(sport, date);
        const k = ingest(r.items, now, c);
        a.fetched[sport][date] = { at: now.toISOString(), rows: r.total };
        res.fetched++; res.rows += r.total; res.rejected += r.rejected; res.added += k.added; res.updated += k.updated; res.skipped += k.skipped;
        Object.assign(st, { lastOkAt: now.toISOString(), lastDurationMs: Date.now() - t0, remaining: r.remaining, limit: r.limit, lastRows: r.total, lastKept: k.added + k.updated });
        if (r.remaining !== null && r.remaining <= 2) { a.blocked[sport] = new Date(+now + HOUR).toISOString(); st.lastError = 'API-Sports daily quota nearly used up'; break; }
      } catch (e) {
        const mins = e.kind === 'key' ? 30 : e.kind === 'plan' ? 60 : e.kind === 'quota' ? Math.ceil((dayStart(ymd(+now + DAY)) - now) / 60000) : 5;
        a.blocked[sport] = new Date(+now + mins * 60000).toISOString();
        Object.assign(st, { lastErrorAt: now.toISOString(), lastError: e.message, lastErrorKind: e.kind || 'error' });
        res.errors.push(e.message);
        dbm.log('warn', 'sports', `${sport} ${date}: ${e.message}`);
        break;
      }
    }
    if (res.fetched) dbm.log('info', 'sports', `${sport}: ${res.fetched} day(s), ${res.rows} rows, ${res.added} new, ${res.skipped} skipped`);
  }
  prune(now);
  dbm.save();
  return out;
}

/* ------------------------------------------------------------------------------------------------ predictions ------ */

const round3 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

function upsertBasketball(m, pr, now) {
  const d = dbm.data(), prev = d.predictions[m.id];
  const home = m.home.name, away = m.away.name;
  const sb = bk.statsBest(pr.pm, home, away), sh = bk.statsHigh(pr.pm, home, away);
  let best = { ...sb, source: 'stats', reason: 'Most probable market from team scoring averages.' };
  let high = sh ? { ...sh, source: 'stats', reason: 'Most probable pick that still pays higher odds, from team scoring averages.' } : null;
  if (prev?.best?.source === 'ai' && pr.pm[prev.best.id] !== undefined) best = { ...prev.best, p: pr.pm[prev.best.id], odds: bk.fairOdds(pr.pm[prev.best.id]) };
  if (prev?.high?.source === 'ai' && pr.pm[prev.high.id] !== undefined) high = { ...prev.high, p: pr.pm[prev.high.id], odds: bk.fairOdds(pr.pm[prev.high.id]) };
  const played = Math.min(pr.played.home, pr.played.away);
  d.predictions[m.id] = {
    matchId: m.id, league: m.league, kickoff: m.date, modelVersion: 'bk-1', sport: 'basketball',
    generatedAt: prev?.generatedAt || now.toISOString(), updatedAt: now.toISOString(),
    pm: pr.pm, lh: pr.hp, la: pr.ap, topScores: [], expected: { home: pr.hp, away: pr.ap, margin: pr.mu, total: pr.total },
    context: { elo: { home: null, away: null }, form: pr.form, h2h: { meetings: 0, avgGoalDiff: null }, played: pr.played },
    confidence: best.p >= 0.7 && played >= 8 ? 'High' : best.p >= 0.58 && played >= 4 ? 'Medium' : 'Low',
    best, statsBest: sb, high, statsHigh: sh, aiTries: prev?.aiTries || 0, locked: false, settled: false,
  };
}

/** Pre-match picks for stored API-Sports games. upsertFootball(m, prediction, now) is the pipeline's own writer. */
function predict(now, upsertFootball) {
  const d = dbm.data(), c = cfg();
  const horizon = (c.ahead + 1) * DAY;
  const stats = { football: 0, basketball: 0, skipped: 0 };
  const ext = Object.values(d.matches).filter((m) => m.ext);

  // football: one pooled model over every stored finished API-Sports match (leagues are too small on their own)
  const fin = ext.filter((m) => m.sport === 'football' && m.status === 'FINISHED' && m.ft);
  const fm = engine.buildModel(fin, now);
  // basketball: one model per league
  const bmodels = {};
  for (const m of ext) {
    const kick = new Date(m.date), ex = d.predictions[m.id];
    if (m.status !== 'SCHEDULED') continue;
    if (kick <= now) { if (ex && !ex.settled) ex.locked = true; continue; }
    if (ex?.locked || kick - now > horizon) continue;
    try {
      if (m.sport === 'basketball') {
        if (!(m.league in bmodels)) bmodels[m.league] = bk.buildModel(ext.filter((x) => x.league === m.league && x.status === 'FINISHED' && x.ft), now);
        const mod = bmodels[m.league];
        if (!mod.ok) { stats.skipped++; continue; }
        upsertBasketball(m, bk.predict(mod, m.home.id, m.away.id), now); stats.basketball++;
      } else {
        if (!fm.ok) { stats.skipped++; continue; }
        upsertFootball(m, engine.predict(fm, m.home.id, m.away.id), now); stats.football++;
      }
    } catch (e) { stats.skipped++; dbm.log('warn', 'sports', `prediction for ${m.id}: ${e.message}`); }
  }
  if (!fm.ok && ext.some((m) => m.sport === 'football')) stats.footballModel = fm.reason;
  return stats;
}

/** Numbers for /api/status. */
function status(now = new Date()) {
  const d = dbm.data(), a = meta(now), c = cfg();
  const count = (sport, f) => Object.values(d.matches).filter((m) => m.ext && m.sport === sport && f(m)).length;
  const per = (sport) => ({
    enabled: c[sport], used: a.used[sport] || 0, cap: c.cap, remaining: a.stats[sport]?.remaining ?? null, limit: a.stats[sport]?.limit ?? null,
    lastOkAt: a.stats[sport]?.lastOkAt || null, lastErrorAt: a.stats[sport]?.lastErrorAt || null, lastError: a.stats[sport]?.lastError || null,
    pausedUntil: a.blocked[sport] && new Date(a.blocked[sport]) > now ? a.blocked[sport] : null,
    leagues: Object.values(d.leagues).filter((l) => l.ext && l.sport === sport).length,
    matches: count(sport, () => true), upcoming: count(sport, (m) => m.status === 'SCHEDULED' && new Date(m.date) > now), finished: count(sport, (m) => m.status === 'FINISHED'),
    datesFetched: Object.keys(a.fetched[sport] || {}).length,
  });
  return { configured: api.enabled(), scope: c.scope, football: per('football'), basketball: per('basketball') };
}

module.exports = { listed, sync, predict, planDates, ingest, leagueFor, status, meta, cfg, prune, SPORTS };
