'use strict';
/**
 * Prediction engine.
 *  - Time-decayed Poisson attack/defence strengths (home/away split, shrunk toward team overall)
 *  - Elo ratings built chronologically from results (blended 25%)
 *  - Small adjustments for recent form (last 5) and head-to-head (last 5)
 *  - Optional blend with bookmaker odds (margin removed)
 * Outputs probabilities only. No guarantees.
 */
const { scoreMatrix, summarize, poisson } = require('./model');

const DAY = 86400000;
const MODEL_VERSION = '3.0';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function seasonOf(iso) {
  const d = new Date(iso);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

const ZERO = { w: 0, gf: 0, ga: 0, n: 0 };

function buildModel(finished, asOf = new Date(), opts = {}) {
  const HL = opts.halfLife || 150; // days
  const K = opts.shrink || 4;
  const ms = finished
    .filter((m) => m.ft && new Date(m.date) < asOf)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (ms.length < 30) return { ok: false, n: ms.length, reason: `Only ${ms.length} finished matches available (need 30+).` };

  const elo = {}, tally = {}, recent = {}, h2h = {};
  let sw = 0, shg = 0, sag = 0, ftw = 0, htw = 0;
  const T = (id) => tally[id] || (tally[id] = { h: { ...ZERO }, a: { ...ZERO } });

  for (const m of ms) {
    const h = m.home.id, a = m.away.id, [hg, ag] = m.ft;
    const w = Math.pow(0.5, (asOf - new Date(m.date)) / DAY / HL);
    sw += w; shg += w * hg; sag += w * ag;
    if (m.ht) { ftw += w * (hg + ag); htw += w * (m.ht[0] + m.ht[1]); }
    const th = T(h).h, ta = T(a).a;
    th.w += w; th.gf += w * hg; th.ga += w * ag; th.n++;
    ta.w += w; ta.gf += w * ag; ta.ga += w * hg; ta.n++;

    const rh = elo[h] ?? 1500, ra = elo[a] ?? 1500;
    const E = 1 / (1 + Math.pow(10, -(rh - ra + 65) / 400));
    const S = hg > ag ? 1 : hg === ag ? 0.5 : 0;
    const gd = Math.abs(hg - ag);
    const G = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
    const d = 20 * G * (S - E);
    elo[h] = rh + d; elo[a] = ra - d;

    (recent[h] || (recent[h] = [])).push(hg > ag ? 3 : hg === ag ? 1 : 0);
    (recent[a] || (recent[a] = [])).push(ag > hg ? 3 : hg === ag ? 1 : 0);
    const key = h < a ? `${h}|${a}` : `${a}|${h}`;
    (h2h[key] || (h2h[key] = [])).push({ home: h, gd: hg - ag });
  }
  return {
    ok: true, n: ms.length, K, asOf,
    Lh: shg / sw, La: sag / sw,
    htShare: ftw > 0 ? clamp(htw / ftw, 0.3, 0.55) : 0.44,
    elo, tally, recent, h2h,
  };
}

function strengths(model, id) {
  const { Lh, La, K } = model;
  const H = model.tally[id]?.h || ZERO, A = model.tally[id]?.a || ZERO;
  const w = H.w + A.w;
  const attAll = w > 0 ? (H.gf / Lh + A.gf / La) / w : 1;
  const defAll = w > 0 ? (H.ga / La + A.ga / Lh) / w : 1;
  const attS = (w * attAll + K) / (w + K), defS = (w * defAll + K) / (w + K);
  const sh = (raw, n, prior) => (n * raw + K * prior) / (n + K);
  return {
    attH: sh(H.w > 0 ? H.gf / H.w / Lh : attS, H.w, attS),
    defH: sh(H.w > 0 ? H.ga / H.w / La : defS, H.w, defS),
    attA: sh(A.w > 0 ? A.gf / A.w / La : attS, A.w, attS),
    defA: sh(A.w > 0 ? A.ga / A.w / Lh : defS, A.w, defS),
    played: H.n + A.n,
  };
}

function ppg(model, id) {
  const r = (model.recent[id] || []).slice(-5);
  return r.length >= 3 ? r.reduce((s, x) => s + x, 0) / r.length : null;
}


/* ------------------------------------------------------------------ markets ---------------------------------------- */
// Pick names follow the SportyBet terminology list supplied by the user.

function groupOf(id) {
  if (['1', 'X', '2'].includes(id)) return 'Match result';
  if (['1X', 'X2', '12'].includes(id)) return 'Double chance';
  if (id.startsWith('DNB')) return 'Draw no bet';
  if (/^(Over|Under) /.test(id)) return 'Goals';
  if (id.startsWith('BTTS')) return 'BTTS';
  if (/^(Home|Away) Over/.test(id)) return 'Team goals';
  if (/Win to Nil$/.test(id)) return 'Win to nil';
  if (/^HT /.test(id)) return 'Half-time';
  if (/^[12X]\/[12X]$/.test(id)) return 'HT/FT';
  if (/^[12]UP /.test(id)) return 'Early payout';
  return 'Other';
}

const GROUP_ORDER = ['Match result', 'Double chance', 'Draw no bet', 'Goals', 'BTTS', 'Team goals', 'Win to nil', 'Half-time', 'HT/FT', 'Early payout'];

/** One-line meaning of a pick for this match (shown under the pick name). */
function explain(id, home, away) {
  const m = {
    '1': `${home} win`, X: 'Draw', '2': `${away} win`, '1X': `${home} win or draw`, X2: `Draw or ${away} win`, '12': 'Either team wins, no draw',
    'DNB 1': `${home} win (stake back on a draw)`, 'DNB 2': `${away} win (stake back on a draw)`,
    'Over 0.5': 'At least 1 goal', 'Over 1.5': 'At least 2 goals', 'Over 2.5': 'At least 3 goals', 'Over 3.5': 'At least 4 goals',
    'Under 1.5': 'Maximum 1 goal', 'Under 2.5': 'Maximum 2 goals', 'Under 3.5': 'Maximum 3 goals',
    'BTTS Yes': 'Both teams score', 'BTTS No': 'At least one team fails to score', 'BTTS & Over 2.5': 'Both teams score and 3+ goals',
    'Home Over 0.5': `${home} score at least once`, 'Home Over 1.5': `${home} score at least twice`,
    'Away Over 0.5': `${away} score at least once`, 'Away Over 1.5': `${away} score at least twice`,
    'Home Win to Nil': `${home} win without conceding`, 'Away Win to Nil': `${away} win without conceding`,
    'HT 1': `${home} lead at half-time`, 'HT X': 'Level at half-time', 'HT 2': `${away} lead at half-time`,
    'HT Over 0.5': 'At least 1 first-half goal', 'HT Over 1.5': 'At least 2 first-half goals', 'HT Under 1.5': 'Maximum 1 first-half goal',
    '1UP Home': `${home} go 1 goal ahead at any point`, '1UP Away': `${away} go 1 goal ahead at any point`,
    '2UP Home': `${home} go 2 goals ahead at any point`, '2UP Away': `${away} go 2 goals ahead at any point`,
  };
  if (m[id]) return m[id];
  const hf = id.match(/^([12X])\/([12X])$/);
  if (hf) { const w = (c) => (c === '1' ? home : c === '2' ? away : 'draw'); return `Half-time: ${w(hf[1])}. Full-time: ${w(hf[2])}`; }
  return id;
}

/** P(a side ever leads by >= k goals). Total goals ~ Poisson(L); each goal goes to the side with probability q. */
function leadProb(L, q, k) {
  const NMAX = 16;
  let cur = new Float64Array(NMAX + k + 1);
  cur[NMAX] = 1;
  let hit = 0, out = 0;
  for (let n = 1; n <= NMAX; n++) {
    const next = new Float64Array(NMAX + k + 1);
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      if (!p) continue;
      if (i + 1 - NMAX >= k) hit += p * q; else next[i + 1] += p * q;
      if (i - 1 >= 0) next[i - 1] += p * (1 - q);
    }
    cur = next;
    out += poisson(n, L) * hit;
  }
  return Math.min(1, out);
}

const grid = (a, b, n = 7) => Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => poisson(i, a) * poisson(j, b)));

/** Probability of every market from expected goals. share = fraction of goals scored in the first half. */
function marketProbs(lh, la, share, elo1x2) {
  const m = scoreMatrix(lh, la);
  const N = m.length;
  let home = 0, draw = 0, away = 0, btts = 0, bttsO = 0;
  const tot = Array(2 * N).fill(0), hg = Array(N).fill(0), ag = Array(N).fill(0);
  for (let h = 0; h < N; h++) for (let a = 0; a < N; a++) {
    const p = m[h][a];
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
    tot[h + a] += p; hg[h] += p; ag[a] += p;
    if (h > 0 && a > 0) { btts += p; if (h + a >= 3) bttsO += p; }
  }
  if (elo1x2) { // 75% score model, 25% Elo
    const e = elo1x2;
    home = 0.75 * home + 0.25 * e.home; draw = 0.75 * draw + 0.25 * e.draw; away = 0.75 * away + 0.25 * e.away;
    const t = home + draw + away; home /= t; draw /= t; away /= t;
  }
  const over = (x) => 1 - tot.slice(0, Math.floor(x) + 1).reduce((s, v) => s + v, 0);
  const pm = {
    '1': home, X: draw, '2': away, '1X': home + draw, X2: draw + away, '12': home + away,
    'DNB 1': home / (home + away), 'DNB 2': away / (home + away),
    'Over 0.5': over(0.5), 'Over 1.5': over(1.5), 'Over 2.5': over(2.5), 'Over 3.5': over(3.5),
    'Under 1.5': 1 - over(1.5), 'Under 2.5': 1 - over(2.5), 'Under 3.5': 1 - over(3.5),
    'BTTS Yes': btts, 'BTTS No': 1 - btts, 'BTTS & Over 2.5': bttsO,
    'Home Over 0.5': 1 - hg[0], 'Home Over 1.5': 1 - hg[0] - hg[1], 'Away Over 0.5': 1 - ag[0], 'Away Over 1.5': 1 - ag[0] - ag[1],
    'Home Win to Nil': m.slice(1).reduce((s, row) => s + row[0], 0), 'Away Win to Nil': m[0].slice(1).reduce((s, v) => s + v, 0),
  };
  // halves are modelled as independent Poisson processes
  const H1 = grid(lh * share, la * share), H2 = grid(lh * (1 - share), la * (1 - share));
  const sg = (x) => (x > 0 ? '1' : x < 0 ? '2' : 'X');
  let h1 = 0, hx = 0, h2 = 0, hOver05 = 0, hOver15 = 0;
  const hft = {};
  for (let i = 0; i < H1.length; i++) for (let j = 0; j < H1.length; j++) {
    const p = H1[i][j];
    if (i > j) h1 += p; else if (i === j) hx += p; else h2 += p;
    if (i + j >= 1) hOver05 += p;
    if (i + j >= 2) hOver15 += p;
    for (let k = 0; k < H2.length; k++) for (let l = 0; l < H2.length; l++) {
      const key = `${sg(i - j)}/${sg(i + k - (j + l))}`;
      hft[key] = (hft[key] || 0) + p * H2[k][l];
    }
  }
  Object.assign(pm, { 'HT 1': h1, 'HT X': hx, 'HT 2': h2, 'HT Over 0.5': hOver05, 'HT Over 1.5': hOver15, 'HT Under 1.5': 1 - hOver15 });
  for (const k of ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2']) pm[k] = hft[k] || 0;
  const L = lh + la, q = lh / L;
  Object.assign(pm, { '1UP Home': leadProb(L, q, 1), '1UP Away': leadProb(L, 1 - q, 1), '2UP Home': leadProb(L, q, 2), '2UP Away': leadProb(L, 1 - q, 2) });
  return { pm, summary: summarize(m), draw };
}

function predict(model, homeId, awayId) {
  const { Lh, La } = model;
  const sh = strengths(model, homeId), sa = strengths(model, awayId);
  let lh = Lh * sh.attH * sa.defA;
  let la = La * sa.attA * sh.defH;

  const fh = ppg(model, homeId), fa = ppg(model, awayId);
  if (fh !== null) lh *= 1 + ((fh - 1.5) / 1.5) * 0.04;
  if (fa !== null) la *= 1 + ((fa - 1.5) / 1.5) * 0.04;

  const key = homeId < awayId ? `${homeId}|${awayId}` : `${awayId}|${homeId}`;
  const meet = (model.h2h[key] || []).slice(-5);
  let h2hGd = null;
  if (meet.length >= 2) {
    h2hGd = meet.reduce((s, x) => s + (x.home === homeId ? x.gd : -x.gd), 0) / meet.length;
    const adj = clamp(h2hGd, -2, 2) * 0.015;
    lh *= 1 + adj; la *= 1 - adj;
  }
  lh = clamp(lh, 0.2, 4); la = clamp(la, 0.2, 4);

  const eloH = model.elo[homeId] ?? 1500, eloA = model.elo[awayId] ?? 1500;
  const E = 1 / (1 + Math.pow(10, -(eloH - eloA + 65) / 400));
  const base = summarize(scoreMatrix(lh, la));
  let eH = clamp(E - base.draw / 2, 0.02, 0.96), eA = clamp(1 - E - base.draw / 2, 0.02, 0.96);
  const et = eH + base.draw + eA;
  const { pm, summary } = marketProbs(lh, la, model.htShare, { home: eH / et, draw: base.draw / et, away: eA / et });

  return {
    lh, la, pm, probs: { home: pm['1'], draw: pm.X, away: pm['2'] },
    topScores: summary.topScores.map((x) => ({ score: x.score, p: x.p })),
    context: {
      elo: { home: Math.round(eloH), away: Math.round(eloA) },
      form: { home: fh, away: fa },
      h2h: { meetings: meet.length, avgGoalDiff: h2hGd },
      played: { home: sh.played, away: sa.played },
    },
  };
}


/** In-play probabilities: the rest of the match is a Poisson process scaled by the minutes left, on top of the current score. */
function liveMarkets(lh, la, h0, a0) {
  const m = scoreMatrix(Math.max(lh, 0.01), Math.max(la, 0.01));
  const pm = {};
  const add = (id, p) => { pm[id] = (pm[id] || 0) + p; };
  let nilH = 0, nilA = 0;
  for (let i = 0; i < m.length; i++) for (let j = 0; j < m.length; j++) {
    const p = m[i][j], h = h0 + i, a = a0 + j, t = h + a;
    add(h > a ? '1' : h === a ? 'X' : '2', p);
    if (h > a) { add('1X', p); add('12', p); add('DNB 1', p); } else if (h === a) { add('1X', p); add('X2', p); } else { add('X2', p); add('12', p); add('DNB 2', p); }
    for (const x of [0.5, 1.5, 2.5, 3.5]) { if (t > x) add(`Over ${x}`, p); else add(`Under ${x}`, p); }
    if (h > 0 && a > 0) { add('BTTS Yes', p); if (t >= 3) add('BTTS & Over 2.5', p); } else add('BTTS No', p);
    if (h >= 1) add('Home Over 0.5', p); if (h >= 2) add('Home Over 1.5', p);
    if (a >= 1) add('Away Over 0.5', p); if (a >= 2) add('Away Over 1.5', p);
    if (h > a && a === 0) nilH += p; if (a > h && h === 0) nilA += p;
  }
  pm['Home Win to Nil'] = nilH; pm['Away Win to Nil'] = nilA;
  // draw-no-bet is a conditional probability
  const dh = (pm['1'] || 0) + (pm['2'] || 0);
  pm['DNB 1'] = dh ? pm['1'] / dh : 0; pm['DNB 2'] = dh ? pm['2'] / dh : 0;
  for (const k of Object.keys(pm)) pm[k] = Math.min(1, Math.max(0, pm[k]));
  delete pm['Under 0.5'];
  return pm;
}

function livePredict(model, homeId, awayId, score, minute) {
  const base = predict(model, homeId, awayId);
  const f = Math.min(1, Math.max(0, (Number(minute) || 0) / 90));
  const lh = base.lh * (1 - f), la = base.la * (1 - f);
  return { ...base, pm: liveMarkets(lh, la, score[0], score[1]), lh, la, probs: null, live: { score, minute: Number(minute) || 0 } };
}

/** Picks the AI may choose from: probable enough to matter, not so certain that they say nothing (>90%). */
function candidates(pm, home, away) {
  const all = Object.entries(pm).map(([id, p]) => ({ id, p }));
  let c = all.filter((x) => x.p >= 0.5 && x.p <= 0.9).sort((a, b) => b.p - a.p);
  if (!c.length) c = all.sort((a, b) => b.p - a.p).slice(0, 3);
  return c.slice(0, 12).map((x, i) => ({ cid: `c${i + 1}`, id: x.id, market: groupOf(x.id), pick: x.id, label: x.id, p: x.p, odds: fairOdds(x.p), about: explain(x.id, home, away) }));
}

/** Higher-odds picks: less likely than the main pick (fair odds roughly 2 to 6), still with a real chance. */
function highCandidates(pm, home, away) {
  const all = Object.entries(pm).map(([id, p]) => ({ id, p })).filter((x) => x.p >= 0.17 && x.p < 0.5).sort((a, b) => b.p - a.p);
  return all.slice(0, 10).map((x, i) => ({ cid: `h${i + 1}`, id: x.id, market: groupOf(x.id), pick: x.id, label: x.id, p: x.p, odds: fairOdds(x.p), about: explain(x.id, home, away) }));
}
const fairOdds = (p) => (p > 0 ? +(1 / p).toFixed(2) : null);

/** Statistics fallback for the high-odds pick: the most probable one that still pays at least about 2.0 (fair). */
function statsHigh(pm, home, away) {
  const c = highCandidates(pm, home, away);
  if (!c.length) return null;
  const { cid, ...x } = c.find((y) => y.p <= 0.42) || c[0];
  return x;
}

/** Highest-probability candidate: the pure-statistics pick. */
function statsBest(pm, home, away) {
  const { cid, ...c } = candidates(pm, home, away)[0];
  return c;
}

function confidence(p, played) {
  if (Math.min(played.home, played.away) < 5) return 'Low';
  if (p >= 0.78) return 'High';
  if (p >= 0.62) return 'Medium';
  return 'Low';
}

/* ----------------------------------------------------------- verification -------------------------------------------- */

/**
 * Was the pick correct? true / false, or null when it cannot be verified (void, or data missing).
 * goalSeq (optional): the score after each goal, e.g. [[1,0],[1,1],[2,1]], for exact 1UP/2UP checks.
 */
function settleId(id, ft, ht, goalSeq) {
  if (!ft) return null;
  const [h, a] = ft, t = h + a;
  const res = h > a ? '1' : h === a ? 'X' : '2';
  const hres = ht ? (ht[0] > ht[1] ? '1' : ht[0] === ht[1] ? 'X' : '2') : null;
  const hasHt = !!ht, hg = ht ? ht[0] + ht[1] : 0;
  const lead = (k, side) => {
    const own = side === 'home' ? h : a;
    const margin = (x) => (side === 'home' ? x[0] - x[1] : x[1] - x[0]);
    if (goalSeq && goalSeq.length) return Math.max(0, ...goalSeq.map(margin)) >= k;
    let known = Math.max(0, margin(ft), ht ? margin(ht) : 0);
    if (known >= k) return true;
    if (own < k) return false; // cannot lead by k without scoring k
    return null;
  };
  const og = /^(Over|Under) (\d+)\.5$/.exec(id);
  if (og) return og[1] === 'Over' ? t > +og[2] : t <= +og[2];
  switch (id) {
    case '1': case 'X': case '2': return id === res;
    case '1X': return res !== '2';
    case 'X2': return res !== '1';
    case '12': return res !== 'X';
    case 'DNB 1': return res === 'X' ? null : res === '1';
    case 'DNB 2': return res === 'X' ? null : res === '2';
    case 'Over 0.5': return t > 0.5;
    case 'Over 1.5': return t > 1.5;
    case 'Over 2.5': return t > 2.5;
    case 'Over 3.5': return t > 3.5;
    case 'Under 1.5': return t < 1.5;
    case 'Under 2.5': return t < 2.5;
    case 'Under 3.5': return t < 3.5;
    case 'BTTS Yes': return h > 0 && a > 0;
    case 'BTTS No': return !(h > 0 && a > 0);
    case 'BTTS & Over 2.5': return h > 0 && a > 0 && t > 2.5;
    case 'Home Over 0.5': return h > 0.5;
    case 'Home Over 1.5': return h > 1.5;
    case 'Away Over 0.5': return a > 0.5;
    case 'Away Over 1.5': return a > 1.5;
    case 'Home Win to Nil': return h > a && a === 0;
    case 'Away Win to Nil': return a > h && h === 0;
    case 'HT 1': return hasHt ? hres === '1' : null;
    case 'HT X': return hasHt ? hres === 'X' : null;
    case 'HT 2': return hasHt ? hres === '2' : null;
    case 'HT Over 0.5': return hasHt ? hg > 0.5 : null;
    case 'HT Over 1.5': return hasHt ? hg > 1.5 : null;
    case 'HT Under 1.5': return hasHt ? hg < 1.5 : null;
    case '1UP Home': return lead(1, 'home');
    case '1UP Away': return lead(1, 'away');
    case '2UP Home': return lead(2, 'home');
    case '2UP Away': return lead(2, 'away');
    default: {
      const hf = id.match(/^([12X])\/([12X])$/);
      return hf && hasHt ? hres === hf[1] && res === hf[2] : null;
    }
  }
}

const isEarly = (id) => /^[12]UP /.test(id);

module.exports = { livePredict, MODEL_VERSION, seasonOf, buildModel, predict, candidates, highCandidates, statsHigh, fairOdds, statsBest, confidence, settleId, groupOf, explain, isEarly, GROUP_ORDER };
