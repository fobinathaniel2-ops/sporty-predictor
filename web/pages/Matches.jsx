import { useState } from 'react';
import { A, Crest, Empty, ErrorState, Seg, SkelList } from '../ui/base';
import { FixtureBrowser, MatchList } from '../ui/match';
import { go, useApi, useApp } from '../lib/app';
import { dayKey, relDay } from '../lib/format';

function Live() {
  const { prefs } = useApp();
  const q = useApi('/api/live', { poll: prefs.dataSaver ? 60000 : 30000 });
  if (q.loading && !q.data) return <SkelList n={3} />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  return q.data.length ? <><p className="xs dim" style={{ marginBottom: 10 }}>Scores refresh every {prefs.dataSaver ? 60 : 30} seconds while this page is open.</p><MatchList matches={q.data} /></> :
    <Empty icon="live" title="No live matches right now">Matches appear here from kick-off until full time. <A to="/fixtures" className="g">See today's fixtures</A></Empty>;
}

function Results() {
  const { status } = useApp();
  const q = useApi('/api/results?limit=100');
  const [league, setLeague] = useState('');
  if (q.loading && !q.data) return <SkelList n={5} />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  const list = q.data.filter((m) => !league || m.league.code === league);
  const days = [...new Map(list.map((m) => [dayKey(new Date(m.date)), m.date])).entries()];
  return (
    <div>
      <div className="chips">
        <button className={`chip ${league === '' ? 'on' : ''}`} onClick={() => setLeague('')}>All competitions</button>
        {(status?.leagues || []).map((l) => <button key={l.code} className={`chip ${league === l.code ? 'on' : ''}`} onClick={() => setLeague(l.code)}><Crest team={{ name: l.name, crest: l.emblem }} size={18} />{l.name}</button>)}
      </div>
      {!list.length ? <Empty icon="results" title="No results yet">Finished matches will show here.</Empty> : days.map(([k, iso]) => (
        <div key={k}><div className="sec" style={{ margin: '18px 0 8px' }}><h3 className="muted">{relDay(iso)}</h3></div><MatchList matches={list.filter((m) => dayKey(new Date(m.date)) === k)} grouped={!league} /></div>
      ))}
    </div>
  );
}

const TITLES = { live: 'Live matches', fixtures: 'Fixtures', results: 'Results' };

export default function Matches({ mode }) {
  return (
    <div>
      <div className="between" style={{ margin: '8px 0 14px', flexWrap: 'wrap' }}>
        <h1>{TITLES[mode]}</h1>
        <Seg value={mode} onChange={(v) => go(`/${v}`)} options={[['live', 'Live'], ['fixtures', 'Fixtures'], ['results', 'Results']]} />
      </div>
      {mode === 'live' ? <Live /> : mode === 'results' ? <Results /> : <FixtureBrowser />}
    </div>
  );
}
