import { useMemo, useState } from 'react';
import Icon from './Icon';
import { A, Crest, Empty, ErrorState, Modal, Seg, SkelList, Tag, Ring } from './base';
import { useApi, useApp } from '../lib/app';
import { addDays, dayKey, fmtTime, isEarly, pct, relDay, scoreOf, startOfDay, statusText } from '../lib/format';

export function PickName({ best, size }) {
  const early = isEarly(best.id);
  return <span className={`pickname ${early ? 'early' : ''}`} style={size ? { fontSize: size } : null}>{early && <Icon name="bolt" size={13} />}{best.label}</span>;
}

const mark = (c) => (c === true ? <Tag kind="ok">✓ Correct</Tag> : c === false ? <Tag kind="bad">✗ Wrong</Tag> : null);

export function PickLine({ p }) {
  if (!p) return null;
  const b = p.best;
  return (
    <div className="mpick">
      <PickName best={b} />
      <span className="xs muted num">{pct(b.p)}{b.p > 0 ? ` · fair ${(1 / b.p).toFixed(2)}` : ''}</span>
      {p.kind === 'live' && <Tag kind="Low">LIVE PICK</Tag>}
      {p.kind === 'web' && <Tag>WEB</Tag>}
      {p.kind === 'esports' && <Tag kind="Low">ESPORTS</Tag>}
      {b.source === 'ai' && <Tag kind="ai">✦ Gemini{b.estimated ? ' est.' : ''}</Tag>}
      {p.settled ? mark(b.correct) : <Tag kind={p.confidence}>{p.confidence}</Tag>}
      {p.high && <span className="xs" style={{ flexBasis: '100%' }}>💰 High odds: <b>{p.high.label}</b> <span className="muted num">{pct(p.high.p)} · fair {(p.high.odds || 1 / p.high.p).toFixed(2)}</span> {p.settled ? mark(p.high.correct) : null}</span>}
      {p.inplay && !p.settled && <span className="xs g" style={{ flexBasis: '100%' }}>⚡ Live: {p.inplay.best.label} · {pct(p.inplay.best.p)}</span>}
    </div>
  );
}

export function MatchRow({ m, showPick = true, showLeague = false }) {
  const { prefs } = useApp();
  const sc = scoreOf(m);
  const live = m.status === 'LIVE';
  const win = sc && sc[0] !== sc[1] ? (sc[0] > sc[1] ? 0 : 1) : -1;
  return (
    <A to={`/match/${m.id}`} className="mrow" style={{ display: 'grid' }}>
      <div className={`when ${live ? 'live' : ''}`}>
        {live ? <><span className="pulse" style={{ display: 'inline-block' }} /><div>{statusText(m)}</div></> : m.status === 'FINISHED' ? <div>FT</div> : <div>{fmtTime(m.date, prefs)}</div>}
        {m.status === 'SCHEDULED' && <div className="xs dim" style={{ fontWeight: 600 }}>{relDay(m.date)}</div>}
      </div>
      <div className="mteams">
        {showLeague && <div className="xs muted ell" style={{ marginBottom: 2 }}>{m.league.name}</div>}
        <div><Crest team={m.home} size={22} /><span className="ell">{m.home.name}</span></div>
        <div><Crest team={m.away} size={22} /><span className="ell">{m.away.name}</span></div>
        {showPick && <PickLine p={m.prediction} />}
      </div>
      <div>
        {sc ? <><div className={`mscore num ${win === 0 ? 'win' : ''}`}>{sc[0]}</div><div className={`mscore num ${win === 1 ? 'win' : ''}`}>{sc[1]}</div></> : <Icon name="right" size={18} className="dim" />}
      </div>
    </A>
  );
}

/** Matches grouped under their competition. */
export function MatchList({ matches, grouped = true, showPick = true, showLeague = false }) {
  const groups = useMemo(() => {
    if (!grouped) return [['', matches]];
    const map = new Map();
    matches.forEach((m) => { if (!map.has(m.league.code)) map.set(m.league.code, []); map.get(m.league.code).push(m); });
    return [...map.values()].map((list) => [list[0].league, list]);
  }, [matches, grouped]);
  return (
    <div className="stack">
      {groups.map(([lg, list]) => (
        <div className="card flat" key={lg.code || 'x'}>
          {lg && <A to={`/league/${lg.code}`} className="lgh"><Crest team={{ name: lg.name, crest: lg.emblem }} size={20} />{lg.name}{lg.demo && <Tag kind="demo">DEMO</Tag>}<span className="muted xs" style={{ marginLeft: 'auto' }}>{list.length}</span></A>}
          {list.map((m) => <MatchRow key={m.id} m={m} showPick={showPick} showLeague={showLeague && !lg} />)}
        </div>
      ))}
    </div>
  );
}

export function LiveCard({ m }) {
  const sc = m.live || [0, 0];
  return (
    <A to={`/match/${m.id}`} className="livecard card" style={{ display: 'block', padding: 14 }}>
      <div className="between xs"><span className="muted ell">{m.league.name}</span><Tag kind="live"><span className="pulse" />{statusText(m) || 'LIVE'}</Tag></div>
      <div className="t"><span className="row"><Crest team={m.home} size={26} /><b className="sm ell" style={{ maxWidth: 150 }}>{m.home.name}</b></span><b className="num">{sc[0]}</b></div>
      <div className="t"><span className="row"><Crest team={m.away} size={26} /><b className="sm ell" style={{ maxWidth: 150 }}>{m.away.name}</b></span><b className="num">{sc[1]}</b></div>
      {m.prediction && <PickLine p={m.prediction} />}
    </A>
  );
}

export function PickCard({ m }) {
  const p = m.prediction, b = p.best;
  const early = isEarly(b.id);
  return (
    <A to={`/match/${m.id}`} className="pickcard card lift" style={{ display: 'block' }}>
      <div className="between xs"><span className="muted ell">{m.league.name}</span><span className="muted">{relDay(m.date)} · {fmtTime(m.date)}</span></div>
      <div className="row" style={{ margin: '10px 0 4px', gap: 8 }}><Crest team={m.home} size={22} /><b className="sm ell">{m.home.name}</b><span className="dim xs">vs</span><Crest team={m.away} size={22} /><b className="sm ell">{m.away.name}</b></div>
      <div className="between">
        <div style={{ minWidth: 0 }}>
          <div className={`big ${early ? 'early' : ''}`}>{b.label}</div>
          <div className="xs muted ell">{b.about || b.market}</div>
        </div>
        <Ring value={b.p} size={58} color={early ? 'var(--violet)' : 'var(--g)'} />
      </div>
      <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
        {b.source === 'ai' ? <Tag kind="ai">✦ Gemini pick</Tag> : <Tag>Stats pick</Tag>}<Tag kind={p.confidence}>{p.confidence}</Tag>{p.hasNotes && <Tag>Team news</Tag>}
      </div>
    </A>
  );
}

/** Week navigator + day tabs + competition chips. Both filters combine; the numbers show what each choice contains. */
export function FixtureBrowser({ filter, extra, sortable = false, emptyText, filterCount = 0, filterSummary = '' }) {
  const { status, prefs } = useApp();
  const today = startOfDay(new Date());
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState(dayKey(today));
  const [league, setLeague] = useState('');
  const start = addDays(today, offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const q = useApi(`/api/fixtures?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(addDays(start, 7).toISOString())}`, { poll: prefs.dataSaver ? 120000 : 60000 });
  const [sort, setSort] = useState('league');
  const [open, setOpen] = useState(false);
  const list = (q.data || []).filter((m) => !filter || filter(m)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const inLeague = (m) => !league || m.league.code === league;
  const inDay = (m) => sel === 'week' || dayKey(new Date(m.date)) === sel;
  const dayCount = {}; list.filter(inLeague).forEach((m) => { const k = dayKey(new Date(m.date)); dayCount[k] = (dayCount[k] || 0) + 1; });
  const total = Object.values(dayCount).reduce((s, n) => s + n, 0);
  const leagueCount = {}; list.filter(inDay).forEach((m) => { leagueCount[m.league.code] = (leagueCount[m.league.code] || 0) + 1; });
  const shown = list.filter((m) => inDay(m) && inLeague(m));
  const move = (n) => { const o = offset + n; setOffset(o); setSel(o === 0 ? dayKey(today) : 'week'); };
  const fmt = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const leagueName = league ? ((status?.competitions || status?.leagues || []).find((l) => l.code === league)?.name || league) : 'All competitions';
  const dayName = sel === 'week' ? `${fmt(days[0])} – ${fmt(days[6])}` : sel === dayKey(today) ? 'Today' : new Date(sel + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  const activeCount = (league ? 1 : 0) + (sel !== dayKey(today) ? 1 : 0) + (sort !== 'league' ? 1 : 0) + (filterCount || 0);
  const summary = [dayName, leagueName, sortable ? (sort === 'time' ? 'by time' : 'by competition') : null, filterSummary].filter(Boolean).join(' · ');
  return (
    <div>
      <div className="card filterbar">
        <button className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog"><Icon name="sliders" size={18} /> Filters &amp; sort{activeCount ? <span className="badge">{activeCount}</span> : null}</button>
        <div className="grow xs muted ell">{summary}</div>
        <b className="num sm">{shown.length}</b>
      </div>
      {open && <Modal title="Filters & sort" onClose={() => setOpen(false)} footer={<button className="btn primary wide" onClick={() => setOpen(false)}>Show {shown.length} match{shown.length === 1 ? '' : 'es'}</button>}>
      <div className="between" style={{ margin: '0 0 10px' }}>
        <button className="iconbtn" onClick={() => move(-1)} disabled={offset <= -4} aria-label="Previous week"><Icon name="left" /></button>
        <b className="muted sm">{fmt(days[0])} – {fmt(days[6])}</b>
        <button className="iconbtn" onClick={() => move(1)} disabled={offset >= 4} aria-label="Next week"><Icon name="right" /></button>
      </div>
      <div className="days">
        <button className={`day ${sel === 'week' ? 'on' : ''}`} onClick={() => setSel('week')}><span>Week</span><small>all days</small><i>{total}</i></button>
        {days.map((d) => { const k = dayKey(d); return (
          <button key={k} className={`day ${sel === k ? 'on' : ''}`} onClick={() => setSel(k)}>
            <span>{k === dayKey(today) ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })}</span><small>{fmt(d)}</small><i>{dayCount[k] || 0}</i>
          </button>); })}
      </div>
      <div className="chips">
        <button className={`chip ${league === '' ? 'on' : ''}`} onClick={() => setLeague('')}>All competitions <small>{Object.values(leagueCount).reduce((s, n) => s + n, 0)}</small></button>
        {(status?.competitions || status?.leagues || []).map((l) => (
          <button key={l.code} className={`chip ${league === l.code ? 'on' : ''} ${leagueCount[l.code] ? '' : 'dim'}`} onClick={() => setLeague(l.code)}>
            <Crest team={{ name: l.name, crest: l.emblem }} size={18} />{l.name} <small>{leagueCount[l.code] || 0}</small>
          </button>))}
      </div>
      {extra}
      {sortable && <div className="sortrow"><span className="xs muted" style={{ fontWeight: 700 }}>SORT</span><Seg value={sort} onChange={setSort} options={[['league', 'By competition'], ['time', 'By kick-off time']]} /></div>}
            </Modal>}
      <div style={{ marginTop: 8 }}>
        {q.loading && !q.data ? <SkelList n={5} /> : q.error && !q.data ? <ErrorState error={q.error} onRetry={q.reload} /> :
          shown.length ? <MatchList matches={shown} grouped={sort === 'league' && !league} showLeague={sort === 'time' && !league} /> :
          <Empty icon="calendar" title="No matches here">{emptyText}{emptyText ? ' ' : ''}There are no matches for {league ? ((status?.competitions || status?.leagues || []).find((l) => l.code === league)?.name || league) : 'any competition'} {sel === 'week' ? 'this week' : 'on this date'}.{status && !status.lastRun ? ' The first data update is still running.' : ''}{league && /^(WEB|ES)_/.test(league) ? ' Gemini searches the web for this competition\'s matches in the background (eFootball about every 40 minutes), so they appear here once it finds them.' : ''}</Empty>}
      </div>
    </div>
  );
}
