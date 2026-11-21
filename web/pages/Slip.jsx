import { useMemo, useState } from 'react';
import { A, Async, Empty, Note, Seg, SkelCards } from '../ui/base';
import { fmtOdds, fmtTime, fmtDate, pct } from '../lib/format';
import { useApi, useApp, useRoute } from '../lib/app';
import { combined, decodeSlip, encodeSlip } from '../lib/slip';

const dayRange = (offset) => { const a = new Date(); a.setHours(0, 0, 0, 0); a.setDate(a.getDate() + offset); const b = new Date(a); b.setDate(b.getDate() + 1); return [a.toISOString(), b.toISOString()]; };
const sideLabel = (x) => (x.pick === '1' ? `${x.home} win` : x.pick === '2' ? `${x.away} win` : x.pick === '1X' ? `${x.home} or draw` : x.pick === 'X2' ? `Draw or ${x.away}` : x.pick === '12' ? 'No draw' : x.pick.replace('DNB 1', `${x.home} win (draw = stake back)`).replace('DNB 2', `${x.away} win (draw = stake back)`));

function View({ list, title, sub, flash }) {
  const c = combined(list);
  const text = () => `Predictx slip\n${list.map((x, i) => `${i + 1}. ${x.h} v ${x.a} (${fmtDate(x.k)} ${fmtTime(x.k)}): ${x.l} [${pct(x.p)}]`).join('\n')}\nAll win: about ${pct(c, 1)} (fair odds ${fmtOdds(1 / c)}). Estimates only, never guaranteed. 18+`;
  const copy = async (t, msg) => { try { await navigator.clipboard.writeText(t); flash(msg); } catch (e) { flash('Could not copy'); } };
  const share = async () => {
    const url = `${location.origin}${location.pathname}#/slip?s=${encodeSlip(list)}`;
    try { if (navigator.share) { await navigator.share({ title: 'Predictx slip', text: text(), url }); return; } } catch (e) { return; }
    copy(url, 'Link copied');
  };
  return (
    <>
      <div><h2>{title}</h2><p className="muted sm">{sub}</p></div>
      {!list.length ? <Empty icon="spark" title="No slip for this day">Not enough strong picks passed the checks. See <A to="/recommended">Recommended picks</A> for why.</Empty> : (
        <>
          <div className="card">
            {list.map((x) => (
              <A key={x.id} to={`/match/${x.id}`} className="between" style={{ padding: '10px 0', borderTop: '1px solid var(--line)', gap: 8, display: 'flex' }}>
                <div className="grow"><b className="sm">{x.h} v {x.a}</b><div className="xs muted">{x.lg} · {fmtDate(x.k)} {fmtTime(x.k)}</div><div className="sm g"><b>{x.l}</b> <span className="muted num xs">{pct(x.p)} · fair {fmtOdds(1 / x.p)}</span></div></div>
              </A>))}
          </div>
          <div className="grid g2">
            <div className="tile"><div className="v">{pct(c, 1)}</div><div className="l">Chance all {list.length} win</div></div>
            <div className="tile"><div className="v num">{fmtOdds(1 / c)}</div><div className="l">Combined fair odds (not a bookmaker price)</div></div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => copy(text(), 'Slip copied')}>Copy as text</button>
            <button className="btn ghost" onClick={share}>Share link</button>
          </div>
          <Note info>This slip was chosen for you from the day's recommended picks, using at most 4 picks and stopping before the chance of all winning drops below 50%. It is not a bookmaker booking code: those can only be made inside the bookmaker's own app, so enter these picks there yourself.</Note>
          <Note>Even a slip like this loses roughly half the time. Picks are estimates and never guaranteed. Only stake what you can afford to lose. 18+ only.</Note>
        </>)}
    </>
  );
}

export default function Slip() {
  const { flash } = useApp();
  const { query } = useRoute();
  const [day, setDay] = useState(query.day === '1' ? 1 : 0);
  const shared = useMemo(() => (query.s ? decodeSlip(query.s) : null), [query.s]);
  const [from, to] = useMemo(() => dayRange(day), [day]);
  const q = useApi(shared ? null : `/api/recommended?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { poll: 120000 });
  return (
    <div className="stack" style={{ paddingTop: 8 }}>
      {shared ? <View list={shared} title="Shared slip" sub="A slip someone shared with you." flash={flash} /> : (
        <>
          <Seg value={String(day)} onChange={(v) => setDay(+v)} options={[['0', 'Today'], ['1', 'Tomorrow']]} />
          <Async q={q} skeleton={<SkelCards n={2} h={120} />}>{(r) => {
            const by = Object.fromEntries(r.picks.map((x) => [x.matchId, x]));
            const list = r.slip.ids.map((id) => by[id]).filter(Boolean).map((x) => ({ id: x.matchId, h: x.home, a: x.away, l: sideLabel(x), p: x.p, k: x.date, lg: x.league }));
            return <View list={list} title={day ? "Tomorrow's slip" : "Today's slip"} sub="Chosen for you from the safest picks of the day." flash={flash} />;
          }}</Async>
        </>)}
    </div>
  );
}
