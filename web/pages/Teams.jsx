import { useState } from 'react';
import Icon from '../ui/Icon';
import { A, Async, Crest, Empty, FormDots, Note, Section, Skel, SkelCards, SkelList, Tag } from '../ui/base';
import { CompareRows } from '../ui/charts';
import { MatchList } from '../ui/match';
import { useApi, useApp } from '../lib/app';

export function TeamsPage() {
  const { status, isFav, toggleFav } = useApp();
  const [league, setLeague] = useState('');
  const [term, setTerm] = useState('');
  const q = useApi(`/api/teams${league ? `?league=${league}` : ''}`);
  return (
    <div>
      <h1 style={{ margin: '8px 0 12px' }}>Teams</h1>
      <input className="field" placeholder="Filter teams…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Filter teams" />
      <div className="chips" style={{ marginTop: 10 }}>
        <button className={`chip ${league === '' ? 'on' : ''}`} onClick={() => setLeague('')}>All competitions</button>
        {(status?.leagues || []).map((l) => <button key={l.code} className={`chip ${league === l.code ? 'on' : ''}`} onClick={() => setLeague(l.code)}><Crest team={{ name: l.name, crest: l.emblem }} size={18} />{l.name}</button>)}
      </div>
      <Async q={q} skeleton={<SkelCards n={6} h={84} />}>{(list) => {
        const s = term.trim().toLowerCase();
        const shown = list.filter((t) => !s || t.name.toLowerCase().includes(s)).sort((a, b) => Number(isFav('team', b.id)) - Number(isFav('team', a.id)));
        return shown.length ? <div className="grid g3" style={{ marginTop: 6 }}>{shown.map((t) => (
          <div key={t.id} className="card lift row" style={{ padding: 12 }}>
            <A to={`/team/${t.id}`} className="row grow" style={{ minWidth: 0 }}><Crest team={t} size={40} /><div style={{ minWidth: 0 }}><b className="ell" style={{ display: 'block' }}>{t.name}</b><span className="xs muted">{t.elo ? `Elo ${t.elo}` : t.league}</span></div></A>
            <button className={`iconbtn ${isFav('team', t.id) ? 'on' : ''}`} onClick={() => toggleFav('team', t.id)} aria-label={`Favourite ${t.name}`}><Icon name="star" size={17} fill={isFav('team', t.id)} /></button>
          </div>))}</div> : <div style={{ marginTop: 10 }}><Empty icon="shield" title="No teams found">Try a different name or competition.</Empty></div>;
      }}</Async>
    </div>
  );
}

const POS_ORDER = ['Goalkeeper', 'Defence', 'Midfield', 'Offence'];
const posGroup = (p = '') => (/keeper/i.test(p) ? 'Goalkeepers' : /back|defen/i.test(p) ? 'Defenders' : /mid/i.test(p) ? 'Midfielders' : /wing|forward|offen|strik/i.test(p) ? 'Forwards' : 'Other');
const age = (b) => (b ? Math.floor((Date.now() - new Date(b)) / 31557600000) : null);

function Record({ r, title }) {
  return (
    <div className="card">
      <h4 className="muted" style={{ marginBottom: 8 }}>{title}</h4>
      {r.p ? <>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}><b className="num" style={{ fontSize: 22 }}>{r.w}W {r.d}D {r.l}L</b><span className="muted sm">{r.p} played</span></div>
        <div className="grid g4" style={{ marginTop: 10, gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div className="tile"><div className="v">{r.gfpg}</div><div className="l">Scored / game</div></div>
          <div className="tile"><div className="v">{r.gapg}</div><div className="l">Conceded / game</div></div>
          <div className="tile"><div className="v">{r.ppg}</div><div className="l">Points / game</div></div>
          <div className="tile"><div className="v">{r.cs}</div><div className="l">Clean sheets</div></div>
        </div></> : <p className="muted sm">No matches stored yet.</p>}
    </div>
  );
}

export function TeamPage({ id }) {
  const { isFav, toggleFav } = useApp();
  const q = useApi(`/api/team/${id}`);
  return (
    <div style={{ paddingTop: 8 }}>
      <Async q={q} skeleton={<><Skel h={150} r={22} /><div style={{ height: 14 }} /><SkelList n={4} /></>}>{(d) => {
        const t = d.team, r = d.record;
        const squad = {};
        d.squad.forEach((p) => { (squad[posGroup(p.position)] = squad[posGroup(p.position)] || []).push(p); });
        const order = ['Goalkeepers', 'Defenders', 'Midfielders', 'Forwards', 'Other'].filter((k) => squad[k]);
        return (
          <>
            <div className="card glow" style={{ padding: 20 }}>
              <div className="row" style={{ gap: 16 }}>
                <Crest team={t} size={76} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <h1 style={{ fontSize: 28 }}>{t.name}</h1>
                  <p className="muted sm">{[t.venue, t.founded && `Founded ${t.founded}`, t.area, t.coach && `Coach: ${t.coach}`].filter(Boolean).join(' · ') || 'Club information is not available.'}</p>
                  <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                    {d.positions.map((p) => <A key={p.code} to={`/league/${p.code}`}><Tag kind="High">#{p.position} {p.name}</Tag></A>)}
                    {d.elo && <Tag>Elo {d.elo}</Tag>}
                  </div>
                </div>
                <button className={`iconbtn ${isFav('team', id) ? 'on' : ''}`} onClick={() => toggleFav('team', id)} aria-label="Favourite"><Icon name="star" size={18} fill={isFav('team', id)} /></button>
              </div>
              {r.form && <div className="between" style={{ marginTop: 16 }}><span className="muted sm">Last {r.form.length} results</span><FormDots form={r.form.split('')} /></div>}
            </div>

            <Section title="Season record" icon="chart">
              <div className="grid g3"><Record r={r.total} title="OVERALL" /><Record r={r.home} title="AT HOME" /><Record r={r.away} title="AWAY" /></div>
              {r.home.p > 0 && r.away.p > 0 && <div className="card" style={{ marginTop: 12 }}><h4 className="muted" style={{ marginBottom: 6 }}>HOME vs AWAY</h4><CompareRows rows={[
                { label: 'Points / game', a: r.home.ppg, b: r.away.ppg }, { label: 'Scored / game', a: r.home.gfpg, b: r.away.gfpg },
                { label: 'Conceded / game', a: r.home.gapg, b: r.away.gapg, lowerBetter: true }, { label: 'Clean sheets %', a: r.home.csPct, b: r.away.csPct, suffix: '%' }]} /></div>}
            </Section>

            <div className="cols">
              <div>
                <Section title="Upcoming fixtures" icon="calendar">
                  {d.upcoming.length ? <MatchList matches={d.upcoming} grouped={false} /> : <Empty icon="calendar" title="Nothing scheduled">No upcoming fixtures are stored.</Empty>}
                </Section>
                <Section title="Recent results" icon="results">
                  {d.recent.length ? <div className="card flat">{d.recent.map((x) => (
                    <A key={x.id} to={`/match/${x.id}`} className="mrow" style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto' }}>
                      <span className={`fd ${x.res}`}>{x.res}</span><span className="row"><Crest team={x.opp} size={22} /><span className="ell">{x.home ? 'vs' : '@'} {x.opp.name}</span></span><b className="num">{x.score}</b>
                    </A>))}</div> : <Empty icon="results" title="No results yet">Finished matches will show here.</Empty>}
                </Section>
              </div>
              <div>
                <Section title="History" icon="clock">
                  {r.seasons.length ? <div className="card flat"><table className="tbl"><thead><tr><th>Season</th><th></th><th>P</th><th>W-D-L</th><th>GF-GA</th><th>PPG</th></tr></thead>
                    <tbody>{r.seasons.map((s) => <tr key={s.season}><td>{s.season}/{String(s.season + 1).slice(2)}</td><td /><td>{s.p}</td><td>{s.w}-{s.d}-{s.l}</td><td>{s.gf}-{s.ga}</td><td className="pts">{s.ppg}</td></tr>)}</tbody></table></div> : <Empty icon="clock" title="No history stored">Past seasons appear once they are loaded.</Empty>}
                  <p className="xs dim" style={{ marginTop: 8 }}>The last two seasons stored by this app.</p>
                </Section>
                <Section title="Squad" icon="user">
                  {order.length ? <div className="card">{order.map((k) => (
                    <div key={k} style={{ marginBottom: 12 }}><h4 className="muted" style={{ marginBottom: 6 }}>{k.toUpperCase()}</h4>
                      {squad[k].map((p) => <div key={p.id} className="between sm" style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}><b>{p.name}</b><span className="muted xs">{p.nationality || ''}{age(p.born) ? ` · ${age(p.born)}` : ''}</span></div>)}</div>))}</div> :
                    <Note info>{d.infoNote || 'Squad information is not available from the data source.'}</Note>}
                </Section>
              </div>
            </div>
          </>);
      }}</Async>
    </div>
  );
}
