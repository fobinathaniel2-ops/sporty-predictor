import { useEffect, useState } from 'react';
import { A, Async, Crest, Empty, Note, Section, Seg, Skel, SkelCards, SkelList } from '../ui/base';
import { CompareRows, GroupedBars, TeamBars } from '../ui/charts';
import { setQuery, useApi, useApp, useRoute } from '../lib/app';

const TABS = [['overview', 'Overview'], ['players', 'Players'], ['teams', 'Teams'], ['form', 'Form'], ['home', 'Home vs away'], ['compare', 'Compare']];
const vals = (rows, key) => (rows || []).filter((r) => r[key] != null).map((r) => ({ team: r.team, value: r[key] }));

function Players({ d }) {
  if (!d.topScorers.length) return <Note info>{d.playerNote || 'No player statistics are available for this competition yet.'}</Note>;
  const list = (rows, key, title) => (
    <div className="card"><h4 className="muted" style={{ marginBottom: 8 }}>{title}</h4>
      {rows.length ? rows.map((s, i) => (
        <A key={s.player.id} to={`/team/${s.team.id}`} className="hbar" style={{ gridTemplateColumns: '24px 1fr 40px' }}>
          <span className="rk">{i + 1}</span><span className="n"><Crest team={s.team} size={22} /><span><b className="sm">{s.player.name}</b><br /><span className="xs muted">{s.team.name}</span></span></span><span className="vv">{s[key]}</span>
        </A>)) : <p className="muted sm">Not provided for this competition.</p>}
    </div>);
  return <div className="grid g2">{list(d.topScorers, 'goals', 'TOP SCORERS')}{list(d.topAssists, 'assists', 'MOST ASSISTS')}</div>;
}

function Compare({ code }) {
  const q = useApi(`/api/league/${code}`);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <Async q={q} skeleton={<Skel h={200} r={18} />}>{(d) => {
      const rows = d.teamStats;
      const ra = rows.find((r) => String(r.team.id) === a), rb = rows.find((r) => String(r.team.id) === b);
      const sel = (v, set, label) => <select className="field" value={v} onChange={(e) => set(e.target.value)} aria-label={label}><option value="">{label}</option>{rows.map((r) => <option key={r.team.id} value={r.team.id}>{r.team.name}</option>)}</select>;
      return (
        <div className="card">
          <div className="grid g2">{sel(a, setA, 'Choose team A')}{sel(b, setB, 'Choose team B')}</div>
          {ra && rb ? (
            <div style={{ marginTop: 16 }}>
              <div className="between" style={{ marginBottom: 10 }}><span className="row"><Crest team={ra.team} size={30} /><b>{ra.team.name}</b></span><span className="row"><b>{rb.team.name}</b><Crest team={rb.team} size={30} /></span></div>
              <CompareRows rows={[
                { label: 'Played', a: ra.p, b: rb.p }, { label: 'Points / game', a: ra.ppg, b: rb.ppg }, { label: 'Scored / game', a: ra.gfpg, b: rb.gfpg },
                { label: 'Conceded / game', a: ra.gapg, b: rb.gapg, lowerBetter: true }, { label: 'Clean sheets', a: ra.cs, b: rb.cs },
                { label: 'Both teams scored %', a: ra.bttsPct, b: rb.bttsPct, suffix: '%' }, { label: 'Over 2.5 %', a: ra.o25Pct, b: rb.o25Pct, suffix: '%' },
              ]} />
              <p className="xs dim" style={{ marginTop: 10 }}>Season figures from stored results. The greener number is the better one.</p>
            </div>) : <p className="muted sm" style={{ marginTop: 14 }}>Pick two teams to compare their season side by side.</p>}
        </div>);
    }}</Async>
  );
}

export default function Stats() {
  const { status, prefs } = useApp();
  const { query } = useRoute();
  const leagues = status?.leagues || [];
  const code = query.league || prefs.favLeagues[0] || leagues[0]?.code;
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'overview';
  const q = useApi(code ? `/api/stats/${code}` : '', { enabled: !!code });
  return (
    <div>
      <h1 style={{ margin: '8px 0 4px' }}>Statistics</h1>
      <p className="muted" style={{ marginBottom: 12 }}>Rankings built from real results stored in this app.</p>
      <div className="chips">{leagues.map((l) => <button key={l.code} className={`chip ${code === l.code ? 'on' : ''}`} onClick={() => setQuery('league', l.code)}><Crest team={{ name: l.name, crest: l.emblem }} size={18} />{l.name}</button>)}</div>
      <div style={{ margin: '12px 0' }}><Seg value={tab} onChange={(v) => setQuery('tab', v === 'overview' ? '' : v)} options={TABS} /></div>
      {!code ? <Empty icon="chart" title="No competitions loaded">Statistics appear after the first data update.</Empty> : tab === 'compare' ? <Compare code={code} /> : (
        <Async q={q} skeleton={<><SkelCards n={4} h={90} /><div style={{ height: 12 }} /><SkelList n={5} /></>}>{(d) => {
          if (!d.matches) return <Empty icon="chart" title="No finished matches yet">Statistics appear once matches in {d.league.name} have been played.</Empty>;
          const s = d.summary;
          return (
            <>
              {tab === 'overview' && <>
                <div className="grid g4">
                  <div className="tile"><div className="v">{s.goalsPerMatch}</div><div className="l">Goals / match</div></div>
                  <div className="tile"><div className="v">{s.bttsPct}%</div><div className="l">Both teams score</div></div>
                  <div className="tile"><div className="v">{s.over25Pct}%</div><div className="l">Over 2.5 goals</div></div>
                  <div className="tile"><div className="v">{d.matches}</div><div className="l">Matches played</div></div>
                </div>
                <div className="card" style={{ marginTop: 12 }}>
                  <h4 className="muted" style={{ marginBottom: 10 }}>HOW MATCHES END</h4>
                  <div style={{ display: 'flex', height: 12, borderRadius: 8, overflow: 'hidden' }}><i style={{ width: `${s.homeWinPct}%`, background: 'var(--g)' }} /><i style={{ width: `${s.drawPct}%`, background: 'var(--amber)' }} /><i style={{ width: `${s.awayWinPct}%`, background: 'var(--blue)' }} /></div>
                  <div className="between sm" style={{ marginTop: 8 }}><span>Home wins {s.homeWinPct}%</span><span>Draws {s.drawPct}%</span><span>Away wins {s.awayWinPct}%</span></div>
                  <p className="xs dim" style={{ marginTop: 8 }}>Average score {s.avgHomeGoals} – {s.avgAwayGoals} · {d.season}/{String(d.season + 1).slice(2)} season</p>
                </div>
                <div className="grid g2" style={{ marginTop: 12 }}>
                  <Section title="Best attack" icon="bolt"><div className="card"><TeamBars rows={vals(d.bestAttack, 'gfpg')} unit=" /g" /></div></Section>
                  <Section title="Best defence" icon="shield"><div className="card"><TeamBars rows={vals(d.bestDefence, 'gapg')} unit=" /g" invert /></div></Section>
                </div></>}
              {tab === 'players' && <Players d={d} />}
              {tab === 'teams' && <div className="grid g2">
                <Section title="Clean sheets" icon="shield"><div className="card"><TeamBars rows={vals(d.cleanSheets, 'cs')} digits={0} /></div></Section>
                <Section title="Goals per match" icon="ball"><div className="card"><TeamBars rows={vals(d.goalsPerMatch, 'gpm')} /></div></Section></div>}
              {tab === 'form' && <Section title="Form ranking (points per game, last 5)" icon="chart"><div className="card"><TeamBars rows={vals(d.form, 'formPpg')} /></div></Section>}
              {tab === 'home' && <Section title="Home vs away points per game" icon="home"><div className="card"><GroupedBars aLabel="Home" bLabel="Away" rows={d.homeAway.map((r) => ({ team: r.team, a: r.homePpg, b: r.awayPpg }))} /></div>
                <p className="xs dim" style={{ marginTop: 8 }}>Sorted by the biggest home advantage.</p></Section>}
            </>);
        }}</Async>)}
    </div>
  );
}
