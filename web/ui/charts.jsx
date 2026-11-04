import { Crest, A } from './base';
import { pct } from '../lib/format';

/** Home / Draw / Away probability bars. */
export function ProbBars({ home, away, probs }) {
  const rows = [[home, probs.home, 'h'], ['Draw', probs.draw, 'draw'], [away, probs.away, 'a']];
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div>
      {rows.map(([n, v, k]) => (
        <div className="pbar" key={k}>
          <span className="ell">{n}</span>
          <div className="track"><div className={`fill ${v === max ? 'top' : k === 'draw' ? 'draw' : ''}`} style={{ width: `${(v * 100).toFixed(1)}%` }} /></div>
          <span className="num" style={{ textAlign: 'right' }}>{pct(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** Split bar comparing two values (possession, shots...). */
export function DualStat({ label, home, away, suffix = '', total }) {
  const h = Number(home) || 0, a = Number(away) || 0;
  const t = (total ?? (h + a)) || 1;
  return (
    <div className="srow">
      <div className="lab">{label}</div>
      <div className="v"><span>{home ?? '–'}{suffix}</span>
        <div className="dual"><i style={{ width: `${(h / t) * 100}%`, background: h >= a ? 'var(--g)' : 'var(--blue)' }} /><i style={{ width: `${(a / t) * 100}%`, background: a > h ? 'var(--g)' : 'var(--blue)' }} /></div>
        <span>{away ?? '–'}{suffix}</span></div>
    </div>
  );
}

/** Ranked horizontal bars of teams. rows: [{team, value}] */
export function TeamBars({ rows, unit = '', digits = 2, invert = false }) {
  if (!rows?.length) return <p className="muted sm">Not enough finished matches yet.</p>;
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div>
      {rows.map((r, i) => (
        <A key={r.team.id} to={`/team/${r.team.id}`} className="hbar">
          <span className="rk">{i + 1}</span>
          <span className="n"><Crest team={r.team} size={22} /><span className="ell">{r.team.name}</span></span>
          <div className="track"><div className={`fill ${i === 0 ? 'top' : ''}`} style={{ width: `${Math.max(4, ((invert ? max - r.value + 0.05 * max : r.value) / max) * 100)}%` }} /></div>
          <span className="vv">{Number.isInteger(r.value) ? r.value : r.value.toFixed(digits)}{unit}</span>
        </A>
      ))}
    </div>
  );
}

/** Home vs away grouped bars per team. rows: [{team, a, b}] */
export function GroupedBars({ rows, aLabel, bLabel }) {
  if (!rows?.length) return <p className="muted sm">Not enough data yet.</p>;
  const max = Math.max(...rows.flatMap((r) => [r.a || 0, r.b || 0]), 0.0001);
  return (
    <div>
      <div className="row xs muted" style={{ gap: 14, marginBottom: 6 }}><span><i className="dot on" /> {aLabel}</span><span><i className="dot" style={{ background: 'var(--blue)' }} /> {bLabel}</span></div>
      {rows.map((r) => (
        <A key={r.team.id} to={`/team/${r.team.id}`} style={{ display: 'block', padding: '8px 0' }}>
          <div className="row sm" style={{ marginBottom: 5, fontWeight: 700 }}><Crest team={r.team} size={20} /><span className="ell grow">{r.team.name}</span><span className="num muted">{r.a ?? '–'} / {r.b ?? '–'}</span></div>
          <div className="track" style={{ height: 6, marginBottom: 3 }}><div className="fill top" style={{ width: `${((r.a || 0) / max) * 100}%` }} /></div>
          <div className="track" style={{ height: 6 }}><div className="fill" style={{ width: `${((r.b || 0) / max) * 100}%` }} /></div>
        </A>
      ))}
    </div>
  );
}

/** Side-by-side numeric comparison rows. rows: [{label, a, b, lowerBetter, suffix}] */
export function CompareRows({ rows }) {
  return (
    <div>
      {rows.map((r) => {
        const better = r.a == null || r.b == null || r.a === r.b ? 0 : (r.a > r.b) !== !!r.lowerBetter ? 1 : 2;
        return (
          <div className="cmp" key={r.label}>
            <span className={`a num ${better === 1 ? 'win' : ''}`}>{r.a ?? '–'}{r.a != null ? r.suffix || '' : ''}</span>
            <span className="lab">{r.label}</span>
            <span className={`b num ${better === 2 ? 'win' : ''}`}>{r.b ?? '–'}{r.b != null ? r.suffix || '' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical mini bar chart (e.g. accuracy over time). rows: [{key, accuracy, total}] */
export function Columns({ rows, height = 110 }) {
  if (!rows?.length) return null;
  return (
    <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: height + 34, overflowX: 'auto' }}>
      {rows.map((r) => (
        <div key={r.key} style={{ flex: '1 0 26px', textAlign: 'center' }}>
          <div className="xs num muted" style={{ marginBottom: 3 }}>{Math.round((r.accuracy || 0) * 100)}</div>
          <div style={{ height: Math.max(4, (r.accuracy || 0) * height), borderRadius: 7, background: 'linear-gradient(180deg,var(--g),var(--g2))', opacity: 0.4 + Math.min(1, r.total / 12) * 0.6 }} title={`${r.correct}/${r.total}`} />
          <div className="xs dim" style={{ marginTop: 4 }}>{r.key.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}
