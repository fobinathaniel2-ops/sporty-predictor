'use strict';
/**
 * Notifications.
 *  scan()    compares the matches with what was last announced and records events: kick-off, goal, full time,
 *            pick result and a 30-minute reminder. The app's bell reads these.
 *  deliver() sends the same events as Web Push messages to the devices that switched alerts on (works with the app closed).
 * Web Push is done with Node's own crypto (VAPID + RFC 8291 aes128gcm), so no packages are needed.
 */
const crypto = require('crypto');
const dbm = require('./db');

const TYPES = ['goal', 'kickoff', 'fulltime', 'result', 'soon'];
const MAX_EVENTS = 300;
const b64u = (b) => Buffer.from(b).toString('base64url');

/* ------------------------------------------------------------------------------------------------------ events ----- */

const score = (m) => (Array.isArray(m.live) ? m.live : Array.isArray(m.ft) ? m.ft : null);
const pickLine = (p) => (p?.best ? `${p.best.label} · ${Math.round(p.best.p * 100)}%` : null);

function scan(now = new Date()) {
  const d = dbm.data();
  d.notifications = d.notifications || [];
  const st = (d.meta.nstate = d.meta.nstate || {});
  const out = [];
  const T = +now;
  for (const m of Object.values(d.matches)) {
    const t = new Date(m.date).getTime();
    const near = m.status === 'LIVE' || (t > T - 30 * 3600000 && t < T + 45 * 60000);
    if (!near) continue;
    const p = d.predictions[m.id];
    const lg = d.leagues[m.league]?.name || '';
    const mk = (type, n, title, body) => out.push({
      id: `${m.id}:${type}:${n}`, at: now.toISOString(), type, matchId: m.id, leagueCode: m.league, league: lg,
      homeId: String(m.home.id), awayId: String(m.away.id), home: m.home.name, away: m.away.name, title, body,
    });
    const s = score(m); const total = s ? s[0] + s[1] : 0; const scoreTxt = s ? `${s[0]}-${s[1]}` : '';
    const prev = st[m.id];
    const cur = { s: m.status, g: total, soon: prev?.soon, res: prev?.res };

    if ((m.status === 'SCHEDULED' || m.status === 'TIMED') && t > T && t - T <= 35 * 60000 && !cur.soon) {
      cur.soon = 1;
      const pl = pickLine(p);
      mk('soon', 0, `Kicks off soon · ${m.home.name} vs ${m.away.name}`, [lg, pl && `Pick: ${pl}`].filter(Boolean).join(' · '));
    }
    if (prev) {
      if (prev.s !== 'LIVE' && prev.s !== 'FINISHED' && m.status === 'LIVE') mk('kickoff', 0, `Kick-off · ${m.home.name} vs ${m.away.name}`, [lg, pickLine(p) && `Pick: ${pickLine(p)}`].filter(Boolean).join(' · '));
      if ((m.status === 'LIVE' || m.status === 'FINISHED') && s && total > (prev.g || 0)) {
        const home = s[0] > (prev.gh ?? 0);
        mk('goal', total, `⚽ ${m.home.name} ${s[0]}-${s[1]} ${m.away.name}`, `${home ? m.home.name : m.away.name} scored${Number.isFinite(m.minute) && m.status === 'LIVE' ? ` · ${m.minute}'` : ''}`);
      }
      if (prev.s !== 'FINISHED' && m.status === 'FINISHED') mk('fulltime', 0, `Full time · ${m.home.name} ${scoreTxt} ${m.away.name}`, lg);
    }
    cur.gh = s ? s[0] : 0;
    if (m.status === 'FINISHED' && p?.settled && !p.void && typeof p.best?.correct === 'boolean' && !cur.res && t > T - 8 * 3600000) {
      cur.res = 1;
      mk('result', 0, `${p.best.correct ? '✅ Pick won' : '❌ Pick lost'} · ${p.best.label}`, `${m.home.name} ${scoreTxt} ${m.away.name}${p.late ? ' (live pick)' : ''}`);
    }
    st[m.id] = cur;
  }
  for (const id of Object.keys(st)) { const m = d.matches[id]; if (!m || new Date(m.date).getTime() < T - 3 * 86400000) delete st[id]; }
  const known = new Set(d.notifications.map((e) => e.id));
  const fresh = out.filter((e) => !known.has(e.id));
  if (fresh.length) { d.notifications.unshift(...fresh.reverse()); d.notifications.length = Math.min(d.notifications.length, MAX_EVENTS); }
  dbm.save();
  return fresh;
}

/** Does this device want this event? prefs = the device's saved preferences. */
function wants(ev, prefs) {
  const n = prefs?.notify;
  if (!n?.on || !n.types?.[ev.type]) return false;
  if (n.scope === 'all') return true;
  return (prefs.favTeams || []).some((id) => String(id) === ev.homeId || String(id) === ev.awayId) || (prefs.favLeagues || []).includes(ev.leagueCode);
}

/* ---------------------------------------------------------------------------------------------------------- VAPID --- */

function keyObject(jwk) { return crypto.createPrivateKey({ key: jwk, format: 'jwk' }); }

function fromEnv() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const raw = Buffer.from(pub, 'base64url');
  return { pub, jwk: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: priv } };
}

/** Public key for browsers. create=false never writes (web requests on Vercel must not change the main data). */
function vapidPublic({ create = false } = {}) {
  const e = fromEnv(); if (e) return e.pub;
  const d = dbm.data();
  if (!d.meta.vapid && create) ensureVapid();
  return d.meta.vapid?.pub || null;
}

function ensureVapid() {
  const e = fromEnv(); if (e) return e;
  const d = dbm.data();
  if (!d.meta.vapid) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pj = publicKey.export({ format: 'jwk' });
    d.meta.vapid = { pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, 'base64url'), Buffer.from(pj.y, 'base64url')])), jwk: privateKey.export({ format: 'jwk' }) };
    dbm.save();
  }
  return d.meta.vapid;
}

const subject = () => process.env.VAPID_SUBJECT || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://example.com');

function vapidHeader(endpoint) {
  const v = ensureVapid();
  const h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const c = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject() }));
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${c}`), { key: keyObject(v.jwk), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${v.pub}`;
}

/* ------------------------------------------------------------------------------------------------------ Web Push --- */

// Only real push services are allowed: the server posts to whatever address a device registers.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

function validSubscription(s) {
  try {
    if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 600) return false;
    const u = new URL(s.endpoint);
    if (u.protocol !== 'https:' && !(process.env.PUSH_ALLOW_ANY === '1')) return false;
    if (!PUSH_HOSTS.test(u.hostname) && process.env.PUSH_ALLOW_ANY !== '1') return false;
    const p = Buffer.from(String(s.keys?.p256dh || ''), 'base64url'), a = Buffer.from(String(s.keys?.auth || ''), 'base64url');
    return p.length === 65 && p[0] === 4 && a.length >= 16 && a.length <= 32;
  } catch { return false; }
}

/** RFC 8291 aes128gcm body for one subscription. */
function encrypt(sub, payload) {
  const uaPub = Buffer.from(sub.keys.p256dh, 'base64url'), auth = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, asPub, body]);
}

async function sendOne(sub, message) {
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', body: encrypt(sub, JSON.stringify(message)), signal: AbortSignal.timeout(8000),
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: message.type === 'goal' ? 'high' : 'normal', Authorization: vapidHeader(sub.endpoint) },
    });
    return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410 };
  } catch (e) { return { ok: false, status: 0, gone: false, error: e.message }; }
}

const messageFor = (ev) => ({ title: ev.title, body: ev.body || '', url: `/#/match/${ev.matchId}`, tag: ev.id, type: ev.type });

/** Send events to every device that wants them. Returns the number of messages delivered. */
async function deliver(events, { deadline = Infinity } = {}) {
  if (!events.length) return 0;
  const subs = await dbm.push.all().catch(() => []);
  const jobs = [];
  for (const s of subs) for (const ev of events) if (wants(ev, s.prefs)) jobs.push({ s, ev });
  let sent = 0, i = 0; const gone = new Set();
  async function worker() {
    while (i < jobs.length && Date.now() < deadline - 3000) {
      const { s, ev } = jobs[i++];
      if (gone.has(s.id)) continue;
      const r = await sendOne(s.sub, messageFor(ev));
      if (r.ok) sent++; else if (r.gone) gone.add(s.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, worker));
  for (const id of gone) await dbm.push.del(id).catch(() => {});
  return sent;
}

module.exports = { scan, wants, deliver, sendOne, messageFor, encrypt, validSubscription, vapidPublic, ensureVapid, TYPES };
