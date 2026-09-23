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

  console.log(`\nAll ${passed} checks passed.`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
