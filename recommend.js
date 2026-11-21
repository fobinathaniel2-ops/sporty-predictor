'use strict';
/**
 * Recommended picks for one day.
 *
 * Nothing here can make a pick certain. The aim is to be picky: only matches where the
 * statistics model is clearly confident AND it has enough data, using simple markets, and
 * with the bar raised automatically if our own verified history shows the model is
 * over-confident. If few matches qualify, the list is short (or empty) instead of padded.
 */
const accuracy = require('./accuracy');

// Simple, low-noise markets only (no correct score, HT/FT, BTTS, early payout).
const SAFE = new Set(['1', '2', '1X', 'X2', '12', 'DNB 1', 'DNB 2', 'Over 0.5', 'Over 1.5', 'Under 3.5', 'Under 4.5']);
// If the AI's pick is on the left, it also backs everything listed on the right.
const IMPLIES = { 1: ['1X', '12', 'DNB 1'], 2: ['X2', '12', 'DNB 2'], 'DNB 1': ['1X'], 'DNB 2': ['X2'], 'Over 2.5': ['Over 1.5', 'Over 0.5'], 'Over 1.5': ['Over 0.5'], 'Under 2.5': ['Under 3.5', 'Under 4.5'], 'Under 3.5': ['Under 4.5'] };
const SIDE = { 1: 'H', '1X': 'H', 'DNB 1': 'H', 2: 'A', X2: 'A', 'DNB 2': 'A' }; // which team a pick backs
const SLIP_MAX = 4, SLIP_MIN_COMBINED = 0.5; // never stack picks below a 50% chance of all winning
const BASE_MIN = 0.72, MAX_P = 0.93, MAX_PICKS = 10;

const agrees = (bestId, id) => bestId === id || (IMPLIES[bestId] || []).includes(id);

/** How far our verified hit rate falls short of the probabilities we claimed (0 when not enough history). */
function overconfidence(acc) {
  const rows = (acc.calibration || []).filter((b) => b.n > 0 && b.predicted != null && b.actual != null);
  const n = rows.reduce((s, b) => s + b.n, 0);
  if (n < 30) return { gap: 0, n };
  const pred = rows.reduce((s, b) => s + b.predicted * b.n, 0) / n, act = rows.reduce((s, b) => s + b.actual * b.n, 0) / n;
  return { gap: Math.max(0, pred - act), n };
}

function recommend(d, { from, to, now = Date.now(), includeDemo = false }) {
  const acc = accuracy.compute(d, { includeDemo });
  const oc = overconfidence(acc);
  const minP = Math.min(0.85, BASE_MIN + oc.gap);
  const lo = new Date(from).getTime(), hi = new Date(to).getTime();
  const picks = [];
  let considered = 0;

  for (const m of Object.values(d.matches)) {
    const t = new Date(m.date).getTime();
    if (!(t >= lo && t < hi) || t <= now || m.status === 'LIVE' || m.status === 'FINISHED') continue;
    const p = d.predictions[m.id];
    if (!p || !p.pm || p.late || p.void || p.web) continue;
    if (!includeDemo && d.leagues[m.league]?.demo) continue;
    considered++;
    if (p.confidence === 'Low') continue; // too little data, or the model is not clear
    let best = null;
    for (const id of SAFE) {
      const v = p.pm[id];
      if (v == null || v < minP || v > MAX_P) continue;
      if (!best || v > best.p) best = { id, p: v };
    }
    if (!best) continue;
    const aiAgrees = p.best?.source === 'ai' && agrees(p.best.id, best.id);
    const aiDisagrees = p.best?.source === 'ai' && SIDE[p.best.id] && SIDE[best.id] && SIDE[p.best.id] !== SIDE[best.id];
    if (aiDisagrees) continue; // two methods disagree: not a safe pick
    const band = (acc.calibration || []).find((b) => best.p >= parseInt(b.range, 10) / 100 && best.p < (parseInt(String(b.range).split('-')[1], 10) / 100 || 1));
    picks.push({
      matchId: m.id, league: d.leagues[m.league]?.name || m.league, date: m.date,
      home: m.home.name, away: m.away.name, homeCrest: m.home.crest || null, awayCrest: m.away.crest || null,
      pick: best.id, p: best.p, odds: +(1 / best.p).toFixed(2), confidence: p.confidence,
      aiAgrees, score: best.p + (aiAgrees ? 0.04 : 0) + (p.confidence === 'High' ? 0.02 : 0),
      history: band && band.n >= 10 ? { n: band.n, actual: band.actual } : null,
    });
  }
  picks.sort((a, b) => b.score - a.score);
  // The slip is chosen for the user: the strongest picks, added while the whole slip still has a fair chance.
  const slip = [];
  let comb = 1;
  for (const x of picks) {
    if (slip.length >= SLIP_MAX) break;
    if (slip.length && comb * x.p < SLIP_MIN_COMBINED) continue;
    slip.push(x.matchId); comb *= x.p;
  }
  return {
    slip: { ids: slip, combined: slip.length ? +comb.toFixed(3) : null, odds: slip.length ? +(1 / comb).toFixed(2) : null },
    from, to, considered, minP, overconfident: oc.gap > 0.03, history: { verified: acc.best.total, hitRate: acc.best.accuracy },
    picks: picks.slice(0, MAX_PICKS).map(({ score, ...x }) => x),
  };
}
module.exports = { recommend, agrees, SAFE };
