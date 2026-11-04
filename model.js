'use strict';
/** Poisson score-matrix helpers used by the prediction engine. */

const MAX_GOALS = 8;

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
const poisson = (k, lambda) => (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);

/** Score matrix [home goals][away goals] with a small Dixon-Coles low-score correction. */
function scoreMatrix(lh, la, rho = -0.05) {
  const m = []; let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    m[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      let p = poisson(h, lh) * poisson(a, la);
      if (h === 0 && a === 0) p *= 1 - lh * la * rho;
      else if (h === 0 && a === 1) p *= 1 + lh * rho;
      else if (h === 1 && a === 0) p *= 1 + la * rho;
      else if (h === 1 && a === 1) p *= 1 - rho;
      m[h][a] = Math.max(p, 0); total += m[h][a];
    }
  }
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) m[h][a] /= total;
  return m;
}

function summarize(m) {
  let home = 0, draw = 0, away = 0, over15 = 0, over25 = 0, over35 = 0, btts = 0;
  const scores = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = m[h][a];
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
      const t = h + a;
      if (t >= 2) over15 += p;
      if (t >= 3) over25 += p;
      if (t >= 4) over35 += p;
      if (h > 0 && a > 0) btts += p;
      scores.push({ score: `${h}-${a}`, p });
    }
  }
  scores.sort((x, y) => y.p - x.p);
  return { home, draw, away, over15, over25, over35, btts, topScores: scores.slice(0, 5) };
}

module.exports = { scoreMatrix, summarize, poisson };
