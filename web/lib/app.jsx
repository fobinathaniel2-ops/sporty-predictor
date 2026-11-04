import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------------------------------ safe storage ---------- */
export const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: ignore */ } },
};

function clientId() {
  let id = store.get('sp_cid', null);
  if (!id || !/^[a-f0-9]{24,48}$/.test(id)) {
    const a = new Uint8Array(12); (self.crypto || {}).getRandomValues?.(a);
    id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    if (!/^[a-f0-9]{24}$/.test(id)) id = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    store.set('sp_cid', id);
  }
  return id;
}
const CID = clientId();

/* ------------------------------------------------------------------------------------------------ api ------------ */
const cache = new Map();

export async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'x-client-id': CID, ...(opt.headers || {}) } });
  let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
  return j;
}

/** Fetch with stale-while-revalidate caching and optional polling. */
export function useApi(url, { poll = 0, enabled = true } = {}) {
  const hit = url ? cache.get(url) : null;
  const [state, setState] = useState({ data: hit?.data ?? null, error: null, loading: !!url && enabled && !hit });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url || !enabled) { setState({ data: null, error: null, loading: false }); return undefined; }
    let dead = false;
    const c = cache.get(url);
    setState(c ? { data: c.data, error: null, loading: false } : { data: null, error: null, loading: true });
    const load = async () => {
      try { const data = await api(url); cache.set(url, { data, at: Date.now() }); if (!dead) setState({ data, error: null, loading: false }); } catch (e) { if (!dead) setState((s) => ({ data: s.data, error: e.message, loading: false })); }
    };
    if (!c || Date.now() - c.at > 20000 || tick) load();
    const timer = poll ? setInterval(() => { if (!document.hidden) load(); }, poll) : null;
    return () => { dead = true; if (timer) clearInterval(timer); };
  }, [url, enabled, poll, tick]);
  const reload = useCallback(() => { cache.delete(url); setTick((t) => t + 1); }, [url]);
  return { ...state, reload };
}

/* ----------------------------------------------------------------------------------------------- router ---------- */
function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, qs] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => { setR(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (to) => { location.hash = to; };
export const setQuery = (key, value) => {
  const raw = location.hash.replace(/^#/, '') || '/'; const [p, qs] = raw.split('?');
  const q = new URLSearchParams(qs || ''); if (value == null || value === '') q.delete(key); else q.set(key, value);
  history.replaceState(null, '', `#${p}${q.toString() ? '?' + q : ''}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

/* ----------------------------------------------------------------------------------------- app context ---------- */
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const NOTIFY_DEFAULT = { on: false, scope: 'favourites', types: { goal: true, kickoff: true, fulltime: true, result: true, soon: true } };
const DEFAULTS = { favTeams: [], favLeagues: [], dataSaver: false, reduceMotion: false, timeFormat: '24h', startPage: 'home', notify: NOTIFY_DEFAULT };

export function AppProvider({ children }) {
  const [prefs, setPrefsState] = useState(() => ({ ...DEFAULTS, ...store.get('sp_prefs', {}) }));
  const { data: status, error: statusError, reload } = useApi('/api/status', { poll: 60000 });
  const saveTimer = useRef(null);
  const [toast, setToast] = useState(null);

  // pull the saved preferences once (the server copy follows this device)
  useEffect(() => {
    api('/api/prefs').then((p) => { if (p && p.updatedAt) { const merged = { ...DEFAULTS, ...p }; setPrefsState(merged); store.set('sp_prefs', merged); } }).catch(() => {});
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('lite', !!prefs.dataSaver);
    root.classList.toggle('calm', !!prefs.reduceMotion || !!prefs.dataSaver);
  }, [prefs.dataSaver, prefs.reduceMotion]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((old) => {
      const next = { ...old, ...patch };
      store.set('sp_prefs', next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { api('/api/prefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {}); }, 600);
      return next;
    });
  }, []);

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 1800); }, []);
  const isFav = useCallback((kind, id) => (kind === 'team' ? prefs.favTeams : prefs.favLeagues).includes(id), [prefs]);
  const toggleFav = useCallback((kind, id) => {
    const key = kind === 'team' ? 'favTeams' : 'favLeagues';
    const list = prefs[key];
    const on = list.includes(id);
    setPrefs({ [key]: on ? list.filter((x) => x !== id) : [...list, id].slice(-40) });
    flash(on ? 'Removed from favourites' : 'Added to favourites');
  }, [prefs, setPrefs, flash]);

  return <Ctx.Provider value={{ status, statusError, reloadStatus: reload, prefs, setPrefs, isFav, toggleFav, flash, toast }}>{children}</Ctx.Provider>;
}
