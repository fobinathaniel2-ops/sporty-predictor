import { Async, Empty, Note, SkelCards, Tag } from '../ui/base';
import { useApi } from '../lib/app';
import { fmtDate } from '../lib/format';

const acc = (x) => (x == null ? '–' : `${Math.round(x)}%`);
const MIN = 20; // below this many picks a percentage says very little

function Rows({ rows, title, hint }) {
  if (!rows?.length) return null;
  return (
    <div className="card">
      <h4 className="muted" style={{ marginBottom: 4 }}>{title}</h4>
      {hint && <p className="xs muted" style={{ marginBottom: 8 }}>{hint}</p>}
      {rows.map((r) => (
        <div key={r.key} className="between" style={{ padding: '7px 0', borderTop: '1px solid var(--line)' }}>
          <span className="sm"><b>{r.key}</b> <span className="muted xs">{r.correct}/{r.total}{r.total < MIN ? ' · small sample' : ''}</span></span>
          <b className="num" style={{ opacity: r.total < MIN ? 0.6 : 1 }}>{acc(r.accuracy)}</b>
        </div>))}
    </div>
  );
}

export default function Scoreboard() {
  const q = useApi('/api/accuracy', { poll: 120000 });
  return (
    <div className="stack" style={{ paddingTop: 8 }}>
      <div><h2>Scoreboard</h2><p className="muted sm">Every pick is saved before kick-off and never edited. Wrong picks are listed with the right ones. Nothing here is a promise about the next match.</p></div>
      <Async q={q} skeleton={<SkelCards n={2} h={110} />}>{(a) => {
        if (!a.best.total) return <Empty icon="chart" title="No verified results yet">{a.pending ? `${a.pending} picks are waiting for their matches to finish.` : 'Picks appear here once their matches have finished.'}</Empty>;
        const lowSample = a.best.total < 30;
        return (
          <>
            <div className="grid g3">
              <div className="tile"><div className="v">{acc(a.best.accuracy)}</div><div className="l">Hit rate ({a.best.correct} of {a.best.total})</div></div>
              <div className="tile"><div className="v">{acc(a.alwaysHomeAccuracy)}</div><div className="l">"Always pick the home team" baseline</div></div>
              <div className="tile"><div className="v">{a.pending}</div><div className="l">Waiting for results</div></div>
            </div>
            {lowSample && <Note>Only {a.best.total} verified picks so far. That is too few to tell skill from luck, so read these as early signs.</Note>}
            <Note info><b>Confidence labels:</b> High means our chance for the pick is 78% or more, Medium 62-78%, Low below 62% (or when a team has played fewer than 5 matches in our data). The label says how likely the pick is, not that it will win. High picks lose too.</Note>
            <Rows rows={a.byConfidence} title="HIT RATE BY CONFIDENCE" hint="A good model hits more often at High than at Low." />
            <Rows rows={a.byLeague} title="HIT RATE BY LEAGUE" />
            <Rows rows={a.byOdds} title="HIT RATE BY FAIR ODDS" hint="Fair odds are 1 divided by our probability, not bookmaker odds. Longer odds win less often." />
            {a.calibration?.length > 0 && (
              <div className="card">
                <h4 className="muted" style={{ marginBottom: 4 }}>DO THE PERCENTAGES HOLD UP?</h4>
                <p className="xs muted" style={{ marginBottom: 8 }}>Picks rated near 70% should win about 70% of the time.</p>
                {a.calibration.map((c, i) => <div key={i} className="between sm" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}><span>Rated {c.range} <span className="muted xs">{c.n} picks · expected {acc(c.predicted)}</span></span><b className="num">won {acc(c.actual)}</b></div>)}
              </div>)}
            <div className="card">
              <h4 className="muted" style={{ marginBottom: 8 }}>LATEST 20 PICKS</h4>
              {a.recent.map((r) => (
                <a key={r.id} href={`#/match/${r.id}`} className="between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)', gap: 8 }}>
                  <span className="sm grow"><b>{r.home} v {r.away}</b><br /><span className="xs muted">{fmtDate(r.date)} · {r.best?.label} · {r.ft ? `${r.ft[0]}-${r.ft[1]}` : ''}</span></span>
                  {r.best?.correct === true ? <Tag kind="ok">✓ Right</Tag> : r.best?.correct === false ? <Tag kind="bad">✗ Wrong</Tag> : <Tag>Not checked</Tag>}
                </a>))}
            </div>
          </>);
      }}</Async>
    </div>
  );
}
