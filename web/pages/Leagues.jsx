import Icon from '../ui/Icon';
import { A, Async, Crest, Empty, FormDots, Note, Section, Seg, SkelCards, SkelList, Skel, Tag } from '../ui/base';
import { MatchList } from '../ui/match';
import { setQuery, useApi, useApp } from '../lib/app';


function LeagueCard({ l }) {
  const { isFav, toggleFav } = useApp();
  return (
    <div className="card lift row" style={{ padding: 14 }}>
      <A to={`/league/${l.code}`} className="row grow" style={{ minWidth: 0 }}>
        <Crest team={{ name: l.name, crest: l.emblem }} size={44} />
        <div className="grow" style={{ minWidth: 0 }}><b className="ell" style={{ display: 'block', fontSize: 16 }}>{l.name}</b>
          <span className="xs muted">{l.country} · {l.teams} teams{l.live ? ` · ${l.live} live` : ''}</span><div className="xs g">{l.next7} matches this week</div></div>
      </A>
      <button className={`iconbtn ${isFav('league', l.code) ? 'on' : ''}`} onClick={() => toggleFav('league', l.code)} aria-label="Favourite"><Icon name="star" size={18} fill={isFav('league', l.code)} /></button>
    </div>
  );
}

export function LeaguesPage() {
  const q = useApi('/api/leagues');
  return (
    <div>
      <h1 style={{ margin: '8px 0 4px' }}>Leagues</h1>
      <p className="muted" style={{ marginBottom: 6 }}>Standings, fixtures, results, top scorers and team statistics.</p>
      <Async q={q} skeleton={<SkelCards n={4} h={90} />}>{(ls) => {
        const sorted = [...ls].sort((x, y) => (x.order ?? 999) - (y.order ?? 999));
        const lg = sorted.filter((l) => l.kind === 'league'), cups = sorted.filter((l) => l.kind === 'cup'), es = sorted.filter((l) => l.kind === 'esports');
        const block = (title, list, icon) => list.length ? <Section title={title} icon={icon}><div className="grid g3">{list.map((l) => <LeagueCard key={l.code} l={l} />)}</div></Section> : null;
        return ls.length ? <>{block('Leagues', lg, 'trophy')}{block('Cups & international', cups, 'ball')}{block('eFootball esports (virtual football played by gamers)', es, 'bolt')}
          <div style={{ marginTop: 22 }}><Note info>Only the competitions on your list are covered. Gemini searches the web alongside the football-data.org feed: competitions missing from the feed (most cups and African, Asian and American leagues) appear once Gemini finds their matches, with no standings or player stats. eFootball esports matches are found the same way.</Note></div></> :
          <div style={{ marginTop: 16 }}><Empty icon="trophy" title="No competitions loaded yet">The first data update may still be running.</Empty></div>;
      }}</Async>
    </div>
  );
}

function Standings({ st }) {
  const { isFav } = useApp();
  if (!st.groups.length) return <Empty icon="chart" title="No table yet">Standings appear once matches have been played.</Empty>;
  return (
    <div className="stack">
      {st.groups.map((g) => (
        <div className="card flat" key={g.name}>
          {st.groups.length > 1 && <div className="lgh">{g.name.replace(/_/g, ' ')}</div>}
          <div className="scroll-x"><table className="tbl">
            <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead>
            <tbody>{g.table.map((r) => (
              <tr key={r.team.id} className={r.position === 1 ? 'top1' : ''}>
                <td className="pos">{r.position}</td>
                <td className="team"><A to={`/team/${r.team.id}`} className="row" style={{ minWidth: 150 }}><Crest team={r.team} size={22} /><span className="ell">{r.team.name}</span>{isFav('team', r.team.id) && <Icon name="star" size={13} fill className="amber" />}</A></td>
                <td>{r.played}</td><td>{r.won}</td><td>{r.draw}</td><td>{r.lost}</td><td>{r.gd > 0 ? '+' : ''}{r.gd}</td><td className="pts">{r.points}</td>
                <td style={{ textAlign: 'right' }}>{r.form ? <FormDots form={r.form.split(',').filter(Boolean).slice(-5)} /> : '–'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>))}
      <p className="xs dim">{st.source === 'provider' ? `Table from football-data.org${st.stale ? ' (saved copy; the source could not be reached)' : ''}.` : 'Table calculated from the results stored by this app (the data source did not supply one).'}</p>
    </div>
  );
}

function Scorers({ list, note }) {
  if (!list.length) return <Note info>{note || 'No scorers data yet.'}</Note>;
  return (
    <div className="card flat"><div className="scroll-x"><table className="tbl">
      <thead><tr><th>#</th><th>Player</th><th>Played</th><th>Goals</th><th>Assists</th><th>Pens</th></tr></thead>
      <tbody>{list.map((s, i) => (
        <tr key={s.player.id}><td className="pos">{i + 1}</td>
          <td className="team"><A to={`/team/${s.team.id}`} className="row" style={{ minWidth: 170 }}><Crest team={s.team} size={22} /><span><b>{s.player.name}</b><br /><span className="xs muted">{s.team.name}</span></span></A></td>
          <td>{s.played ?? '–'}</td><td className="pts">{s.goals}</td><td>{s.assists ?? '–'}</td><td>{s.penalties ?? '–'}</td></tr>))}</tbody>
    </table></div></div>
  );
}

function TeamStats({ rows }) {
  if (!rows.length) return <Empty icon="chart" title="No team statistics yet">Statistics appear once matches have been played.</Empty>;
  return (
    <div className="card flat"><div className="scroll-x"><table className="tbl">
      <thead><tr><th>#</th><th>Team</th><th>P</th><th>GF</th><th>GA</th><th>CS</th><th>BTTS%</th><th>O2.5%</th><th>PPG</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.team.id}><td className="pos">{i + 1}</td><td className="team"><A to={`/team/${r.team.id}`} className="row" style={{ minWidth: 150 }}><Crest team={r.team} size={22} /><span className="ell">{r.team.name}</span></A></td>
          <td>{r.p}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.cs}</td><td>{r.bttsPct ?? '–'}</td><td>{r.o25Pct ?? '–'}</td><td className="pts">{r.ppg ?? '–'}</td></tr>))}</tbody>
    </table></div></div>
  );
}

export function LeaguePage({ code, tab }) {
  const { isFav, toggleFav } = useApp();
  const q = useApi(`/api/league/${code}`, { poll: 90000 });
  const t = ['table', 'fixtures', 'results', 'scorers', 'teams'].includes(tab) ? tab : 'table';
  return (
    <div style={{ paddingTop: 8 }}>
      <Async q={q} skeleton={<><Skel h={90} r={22} /><div style={{ height: 14 }} /><SkelList n={6} h={52} /></>}>{(d) => (
        <>
          <div className="card glow row" style={{ padding: 18, gap: 16 }}>
            <Crest team={{ name: d.league.name, crest: d.league.emblem }} size={64} />
            <div className="grow"><h1 style={{ fontSize: 28 }}>{d.league.name}</h1><p className="muted sm">{d.league.country}{d.league.demo ? ' · simulated demo league' : ''}</p>
              <A to={`/stats?league=${d.league.code}`} className="g sm" style={{ fontWeight: 700 }}>Open statistics centre →</A></div>
            <button className={`iconbtn ${isFav('league', code) ? 'on' : ''}`} onClick={() => toggleFav('league', code)} aria-label="Favourite"><Icon name="star" size={18} fill={isFav('league', code)} /></button>
          </div>
          <div style={{ margin: '14px 0' }}><Seg value={t} onChange={(v) => setQuery('tab', v === 'table' ? '' : v)} options={[['table', 'Standings'], ['fixtures', 'Fixtures'], ['results', 'Results'], ['scorers', 'Top scorers'], ['teams', 'Team stats']]} /></div>
          {t === 'table' && <Standings st={d.standings} />}
          {t === 'fixtures' && (d.fixtures.length ? <MatchList matches={d.fixtures} grouped={false} /> : <Empty icon="calendar" title="No upcoming fixtures">Nothing is scheduled right now.</Empty>)}
          {t === 'results' && (d.results.length ? <MatchList matches={d.results} grouped={false} /> : <Empty icon="results" title="No results yet">Finished matches will show here.</Empty>)}
          {t === 'scorers' && <Scorers list={d.scorers} note={d.scorersNote} />}
          {t === 'teams' && <TeamStats rows={d.teamStats} />}
        </>)}
      </Async>
    </div>
  );
}
