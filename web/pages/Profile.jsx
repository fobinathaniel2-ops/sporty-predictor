import Icon from '../ui/Icon';
import { A, Crest, Empty, Note, Section, Seg, Switch } from '../ui/base';
import { useApp } from '../lib/app';

const START = [['home', 'Dashboard'], ['fixtures', 'Fixtures'], ['live', 'Live'], ['ai', 'AI Analyst']];

function Row({ title, hint, children }) {
  return <div className="between" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)', gap: 12 }}><div style={{ minWidth: 0 }}><b>{title}</b>{hint && <div className="xs muted">{hint}</div>}</div>{children}</div>;
}

export default function Profile() {
  const { prefs, setPrefs, status, toggleFav, flash } = useApp();
  const leagues = (status?.leagues || []).filter((l) => prefs.favLeagues.includes(l.code));
  return (
    <div>
      <h1 style={{ margin: '8px 0 4px' }}>Profile &amp; settings</h1>
      <p className="muted" style={{ marginBottom: 6 }}>Saved for this device. No account or sign-in is needed.</p>

      <Section title="Favourites" icon="star">
        {!leagues.length && !prefs.favTeams.length ? <Empty icon="star" title="No favourites yet">Tap the star on a league or team and it appears on your dashboard. <A to="/leagues" className="g">Browse leagues</A></Empty> : (
          <div className="card">
            {leagues.map((l) => <div key={l.code} className="between" style={{ padding: '8px 0' }}><A to={`/league/${l.code}`} className="row"><Crest team={{ name: l.name, crest: l.emblem }} size={26} /><b>{l.name}</b></A><button className="iconbtn on" onClick={() => toggleFav('league', l.code)} aria-label={`Remove ${l.name}`}><Icon name="star" size={17} fill /></button></div>)}
            {prefs.favTeams.map((id) => <div key={id} className="between" style={{ padding: '8px 0' }}><A to={`/team/${id}`} className="row"><Icon name="shield" size={22} /><b>Team #{id}</b></A><button className="iconbtn on" onClick={() => toggleFav('team', id)} aria-label="Remove team"><Icon name="star" size={17} fill /></button></div>)}
          </div>)}
      </Section>

      <Section title="Settings" icon="gear">
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <Row title="Data saver" hint="Slower refresh, no animations. Good for mobile data and older phones."><Switch on={prefs.dataSaver} onChange={(v) => setPrefs({ dataSaver: v })} label="Data saver" /></Row>
          <Row title="Reduce motion" hint="Turns off shimmer and transitions."><Switch on={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} label="Reduce motion" /></Row>
          <Row title="Time format"><Seg value={prefs.timeFormat} onChange={(v) => setPrefs({ timeFormat: v })} options={[['24h', '24h'], ['12h', '12h']]} /></Row>
          <Row title="Opening page" hint="Where the app starts."><select className="field" style={{ width: 'auto' }} value={prefs.startPage} onChange={(e) => setPrefs({ startPage: e.target.value })} aria-label="Opening page">{START.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Row>
        </div>
      </Section>

      <Section title="About" icon="info">
        <div className="card">
          <p className="sm">Data: football-data.org · Picks: {status?.ai?.enabled ? `Gemini (${status.ai.model}) with a statistics fallback` : 'statistics model only'}.</p>
          {status?.lastRun && <p className="xs muted" style={{ marginTop: 6 }}>Last data update: {new Date(status.lastRun).toLocaleString()}</p>}
          <button className="chip" style={{ marginTop: 12 }} onClick={() => { try { localStorage.clear(); } catch (e) {} flash('Saved data on this device cleared'); setTimeout(() => location.reload(), 600); }}>Clear data saved on this device</button>
        </div>
        <div style={{ marginTop: 12 }}><Note>Predictions are estimates from past results and are never guaranteed. Only stake what you can afford to lose, and 18+ only. If gambling is a problem for you, free help is available from your local support service.</Note></div>
      </Section>
    </div>
  );
}
