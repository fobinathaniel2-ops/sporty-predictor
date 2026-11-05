import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import Icon from './ui/Icon';
import { A, Tag } from './ui/base';
import { AppProvider, go, useApp, useRoute } from './lib/app';
import SearchBox from './ui/SearchBox';
import Bell from './ui/Notifications';
import Home from './pages/Home';
import Matches from './pages/Matches';
import MatchCentre from './pages/MatchCentre';
import { LeaguesPage, LeaguePage } from './pages/Leagues';
import { TeamsPage, TeamPage } from './pages/Teams';
import Analyst from './pages/Analyst';
import Stats from './pages/Stats';
import Profile from './pages/Profile';

const SIDE = [
  ['/', 'home', 'Dashboard'], ['/live', 'live', 'Live Matches'], ['/fixtures', 'calendar', 'Fixtures'], ['/results', 'results', 'Results'],
  ['/leagues', 'trophy', 'Leagues'], ['/teams', 'shield', 'Teams'], ['/ai', 'spark', 'AI Analyst'], ['/stats', 'chart', 'Statistics'], ['/settings', 'gear', 'Settings'],
];
const BOTTOM = [['/', 'home', 'Home'], ['/fixtures', 'calendar', 'Matches'], ['/leagues', 'trophy', 'Leagues'], ['/ai', 'spark', 'AI Analyst'], ['/profile', 'user', 'Profile']];

function activeFor(path, to) {
  const root = '/' + (path[0] || '');
  if (to === '/') return path.length === 0;
  if (to === '/fixtures') return ['/fixtures', '/live', '/results', '/match'].includes(root);
  if (to === '/leagues') return root === '/leagues' || root === '/league';
  if (to === '/teams') return root === '/teams' || root === '/team';
  return root === to;
}

function Logo() {
  return <A to="/" className="logo"><i><Icon name="ball" size={19} /></i><span>Predict<b>x</b></span></A>;
}

function Side({ path }) {
  const { status } = useApp();
  return (
    <aside className="side">
      <Logo />
      <nav aria-label="Main">{SIDE.map(([to, icon, label]) => <A key={to} to={to} className={activeFor(path, to) ? 'on' : ''}><Icon name={icon} />{label}{to === '/live' && status?.counts?.live > 0 && <Tag kind="live" ><span className="pulse" />{status.counts.live}</Tag>}</A>)}</nav>
      <div className="foot">
        <div className="row"><i className={`dot ${status?.configured ? 'on' : 'off'}`} /><b>{status?.configured ? status.provider : 'No data source'}</b></div>
        <div className="row" style={{ marginTop: 6 }}><i className={`dot ${status?.ai?.enabled ? 'on' : ''}`} />{status?.ai?.enabled ? `Gemini · ${status.ai.model}` : 'Gemini off'}</div>
      </div>
    </aside>
  );
}

function Route({ route }) {
  const [a, b] = route.path;
  switch (a) {
    case undefined: return <Home />;
    case 'live': return <Matches mode="live" />;
    case 'fixtures': return <Matches mode="fixtures" />;
    case 'results': return <Matches mode="results" />;
    case 'matches': return <Matches mode="fixtures" />;
    case 'match': return <MatchCentre id={b} tab={route.query.tab} />;
    case 'leagues': return <LeaguesPage />;
    case 'league': return <LeaguePage code={b} tab={route.query.tab} />;
    case 'teams': return <TeamsPage />;
    case 'team': return <TeamPage id={b} />;
    case 'ai': return <Analyst />;
    case 'stats': return <Stats />;
    case 'profile': case 'settings': return <Profile settings={a === 'settings'} />;
    default: return <div className="card center" style={{ padding: 40 }}><h2>Page not found</h2><p className="muted" style={{ margin: '8px 0 16px' }}>That page does not exist.</p><A to="/" className="btn">Go home</A></div>;
  }
}

function Shell() {
  const route = useRoute();
  const { status, toast, prefs } = useApp();
  const first = useRef(true);
  useEffect(() => { // honour the "start page" preference when the app opens on the bare address
    if (first.current) { first.current = false; if (!location.hash || location.hash === '#/') { const map = { fixtures: '/fixtures', live: '/live', matches: '/fixtures', leagues: '/leagues', ai: '/ai' }; if (map[prefs.startPage]) go(map[prefs.startPage]); } }
  }, [prefs.startPage]);
  return (
    <div className="shell">
      <Side path={route.path} />
      {status?.demo && <div className="demoBanner">DEMO MODE · simulated league for testing only</div>}
      <div className="main">
        <header className="topbar"><div className="logo-m"><Logo /></div><SearchBox /><Bell /></header>
        <main className="page" key={route.path.join('/')}><Route route={route} /></main>
        <footer className="disc">
          Predictx is an analytical tool, not betting advice, and is not affiliated with SportyBet or any bookmaker. It does not take bets. Probabilities are estimates and no pick is guaranteed. Gambling can be addictive: 18+, bet only what you can afford to lose.
        </footer>
      </div>
      <nav className="bottom" aria-label="Main">{BOTTOM.map(([to, icon, label]) => <A key={to} to={to} className={activeFor(route.path, to) || (to === '/profile' && route.path[0] === 'settings') ? 'on' : ''}><Icon name={icon} size={22} />{label}</A>)}</nav>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<AppProvider><Shell /></AppProvider>);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
