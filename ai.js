'use strict';
/**
 * Google Gemini integration.
 *  choose()   picks ONE candidate per match from a fixed list (cannot invent picks or numbers)
 *  research() uses Google Search grounding to find recent team news for matches
 *  news()     compiles recent football headlines from the web, with source links
 *  analyse()  writes a short explanation using ONLY the statistics we pass in
 * Failures never break the site: callers fall back to plain statistics.
 */
const dbm = require('./db');

const FALLBACK_MODEL = 'gemini-flash-latest'; // Google's alias for the newest Flash model
const found = { name: null, at: 0 };
const model = () => process.env.GEMINI_MODEL || found.name || FALLBACK_MODEL;

/** Models are retired often. Unless GEMINI_MODEL is set, ask Google which Flash models this key may use and take the newest. */
async function discoverModel() {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const list = ((await r.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n) || /^gemini-\d+(\.\d+)?-flash-preview/.test(n))
    .filter((n) => !/image|tts|audio|live|embed|robot|computer|thinking|exp/.test(n));
  const score = (n) => { const v = parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)[1]); return v * 10 + (/preview/.test(n) ? 0 : 1); };
  list.sort((a, b) => score(b) - score(a));
  return list[0] || null;
}
const enabled = () => !!process.env.GEMINI_API_KEY && process.env.AI_DISABLED !== '1';
const dailyCap = () => Number(process.env.AI_DAILY_CAP || 250);

class AiError extends Error { constructor(msg, fatal) { super(msg); this.fatal = !!fatal; } }
const api = {};

function usage() {
  const m = dbm.data().meta; const day = new Date().toISOString().slice(0, 10);
  if (!m.aiUsage || m.aiUsage.day !== day) m.aiUsage = { day, calls: 0 };
  return m.aiUsage;
}

/** One Gemini request. search=true turns on Google Search grounding (then JSON mode is unavailable, so we parse the text). */
/* Rate limit (HTTP 429): remember it and stop calling Gemini until it is over, instead of failing every call of every run. */
let block = null; // {until: ms, reason, daily}
api.getBlock = () => (block && block.until > Date.now() ? block : null);
api.setBlock = (b) => { block = b && b.until > Date.now() ? b : null; };
function noteRateLimit(detail, retryHeader) {
  const txt = String(detail || '');
  const daily = /PerDay|per day|daily/i.test(txt), perMin = /PerMinute|per minute/i.test(txt);
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(txt) || /retry in (\d+(?:\.\d+)?)s/i.exec(txt);
  const secs = m ? Math.ceil(Number(m[1])) + 2 : Number(retryHeader) || 65;
  const known = daily || perMin || !!m;
  const ms = daily ? Math.max(secs * 1000, 60 * 60000) : known ? Math.min(Math.max(secs, 20), 600) * 1000 : 5 * 60000; // unknown limit: wait 5 minutes
  block = { until: Date.now() + ms, daily, reason: daily ? 'daily quota used up' : perMin || m ? 'too many requests per minute' : 'quota or rate limit (Google did not say which)', at: new Date().toISOString() };
}

/** One tiny call without and one with web search, returning Google's raw answer. For finding out exactly why Gemini fails. */
api.diagnose = async function diagnose() {
  const one = async (search) => {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: search ? 'What is the date today? One short sentence.' : 'Reply with the word OK.' }] }], generationConfig: { maxOutputTokens: 40 }, ...(search ? { tools: [{ google_search: {} }] } : {}) }),
      });
      const t = await r.text();
      return { ok: r.ok, status: r.status, retryAfter: r.headers.get('retry-after'), answer: r.ok ? undefined : t.replace(/\s+/g, ' ').slice(0, 1200) };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  return { model: model(), enabled: enabled(), without_search: await one(false), with_search: await one(true), pausedByApp: api.getBlock() };
};

api.generate = async function generate({ system, user, search = false, json = false, maxTokens = 4096, timeoutMs = 60000 }) {
  if (api.deadline) { const left = api.deadline - Date.now() - 2500; if (left < 6000) throw new AiError('Out of time for this run; will continue next run', false); timeoutMs = Math.min(timeoutMs, left); }
  const bl = api.getBlock();
  if (bl) throw new AiError(`Gemini is rate-limited (${bl.reason}); paused until ${new Date(bl.until).toISOString().slice(11, 16)} UTC`, true);
  const u = usage();
  if (u.calls >= dailyCap()) throw new AiError(`Daily AI limit reached (${dailyCap()} requests). Resets at midnight UTC.`, true);
  u.calls++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: typeof user === 'string' ? user : JSON.stringify(user) }] }],
    generationConfig: { temperature: search ? 0.2 : 0.3, maxOutputTokens: maxTokens, ...(json && !search ? { responseMimeType: 'application/json' } : {}) },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
  const call = (m) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
    method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
  });
  let r;
  try {
    if (!process.env.GEMINI_MODEL && !found.name && Date.now() - found.at > 6 * 3600000) { found.at = Date.now(); try { found.name = (await discoverModel()) || null; } catch { /* use the alias */ } }
    r = await call(model());
    if (r.status === 404 && !process.env.GEMINI_MODEL) { // retired or not available to this key: look again and retry once
      let next = null; try { next = await discoverModel(); } catch { /* ignore */ }
      if (next && next !== model()) { found.name = next; found.at = Date.now(); r = await call(next); }
      else if (model() !== FALLBACK_MODEL) { found.name = null; r = await call(FALLBACK_MODEL); }
    }
  } catch (e) { throw new AiError(`Gemini request failed: ${e.name === 'AbortError' ? 'timeout' : e.message}`, false); } finally { clearTimeout(timer); }
  if (!r.ok) {
    let detail = '', raw = ''; try { const j = await r.json(); raw = JSON.stringify(j.error || {}); detail = j.error?.message || ''; } catch { /* ignore */ }
    if (r.status === 429) { noteRateLimit(raw + ' ' + detail, r.headers.get('retry-after')); u.calls = Math.max(0, u.calls - 1); }
    // for a 429, say which quota it is (per minute / per day, which model, free tier or not): that decides the fix
    const quota = r.status === 429 ? ((/"quotaId"\s*:\s*"([^"]+)"/.exec(raw) || [])[1] || '') + ((/"quotaValue"\s*:\s*"([^"]+)"/.exec(raw) || [])[1] ? ` limit ${(/"quotaValue"\s*:\s*"([^"]+)"/.exec(raw) || [])[1]}` : '') : '';
    throw new AiError(`Gemini API HTTP ${r.status}${quota ? ` [${quota}]` : ''}${detail ? ': ' + detail.slice(0, r.status === 429 ? 60 : 120) : ''} (${search ? 'with web search' : 'no search'}, ${model()})`, [400, 401, 403, 404, 429].includes(r.status));
  }
  const j = await r.json();
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri).map((w) => ({ title: String(w.title || w.uri).slice(0, 120), uri: w.uri }));
  const seen = new Set();
  return { text, sources: sources.filter((s) => !seen.has(s.uri) && seen.add(s.uri)).slice(0, 8) };
};

/** Finds the first JSON array/object in a reply that may also hold prose, citation marks like [1] or ```json fences. */
function parseJson(text, kind) {
  const open = kind === 'array' ? '[' : '{', close = kind === 'array' ? ']' : '}';
  const src = String(text || '').replace(/```(?:json)?/gi, '');
  for (let i = src.indexOf(open); i >= 0; i = src.indexOf(open, i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try { const v = JSON.parse(src.slice(i, j + 1)); if (kind === 'object' || v.length === 0 || (v[0] && typeof v[0] === 'object')) return v; } catch { /* not this one: try the next start */ }
        break;
      }
    }
  }
  throw new AiError(`Gemini reply had no JSON ${kind}`);
}
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/* -------------------------------------------------------------------------------------------- pick selection ------ */

const PICK_SYSTEM = `You are Predictx's football analyst and the one who makes the predictions. You receive a JSON array of upcoming matches. Each has statistics computed from real match data (expected goals, Elo, form, head-to-head, number of matches analysed), optional web_notes (recent team news found by web search; unverified), a list "safe" of candidate picks and a list "value" of higher-odds candidates. Every candidate has a model probability and "fair_odds" (= 1 / probability; the model's own estimate, NOT bookmaker odds). Pick names are SportyBet market names: 1 = home win, X = draw, 2 = away win, 1X / X2 / 12 = double chance, DNB = draw no bet, BTTS = both teams to score, HT = half-time, 1UP / 2UP = early payout, the bet wins once that team has led by 1 / 2 goals at any moment of the match.
For EACH match return TWO picks:
1. pick_id: from "safe", the pick most likely to win (accuracy first).
2. high_pick_id: from "value", the higher-odds pick you judge most likely to win, using team news, form, matchup and the numbers. Choose a value pick only when the evidence supports it; otherwise return null.
Rules: use only the supplied data; never invent injuries, lineups, odds or news; if the data is thin, say so and lean on the more probable candidate; higher odds always mean a lower chance; no pick is ever guaranteed.
Reply with a JSON array only, one object per match: [{"key":"<match key>","pick_id":"c1","high_pick_id":"h2","reason":"max 35 words citing the supplied stats","high_reason":"max 25 words","confidence":"Low|Medium|High"}]`;

const cand = (c) => ({ id: c.cid, pick: c.label, group: c.market, probability: +c.p.toFixed(3), fair_odds: c.odds });
function pickFacts(m) {
  return {
    key: m.key, league: m.league, match: `${m.home} (home) vs ${m.away} (away)`,
    expected_goals: { home: +m.xg.home.toFixed(2), away: +m.xg.away.toFixed(2) },
    elo: m.context.elo, recent_form_points_per_game_last5: m.context.form, head_to_head: m.context.h2h, matches_analysed: m.context.played,
    web_notes: m.notes?.length ? m.notes : undefined,
    safe: m.candidates.map(cand), value: (m.high || []).map(cand),
  };
}

/** items: [{key, league, home, away, xg, context, notes, candidates, high}] -> [{key, index, highIndex, reason, highReason, confidence}] (valid answers only) */
api.choose = async function choose(items) {
  const { text } = await api.generate({ system: PICK_SYSTEM, user: items.map(pickFacts), json: true });
  const arr = parseJson(text, 'array');
  const out = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const item = items.find((x) => x.key === o?.key);
    const index = item ? item.candidates.findIndex((c) => c.cid === o.pick_id) : -1;
    if (index < 0) continue; // unknown match or a pick that is not on the list: ignore
    const highIndex = (item.high || []).findIndex((c) => c.cid === o.high_pick_id);
    out.push({ key: item.key, index, highIndex, reason: clean(o.reason, 300), highReason: clean(o.high_reason, 200), confidence: ['Low', 'Medium', 'High'].includes(o.confidence) ? o.confidence : 'Medium' });
  }
  return out;
};

/* ---------------------------------------------------------------------------------------- web research / news ------ */

const RESEARCH_SYSTEM = `You research football matches with Google Search. For each match in the JSON array, find the most recent reliable team news (confirmed injuries, suspensions, expected lineup problems, managerial changes) published in the last few days by reputable outlets.
Rules: only report what the search results actually say; if you find nothing reliable for a match, return an empty notes array; never guess or invent; each note max 25 words and must name the team and the player or issue.
Reply with a JSON array only: [{"key":"<match key>","notes":["..."]}]`;

/** items: [{key, league, home, away, date}] -> {notes: {key: [..]}, sources: [{title, uri}]} */
api.research = async function research(items) {
  const { text, sources } = await api.generate({ system: RESEARCH_SYSTEM, user: items, search: true, maxTokens: 4096, timeoutMs: 90000 });
  const arr = parseJson(text, 'array');
  const notes = {};
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!items.some((x) => x.key === o?.key)) continue;
    notes[o.key] = (Array.isArray(o.notes) ? o.notes : []).map((n) => clean(n, 200)).filter(Boolean).slice(0, 3);
  }
  return { notes, sources };
};

const NEWS_SYSTEM = `You are a football news desk. Use Google Search to find the most important football news from the last 48 hours for the competitions given: results, injuries, transfers, managerial news, notable previews.
Rules: only report stories the search results actually contain; never invent; no betting tips; each item needs a short headline (max 14 words) and a neutral summary (max 30 words).
Reply with a JSON array only, 6 to 8 items: [{"title":"...","summary":"...","topic":"Result|Injury|Transfer|Manager|Preview|Other"}]`;

api.news = async function news(leagueNames) {
  const { text, sources } = await api.generate({ system: NEWS_SYSTEM, user: { competitions: leagueNames }, search: true, maxTokens: 3000, timeoutMs: 90000 });
  const arr = parseJson(text, 'array');
  const items = (Array.isArray(arr) ? arr : []).map((o) => ({
    title: clean(o.title, 120), summary: clean(o.summary, 260), topic: ['Result', 'Injury', 'Transfer', 'Manager', 'Preview', 'Other'].includes(o.topic) ? o.topic : 'Other',
  })).filter((o) => o.title).slice(0, 8);
  return { items, sources };
};

/* --------------------------------------------------------------------------------------------- match analysis ------ */

const ANALYSE_SYSTEM = `You are an AI football analyst. Explain a match using ONLY the JSON facts provided. Never add statistics, injuries or events that are not in the facts. Never say a result is certain or guaranteed; describe probabilities and uncertainty plainly. If data is thin, say so.
Reply with a JSON object only:
{"summary":"max 70 words","home_strengths":["max 3 items, each max 18 words"],"home_weaknesses":["..."],"away_strengths":["..."],"away_weaknesses":["..."],"key_insights":["max 4 items, each max 25 words, each citing a number from the facts"],"uncertainty":"max 40 words on what could make this analysis wrong"}`;

api.analyse = async function analyse(facts) {
  const { text } = await api.generate({ system: ANALYSE_SYSTEM, user: facts, json: true, maxTokens: 2048 });
  const o = parseJson(text, 'object');
  const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => clean(x, len)).filter(Boolean).slice(0, n);
  return {
    summary: clean(o.summary, 600), homeStrengths: list(o.home_strengths, 3, 160), homeWeaknesses: list(o.home_weaknesses, 3, 160),
    awayStrengths: list(o.away_strengths, 3, 160), awayWeaknesses: list(o.away_weaknesses, 3, 160),
    keyInsights: list(o.key_insights, 4, 220), uncertainty: clean(o.uncertainty, 360),
  };
};


/* ------------------------------------------------------------------------- matches found on the web ---------------- */

const discoverSystem = (names) => `You find real upcoming football fixtures with Google Search. Search only for the official match schedule (fixtures, dates and kick-off times) on competition, league, club or esports-organiser websites. Do not search for or use betting odds, bookmaker, tipster or gambling pages; this is a fixtures lookup only. List matches kicking off in the date range given, but ONLY from these competitions, and write the competition field exactly as spelled here: ${names.join('; ')}. Include qualifiers and group/knockout stages of these competitions. Ignore every other competition, youth, women's and friendly matches.
Rules: only list fixtures the search results actually show; never invent teams, dates or competitions; use full official club names; kickoff must be an ISO 8601 UTC timestamp (convert local times); skip matches whose kickoff time you cannot find; at most 25 matches, most important first. If a competition has no matches in the range (off-season, international break), skip it.
Reply with a JSON array only: [{"home":"...","away":"...","competition":"...","country":"...","kickoff":"2026-01-31T15:00:00Z"}]`;

/** -> {matches: [{home, away, competition, country, kickoff}], sources} (valid entries only) */
api.discover = async function discover(from, to, names = require('./competitions').NAMES) {
  const { text, sources } = await api.generate({ system: discoverSystem(names), user: { from, to }, search: true, maxTokens: 6000, timeoutMs: 120000 });
  const arr = parseJson(text, 'array');
  const matches = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const home = clean(o?.home, 60), away = clean(o?.away, 60), competition = clean(o?.competition, 60), t = new Date(o?.kickoff);
    if (!home || !away || !competition || home.toLowerCase() === away.toLowerCase() || isNaN(t)) continue;
    matches.push({ home, away, competition, country: clean(o.country, 40), kickoff: t.toISOString() });
  }
  return { matches: matches.slice(0, 40), sources };
};

const WEB_MARKETS = ['1', 'X', '2', '1X', 'X2', '12', 'DNB 1', 'DNB 2', 'Over 1.5', 'Over 2.5', 'Under 2.5', 'Under 3.5', 'BTTS Yes', 'BTTS No', 'Home Over 0.5', 'Away Over 0.5'];
const WEBPICK_SYSTEM = `You are a careful football analyst with Google Search. For each match in the JSON array, search for recent form, head-to-head, injuries and context, then choose ONE pick with the best chance of winning from this fixed list of prediction markets (labels only; you are not looking at or giving betting advice, and you must not search for odds or bookmaker pages): ${WEB_MARKETS.join(', ')}. (1 = home win, X = draw, 2 = away win, 1X / X2 / 12 = double chance, DNB = draw no bet, BTTS = both teams to score.)
Rules: base the pick only on what you actually find; give your honest probability estimate (0.30 to 0.95) that the pick wins; never invent news; no pick is guaranteed; if you find little information, choose a safer market and say so.
Reply with a JSON array only: [{"key":"<match key>","pick":"1X","probability":0.72,"confidence":"Low|Medium","reason":"max 35 words citing what you found"}]`;

/** items: [{key, competition, home, away, kickoff}] -> [{key, pick, p, confidence, reason}] plus sources */
api.pickWeb = async function pickWeb(items) {
  const { text, sources } = await api.generate({ system: WEBPICK_SYSTEM, user: items, search: true, maxTokens: 4096, timeoutMs: 120000 });
  const arr = parseJson(text, 'array');
  const out = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const pick = clean(o?.pick, 20), p = Number(o?.probability);
    if (!items.some((x) => x.key === o?.key) || !WEB_MARKETS.includes(pick) || !(p >= 0.3 && p <= 0.95)) continue;
    out.push({ key: o.key, pick, p: Math.round(p * 100) / 100, confidence: o.confidence === 'Medium' ? 'Medium' : 'Low', reason: clean(o.reason, 300) });
  }
  return { picks: out, sources };
};

const RESULTS_SYSTEM = `You look up final football scores with Google Search. For each match in the JSON array, find the final full-time score (90 minutes plus stoppage time, excluding extra time and penalties) and the half-time score if shown.
Rules: only report a score if a reliable source shows the match has finished; otherwise set finished to false; never guess.
Reply with a JSON array only: [{"key":"<match key>","finished":true,"home_goals":2,"away_goals":1,"ht_home":1,"ht_away":0}] (ht_* may be null)`;

/** items: [{key, competition, home, away, kickoff}] -> [{key, ft:[h,a], ht:[h,a]|null}] for finished matches only */
api.results = async function results(items) {
  const { text } = await api.generate({ system: RESULTS_SYSTEM, user: items, search: true, maxTokens: 3000, timeoutMs: 90000 });
  const arr = parseJson(text, 'array');
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 20;
  const out = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!items.some((x) => x.key === o?.key) || o.finished !== true || !ok(o.home_goals) || !ok(o.away_goals)) continue;
    const ht = ok(o.ht_home) && ok(o.ht_away) && o.ht_home <= o.home_goals && o.ht_away <= o.away_goals ? [o.ht_home, o.ht_away] : null;
    out.push({ key: o.key, ft: [o.home_goals, o.away_goals], ht });
  }
  return out;
};

/* ------------------------------------------------------------------------------- eFootball / EsportsBattle ----------- */

const discoverEsportsSystem = (names) => `You find upcoming eFootball esports matches (EsportsBattle, virtual football played by real gamers) with Google Search. Look at the official EsportsBattle schedule and other public esports schedules. Search only for the official match schedule (fixtures, dates and kick-off times) on competition, league, club or esports-organiser websites. Do not search for or use betting odds, bookmaker, tipster or gambling pages; this is a fixtures lookup only. List matches in the time range given from these competitions, writing the competition field exactly as spelled here: ${names.join('; ')}. Also include any other eFootball / EsportsBattle competition you find, named "EsportsBattle - <name>".
Rules: only list matches the search results actually show; never invent teams, players or times; write each side as shown, for example "Barcelona (Nikolay)" (club and the gamer in brackets when the source gives the gamer); kickoff must be an ISO 8601 UTC timestamp: use the time zone the source states and convert it to UTC carefully (EsportsBattle lists times in a stated zone); skip matches whose time or time zone you cannot establish; at most 30 matches, the soonest first.
Reply with a JSON array only: [{"home":"...","away":"...","competition":"...","kickoff":"2026-01-31T15:00:00Z"}]`;

api.discoverEsports = async function discoverEsports(from, to, names = require('./competitions').ESPORTS) {
  const { text, sources } = await api.generate({ system: discoverEsportsSystem(names), user: { from, to }, search: true, maxTokens: 6000, timeoutMs: 120000 });
  const arr = parseJson(text, 'array');
  const matches = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const home = clean(o?.home, 70), away = clean(o?.away, 70), competition = clean(o?.competition, 70), t = new Date(o?.kickoff);
    if (!home || !away || !competition || home.toLowerCase() === away.toLowerCase() || isNaN(t)) continue;
    matches.push({ home, away, competition, country: 'eSports', kickoff: t.toISOString() });
  }
  return { matches: matches.slice(0, 40), sources };
};


const ES_RESEARCH_SYSTEM = `Research the named upcoming eFootball esports matches using Google Search. Find verifiable recent results for each named gamer, goals scored and conceded, recent form, head-to-head meetings, and competition context. Search official EsportsBattle schedules/results and reputable esports match-result pages. Do not use betting, bookmaker, odds, tipster or gambling pages. Never infer missing scores or invent results. Return null for unavailable statistics. Include only source-backed facts and explain the sample size and date range. JSON array only: [{"key":"match key","home_recent_results":["W 3-2"],"away_recent_results":["L 1-4"],"home_goals_for_avg":3.2,"home_goals_against_avg":2.1,"away_goals_for_avg":2.4,"away_goals_against_avg":2.8,"head_to_head":{"played":2,"home_wins":1,"draws":0,"away_wins":1,"summary":"..."}, "sample_size":{"home":5,"away":5},"competition_context":"...","data_as_of":"ISO timestamp","limitations":"..."}]`;
api.researchEsports = async function researchEsports(items) {
  const { text, sources } = await api.generate({ system: ES_RESEARCH_SYSTEM, user: items, search: true, maxTokens: 5000, timeoutMs: 45000 });
  const arr = parseJson(text, 'array');
  const out = [];
  const num = (v) => Number.isFinite(Number(v)) && v !== null ? Math.max(0, Math.min(30, Number(v))) : null;
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => clean(x, 100)).filter(Boolean).slice(0, 5);
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!items.some((x) => x.key === o?.key)) continue;
    const h2h = o.head_to_head && typeof o.head_to_head === 'object' ? {
      played: Number.isInteger(o.head_to_head.played) ? Math.max(0, o.head_to_head.played) : null,
      home_wins: Number.isInteger(o.head_to_head.home_wins) ? Math.max(0, o.head_to_head.home_wins) : null,
      draws: Number.isInteger(o.head_to_head.draws) ? Math.max(0, o.head_to_head.draws) : null,
      away_wins: Number.isInteger(o.head_to_head.away_wins) ? Math.max(0, o.head_to_head.away_wins) : null,
      summary: clean(o.head_to_head.summary, 240),
    } : null;
    out.push({ key:o.key, home_recent_results:list(o.home_recent_results), away_recent_results:list(o.away_recent_results),
      home_goals_for_avg:num(o.home_goals_for_avg), home_goals_against_avg:num(o.home_goals_against_avg),
      away_goals_for_avg:num(o.away_goals_for_avg), away_goals_against_avg:num(o.away_goals_against_avg),
      head_to_head:h2h, sample_size:{home:Number.isInteger(o.sample_size?.home)?Math.max(0,o.sample_size.home):0,away:Number.isInteger(o.sample_size?.away)?Math.max(0,o.sample_size.away):0},
      competition_context:clean(o.competition_context,300), data_as_of:clean(o.data_as_of,40), limitations:clean(o.limitations,300),
      sources:sources.slice(0,8), retrievedAt:new Date().toISOString() });
  }
  return out;
};

const ES_MARKETS = ['1', 'X', '2', '1X', 'X2', '12', 'DNB 1', 'DNB 2', 'Over 3.5', 'Over 4.5', 'Over 5.5', 'Under 4.5', 'Under 5.5', 'Under 6.5', 'BTTS Yes', 'BTTS No', 'Home Over 1.5', 'Away Over 1.5'];
const ESPICK_SYSTEM = `You are a careful analyst of eFootball esports (EsportsBattle: virtual football, 2 halves of 4 or 6 minutes, played by real gamers who control the club). Each side is a club played by a named gamer. The gamer's recent form matters far more than the real-life club. For each match in the JSON array, search for the two gamers' recent results, goals scored and conceded per match, head-to-head and the tournament's average goals, then choose TWO picks from this fixed list: ${ES_MARKETS.join(', ')}. (1 = home win, X = draw, 2 = away win, 1X / X2 / 12 = double chance, DNB = draw no bet, BTTS = both score.) "pick" is the one most likely to win. "high_pick" is a bolder, less likely prediction you still find supported by the form data, or null. Search only for gamer form and results, never for odds or bookmaker pages.
Rules: base the picks only on what you actually find; give honest probability estimates (0.20 to 0.95); never invent results; esports results are very random, so say so when the data is thin and prefer a safer market; no pick is guaranteed.
Reply with a JSON array only: [{"key":"<match key>","pick":"Over 4.5","probability":0.7,"high_pick":"1","high_probability":0.4,"confidence":"Low|Medium","reason":"max 35 words citing what you found"}]`;

api.pickEsports = async function pickEsports(items) {
  const { text, sources } = await api.generate({ system: ESPICK_SYSTEM, user: items, search: true, maxTokens: 4096, timeoutMs: 120000 });
  const arr = parseJson(text, 'array');
  const out = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    const pick = clean(o?.pick, 20), p = Number(o?.probability);
    if (!items.some((x) => x.key === o?.key) || !ES_MARKETS.includes(pick) || !(p >= 0.2 && p <= 0.95)) continue;
    const hp = clean(o?.high_pick, 20), hpp = Number(o?.high_probability);
    const high = ES_MARKETS.includes(hp) && hp !== pick && hpp >= 0.15 && hpp < 0.6 ? { pick: hp, p: Math.round(hpp * 100) / 100 } : null;
    out.push({ key: o.key, pick, p: Math.round(p * 100) / 100, high, confidence: o.confidence === 'Medium' ? 'Medium' : 'Low', reason: clean(o.reason, 300) });
  }
  return { picks: out, sources };
};

const ES_RESULTS_SYSTEM = `You look up final scores of eFootball esports matches (EsportsBattle, virtual football played by gamers) with Google Search. For each match in the JSON array, find the final full-time score of the match (2 halves; include any golden-goal/extra time only if the source counts it in the final score) and the half-time score if shown.
Rules: only report a score if a reliable source shows the match has finished; otherwise set finished to false; never guess.
Reply with a JSON array only: [{"key":"<match key>","finished":true,"home_goals":3,"away_goals":2,"ht_home":1,"ht_away":1}] (ht_* may be null)`;

api.resultsEsports = async function resultsEsports(items) {
  const { text } = await api.generate({ system: ES_RESULTS_SYSTEM, user: items, search: true, maxTokens: 3000, timeoutMs: 90000 });
  const arr = parseJson(text, 'array');
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 20;
  const out = [];
  for (const o of Array.isArray(arr) ? arr : []) {
    if (!items.some((x) => x.key === o?.key) || o.finished !== true || !ok(o.home_goals) || !ok(o.away_goals)) continue;
    const ht = ok(o.ht_home) && ok(o.ht_away) && o.ht_home <= o.home_goals && o.ht_away <= o.away_goals ? [o.ht_home, o.ht_away] : null;
    out.push({ key: o.key, ft: [o.home_goals, o.away_goals], ht });
  }
  return out;
};

api.WEB_MARKETS = WEB_MARKETS;

api.enabled = enabled;
api.model = model;
api.AiError = AiError;
api.usage = () => ({ ...usage(), cap: dailyCap(), blockedUntil: api.getBlock()?.until ? new Date(api.getBlock().until).toISOString() : null, blockedReason: api.getBlock()?.reason || null });
module.exports = api;
