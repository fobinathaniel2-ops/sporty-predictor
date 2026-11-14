'use strict';
// Basketball model. Team scoring/conceding averages (time-weighted, shrunk towards the league average) give an expected
// score for each side; margin and total points are treated as normally distributed around it. An estimate, never a certainty.

const DAY = 86400000;
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;

function phi(x) { // standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const MIN_LEAGUE_GAMES = Number(process.env.BK_MIN_GAMES || 12);

/** finished: stored matches of ONE league with ft = [homePoints, awayPoints]. */
function buildModel(finished, asOf = new Date()) {
  const ms = finished.filter((m) => m.ft && new Date(m.date) < asOf && m.ft[0] + m.ft[1] > 0).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (ms.length < MIN_LEAGUE_GAMES) return { ok: false, n: ms.length, reason: `Only ${ms.length} finished games in this league (need ${MIN_LEAGUE_GAMES}+).` };
  const HL = 60; // days
  const team = {};
  let sw = 0, sh = 0, sa = 0;
  const T = (id) => team[id] || (team[id] = { w: 0, pf: 0, pa: 0, n: 0, last: [] });
  for (const m of ms) {
    const w = Math.pow(0.5, (asOf - new Date(m.date)) / DAY / HL);
    const [h, a] = m.ft;
    sw += w; sh += w * h; sa += w * a;
    const th = T(m.home.id), ta = T(m.away.id);
    th.w += w; th.pf += w * h; th.pa += w * a; th.n++; th.last.push(h > a ? 'W' : 'L');
    ta.w += w; ta.pf += w * a; ta.pa += w * h; ta.n++; ta.last.push(a > h ? 'W' : 'L');
  }
  const lgHome = sh / sw, lgAway = sa / sw, lg = (lgHome + lgAway) / 2;
  const hca = Math.min(6, Math.max(0, ms.length >= 40 ? lgHome - lgAway : 3)); // total home advantage in points
  return { ok: true, n: ms.length, team, lg, hca };
}

const K = 4; // shrinkage: a team with few games leans on the league average
const shrink = (sum, w, lg) => (sum + K * lg) / (w + K);

function teamRates(model, id) {
  const t = model.team[id];
  if (!t || !t.n) return { n: 0, pf: model.lg, pa: model.lg, form: '' };
  return { n: t.n, pf: shrink(t.pf, t.w, model.lg), pa: shrink(t.pa, t.w, model.lg), form: t.last.slice(-5).join('') };
}

/** -> {hp, ap, mu, total, pm, context}: expected points, expected margin, probabilities of every market. */
function predict(model, homeId, awayId) {
  const H = teamRates(model, homeId), A = teamRates(model, awayId);
  const hp = (H.pf + A.pa) / 2 + model.hca / 2;
  const ap = (A.pf + H.pa) / 2 - model.hca / 2;
  const mu = hp - ap, total = hp + ap;
  const sm = Math.min(16, Math.max(8, 0.058 * total + 1)), st = Math.min(26, Math.max(10, 0.078 * total));
  const pm = {};
  const pHome = (x) => 1 - phi((x - mu) / sm); // P(margin > x)
  pm['1'] = pHome(0); pm['2'] = 1 - pm['1'];
  for (const L of [1.5, 3.5, 5.5, 7.5, 10.5]) {
    pm[`Home -${L}`] = pHome(L); pm[`Away +${L}`] = 1 - pHome(L);
    pm[`Home +${L}`] = pHome(-L); pm[`Away -${L}`] = 1 - pHome(-L);
  }
  const base = Math.round(total - 0.5) + 0.5;
  for (const x of [base - 6, base - 3, base, base + 3, base + 6]) { const po = 1 - phi((x - total) / st); pm[`Over ${x}`] = po; pm[`Under ${x}`] = 1 - po; }
  for (const k of Object.keys(pm)) pm[k] = r3(Math.min(0.995, Math.max(0.005, pm[k])));
  return { hp: r1(hp), ap: r1(ap), mu: r1(mu), total: r1(total), pm, played: { home: H.n, away: A.n }, form: { home: H.form, away: A.form } };
}

/* ------------------------------------------------------------------------------------- picks, labels, settlement --- */

function groupOf(id) {
  if (id === '1' || id === '2') return 'Match winner';
  if (/^(Home|Away) [-+]/.test(id)) return 'Handicap';
  if (/^(Over|Under) /.test(id)) return 'Total points';
  return 'Other';
}
const GROUP_ORDER = ['Match winner', 'Handicap', 'Total points'];

function explain(id, home, away) {
  if (id === '1') return `${home} win (overtime included)`;
  if (id === '2') return `${away} win (overtime included)`;
  let m = id.match(/^Home -(\d+)\.5$/); if (m) return `${home} win by ${+m[1] + 1} or more points`;
  m = id.match(/^Away -(\d+)\.5$/); if (m) return `${away} win by ${+m[1] + 1} or more points`;
  m = id.match(/^Home \+(\d+)\.5$/); if (m) return `${home} win, or lose by ${m[1]} or fewer points`;
  m = id.match(/^Away \+(\d+)\.5$/); if (m) return `${away} win, or lose by ${m[1]} or fewer points`;
  m = id.match(/^Over (\d+)\.5$/); if (m) return `${+m[1] + 1} or more total points`;
  m = id.match(/^Under (\d+)\.5$/); if (m) return `${m[1]} or fewer total points`;
  return id;
}

const fairOdds = (p) => (p > 0 ? +(1 / p).toFixed(2) : null);
const item = (id, p, home, away) => ({ id, market: groupOf(id), pick: id, label: id, p, odds: fairOdds(p), about: explain(id, home, away) });

/** Main pick: the most probable market between 55% and 82% (avoids 99% "gifts" that pay nothing). */
function statsBest(pm, home, away) {
  const all = Object.entries(pm).map(([id, p]) => ({ id, p })).sort((a, b) => b.p - a.p);
  const c = all.find((x) => x.p >= 0.55 && x.p <= 0.82) || all.find((x) => x.p <= 0.9) || all[0];
  return item(c.id, c.p, home, away);
}
/** Higher-odds pick: the most probable market below 50% (fair odds about 2 to 3). */
function statsHigh(pm, home, away) {
  const c = Object.entries(pm).map(([id, p]) => ({ id, p })).filter((x) => x.p >= 0.3 && x.p < 0.5).sort((a, b) => b.p - a.p)[0];
  return c ? item(c.id, c.p, home, away) : null;
}
function candidates(pm, home, away) {
  const all = Object.entries(pm).map(([id, p]) => ({ id, p }));
  const safe = all.filter((x) => x.p >= 0.55 && x.p <= 0.85).sort((a, b) => b.p - a.p).slice(0, 10);
  const high = all.filter((x) => x.p >= 0.25 && x.p < 0.5).sort((a, b) => b.p - a.p).slice(0, 8);
  return {
    safe: safe.map((x, i) => ({ cid: `c${i + 1}`, ...item(x.id, x.p, home, away) })),
    high: high.map((x, i) => ({ cid: `h${i + 1}`, ...item(x.id, x.p, home, away) })),
  };
}

/** true / false / null (unknown market). ft = [homePoints, awayPoints]. */
function settleId(id, ft) {
  if (!ft) return null;
  const [h, a] = ft, m = h - a, t = h + a;
  if (id === '1') return m > 0;
  if (id === '2') return m < 0;
  let x = id.match(/^Home -(\d+\.5)$/); if (x) return m > +x[1];
  x = id.match(/^Away -(\d+\.5)$/); if (x) return -m > +x[1];
  x = id.match(/^Home \+(\d+\.5)$/); if (x) return m > -+x[1];
  x = id.match(/^Away \+(\d+\.5)$/); if (x) return -m > -+x[1];
  x = id.match(/^Over (\d+\.5)$/); if (x) return t > +x[1];
  x = id.match(/^Under (\d+\.5)$/); if (x) return t < +x[1];
  return null;
}

module.exports = { buildModel, predict, groupOf, GROUP_ORDER, explain, statsBest, statsHigh, candidates, settleId, fairOdds, phi };
