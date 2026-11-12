'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const dbm = require('./db');
const pipeline = require('./pipeline');
const accuracy = require('./accuracy');
const ai = require('./ai');
const engine = require('./engine');
const stats = require('./stats');
const comps = require('./competitions');
const analysisMod = require('./analysis');
const notify = require('./notify');

dbm.load();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DAY = 86400000, HOUR = 3600000;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const d = () => dbm.data();
const active = () => [...pipeline.leagueCodes(), ...pipeline.webCodes()];
const isWeb = (code) => !!d().leagues[code]?.web;

/* ----------------------------------------------------------------------------------------------------- views ------- */

const crestOf = (t) => t.crest || d().teams[t.id]?.crest || null;
const teamView = (t) => ({ id: t.id, name: t.name, crest: crestOf(t) });
const KIND_CUP = /Cup|Pokal|Copa|Coppa|Coupe|UEFA|FIFA|CAF |AFC |CONCACAF|Nations|Champions League|Libertadores|Sudamericana|AFCON|Euro/;
const leagueView = (code) => {
  const l = d().leagues[code]; const name = l?.name || code; const i = comps.NAMES.indexOf(name);
  return { code, name, country: l?.country || '', emblem: l?.emblem || null, demo: !!l?.demo, web: !!l?.web, order: i < 0 ? 999 : i, kind: l?.esports ? 'esports' : KIND_CUP.test(name) && !/Premier League|Pro League|Primeira|Premiership/.test(name) ? 'cup' : 'league' };
};

function predView(p, full) {
  if (!p) return null;
  const o = {
    best: p.best, high: p.high || null, statsBest: p.statsBest && { id: p.statsBest.id, label: p.statsBest.label, p: p.statsBest.p, correct: p.statsBest.correct },
    confidence: p.confidence, locked: p.locked, settled: p.settled, void: !!p.void,
    probs: p.pm['1'] !== undefined && p.pm.X !== undefined ? { home: p.pm['1'], draw: p.pm.X, away: p.pm['2'] } : null, hasNotes: !!p.research?.notes?.length,
    kind: p.late ? 'live' : p.esports ? 'esports' : p.web ? 'web' : 'pre', inplay: p.inplay || null, webNote: p.webNote || null, liveAt: p.liveAt || null,
  };
  if (full) {
    Object.assign(o, { xg: { home: p.lh, away: p.la }, topScores: p.topScores, context: p.context, generatedAt: p.generatedAt, modelVersion: p.modelVersion, research: p.research || null, actual: p.actual || null });
  }
  return o;
}

function matchView(m, full) {
  const p = d().predictions[m.id];
  return {
    id: m.id, league: leagueView(m.league), date: m.date, status: m.status, matchday: m.matchday, stage: m.stage,
    home: teamView(m.home), away: teamView(m.away), ft: m.ft, ht: m.ht, live: m.live, minute: m.minute,
    prediction: predView(p, full),
  };
}

const byDate = (a, b) => new Date(a.date) - new Date(b.date);
const inCodes = (m) => active().includes(m.league);

/* --------------------------------------------------------------------------------------------------- guards -------- */

const hits = new Map();
function limit(req, key, max, windowMs) {
  const ip = (process.env.VERCEL && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'x';
  const k = `${key}:${ip}`; const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Too many requests. Please wait a moment.');
  arr.push(now); hits.set(k, arr);
  if (hits.size > 5000) for (const [kk, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(kk);
}

/* --------------------------------------------------------------------------------------------------- routes -------- */

const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

/** Every competition on the list (feed, web-found and eFootball), even those with no matches yet, so the filters always show them. */
function competitionList() {
  const dd = d(); const have = new Map(); const out = [];
  for (const c of active()) if (dd.leagues[c]) { const v = leagueView(c); have.set(v.name, true); out.push({ ...v, matches: Object.values(dd.matches).filter((m) => m.league === c).length }); }
  comps.LIST.forEach((c, i) => { if (!have.has(c.name)) out.push({ code: comps.webCode(c.name), name: c.name, country: '', emblem: null, demo: false, web: true, order: i, kind: KIND_CUP.test(c.name) && !/Premier League|Pro League|Primeira|Premiership/.test(c.name) ? 'cup' : 'league', matches: 0 }); });
  comps.ESPORTS.forEach((n, i) => { if (!have.has(n)) out.push({ code: comps.esCode(n), name: n, country: 'eSports', emblem: null, demo: false, web: true, order: 1000 + i, kind: 'esports', matches: 0 }); });
  return out.map((x) => (x.kind === 'esports' && x.order < 1000 ? { ...x, order: 1000 + x.order } : x)).sort((a, b) => a.order - b.order);
}
route('GET', /^\/api\/status$/, () => {
  const dd = d(); const codes = active(); const st = pipeline.state(); const prov = pipeline.provider();
  const live = Object.values(dd.matches).filter((m) => m.status === 'LIVE' && codes.includes(m.league)).length;
  return {
    configured: !!prov, provider: prov?.name || null, demo: pipeline.isDemo(),
    ai: { enabled: ai.enabled(), provider: 'Gemini', model: ai.enabled() ? ai.model() : null, usage: ai.enabled() ? ai.usage() : null },
    leagues: codes.filter((c) => dd.leagues[c]).map((c) => leagueView(c)).sort((a, b) => a.order - b.order),
    competitions: competitionList(),
    lastRun: dd.meta.lastRun || null, running: st.running, nextRunAt: st.nextRunAt,
    counts: {
      live, upcoming: Object.values(dd.matches).filter((m) => m.status === 'SCHEDULED' && codes.includes(m.league)).length,
      predictions: Object.keys(dd.predictions).length, verified: Object.values(dd.predictions).filter((p) => p.settled && !p.void).length,
    },
    lastError: dd.apiLogs.find((l) => l.level === 'error')?.message || null,
    push: !!notify.vapidPublic(),
    web: { competitions: Object.values(dd.leagues).filter((l) => l.web).length, matches: Object.values(dd.matches).filter((m) => m.web).length, lastFullRound: dd.meta.webAt || null, nextGroup: dd.meta.webCursor || 0 },
    recent: dd.apiLogs.filter((l) => l.level !== 'info' || l.source === 'ai-web').slice(0, 6).map((l) => `${l.at.slice(11, 16)} ${l.source}: ${l.message}`),
  };
});

function range(q) {
  const from = new Date(q.from), to = new Date(q.to);
  if (isNaN(from) || isNaN(to) || to <= from) throw new HttpError(400, 'from and to must be ISO dates, with to after from');
  if (to - from > 15 * DAY) throw new HttpError(400, 'Range too large (max 15 days)');
  return { from, to };
}

/** Matches (any status) kicking off between ?from and ?to, optionally for one competition. */
route('GET', /^\/api\/fixtures$/, (req, res, p, q) => {
  const { from, to } = range(q);
  return Object.values(d().matches)
    .filter((m) => inCodes(m) && (!q.league || m.league === q.league) && new Date(m.date) >= from && new Date(m.date) < to)
    .sort(byDate).map((m) => matchView(m));
});

route('GET', /^\/api\/live$/, () => Object.values(d().matches).filter((m) => m.status === 'LIVE' && inCodes(m)).sort(byDate).map((m) => matchView(m)));

route('GET', /^\/api\/results$/, (req, res, p, q) => {
  const n = Math.min(Number(q.limit) || 40, 300);
  return Object.values(d().matches).filter((m) => inCodes(m) && m.status === 'FINISHED' && (!q.league || m.league === q.league) && (!q.picks || d().predictions[m.id]))
    .sort(byDate).reverse().slice(0, n).map((m) => matchView(m));
});

route('GET', /^\/api\/dashboard$/, (req, res, p, q) => {
  const { from, to } = range(q);
  const codes = active(); const dd = d();
  const all = Object.values(dd.matches).filter(inCodes);
  const now = Date.now();
  const picks = Object.values(dd.predictions)
    .filter((x) => !x.settled && !x.locked && new Date(x.kickoff) > now && new Date(x.kickoff) - now < 2 * DAY && dd.matches[x.matchId] && x.confidence !== 'Low')
    .sort((a, b) => b.best.p - a.best.p).slice(0, 6).map((x) => matchView(dd.matches[x.matchId]));
  const featured = [];
  for (const c of codes) for (const r of (dd.statistics[c]?.ratings || []).slice(0, 2)) if (dd.teams[r.id]) featured.push({ ...teamView(dd.teams[r.id]), elo: r.elo, league: c });
  return {
    live: all.filter((m) => m.status === 'LIVE').sort(byDate).map((m) => matchView(m)),
    today: all.filter((m) => new Date(m.date) >= from && new Date(m.date) < to).sort(byDate).map((m) => matchView(m)),
    recent: all.filter((m) => m.status === 'FINISHED').sort(byDate).reverse().slice(0, 8).map((m) => matchView(m)),
    picks, featured: featured.sort((a, b) => b.elo - a.elo).slice(0, 8),
  };
});

route('GET', /^\/api\/leagues$/, () => {
  const now = Date.now(); const dd = d();
  return active().filter((c) => dd.leagues[c]).map((c) => {
    const ms = Object.values(dd.matches).filter((m) => m.league === c);
    const ids = new Set(); ms.forEach((m) => { ids.add(m.home.id); ids.add(m.away.id); });
    return { ...leagueView(c), teams: ids.size, live: ms.filter((m) => m.status === 'LIVE').length,
      next7: ms.filter((m) => m.status === 'SCHEDULED' && new Date(m.date) > now && new Date(m.date) - now < 7 * DAY).length };
  });
});

/** Standings: provider table when available, otherwise computed from the stored results. */
async function standingsFor(code) {
  if (pipeline.provider() && !pipeline.isDemo() && !isWeb(code)) {
    try { const r = await pipeline.remote.standings(code); return { ...r.value, stale: r.stale, source: 'provider' }; } catch (e) { /* fall back below */ }
  }
  return { ...stats.standingsFromResults(d(), code), source: 'computed' };
}

route('GET', /^\/api\/league\/([\w]+)$/, async (req, res, [code]) => {
  if (!active().includes(code) || !d().leagues[code]) throw new HttpError(404, 'Competition not found');
  const ms = Object.values(d().matches).filter((m) => m.league === code);
  const now = Date.now();
  let scorers = [], scorersNote = null;
  if (isWeb(code)) scorersNote = 'Player statistics are not available for competitions found by web search.';
  else if (pipeline.provider() && !pipeline.isDemo()) {
    try { scorers = (await pipeline.remote.scorers(code)).value; } catch (e) { scorersNote = e.message; }
  } else scorersNote = 'Top scorers are not available for the demo league.';
  return {
    league: leagueView(code), standings: await standingsFor(code), scorers, scorersNote,
    results: ms.filter((m) => m.status === 'FINISHED').sort(byDate).reverse().slice(0, 20).map((m) => matchView(m)),
    fixtures: ms.filter((m) => m.status !== 'FINISHED' && new Date(m.date) > now - 3 * HOUR).sort(byDate).slice(0, 20).map((m) => matchView(m)),
    teamStats: stats.leagueStats(d(), code).teams.map((t) => ({ ...t, team: teamView(t.team) })),
  };
});

route('GET', /^\/api\/stats\/([\w]+)$/, async (req, res, [code]) => {
  if (!active().includes(code) || !d().leagues[code]) throw new HttpError(404, 'Competition not found');
  const ls = stats.leagueStats(d(), code);
  const tv = (rows) => rows.map((r) => ({ ...r, team: teamView(r.team) }));
  let scorers = [], note = null;
  if (pipeline.provider() && !pipeline.isDemo() && !isWeb(code)) { try { scorers = (await pipeline.remote.scorers(code)).value; } catch (e) { note = e.message; } } else note = 'Player statistics are not available for the demo league.';
  const assists = scorers.filter((s) => s.assists !== null).sort((a, b) => b.assists - a.assists).slice(0, 10);
  return {
    league: leagueView(code), season: ls.season, matches: ls.matches, summary: ls.summary,
    topScorers: scorers.slice(0, 10), topAssists: assists, playerNote: note,
    cleanSheets: tv(ls.cleanSheets), goalsPerMatch: tv(ls.goalsPerMatch), bestAttack: tv(ls.bestAttack), bestDefence: tv(ls.bestDefence), form: tv(ls.form),
    homeAway: ls.homeAway.map((r) => ({ ...r, team: teamView(r.team) })),
  };
});

route('GET', /^\/api\/teams$/, (req, res, p, q) => {
  const codes = q.league ? [q.league] : active();
  const out = new Map();
  for (const c of codes) {
    const { matches } = stats.leagueSeason(d(), c);
    const elo = Object.fromEntries((d().statistics[c]?.ratings || []).map((r) => [r.id, r.elo]));
    for (const m of matches) for (const side of ['home', 'away']) {
      const t = m[side]; if (!out.has(t.id)) out.set(t.id, { ...teamView(t), league: c, elo: elo[t.id] ?? null });
    }
  }
  return [...out.values()].sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0));
});

async function positionIn(code, teamId) {
  const cachedTable = dbm.cache.getStale(`standings:${code}`);
  const st = cachedTable || stats.standingsFromResults(d(), code);
  for (const g of st.groups || []) { const row = g.table.find((r) => r.team.id === teamId); if (row) return { code, name: leagueView(code).name, group: g.name, position: row.position, points: row.points, played: row.played }; }
  return null;
}

route('GET', /^\/api\/team\/([\w-]+)$/, async (req, res, [id]) => {
  const known = d().teams[id];
  if (!known) throw new HttpError(404, 'Team not found');
  let info = null, infoNote = null;
  if (pipeline.provider() && !pipeline.isDemo() && /^\d+$/.test(String(id))) { try { info = (await pipeline.remote.team(id)).value; } catch (e) { infoNote = e.message; } }
  const rec = stats.teamRecord(d(), id);
  const positions = [];
  for (const c of rec.leagues.filter((x) => active().includes(x))) { const pos = await positionIn(c, id); if (pos) positions.push(pos); }
  const elo = active().map((c) => d().statistics[c]?.ratings?.find((r) => r.id === id)?.elo).find((x) => x !== undefined) ?? null;
  const rows = (rs) => rs.map((r) => ({ ...r, opp: teamView(r.opp) }));
  return {
    team: { id, name: known.name, crest: crestOf(known), ...(info || {}), crest2: undefined }, infoNote, elo, positions,
    record: { season: rec.season, total: rec.total, home: rec.home, away: rec.away, seasons: rec.seasons, form: rec.form, formPpg: rec.formPpg },
    recent: rows(rec.recent), upcoming: rec.upcoming.map((m) => matchView(m)), squad: info?.squad || [],
  };
});

route('GET', /^\/api\/match\/([\w-]+)$/, async (req, res, [id]) => {
  const m = d().matches[id];
  if (!m) throw new HttpError(404, 'Match not found');
  const p = d().predictions[id];
  let detail = null, detailNote = null, stale = false;
  const near = m.status === 'LIVE' || m.status === 'FINISHED' || new Date(m.date) - Date.now() < 2 * HOUR;
  if (!pipeline.provider()) detailNote = 'No data source configured.';
  else if (!near) detailNote = 'Lineups, events and match statistics appear on match day.';
  else {
    try { const r = await pipeline.remote.detail(m); detail = r.value; stale = r.stale; } catch (e) { detailNote = `Match details unavailable: ${e.message}`; }
  }
  const an = analysisMod.analyse(d(), m, p);
  const groups = p ? engine.GROUP_ORDER.map((g) => ({
    group: g, items: Object.entries(p.pm).filter(([k]) => engine.groupOf(k) === g).map(([k, v]) => ({ id: k, p: v, about: engine.explain(k, m.home.name, m.away.name) })).sort((a, b) => b.p - a.p),
  })) : [];
  const rec = (t) => stats.teamRecord(d(), t.id);
  const rh = rec(m.home), ra = rec(m.away);
  const pos = async (t) => (await positionIn(m.league, t.id));
  return {
    match: { ...matchView(m, true), web: !!m.web, resultSource: m.resultSource || null, sources: m.sources || null, venue: detail?.venue || null, referee: detail?.referee || null },
    detail, detailNote, stale, markets: groups,
    form: { home: { form: rh.form, recent: rh.recent.map((r) => ({ ...r, opp: teamView(r.opp) })), home: rh.home, away: rh.away }, away: { form: ra.form, recent: ra.recent.map((r) => ({ ...r, opp: teamView(r.opp) })), home: ra.home, away: ra.away } },
    standings: { home: await pos(m.home), away: await pos(m.away) },
    analysis: an,
  };
});

function aiFacts(m, p, an) {
  const top = p ? Object.fromEntries(Object.entries(p.pm).filter(([k]) => !/^[12X]\/[12X]$/.test(k)).map(([k, v]) => [k, +v.toFixed(3)])) : null;
  return {
    match: `${m.home.name} (home) vs ${m.away.name} (away)`, competition: d().leagues[m.league]?.name || m.league,
    probabilities: top, expected_goals: p && p.lh != null ? { home: +p.lh.toFixed(2), away: +p.la.toFixed(2) } : null,
    factors: an.factors.map((f) => ({ factor: f.label, home: f.home, away: f.away, edge: f.edge })),
    home_team: { name: m.home.name, form_last5: an.home.form, season_record: an.home.record, strengths: an.home.strengths, weaknesses: an.home.weaknesses },
    away_team: { name: m.away.name, form_last5: an.away.form, season_record: an.away.record, strengths: an.away.strengths, weaknesses: an.away.weaknesses },
    head_to_head: { meetings: an.h2h.meetings, home_team_wins: an.h2h.aWins, draws: an.h2h.draws, away_team_wins: an.h2h.bWins },
    web_notes_unverified: p?.research?.notes || [], known_uncertainties: an.uncertainty.reasons,
  };
}

route('GET', /^\/api\/analysis\/([\w-]+)$/, async (req, res, [id], q) => {
  const m = d().matches[id];
  if (!m) throw new HttpError(404, 'Match not found');
  const p = d().predictions[id];
  const an = analysisMod.analyse(d(), m, p);
  let aiPart = null, aiNote = null;
  if (q.ai === '1') {
    if (!ai.enabled()) aiNote = 'AI narrative is off. Set GEMINI_API_KEY to enable it.';
    else {
      try {
        limit(req, 'ai', 12, HOUR);
        const r = await pipeline.cached(`ai:analysis:${id}:${p?.updatedAt || m.status}`, 6 * HOUR, () => ai.analyse(aiFacts(m, p, an)));
        aiPart = r.value;
      } catch (e) { aiNote = e.message; }
    }
  }
  return { ...an, ai: aiPart, aiNote, aiModel: ai.enabled() ? ai.model() : null };
});

route('GET', /^\/api\/analyst$/, () => {
  const now = Date.now(); const dd = d();
  const list = Object.values(dd.predictions)
    .filter((x) => !x.settled && !x.locked && new Date(x.kickoff) > now && dd.matches[x.matchId] && active().includes(x.league))
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)).slice(0, 80)
    .map((x) => matchView(dd.matches[x.matchId]));
  return { picks: list };
});

route('GET', /^\/api\/search$/, (req, res, p, q) => {
  const r = stats.search(d(), String(q.q || ''), active());
  return { teams: r.teams.map((t) => ({ ...teamView(t), league: t.league })), leagues: r.leagues.map((l) => leagueView(l.code)), fixtures: r.fixtures.map((m) => matchView(m)) };
});

route('GET', /^\/api\/news$/, async (req) => {
  if (!ai.enabled()) return { enabled: false, items: [], sources: [] };
  limit(req, 'news', 20, HOUR);
  const names = active().map((c) => d().leagues[c]?.name).filter(Boolean).slice(0, 8);
  if (!names.length) return { enabled: true, items: [], sources: [] };
  try {
    if (dbm.mode() === 'remote') { // hosted: a web request may not wait for a slow Gemini search; the scheduler prepares the news
      const v = dbm.cache.getStale('news');
      return v ? { enabled: true, ...v, stale: dbm.cache.get('news') === undefined } : { enabled: true, items: [], sources: [], error: 'The news is being prepared and appears within a few minutes.' };
    }
    const r = await pipeline.cached('news', 3 * HOUR, async () => ({ ...(await ai.news(names)), at: new Date().toISOString() }));
    return { enabled: true, ...r.value, stale: r.stale };
  } catch (e) { return { enabled: true, items: [], sources: [], error: e.message }; }
});

route('GET', /^\/api\/accuracy$/, () => accuracy.compute(d(), { includeDemo: pipeline.isDemo() }));

/* ----------------------------------------------------------------------------------------------- preferences ------- */

const CLIENT = /^[a-f0-9]{24,48}$/;
const clientId = (req) => { const id = String(req.headers['x-client-id'] || ''); if (!CLIENT.test(id)) throw new HttpError(400, 'Missing or invalid client id'); return id; };
const list = (v, n, re) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => re.test(x)))].slice(0, n) : []);
function cleanPrefs(b = {}) {
  return {
    favTeams: list(b.favTeams, 40, /^[\w-]{1,24}$/), favLeagues: list(b.favLeagues, 20, /^[A-Z0-9]{2,6}$/),
    dataSaver: !!b.dataSaver, reduceMotion: !!b.reduceMotion, timeFormat: b.timeFormat === '12h' ? '12h' : '24h',
    startPage: ['home', 'fixtures', 'live', 'matches', 'leagues', 'ai'].includes(b.startPage) ? b.startPage : 'home',
    notify: {
      on: !!b.notify?.on, scope: b.notify?.scope === 'all' ? 'all' : 'favourites',
      types: Object.fromEntries(notify.TYPES.map((t) => [t, b.notify?.types ? b.notify.types[t] !== false : true])),
    },
  };
}
route('GET', /^\/api\/prefs$/, async (req) => (await dbm.prefs.get(clientId(req))) || cleanPrefs());
route('PUT', /^\/api\/prefs$/, async (req, res, p, q, body) => { limit(req, 'prefs', 60, HOUR); const id = clientId(req); const v = cleanPrefs(body); await dbm.prefs.set(id, v);
  const rec = await dbm.push.get(id).catch(() => null);
  if (rec) await dbm.push.set(id, { ...rec, prefs: { favTeams: v.favTeams, favLeagues: v.favLeagues, notify: v.notify } }).catch(() => {});
  return v; });


/* ------------------------------------------------------------------------------------------------- notifications ---- */

route('GET', /^\/api\/notifications$/, (req, res, p, q) => {
  const since = q.since ? new Date(q.since) : null;
  const events = (d().notifications || []).filter((e) => !since || isNaN(since) || new Date(e.at) > since).slice(0, 100);
  return { events, now: new Date().toISOString() };
});

route('GET', /^\/api\/push\/key$/, () => { const key = notify.vapidPublic({ create: dbm.mode() === 'file' }); return { key, supported: !!key }; });

route('PUT', /^\/api\/push$/, async (req, res, p, q, body) => {
  limit(req, 'push', 30, HOUR);
  const id = clientId(req);
  if (!body.subscription) { await dbm.push.del(id); return { ok: true, on: false }; }
  if (!notify.validSubscription(body.subscription)) throw new HttpError(400, 'This browser sent an unsupported push subscription');
  const sub = { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } };
  const saved = (await dbm.prefs.get(id)) || cleanPrefs();
  await dbm.push.set(id, { sub, prefs: { favTeams: saved.favTeams || [], favLeagues: saved.favLeagues || [], notify: { ...cleanPrefs(saved).notify, on: true } }, at: new Date().toISOString() });
  return { ok: true, on: true };
});

route('PUT', /^\/api\/push\/test$/, async (req) => {
  limit(req, 'pushtest', 5, HOUR);
  const rec = await dbm.push.get(clientId(req));
  if (!rec) throw new HttpError(404, 'This device is not subscribed yet');
  const r = await notify.sendOne(rec.sub, { title: 'Alerts are on ✅', body: 'You will get goals, kick-offs and results for your favourites.', url: '/#/profile', tag: 'test', type: 'test' });
  if (r.gone) await dbm.push.del(clientId(req)).catch(() => {});
  return { ok: r.ok, status: r.status };
});

/* --------------------------------------------------------------------------------------- scheduled steps (hosted) -- */

route('GET', /^\/api\/cron$/, async (req, res, p, q) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'CRON_SECRET is not set');
  const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(secret);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(401, 'Unauthorized');
  const step = String(q.step || 'data');
  await dbm.hydrate({ maxAge: 0 });
  const r = await pipeline.runStep(step, { budgetMs: Math.min(Number(q.budget) || 48000, 52000) });
  await dbm.flushAsync({ main: true });
  return r;
});

/* ----------------------------------------------------------------------------------------------- http plumbing ----- */

const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

function readBody(req) {
  if (req.body !== undefined && req.body !== null) { // already parsed by the hosting platform
    try { const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body; if (JSON.stringify(b).length > 20000) throw new HttpError(413, 'Body too large'); return Promise.resolve(b); } catch (e) { return Promise.reject(e.code ? e : new HttpError(400, 'Invalid JSON')); }
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 20000) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
  });
}

function send(req, res, code, body, type = 'application/json', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(type === 'application/json' ? JSON.stringify(body) : String(body));
  const headers = { 'Content-Type': type, ...SECURITY, ...extra };
  if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && !headers['Content-Encoding']) { buf = zlib.gzipSync(buf, { level: 6 }); headers['Content-Encoding'] = 'gzip'; }
  headers.Vary = 'Accept-Encoding'; headers['Content-Length'] = buf.length;
  res.writeHead(code, headers);
  res.end(buf);
}

const staticCache = new Map();
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(req, res, 403, 'Forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!path.extname(rel)) return serveStatic(req, res, '/'); // unknown route: the app handles it
      return send(req, res, 404, 'Not found', 'text/plain');
    }
    const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, ...SECURITY }); return res.end(); }
    let hit = staticCache.get(file);
    if (!hit || hit.etag !== etag) { hit = { etag, buf: fs.readFileSync(file) }; staticCache.set(file, hit); }
    send(req, res, 200, hit.buf, MIME[path.extname(file)] || 'application/octet-stream', { ETag: etag, 'Cache-Control': 'no-cache' });
  });
}

const LIVE_PATHS = /^\/api\/(live|dashboard|fixtures|status)$/;

async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  // on Vercel every /api/* request is rewritten to one function: the original path travels in ?__p=
  let pathname = u.pathname;
  if (u.searchParams.has('__p')) { pathname = '/api/' + String(u.searchParams.get('__p')).replace(/^\/+/, ''); u.searchParams.delete('__p'); }
  let hosted = false;
  try {
    if (pathname.startsWith('/api/')) {
      const q = Object.fromEntries(u.searchParams);
      hosted = dbm.mode() === 'remote';
      if (hosted) {
        await dbm.hydrate({ maxAge: pathname === '/api/cron' ? 0 : 20000 });
        if (LIVE_PATHS.test(pathname) && req.method === 'GET') await pipeline.maybeLive();
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const mt = pathname.match(r.re);
        if (!mt) continue;
        const body = req.method === 'PUT' ? await readBody(req) : null;
        const out = await r.fn(req, res, mt.slice(1), q, body);
        send(req, res, 200, out, 'application/json', { 'Cache-Control': 'no-store' });
        if (hosted && pathname !== '/api/cron') await dbm.flushAsync({ main: false }).catch(() => {});
        return;
      }
      throw new HttpError(404, 'Unknown endpoint');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (e) { send(req, res, Number.isInteger(e.code) ? e.code : 400, { error: e.message }, 'application/json', { 'Cache-Control': 'no-store' }); }
}

const server = http.createServer(handle);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\nPredictx running at http://localhost:${PORT}`);
    console.log(`Football data: ${pipeline.provider() ? pipeline.provider().name : 'NOT CONFIGURED - set FOOTBALL_DATA_KEY'}`);
    console.log(`Competitions:  ${pipeline.provider() ? (process.env.LEAGUES || 'all 12 free-plan competitions') : '-'}`);
    console.log(`Gemini:        ${ai.enabled() ? 'ON (' + ai.model() + '): picks, web research, news, AI analysis' : 'OFF - set GEMINI_API_KEY (statistical picks are used meanwhile)'}\n`);
    pipeline.start();
  });
}

module.exports = { server, handle };
