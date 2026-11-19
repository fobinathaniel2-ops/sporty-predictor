import { Async, Note, SkelCards, Tag } from '../ui/base';
import { useApi } from '../lib/app';

const KIND = { ok: 'ok', warn: 'Medium', bad: 'bad' };
const LABEL = { ok: 'Working', warn: 'Needs a look', bad: 'Problem' };

export default function Health() {
  const q = useApi('/api/health', { poll: 30000 });
  return (
    <div className="stack" style={{ paddingTop: 8 }}>
      <div><h2>Health</h2><p className="muted sm">Is every part of Predictx working? Refreshes every 30 seconds.</p></div>
      <Async q={q} skeleton={<SkelCards n={3} h={70} />}>{(h) => (
        <>
          <div className="card between"><div><b>{h.overall === 'ok' ? 'All systems working' : h.overall === 'warn' ? 'Working, with something to check' : 'Something is broken'}</b><div className="xs muted">Version {h.version} · checked {new Date(h.at).toLocaleTimeString()}</div></div><Tag kind={KIND[h.overall]}>{LABEL[h.overall]}</Tag></div>
          {h.checks.map((c) => (
            <div className="card" key={c.key}>
              <div className="between"><b>{c.name}</b><Tag kind={KIND[c.level]}>{LABEL[c.level]}</Tag></div>
              <p className="sm muted" style={{ marginTop: 6 }}>{c.detail}</p>
              {c.quota && c.quota.cap > 0 && <div style={{ marginTop: 8, height: 6, borderRadius: 4, background: 'rgba(255,255,255,.08)' }}><div style={{ width: `${Math.min(100, ((c.quota.used || 0) / c.quota.cap) * 100)}%`, height: 6, borderRadius: 4, background: 'var(--g)' }} /></div>}
            </div>))}
          <div className="grid g4">{Object.entries(h.counts).map(([k, v]) => <div className="tile" key={k}><div className="v">{v}</div><div className="l">{k}</div></div>)}</div>
          <div className="card"><h4 className="muted" style={{ marginBottom: 6 }}>RECENT ERRORS</h4>
            {h.errors.length ? h.errors.map((e, i) => <p key={i} className="xs" style={{ padding: '4px 0' }}><span className="muted">{new Date(e.at).toLocaleString()} · {e.source}</span><br />{e.message}</p>) : <p className="sm muted">No recent errors.</p>}
          </div>
          <Note info>Keys and secrets are never shown on this page.</Note>
        </>)}
      </Async>
    </div>
  );
}
