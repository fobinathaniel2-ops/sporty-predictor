'use strict';
/**
 * Explainable match analysis built only from stored data. Every sentence is derived from a number we hold.
 * The AI (if enabled) may rephrase this, but it is given nothing else.
 */
const stats = require('./stats');

const pc = (x) => `${Math.round(x * 100)}%`;
const edge = (h, a, margin, higherBetter = true) => {
  if (h == null || a == null) return 'unknown';
  const diff = higherBetter ? h - a : a - h;
  return Math.abs(diff) < margin ? 'even' : diff > 0 ? 'home' : 'away';
};

function profile(d, teamId, code) {
  const rec = stats.teamRecord(d, teamId);
  const ls = stats.leagueStats(d, code);
  const row = ls.teams.find((t) => t.team.id === teamId) || null;
  const avg = ls.summary ? (ls.summary.avgHomeGoals + ls.summary.avgAwayGoals) / 2 : null;
  return { rec, row, leagueAvgGoals: avg, leagueMatches: ls.matches };
}

function strengthsOf(name, pr, side) {
  const out = { strengths: [], weaknesses: [] };
  const r = pr.rec, avg = pr.leagueAvgGoals;
  const t = r.total, loc = side === 'home' ? r.home : r.away, where = side === 'home' ? 'at home' : 'away from home';
  if (t.p >= 5 && avg) {
    if (t.gfpg >= avg * 1.15) out.strengths.push(`Scores ${t.gfpg} goals per game, above the league average of ${stats.r2(avg)}.`);
    else if (t.gfpg <= avg * 0.85) out.weaknesses.push(`Scores only ${t.gfpg} goals per game, below the league average of ${stats.r2(avg)}.`);
    if (t.gapg <= avg * 0.85) out.strengths.push(`Concedes only ${t.gapg} goals per game (league average ${stats.r2(avg)}).`);
    else if (t.gapg >= avg * 1.15) out.weaknesses.push(`Concedes ${t.gapg} goals per game, more than the league average of ${stats.r2(avg)}.`);
  }
  if (t.p >= 5 && t.csPct >= 40) out.strengths.push(`Kept a clean sheet in ${t.csPct}% of ${t.p} games.`);
  if (t.p >= 5 && t.csPct !== null && t.csPct <= 10) out.weaknesses.push(`Rarely keeps a clean sheet (${t.cs} in ${t.p} games).`);
  if (loc.p >= 3) {
    if (loc.ppg >= 2) out.strengths.push(`Strong ${where}: ${loc.ppg} points per game over ${loc.p} matches.`);
    else if (loc.ppg <= 0.9) out.weaknesses.push(`Struggles ${where}: ${loc.ppg} points per game over ${loc.p} matches.`);
  }
  if (r.formPpg !== null && r.form.length >= 3) {
    if (r.formPpg >= 2.2) out.strengths.push(`In good form: ${r.form.split('').join(' ')} in the last ${r.form.length} (${r.formPpg} points per game).`);
    else if (r.formPpg <= 0.8) out.weaknesses.push(`In poor form: ${r.form.split('').join(' ')} in the last ${r.form.length} (${r.formPpg} points per game).`);
  }
  return out;
}

/** Build the deterministic analysis for one match. `pred` is the stored prediction (may be absent). */
function analyse(d, m, pred) {
  const code = m.league;
  const H = profile(d, m.home.id, code), A = profile(d, m.away.id, code);
  const h2h = stats.h2h(d, m.home.id, m.away.id, 8);
  const factors = [];
  const full = !!pred && pred.lh != null && pred.pm['1'] !== undefined && pred.pm.X !== undefined && !pred.late;
  const ctx = pred?.context;
  if (ctx) factors.push({ key: 'elo', label: 'Team strength (Elo)', home: ctx.elo.home, away: ctx.elo.away, edge: edge(ctx.elo.home, ctx.elo.away, 40), note: 'Rating built from every stored result; a home advantage of 65 points is applied in the model.' });
  factors.push({ key: 'form', label: 'Recent form (points per game, last 5)', home: H.rec.formPpg, away: A.rec.formPpg, edge: edge(H.rec.formPpg, A.rec.formPpg, 0.5), note: 'Short samples swing quickly; treat as context, not proof.' });
  factors.push({ key: 'attack', label: 'Goals scored per game (home team at home, away team away)', home: H.rec.home.gfpg, away: A.rec.away.gfpg, edge: edge(H.rec.home.gfpg, A.rec.away.gfpg, 0.3), note: 'Venue-specific scoring rate this season.' });
  factors.push({ key: 'defence', label: 'Goals conceded per game (home team at home, away team away)', home: H.rec.home.gapg, away: A.rec.away.gapg, edge: edge(H.rec.home.gapg, A.rec.away.gapg, 0.3, false), note: 'Lower is better.' });
  if (full) factors.push({ key: 'xg', label: 'Expected goals (model)', home: Math.round(pred.lh * 100) / 100, away: Math.round(pred.la * 100) / 100, edge: edge(pred.lh, pred.la, 0.25), note: 'Computed from attack and defence strengths, form and head-to-head.' });
  if (h2h.meetings) factors.push({ key: 'h2h', label: `Head-to-head (last ${h2h.meetings})`, home: `${h2h.aWins}W`, away: `${h2h.bWins}W`, edge: edge(h2h.aWins, h2h.bWins, 1), note: `${h2h.draws} draws; goals ${h2h.aGoals}-${h2h.bGoals}.` });

  const sh = strengthsOf(m.home.name, H, 'home'), sa = strengthsOf(m.away.name, A, 'away');

  // uncertainty: say plainly why this analysis could be wrong
  const reasons = [];
  const depth = Math.min(H.rec.total.p, A.rec.total.p);
  if (depth < 10) reasons.push(`Small sample: only ${depth} current-season matches for ${H.rec.total.p <= A.rec.total.p ? m.home.name : m.away.name}.`);
  if (full) {
    const top = Math.max(pred.pm['1'], pred.pm.X, pred.pm['2']);
    if (top < 0.45) reasons.push('No clear favourite: the three results are close in probability.');
    const eloEdge = factors.find((f) => f.key === 'elo')?.edge, formEdge = factors.find((f) => f.key === 'form')?.edge;
    if (eloEdge && formEdge && eloEdge !== 'even' && formEdge !== 'even' && eloEdge !== formEdge) reasons.push('Long-term strength and recent form point in opposite directions.');
  }
  if (h2h.meetings < 2) reasons.push('Little head-to-head history in the stored data.');
  reasons.push('Injuries, lineups and motivation are not in the statistics (web notes, when present, are unverified).');
  const level = reasons.length >= 4 ? 'High' : reasons.length >= 3 ? 'Medium' : 'Low';

  let summary = `${m.home.name} host ${m.away.name}.`;
  if (full) {
    summary += ` The model gives ${m.home.name} ${pc(pred.pm['1'])}, a draw ${pc(pred.pm.X)} and ${m.away.name} ${pc(pred.pm['2'])}, with expected goals of ${Math.round(pred.lh * 100) / 100} to ${Math.round(pred.la * 100) / 100}.`;
    summary += ` Over 2.5 goals is ${pc(pred.pm['Over 2.5'])} and both teams scoring is ${pc(pred.pm['BTTS Yes'])}.`;
  } else if (pred?.late) summary += ' This match is in play, so the pick uses the current score and the time left.';
  else if (pred?.web) summary += ' This match was found by web search and has no stored statistics, so the pick is Gemini\'s own estimate.';
  else summary += ' There is not enough data for a prediction yet.';
  if (h2h.meetings >= 2) summary += ` In their last ${h2h.meetings} meetings: ${m.home.name} ${h2h.aWins}, draws ${h2h.draws}, ${m.away.name} ${h2h.bWins}.`;

  return {
    summary, factors,
    home: { name: m.home.name, ...sh, form: H.rec.form, record: H.rec.total, position: H.row ? H.rec.total.p : null },
    away: { name: m.away.name, ...sa, form: A.rec.form, record: A.rec.total },
    h2h: { ...h2h, matches: h2h.matches.map((x) => ({ id: x.id, date: x.date, home: x.home.name, away: x.away.name, score: `${x.ft[0]}-${x.ft[1]}` })) },
    uncertainty: { level, reasons, depth },
  };
}

module.exports = { analyse };
