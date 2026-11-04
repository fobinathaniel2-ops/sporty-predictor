import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { A, Crest } from './base';
import { useApi } from '../lib/app';

export default function SearchBox({ hero }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const box = useRef(null);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const on = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', on);
    return () => document.removeEventListener('pointerdown', on);
  }, []);
  const r = useApi(term.length >= 2 ? `/api/search?q=${encodeURIComponent(term)}` : null);
  const close = () => { setOpen(false); setQ(''); };
  const d = r.data;
  const empty = d && !d.teams.length && !d.leagues.length && !d.fixtures.length;
  return (
    <div className="search" ref={box}>
      <Icon name="search" size={18} />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && close()}
        placeholder={hero ? 'Search teams, leagues and fixtures…' : 'Search teams, leagues, fixtures'} aria-label="Search" enterKeyHint="search" />
      {open && term.length >= 2 && (
        <div className="sres" onClick={close}>
          {r.loading && !d && <p className="muted sm" style={{ padding: 12 }}>Searching…</p>}
          {empty && <p className="muted sm" style={{ padding: 12 }}>Nothing found for “{term}”.</p>}
          {d?.leagues.length > 0 && <><h4>Leagues</h4>{d.leagues.map((l) => <A key={l.code} to={`/league/${l.code}`}><Crest team={{ name: l.name, crest: l.emblem }} size={24} /><b>{l.name}</b><span className="muted xs">{l.country}</span></A>)}</>}
          {d?.teams.length > 0 && <><h4>Teams</h4>{d.teams.map((t) => <A key={t.id} to={`/team/${t.id}`}><Crest team={t} size={24} /><b>{t.name}</b></A>)}</>}
          {d?.fixtures.length > 0 && <><h4>Fixtures</h4>{d.fixtures.map((m) => <A key={m.id} to={`/match/${m.id}`}><Crest team={m.home} size={20} /><span className="grow ell sm"><b>{m.home.name}</b> vs <b>{m.away.name}</b></span><span className="muted xs">{m.status === 'FINISHED' ? m.ft.join('-') : new Date(m.date).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span></A>)}</>}
        </div>
      )}
    </div>
  );
}
