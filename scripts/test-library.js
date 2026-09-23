// Checks the library end to end without the window: saving, imports, notes, boards,
// Bin, backup + restore into a separate place, export and damaged-file recovery.
// Usage: npm test   (needs ffmpeg for the sample media)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { Library } = require('../main/library');
const { makeSamples } = require('./make-samples');

const ROOT = path.resolve(__dirname, '..', 'test-output', 'library-test');
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const samples = makeSamples(path.join(ROOT, 'originals'));
  const before = Object.fromEntries(samples.map((f) => [f, hash(f)]));
  const libDir = path.join(ROOT, 'Notebook Library');

  let lib = await Library.openOrCreate(libDir);
  assert.deepEqual(lib.data.boards.map((b) => b.name), ['Outfits', 'Wallpapers', 'Icons', 'Profile pictures']);
  ok('new library has the four starter boards');
  const [outfits, wallpapers, icons] = lib.data.boards.map((b) => b.id);

  const imp = await lib.importFiles(samples, outfits);
  assert.equal(imp.added.length, 4);
  assert.equal(imp.skipped.length, 1);
  assert.match(imp.skipped[0].reason, /not a supported/);
  ok('imports 2 photos + 2 videos, skips the .txt with a reason');
  for (const f of samples) assert.equal(hash(f), before[f]);
  ok('original files are unchanged');

  const n1 = await lib.addNote(outfits);
  const n2 = await lib.addNote(null);
  await lib.updateItem(n1, { html: '<h2>Autumn capsule</h2><ul><li>Brown loafers</li><li><b>Cream</b> knit</li></ul>', title: 'Autumn capsule' });
  await lib.updateItem(n1, { html: '<h2>Autumn capsule</h2><ul><li>Brown loafers</li><li><b>Cream</b> knit</li><li>Edited</li></ul>' });
  await lib.updateItem(n2, { html: 'wallpaper places: unsplash', title: 'wallpaper places' });
  const photo = lib.data.items.find((i) => i.kind === 'photo');
  await lib.updateItem(photo.id, { boards: [outfits, wallpapers, 'not-a-board'], caption: 'chest 27in' });
  assert.deepEqual(lib.item(photo.id).boards, [outfits, wallpapers]);
  ok('notes save and items can be on several boards (unknown boards ignored)');

  lib = await Library.openOrCreate(libDir);
  assert.equal(lib.data.items.length, 6);
  assert.match(lib.item(n1).html, /Edited/);
  ok('everything is still there after reopening');

  await lib.renameBoard(icons, 'App icons');
  await assert.rejects(lib.renameBoard(icons, 'outfits'), /already a board/);
  await lib.deleteBoard(wallpapers);
  assert.equal(lib.data.items.length, 6);
  assert.deepEqual(lib.item(photo.id).boards, [outfits]);
  ok('rename board, duplicate names refused, deleting a board keeps its items');

  await lib.moveToBin(photo.id);
  lib = await Library.openOrCreate(libDir);
  assert.ok(lib.item(photo.id).deletedAt);
  await lib.restore(photo.id);
  assert.equal(lib.item(photo.id).deletedAt, null);
  assert.deepEqual(lib.item(photo.id).boards, [outfits]);
  ok('Bin: deleted item comes back with its boards and details');

  fs.rmSync(path.join(ROOT, 'originals'), { recursive: true });
  for (const it of lib.data.items.filter((i) => i.file)) assert.equal(fs.statSync(path.join(libDir, it.file)).size, it.size);
  ok('library copies are complete even after the originals are gone');

  const backupParent = path.join(ROOT, 'backups');
  fs.mkdirSync(backupParent);
  await assert.rejects(lib.backup(path.join(libDir, 'media')), /outside the library/);
  const bk = await lib.backup(backupParent);
  assert.ok(fs.existsSync(path.join(bk.dir, 'library.json')));
  assert.equal(fs.readdirSync(backupParent).length, 1, 'no leftover partial folder');
  ok(`backup made (${bk.files} files) and refuses to back up into itself`);

  fs.renameSync(libDir, libDir + ' (hidden)'); // make the live library unavailable
  const restored = path.join(ROOT, 'Restored Library');
  await Library.restoreBackup(bk.dir, restored);
  await assert.rejects(Library.restoreBackup(bk.dir, restored), /already exists/);
  const back = await Library.openOrCreate(restored);
  assert.equal(back.data.items.length, 6);
  assert.match(back.item(n1).html, /Edited/);
  assert.deepEqual(back.data.boards.map((b) => b.name), ['Outfits', 'App icons', 'Profile pictures']);
  assert.deepEqual(back.item(photo.id).boards, [outfits]);
  for (const it of back.data.items.filter((i) => i.file)) assert.ok(fs.existsSync(path.join(restored, it.file)));
  ok('restore into a separate folder: all 6 items, edits and boards are back');
  fs.renameSync(libDir + ' (hidden)', libDir);

  const broken = path.join(ROOT, 'broken backup');
  fs.cpSync(bk.dir, broken, { recursive: true });
  fs.rmSync(path.join(broken, back.data.items.find((i) => i.file).file));
  await assert.rejects(Library.restoreBackup(broken, path.join(ROOT, 'should-not-exist')), /incomplete/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'should-not-exist')));
  ok('an incomplete backup is refused before anything is copied');

  const ex = await back.exportTo(ROOT);
  const media = fs.readdirSync(path.join(ex.dir, 'Media'));
  const notes = fs.readdirSync(path.join(ex.dir, 'Notes'));
  assert.equal(media.length, 4);
  assert.equal(notes.length, 2);
  const noteText = fs.readFileSync(path.join(ex.dir, 'Notes', 'Autumn capsule.txt'), 'utf8');
  assert.match(noteText, /Autumn capsule\n• Brown loafers\n• Cream knit\n• Edited/);
  const csv = fs.readFileSync(path.join(ex.dir, 'boards.csv'), 'utf8');
  assert.match(csv, /"Autumn capsule","note","Notes\/Autumn capsule.txt","Outfits"/);
  assert.equal(csv.trim().split('\r\n').length, 7);
  assert.ok(csv.includes(',"chest 27in"'), 'photo note is in boards.csv');
  ok('export has every media file, readable notes and a boards.csv');

  fs.writeFileSync(path.join(restored, 'library.json'), '{ damaged');
  const recovered = await Library.openOrCreate(restored);
  assert.ok(recovered.recovered);
  assert.equal(recovered.data.items.length, 6);
  ok('a damaged library file is recovered from the previous save');

  await recovered.moveToBin(photo.id);
  const file = path.join(restored, recovered.item(photo.id).file);
  assert.equal(await recovered.emptyBin(), 1);
  assert.ok(!fs.existsSync(file));
  assert.equal(recovered.data.items.length, 5);
  ok('Empty Bin removes the item and its copied file');

  // ---------- phone sync: library v2 and the merge rules in docs/SYNC.md ----------
  assert.deepEqual(recovered.data.tombstones.items.map((t) => t.id), [photo.id]);
  ok('Empty Bin leaves a tombstone so the phone removes the item too');

  const v1Dir = path.join(ROOT, 'v1 library');
  fs.mkdirSync(path.join(v1Dir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(v1Dir, 'library.json'), JSON.stringify({
    app: 'Notebook', version: 1, createdAt: '2026-01-01T00:00:00.000Z', boards: [{ id: 'b1', name: 'Outfits' }],
    items: [{ id: 'n1', kind: 'note', title: 'Old', html: 'x', importedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', boards: ['b1'], deletedAt: null }]
  }));
  await Library.openOrCreate(v1Dir);
  const v2 = JSON.parse(fs.readFileSync(path.join(v1Dir, 'library.json'), 'utf8'));
  assert.equal(v2.version, 2);
  assert.ok(Date.parse(v2.boards[0].updatedAt));
  assert.deepEqual(v2.tombstones, { items: [], boards: [] });
  assert.equal(v2.items[0].updatedAt, '2026-01-02T00:00:00.000Z');
  assert.ok(fs.existsSync(path.join(v1Dir, 'library.json.bak')), 'the v1 file was kept as the previous save');
  ok('a version 1 library is upgraded to version 2 (board dates, tombstones) and saved');

  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
  const syncDir = path.join(ROOT, 'sync library');
  fs.mkdirSync(path.join(ROOT, 'fake'), { recursive: true });
  for (const n of ['pc photo.jpg', 'doomed.jpg']) fs.writeFileSync(path.join(ROOT, 'fake', n), crypto.randomBytes(5000));
  const sl = await Library.openOrCreate(syncDir);
  assert.equal(sl.data.version, 2);
  assert.ok(sl.data.boards.every((b) => Date.parse(b.updatedAt)));
  const [pId, tId] = (await sl.importFiles(['pc photo.jpg', 'doomed.jpg'].map((n) => path.join(ROOT, 'fake', n)))).added;
  await sl.saveThumb(pId, Buffer.from('thumb-p'), { w: 800, h: 1000 });
  await sl.saveThumb(tId, Buffer.from('thumb-t'), { w: 10, h: 10 });
  const nPc = await sl.addNote(), nPhone = await sl.addNote(), nKeep = await sl.addNote();

  sl.item(nPc).updatedAt = iso(-100000);
  await sl.moveToBin(nPc);
  assert.ok(Date.parse(sl.item(nPc).updatedAt) > Date.now() - 5000, 'Move to Bin bumps updatedAt');
  sl.item(nPc).updatedAt = iso(-100000);
  await sl.restore(nPc);
  assert.ok(Date.parse(sl.item(nPc).updatedAt) > Date.now() - 5000, 'Restore bumps updatedAt');
  const bT = await sl.addBoard('Doomed board');
  assert.ok(Date.parse(sl.board(bT).updatedAt) > Date.now() - 5000);
  const bOut = sl.data.boards[0].id;
  sl.board(bOut).updatedAt = iso(-100000);
  await sl.renameBoard(bOut, 'My outfits');
  assert.ok(Date.parse(sl.board(bOut).updatedAt) > Date.now() - 5000);
  ok('Move to Bin and Restore bump updatedAt; new and renamed boards get updatedAt');

  const bGone = await sl.addBoard('Gone');
  sl.data.tombstones.items.push({ id: 'ancient', at: iso(-100 * 864e5) });
  await sl.deleteBoard(bGone);
  assert.deepEqual(sl.data.tombstones.boards.map((t) => t.id), [bGone]);
  assert.ok(!sl.data.tombstones.items.some((t) => t.id === 'ancient'));
  ok('deleting a board leaves a tombstone; tombstones older than 90 days are dropped');

  await sl.updateItem(nPc, { html: 'PC edit', title: 'PC edit' });
  await sl.updateItem(pId, { boards: [bOut, bT] });
  await sl.updateItem(nKeep, { title: 'Edited after the phone deleted it' });
  const pcCopy = (id) => JSON.parse(JSON.stringify(sl.item(id)));
  const qId = crypto.randomUUID(), qnId = crypto.randomUUID(), rb = crypto.randomUUID();
  const remote = {
    deviceId: 'phone-1',
    boards: [...sl.data.boards.map((b) => ({ ...b })), { id: rb, name: 'From phone', updatedAt: iso() }],
    items: [
      { ...pcCopy(nPc), html: 'old phone copy', title: 'old phone copy', updatedAt: iso(-60000) },
      { ...pcCopy(nPhone), html: 'phone edit', title: 'phone edit', updatedAt: iso(60000) },
      { ...pcCopy(pId), title: 'renamed on phone', thumb: 'thumbs/phone-own.jpg', w: null, h: null, updatedAt: iso(60000) },
      { id: qId, kind: 'photo', title: 'phone photo', file: `media/${qId}.jpg`, thumb: 'thumbs/x.jpg', w: 1080, h: 1350, originalName: 'IMG_1.jpg', size: 4321,
        importedAt: iso(1000), updatedAt: iso(1000), boards: [rb, 'ghost-board', bT], deletedAt: null },
      { id: qnId, kind: 'note', title: 'phone note', html: 'hi', importedAt: iso(1000), updatedAt: iso(1000), boards: [], deletedAt: null }
    ],
    tombstones: { items: [{ id: tId, at: iso() }, { id: nKeep, at: iso(-60000) }], boards: [{ id: bT, at: iso(1000) }] }
  };
  const tFile = path.join(syncDir, sl.item(tId).file), tThumb = path.join(syncDir, sl.item(tId).thumb);
  const merged = await sl.mergeRemote(remote);
  assert.equal(sl.item(nPc).html, 'PC edit', 'PC newer: PC copy kept');
  assert.equal(sl.item(nPhone).html, 'phone edit', 'phone newer: phone copy taken');
  assert.equal(sl.item(pId).title, 'renamed on phone');
  assert.equal(sl.item(pId).thumb, `thumbs/${pId}.jpg`, 'thumb stays the PC\'s own');
  assert.deepEqual([sl.item(pId).w, sl.item(pId).h], [800, 1000], 'w/h filled in from the side that has them');
  assert.equal(sl.item(qId).thumb, null, 'a new phone item has no PC thumb yet');
  assert.deepEqual([sl.item(qId).w, sl.item(qId).h], [1080, 1350]);
  ok('merge: newer wins in both directions; thumb stays local; sizes fill in');
  assert.throws(() => sl.item(tId), /no longer exists/);
  assert.ok(!fs.existsSync(tFile) && !fs.existsSync(tThumb), 'tombstoned item\'s media and thumb deleted');
  assert.equal(sl.item(nKeep).title, 'Edited after the phone deleted it', 'an older tombstone does not remove a newer item');
  assert.ok(!sl.data.boards.some((b) => b.id === bT), 'tombstoned board removed');
  assert.ok(sl.data.boards.some((b) => b.id === rb && b.name === 'From phone'));
  assert.deepEqual(sl.item(pId).boards, [bOut], 'removed board dropped from items');
  assert.deepEqual(sl.item(qId).boards, [rb], 'unknown and removed boards stripped');
  ok('merge: tombstones remove items (and their files) and boards; unknown boards are stripped');
  assert.deepEqual(merged.pcNeeds, [qId]);
  assert.deepEqual([...sl.waiting], [qId]);
  const onDisk2 = JSON.parse(fs.readFileSync(path.join(syncDir, 'library.json'), 'utf8'));
  assert.equal(onDisk2.items.find((i) => i.id === nPhone).html, 'phone edit', 'merge was saved');
  assert.ok(onDisk2.tombstones.items.some((t) => t.id === tId));
  ok('merge: pcNeeds lists only the phone photo the PC lacks, and the result is saved');

  const again = await sl.mergeRemote({ ...remote, items: [], boards: [], tombstones: { items: [], boards: [] } });
  assert.equal(again.changed, false);
  assert.ok(sl.data.items.some((i) => i.id === nPc), 'items the phone did not send are kept');
  const savedBefore = fs.readFileSync(path.join(syncDir, 'library.json'), 'utf8');
  await assert.rejects(sl.mergeRemote({ ...remote, items: [{ ...remote.items[3], file: 'media/../../evil.jpg' }] }), /couldn't read/);
  await assert.rejects(sl.mergeRemote({ boards: 'nope', items: [] }), /couldn't read/);
  assert.equal(fs.readFileSync(path.join(syncDir, 'library.json'), 'utf8'), savedBefore, 'a bad sync changes nothing');
  ok('merge: an empty phone keeps the PC\'s items; a bad file name is refused and nothing changes');

  const { Readable } = require('stream');
  const bytes = crypto.randomBytes(4321);
  await assert.rejects(sl.receiveMedia(qId, Readable.from([bytes]), 4000), /bigger than the phone said/);
  await assert.rejects(sl.receiveMedia(qId, Readable.from([bytes.subarray(0, 100)]), 4321), /didn't arrive complete/);
  assert.deepEqual(fs.readdirSync(path.join(syncDir, 'media')).filter((f) => f.startsWith(qId)), [], 'no half-written file left');
  await sl.receiveMedia(qId, Readable.from([bytes]), 4321);
  assert.ok(bytes.equals(fs.readFileSync(path.join(syncDir, 'media', qId + '.jpg'))));
  assert.ok(!sl.waiting.has(qId));
  await assert.rejects(sl.receiveMedia(qId, Readable.from([bytes]), 4321), (e) => e.status === 409);
  await assert.rejects(sl.receiveMedia('not-known', Readable.from([bytes]), 4321), (e) => e.status === 400);
  assert.ok(bytes.equals(await sl.readMedia(qId)));
  ok('receiving media: size checked, nothing half-written kept, only for a known item whose file is missing');

  // ---------- show on phone ----------
  const { forPhone } = require('../main/merge');
  const pBefore = sl.item(pId).updatedAt;
  await sl.setOnPhone([pId], false);
  assert.equal(sl.item(pId).phone, false);
  assert.equal(sl.item(pId).updatedAt, pBefore, 'switching it off for the phone is not a synced edit');
  const emptyT = { items: [], boards: [] };
  await sl.mergeRemote({ deviceId: 'phone-1', boards: [], tombstones: emptyT,
    items: [{ ...JSON.parse(JSON.stringify(sl.item(pId))), phone: true, title: 'renamed on phone again', updatedAt: iso(120000) }] });
  assert.equal(sl.item(pId).title, 'renamed on phone again', 'the newer phone edit still arrives');
  assert.equal(sl.item(pId).phone, false, 'but the phone can\'t switch it back on');
  assert.ok(!forPhone(sl.data.items, []).some((i) => i.id === pId), 'not sent to the phone');
  assert.ok(forPhone(sl.data.items, [pId]).some((i) => i.id === pId), 'still sent while the PC waits for its file');
  await sl.setOnPhone([pId], true);
  assert.ok(!('phone' in sl.item(pId)));
  ok('show on phone: off by the PC only, survives newer phone edits, not a synced edit, kept while a file is on its way');

  // ---------- stacks ----------
  await assert.rejects(sl.stackItems([pId]), /at least two/);
  const st1 = await sl.stackItems([pId, qId]);
  assert.ok(sl.item(pId).stack === st1 && sl.item(qId).stack === st1);
  const st2 = await sl.stackItems([qnId, pId]);
  assert.ok([pId, qId, qnId].every((id) => sl.item(id).stack === st2), 'stacking into a stack joins it');
  await sl.unstackItem(qnId);
  assert.ok(sl.item(qnId).stack == null && sl.item(pId).stack === st2 && sl.item(qId).stack === st2);
  await sl.unstackItem(pId);
  assert.ok(sl.item(pId).stack == null && sl.item(qId).stack == null, 'a stack of one stops being a stack');
  await sl.mergeRemote({ deviceId: 'phone-1', boards: [], tombstones: emptyT, items: [{ ...JSON.parse(JSON.stringify(sl.item(qnId))), stack: 'phone-stack', updatedAt: iso(180000) }] });
  assert.equal(sl.item(qnId).stack, 'phone-stack', 'a stack made on the phone arrives');
  await assert.rejects(sl.mergeRemote({ deviceId: 'phone-1', boards: [], tombstones: emptyT, items: [{ ...JSON.parse(JSON.stringify(sl.item(qnId))), stack: '../x', updatedAt: iso(240000) }] }), /couldn't read/);
  ok('stacks: need two, join when overlapping, dissolve at one, sync from the phone, bad stack ids refused');

  console.log(`\nAll ${passed} checks passed.`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
