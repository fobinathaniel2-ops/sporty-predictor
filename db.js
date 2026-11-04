'use strict';
/**
 * Small JSON-file database (no native modules, so it installs on Termux).
 *  db.json     football data: leagues, teams, matches, predictions, statistics, logs
 *  cache.json  API response cache with TTL (standings, scorers, match details, news, AI analysis)
 *  prefs.json  per-device user preferences
 * Writes are debounced and atomic (temp file + rename).
 *
 * Hosted mode (Vercel): when KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair) are set, the same data lives in
 * Upstash Redis instead, as gzip+base64 shards. Serverless functions have no durable disk, so every request first calls hydrate().
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const VERSION = 5;

const empty = () => ({ version: VERSION, meta: {}, leagues: {}, teams: {}, matches: {}, statistics: {}, predictions: {}, apiLogs: [] });

function makeStore(file, blank, delay) {
  const s = { file: path.join(DIR, file), data: blank(), timer: null, dirty: false };
  s.flush = () => {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (!s.dirty || remoteOn()) return;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = s.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(s.data));
      fs.renameSync(tmp, s.file);
      s.dirty = false;
    } catch (e) { console.error(`DB save failed (${file}):`, e.message); }
  };
  s.save = () => { s.dirty = true; if (remoteOn()) return; if (!s.timer) { s.timer = setTimeout(s.flush, delay); s.timer.unref?.(); } };
  s.load = () => {
    try { s.data = { ...blank(), ...JSON.parse(fs.readFileSync(s.file, 'utf8')) }; } catch { s.data = blank(); }
  };
  return s;
}

const main = makeStore('db.json', empty, 600);
const cacheStore = makeStore('cache.json', () => ({ entries: {} }), 2500);
const prefStore = makeStore('prefs.json', () => ({ clients: {}, push: {} }), 800);

let loaded = false;
function load() {
  if (remoteOn()) return main.data; // hosted mode loads through hydrate()
  if (loaded) return main.data;
  loaded = true;
  fs.mkdirSync(DIR, { recursive: true });
  main.load(); cacheStore.load(); prefStore.load();
  if (main.data.version !== VERSION) { // older picks used another format: keep the football data, restart the predictions
    main.data.predictions = {}; main.data.version = VERSION; main.save();
  }
  return main.data;
}


/* ===================================================================================== hosted mode (Upstash Redis) ==== */

const REST_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const remoteOn = () => !!(REST_URL() && REST_TOKEN() && process.env.STORAGE !== 'file');
const mode = () => (remoteOn() ? 'remote' : 'file');

async function redis(args, path = '') {
  const r = await fetch(REST_URL().replace(/\/$/, '') + path, { method: 'POST', headers: { authorization: `Bearer ${REST_TOKEN()}`, 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  let j; try { j = await r.json(); } catch { j = {}; }
  if (!r.ok || j.error) throw new Error(`Storage error: ${j.error || 'HTTP ' + r.status}`);
  return j.result;
}
const enc = (o) => zlib.gzipSync(JSON.stringify(o), { level: 6 }).toString('base64');
const dec = (s) => JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString());
const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h; };
const M_BUCKETS = 6, P_BUCKETS = 10;
const KEYS = ['sp:core', ...Array.from({ length: M_BUCKETS }, (_, i) => `sp:m${i}`), ...Array.from({ length: P_BUCKETS }, (_, i) => `sp:p${i}`), 'sp:cache', 'sp:live'];

const R = { at: 0, saved: {}, cacheDirty: false, live: null };

/** Pull the whole database (one Redis command). maxAge: reuse what this warm instance already holds if it is recent enough. */
async function hydrate({ maxAge = 20000 } = {}) {
  if (!remoteOn()) { load(); return main.data; }
  if (R.at && Date.now() - R.at < maxAge) return main.data;
  const vals = await redis(['MGET', ...KEYS]);
  const get = (k) => { const v = vals[KEYS.indexOf(k)]; if (!v) return null; R.saved[k] = v; try { return dec(v); } catch { return null; } };
  const core = get('sp:core') || {};
  const db = { ...empty(), ...core, matches: {}, predictions: {} };
  for (let i = 0; i < M_BUCKETS; i++) Object.assign(db.matches, get(`sp:m${i}`) || {});
  for (let i = 0; i < P_BUCKETS; i++) Object.assign(db.predictions, get(`sp:p${i}`) || {});
  if (db.version !== VERSION) { db.predictions = {}; db.version = VERSION; }
  main.data = db; main.dirty = false;
  cacheStore.data = { entries: (get('sp:cache') || {}).entries || {} }; R.cacheDirty = false;
  R.live = get('sp:live');
  R.at = Date.now(); loaded = true;
  return main.data;
}

/** Write what changed. main=false is used by web requests: they hold a slightly old copy and must never overwrite the pipeline's data. */
async function flushAsync({ main: writeMain = true } = {}) {
  if (!remoteOn()) { flush(); return; }
  const jobs = [];
  const put = (k, obj) => { const v = enc(obj); if (R.saved[k] !== v) { if (v.length > 900000) console.error(`[warn] storage shard ${k} is ${(v.length / 1e6).toFixed(2)}MB, close to the 1MB request limit`); jobs.push(redis(['SET', k, v]).then(() => { R.saved[k] = v; })); } };
  if (writeMain && main.dirty) {
    const d = main.data;
    const { matches, predictions, ...core } = d;
    put('sp:core', core);
    const mb = Array.from({ length: M_BUCKETS }, () => ({})), pb = Array.from({ length: P_BUCKETS }, () => ({}));
    for (const [id, m] of Object.entries(matches)) mb[hash(id) % M_BUCKETS][id] = m;
    for (const [id, p] of Object.entries(predictions)) pb[hash(id) % P_BUCKETS][id] = p;
    mb.forEach((o, i) => put(`sp:m${i}`, o)); pb.forEach((o, i) => put(`sp:p${i}`, o));
    main.dirty = false;
  }
  if (R.cacheDirty) { put('sp:cache', cacheStore.data); R.cacheDirty = false; }
  await Promise.all(jobs);
}

/** Live-score overlay: a small separate record that web requests may write without touching the main data. */
const overlay = {
  get: () => R.live,
  async set(o) { R.live = o; if (remoteOn()) { const v = enc(o); await redis(['SET', 'sp:live', v]); R.saved['sp:live'] = v; } },
  /** Apply scores newer than the last full refresh of that competition. */
  apply() {
    const o = R.live; if (!o?.matches) return 0; let n = 0;
    const d = main.data;
    for (const m of Object.values(o.matches)) {
      const full = d.meta.lastDataRefresh?.[m.league];
      if (full && new Date(full) > new Date(o.at)) continue;
      d.matches[m.id] = { ...(d.matches[m.id] || {}), ...m }; n++;
    }
    return n;
  },
  async lock(seconds) { return (await redis(['SET', 'sp:livelock', '1', 'NX', 'EX', String(seconds)])) === 'OK'; },
};

const data = () => main.data;
const save = () => main.save();
const flush = () => { main.flush(); cacheStore.flush(); prefStore.flush(); };

function log(level, source, message) {
  const d = main.data;
  d.apiLogs.unshift({ at: new Date().toISOString(), level, source, message: String(message).slice(0, 300) });
  if (d.apiLogs.length > 200) d.apiLogs.length = 200;
  if (level !== 'info') console.log(`[${level}] ${source}: ${message}`);
  save();
}

/** TTL cache. getStale returns expired values too (used as a fallback when the source fails). */
const cache = {
  get(key) { const e = cacheStore.data.entries[key]; return e && Date.now() - e.at < e.ttl ? e.v : undefined; },
  getStale(key) { return cacheStore.data.entries[key]?.v; },
  age(key) { const e = cacheStore.data.entries[key]; return e ? Date.now() - e.at : null; },
  set(key, v, ttlMs) {
    const en = cacheStore.data.entries;
    en[key] = { at: Date.now(), ttl: ttlMs, v };
    const keys = Object.keys(en);
    if (keys.length > 1500) { // drop the oldest entries
      keys.sort((a, b) => en[a].at - en[b].at).slice(0, keys.length - 1200).forEach((k) => delete en[k]);
    }
    cacheStore.save(); R.cacheDirty = true;
  },
};

/** Per-device preferences, keyed by a random id generated in the browser. */
const prefs = {
  async get(id) {
    if (remoteOn()) { try { const v = await redis(['GET', `sp:pref:${id}`]); return v ? JSON.parse(v) : null; } catch { return null; } }
    return prefStore.data.clients[id] || null;
  },
  async set(id, value) {
    const rec = { ...value, updatedAt: new Date().toISOString() };
    if (remoteOn()) { await redis(['SET', `sp:pref:${id}`, JSON.stringify(rec), 'EX', String(400 * 86400)]); return; }
    const c = prefStore.data.clients;
    c[id] = rec;
    const ids = Object.keys(c);
    if (ids.length > 5000) ids.sort((a, b) => (c[a].updatedAt < c[b].updatedAt ? -1 : 1)).slice(0, ids.length - 4500).forEach((k) => delete c[k]);
    prefStore.save();
  },
};

/** Devices that switched on push alerts: id -> { sub, prefs, at }. One Redis hash when hosted. */
const push = {
  async get(id) {
    if (remoteOn()) { const v = await redis(['HGET', 'sp:push', id]); return v ? JSON.parse(v) : null; }
    return (prefStore.data.push || {})[id] || null;
  },
  async set(id, rec) {
    if (remoteOn()) { await redis(['HSET', 'sp:push', id, JSON.stringify(rec)]); return; }
    (prefStore.data.push = prefStore.data.push || {})[id] = rec; prefStore.save();
  },
  async del(id) {
    if (remoteOn()) { await redis(['HDEL', 'sp:push', id]); return; }
    if (prefStore.data.push) delete prefStore.data.push[id]; prefStore.save();
  },
  async all() {
    if (remoteOn()) {
      const flat = (await redis(['HGETALL', 'sp:push'])) || []; const out = [];
      for (let i = 0; i < flat.length; i += 2) { try { out.push({ id: flat[i], ...JSON.parse(flat[i + 1]) }); } catch { /* skip */ } }
      return out;
    }
    return Object.entries(prefStore.data.push || {}).map(([id, r]) => ({ id, ...r }));
  },
};

process.on('exit', flush);
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => process.exit(0)));

module.exports = { load, save, flush, flushAsync, hydrate, mode, overlay, data, log, cache, prefs, push, DIR, VERSION };
