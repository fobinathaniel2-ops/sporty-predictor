import { useState } from 'react';
import Icon from '../ui/Icon';
import { A, Async, Crest, Empty, FormDots, Note, Ring, Seg, Skel, SkelList, Tag } from '../ui/base';
import { CompareRows, DualStat, ProbBars } from '../ui/charts';
import { PickName } from '../ui/match';
import { setQuery, useApi, useApp } from '../lib/app';
import { countdown, fmtLong, isEarly, num, pct, statusText } from '../lib/format';

const TABS = [['summary', 'Summary'], ['timeline', 'Timeline'], ['stats', 'Stats'], ['lineups', 'Lineups'], ['h2h', 'H2H & Form'], ['ai', 'AI Analysis']];

function Header({ m, standings }) {
  const { prefs, isFav, toggleFav } = useApp();
  const live = m.status === 'LIVE', done = m.status === 'FINISHED';
  const sc = done ? m.ft : live ? m.live : null;
  return (
    <div className="mhead">
      <div className="between xs muted">
        <A to={`/league/${m.league.code}`} className="row"><Crest team={{ name: m.league.name, crest: m.league.emblem }} size={18} /><b>{m.league.name}</b>{m.league.demo && <Tag kind="demo">DEMO</Tag>}{m.matchday ? <span>· MD {m.matchday}</span> : m.stage ? <span>· {m.stage.replace(/_/g, ' ').toLowerCase()}</span> : null}</A>
        <span>{fmtLong(m.date, prefs)}</span>
      </div>
      <div className="teams">
        {[['home', m.home], ['away', m.away]].map(([side, t], i) => (
          <A key={side} to={`/team/${t.id}`} className="tm" style={{ order: i === 0 ? 0 : 2 }}>
            <Crest team={t} size={64} /><span>{t.name}</span>
            {standings?.[side] && <span className="xs muted">#{standings[side].position} · {standings[side].points} pts</span>}
          </A>
        ))}
        <div className="sc" style={{ order: 1 }}>
          {sc ? <span className="num">{sc[0]} – {sc[1]}</span> : <span style={{ fontSize: 30 }} className="muted">vs</span>}
          <small className={live ? 'red' : 'muted'}>{live ? <><span className="pulse" style={{ display: 'inline-block', marginRight: 6 }} />{statusText(m) || 'LIVE'}</> : done ? `Full time${m.ht ? ` · HT ${m.ht[0]}-${m.ht[1]}` : ''}` : m.status === 'OTHER' ? 'Not played / postponed' : countdown(m.date)}</small>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
        {m.venue && <span className="xs muted"><Icon name="pin" size={13} /> {m.venue}</span>}{m.referee && <span className="xs muted"><Icon name="whistle" size={13} /> {m.referee}</span>}
        <button className={`iconbtn ${isFav('team', m.home.id) ? 'on' : ''}`} style={{ width: 32, height: 32 }} onClick={() => toggleFav('team', m.home.id)} aria-label={`Favourite ${m.home.name}`}><Icon name="star" size={16} fill={isFav('team', m.home.id)} /></button>
        <button className={`iconbtn ${isFav('team', m.away.id) ? 'on' : ''}`} style={{ width: 32, height: 32 }} onClick={() => toggleFav('team', m.away.id)} aria-label={`Favourite ${m.away.name}`}><Icon name="star" size={16} fill={isFav('team', m.away.id)} /></button>
      </div>
    </div>
  );
}

function PickBanner({ p }) {
  const b = p.best, early = isEarly(b.id);
  return (
    <div className="card glow row" style={{ gap: 14, marginTop: 14 }}>
      <Ring value={b.p} size={70} color={early ? 'var(--violet)' : 'var(--g)'} />
      <div className="grow">
        <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>{p.kind === 'live' && <Tag kind="Low">LIVE PICK</Tag>}{p.kind === 'web' && <Tag>Found on the web</Tag>}{b.source === 'ai' ? <Tag kind="ai">✦ Gemini {b.estimated ? 'estimate' : 'pick'}</Tag> : <Tag>Stats pick</Tag>}<Tag kind={p.confidence}>{p.confidence} confidence</Tag>
          {p.settled && (b.correct === true ? <Tag kind="ok">✓ Correct</Tag> : b.correct === false ? <Tag kind="bad">✗ Wrong</Tag> : <Tag>Not verifiable</Tag>)}{p.locked && !p.settled && <Tag>Locked</Tag>}</div>
        <PickName best={b} size={20} />
        <p className="sm muted" style={{ marginTop: 6 }}>{b.about}</p>
        <p className="sm" style={{ marginTop: 6 }}>{b.reason}</p>
      </div>
    </div>
  );
}

function Markets({ groups, bestId }) {
  return (
    <div>
      {groups.filter((g) => g.items.length).map((g, i) => (
        <details className="acc" key={g.group} open={i === 0}>
          <summary><span>{g.group}</span><Icon name="right" size={18} className="dim" style={{ transition: 'transform .2s' }} /></summary>
          {g.items.map((it) => (
            <div className="mk" key={it.id}>
              <div className="grow"><b className={it.id === bestId ? 'g' : ''}>{it.id}</b>{it.id === bestId && <span className="xs g"> · pick</span>}<div className="xs muted">{it.about}</div></div>
              <span className="p">{pct(it.p)}</span>
            </div>))}
        </details>))}
    </div>
  );
}

function Summary({ d }) {
  const m = d.match, p = m.prediction;
  if (!p) return <div style={{ marginTop: 14 }}><Empty icon="spark" title="No prediction for this match">There is not enough data for this competition yet, or the match is outside the prediction window.</Empty></div>;
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>{p.kind === 'live' ? 'Result probabilities now' : 'Result probabilities'}</h3>
        {p.probs ? <ProbBars home={m.home.name} away={m.away.name} probs={p.probs} /> : <p className="muted sm">No result model for this match.</p>}
        {p.kind === 'live' && <p className="xs dim" style={{ margin: '8px 0 0' }}>Picked in play at {p.liveAt?.minute}' with the score {p.liveAt?.score?.[0]}-{p.liveAt?.score?.[1]}. Live picks are updated every few minutes and are not counted in the main accuracy figure.</p>}
        {p.kind === 'web' && <p className="xs dim" style={{ margin: '8px 0 0' }}>{p.webNote}</p>}
        {p.inplay && <div className="note info" style={{ marginTop: 10 }}>Live outlook at {p.inplay.minute}' ({p.inplay.score[0]}-{p.inplay.score[1]}): <b>{p.inplay.best.label}</b> · {pct(p.inplay.best.p)} <span className="xs">· {p.inplay.best.about}</span></div>}
        <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
          {p.xg?.home != null && <span className="tag">{p.kind === 'live' ? 'xG left' : 'xG'} {num(p.xg.home, 2)} – {num(p.xg.away, 2)}</span>}
          {p.topScores?.slice(0, 4).map((s) => <span className="tag" key={s.score}>{s.score} · {pct(s.p)}</span>)}
        </div>
      </div>
      {p.research?.notes?.length > 0 && (
        <div className="card">
          <h3 className="row" style={{ marginBottom: 8 }}><Icon name="news" size={18} className="g" />Team news from web search</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{p.research.notes.map((n, i) => <li key={i} className="sm" style={{ margin: '4px 0' }}>{n}</li>)}</ul>
          <p className="xs dim" style={{ marginTop: 8 }}>Found by Gemini with Google Search and not verified by us. {p.research.sources?.slice(0, 3).map((s) => <a key={s.uri} href={s.uri} target="_blank" rel="noopener noreferrer nofollow" className="g" style={{ marginRight: 8 }}>{s.title.slice(0, 26)}</a>)}</p>
        </div>)}
      <div className="card"><h3 style={{ marginBottom: 4 }}>All markets</h3><p className="xs muted">Pick names follow SportyBet. 1UP / 2UP = the team leads by 1 / 2 goals at any moment.</p><Markets groups={d.markets} bestId={p.best.id} /></div>
    </div>
  );
}

const EV = { goal: '⚽', card: '', sub: '⇄' };
function Timeline({ d }) {
  const m = d.match;
  if (!d.detail) return <div style={{ marginTop: 14 }}><Note info>{d.detailNote || 'No match events are available.'}</Note></div>;
  const ev = [
    ...d.detail.goals.map((g) => ({ ...g, kind: 'goal' })),
    ...d.detail.bookings.map((b) => ({ ...b, kind: 'card' })),
    ...d.detail.subs.map((s) => ({ ...s, kind: 'sub' })),
  ].sort((a, b) => (a.min ?? 999) - (b.min ?? 999));
  if (!ev.length) return <div style={{ marginTop: 14 }}><Empty icon="whistle" title="No events recorded">{m.status === 'SCHEDULED' ? 'Goals, cards and substitutions appear here once the match starts.' : 'No goals, cards or substitutions were recorded for this match.'}</Empty></div>;
  const text = (e) => e.kind === 'goal' ? <><b>{e.scorer || 'Goal'}</b>{e.type === 'OWN' && <span className="xs red"> (og)</span>}{e.type === 'PENALTY' && <span className="xs dim"> (pen)</span>}<div className="x">{e.assist ? `Assist: ${e.assist} · ` : ''}{e.score[0]}-{e.score[1]}</div></> :
    e.kind === 'card' ? <><span className={/RED/.test(e.card) ? 'card-r' : 'card-y'} /><b>{e.player || 'Player'}</b></> : <><b>{e.in || '?'}</b><div className="x">for {e.out || '?'}</div></>;
  return (
    <div className="card tl" style={{ marginTop: 14 }}>
      <div className="between xs muted" style={{ marginBottom: 4 }}><b>{m.home.name}</b><b>{m.away.name}</b></div>
      {ev.map((e, i) => (
        <div className={`ev ${e.kind}`} key={i}>
          <div className="l">{e.team === 'home' && <>{EV[e.kind]} {text(e)}</>}</div>
          <span className="min">{e.minute || '–'}'</span>
          <div>{e.team === 'away' && <>{EV[e.kind]} {text(e)}</>}</div>
        </div>))}
    </div>
  );
}

const STAT_LABELS = [['ball_possession', 'Possession', '%'], ['shots', 'Shots'], ['shots_on_goal', 'Shots on target'], ['shots_off_goal', 'Shots off target'], ['corner_kicks', 'Corners'], ['fouls', 'Fouls'], ['offsides', 'Offsides'], ['free_kicks', 'Free kicks'], ['saves', 'Saves'], ['yellow_cards', 'Yellow cards'], ['red_cards', 'Red cards']];
function Stats({ d }) {
  const s = d.detail?.stats;
  if (!s) return <div style={{ marginTop: 14 }}><Note info>{d.detail ? 'Match statistics are not included in your football-data.org plan for this match.' : (d.detailNote || 'Statistics are not available.')}</Note></div>;
  const rows = STAT_LABELS.filter(([k]) => s.home[k] != null && s.away[k] != null);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="between" style={{ marginBottom: 6 }}><b>{d.match.home.name}</b><b>{d.match.away.name}</b></div>
      {rows.map(([k, label, suffix]) => <DualStat key={k} label={label} home={s.home[k]} away={s.away[k]} suffix={suffix || ''} total={k === 'ball_possession' ? 100 : undefined} />)}
      {!rows.length && <p className="muted sm">No statistics were provided.</p>}
    </div>
  );
}

const lineOf = (pos = '') => (/keeper|goal/i.test(pos) ? 0 : /back|defen/i.test(pos) ? 1 : /mid/i.test(pos) ? 2 : 3);
function Lineup({ team, side }) {
  if (!side) return <div className="card"><h3>{team.name}</h3><p className="muted sm" style={{ marginTop: 6 }}>Lineup not published yet.</p></div>;
  const lines = [[], [], [], []];
  side.startXI.forEach((p) => lines[lineOf(p.position)].push(p));
  return (
    <div className="card">
      <div className="between"><h3>{team.name}</h3>{side.formation && <Tag>{side.formation}</Tag>}</div>
      {side.coach && <p className="xs muted" style={{ margin: '4px 0 10px' }}>Coach: {side.coach}</p>}
      <div className="pitch">{lines.filter((l) => l.length).map((l, i) => <div className="pline" key={i}>{l.map((p) => <div className="pl" key={p.name}><b>{p.number ?? '·'}</b>{p.name.split(' ').slice(-1)[0]}</div>)}</div>)}</div>
      {side.bench.length > 0 && <><h4 className="muted" style={{ margin: '14px 0 6px' }}>BENCH</h4><p className="sm">{side.bench.map((p) => p.name).join(' · ')}</p></>}
    </div>
  );
}
function Lineups({ d }) {
  const l = d.detail?.lineups;
  if (!l) return <div style={{ marginTop: 14 }}><Note info>{d.detailNote || 'Lineups have not been published, or are not included in your football-data.org plan.'}</Note></div>;
  return <div className="grid g2" style={{ marginTop: 14 }}><Lineup team={d.match.home} side={l.home} /><Lineup team={d.match.away} side={l.away} /></div>;
}

function RecentList({ rows }) {
  if (!rows.length) return <p className="muted sm">No finished matches stored yet.</p>;
  return rows.slice(0, 5).map((r) => (
    <A key={r.id} to={`/match/${r.id}`} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span className={`fd ${r.res}`}>{r.res}</span><Crest team={r.opp} size={20} /><span className="grow ell sm">{r.home ? 'vs' : '@'} {r.opp.name}</span><b className="num sm">{r.score}</b>
    </A>));
}

function H2H({ d }) {
  const { analysis: an, form, match: m } = d;
  const h = an.h2h;
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Head-to-head</h3>
        {h.meetings ? <>
          <div className="grid g3" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="tile center"><div className="v g">{h.aWins}</div><div className="l">{m.home.name} wins</div></div>
            <div className="tile center"><div className="v">{h.draws}</div><div className="l">Draws</div></div>
            <div className="tile center"><div className="v" style={{ color: 'var(--blue)' }}>{h.bWins}</div><div className="l">{m.away.name} wins</div></div>
          </div>
          <div style={{ marginTop: 10 }}>{h.matches.map((x) => <A key={x.id} to={`/match/${x.id}`} className="between sm" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><span className="muted">{new Date(x.date).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span><span className="grow center ell">{x.home} <b className="num">{x.score}</b> {x.away}</span></A>)}</div>
          <p className="xs dim" style={{ marginTop: 8 }}>From results stored for the last two seasons.</p></> : <p className="muted sm">These teams have not met in the stored results.</p>}
      </div>
      <div className="grid g2">
        {[['home', m.home], ['away', m.away]].map(([k, t]) => (
          <div className="card" key={k}>
            <div className="between" style={{ marginBottom: 10 }}><h3 className="row"><Crest team={t} size={22} />{t.name}</h3><FormDots form={form[k].form.split('')} /></div>
            <RecentList rows={form[k].recent} />
            <div className="between sm muted" style={{ marginTop: 10 }}><span>Home: {form[k].home.p ? `${form[k].home.w}W ${form[k].home.d}D ${form[k].home.l}L` : '–'}</span><span>Away: {form[k].away.p ? `${form[k].away.w}W ${form[k].away.d}D ${form[k].away.l}L` : '–'}</span></div>
          </div>))}
      </div>
    </div>
  );
}

const EDGE = { home: 'Home edge', away: 'Away edge', even: 'Even', unknown: 'No data' };
function AI({ d }) {
  const { status } = useApp();
  const [want, setWant] = useState(false);
  const m = d.match, an = d.analysis;
  const q = useApi(`/api/analysis/${m.id}?ai=1`, { enabled: want });
  const ai = q.data?.ai;
  const list = (items) => (items.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((s, i) => <li key={i} className="sm" style={{ margin: '4px 0' }}>{s}</li>)}</ul> : <p className="muted sm">Nothing stands out in the data.</p>);
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <div className="card glow">
        <h3 className="row" style={{ marginBottom: 8 }}><Icon name="spark" size={18} className="g" />Statistical summary</h3>
        <p>{an.summary}</p>
        <p className="xs dim" style={{ marginTop: 8 }}>Built only from stored results and the model's numbers.</p>
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Why the model leans this way</h3>
        <p className="xs muted" style={{ marginBottom: 6 }}>Each row compares the two teams on one measurable factor.</p>
        {an.factors.map((f) => (
          <div key={f.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <CompareRows rows={[{ label: f.label, a: f.home, b: f.away, lowerBetter: f.key === 'defence' }]} />
            <div className="between xs muted"><span>{f.note}</span><Tag kind={f.edge === 'home' ? 'High' : f.edge === 'away' ? 'ai' : ''}>{EDGE[f.edge]}</Tag></div>
          </div>))}
      </div>
      <div className="grid g2">
        {[['home', m.home, an.home], ['away', m.away, an.away]].map(([k, t, a]) => (
          <div className="card" key={k}>
            <h3 className="row" style={{ marginBottom: 10 }}><Crest team={t} size={22} />{t.name}</h3>
            <h4 className="g" style={{ marginBottom: 4 }}>STRENGTHS</h4>{list(a.strengths)}
            <h4 className="red" style={{ margin: '12px 0 4px' }}>WEAKNESSES</h4>{list(a.weaknesses)}
          </div>))}
      </div>
      <div className="card">
        <div className="between"><h3>Uncertainty</h3><Tag kind={an.uncertainty.level === 'High' ? 'Low' : an.uncertainty.level === 'Low' ? 'High' : 'Medium'}>{an.uncertainty.level} uncertainty</Tag></div>
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>{an.uncertainty.reasons.map((r, i) => <li key={i} className="sm" style={{ margin: '4px 0' }}>{r}</li>)}</ul>
        <p className="xs dim" style={{ marginTop: 10 }}>Even a 70% pick fails 3 times in 10. Treat every probability as an estimate, never a promise.</p>
      </div>
      <div className="card">
        <h3 className="row"><Icon name="spark" size={18} className="g" />Gemini explanation</h3>
        {!status?.ai?.enabled ? <p className="muted sm" style={{ marginTop: 8 }}>Set <b>GEMINI_API_KEY</b> to let Gemini write a plain-language explanation of the numbers above.</p> :
          !want ? <><p className="muted sm" style={{ margin: '8px 0 12px' }}>Gemini rewrites the statistics above as an explanation. It is given only these numbers and may not add anything else.</p><button className="btn sm" onClick={() => setWant(true)}><Icon name="spark" size={16} />Generate explanation</button></> :
          q.loading && !q.data ? <div style={{ marginTop: 10 }}><Skel h={14} style={{ marginBottom: 8 }} /><Skel h={14} w="80%" /></div> :
          q.error ? <p className="red sm" style={{ marginTop: 8 }}>{q.error}</p> :
          ai ? <div style={{ marginTop: 8 }}><p>{ai.summary}</p>
            {ai.keyInsights.length > 0 && <><h4 className="muted" style={{ margin: '12px 0 4px' }}>KEY INSIGHTS</h4>{list(ai.keyInsights)}</>}
            {ai.uncertainty && <p className="sm amber" style={{ marginTop: 10 }}>{ai.uncertainty}</p>}
            <p className="xs dim" style={{ marginTop: 10 }}>✦ Written by {q.data.aiModel} from the statistics on this page only.</p></div> :
          <p className="muted sm" style={{ marginTop: 8 }}>{q.data?.aiNote || 'No explanation was returned.'}</p>}
      </div>
    </div>
  );
}

export default function MatchCentre({ id, tab }) {
  const q = useApi(`/api/match/${id}`, { poll: 30000 });
  const t = TABS.some(([k]) => k === tab) ? tab : 'summary';
  return (
    <div style={{ paddingTop: 8 }}>
      <Async q={q} skeleton={<><Skel h={210} r={24} /><div style={{ height: 14 }} /><SkelList n={3} /></>}>{(d) => (
        <>
          <Header m={d.match} standings={d.standings} />
          {d.match.prediction && <PickBanner p={d.match.prediction} />}
          <div style={{ margin: '14px 0 0' }}><Seg value={t} onChange={(v) => setQuery('tab', v === 'summary' ? '' : v)} options={TABS} /></div>
          {t === 'summary' && <Summary d={d} />}{t === 'timeline' && <Timeline d={d} />}{t === 'stats' && <Stats d={d} />}
          {t === 'lineups' && <Lineups d={d} />}{t === 'h2h' && <H2H d={d} />}{t === 'ai' && <AI d={d} />}
          {d.stale && <p className="xs dim" style={{ marginTop: 10 }}>Showing saved match details; the data source could not be reached.</p>}
        </>)}
      </Async>
    </div>
  );
}
