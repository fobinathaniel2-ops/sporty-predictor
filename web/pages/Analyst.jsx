import { useState } from 'react';
import Icon from '../ui/Icon';
import { Async, Crest, Empty, Note, Ring, Section, Seg, Skel, SkelCards, SkelList, Tag } from '../ui/base';
import { Columns } from '../ui/charts';
import { FixtureBrowser } from '../ui/match';
import { useApi, useApp } from '../lib/app';
import { GROUPS, pct } from '../lib/format';

const acc = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

function Rows({ rows, title }) {
  if (!rows?.length) return null;
  return (
    <div className="card">
      <h4 className="muted" style={{ marginBottom: 8 }}>{title}</h4>
      {rows.map((r) => (
        <div key={r.key} className="hbar" style={{ gridTemplateColumns: '1fr 90px 64px', cursor: 'default' }}>
          <span className="n"><span className="ell">{r.key}</span></span>
          <div className="track"><div className="fill top" style={{ width: `${Math.max(3, (r.accuracy || 0) * 100)}%` }} /></div>
          <span className="vv">{acc(r.accuracy)} <span className="xs dim">{r.correct}/{r.total}</span></span>
        </div>
      ))}
    </div>
  );
}

function Record() {
  const q = useApi('/api/accuracy', { poll: 120000 });
  const [per, setPer] = useState('weekly');
  return (
    <Async q={q} skeleton={<SkelCards n={2} h={110} />}>{(a) => {
      if (!a.best.total) return (
        <Empty icon="chart" title="No verified results yet">
          {a.pending ? `${a.pending} picks are waiting for their matches to finish. ` : ''}Accuracy is only counted from picks that were saved before kick-off and then checked against the real result, so this stays empty until that happens.
        </Empty>);
      const lift = a.best.accuracy != null && a.alwaysHomeAccuracy != null ? a.best.accuracy - a.alwaysHomeAccuracy : null;
      return (
        <div className="stack">
          <div className="grid g4">
            <div className="tile"><div className="v">{acc(a.best.accuracy)}</div><div className="l">Pick accuracy ({a.best.correct}/{a.best.total})</div></div>
            <div className="tile"><div className="v">{a.ai.total ? acc(a.ai.accuracy) : '–'}</div><div className="l">Gemini picks ({a.ai.total})</div></div>
            <div className="tile"><div className="v">{a.stats.total ? acc(a.stats.accuracy) : '–'}</div><div className="l">Stats-only picks ({a.stats.total})</div></div>
            <div className="tile"><div className="v">{acc(a.alwaysHomeAccuracy)}</div><div className="l">"Always home win" baseline</div></div>
          </div>
          {a.ai.total > 0 && a.statsOnAiMatches.total > 0 && <Note info>On the same {a.statsOnAiMatches.total} matches, the plain statistics pick would have scored {acc(a.statsOnAiMatches.accuracy)} against Gemini's {acc(a.ai.accuracy)}.</Note>}
          {a.best.total < 30 && <Note>Only {a.best.total} verified picks so far, which is too few to tell skill from luck. Treat these numbers as early signs, not a result.</Note>}
          {(a.livePicks.total > 0 || a.webPicks.total > 0) && <div className="grid g2">
            {a.livePicks.total > 0 && <div className="tile"><div className="v">{acc(a.livePicks.accuracy)}</div><div className="l">In-play picks ({a.livePicks.correct}/{a.livePicks.total}) · made after kick-off, counted separately</div></div>}
            {a.webPicks.total > 0 && <div className="tile"><div className="v">{acc(a.webPicks.accuracy)}</div><div className="l">Web-found matches ({a.webPicks.correct}/{a.webPicks.total}) · scores found by web search, counted separately</div></div>}
          </div>}
          <div className="card">
            <div className="between" style={{ marginBottom: 10 }}><h4 className="muted">ACCURACY OVER TIME</h4><Seg value={per} onChange={setPer} options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]} /></div>
            <Columns rows={a.series[per]} />
          </div>
          {a.calibration.length > 0 && (
            <div className="card">
              <h4 className="muted" style={{ marginBottom: 4 }}>DO THE PERCENTAGES HOLD UP?</h4>
              <p className="muted sm" style={{ marginBottom: 10 }}>If the model is honest, picks it rates around 70% should win about 70% of the time.</p>
              <table className="tbl"><thead><tr><th>Rated</th><th>Picks</th><th>Said</th><th>Actually won</th></tr></thead>
                <tbody>{a.calibration.map((b) => <tr key={b.range}><td>{b.range}</td><td>{b.n}</td><td>{acc(b.predicted)}</td><td className="pts">{acc(b.actual)}</td></tr>)}</tbody></table>
            </div>)}
          <div className="grid g2"><Rows title="BY CONFIDENCE" rows={a.byConfidence} /><Rows title="BY MARKET" rows={a.byMarket} /><Rows title="BY COMPETITION" rows={a.byLeague} /><Rows title="BY PICK" rows={a.byPick} /></div>
          <p className="xs dim">{a.matchesVerified} matches verified · {a.pending} pending · {a.unverified} could not be verified and are left out{a.includesDemo ? ' · includes simulated demo matches' : ''}.</p>
        </div>);
    }}</Async>
  );
}

function HowItWorks() {
  const { status } = useApp();
  const steps = [
    ['Data', 'Real fixtures and results are loaded from football-data.org.'],
    ['Statistics', 'Attack, defence, form, head-to-head and Elo ratings are worked out for each team.'],
    ['Probabilities', 'A Poisson goal model turns them into a chance for every market, including early payout (1UP / 2UP).'],
    ['Gemini', status?.ai?.enabled ? 'Gemini searches the web for team news, then chooses one pick from the best-rated options. It cannot invent a pick.' : 'Add a Gemini key and it will search the web for team news and choose one pick from the best-rated options.'],
    ['Web finds', status?.ai?.enabled ? 'Gemini also searches the web for top-league and cup matches missing from the data feed, and picks for them. Those percentages are its own estimates, so they are marked WEB.' : 'With a Gemini key it also searches the web for extra top-league and cup matches and picks for them.'],
    ['Live', 'Matches in play get a pick that uses the current score and the minutes left. These are marked LIVE PICK and counted separately.'],
    ['Locked & checked', 'A pick is saved before kick-off and cannot change. After full time it is marked right or wrong from the real result.'],
  ];
  return (
    <div className="card">
      <div className="grid g3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        {steps.map(([t, d], i) => <div key={t}><div className="g num" style={{ fontWeight: 800 }}>0{i + 1}</div><b>{t}</b><p className="muted sm" style={{ marginTop: 2 }}>{d}</p></div>)}
      </div>
    </div>
  );
}

export default function Analyst() {
  const { status } = useApp();
  const q = useApi('/api/analyst', { poll: 120000 });
  const [group, setGroup] = useState('All');
  const [conf, setConf] = useState('All');
  const [view, setView] = useState('picks');
  const ai = status?.ai;
  return (
    <div>
      <div className="card glow" style={{ padding: '20px 18px', marginTop: 6 }}>
        <div className="row" style={{ gap: 12 }}><Ring value={0.5} size={52} color="var(--violet)" label={<Icon name="spark" size={20} />} />
          <div><h1>AI Analyst</h1><p className="muted sm">Explains every number. Uses real match data only.</p></div></div>
        <div className="row wrap" style={{ marginTop: 14, gap: 6 }}>
          <Tag kind={status?.configured ? 'ok' : 'bad'}>{status?.configured ? 'Football data connected' : 'No football data key'}</Tag>
          <Tag kind={ai?.enabled ? 'ai' : ''}>{ai?.enabled ? `✦ Gemini on${ai.model ? ` · ${ai.model}` : ''}` : 'Gemini off · stats picks only'}</Tag>
          {status?.demo && <Tag kind="demo">DEMO DATA</Tag>}
        </div>
      </div>
      <div style={{ margin: '16px 0' }}><Seg value={view} onChange={setView} options={[['picks', 'Upcoming picks'], ['record', 'Track record'], ['how', 'How it works']]} /></div>
      {view === 'how' && <><HowItWorks /><div style={{ marginTop: 14 }}><Note>Nothing here is a guarantee. Football is unpredictable, and a pick rated 75% still loses about one time in four. Please gamble responsibly.</Note></div></>}
      {view === 'record' && <Record />}
      {view === 'picks' && (
        <FixtureBrowser sortable filterCount={(group !== 'All' ? 1 : 0) + (conf !== 'All' ? 1 : 0)} filterSummary={[group !== 'All' && group, conf !== 'All' && `${conf} confidence`].filter(Boolean).join(' · ')}
          filter={(m) => m.prediction && (group === 'All' || m.prediction.best?.market === group) && (conf === 'All' || m.prediction.confidence === conf)}
          emptyText="No picks match these filters."
          extra={<>
            <div className="chips" style={{ marginTop: 4 }}>{GROUPS.map((g) => <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g === 'All' ? 'All markets' : g}</button>)}</div>
            <div className="chips" style={{ marginTop: 8 }}>{['All', 'High', 'Medium', 'Low'].map((c) => <button key={c} className={`chip ${conf === c ? 'on' : ''}`} onClick={() => setConf(c)}>{c === 'All' ? 'Any confidence' : `${c} confidence`}</button>)}</div>
          </>} />)}
    </div>
  );
}
