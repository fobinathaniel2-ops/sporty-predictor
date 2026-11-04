'use strict';
// Hosted-mode test: a fake Upstash Redis REST server, then the cron steps and the web API against it.
const http = require('http'); const assert = require('assert');
const store = new Map(); let commands = 0;
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.headers.authorization !== 'Bearer tok') { res.writeHead(401); return res.end('{"error":"bad token"}'); }
    const a = JSON.parse(b); commands++; let r = null;
    if (a[0] === 'SET') { if (a.includes('NX') && store.has(a[1])) r = null; else { store.set(a[1], a[2]); r = 'OK'; } }
    else if (a[0] === 'GET') r = store.get(a[1]) ?? null;
    else if (a[0] === 'HSET') { const h = store.get(a[1]) || {}; h[a[2]] = a[3]; store.set(a[1], h); r = 1; }
    else if (a[0] === 'HGET') r = (store.get(a[1]) || {})[a[2]] ?? null;
    else if (a[0] === 'HDEL') { const h = store.get(a[1]) || {}; delete h[a[2]]; r = 1; }
    else if (a[0] === 'HGETALL') r = Object.entries(store.get(a[1]) || {}).flat();
    else if (a[0] === 'MGET') r = a.slice(1).map((k) => store.get(k) ?? null);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result: r }));
  });
});
fake.listen(0, async () => {
  process.env.KV_REST_API_URL = `http://127.0.0.1:${fake.address().port}`; process.env.KV_REST_API_TOKEN = 'tok';
  process.env.DEMO_MODE = '1'; process.env.CRON_SECRET = 'sekret-123'; process.env.DATA_DIR = '/tmp/sp-hosted-nodisk';
  delete process.env.GEMINI_API_KEY; process.env.AI_SEARCH = '0';
  const dbm = require('./db'); const { server } = require('./server');
  assert.strictEqual(dbm.mode(), 'remote');
  await new Promise((r) => server.listen(0, r)); const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, h = {}) => { const r = await fetch(base + p, { headers: h }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const auth = { authorization: 'Bearer sekret-123' };

  assert.strictEqual((await get('/api/cron?step=data')).status, 401, 'cron needs the secret');
  assert.strictEqual((await get('/api/cron?step=data', { authorization: 'Bearer wrong-secret' })).status, 401);
  let r, n = 0;
  do { r = await get('/api/cron?step=data', auth); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); n++; } while (!r.body.done && n < 20);
  assert(r.body.done, 'data step finishes');
  assert(store.has('sp:core') && [...store.keys()].some((k) => k.startsWith('sp:m')) && [...store.keys()].some((k) => k.startsWith('sp:p')), 'data was saved to Redis shards');
  for (const k of store.keys()) assert(store.get(k).length < 900000, k + ' stays under the request limit');
  assert((await get('/api/cron?step=live', auth)).body.done, 'live step');
  assert((await get('/api/cron?step=ai', auth)).status === 200 && (await get('/api/cron?step=web', auth)).status === 200, 'ai/web steps run (no key: skipped)');

  // a "new" serverless instance: forget everything in memory, read it back from Redis
  const before = Object.keys(dbm.data().matches).length, pBefore = Object.keys(dbm.data().predictions).length;
  assert(before > 50 && pBefore > 10, `have data (${before} matches, ${pBefore} picks)`);
  const d = dbm.data(); for (const k of Object.keys(d.matches)) delete d.matches[k]; for (const k of Object.keys(d.predictions)) delete d.predictions[k];
  await dbm.hydrate({ maxAge: 0 });
  assert.strictEqual(Object.keys(dbm.data().matches).length, before, 'matches restored from Redis');
  assert.strictEqual(Object.keys(dbm.data().predictions).length, pBefore, 'predictions restored from Redis');

  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 7 * 86400000).toISOString();
  const fx = await get(`/api/fixtures?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); assert(fx.status === 200 && fx.body.length > 5, 'fixtures from hosted data');
  assert((await get(`/api/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status === 200 && (await get('/api/leagues')).status === 200 && (await get('/api/accuracy')).status === 200);
  const lg = (await get('/api/leagues')).body[0].code;
  assert((await get(`/api/league/${lg}`)).status === 200, 'league page');
  assert((await get('/api/status')).body.configured === true);
  // original path carried in ?__p= (how Vercel rewrites to one function)
  assert((await get('/api/index?__p=leagues')).status === 200, '__p path rewrite');

  // preferences live in Redis, per device
  const id = 'a'.repeat(32);
  const put = await fetch(base + '/api/prefs', { method: 'PUT', headers: { 'x-client-id': id, 'content-type': 'application/json' }, body: JSON.stringify({ favLeagues: ['PL'], dataSaver: true }) });
  assert.strictEqual(put.status, 200);
  assert.deepStrictEqual((await get('/api/prefs', { 'x-client-id': id })).body.favLeagues, ['PL']);
  assert(store.has(`sp:pref:${id}`), 'prefs stored in Redis');

  // a web request must never overwrite the pipeline's data
  const snap = new Map(store); await get('/api/leagues'); await get('/api/accuracy');
  for (const k of ['sp:core', 'sp:m0', 'sp:p0']) assert.strictEqual(store.get(k), snap.get(k), k + ' untouched by web requests');
  await dbm.push.set('devA', { sub: { endpoint: 'https://fcm.googleapis.com/x' }, prefs: { notify: { on: true } } });
  assert.deepStrictEqual((await dbm.push.all()).map((x) => x.id), ['devA'], 'push devices stored in a Redis hash');
  await dbm.push.del('devA'); assert.strictEqual((await dbm.push.all()).length, 0);
  const ntf = await get('/api/notifications'); assert(ntf.status === 200 && Array.isArray(ntf.body.events));
  const step = await get('/api/cron?step=live', auth); assert(step.body.done && 'events' in step.body, 'live step reports events: ' + JSON.stringify(step.body));
  console.log(`OK hosted mode (${commands} Redis commands, ${store.size} keys, ${before} matches, ${pBefore} picks)`);
  server.close(); fake.close(); process.exit(0);
});
