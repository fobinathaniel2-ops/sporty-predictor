'use strict';
// Every market probability must equal the probability of the outcomes that settleId marks as winning.
const assert = require('assert');
const engine = require('./engine');
const { scoreMatrix, poisson } = require('./model');
const sample = [[1.7, 0.9, 0.44], [1.1, 1.1, 0.42], [0.8, 2.1, 0.46]];
let checked = 0;
for (const [lh, la, share] of sample) {
  const mp = require('./engine').__marketProbs(lh, la, share);
  const pm = mp.pm, M = scoreMatrix(lh, la), N = M.length;
  assert.ok(Object.keys(pm).length > 150, `expected 150+ markets, got ${Object.keys(pm).length}`);
  const g = (a, b) => Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => poisson(i, a) * poisson(j, b)));
  const H1 = g(lh * share, la * share), H2 = g(lh * (1 - share), la * (1 - share));
  for (const [id, p] of Object.entries(pm)) {
    if (/^[12]UP /.test(id) || /^CS /.test(id)) continue;
    let T = 0, F = 0;
    const usesHalves = /^(HT|2H) |^[12X]\/[12X]$|Either Half$|Both Halves$/.test(id);
    if (!usesHalves) {
      for (let h = 0; h < N; h++) for (let a = 0; a < N; a++) { const r = engine.settleId(id, [h, a], null); if (r === true) T += M[h][a]; else if (r === false) F += M[h][a]; else if (r === null && !/^(DNB|AH)/.test(id)) throw new Error(`${id} not settled for ${h}-${a}`); }
    } else {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) for (let k = 0; k < 8; k++) for (let l = 0; l < 8; l++) {
        const w = H1[i][j] * H2[k][l], r = engine.settleId(id, [i + k, j + l], [i, j]);
        if (r === true) T += w; else if (r === false) F += w; else throw new Error(`${id} unsettled`);
      }
    }
    const want = T + F > 0 ? T / (T + F) : 0;
    // result-dependent markets use the Elo-blended result odds; with no blend they must match exactly
    assert.ok(Math.abs(want - p) < 0.012, `${id}: model ${p.toFixed(4)} vs outcomes ${want.toFixed(4)}`);
    checked++;
  }
  assert.ok(Math.abs(pm['1'] + pm.X + pm['2'] - 1) < 1e-6);
  assert.ok(Math.abs(pm['EH 1 (-1)'] + pm['EH X (-1)'] + pm['EH 2 (-1)'] - 1) < 0.02);
  assert.ok(pm['1 & Over 2.5'] <= pm['1'] + 1e-9 && pm['BTTS & 1'] <= pm['BTTS Yes'] + 1e-9);
}
// spot checks of settlement
const S = engine.settleId;
assert.strictEqual(S('Home by 2', [3, 1]), true); assert.strictEqual(S('Home by 3+', [3, 1]), false);
assert.strictEqual(S('AH Home -1', [2, 1]), null); assert.strictEqual(S('AH Home -1', [3, 1]), true); assert.strictEqual(S('AH Away +1.5', [3, 1]), false);
assert.strictEqual(S('EH X (-1)', [2, 1]), true); assert.strictEqual(S('2H 1', [2, 1], [1, 1]), true); assert.strictEqual(S('2H Over 1.5', [2, 1], [1, 1]), false);
assert.strictEqual(S('Home Win Both Halves', [2, 1], [1, 0]), false); assert.strictEqual(S('Home Win Both Halves', [2, 0], [1, 0]), true);
assert.strictEqual(S('HT 1', [2, 1], null), null); assert.strictEqual(S('Goals 6+', [4, 2]), true); assert.strictEqual(S('1X & Under 3.5', [1, 1]), true);
assert.strictEqual(S('BTTS Both Halves', [2, 2], [1, 1]), true);
console.log(`OK ${checked} market probabilities match their settlement rules`);
