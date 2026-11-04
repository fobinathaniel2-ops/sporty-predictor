import Icon from '../ui/Icon';
import SearchBox from '../ui/SearchBox';
import { A, Async, Crest, Empty, ErrorState, Note, Section, Skel, SkelCards, SkelList, Tag } from '../ui/base';
import { LiveCard, MatchList, PickCard } from '../ui/match';
import { useApi, useApp } from '../lib/app';
import { addDays, greeting, startOfDay } from '../lib/format';

const enc = encodeURIComponent;

function News() {
  const q = useApi('/api/news');
  if (q.loading && !q.data) return <div className="grid g2"><Skel h={110} r={18} /><Skel h={110} r={18} /></div>;
  const d = q.data;
  if (!d || !d.enabled) return <Note info>Live football news is compiled by Gemini from a web search. Set <b>GEMINI_API_KEY</b> to turn it on.</Note>;
  if (d.error && !d.items.length) return <Note info={/being prepared/.test(d.error)}>{/being prepared/.test(d.error) ? d.error : `News is unavailable right now: ${d.error}`}</Note>;
  if (!d.items.length) return <Empty icon="news" title="No news yet">Nothing was found for your competitions.</Empty>;
  return (
    <>
      <div className="grid g2">
        {d.items.slice(0, 6).map((n, i) => (
          <div className="card news" key={i}><Tag kind="ai">{n.topic}</Tag><h3>{n.title}</h3><p className="muted sm">{n.summary}</p></div>
        ))}
      </div>
      <p className="xs dim" style={{ marginTop: 10 }}>✦ Compiled by Gemini from web search results, so check the original source. {d.sources?.slice(0, 4).map((s) => <a key={s.uri} href={s.uri} target="_blank" rel="noopener noreferrer nofollow" className="g" style={{ marginRight: 8 }}>{s.title.slice(0, 30)}</a>)}</p>
    </>
  );
}

function ForYou({ favTeams, favLeagues }) {
  const t = startOfDay(new Date());
  const q = useApi(`/api/fixtures?from=${enc(t.toISOString())}&to=${enc(addDays(t, 7).toISOString())}`);
  if (!q.data) return null;
  const list = q.data.filter((m) => m.status !== 'FINISHED' && (favTeams.includes(m.home.id) || favTeams.includes(m.away.id) || favLeagues.includes(m.league.code))).slice(0, 6);
  if (!list.length) return null;
  return <Section title="For you" icon="star"><MatchList matches={list} grouped={false} /></Section>;
}

export default function Home() {
  const { status, prefs } = useApp();
  const t = startOfDay(new Date());
  const dash = useApi(`/api/dashboard?from=${enc(t.toISOString())}&to=${enc(addDays(t, 1).toISOString())}`, { poll: prefs.dataSaver ? 120000 : 45000 });
  const leagues = useApi('/api/leagues');
  const d = dash.data;
  const next = d?.today.find((m) => m.status === 'SCHEDULED');
  const hasFav = prefs.favTeams.length || prefs.favLeagues.length;

  return (
    <div>
      <div className="card glow" style={{ padding: '22px 18px', marginTop: 6, background: 'radial-gradient(600px 240px at 0 0,rgba(45,255,138,.16),transparent 70%),var(--card)' }}>
        <p className="muted sm" style={{ fontWeight: 700 }}>{greeting()}</p>
        <h1 style={{ margin: '4px 0 6px' }}>Football, <span className="g">decoded</span>.</h1>
        <p className="muted" style={{ maxWidth: 560 }}>Live scores, match centres and an AI analyst that explains its numbers. Every probability comes from real match data.</p>
        <div className="hero-search" style={{ marginTop: 16 }}><SearchBox hero /></div>
        <div className="grid g4" style={{ marginTop: 16 }}>
          <div className="tile"><div className="v">{d ? d.live.length : '–'}</div><div className="l">Live now</div></div>
          <div className="tile"><div className="v">{d ? d.today.length : '–'}</div><div className="l">Matches today</div></div>
          <div className="tile"><div className="v">{status ? status.counts.upcoming : '–'}</div><div className="l">Upcoming</div></div>
          <div className="tile"><div className="v">{status ? status.counts.verified : '–'}</div><div className="l">Picks verified</div></div>
        </div>
      </div>

      {status && !status.configured && <div style={{ marginTop: 16 }}><Note>No football data source is configured. Start the server with <b>FOOTBALL_DATA_KEY</b> set to load real fixtures.</Note></div>}
      {dash.error && !d && <div style={{ marginTop: 16 }}><ErrorState error={dash.error} onRetry={dash.reload} /></div>}

      <Section title="Live now" icon="live" to="/live">
        {dash.loading && !d ? <SkelCards n={2} h={120} /> : d?.live.length ? (
          <div className="hscroll">{d.live.map((m) => <LiveCard key={m.id} m={m} />)}</div>
        ) : <Empty icon="live" title="No live matches right now">{next ? `Next kick-off: ${next.home.name} vs ${next.away.name} at ${new Date(next.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Live scores will appear here during match time.'}</Empty>}
      </Section>

      <Section title="Top AI picks" icon="spark" to="/ai" more="AI Analyst">
        {dash.loading && !d ? <SkelCards n={2} h={170} /> : d?.picks.length ? (
          <div className="hscroll">{d.picks.map((m) => <PickCard key={m.id} m={m} />)}</div>
        ) : <Empty icon="spark" title="No picks yet">Picks appear once enough results are loaded for a competition.</Empty>}
      </Section>

      {hasFav ? <ForYou favTeams={prefs.favTeams} favLeagues={prefs.favLeagues} /> : null}

      <div className="cols">
        <div>
          <Section title="Today's fixtures" icon="calendar" to="/fixtures">
            {dash.loading && !d ? <SkelList n={4} /> : d?.today.length ? <MatchList matches={d.today} /> : <Empty icon="calendar" title="No matches today">Check the fixtures page for the rest of the week.</Empty>}
          </Section>
          <Section title="Recently completed" icon="results" to="/results">
            {dash.loading && !d ? <SkelList n={3} /> : d?.recent.length ? <MatchList matches={d.recent} /> : <Empty icon="results" title="No results yet">Finished matches will show here.</Empty>}
          </Section>
        </div>
        <div>
          <Section title="Popular leagues" icon="trophy" to="/leagues">
            <Async q={leagues} skeleton={<SkelCards n={2} h={70} />}>{(ls) => (
              <div className="grid g2">{ls.slice(0, 6).map((l) => (
                <A key={l.code} to={`/league/${l.code}`} className="card lift row" style={{ padding: 12 }}>
                  <Crest team={{ name: l.name, crest: l.emblem }} size={36} />
                  <div className="grow"><b className="ell" style={{ display: 'block' }}>{l.name}</b><span className="xs muted">{l.next7} this week{l.live ? ` · ${l.live} live` : ''}</span></div>
                </A>))}</div>)}
            </Async>
          </Section>
          <Section title="Featured teams" icon="shield" to="/teams">
            {d?.featured.length ? <div className="hscroll">{d.featured.map((t2) => (
              <A key={t2.id} to={`/team/${t2.id}`} className="card lift center" style={{ width: 112, padding: 14 }}>
                <div style={{ display: 'grid', placeItems: 'center' }}><Crest team={t2} size={44} /></div>
                <b className="sm ell" style={{ display: 'block', marginTop: 8 }}>{t2.name}</b><span className="xs muted">Elo {t2.elo}</span>
              </A>))}</div> : <Skel h={100} r={18} />}
          </Section>
          <Section title="Latest news" icon="news"><News /></Section>
        </div>
      </div>
    </div>
  );
}
