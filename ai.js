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
api.generate = async function generate({ system, user, search = false, json = false, maxTokens = 4096, timeoutMs = 60000 }) {
  if (api.deadline) { const left = api.deadline - Date.now() - 2500; if (left < 6000) throw new AiError('Out of time for this run; will continue next run', false); timeoutMs = Math.min(timeoutMs, left); }
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
    let detail = ''; try { detail = (await r.json()).error?.message || ''; } catch { /* ignore */ }
    throw new AiError(`Gemini API HTTP ${r.status}${detail ? ': ' + detail.slice(0, 120) : ''}`, [400, 401, 403, 404, 429].includes(r.status));
  }
  const j = await r.json();
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri).map((w) => ({ title: String(w.title || w.uri).slice(0, 120), uri: w.uri }));
  const seen = new Set();
  return { text, sources: sources.filter((s) => !seen.has(s.uri) && seen.add(s.uri)).slice(0, 8) };
};

function parseJson(text, kind) {
  const re = kind === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const mt = text.match(re);
  if (!mt) throw new AiError(`Gemini reply had no JSON ${kind}`);
  try { return JSON.parse(mt[0]); } catch { throw new AiError('Gemini reply was not valid JSON'); }
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

const discoverSystem = (names) => `You find real upcoming football fixtures with Google Search. List matches kicking off in the date range given, but ONLY from these competitions, and write the competition field exactly as spelled here: ${names.join('; ')}. Include qualifiers and group/knockout stages of these competitions. Ignore every other competition, youth, women's and friendly matches.
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
const WEBPICK_SYSTEM = `You are a careful football analyst with Google Search. For each match in the JSON array, search for recent form, head-to-head, injuries and context, then choose ONE pick with the best chance of winning from this fixed list of SportyBet markets: ${WEB_MARKETS.join(', ')}. (1 = home win, X = draw, 2 = away win, 1X / X2 / 12 = double chance, DNB = draw no bet, BTTS = both teams to score.)
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

api.WEB_MARKETS = WEB_MARKETS;

api.enabled = enabled;
api.model = model;
api.AiError = AiError;
api.usage = () => ({ ...usage(), cap: dailyCap() });
module.exports = api;
