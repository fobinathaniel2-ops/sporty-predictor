import { useState } from 'react';
import Icon from '../ui/Icon';
import { A, Async, Crest, Empty, Note, Ring, Section, Seg, Skel, SkelCards, SkelList, Tag } from '../ui/base';
import { Columns } from '../ui/charts';
import { FixtureBrowser, MatchList } from '../ui/match';
import { useApi, useApp } from '../lib/app';
import { GROUPS, pct } from '../lib/format';
import { dayKey, relDay } from '../lib/format';

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
          {a.highOdds?.total > 0 && <div className="tile"><div className="v">{acc(a.highOdds.accuracy)}</div><div className="l">High-odds picks ({a.highOdds.correct}/{a.highOdds.total}) · average fair odds {a.highOdds.avgFairOdds}. Higher odds win less often; fair odds are the model's own estimate, not bookmaker odds.</div></div>}
          {a.ai.total > 0 && a.statsOnAiMatches.total > 0 && <Note info>On the same {a.statsOnAiMatches.total} matches, the plain statistics pick would have scored {acc(a.statsOnAiMatches.accuracy)} against Gemini's {acc(a.ai.accuracy)}.</Note>}
          {a.best.total < 30 && <Note>Only {a.best.total} verified picks so far, which is too few to tell skill from luck. Treat these numbers as early signs, not a result.</Note>}
          {(a.livePicks.total > 0 || a.webPicks.total > 0 || a.esportsPicks?.total > 0) && <div className="grid g2">
            {a.livePicks.total > 0 && <div className="tile"><div className="v">{acc(a.livePicks.accuracy)}</div><div className="l">In-play picks ({a.livePicks.correct}/{a.livePicks.total}) · made after kick-off, counted separately</div></div>}
            {a.esportsPicks?.total > 0 && <div className="tile"><div className="v">{acc(a.esportsPicks.accuracy)}</div><div className="l">eFootball esports ({a.esportsPicks.correct}/{a.esportsPicks.total}) · estimated from gamers' form, counted separately</div></div>}
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
    ['Gemini', status?.ai?.enabled ? 'Gemini makes the predictions: it searches the web for team news, reads our statistics, then chooses a main pick (best chance) and a high-odds pick from our list. It cannot invent a pick. If Gemini is unavailable, the statistics pick is used. Odds shown are fair odds (1 ÷ probability), not bookmaker odds.' : 'Add a Gemini key and it will search the web for team news and choose one pick from the best-rated options.'],
    ['eFootball', 'Gemini searches the EsportsBattle schedules (and other eFootball competitions), estimates each pick from the two gamers\' recent form, and later looks up the score to check it. Esports results are very random, they are counted separately, and the percentages are Gemini\'s own estimates.'],
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


function Finished() {
  const { status } = useApp();
  const q = useApi('/api/results?picks=1&limit=300', { poll: 120000 });
  const [league, setLeague] = useState('');
  const [res, setRes] = useState('all');
  const [group, setGroup] = useState('All');
  return (
    <Async q={q} skeleton={<SkelList n={5} />}>{(all) => {
      const list = all.filter((m) => m.prediction && (!league || m.league.code === league) && (group === 'All' || m.prediction.best?.market === group)
        && (res === 'all' || (res === 'won' && m.prediction.best?.correct === true) || (res === 'lost' && m.prediction.best?.correct === false) || (res === 'void' && m.prediction.settled && typeof m.prediction.best?.correct !== 'boolean')));
      const won = list.filter((m) => m.prediction.best?.correct === true).length, lost = list.filter((m) => m.prediction.best?.correct === false).length;
      const days = [...new Map(list.map((m) => [dayKey(new Date(m.date)), m.date])).entries()];
      return (
        <div>
          <div className="chips">
            <button className={`chip ${league === '' ? 'on' : ''}`} onClick={() => setLeague('')}>All competitions</button>
            {(status?.competitions || status?.leagues || []).map((l) => <button key={l.code} className={`chip ${league === l.code ? 'on' : ''}`} onClick={() => setLeague(l.code)}><Crest team={{ name: l.name, crest: l.emblem }} size={18} />{l.name}</button>)}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>{GROUPS.map((g) => <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g === 'All' ? 'All markets' : g}</button>)}</div>
          <div className="between" style={{ margin: '12px 0', flexWrap: 'wrap', gap: 8 }}>
            <Seg value={res} onChange={setRes} options={[['all', 'All'], ['won', 'Won'], ['lost', 'Lost']]} />
            <span className="sm muted"><b className="g">{won} won</b> · <b style={{ color: 'var(--red)' }}>{lost} lost</b>{won + lost ? ` · ${Math.round((won / (won + lost)) * 100)}%` : ''} · {list.length} matches</span>
          </div>
          {!list.length ? <Empty icon="results" title="No finished picks here yet">A pick appears here after its match ends and the result has been checked. <A to="/ai" className="g">See upcoming picks</A></Empty> : days.map(([k, iso]) => (
            <div key={k}><div className="sec" style={{ margin: '14px 0 8px' }}><h3 className="muted">{relDay(iso)}</h3></div><MatchList matches={list.filter((m) => dayKey(new Date(m.date)) === k)} grouped={!league} /></div>
          ))}
          <p className="xs dim" style={{ marginTop: 12 }}>Every pick was saved before kick-off, except picks marked LIVE PICK or WEB, which are counted separately in Track record.</p>
        </div>);
    }}</Async>
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
      <div style={{ margin: '16px 0' }}><Seg value={view} onChange={setView} options={[['picks', 'Picks'], ['finished', 'Finished picks'], ['record', 'Track record'], ['how', 'How it works']]} /></div>
      {view === 'how' && <><HowItWorks /><div style={{ marginTop: 14 }}><Note>Nothing here is a guarantee. Football is unpredictable, and a pick rated 75% still loses about one time in four. Please gamble responsibly.</Note></div></>}
      {view === 'record' && <Record />}
      {view === 'finished' && <Finished />}
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
