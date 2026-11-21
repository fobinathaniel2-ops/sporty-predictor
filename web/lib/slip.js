import { useEffect, useState } from 'react';

const KEY = 'sp_slip';
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 30) : []; } catch (e) { return []; } };
let mem = read();
const write = (list) => { mem = list.slice(0, 30); try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* private mode */ } window.dispatchEvent(new Event('sp-slip')); };

export const slipAdd = (it) => { if (!mem.some((x) => x.id === it.id)) write([...mem, it]); };
export const slipRemove = (id) => write(mem.filter((x) => x.id !== id));
export const slipClear = () => write([]);
export const slipHas = (id) => mem.some((x) => x.id === id);
export function useSlip() {
  const [list, set] = useState(mem);
  useEffect(() => { const f = () => set(mem); window.addEventListener('sp-slip', f); return () => window.removeEventListener('sp-slip', f); }, []);
  return list;
}

/** Combined chance if every pick must win (assumes they are independent). */
export const combined = (list) => list.reduce((a, x) => a * x.p, 1);

const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export const encodeSlip = (list) => b64(JSON.stringify(list.map((x) => [x.id, x.h, x.a, x.l, +x.p.toFixed(3), x.k, x.lg])));
export function decodeSlip(s) {
  try {
    const rows = JSON.parse(unb64(s));
    return rows.slice(0, 30).filter((r) => Array.isArray(r) && r.length >= 6).map(([id, h, a, l, p, k, lg]) => ({ id: String(id), h: String(h).slice(0, 60), a: String(a).slice(0, 60), l: String(l).slice(0, 40), p: Math.min(0.99, Math.max(0.01, +p || 0.5)), k: String(k), lg: String(lg || '').slice(0, 60) }));
  } catch (e) { return []; }
}
