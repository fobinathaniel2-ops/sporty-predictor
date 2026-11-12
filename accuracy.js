'use strict';
/** Accuracy is computed ONLY from stored picks that were verified against real results. Voided/unverifiable picks are excluded. */

const pct = (c, t) => (t ? c / t : null);

function periodKey(iso, kind) {
  const d = new Date(iso);
  if (kind === 'monthly') return iso.slice(0, 7);
  if (kind === 'weekly') {
    const day = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}

function compute(d, { includeDemo }) {
  const settled = Object.values(d.predictions).filter((p) => p.settled && !p.void && p.actual && (includeDemo || !d.leagues[p.league]?.demo));
  const preds = settled.filter((p) => !p.late && !p.web && !p.esports);
  const side = (list) => { const ok = list.filter((p) => p.best && typeof p.best.correct === 'boolean'); const c = ok.filter((p) => p.best.correct).length; return { total: ok.length, correct: c, accuracy: pct(c, ok.length) }; };
  const tally = () => ({ total: 0, correct: 0 });
  const add = (map, key, ok) => { const t = map[key] || (map[key] = tally()); t.total++; if (ok) t.correct++; };

  const best = tally(), ai = tally(), stats = tally(), statsOnAi = tally();
  const byMarket = {}, byLeague = {}, byPick = {}, byConfidence = {};
  const series = { daily: {}, weekly: {}, monthly: {} };
  let homeWins = 0, unverified = 0, calib = [];

  for (const p of preds) {
    const b = p.best;
    if (b && typeof b.correct === 'boolean') {
      best.total++; if (b.correct) best.correct++;
      add(byLeague, d.leagues[p.league]?.name || p.league, b.correct);
      add(byMarket, b.market, b.correct);
      add(byPick, b.label, b.correct);
      add(byConfidence, p.confidence, b.correct);
      calib.push([b.p, b.correct ? 1 : 0]);
      for (const kind of ['daily', 'weekly', 'monthly']) add(series[kind], periodKey(p.kickoff, kind), b.correct);
      if (b.source === 'ai') { ai.total++; if (b.correct) ai.correct++; }
    } else if (b) unverified++;
    const s = p.statsBest;
    if (s && typeof s.correct === 'boolean') {
      stats.total++; if (s.correct) stats.correct++;
      if (b?.source === 'ai') { statsOnAi.total++; if (s.correct) statsOnAi.correct++; }
    }
    if (p.actual.result === '1') homeWins++;
  }

  const rows = (map, order) => Object.entries(map).map(([key, t]) => ({ key, ...t, accuracy: pct(t.correct, t.total) })).sort(order || ((a, b) => b.total - a.total));
  const limit = { daily: 30, weekly: 12, monthly: 12 };
  const ser = {};
  for (const kind of Object.keys(series)) ser[kind] = rows(series[kind], (a, b) => (a.key < b.key ? -1 : 1)).slice(-limit[kind]);

  // calibration: do 70% picks win about 70% of the time?
  const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.91]].map(([lo, hi]) => {
    const xs = calib.filter(([p]) => p >= lo && p < hi);
    return { range: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, n: xs.length, predicted: xs.length ? xs.reduce((s, [p]) => s + p, 0) / xs.length : null, actual: xs.length ? xs.reduce((s, [, o]) => s + o, 0) / xs.length : null };
  }).filter((b) => b.n);

  const recent = preds.sort((a, b) => (a.kickoff < b.kickoff ? 1 : -1)).slice(0, 20).map((p) => {
    const m = d.matches[p.matchId] || {};
    return { id: p.matchId, home: m.home?.name, away: m.away?.name, date: p.kickoff, ft: p.actual.ft, best: p.best };
  });

  const order = (a, b) => ['High', 'Medium', 'Low'].indexOf(a.key) - ['High', 'Medium', 'Low'].indexOf(b.key);
  return {
    includesDemo: includeDemo, matchesVerified: preds.length, unverified,
    pending: Object.values(d.predictions).filter((p) => !p.settled).length,
    best: { ...best, incorrect: best.total - best.correct, accuracy: pct(best.correct, best.total) },
    ai: { ...ai, accuracy: pct(ai.correct, ai.total) },
    stats: { ...stats, accuracy: pct(stats.correct, stats.total) },
    statsOnAiMatches: { ...statsOnAi, accuracy: pct(statsOnAi.correct, statsOnAi.total) },
    alwaysHomeAccuracy: pct(homeWins, preds.length),
    byMarket: rows(byMarket), byPick: rows(byPick).slice(0, 12), byLeague: rows(byLeague), byConfidence: rows(byConfidence, order), calibration: buckets,
    series: ser, recent,
    highOdds: (() => { const ok = preds.filter((p) => p.high && typeof p.high.correct === 'boolean'); const c = ok.filter((p) => p.high.correct); const avg = (l) => (l.length ? +(l.reduce((a, p) => a + (p.high.odds || 0), 0) / l.length).toFixed(2) : null);
      const aiOk = ok.filter((p) => p.high.source === 'ai'); const aiC = aiOk.filter((p) => p.high.correct);
      // return on a flat 1-unit stake at the model's own fair odds (NOT bookmaker odds), shown only as a sanity check
      const roi = ok.length ? +(c.reduce((a, p) => a + (p.high.odds || 0), 0) / ok.length - 1).toFixed(3) : null;
      return { total: ok.length, correct: c.length, accuracy: pct(c.length, ok.length), avgFairOdds: avg(ok), ai: { total: aiOk.length, correct: aiC.length, accuracy: pct(aiC.length, aiOk.length) }, fairOddsReturn: roi }; })(),
    livePicks: side(settled.filter((p) => p.late)), webPicks: side(settled.filter((p) => p.web && !p.late && !p.esports)), esportsPicks: side(settled.filter((p) => p.esports)),
  };
}

module.exports = { compute };
