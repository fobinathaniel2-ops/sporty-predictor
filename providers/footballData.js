'use strict';
/**
 * football-data.org v4 provider. Free plan: 10 requests/minute, 12 competitions.
 * Every call goes through one priority queue that keeps us under the rate limit:
 * priority 2 = live polling, 1 = a user is waiting, 0 = background loading.
 */
const BASE = 'https://api.football-data.org/v4';
const GAP_MS = 6500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ProviderError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

const queue = [];
let working = false;
let last = 0;

async function work() {
  if (working) return;
  working = true;
  while (queue.length) {
    queue.sort((a, b) => b.prio - a.prio || a.t - b.t);
    const job = queue.shift();
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try { job.resolve(await request(job.path)); } catch (e) { job.reject(e); }
  }
  working = false;
}

function get(pathname, prio = 0) {
  return new Promise((resolve, reject) => { queue.push({ path: pathname, prio, t: Date.now(), resolve, reject }); work(); });
}

async function request(pathname) {
  const r = await fetch(BASE + pathname, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY } });
  if (r.status === 429) throw new ProviderError('Rate limited by provider (429). Will retry later.', 429);
  if (r.status === 401) throw new ProviderError('Provider rejected the API key (401).', 401);
  if (r.status === 403) throw new ProviderError('Not included in your football-data.org plan (403).', 403);
  if (r.status === 404) throw new ProviderError('Not found at provider (404).', 404);
  if (!r.ok) throw new ProviderError(`Provider returned HTTP ${r.status}`, r.status);
  return r.json();
}

const STATUS = { SCHEDULED: 'SCHEDULED', TIMED: 'SCHEDULED', FINISHED: 'FINISHED', AWARDED: 'FINISHED', IN_PLAY: 'LIVE', PAUSED: 'LIVE', LIVE: 'LIVE' };
const team = (t) => ({ id: String(t.id), name: t.shortName || t.name, crest: t.crest || null });
const pair = (s) => (Number.isFinite(s?.home) && Number.isFinite(s?.away) ? [s.home, s.away] : null);

function normalize(m, code) {
  const status = STATUS[m.status] || 'OTHER'; // postponed, cancelled, suspended...
  const ft = pair(m.score?.fullTime), ht = pair(m.score?.halfTime);
  return {
    id: `fd${m.id}`, league: code || m.competition?.code, date: m.utcDate, status, matchday: m.matchday ?? null, stage: m.stage || null, group: m.group || null,
    season: m.season?.startDate ? Number(m.season.startDate.slice(0, 4)) : null,
    home: team(m.homeTeam), away: team(m.awayTeam),
    ft: status === 'FINISHED' ? ft : null, ht: status === 'FINISHED' || status === 'LIVE' ? ht : null,
    live: status === 'LIVE' ? ft : null, minute: status === 'LIVE' ? (m.minute ?? null) : null,
  };
}

async function listCompetitions() {
  const j = await get('/competitions', 0);
  return (j.competitions || []).map((c) => ({ code: c.code, name: c.name, country: c.area?.name || '', plan: c.plan, emblem: c.emblem || null }));
}

async function getLeagueData(code, { includePrevious }) {
  if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new ProviderError(`Bad competition code ${code}`);
  const cur = await get(`/competitions/${code}/matches`, 0); // current season
  const matches = (cur.matches || []).filter((m) => m.homeTeam?.id && m.awayTeam?.id).map((m) => normalize(m, code));
  let previousIncluded = false;
  const startYear = cur.matches?.[0]?.season?.startDate ? Number(cur.matches[0].season.startDate.slice(0, 4)) : null;
  if (includePrevious && startYear) {
    try {
      const prev = await get(`/competitions/${code}/matches?season=${startYear - 1}&status=FINISHED`, 0);
      for (const m of prev.matches || []) if (m.homeTeam?.id && m.awayTeam?.id) matches.push(normalize(m, code));
      previousIncluded = true;
    } catch (e) { /* previous season may not be on the plan; continue */ }
  }
  return {
    league: { code, name: cur.competition?.name || code, country: cur.competition?.area?.name || '', emblem: cur.competition?.emblem || null },
    matches, previousIncluded,
  };
}

/** All matches across your competitions in a date window (YYYY-MM-DD, max 10 days). One request = live scores for everything. */
async function getMatchesBetween(from, to, prio = 2) {
  const j = await get(`/matches?dateFrom=${from}&dateTo=${to}`, prio);
  return (j.matches || []).filter((m) => m.homeTeam?.id && m.awayTeam?.id && m.competition?.code).map((m) => normalize(m));
}

async function getStandings(code, prio = 1) {
  const j = await get(`/competitions/${code}/standings`, prio);
  const groups = (j.standings || []).filter((s) => s.type === 'TOTAL').map((s) => ({
    name: s.group || s.stage || 'League',
    table: (s.table || []).map((r) => ({
      position: r.position, team: team(r.team), played: r.playedGames, won: r.won, draw: r.draw, lost: r.lost,
      points: r.points, gf: r.goalsFor, ga: r.goalsAgainst, gd: r.goalDifference, form: r.form || null,
    })),
  }));
  return { groups, season: j.season ? { start: j.season.startDate, end: j.season.endDate, matchday: j.season.currentMatchday } : null };
}

async function getScorers(code, prio = 1) {
  const j = await get(`/competitions/${code}/scorers?limit=30`, prio);
  return (j.scorers || []).map((s) => ({
    player: { id: String(s.player.id), name: s.player.name, nationality: s.player.nationality || null },
    team: team(s.team), played: s.playedMatches ?? null, goals: s.goals ?? 0, assists: s.assists ?? null, penalties: s.penalties ?? null,
  }));
}

async function getTeam(id, prio = 1) {
  const t = await get(`/teams/${encodeURIComponent(String(id).replace(/^fd/, ''))}`, prio);
  return {
    id: String(t.id), name: t.shortName || t.name, fullName: t.name, crest: t.crest || null, founded: t.founded || null, venue: t.venue || null,
    colors: t.clubColors || null, website: t.website || null, area: t.area?.name || null, coach: t.coach?.name || null,
    squad: (t.squad || []).map((p) => ({ id: String(p.id), name: p.name, position: p.position || null, nationality: p.nationality || null, born: p.dateOfBirth || null })),
  };
}

const minuteOf = (g) => (g.minute != null ? `${g.minute}${g.injuryTime ? '+' + g.injuryTime : ''}` : null);

/** Match details. Whatever the plan does not include simply comes back empty; nothing is invented. */
async function getMatchDetail(id, prio = 1) {
  const m = await get(`/matches/${encodeURIComponent(String(id).replace(/^fd/, ''))}`, prio);
  const hid = String(m.homeTeam?.id);
  const side = (t) => (String(t?.id) === hid ? 'home' : 'away');
  let h = 0, a = 0;
  const goals = (m.goals || []).map((g) => {
    const s = side(g.team);
    if (g.score && Number.isFinite(g.score.home)) { h = g.score.home; a = g.score.away; } else if (s === 'home') h++; else a++;
    return { minute: minuteOf(g), min: g.minute ?? null, team: s, scorer: g.scorer?.name || null, assist: g.assist?.name || null, type: g.type || null, score: [h, a] };
  });
  const bookings = (m.bookings || []).map((b) => ({ minute: minuteOf(b), min: b.minute ?? null, team: side(b.team), player: b.player?.name || null, card: b.card || null }));
  const subs = (m.substitutions || []).map((s) => ({ minute: minuteOf(s), min: s.minute ?? null, team: side(s.team), out: s.playerOut?.name || null, in: s.playerIn?.name || null }));
  const lu = (t) => (t && (t.lineup?.length || t.bench?.length) ? {
    formation: t.formation || null, coach: t.coach?.name || null,
    startXI: (t.lineup || []).map((p) => ({ name: p.name, number: p.shirtNumber ?? null, position: p.position || null })),
    bench: (t.bench || []).map((p) => ({ name: p.name, number: p.shirtNumber ?? null, position: p.position || null })),
  } : null);
  const st = (t) => (t?.statistics && Object.keys(t.statistics).length ? t.statistics : null);
  const stats = st(m.homeTeam) && st(m.awayTeam) ? { home: st(m.homeTeam), away: st(m.awayTeam) } : null;
  return {
    goals, bookings, subs, lineups: lu(m.homeTeam) || lu(m.awayTeam) ? { home: lu(m.homeTeam), away: lu(m.awayTeam) } : null, stats,
    venue: m.venue || null, referee: m.referees?.[0]?.name || null, minute: m.minute ?? null,
  };
}

module.exports = { name: 'football-data.org', getLeagueData, listCompetitions, getMatchesBetween, getStandings, getScorers, getTeam, getMatchDetail, ProviderError };
