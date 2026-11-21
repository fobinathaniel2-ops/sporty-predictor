import { useMemo } from 'react';
import { A, Empty, Note } from '../ui/base';
import { fmtOdds, fmtTime, fmtDate, pct } from '../lib/format';
import { useApp, useRoute } from '../lib/app';
import { combined, decodeSlip, encodeSlip, slipAdd, slipClear, slipRemove, useSlip } from '../lib/slip';

export default function Slip() {
  const { flash } = useApp();
  const { query } = useRoute();
  const mine = useSlip();
  const shared = useMemo(() => (query.s ? decodeSlip(query.s) : null), [query.s]);
  const list = shared || mine;
  const c = combined(list);
  const text = () => `Predictx slip\n${list.map((x, i) => `${i + 1}. ${x.h} v ${x.a} (${fmtDate(x.k)} ${fmtTime(x.k)}): ${x.l} [${pct(x.p)}]`).join('\n')}\nCombined chance about ${pct(c, 1)} (fair odds ${fmtOdds(1 / c)}). Estimates only, never guaranteed. 18+`;
  const copy = async (t, msg) => { try { await navigator.clipboard.writeText(t); flash(msg); } catch (e) { flash('Could not copy'); } };
  const link = () => `${location.origin}${location.pathname}#/slip?s=${encodeSlip(list)}`;
  const share = async () => {
    const url = link();
    try { if (navigator.share) { await navigator.share({ title: 'Predictx slip', text: text(), url }); return; } } catch (e) { return; }
    copy(url, 'Link copied');
  };
  return (
    <div className="stack" style={{ paddingTop: 8 }}>
      <div><h2>{shared ? 'Shared slip' : 'My slip'}</h2><p className="muted sm">{shared ? 'A slip someone shared with you.' : 'Picks you added from Recommended picks.'}</p></div>
      {!list.length ? <Empty icon="spark" title="Your slip is empty">Add picks from <A to="/recommended">Recommended picks</A>.</Empty> : (
        <>
          <div className="card">
            {list.map((x) => (
              <div key={x.id} className="between" style={{ padding: '9px 0', borderTop: '1px solid var(--line)', gap: 8 }}>
                <div className="grow"><b className="sm">{x.h} v {x.a}</b><div className="xs muted">{x.lg} · {fmtDate(x.k)} {fmtTime(x.k)}</div><div className="sm g"><b>{x.l}</b> <span className="muted num xs">{pct(x.p)} · fair {fmtOdds(1 / x.p)}</span></div></div>
                {!shared && <button className="iconbtn" onClick={() => slipRemove(x.id)} aria-label="Remove">✕</button>}
              </div>))}
          </div>
          <div className="grid g2">
            <div className="tile"><div className="v">{pct(c, 1)}</div><div className="l">Chance all {list.length} win</div></div>
            <div className="tile"><div className="v num">{fmtOdds(1 / c)}</div><div className="l">Combined fair odds (not a bookmaker price)</div></div>
          </div>
          {list.length > 1 && <Note>Every extra pick lowers the chance that the whole slip wins. {list.length} picks at 75% each give about {pct(Math.pow(0.75, list.length))} together. Fewer picks is safer.</Note>}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => copy(text(), 'Slip copied')}>Copy as text</button>
            <button className="btn ghost" onClick={share}>Share link</button>
            {shared ? <button className="btn ghost" onClick={() => { list.forEach(slipAdd); flash('Added to your slip'); location.hash = '/slip'; }}>Add to my slip</button> : <button className="btn ghost" onClick={slipClear}>Clear</button>}
          </div>
          <Note info>This is a Predictx slip, not a bookmaker booking code. Booking codes can only be made inside the bookmaker's own app, so enter these picks there yourself.</Note>
          <Note>Picks are estimates and never guaranteed. Only stake what you can afford to lose. 18+ only.</Note>
        </>)}
    </div>
  );
}
