'use strict';
// Notifications: events, filters, Web Push encryption (decrypted the way a browser would), delivery, routes.
process.env.DATA_DIR = '/tmp/sp-notify-test-' + process.pid; process.env.PUSH_ALLOW_ANY = '1'; process.env.DEMO_MODE = '1';
const assert = require('assert'); const crypto = require('crypto'); const http = require('http');
const dbm = require('./db'); dbm.load();
const notify = require('./notify');

// a "browser": subscription keys
function browser() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint: '', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } };
}
function decrypt(b, body) { // RFC 8291
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const uaPub = b.ecdh.getPublicKey(); const secret = b.ecdh.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, b.auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce); dec.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]);
  assert.strictEqual(plain[plain.length - 1], 2, 'padding delimiter');
  return plain.subarray(0, plain.length - 1).toString();
}

(async () => {
  // 1. encryption + VAPID signature
  const b = browser();
  assert.strictEqual(decrypt(b, notify.encrypt(b.sub, '{"title":"héllo ⚽"}')), '{"title":"héllo ⚽"}', 'payload round-trips');
  const pushes = []; let status = 201;
  const push = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { pushes.push({ url: req.url, headers: req.headers, body: Buffer.concat(ch) }); res.writeHead(req.url.includes('gone') ? 410 : status); res.end(); }); });
  await new Promise((r) => push.listen(0, r)); const ep = `http://127.0.0.1:${push.address().port}`;
  b.sub.endpoint = ep + '/ok';
  const r1 = await notify.sendOne(b.sub, { title: 'T', body: 'B', type: 'goal' });
  assert(r1.ok && pushes.length === 1);
  const h = pushes[0].headers; assert.strictEqual(h['content-encoding'], 'aes128gcm'); assert.strictEqual(h.ttl, '3600');
  const m = h.authorization.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/); assert(m, 'VAPID header format');
  const pub = Buffer.from(m[4], 'base64url'); assert.strictEqual(pub.length, 65);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'VAPID signature verifies');
  const claims = JSON.parse(Buffer.from(m[2], 'base64url')); assert.strictEqual(claims.aud, ep); assert(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
  assert.deepStrictEqual(JSON.parse(decrypt(b, pushes[0].body)), { title: 'T', body: 'B', type: 'goal' });
  assert.strictEqual(notify.vapidPublic(), m[4], 'public key matches');

  // 2. subscription validation (only real push services; no server-side requests to arbitrary hosts)
  process.env.PUSH_ALLOW_ANY = '0';
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: b.sub.keys };
  assert(notify.validSubscription(good));
  for (const bad of [{ ...good, endpoint: 'http://fcm.googleapis.com/x' }, { ...good, endpoint: 'https://evil.example.com/x' }, { ...good, endpoint: 'https://169.254.169.254/latest' }, { ...good, endpoint: 'https://fcm.googleapis.com.evil.com/x' }, { ...good, keys: { p256dh: 'AAAA', auth: good.keys.auth } }, null]) assert(!notify.validSubscription(bad), JSON.stringify(bad));
  process.env.PUSH_ALLOW_ANY = '1';

  // 3. events
  const d = dbm.data(); const now = new Date('2026-03-01T15:00:00Z');
  d.leagues.PL = { code: 'PL', name: 'English Premier League' };
  const mk = (id, mins, status, extra = {}) => ({ id, league: 'PL', date: new Date(+now + mins * 60000).toISOString(), status, home: { id: 'h' + id, name: 'Home' + id }, away: { id: 'a' + id, name: 'Away' + id }, ft: null, ht: null, ...extra });
  d.matches = { 1: mk(1, 20, 'SCHEDULED'), 2: mk(2, -2, 'SCHEDULED'), 3: mk(3, -50, 'LIVE', { live: [0, 0], minute: 48 }), 4: mk(4, -100, 'LIVE', { live: [1, 1], minute: 90 }), 5: mk(5, 300, 'SCHEDULED') };
  d.predictions = { 1: { matchId: 1, best: { label: 'Over 2.5', p: 0.71 } } };
  let ev = notify.scan(now);
  assert.deepStrictEqual(ev.map((e) => e.type), ['soon'], 'first scan: only the reminder, no flood for matches already in play');
  assert(ev[0].body.includes('Over 2.5 · 71%'), 'reminder carries the pick');
  assert.strictEqual(notify.scan(now).length, 0, 'no duplicates');
  d.matches[2].status = 'LIVE'; d.matches[2].live = [0, 0];
  d.matches[3].live = [1, 0]; d.matches[3].minute = 52;
  d.matches[4].status = 'FINISHED'; d.matches[4].ft = [1, 1];
  ev = notify.scan(new Date(+now + 60000));
  const types = ev.map((e) => e.type).sort(); assert.deepStrictEqual(types, ['fulltime', 'goal', 'kickoff'], types.join());
  const goal = ev.find((e) => e.type === 'goal'); assert(goal.title.includes('Home3 1-0 Away3') && goal.body.includes('Home3 scored') && goal.body.includes("52'"));
  d.matches[3].live = [1, 1]; ev = notify.scan(new Date(+now + 120000));
  assert(ev.length === 1 && ev[0].body.startsWith('Away3 scored'), 'away goal');
  d.matches[4].status = 'FINISHED'; d.predictions[4] = { matchId: 4, settled: true, best: { label: 'Draw (X)', correct: true, p: 0.3 }, actual: {} };
  ev = notify.scan(new Date(+now + 180000)); assert(ev.length === 1 && ev[0].type === 'result' && ev[0].title.startsWith('✅'), 'result event');
  assert.strictEqual(d.notifications.length, 6); assert(d.notifications[0].at >= d.notifications[5].at, 'newest first');

  // 4. who gets what
  const E = (type) => ({ type, homeId: 'h1', awayId: 'a1', leagueCode: 'PL' });
  const P = (n, extra = {}) => ({ favTeams: [], favLeagues: [], notify: { on: true, scope: 'favourites', types: { goal: true, kickoff: true, fulltime: false, result: true, soon: true }, ...n }, ...extra });
  assert(!notify.wants(E('goal'), P({})), 'no favourites: nothing');
  assert(notify.wants(E('goal'), P({}, { favTeams: ['h1'] })) && notify.wants(E('goal'), P({}, { favTeams: [1, 'a1'] })), 'favourite team');
  assert(notify.wants(E('goal'), P({}, { favLeagues: ['PL'] })) && !notify.wants(E('goal'), P({}, { favLeagues: ['PD'] })), 'favourite league');
  assert(!notify.wants(E('fulltime'), P({}, { favTeams: ['h1'] })), 'type switched off');
  assert(notify.wants(E('goal'), P({ scope: 'all' })) && !notify.wants(E('goal'), P({ on: false, scope: 'all' })), 'scope all / switched off');

  // 5. delivery: one wanted, one not wanted, one expired device
  const b2 = browser(), b3 = browser(), b4 = browser();
  await dbm.push.set('dev1', { sub: { ...b2.sub, endpoint: ep + '/d1' }, prefs: P({}, { favTeams: ['h1'] }) });
  await dbm.push.set('dev2', { sub: { ...b3.sub, endpoint: ep + '/d2' }, prefs: P({}, { favTeams: ['zzz'] }) });
  await dbm.push.set('dev3', { sub: { ...b4.sub, endpoint: ep + '/gone' }, prefs: P({ scope: 'all' }) });
  pushes.length = 0;
  const sent = await notify.deliver([{ id: 'x:goal:1', type: 'goal', homeId: 'h1', awayId: 'a1', leagueCode: 'PL', title: '⚽ Test', body: 'scored', matchId: 7 }]);
  assert.strictEqual(sent, 1, 'delivered to the one matching device');
  assert(pushes.some((p) => p.url === '/d1') && !pushes.some((p) => p.url === '/d2'));
  const msg = JSON.parse(decrypt(b2, pushes.find((p) => p.url === '/d1').body)); assert.deepStrictEqual(msg, { title: '⚽ Test', body: 'scored', url: '/#/match/7', tag: 'x:goal:1', type: 'goal' });
  assert((await dbm.push.all()).map((x) => x.id).sort().join() === 'dev1,dev2', 'expired device (410) removed');

  // 6. HTTP routes
  const { server } = require('./server'); await new Promise((r) => server.listen(0, r)); const base = `http://127.0.0.1:${server.address().port}`;
  const id = 'b'.repeat(32); const H = { 'x-client-id': id, 'content-type': 'application/json' };
  const api = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { ...H, ...(o.headers || {}) } }); return { status: r.status, body: await r.json() }; };
  assert((await api('/api/push/key')).body.key === m[4]);
  let r = await api('/api/prefs', { method: 'PUT', body: JSON.stringify({ favTeams: ['9'], notify: { on: true, scope: 'bogus', types: { goal: false } } }) });
  assert.deepStrictEqual(r.body.notify, { on: true, scope: 'favourites', types: { goal: false, kickoff: true, fulltime: true, result: true, soon: true } }, 'prefs sanitised');
  process.env.PUSH_ALLOW_ANY = '0';
  assert.strictEqual((await api('/api/push', { method: 'PUT', body: JSON.stringify({ subscription: { endpoint: 'https://evil.example.com/x', keys: good.keys } }) })).status, 400, 'bad endpoint refused');
  process.env.PUSH_ALLOW_ANY = '1';
  b.sub.endpoint = ep + '/mine';
  assert.strictEqual((await api('/api/push', { method: 'PUT', body: JSON.stringify({ subscription: b.sub }) })).status, 200);
  assert.deepStrictEqual((await dbm.push.get(id)).prefs.favTeams, ['9'], 'subscription carries the saved favourites');
  await api('/api/prefs', { method: 'PUT', body: JSON.stringify({ favTeams: ['9', '10'], notify: { on: true } }) });
  assert.deepStrictEqual((await dbm.push.get(id)).prefs.favTeams, ['9', '10'], 'saved favourites follow the subscription');
  pushes.length = 0; r = await api('/api/push/test', { method: 'PUT', body: '{}' }); assert(r.body.ok && pushes.length === 1 && JSON.parse(decrypt(b, pushes[0].body)).title.startsWith('Alerts are on'), 'test notification');
  assert((await api('/api/notifications')).body.events.length === 6, 'events listed');
  assert.strictEqual((await api(`/api/notifications?since=${encodeURIComponent(new Date(+now + 100000).toISOString())}`)).body.events.length, 2, 'only events after `since`');
  await api('/api/push', { method: 'PUT', body: JSON.stringify({ subscription: null }) }); assert.strictEqual(await dbm.push.get(id), null, 'unsubscribe');
  assert.strictEqual((await api('/api/push/test', { method: 'PUT', body: '{}' })).status, 404);
  console.log('OK notifications'); server.close(); push.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
