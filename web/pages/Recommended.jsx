import { useMemo, useRef, useState } from 'react';
import { A, Async, Crest, Empty, Note, Ring, Seg, SkelCards, Tag } from '../ui/base';
import { useApi, useApp } from '../lib/app';
import { fmtOdds, fmtTime, pct } from '../lib/format';
import { slipAdd, slipHas, slipRemove, useSlip } from '../lib/slip';

const NAME = { 1: 'Home win', 2: 'Away win', '1X': 'Home win or draw', X2: 'Draw or away win', 12: 'No draw', 'DNB 1': 'Home win (draw = stake back)', 'DNB 2': 'Away win (draw = stake back)', 'Over 0.5': 'Over 0.5 goals', 'Over 1.5': 'Over 1.5 goals', 'Under 3.5': 'Under 3.5 goals', 'Under 4.5': 'Under 4.5 goals' };
const dayRange = (offset) => { const a = new Date(); a.setHours(0, 0, 0, 0); a.setDate(a.getDate() + offset); const b = new Date(a); b.setDate(b.getDate() + 1); return [a.toISOString(), b.toISOString()]; };
const label = (x) => {
  const t = NAME[x.pick] || x.pick;
  return x.pick === '1' ? `${x.home} win` : x.pick === '2' ? `${x.away} win` : x.pick === '1X' ? `${x.home} or draw` : x.pick === 'X2' ? `Draw or ${x.away}` : t;
};

function Card({ x, onNext, onPrev, i, n }) {
  const slip = useSlip();
  const inSlip = slip.some((s) => s.id === x.matchId);
  const touch = useRef(null);
  const toggle = () => (inSlip ? slipRemove(x.matchId) : slipAdd({ id: x.matchId, h: x.home, a: x.away, l: label(x), p: x.p, k: x.date, lg: x.league }));
  return (
    <div className="card glow" style={{ textAlign: 'center', padding: 22, touchAction: 'pan-y' }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touch.current ?? 0); if (dx < -50) onNext(); else if (dx > 50) onPrev(); }}>
      <div className="xs muted">{x.league} · {fmtTime(x.date)}</div>
      <div className="row" style={{ justifyContent: 'center', gap: 16, margin: '14px 0' }}>
        <div><Crest team={{ name: x.home, crest: x.homeCrest }} size={46} /><div className="sm" style={{ marginTop: 4, maxWidth: 110 }}><b>{x.home}</b></div></div>
        <span className="muted">vs</span>
        <div><Crest team={{ name: x.away, crest: x.awayCrest }} size={46} /><div className="sm" style={{ marginTop: 4, maxWidth: 110 }}><b>{x.away}</b></div></div>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
        <Ring value={x.p} size={78} />
        <div style={{ textAlign: 'left' }}>
          <div className="xs muted">RECOMMENDED PICK</div>
          <b style={{ fontSize: 22, display: 'block', color: 'var(--g)' }}>{label(x)}</b>
          <div className="xs muted num">Fair odds {fmtOdds(x.odds)} · {x.confidence} confidence</div>
        </div>
      </div>
      <div className="row wrap" style={{ justifyContent: 'center', gap: 6, marginTop: 12 }}>
        {x.aiAgrees ? <Tag kind="ai">✦ Gemini agrees</Tag> : <Tag>Statistics only</Tag>}
        {x.history && <Tag>Similar picks so far: {Math.round(x.history.actual)}% won ({x.history.n})</Tag>}
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 16 }}>
        <button className="btn ghost" onClick={onPrev} disabled={i === 0} aria-label="Previous pick">←</button>
        <button className={inSlip ? 'btn ghost' : 'btn'} onClick={toggle}>{inSlip ? '✓ On your slip' : '+ Add to slip'}</button>
        <button className="btn ghost" onClick={onNext} disabled={i === n - 1} aria-label="Next pick">→</button>
      </div>
      <p className="xs dim" style={{ marginTop: 10 }}><A to={`/match/${x.matchId}`}>Full match details</A></p>
    </div>
  );
}

export default function Recommended() {
  const [day, setDay] = useState(0);
  const [i, setI] = useState(0);
  const [from, to] = useMemo(() => dayRange(day), [day]);
  const q = useApi(`/api/recommended?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { poll: 120000 });
  const slip = useSlip();
  return (
    <div className="stack" style={{ paddingTop: 8 }}>
      <div className="between"><div><h2>Recommended picks</h2><p className="muted sm">The surest picks for the day, one card at a time.</p></div>
        <A to="/slip" className="chip">Slip ({slip.length})</A></div>
      <Seg value={String(day)} onChange={(v) => { setDay(+v); setI(0); }} options={[['0', 'Today'], ['1', 'Tomorrow']]} />
      <Async q={q} skeleton={<SkelCards n={1} h={320} />}>{(r) => {
        const n = r.picks.length, k = Math.min(i, Math.max(0, n - 1));
        return (
          <>
            {n === 0
              ? <Empty icon="spark" title="No safe pick for this day">{r.considered} matches were checked. None passed the bar: a clear chance of {Math.round(r.minP * 100)}% or more, enough past games for both teams, and no disagreement with Gemini. Showing nothing is better than showing weak picks.</Empty>
              : <>
                <div className="row" style={{ justifyContent: 'center', gap: 5 }}>{r.picks.map((_, j) => <span key={j} onClick={() => setI(j)} style={{ width: j === k ? 22 : 8, height: 8, borderRadius: 4, background: j === k ? 'var(--g)' : 'rgba(255,255,255,.18)', cursor: 'pointer', transition: 'width .2s' }} />)}</div>
                <Card x={r.picks[k]} i={k} n={n} onNext={() => setI(Math.min(n - 1, k + 1))} onPrev={() => setI(Math.max(0, k - 1))} />
                <p className="xs muted" style={{ textAlign: 'center' }}>{k + 1} of {n} · swipe or use the arrows</p>
              </>}
            <Note info>Only matches that have not started are shown, from {r.considered} checked. Picks use simple markets where our chance is {Math.round(r.minP * 100)}% or more{r.overconfident ? ' (the bar was raised because our past percentages ran higher than our real results)' : ''}.{r.history.verified ? ` Our overall verified hit rate so far is ${Math.round(r.history.hitRate)}% over ${r.history.verified} picks.` : ''}</Note>
            <Note>A recommended pick is the model's safest option, not a sure thing. Safer picks pay lower odds, and some will still lose. Never stake more than you can afford to lose. 18+ only.</Note>
          </>);
      }}</Async>
    </div>
  );
}
