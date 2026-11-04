'use strict';
// Offline self-test: demo provider + simulated clock + mocked Gemini. No network needed.
process.env.DATA_DIR = require('os').tmpdir() + '/sp-test-' + process.pid;
process.env.DEMO_MODE = '1';
process.env.GEMINI_API_KEY = 'test-key';
process.env.AI_DELAY_MS = '0';
const assert = require('assert');
const dbm = require('./db'); dbm.load();
const ai = require('./ai');
const engine = require('./engine');

let calls = { choose: 0, research: 0, news: 0, analyse: 0, discover: 0, pickWeb: 0, results: 0 };
ai.generate = async ({ system, user, search }) => { // fake Gemini: answers in the shape the real one must
  if (/research football matches/.test(system)) {
    calls.research++; assert(search === true, 'research must use web search');
    return { text: JSON.stringify(user.map((i, n) => ({ key: i.key, notes: n === 0 ? [] : [`${i.home}: test injury note`] }))), sources: [{ title: 'Test source', uri: 'https://example.com/a' }] };
  }
  if (/find real upcoming football fixtures/.test(system)) {
    calls.discover++; assert(search === true, 'discovery must use web search');
    const names = Object.values(dbm.data().teams).filter((t) => !String(t.id).startsWith('w_')).map((t) => t.name);
    const k = new Date(Date.now() + 5 * 3600000).toISOString();
    return { text: JSON.stringify([{ home: names[0], away: names[1], competition: 'FA Cup', country: 'England', kickoff: k }, { home: 'Zzz United', away: 'Qqq Rovers', competition: 'Scottish Premiership', country: 'Scotland', kickoff: k }, { home: 'Bad', away: 'Bad', competition: 'x', kickoff: 'nope' }, { home: 'Aaa FC', away: 'Bbb FC', competition: 'Thai League 1', country: 'Thailand', kickoff: k }]), sources: [{ title: 'Fixtures', uri: 'https://example.com/f' }] };
  }
  if (/careful football analyst with Google Search/.test(system)) {
    calls.pickWeb++; assert(search === true);
    return { text: JSON.stringify([...user.map((i) => ({ key: i.key, pick: '1X', probability: 0.7, confidence: 'High', reason: 'test web reason' })), { key: user[0].key, pick: 'HT 1', probability: 0.6 }]), sources: [] };
  }
  if (/look up final football scores/.test(system)) { calls.results++; return { text: JSON.stringify(user.map((i) => ({ key: i.key, finished: true, home_goals: 2, away_goals: 1, ht_home: 1, ht_away: 0 }))), sources: [] }; }
  if (/football news desk/.test(system)) { calls.news++; return { text: JSON.stringify([{ title: 'Headline', summary: 'Summary', topic: 'Result' }]), sources: [{ title: 'S', uri: 'https://example.com/n' }] }; }
  if (/AI football analyst/.test(system)) { calls.analyse++; return { text: JSON.stringify({ summary: 'AI summary', home_strengths: ['a'], home_weaknesses: [], away_strengths: [], away_weaknesses: [], key_insights: ['x 0.5'], uncertainty: 'u' }), sources: [] }; }
  calls.choose++;
  assert(Array.isArray(user) && user.length >= 1 && user.length <= 8, 'batched');
  assert(user.every((i) => i.candidates.length >= 3 && i.elo && i.key && i.candidates.every((c) => c.id && c.pick)));
  // forget the first match of each batch; choose the 2nd candidate for the others
  return { text: JSON.stringify(user.slice(1).map((i) => ({ key: i.key, pick_id: i.candidates[1].id, reason: 'test reason', confidence: 'Medium' }))), sources: [] };
};
const pipeline = require('./pipeline');
const accuracy = require('./accuracy');

(async () => {
  const t0 = new Date();
  let r = await pipeline.run(t0);
  console.log('run 1:', JSON.stringify(r));
  const d = dbm.data();
  const preds = Object.values(d.predictions);
  assert(preds.length > 0 && calls.choose > 0 && calls.research > 0, 'predictions, research and AI calls happened');
  const web = Object.values(d.matches).filter((m) => m.web);
  assert(web.length === 2 && calls.discover > 0, 'web matches added (invalid and off-list competitions dropped)');
  assert(web.every((m) => d.predictions[m.id]?.web), 'every web match has a pick');
  const wp = web.map((m) => d.predictions[m.id]);
  assert(wp.some((p) => p.best.estimated && p.best.id === '1X') && wp.some((p) => !p.best.estimated), 'unknown teams get a Gemini estimate, known teams get a stats pick');
  assert(Object.keys(d.leagues).some((c) => c.startsWith('WEB_')), 'web competitions registered');
  const lateLive = Object.values(d.predictions).filter((p) => p.late || p.inplay);
  console.log('live picks:', lateLive.length);
  assert(preds.some((p) => p.best.source === 'ai') && preds.some((p) => p.best.source === 'stats'), 'AI picks plus fallback for skipped matches');
  assert(preds.some((p) => p.research?.notes?.length), 'web research stored');
  const full = preds.filter((q) => !q.web && !q.late);
  for (const p of full) {
    assert(Math.abs(p.pm['1'] + p.pm.X + p.pm['2'] - 1) < 0.01, '1X2 sums to 1');
    assert(p.best.label === p.best.id && p.best.id in p.pm, 'pick uses the market name');
    assert(p.pm['1UP Home'] >= p.pm['1'] - 1e-9 && p.pm['2UP Home'] <= p.pm['1UP Home'], 'early payout probabilities are consistent');
  }
  for (const id of ['1', 'X', '2', '1X', 'X2', '12', 'Over 1.5', 'Over 2.5', 'Under 2.5', 'BTTS Yes', 'BTTS No', 'DNB 1', 'HT Over 0.5', 'HT Under 1.5', '1UP Home', '1UP Away', '2UP Home', '2UP Away', '1/1', '2/2']) assert(id in full[0].pm, `market ${id} present`);
  const first = Object.fromEntries(preds.map((p) => [p.matchId, p.best.label]));

  r = await pipeline.run(new Date(t0.getTime() + 12 * 86400000));
  console.log('run 2:', JSON.stringify(r));
  const settled = Object.values(d.predictions).filter((p) => p.settled);
  assert(settled.length > 0, 'picks settled');
  for (const p of settled) {
    assert.strictEqual(p.best.label, first[p.matchId], 'picks frozen before kickoff');
    assert(typeof p.best.correct === 'boolean' || p.best.correct === null);
  }
  const acc = accuracy.compute(d, { includeDemo: true });
  console.log('accuracy:', JSON.stringify({ verified: acc.matchesVerified, best: acc.best, ai: acc.ai, statsSame: acc.statsOnAiMatches }));
  assert(acc.best.total > 0 && acc.byMarket.length > 0 && acc.byPick.length > 0);

  // 1UP / 2UP: the goal timeline settles them exactly
  const sp = settled.find((p) => d.matches[p.matchId].ft[0] + d.matches[p.matchId].ft[1] >= 2);
  const m = d.matches[sp.matchId];
  sp.best = { id: '1UP Away', market: 'Early payout', pick: '1UP Away', label: '1UP Away', p: 0.5, source: 'stats', correct: null }; sp.seqTried = false;
  await pipeline.resolveEarly(new Date());
  const det = (await pipeline.remote.detail(m)).value;
  const expect = Math.max(0, ...det.goals.map((g) => g.score[1] - g.score[0])) >= 1;
  assert.strictEqual(sp.best.correct, expect, 'early payout settled from goal timeline');
  console.log(`1UP Away on ${m.home.name} ${m.ft.join('-')} ${m.away.name}: ${sp.best.correct}`);

  // HTTP API
  const { server } = require('./server');
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://localhost:${server.address().port}`;
  const get = async (p, opt) => { const x = await fetch(base + p, opt); return { status: x.status, body: await x.json().catch(() => null) }; };
  const day = new Date(t0.getTime()); day.setUTCHours(0, 0, 0, 0);
  const win = (days) => `from=${day.toISOString()}&to=${new Date(day.getTime() + days * 86400000).toISOString()}`;

  assert.strictEqual((await get('/api/status')).body.configured, true);
  const week = (await get(`/api/fixtures?${win(7)}`)).body;
  assert(week.length > 0 && week[0].home.name && week[0].league.code);
  const one = (await get(`/api/fixtures?${win(1)}`)).body;
  assert(one.every((f) => new Date(f.date) >= day && new Date(f.date) < new Date(day.getTime() + 86400000)), 'day range respected');
  assert.strictEqual((await get(`/api/fixtures?${win(1)}&league=ZZZ`)).body.length, 0);
  assert.strictEqual((await get('/api/fixtures?from=x&to=y')).status, 400);
  const dash = (await get(`/api/dashboard?${win(1)}`)).body;
  assert(Array.isArray(dash.live) && Array.isArray(dash.today) && dash.recent.length > 0 && Array.isArray(dash.featured));
  const lv = (await get('/api/live')).body; assert(Array.isArray(lv));
  const leagues = (await get('/api/leagues')).body; assert(leagues.filter((l) => l.code === 'DEMO')[0].teams === 12 && leagues.length === 3, 'demo league plus two web competitions');
  const wl = leagues.find((l) => l.code.startsWith('WEB_')); assert((await get(`/api/league/${wl.code}`)).status === 200 && (await get(`/api/stats/${wl.code}`)).status === 200, 'web competition pages work');
  const wm = Object.values(dbm.data().matches).find((m) => m.web); const wd = (await get(`/api/match/${wm.id}`)); assert(wd.status === 200 && wd.body.match.prediction.kind === 'web', 'web match centre');
  assert((await get(`/api/analysis/${wm.id}`)).status === 200, 'analysis works without xG');
  assert((await get(`/api/team/${wm.home.id}`)).status === 200, 'web team page works');
  const lg = (await get('/api/league/DEMO')).body;
  assert(lg.standings.groups[0].table.length === 12 && lg.standings.groups[0].table[0].position === 1 && lg.teamStats.length === 12);
  const st = (await get('/api/stats/DEMO')).body;
  assert(st.summary.goalsPerMatch > 0 && st.cleanSheets.length > 0 && st.form.length > 0 && st.homeAway.length > 0);
  const teams = (await get('/api/teams?league=DEMO')).body; assert(teams.length === 12);
  const tm = (await get(`/api/team/${teams[0].id}`)).body;
  assert(tm.team.name && tm.record.total.p > 0 && tm.recent.length > 0 && tm.positions.length === 1);
  const fin = Object.values(d.matches).find((x) => x.status === 'FINISHED' && d.predictions[x.id]?.settled);
  const mc = (await get(`/api/match/${fin.id}`)).body;
  assert(mc.detail.goals.length === fin.ft[0] + fin.ft[1], 'goal timeline matches the score');
  assert(mc.detail.stats.home.ball_possession + mc.detail.stats.away.ball_possession === 100);
  assert(mc.markets.length >= 8 && mc.analysis.factors.length >= 4 && mc.analysis.uncertainty.reasons.length >= 1 && mc.analysis.h2h);
  const up = Object.values(d.matches).find((x) => x.status === 'SCHEDULED' && d.predictions[x.id]);
  const mu = (await get(`/api/match/${up.id}`)).body;
  assert(mu.detail === null && /match day/i.test(mu.detailNote), 'no fake lineups before match day');
  assert.strictEqual((await get('/api/match/nope')).status, 404);
  const an0 = (await get(`/api/analysis/${up.id}`)).body; assert(an0.summary && an0.ai === null);
  const an1 = (await get(`/api/analysis/${up.id}?ai=1`)).body; assert.strictEqual(an1.ai.summary, 'AI summary');
  assert.strictEqual(calls.analyse, 1); await get(`/api/analysis/${up.id}?ai=1`); assert.strictEqual(calls.analyse, 1, 'AI analysis is cached');
  const nw = (await get('/api/news')).body; assert(nw.enabled && nw.items.length === 1 && nw.sources.length === 1);
  const an = (await get('/api/analyst')).body; assert(an.picks.length > 0);
  const se = (await get('/api/search?q=river')).body; assert(se.teams.some((t) => /River/.test(t.name)) && se.fixtures.length > 0);
  assert.strictEqual((await get('/api/search?q=r')).body.teams.length, 0);

  // preferences
  const id = 'a'.repeat(24);
  assert.strictEqual((await get('/api/prefs')).status, 400, 'client id required');
  const put = await get('/api/prefs', { method: 'PUT', headers: { 'x-client-id': id, 'content-type': 'application/json' }, body: JSON.stringify({ favTeams: ['D1', '<script>'], favLeagues: ['DEMO'], dataSaver: true, timeFormat: '12h', evil: 1 }) });
  assert.deepStrictEqual(put.body.favTeams, ['D1']); assert.strictEqual(put.body.evil, undefined);
  assert.strictEqual((await get('/api/prefs', { headers: { 'x-client-id': id } })).body.dataSaver, true);

  // security
  const ph = await fetch(base + '/', {}); assert(ph.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.strictEqual((await fetch(base + '/db.js')).status, 404, 'server code is not served');
  const trav = await fetch(base + '/..%2f..%2fdb.js'); assert(!(await trav.text()).includes("'use strict'"), 'no path traversal');
  server.close();
  console.log('calls:', JSON.stringify(calls));
  console.log('OK all tests passed');
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
