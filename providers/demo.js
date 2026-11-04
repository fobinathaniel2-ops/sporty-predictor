'use strict';
/**
 * DEMO provider: a simulated league for offline testing. Everything is synthetic and labelled DEMO in the UI.
 * Match status follows the clock (scheduled -> live -> finished), so picks settle as time passes.
 */
const TEAMS = ['Riverside FC', 'Harbor United', 'Northgate Rovers', 'Eastvale City', 'Oakfield Athletic', 'Stonebridge',
  'Westham Park', 'Kingsport', 'Lakeshore Town', 'Redhill Wanderers', 'Ironbridge', 'Summit FC'];
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const OFFSETS = [-2, -2, 0, 0, 2, 4]; // staggered kickoffs (hours from 15:00 UTC)

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const poissonSample = (r, lambda) => { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
const strength = TEAMS.map((_, i) => { const r = rng(1000 + i * 97); return { att: 0.7 + r() * 0.8, def: 0.7 + r() * 0.8 }; });

function rounds() {
  const n = TEAMS.length; const ids = [...Array(n).keys()]; const out = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([ids[i], ids[n - 1 - i]]);
    out.push(pairs);
    ids.splice(1, 0, ids.pop());
  }
  return out;
}
const R = rounds();
const ANCHOR = Date.UTC(2026, 7, 1, 15, 0, 0);

/** Deterministic result for a fixture number: goals with minutes. */
function simulate(num, h, aw) {
  const rnd = rng(50000 + num);
  const lh = 1.45 * 1.12 * strength[h].att * strength[aw].def;
  const la = 1.25 * strength[aw].att * strength[h].def;
  const hg = poissonSample(rnd, lh), ag = poissonSample(rnd, la);
  const goals = [];
  for (let i = 0; i < hg; i++) goals.push({ min: 1 + Math.floor(rnd() * 90), team: 'home' });
  for (let i = 0; i < ag; i++) goals.push({ min: 1 + Math.floor(rnd() * 90), team: 'away' });
  goals.sort((x, y) => x.min - y.min);
  return goals;
}
const scoreAt = (goals, minute) => [goals.filter((g) => g.team === 'home' && g.min <= minute).length, goals.filter((g) => g.team === 'away' && g.min <= minute).length];

function build(now) {
  const cur = Math.floor((now.getTime() - ANCHOR) / (2 * DAY));
  const matches = [];
  for (let r = Math.max(0, cur - 75); r <= cur + 15; r++) {
    const swap = Math.floor(r / 11) % 2 === 1;
    R[r % 11].forEach(([a, b], k) => {
      const [h, aw] = swap ? [b, a] : [a, b];
      const num = r * 6 + k;
      const kick = ANCHOR + r * 2 * DAY + OFFSETS[k] * HOUR;
      const elapsed = (now.getTime() - kick) / MIN; // minutes since kickoff
      const goals = simulate(num, h, aw);
      const m = {
        id: `demo${num}`, league: 'DEMO', date: new Date(kick).toISOString(), status: 'SCHEDULED', matchday: (r % 22) + 1, stage: null, group: null,
        home: { id: `D${h}`, name: TEAMS[h], crest: null }, away: { id: `D${aw}`, name: TEAMS[aw], crest: null },
        ft: null, ht: null, live: null, minute: null,
      };
      if (elapsed >= 115) { m.status = 'FINISHED'; m.ft = scoreAt(goals, 90); m.ht = scoreAt(goals, 45); } else if (elapsed >= 0) {
        const minute = Math.min(90, Math.floor(elapsed));
        m.status = 'LIVE'; m.minute = minute; m.live = scoreAt(goals, minute); m.ht = minute >= 45 ? scoreAt(goals, 45) : null;
      }
      matches.push(m);
    });
  }
  return matches;
}

async function getLeagueData(code, { now = new Date() }) {
  return { league: { code: 'DEMO', name: 'Demo League (simulated)', country: 'Demo', emblem: null }, matches: build(now), previousIncluded: true };
}
async function listCompetitions() { return [{ code: 'DEMO', name: 'Demo League (simulated)', country: 'Demo', emblem: null }]; }
async function getMatchesBetween(from, to) {
  const f = new Date(from + 'T00:00:00Z').getTime(), t = new Date(to + 'T23:59:59Z').getTime();
  return build(new Date()).filter((m) => { const k = new Date(m.date).getTime(); return k >= f && k <= t; });
}
async function getStandings() { throw new Error('demo has no standings endpoint'); } // the server computes them from stored results
async function getScorers() { return []; }
async function getTeam(id) { return { id, name: TEAMS[Number(String(id).slice(1))] || id, crest: null, founded: null, venue: null, colors: null, website: null, area: 'Demo', coach: null, squad: [] }; }

async function getMatchDetail(id) {
  const num = Number(String(id).replace('demo', ''));
  if (!Number.isFinite(num) || num < 0) throw new Error('not found');
  const r = Math.floor(num / 6), k = num % 6;
  const [a, b] = R[r % 11][k];
  const [h, aw] = Math.floor(r / 11) % 2 === 1 ? [b, a] : [a, b];
  const m = { home: { name: TEAMS[h] }, away: { name: TEAMS[aw] } };
  const goals = simulate(num, h, aw);
  let hs = 0, as = 0;
  const out = goals.map((g, i) => {
    if (g.team === 'home') hs++; else as++;
    return { minute: String(g.min), min: g.min, team: g.team, scorer: `${g.team === 'home' ? m.home.name : m.away.name} player ${1 + ((num + i) % 11)}`, assist: null, type: 'REGULAR', score: [hs, as] };
  });
  const rnd = rng(77000 + num);
  const poss = 38 + Math.floor(rnd() * 25);
  const mk = (p, sh) => ({ ball_possession: p, shots: sh, shots_on_goal: Math.max(0, Math.round(sh * (0.3 + rnd() * 0.3))), corner_kicks: 2 + Math.floor(rnd() * 8), fouls: 7 + Math.floor(rnd() * 9), yellow_cards: Math.floor(rnd() * 4), offsides: Math.floor(rnd() * 4) });
  return {
    goals: out, bookings: [{ minute: '34', min: 34, team: 'home', player: 'Demo player 4', card: 'YELLOW' }], subs: [], lineups: null,
    stats: { home: mk(poss, 6 + Math.floor(rnd() * 12)), away: mk(100 - poss, 5 + Math.floor(rnd() * 11)) },
    venue: 'Demo Park', referee: 'Demo referee', minute: null,
  };
}

module.exports = { name: 'demo', getLeagueData, listCompetitions, getMatchesBetween, getStandings, getScorers, getTeam, getMatchDetail };
