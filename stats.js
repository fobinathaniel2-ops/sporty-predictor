'use strict';
/** Statistics computed from the results stored in our database. Nothing here is estimated or invented. */
const engine = require('./engine');

const seasonOf = (m) => m.season ?? engine.seasonOf(m.date);
const byDate = (a, b) => new Date(a.date) - new Date(b.date);
const fin = (m) => m.status === 'FINISHED' && m.ft;
const pts = (gf, ga) => (gf > ga ? 3 : gf === ga ? 1 : 0);
const letter = (gf, ga) => (gf > ga ? 'W' : gf === ga ? 'D' : 'L');
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** The season a competition is currently in = the season of the match closest to today. */
function leagueSeason(d, code) {
  const ms = Object.values(d.matches).filter((m) => m.league === code);
  if (!ms.length) return { season: null, matches: [] };
  const now = Date.now();
  let best = ms[0], bd = Infinity;
  for (const m of ms) { const dd = Math.abs(new Date(m.date) - now); if (dd < bd) { bd = dd; best = m; } }
  const s = seasonOf(best);
  return { season: s, matches: ms.filter((m) => seasonOf(m) === s) };
}

/** Result row of one team in one match. */
function rowFor(m, teamId) {
  const home = m.home.id === teamId;
  const [h, a] = m.ft;
  const gf = home ? h : a, ga = home ? a : h;
  return { id: m.id, date: m.date, league: m.league, home, gf, ga, res: letter(gf, ga), opp: home ? m.away : m.home, score: `${h}-${a}` };
}

function blank() { return { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cs: 0, btts: 0, o25: 0, pts: 0 }; }
function add(t, gf, ga) {
  t.p++; t.gf += gf; t.ga += ga; t.pts += pts(gf, ga);
  if (gf > ga) t.w++; else if (gf === ga) t.d++; else t.l++;
  if (ga === 0) t.cs++;
  if (gf > 0 && ga > 0) t.btts++;
  if (gf + ga > 2.5) t.o25++;
}
const finish = (t) => ({
  ...t, gd: t.gf - t.ga, ppg: t.p ? r2(t.pts / t.p) : null, gfpg: t.p ? r2(t.gf / t.p) : null, gapg: t.p ? r2(t.ga / t.p) : null,
  gpm: t.p ? r2((t.gf + t.ga) / t.p) : null, bttsPct: pct(t.btts, t.p), o25Pct: pct(t.o25, t.p), csPct: pct(t.cs, t.p),
});

/** Table built from finished matches (used when the provider's table is unavailable). */
function standingsFromResults(d, code) {
  const { matches } = leagueSeason(d, code);
  const t = {};
  const names = (id) => d.teams[id] || { id, name: id };
  for (const m of matches.filter(fin)) {
    if (m.stage && !/REGULAR|LEAGUE/.test(m.stage)) continue;
    for (const side of ['home', 'away']) {
      const team = m[side]; const x = t[team.id] || (t[team.id] = { team: { ...names(team.id), ...team }, ...blank(), recent: [] });
      add(x, side === 'home' ? m.ft[0] : m.ft[1], side === 'home' ? m.ft[1] : m.ft[0]);
      x.recent.push({ date: m.date, r: letter(side === 'home' ? m.ft[0] : m.ft[1], side === 'home' ? m.ft[1] : m.ft[0]) });
    }
  }
  const table = Object.values(t).map((x) => ({
    team: x.team, played: x.p, won: x.w, draw: x.d, lost: x.l, points: x.pts, gf: x.gf, ga: x.ga, gd: x.gf - x.ga,
    form: x.recent.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-5).map((v) => v.r).join(','),
  })).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  table.forEach((r, i) => { r.position = i + 1; });
  return { groups: table.length ? [{ name: 'League', table }] : [], computed: true };
}

/** Full record of a team across stored matches. */
function teamRecord(d, teamId) {
  const all = Object.values(d.matches).filter((m) => m.home.id === teamId || m.away.id === teamId).sort(byDate);
  const finished = all.filter(fin);
  const results = finished.map((m) => rowFor(m, teamId));
  const latestSeason = finished.length ? seasonOf(finished[finished.length - 1]) : null;
  const cur = finished.filter((m) => seasonOf(m) === latestSeason);
  const total = blank(), home = blank(), away = blank();
  for (const m of cur) {
    const r = rowFor(m, teamId);
    add(total, r.gf, r.ga); add(r.home ? home : away, r.gf, r.ga);
  }
  const seasons = {};
  for (const m of finished) { const s = seasonOf(m); const r = rowFor(m, teamId); add(seasons[s] || (seasons[s] = blank()), r.gf, r.ga); }
  const last5 = results.slice(-5);
  const now = Date.now();
  return {
    season: latestSeason,
    total: finish(total), home: finish(home), away: finish(away),
    seasons: Object.entries(seasons).sort((a, b) => b[0] - a[0]).map(([s, t]) => ({ season: Number(s), ...finish(t) })),
    form: last5.map((r) => r.res).join(''), formPpg: last5.length ? r2(last5.reduce((s, r) => s + pts(r.gf, r.ga), 0) / last5.length) : null,
    recent: results.slice(-8).reverse(),
    upcoming: all.filter((m) => m.status === 'SCHEDULED' && new Date(m.date) > now - 3 * 3600000).slice(0, 6),
    leagues: [...new Set(all.map((m) => m.league))],
  };
}

function h2h(d, aId, bId, limit = 8) {
  const ms = Object.values(d.matches).filter((m) => fin(m) && ((m.home.id === aId && m.away.id === bId) || (m.home.id === bId && m.away.id === aId))).sort(byDate).reverse().slice(0, limit);
  let aw = 0, dr = 0, bw = 0, ag = 0, bg = 0;
  for (const m of ms) {
    const r = rowFor(m, aId);
    ag += r.gf; bg += r.ga;
    if (r.res === 'W') aw++; else if (r.res === 'D') dr++; else bw++;
  }
  return { meetings: ms.length, aWins: aw, draws: dr, bWins: bw, aGoals: ag, bGoals: bg, matches: ms };
}

/** League-wide statistics and rankings for the current season. */
function leagueStats(d, code) {
  const { season, matches } = leagueSeason(d, code);
  const done = matches.filter(fin).sort(byDate);
  const teams = {};
  const league = { n: done.length, hw: 0, dr: 0, aw: 0, goals: 0, hg: 0, ag: 0, o25: 0, btts: 0 };
  for (const m of done) {
    const [h, a] = m.ft;
    league.goals += h + a; league.hg += h; league.ag += a;
    if (h > a) league.hw++; else if (h === a) league.dr++; else league.aw++;
    if (h + a > 2.5) league.o25++;
    if (h > 0 && a > 0) league.btts++;
    for (const side of ['home', 'away']) {
      const tm = m[side];
      const x = teams[tm.id] || (teams[tm.id] = { team: { ...(d.teams[tm.id] || {}), ...tm }, total: blank(), home: blank(), away: blank(), recent: [] });
      const gf = side === 'home' ? h : a, ga = side === 'home' ? a : h;
      add(x.total, gf, ga); add(x[side], gf, ga); x.recent.push({ gf, ga });
    }
  }
  const rows = Object.values(teams).map((x) => {
    const last5 = x.recent.slice(-5);
    return { team: x.team, ...finish(x.total), homePpg: finish(x.home).ppg, awayPpg: finish(x.away).ppg, homeGf: finish(x.home).gfpg, awayGf: finish(x.away).gfpg,
      form: last5.map((r) => letter(r.gf, r.ga)).join(''), formPpg: last5.length ? r2(last5.reduce((s, r) => s + pts(r.gf, r.ga), 0) / last5.length) : null };
  });
  const top = (key, n = 10, dir = -1, min = 3) => rows.filter((r) => r.p >= min && r[key] !== null).sort((a, b) => dir * (a[key] - b[key])).slice(0, n);
  return {
    season, matches: league.n,
    summary: league.n ? {
      goalsPerMatch: r2(league.goals / league.n), avgHomeGoals: r2(league.hg / league.n), avgAwayGoals: r2(league.ag / league.n),
      homeWinPct: pct(league.hw, league.n), drawPct: pct(league.dr, league.n), awayWinPct: pct(league.aw, league.n),
      over25Pct: pct(league.o25, league.n), bttsPct: pct(league.btts, league.n),
    } : null,
    cleanSheets: top('cs', 10),
    goalsPerMatch: top('gpm', 10),
    bestAttack: top('gfpg', 10),
    bestDefence: top('gapg', 10, 1),
    form: top('formPpg', 10),
    homeAway: rows.filter((r) => r.p >= 3).map((r) => ({ team: r.team, homePpg: r.homePpg, awayPpg: r.awayPpg, homeGf: r.homeGf, awayGf: r.awayGf }))
      .sort((a, b) => ((b.homePpg ?? 0) - (b.awayPpg ?? 0)) - ((a.homePpg ?? 0) - (a.awayPpg ?? 0))).slice(0, 10),
    teams: rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd),
  };
}

function search(d, q, codes) {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return { teams: [], leagues: [], fixtures: [] };
  const leagues = Object.values(d.leagues).filter((l) => codes.includes(l.code) && (l.name.toLowerCase().includes(s) || (l.country || '').toLowerCase().includes(s))).slice(0, 6);
  const teamIds = new Set();
  const teams = [];
  for (const m of Object.values(d.matches)) {
    if (!codes.includes(m.league)) continue;
    for (const side of ['home', 'away']) {
      const t = m[side];
      if (!teamIds.has(t.id) && t.name.toLowerCase().includes(s)) { teamIds.add(t.id); teams.push({ ...t, league: m.league }); }
    }
  }
  const now = Date.now();
  const fixtures = Object.values(d.matches)
    .filter((m) => codes.includes(m.league) && (teamIds.has(m.home.id) || teamIds.has(m.away.id)) && Math.abs(new Date(m.date) - now) < 14 * 86400000)
    .sort(byDate).slice(0, 8);
  return { teams: teams.slice(0, 8), leagues, fixtures };
}

module.exports = { leagueSeason, standingsFromResults, teamRecord, h2h, leagueStats, search, rowFor, seasonOf, r2 };
