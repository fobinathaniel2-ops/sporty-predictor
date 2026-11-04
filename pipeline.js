'use strict';
/**
 * Automated pipeline:
 *   every PIPELINE_HOURS: football API (all competitions) -> store fixtures/results -> verify earlier picks ->
 *                         statistics + Elo + Poisson probabilities -> Gemini web research -> Gemini picks
 *   every LIVE_POLL_SEC : refresh live scores while matches are being played
 * Picks are stored, locked at kickoff and verified against the real result.
 */
const dbm = require('./db');
const engine = require('./engine');
const ai = require('./ai');

const DAY = 86400000, HOUR = 3600000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let deadline = Infinity; // set by hosted-mode steps: serverless functions must finish in time
const timeLeft = () => deadline - Date.now();
const setDeadline = (t) => { deadline = t; ai.deadline = t; };
// Competitions in football-data.org's free plan, in display order.
const comps = require('./competitions');
const notify = require('./notify');
const FREE_COMPETITIONS = comps.FREE_CODES;
let running = false;
let nextRunAt = null;
let warnedNoKey = false;

function provider() {
  if (process.env.DEMO_MODE === '1') return require('./providers/demo'); // offline testing only
  if (process.env.FOOTBALL_DATA_KEY) return require('./providers/footballData');
  return null;
}
const isDemo = () => provider()?.name === 'demo';

/** Competition codes to load. LEAGUES=ALL loads every competition the API lists (plan-restricted ones are skipped). */
function leagueCodes() {
  const p = provider();
  if (!p) return [];
  if (p.name === 'demo') return ['DEMO'];
  const env = (process.env.LEAGUES || '').trim().toUpperCase();
  const meta = dbm.data().meta;
  let codes;
  if (env === 'ALL') codes = comps.CODES;
  else if (env) codes = env.split(',').map((s) => s.trim()).filter((c) => comps.CODES.includes(c));
  else codes = FREE_COMPETITIONS;
  const blocked = meta.blocked || {};
  return codes.filter((c) => !(blocked[c] && Date.now() - new Date(blocked[c]) < DAY));
}

/* ------------------------------------------------------------------- cached provider lookups (for the website) ------ */

const inflight = new Map();
/** Return a cached value, or fetch it. If the source fails, an old cached value is better than an error. */
async function cached(key, ttl, fn) {
  const hit = dbm.cache.get(key);
  if (hit !== undefined) return { value: hit, stale: false };
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    try { const value = await fn(); dbm.cache.set(key, value, ttl); return { value, stale: false }; } catch (e) {
      const old = dbm.cache.getStale(key);
      if (old !== undefined) return { value: old, stale: true, error: e.message };
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, job);
  return job;
}

const remote = {
  standings: (code) => cached(`standings:${code}`, 30 * 60000, () => provider().getStandings(code, 1)),
  scorers: (code) => cached(`scorers:${code}`, 60 * 60000, () => provider().getScorers(code, 1)),
  team: (id) => cached(`team:${id}`, 24 * HOUR, () => provider().getTeam(id, 1)),
  detail: (m, prio = 1) => {
    const ttl = m.status === 'LIVE' ? 60000 : m.status === 'FINISHED' ? 24 * HOUR : 10 * 60000;
    return cached(`detail:${m.id}:${m.status}`, ttl, () => provider().getMatchDetail(m.id, prio));
  },
};

/* -------------------------------------------------------------------------------------------------- data loading ---- */

function mergeMatches(list) {
  const d = dbm.data();
  for (const m of list) {
    d.teams[m.home.id] = { id: m.home.id, name: m.home.name, crest: m.home.crest || d.teams[m.home.id]?.crest || null };
    d.teams[m.away.id] = { id: m.away.id, name: m.away.name, crest: m.away.crest || d.teams[m.away.id]?.crest || null };
    d.matches[m.id] = { ...(d.matches[m.id] || {}), ...m };
  }
}

async function refreshData(now, opts = {}) {
  const prov = provider(); const d = dbm.data();
  d.meta.prevFetched = d.meta.prevFetched || {};
  d.meta.lastDataRefresh = d.meta.lastDataRefresh || {};
  d.meta.blocked = d.meta.blocked || {};

  if ((process.env.LEAGUES || '').trim().toUpperCase() === 'ALL' && prov.listCompetitions) {
    try {
      d.meta.allCompetitions = await prov.listCompetitions();
      dbm.log('info', prov.name, `${d.meta.allCompetitions.length} competitions listed by the API`);
    } catch (e) { dbm.log('error', prov.name, `competition list: ${e.message}`); }
  }

  const minAge = (opts.minAgeMin ?? 0) * 60000;
  const order = leagueCodes().sort((a, b) => new Date(d.meta.lastDataRefresh[a] || 0) - new Date(d.meta.lastDataRefresh[b] || 0));
  let refreshed = 0, left = 0;
  for (const code of order) {
    if (minAge && d.meta.lastDataRefresh[code] && now - new Date(d.meta.lastDataRefresh[code]) < minAge) continue;
    if (timeLeft() < 22000) { left++; continue; }
    try {
      const prev = d.meta.prevFetched[code];
      const needPrev = !prev || now - new Date(prev) > 7 * DAY;
      const res = await prov.getLeagueData(code, { now, includePrevious: needPrev });
      d.leagues[code] = { ...res.league, name: comps.byCode(code)?.name || res.league.name, demo: prov.name === 'demo', provider: prov.name };
      mergeMatches(res.matches);
      if (needPrev && res.previousIncluded) d.meta.prevFetched[code] = now.toISOString();
      d.meta.lastDataRefresh[code] = now.toISOString();
      dbm.log('info', prov.name, `${code}: ${res.matches.length} matches synced`);
      settleAll(now);
      predictLeague(code, now); // show statistical picks as soon as each competition has loaded
      dbm.save(); refreshed++;
    } catch (e) {
      if (e.status === 403) { d.meta.blocked[code] = now.toISOString(); dbm.log('warn', prov.name, `${code}: ${e.message}`); } else dbm.log('error', prov.name, `${code}: ${e.message}`);
      if (e.status === 401) break; // bad key: no point trying the rest
    }
  }
  dbm.save();
  return { refreshed, left };
}

/* ---------------------------------------------------------------------------------- live scores ---------------------- */

function lockStarted(now) {
  for (const p of Object.values(dbm.data().predictions)) if (!p.locked && new Date(p.kickoff) <= now) p.locked = true;
}

/** One request refreshes every match of yesterday and today, but only while a match could be in play. */
async function liveTick(now = new Date()) {
  const n = await liveTickInner(now);
  try { await notify.deliver(notify.scan(now)); } catch (e) { dbm.log('warn', 'notify', e.message); }
  return n;
}

async function liveTickInner(now) {
  const prov = provider();
  if (!prov?.getMatchesBetween || running) return 0;
  const d = dbm.data(); const codes = leagueCodes();
  lockStarted(now);
  const watch = Object.values(d.matches).some((m) => codes.includes(m.league) && (m.status === 'LIVE' || (m.status === 'SCHEDULED' && new Date(m.date) - now < 15 * 60000 && now - new Date(m.date) < 4 * HOUR)));
  if (!watch) return 0;
  try {
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const list = (await prov.getMatchesBetween(iso(now - DAY), iso(+now + DAY), 2)).filter((m) => codes.includes(m.league));
    const before = Object.fromEntries(list.map((m) => [m.id, d.matches[m.id]?.status]));
    mergeMatches(list);
    predictLive(now);
    const newlyDone = list.filter((m) => m.status === 'FINISHED' && before[m.id] !== 'FINISHED').length;
    if (newlyDone) { settleAll(now); resolveEarly(now).catch(() => {}); }
    dbm.save();
    return list.length;
  } catch (e) { dbm.log('warn', 'live', e.message); return 0; }
}

/* ------------------------------------------------------------------------------------------- verification ---------- */

function settleAll(now) {
  const d = dbm.data(); let settled = 0;
  for (const p of Object.values(d.predictions)) {
    if (p.settled) continue;
    const m = d.matches[p.matchId];
    if (!m) continue;
    if (m.status === 'FINISHED' && m.ft) {
      for (const key of ['best', 'statsBest']) if (p[key]) p[key].correct = engine.settleId(p[key].id, m.ft, m.ht);
      p.actual = { ft: m.ft, ht: m.ht || null, result: m.ft[0] > m.ft[1] ? '1' : m.ft[0] === m.ft[1] ? 'X' : '2' };
      p.settled = true; p.settledAt = now.toISOString(); p.locked = true; settled++;
    } else if (m.status === 'OTHER' && now - new Date(m.date) > 3 * DAY) {
      p.settled = true; p.void = true; p.settledAt = now.toISOString(); p.locked = true; // postponed / cancelled
    }
  }
  if (settled) dbm.log('info', 'settle', `${settled} picks verified against results`);
  return settled;
}

/** 1UP / 2UP picks can't always be verified from the final score; the goal timeline settles them exactly. */
async function resolveEarly(now) {
  const prov = provider();
  if (!prov?.getMatchDetail) return 0;
  const d = dbm.data(); let n = 0;
  for (const p of Object.values(d.predictions)) {
    if (!p.settled || p.void || p.seqTried || n >= 10) continue;
    const keys = ['best', 'statsBest'].filter((k) => p[k] && engine.isEarly(p[k].id) && p[k].correct === null);
    if (!keys.length) continue;
    const m = d.matches[p.matchId];
    p.seqTried = true; n++;
    try {
      const det = (await remote.detail(m, 0)).value;
      const total = m.ft[0] + m.ft[1];
      if (!det?.goals?.length || det.goals.length !== total) continue; // timeline missing or incomplete: leave unverified
      const seq = det.goals.map((g) => g.score);
      for (const k of keys) p[k].correct = engine.settleId(p[k].id, m.ft, m.ht, seq);
    } catch (e) { dbm.log('warn', 'settle', `goal timeline for ${p.matchId}: ${e.message}`); }
  }
  dbm.save();
  return n;
}

/* -------------------------------------------------------------------------------------------------- predictions ----- */

const round3 = (pm) => Object.fromEntries(Object.entries(pm).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

function upsertPrediction(m, pr, now) {
  const d = dbm.data();
  const prev = d.predictions[m.id];
  const pm = round3(pr.pm);
  const sb = engine.statsBest(pm, m.home.name, m.away.name);
  let best = { ...sb, source: 'stats', reason: 'Highest probability among the candidate picks, from team statistics.' };
  if (prev?.best?.source === 'ai' && pm[prev.best.id] !== undefined) best = { ...prev.best, p: pm[prev.best.id] }; // keep the AI's choice, refresh its probability
  d.predictions[m.id] = {
    matchId: m.id, league: m.league, kickoff: m.date, modelVersion: engine.MODEL_VERSION,
    generatedAt: prev?.generatedAt || now.toISOString(), updatedAt: now.toISOString(),
    pm, lh: pr.lh, la: pr.la, topScores: pr.topScores, context: pr.context,
    confidence: engine.confidence(best.p, pr.context.played),
    best, statsBest: sb, research: prev?.research, aiTries: prev?.aiTries || 0,
    locked: false, settled: false, demo: !!d.leagues[m.league]?.demo,
  };
}

function predictLeague(code, now) {
  const d = dbm.data();
  const finished = Object.values(d.matches).filter((m) => m.league === code && m.status === 'FINISHED' && m.ft);
  const model = engine.buildModel(finished, now);
  if (!model.ok) { dbm.log('warn', 'engine', `${code}: ${model.reason}`); return 0; }
  const horizon = Number(process.env.HORIZON_DAYS || 28) * DAY;
  let count = 0;
  for (const m of Object.values(d.matches)) {
    if (m.league !== code || m.status !== 'SCHEDULED') continue;
    const kick = new Date(m.date);
    const existing = d.predictions[m.id];
    if (kick <= now) { if (existing && !existing.settled) existing.locked = true; continue; } // frozen at kickoff
    if (existing?.locked || kick - now > horizon) continue;
    upsertPrediction(m, engine.predict(model, m.home.id, m.away.id), now);
    count++;
  }
  const ratings = Object.entries(model.elo).map(([id, r]) => ({ id, name: d.teams[id]?.name || id, elo: Math.round(r) })).sort((a, b) => b.elo - a.elo);
  d.statistics[code] = { updatedAt: now.toISOString(), matches: model.n, avgHomeGoals: model.Lh, avgAwayGoals: model.La, htShare: model.htShare, ratings };
  return count;
}

function predictAll(now) {
  let total = 0;
  for (const code of leagueCodes()) total += predictLeague(code, now);
  dbm.save();
  return total;
}

const upcoming = (now, maxMs) => Object.values(dbm.data().predictions)
  .filter((p) => !p.web && !p.late && !p.settled && !p.locked && new Date(p.kickoff) > now && new Date(p.kickoff) - now < maxMs && dbm.data().matches[p.matchId])
  .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));


/* ------------------------------------------------------------------------------------------------ live picks ------ */

const modelCache = new Map();
function modelFor(code, now) {
  const c = modelCache.get(code);
  if (c && now - c.at < 30 * 60000) return c.model;
  const fin = Object.values(dbm.data().matches).filter((m) => m.league === code && m.status === 'FINISHED' && m.ft);
  const model = engine.buildModel(fin, now);
  modelCache.set(code, { at: +now, model });
  return model;
}

const stripCid = ({ cid, ...c }) => c;

/** Matches in play get a pick that accounts for the current score and the minutes left. These are made after kick-off,
 *  so they are labelled "live" and kept out of the main accuracy figure. */
function predictLive(now = new Date()) {
  const d = dbm.data(); let n = 0;
  for (const m of Object.values(d.matches)) {
    if (m.status !== 'LIVE' || m.web || !leagueCodes().includes(m.league)) continue;
    const score = Array.isArray(m.live) ? m.live : Array.isArray(m.ft) ? m.ft : null;
    if (!score) continue;
    const prev = d.predictions[m.id];
    const stamp = prev?.late ? prev.updatedAt : prev?.inplay?.at;
    if (stamp && now - new Date(stamp) < 2 * 60000) continue;
    const model = modelFor(m.league, now);
    if (!model.ok) continue;
    const minute = Number.isFinite(m.minute) ? m.minute : Math.min(90, Math.max(1, Math.round((now - new Date(m.date)) / 60000)));
    const lp = engine.livePredict(model, m.home.id, m.away.id, score, minute);
    const pm = round3(lp.pm);
    const best = { ...stripCid(engine.candidates(pm, m.home.name, m.away.name)[0]), source: 'stats', reason: `In-play: score ${score[0]}-${score[1]} after ${minute}', remaining goals from team strengths.` };
    if (prev && !prev.late) { prev.inplay = { at: now.toISOString(), minute, score, best }; n++; continue; }
    d.predictions[m.id] = {
      matchId: m.id, league: m.league, kickoff: m.date, modelVersion: `${engine.MODEL_VERSION}-live`, generatedAt: prev?.generatedAt || now.toISOString(), updatedAt: now.toISOString(),
      pm, lh: lp.lh, la: lp.la, topScores: [], context: lp.context, confidence: engine.confidence(best.p, lp.context.played),
      best, statsBest: best, aiTries: 9, locked: true, settled: false, late: true, liveAt: { minute, score }, demo: !!d.leagues[m.league]?.demo,
    };
    n++;
  }
  if (n) dbm.save();
  return n;
}

/* ------------------------------------------------------------------- matches found by Gemini on the web ------------ */

const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|cf|afc|sc|ac|as|ssc|fk|sk|bk|cd|ud|sv|vfb|vfl|rcd|us|club|de|the|real|calcio)\b/g, ' ').replace(/[^a-z0-9]/g, '');
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const webCodes = () => Object.keys(dbm.data().leagues).filter((c) => dbm.data().leagues[c].web && Object.values(dbm.data().matches).some((m) => m.league === c));

function knownTeam(name) {
  const k = normName(name);
  if (k.length < 3) return null;
  const teams = Object.values(dbm.data().teams).filter((t) => !String(t.id).startsWith('w_'));
  return teams.find((t) => normName(t.name) === k) || teams.find((t) => { const n = normName(t.name); return k.length >= 5 && n.length >= 5 && (n.includes(k) || k.includes(n)); }) || null;
}


/** Remove web-found competitions that are not on the allowed list (e.g. left over from an earlier version). */
function pruneWeb() {
  const d = dbm.data(); const okNames = new Set(comps.NAMES);
  for (const [code, l] of Object.entries(d.leagues)) {
    if (!l.web || okNames.has(l.name)) continue;
    for (const [id, m] of Object.entries(d.matches)) if (m.league === code) { delete d.matches[id]; delete d.predictions[id]; }
    delete d.leagues[code];
  }
}

async function addWebMatches(now) {
  pruneWeb();
  if (!ai.enabled() || process.env.AI_WEB === '0') return 0;
  const d = dbm.data();
  if (d.meta.webAt && !d.meta.webCursor && now - new Date(d.meta.webAt) < 5 * HOUR) return 0;
  const days = Math.min(7, Number(process.env.AI_WEB_DAYS || 4));
  const delay = Number(process.env.AI_DELAY_MS ?? 5000);
  const day = (n) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n)).toISOString().slice(0, 10);
  // Competitions the data feed already covers are skipped. The rest are searched in small groups so each call is quick.
  const covered = new Set(leagueCodes());
  const names = comps.LIST.filter((c) => !(c.code && covered.has(c.code))).map((c) => c.name);
  const GROUP = Number(process.env.AI_WEB_GROUP || 8);
  const groups = []; for (let i = 0; i < names.length; i += GROUP) groups.push(names.slice(i, i + GROUP));
  let cursor = d.meta.webCursor || 0; if (cursor >= groups.length) cursor = 0;
  let added = 0, ok = false, guard = 0;
  while (guard++ < groups.length) {
    if (timeLeft() < 38000) break;
    const names2 = groups[cursor];
    try {
      const r = await ai.discover(day(0), day(days - 1), names2);
      ok = true;
      dbm.log('info', 'ai-web', `group ${cursor + 1}/${groups.length}: Gemini listed ${r.matches.length} matches`);
      for (const x of r.matches) {
        const t = new Date(x.kickoff);
        if (t <= now || t - now > (days + 1) * DAY) continue;
        const canon = comps.canonical(x.competition, x.country);
        if (!canon || (canon.code && leagueCodes().includes(canon.code))) continue; // not on the list, or already covered by the data feed
        x.competition = canon.name;
        const hk = knownTeam(x.home), ak = knownTeam(x.away);
        const hn = hk?.name || x.home, an = ak?.name || x.away;
        const key = [normName(hn), normName(an)].sort().join('|');
        const dup = Object.values(d.matches).some((m) => Math.abs(new Date(m.date) - t) < 36 * HOUR && [normName(m.home.name), normName(m.away.name)].sort().join('|') === key);
        if (dup) continue;
        const code = `WEB_${slug(canon.name).slice(0, 36).replace(/-/g, '_')}`;
        d.leagues[code] = { ...(d.leagues[code] || {}), code, name: x.competition, country: x.country || 'Web', emblem: null, web: true };
        const id = 'web_' + require('crypto').createHash('md5').update(`${code}|${key}|${x.kickoff.slice(0, 10)}`).digest('hex').slice(0, 10);
        const side = (k, n) => (k ? { id: k.id, name: k.name, crest: k.crest || null } : { id: `w_${slug(n).replace(/-/g, '_')}`, name: n, crest: null });
        const h = side(hk, x.home), a = side(ak, x.away);
        for (const tm of [h, a]) if (!d.teams[tm.id]) d.teams[tm.id] = { id: tm.id, name: tm.name, crest: null };
        if (!d.matches[id]) added++;
        d.matches[id] = { ...(d.matches[id] || {}), id, league: code, date: x.kickoff, status: 'SCHEDULED', matchday: null, stage: null, season: engine.seasonOf(x.kickoff), home: h, away: a, ft: null, ht: null, web: true, sources: r.sources.slice(0, 3) };
      }
      cursor = (cursor + 1) % groups.length; d.meta.webCursor = cursor;
      if (cursor === 0) { d.meta.webAt = now.toISOString(); break; } // every group searched: wait a few hours before the next round
    } catch (e) {
      dbm.log('warn', 'ai-web', `group ${cursor + 1}/${groups.length}: ${e.message}`); if (e.fatal) break;
      d.meta.webFail = d.meta.webFail || {}; d.meta.webFail[cursor] = (d.meta.webFail[cursor] || 0) + 1;
      if (d.meta.webFail[cursor] >= 2) { d.meta.webFail[cursor] = 0; cursor = (cursor + 1) % groups.length; d.meta.webCursor = cursor; if (cursor === 0) { d.meta.webAt = now.toISOString(); break; } } // try a group twice, then move on
      else break;
    }
    dbm.save();
    if (delay) await sleep(Math.min(delay, Math.max(0, timeLeft() - 38000)));
  }
  d.meta.webCursor = cursor;
  if (added) dbm.log('info', 'ai-web', `${added} extra matches found by web search`);
  return added;
}

/** Cup/other fixtures between teams we have statistics for use the stats model; the rest get a Gemini web pick. */
async function addWebPicks(now) {
  const d = dbm.data();
  const todo = Object.values(d.matches).filter((m) => m.web && m.status === 'SCHEDULED' && new Date(m.date) > now && !d.predictions[m.id] && (m.webTries || 0) < 2)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  let n = 0; const rest = [];
  for (const m of todo) {
    let done = false;
    for (const code of leagueCodes()) {
      const model = modelFor(code, now);
      if (!model.ok || !model.tally[m.home.id] || !model.tally[m.away.id]) continue;
      upsertPrediction(m, engine.predict(model, m.home.id, m.away.id), now);
      Object.assign(d.predictions[m.id], { web: true, webNote: `Found by web search. Team statistics come from ${d.leagues[code]?.name || code}.` });
      n++; done = true; break;
    }
    if (!done) rest.push(m);
  }
  if (ai.enabled()) {
    const max = Number(process.env.AI_WEB_MAX || 24), delay = Number(process.env.AI_DELAY_MS ?? 5000);
    const list = rest.slice(0, max);
    for (let i = 0; i < list.length; i += 6) {
      if (timeLeft() < 20000) break;
      const chunk = list.slice(i, i + 6);
      try {
        const r = await ai.pickWeb(chunk.map((m) => ({ key: m.id, competition: d.leagues[m.league]?.name, home: m.home.name, away: m.away.name, kickoff: m.date })));
        const got = new Set();
        for (const pk of r.picks) {
          const m = d.matches[pk.key]; if (!m) continue;
          const group = engine.groupOf(pk.pick);
          d.predictions[m.id] = {
            matchId: m.id, league: m.league, kickoff: m.date, modelVersion: 'web-1', generatedAt: now.toISOString(), updatedAt: now.toISOString(),
            pm: { [pk.pick]: pk.p }, lh: null, la: null, topScores: [], context: { elo: null, form: { home: null, away: null }, h2h: { meetings: 0, avgGoalDiff: null }, played: { home: 0, away: 0 } },
            confidence: pk.confidence, best: { id: pk.pick, market: group, pick: pk.pick, label: pk.pick, p: pk.p, about: engine.explain(pk.pick, m.home.name, m.away.name), source: 'ai', estimated: true, reason: pk.reason, model: ai.model() },
            statsBest: null, research: { notes: pk.reason ? [pk.reason] : [], sources: r.sources, at: now.toISOString() },
            locked: false, settled: false, web: true, webNote: 'Found by web search. There are no stored statistics for these teams, so the percentage is Gemini\'s own estimate.',
          };
          got.add(m.id); n++;
        }
        for (const m of chunk) if (!got.has(m.id)) m.webTries = (m.webTries || 0) + 1;
      } catch (e) { if (!e.fatal) for (const m of chunk) m.webTries = (m.webTries || 0) + 1; dbm.log('warn', 'ai-web', e.message); if (e.fatal) break; }
      dbm.save();
      if (i + 6 < list.length && delay) await sleep(Math.min(delay, Math.max(0, timeLeft() - 22000)));
    }
  }
  if (n) dbm.save();
  return n;
}

/** Web-found matches have no live feed: after full time Gemini looks up the score so the pick can be checked. */
async function resolveWebResults(now) {
  if (!ai.enabled() || process.env.AI_WEB === '0') return 0;
  const d = dbm.data();
  const due = Object.values(d.matches).filter((m) => m.web && m.status === 'SCHEDULED' && now - new Date(m.date) > 3 * HOUR && (m.resTries || 0) < 4).slice(0, 12);
  let n = 0;
  for (let i = 0; i < due.length; i += 6) {
    if (timeLeft() < 20000) break;
    const chunk = due.slice(i, i + 6);
    try {
      const res = await ai.results(chunk.map((m) => ({ key: m.id, competition: d.leagues[m.league]?.name, home: m.home.name, away: m.away.name, kickoff: m.date })));
      for (const r of res) { const m = d.matches[r.key]; m.status = 'FINISHED'; m.ft = r.ft; m.ht = r.ht; m.resultSource = 'web'; n++; }
      for (const m of chunk) if (m.status === 'SCHEDULED') { m.resTries = (m.resTries || 0) + 1; if (m.resTries >= 4 && now - new Date(m.date) > 2 * DAY) m.status = 'OTHER'; }
    } catch (e) { if (!e.fatal) for (const m of chunk) m.resTries = (m.resTries || 0) + 1; dbm.log('warn', 'ai-web', e.message); if (e.fatal) break; }
    dbm.save();
  }
  if (n) { settleAll(now); dbm.save(); }
  return n;
}

/** Gemini + Google Search: recent team news for the next matches. Stored as unverified notes with their sources. */
async function addResearch(now) {
  if (!ai.enabled() || process.env.AI_SEARCH === '0') return 0;
  const d = dbm.data();
  const max = Number(process.env.AI_SEARCH_MAX || 12), delay = Number(process.env.AI_DELAY_MS ?? 5000);
  const todo = upcoming(now, 3 * DAY).filter((p) => !p.research || now - new Date(p.research.at) > 12 * HOUR).slice(0, max);
  let n = 0;
  for (let i = 0; i < todo.length; i += 4) {
    if (timeLeft() < 20000) break;
    const chunk = todo.slice(i, i + 4);
    const items = chunk.map((p) => { const m = d.matches[p.matchId]; return { key: p.matchId, league: d.leagues[p.league]?.name || p.league, home: m.home.name, away: m.away.name, date: m.date }; });
    try {
      const r = await ai.research(items);
      for (const p of chunk) { p.research = { notes: r.notes[p.matchId] || [], sources: r.sources, at: now.toISOString() }; n++; }
    } catch (e) {
      dbm.log('warn', 'ai-search', e.message);
      if (e.fatal) break;
    }
    dbm.save();
    if (i + 4 < todo.length && delay) await sleep(Math.min(delay, Math.max(0, timeLeft() - 22000)));
  }
  if (n) dbm.log('info', 'ai-search', `web research done for ${n} matches`);
  return n;
}

/** Gemini chooses one candidate per match; batches of 8 keep us inside the free quota. */
async function addAiPicks(now) {
  if (!ai.enabled()) return 0;
  const d = dbm.data();
  const max = Number(process.env.AI_MAX_PER_RUN || 60), batch = Number(process.env.AI_BATCH || 8), delay = Number(process.env.AI_DELAY_MS ?? 5000);
  const todo = upcoming(now, 14 * DAY).filter((p) => p.best?.source !== 'ai' && (p.aiTries || 0) < 3).slice(0, max);
  let n = 0;
  for (let i = 0; i < todo.length; i += batch) {
    if (timeLeft() < 20000) break;
    const chunk = todo.slice(i, i + batch);
    const items = chunk.map((p) => {
      const m = d.matches[p.matchId];
      return { key: p.matchId, league: d.leagues[p.league]?.name || p.league, home: m.home.name, away: m.away.name, xg: { home: p.lh, away: p.la },
        context: p.context, notes: p.research?.notes, candidates: engine.candidates(p.pm, m.home.name, m.away.name) };
    });
    try {
      const answers = await ai.choose(items);
      const got = new Set();
      for (const a of answers) {
        const it = items.find((x) => x.key === a.key); const p = d.predictions[a.key]; const c = it?.candidates[a.index];
        if (!c || !p) continue;
        const { cid, ...rest } = c;
        p.best = { ...rest, source: 'ai', reason: a.reason, aiConfidence: a.confidence, model: ai.model() };
        p.confidence = engine.confidence(p.best.p, p.context.played);
        got.add(a.key); n++;
      }
      for (const p of chunk) if (!got.has(p.matchId)) p.aiTries = (p.aiTries || 0) + 1;
    } catch (e) {
      if (!e.fatal) for (const p of chunk) p.aiTries = (p.aiTries || 0) + 1; // a bad key/model/quota is not the match's fault
      dbm.log('warn', 'ai', e.message);
      if (e.fatal) break; // bad key / quota / wrong model: stop this run
    }
    dbm.save();
    if (i + batch < todo.length && delay) await sleep(Math.min(delay, Math.max(0, timeLeft() - 22000)));
  }
  if (n) dbm.log('info', 'ai', `${n} AI picks made (${ai.model()})`);
  return n;
}


/* ---------------------------------------------------------------------------------------------------- hosted mode --- */
// On Vercel there is no long-running process. The same work is split into short steps that an external scheduler
// (GitHub Actions) calls through /api/cron. Each step stops before the serverless time limit and carries on next call.

/** Fetch yesterday..tomorrow in one request and publish it as the live-score overlay (hosted mode). */
async function liveTickHosted(now = new Date(), { lock = true } = {}) {
  const prov = provider(); const d = dbm.data(); const codes = leagueCodes();
  if (!prov?.getMatchesBetween) return 0;
  const o = dbm.overlay.get();
  if (o && now - new Date(o.at) < 45000) return 0;
  const watch = Object.values(d.matches).some((m) => codes.includes(m.league) && (m.status === 'LIVE' || (m.status === 'SCHEDULED' && new Date(m.date) - now < 15 * 60000 && now - new Date(m.date) < 4 * HOUR)));
  if (!watch) return 0;
  if (lock && !(await dbm.overlay.lock(25).catch(() => false))) return 0;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const list = (await prov.getMatchesBetween(iso(now - DAY), iso(+now + DAY), 2)).filter((m) => codes.includes(m.league));
  await dbm.overlay.set({ at: now.toISOString(), matches: Object.fromEntries(list.map((m) => [m.id, m])) });
  dbm.overlay.apply();
  return list.length;
}

/** Called by web requests in hosted mode: refresh scores if they are older than ~a minute. Never throws. */
async function maybeLive() {
  try { await Promise.race([liveTickHosted(), sleep(9000)]); } catch (e) { /* stale scores are fine */ }
}

/** Keep standings and scorers warm so web requests do not spend the football-data.org quota. */
async function prefetch() {
  if (!provider() || isDemo()) return 0;
  let n = 0;
  for (const code of leagueCodes()) {
    if (!dbm.data().leagues[code]) continue;
    for (const [key, ttl, fn] of [[`standings:${code}`, 25 * 60000, () => remote.standings(code)], [`scorers:${code}`, 55 * 60000, () => remote.scorers(code)]]) {
      const age = dbm.cache.age(key);
      if (age !== null && age < ttl) continue;
      if (timeLeft() < 18000) return n;
      try { await fn(); n++; } catch (e) { dbm.log('warn', 'prefetch', `${key}: ${e.message}`); }
    }
  }
  return n;
}

/** Football news for the dashboard (Gemini + Google Search), refreshed by the scheduler about every 3 hours. */
async function refreshNews() {
  if (!ai.enabled() || dbm.cache.get('news') !== undefined || timeLeft() < 35000) return false;
  const d = dbm.data();
  const names = leagueCodes().map((c) => d.leagues[c]?.name).filter(Boolean).slice(0, 8);
  if (!names.length) return false;
  try { dbm.cache.set('news', { ...(await ai.news(names)), at: new Date().toISOString() }, 3 * HOUR); return true; }
  catch (e) { dbm.log('warn', 'ai-news', e.message); return false; }
}

/** Retry counters used up while Gemini was failing (retired model) are given back once. */
function resetTriesOnce() {
  const d = dbm.data(); if (d.meta.triesReset === 'v6.1') return;
  for (const p of Object.values(d.predictions)) if (p.aiTries < 9) p.aiTries = 0;
  for (const m of Object.values(d.matches)) { delete m.webTries; delete m.resTries; }
  delete d.meta.webAt; d.meta.triesReset = 'v6.1'; dbm.save();
}

/** One scheduled step. Returns { step, done, ... }; the scheduler repeats a step until done is true. */
async function runStep(step, { now = new Date(), budgetMs = 48000 } = {}) {
  if (!provider()) return { step, done: true, error: 'FOOTBALL_DATA_KEY not set' };
  setDeadline(Date.now() + budgetMs);
  resetTriesOnce();
  const d = dbm.data(); const out = { step };
  try {
    if (step === 'live') {
      await liveTickHosted(now, { lock: false }).then((n) => { out.matches = n; });
      lockStarted(now); settleAll(now); predictLive(now); notify.ensureVapid();
      const fresh = notify.scan(now); out.events = fresh.length; out.pushed = await notify.deliver(fresh, { deadline }); out.done = true;
    } else if (step === 'data') {
      const minAgeMin = Number(process.env.DATA_REFRESH_MIN || 150);
      const r = await refreshData(now, { minAgeMin });
      settleAll(now); predictAll(now);
      const pf = await prefetch();
      Object.assign(out, r, { prefetched: pf }); out.done = r.left === 0;
      d.meta.lastRun = { ...(d.meta.lastRun || {}), at: now.toISOString(), ms: 0, settled: 0, predicted: Object.keys(d.predictions).length };
    } else if (step === 'ai') {
      out.news = await refreshNews(); // first: it is one quick call and the picks below can use up all the time
      out.researched = await addResearch(now); out.aiPicks = await addAiPicks(now); await resolveEarly(now);
      const pending = upcoming(now, 14 * DAY).filter((p) => p.best?.source !== 'ai' && (p.aiTries || 0) < 3).length;
      out.done = !ai.enabled() || pending === 0 || timeLeft() > 20000;
    } else if (step === 'web') {
      out.found = await addWebMatches(now); await resolveWebResults(now); out.webPicks = await addWebPicks(now);
      out.done = !ai.enabled() || !dbm.data().meta.webCursor;
    } else return { step, done: true, error: 'unknown step' };
    dbm.save();
  } catch (e) { dbm.log('error', 'pipeline', `${step}: ${e.message}`); out.error = e.message; out.done = true; }
  setDeadline(Infinity);
  return out;
}

async function run(now = new Date()) {
  resetTriesOnce();
  if (!provider()) {
    if (!warnedNoKey) { warnedNoKey = true; dbm.log('warn', 'pipeline', 'FOOTBALL_DATA_KEY is not set: no real data to load.'); }
    return { error: 'FOOTBALL_DATA_KEY not set' };
  }
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    await refreshData(now);
    const settled = settleAll(now);
    const predicted = predictAll(now);
    predictLive(now);
    const webFound = await addWebMatches(now);
    await resolveWebResults(now);
    const researched = await addResearch(now);
    const aiPicks = await addAiPicks(now);
    const webPicks = await addWebPicks(now);
    await resolveEarly(now);
    dbm.data().meta.lastRun = { at: now.toISOString(), ms: Date.now() - t0, settled, predicted, researched, aiPicks, webFound, webPicks };
    dbm.save();
    return dbm.data().meta.lastRun;
  } catch (e) {
    dbm.log('error', 'pipeline', e.message);
    return { error: e.message };
  } finally { running = false; }
}

function start() {
  const hours = Number(process.env.PIPELINE_HOURS || 3);
  const tick = () => { nextRunAt = new Date(Date.now() + hours * HOUR).toISOString(); run(); };
  setTimeout(tick, 1500);
  setInterval(tick, hours * HOUR).unref?.();
  const sec = Math.max(30, Number(process.env.LIVE_POLL_SEC || 60));
  setInterval(() => liveTick(), sec * 1000).unref?.();
}

module.exports = { runStep, maybeLive, liveTickHosted, predictLive, addWebMatches, addWebPicks, resolveWebResults, webCodes, start, run, liveTick, settleAll, predictAll, addResearch, addAiPicks, resolveEarly, remote, cached, isDemo, leagueCodes, provider, FREE_COMPETITIONS,
  state: () => ({ running, nextRunAt }) };
