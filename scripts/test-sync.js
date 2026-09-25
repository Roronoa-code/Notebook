// Starts the real phone sync server against a temporary library and plays the part of the phone:
// pairing, a sync round trip, uploading and downloading media, discovery and the safety checks.
// Usage: node scripts/test-sync.js
const fs = require('fs');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const assert = require('assert/strict');
const { Library } = require('../main/library');
const { SyncServer, isPrivateAddress, candidateAddresses, CODE_ALPHABET } = require('../main/sync-server');

const ROOT = path.resolve(__dirname, '..', 'test-output', 'sync-test');
const HOST = '127.0.0.1';
const BASE_PORT = 47921, DISCOVERY_PORT = 47932; // away from the real app's ports
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'fake'), { recursive: true });
  const pcPhoto = crypto.randomBytes(20000);
  fs.writeFileSync(path.join(ROOT, 'fake', 'pc photo.jpg'), pcPhoto);
  fs.writeFileSync(path.join(ROOT, 'fake', 'doomed.jpg'), crypto.randomBytes(3000));
  const lib = await Library.openOrCreate(path.join(ROOT, 'Notebook Library'));
  const [pId, tId] = (await lib.importFiles(['pc photo.jpg', 'doomed.jpg'].map((n) => path.join(ROOT, 'fake', n)))).added;
  const noteId = await lib.addNote();

  // ---------- address check (unit test) ----------
  for (const a of ['127.0.0.1', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.3.4', '::ffff:192.168.0.9']) assert.ok(isPrivateAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '100.64.0.1', '::ffff:1.1.1.1', '2001:db8::1', 'fe80::1', '', undefined, '999.1.1.1']) assert.ok(!isPrivateAddress(a), String(a));
  ok('only loopback and private addresses are accepted');
  const ips = candidateAddresses({
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.80.1', internal: false }],
    'VirtualBox Host-Only Network': [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    Tailscale: [{ family: 'IPv4', address: '100.101.1.2', internal: false }],
    Ethernet: [{ family: 'IPv4', address: '10.0.0.5', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }]
  });
  assert.deepEqual(ips, ['192.168.1.20', '10.0.0.5']);
  ok('pairing addresses: Wi-Fi first, then Ethernet; WSL, VirtualBox and VPN adapters left out');

  // ---------- start: the first port is busy, so it moves to the next ----------
  const blocker = net.createServer().listen(BASE_PORT, HOST);
  await new Promise((r) => blocker.once('listening', r));
  const events = { lib: [], status: 0, keepReady: [], logs: [] };
  const settingsFile = path.join(ROOT, 'userdata', 'sync.json');
  const server = new SyncServer({
    settingsFile, host: HOST, port: BASE_PORT, discoveryPort: DISCOVERY_PORT, pcName: 'Test PC',
    onLibraryChanged: (e) => events.lib.push(e), onPhoneLog: (t) => events.logs.push(t), onStatusChanged: () => events.status++, onKeepReady: (on) => events.keepReady.push(on),
    log: { error: () => {} }
  });
  await server.start(lib);
  assert.equal(server.port, BASE_PORT + 1);
  const base = `http://${HOST}:${server.port}`;
  ok(`port ${BASE_PORT} was busy, so the server started on ${server.port}`);

  const api = async (method, route, { token, json, body, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    if (json !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + route, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };

  let r = await api('GET', '/api/ping');
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'not paired' });
  r = await api('GET', '/api/ping', { token: 'a'.repeat(64) });
  assert.equal(r.status, 401);
  ok('ping without a token (or with a made-up one) gets 401 "not paired"');

  // ---------- pairing ----------
  const code = server.newCode();
  assert.equal(code.length, 8);
  assert.ok([...code].every((c) => CODE_ALPHABET.includes(c)));
  const st = await server.status();
  assert.match(st.pairUrl, new RegExp(`^notebook://pair\\?h=[0-9.,]*&p=${server.port}&c=${code}&id=${server.pcId}$`));
  assert.match(st.qr, /^data:image\/png;base64,/);
  ok('pairing code is 8 characters from the alphabet; QR text follows the spec');

  r = await api('POST', '/api/pair', { json: { code: code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA', deviceId: 'phone-1', deviceName: 'Galaxy S25 Ultra' } });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'That pairing code is wrong or has expired. Show a new one on the PC.' });
  ok('a wrong code gets 403 with the plain-English message');

  r = await api('POST', '/api/pair', { json: { code, deviceId: 'phone-1', deviceName: 'Galaxy S25 Ultra' } });
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^[0-9a-f]{64}$/);
  assert.equal(r.body.pcId, server.pcId);
  assert.equal(r.body.pcName, 'Test PC');
  const token = r.body.token;
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(saved.devices[0].tokenSha256, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(saved).includes(token), 'the token itself is never stored');
  assert.equal(saved.keepReady, true);
  assert.deepEqual(events.keepReady, [true]);
  assert.ok(!fs.readFileSync(path.join(lib.root, 'library.json'), 'utf8').includes('phone-1'), 'paired phones are not in the library');
  r = await api('POST', '/api/pair', { json: { code, deviceId: 'phone-2', deviceName: 'Other' } });
  assert.equal(r.status, 403);
  ok('pairing works, stores only a SHA-256 of the token, switches on "keep ready", and the code can\'t be reused');

  r = await api('GET', '/api/ping', { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, pcId: server.pcId, pcName: 'Test PC', items: 3 });
  ok('ping with the token answers with the PC name and item count');

  // ---------- sync round trip ----------
  const phoneBytes = crypto.randomBytes(12345);
  const qId = crypto.randomUUID();
  const phoneNote = { ...JSON.parse(JSON.stringify(lib.item(noteId))), html: 'phone copy', title: 'phone copy', updatedAt: iso(-60000) };
  await lib.updateItem(noteId, { html: 'Changed on the PC', title: 'Changed on the PC' }); // the PC-side change is newer
  const phone = {
    deviceId: 'phone-1',
    boards: lib.data.boards.map((b) => ({ ...b })),
    items: [phoneNote, { id: qId, kind: 'photo', title: 'From my phone', file: `media/${qId}.jpg`, thumb: `thumbs/${qId}.jpg`, w: 1080, h: 1920, originalName: 'IMG_2.jpg',
      size: phoneBytes.length, importedAt: iso(), updatedAt: iso(), boards: [lib.data.boards[0].id], deletedAt: null }],
    tombstones: { items: [{ id: tId, at: iso() }], boards: [] }
  };
  const doomedFile = path.join(lib.root, lib.item(tId).file);
  r = await api('POST', '/api/sync', { token, json: phone });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pcNeeds, [qId]);
  assert.ok(Date.parse(r.body.serverTime));
  const ids = r.body.items.map((i) => i.id);
  assert.ok(ids.includes(qId) && ids.includes(pId) && ids.includes(noteId) && !ids.includes(tId));
  assert.equal(r.body.items.find((i) => i.id === noteId).html, 'Changed on the PC');
  assert.equal(r.body.items.find((i) => i.id === qId).thumb, null, 'the PC\'s own thumb value is returned');
  assert.deepEqual(r.body.tombstones.items.map((t) => t.id), [tId]);
  assert.ok(!fs.existsSync(doomedFile), 'tombstoned file deleted on the PC');
  assert.equal(lib.item(qId).title, 'From my phone');
  assert.ok(events.lib.length >= 1, 'the window is told the library changed');
  assert.ok(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).devices[0].lastSyncAt);
  ok('sync round trip: new phone item added, newer PC change kept, tombstone removes the item and its file');

  r = await api('POST', '/api/sync', { token, json: { ...phone, items: [{ ...phone.items[1], file: '../../../evil.jpg' }] } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /couldn't read/);
  r = await api('POST', '/api/sync', { token, body: '{ not json', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.ok(lib.data.items.some((i) => i.id === qId));
  ok('a bad sync (unsafe file name, broken JSON) is refused with 400 and changes nothing');

  // ---------- media ----------
  const put = (id, bytes, size) => api('PUT', '/api/media/' + id, { token, body: bytes, headers: { 'X-Notebook-Size': String(size), 'Content-Type': 'application/octet-stream' } });
  r = await put(qId, phoneBytes, phoneBytes.length - 1);
  assert.equal(r.status, 400);
  assert.ok(!fs.existsSync(path.join(lib.root, 'media', qId + '.jpg')));
  r = await put(qId, phoneBytes, phoneBytes.length);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.ok(phoneBytes.equals(fs.readFileSync(path.join(lib.root, 'media', qId + '.jpg'))));
  assert.deepEqual(events.lib.at(-1), { arrived: [qId] });
  r = await put(qId, phoneBytes, phoneBytes.length);
  assert.equal(r.status, 409);
  r = await put(crypto.randomUUID(), phoneBytes, phoneBytes.length);
  assert.equal(r.status, 400);
  r = await api('POST', '/api/sync', { token, json: phone });
  assert.deepEqual(r.body.pcNeeds, []);
  assert.deepEqual(fs.readdirSync(path.join(lib.root, 'media')).filter((f) => f.endsWith('.part')), []);
  ok('upload of an item in pcNeeds: wrong size refused, right size saved, repeats (409) and unknown items (400) refused');

  r = await api('GET', '/api/media/' + pId, { token });
  assert.equal(r.status, 200);
  assert.ok(pcPhoto.equals(r.body));
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('content-length'), String(pcPhoto.length));
  assert.equal(r.headers.get('x-notebook-file'), `media/${pId}.jpg`);
  r = await api('GET', '/api/media/' + tId, { token });
  assert.equal(r.status, 404);
  r = await api('GET', '/api/media/' + pId);
  assert.equal(r.status, 401);
  ok('download streams the file with Content-Type, Content-Length and X-Notebook-File; 404 when missing');

  const nothing = { deviceId: 'phone-1', boards: [], items: [], tombstones: { items: [], boards: [] } };
  await lib.setOnPhone([pId], false);
  r = await api('POST', '/api/sync', { token, json: nothing });
  assert.equal(r.status, 200);
  assert.ok(!r.body.items.some((i) => i.id === pId), 'switched-off item not sent');
  await lib.setOnPhone([pId], true);
  r = await api('POST', '/api/sync', { token, json: nothing });
  assert.ok(r.body.items.some((i) => i.id === pId), 'back on: sent again');
  ok('items switched off for the phone are left out of the sync answer, and come back when switched on');

  // ---------- a board switched off for the phone, then on again: nothing is lost on either side ----------
  // The phone keeps what the PC last sent, and edits it the way the phone app does (it only keeps boards it knows).
  const hid = await lib.addBoard('Only on PC'), shown = await lib.addBoard('Everywhere'), other = await lib.addBoard('Later');
  const fresh = [crypto.randomBytes(4000), crypto.randomBytes(5000)].map((b, i) => { const f = path.join(ROOT, 'fake', `board${i}.jpg`); fs.writeFileSync(f, b); return f; });
  const [onlyHid, both] = (await lib.importFiles(fresh)).added;
  await lib.updateItem(onlyHid, { boards: [hid] });
  await lib.updateItem(both, { boards: [hid, shown] });
  const phoneOf = (answer) => ({ deviceId: 'phone-1', boards: answer.boards, items: answer.items, tombstones: answer.tombstones });
  const phoneEdit = (state, id, changes) => {
    const known = new Set(state.boards.map((b) => b.id));
    const it = state.items.find((i) => i.id === id);
    Object.assign(it, changes, changes.boards ? { boards: changes.boards.filter((b) => known.has(b)) } : {}, { updatedAt: iso(1000) });
  };
  let ph = phoneOf((await api('POST', '/api/sync', { token, json: nothing })).body);
  assert.ok(ph.items.some((i) => i.id === onlyHid) && ph.boards.some((b) => b.id === hid), 'the phone has the board and its things');
  phoneEdit(ph, onlyHid, { title: 'Named on the phone' }); // made on the phone before it heard the board went off
  await lib.setBoardOnPhone(hid, false);
  r = await api('POST', '/api/sync', { token, json: ph });
  assert.equal(r.status, 200);
  assert.ok(!r.body.items.some((i) => i.id === onlyHid) && !r.body.boards.some((b) => b.id === hid), 'the phone lets go of the board and what is only on it');
  assert.equal(lib.item(onlyHid).title, 'Named on the phone', 'the phone\'s edit still reaches the PC');
  assert.ok(fs.existsSync(path.join(lib.root, lib.item(onlyHid).file)), 'its file stays on the PC');
  assert.equal(lib.board(hid).phone, false, 'the board stays off');
  ph = phoneOf(r.body);
  assert.deepEqual(ph.items.find((i) => i.id === both).boards.sort(), [hid, shown].sort());
  phoneEdit(ph, both, { boards: [...ph.items.find((i) => i.id === both).boards, other] }); // added to "Later" on the phone
  r = await api('POST', '/api/sync', { token, json: ph });
  assert.deepEqual(lib.item(both).boards.sort(), [hid, shown, other].sort(), 'a board the phone can\'t see isn\'t taken off by a phone edit');
  ph = phoneOf(r.body);
  await lib.setBoardOnPhone(hid, true);
  r = await api('POST', '/api/sync', { token, json: ph });
  assert.ok(r.body.boards.some((b) => b.id === hid), 'the board comes back');
  const back = r.body.items.find((i) => i.id === onlyHid);
  assert.equal(back && back.title, 'Named on the phone', 'with the phone\'s edit');
  assert.equal((await api('GET', '/api/media/' + onlyHid, { token })).status, 200, 'and its picture');
  assert.ok(lib.data.boards.some((b) => b.id === hid) && !lib.data.tombstones.boards.some((t) => t.id === hid), 'the board was never deleted');
  ok('a board switched off and on again: the phone lets go and gets everything back, its edits kept, hidden boards never taken off');

  // ---------- Ideas for the phone (the real feed, with made-up pins instead of Pinterest) ----------
  const { Feed, FakeSource } = require('../main/feed');
  const saves = [];
  const feed = new Feed({ getLib: () => lib, dir: path.join(ROOT, 'userdata', 'feed'), source: new FakeSource(), embeddings: async () => ({}), embed: async () => null, aiHide: async () => false, log: { error: () => {} } });
  feed.saveIdea = (url, boardId) => { if (!/^https:\/\/www\.pinterest\.com\/pin\/\d+\/$/.test(url)) return false; saves.push([url, boardId]); return true; };
  server.feed = feed;
  r = await api('GET', '/api/feed');
  assert.equal(r.status, 401, 'Ideas need pairing too');
  r = await api('GET', '/api/feed', { token });
  assert.equal(r.status, 200);
  assert.ok(r.body.feeds.all && lib.data.boards.every((b) => r.body.feeds[b.id]), 'All and every board');
  await new Promise((res) => setTimeout(res, 50));
  await feed.queue; // the first ask starts them being made
  r = await api('GET', '/api/feed', { token });
  const pin = r.body.feeds.all.pins[0];
  assert.ok(pin && pin.url && pin.sig && pin.w && pin.h, 'pins with their address, picture and shape');
  r = await api('GET', '/api/feed/img/' + pin.sig, { token });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal((await api('GET', '/api/feed/img/' + 'f'.repeat(32), { token })).status, 404, 'a picture no feed has');
  assert.equal((await api('POST', '/api/feed/save', { token, json: { url: pin.url, boardId: null } })).status, 200);
  assert.deepEqual(saves, [[pin.url, null]]);
  assert.equal((await api('POST', '/api/feed/save', { token, json: { url: 'https://example.com/x' } })).status, 400, 'only Pinterest pins');
  assert.equal((await api('POST', '/api/feed/hide', { token, json: { id: pin.id } })).status, 200);
  r = await api('GET', '/api/feed', { token });
  assert.ok(!r.body.feeds.all.pins.some((p) => p.id === pin.id), 'hidden from the phone is hidden everywhere');
  assert.equal((await api('POST', '/api/feed/hide', { token, json: { id: '../x' } })).status, 400);
  const had = r.body.feeds.all.pins.length;
  assert.equal(r.body.feeds.all.more, true, 'says when there are more');
  r = await api('GET', '/api/feed?want=all&more=1', { token });
  assert.ok(r.body.feeds.all.pins.length > had, `the next page when the phone asks (${had} -> ${r.body.feeds.all.pins.length})`);
  // When Pinterest fails, the reason is given in plain words, and the pins from before stay.
  feed.source = new FakeSource('changed');
  await feed.load('all', 'fresh');
  r = await api('GET', '/api/feed', { token });
  assert.match(r.body.feeds.all.error, /Pinterest has changed how it works/);
  assert.ok(r.body.feeds.all.pins.length > had, 'the pins from before stay');
  feed.source = new FakeSource('offline');
  await feed.load('all', 'fresh');
  assert.match(feed.get('all', { load: false }).error, /Couldn’t reach Pinterest/);
  feed.source = new FakeSource();
  await feed.load('all', 'fresh');
  assert.equal(feed.get('all', { load: false }).error, null, 'and it clears once Pinterest answers again');
  ok('Ideas for the phone: every feed, their pictures, save and hide (checked), paired phones only');

  // ---------- the phone's error log ----------
  assert.equal((await api('POST', '/api/log', { json: { text: 'x' } })).status, 401, 'paired phones only');
  r = await api('POST', '/api/log', { token, json: { text: '2026-09-25T10:00:00Z [screen] TypeError: boom' } });
  assert.equal(r.status, 200);
  assert.deepEqual(events.logs, ['2026-09-25T10:00:00Z [screen] TypeError: boom']);
  assert.equal((await api('POST', '/api/log', { token, json: { text: 'x'.repeat(70000) } })).status, 400, 'too long');
  assert.equal((await api('POST', '/api/log', { token, json: { text: 5 } })).status, 400, 'not text');
  ok('the phone’s error log is taken (paired phones only, text up to 64 KB)');

  // ---------- discovery ----------
  const reply = await new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('no discovery reply')); }, 3000);
    sock.on('message', (msg) => { clearTimeout(timer); sock.close(); resolve(JSON.parse(msg.toString())); });
    sock.bind(0, HOST, () => sock.send('NOTEBOOK_DISCOVER', DISCOVERY_PORT, HOST));
  });
  assert.deepEqual(reply, { app: 'Notebook', pcId: server.pcId, name: 'Test PC', port: server.port });
  ok('UDP discovery replies with the PC id, name and the real port');

  // ---------- rate limit, unpair, restart ----------
  let limited = null;
  for (let i = 0; i < 12 && !limited; i++) {
    r = await api('POST', '/api/pair', { json: { code: 'WRONG234', deviceId: 'x' } });
    if (r.status === 429) limited = i;
  }
  assert.ok(limited !== null && limited <= 10, 'wrong codes are rate-limited');
  ok('wrong pairing codes are limited to 10 a minute');

  server.unpair('phone-1');
  r = await api('GET', '/api/ping', { token });
  assert.equal(r.status, 401);
  ok('unpairing on the PC stops the token working straight away');

  const pcId = server.pcId;
  await server.stop();
  blocker.close();
  const again = new SyncServer({ settingsFile, host: HOST, port: BASE_PORT, discoveryPort: DISCOVERY_PORT, log: { error: () => {} } });
  await again.start(lib);
  assert.equal(again.pcId, pcId, 'the PC keeps the same id');
  assert.equal(again.port, BASE_PORT);
  assert.equal((await again.status()).running, true);
  await again.stop();
  ok('restarting keeps the same PC id; the server stops cleanly');

  console.log(`\nAll ${passed} checks passed.`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
