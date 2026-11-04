import { api, store } from './app';

export const alertsSupported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const pushSupported = () => alertsSupported() && 'PushManager' in window;
export const permission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

const toKey = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4), raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const JSONH = { 'content-type': 'application/json' };

/** Ask permission and register this device for push messages. Resolves { ok, push, reason }. */
export async function enableAlerts() {
  if (!alertsSupported()) return { ok: false, reason: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  if (!pushSupported()) return { ok: true, push: false };
  try {
    const { key } = await api('/api/push/key');
    if (!key) return { ok: true, push: false };
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) }));
    await api('/api/push', { method: 'PUT', headers: JSONH, body: JSON.stringify({ subscription: sub.toJSON() }) });
    store.set('sp_push', true);
    return { ok: true, push: true };
  } catch (e) { return { ok: true, push: false, reason: e.message }; }
}

export async function disableAlerts() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch { /* ignore */ }
  try { await api('/api/push', { method: 'PUT', headers: JSONH, body: JSON.stringify({ subscription: null }) }); } catch { /* ignore */ }
  store.set('sp_push', false);
}

export const sendTest = () => api('/api/push/test', { method: 'PUT', headers: JSONH, body: '{}' });

/** Same rule the server uses to decide who gets an event. */
export function inScope(ev, prefs, scope = prefs.notify?.scope) {
  if (scope === 'all') return true;
  return prefs.favTeams.some((id) => String(id) === ev.homeId || String(id) === ev.awayId) || prefs.favLeagues.includes(ev.leagueCode);
}
export const typeOn = (ev, prefs) => prefs.notify?.types?.[ev.type] !== false;

/** Show a system notification from the open app (used when push is not set up). */
export async function showLocal(ev) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(ev.title, { body: ev.body || '', tag: ev.id, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: `/#/match/${ev.matchId}` } });
  } catch { /* ignore */ }
}
