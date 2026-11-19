export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : (x * 100).toFixed(d) + '%');
export const pct1 = (x) => (x == null ? '–' : `${x}%`);
export const num = (x, d = 1) => (x == null ? '–' : Number(x).toFixed(d));

const p2 = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Personal display settings live here so every formatter sees them (set by AppProvider).
const FMT = { tz: 'auto', odds: 'decimal', hour12: false };
export function setFormat(prefs) { FMT.tz = prefs?.tz || 'auto'; FMT.odds = prefs?.oddsFormat || 'decimal'; FMT.hour12 = prefs?.timeFormat === '12h'; }
const zone = () => (FMT.tz && FMT.tz !== 'auto' ? { timeZone: FMT.tz } : {});
const safe = (fn) => { try { return fn(zone()); } catch (e) { return fn({}); } };
export const fmtTime = (iso, prefs) => safe((z) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: prefs ? prefs.timeFormat === '12h' : FMT.hour12, ...z }));
export const fmtDate = (iso) => safe((z) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...z }));
export const fmtLong = (iso, prefs) => `${safe((z) => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...z }))} · ${fmtTime(iso, prefs)}`;

// Fair odds (1 / probability) shown as decimal or fractional. Not bookmaker odds.
const FRACS = [[1, 10], [1, 8], [1, 6], [1, 5], [1, 4], [2, 7], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6], [8, 11], [5, 6], [10, 11], [1, 1], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1], [9, 4], [5, 2], [11, 4], [3, 1], [7, 2], [4, 1], [9, 2], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [12, 1], [14, 1], [16, 1], [20, 1], [25, 1], [33, 1]];
export function fmtOdds(dec) {
  if (!(dec > 1)) return '–';
  if (FMT.odds !== 'fractional') return dec.toFixed(2);
  const x = dec - 1;
  let best = FRACS[0], bd = Infinity;
  for (const f of FRACS) { const dist = Math.abs(f[0] / f[1] - x) / x; if (dist < bd) { bd = dist; best = f; } }
  return `${best[0]}/${best[1]}`;
}

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
export const groupsFor = () => GROUPS;
export const GROUPS = ['All', 'Match result', 'Double chance', 'Draw no bet', 'Goals', 'BTTS', 'Correct score', 'Team goals', 'Win to nil', 'Half-time', 'HT/FT', 'Early payout'];

export function statusText(m) {
  if (m.status === 'LIVE') return m.minute ? `${m.minute}'` : 'LIVE';
  if (m.status === 'FINISHED') return 'FT';
  if (m.status === 'OTHER') return 'N/P';
  return '';
}
export const scoreOf = (m) => (m.status === 'FINISHED' ? m.ft : m.status === 'LIVE' ? m.live : null);
