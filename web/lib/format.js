export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : (x * 100).toFixed(d) + '%');
export const pct1 = (x) => (x == null ? '–' : `${x}%`);
export const num = (x, d = 1) => (x == null ? '–' : Number(x).toFixed(d));

const p2 = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const fmtTime = (iso, prefs) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: prefs?.timeFormat === '12h' });
export const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtLong = (iso, prefs) => `${new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(iso, prefs)}`;

export function relDay(iso) {
  const t = startOfDay(new Date()), d = startOfDay(new Date(iso));
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDate(iso);
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late night football' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'Kicking off';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

const PALETTE = ['#1f6feb', '#8957e5', '#d29922', '#da3633', '#2da44e', '#0e8a8a', '#bf4b8a', '#e0702b'];
export function colorFor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const isEarly = (id) => /^[12]UP /.test(id || '');
export const GROUPS = ['All', 'Match result', 'Double chance', 'Draw no bet', 'Goals', 'BTTS', 'Team goals', 'Win to nil', 'Half-time', 'HT/FT', 'Early payout'];

export function statusText(m) {
  if (m.status === 'LIVE') return m.minute ? `${m.minute}'` : 'LIVE';
  if (m.status === 'FINISHED') return 'FT';
  if (m.status === 'OTHER') return 'N/P';
  return '';
}
export const scoreOf = (m) => (m.status === 'FINISHED' ? m.ft : m.status === 'LIVE' ? m.live : null);
