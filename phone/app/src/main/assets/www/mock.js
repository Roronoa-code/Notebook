// Stand-in for the app's native side, used only when the screens are opened outside the phone app
// (e.g. testing on the PC). Inside the app, window.NBNative is provided by MainActivity.java and this does nothing.
if (!window.NBNative) {
  window.NB_LIB = '';
  const now = () => new Date().toISOString();
  const id = () => Math.random().toString(36).slice(2);
  const B = (name) => ({ id: id(), name, updatedAt: now() });
  const boards = [B('Outfits'), B('Wallpapers'), B('Icons'), B('Profile pictures'), B('Clothing sizes'), B('Videos wallpaper')];
  const it = (kind, file, title, b, w, h, extra) => Object.assign({ id: id(), kind, title, file, thumb: file, w, h, boards: b.map((i) => boards[i].id), importedAt: now(), updatedAt: now(), deletedAt: null }, extra || {});
  const db = {
    boards,
    items: [
      it('photo', 'img/outfit1.jpg', 'Plaid overshirt', [0, 4], 600, 800, { caption: 'chest 27in, want it in black' }),
      it('video', 'img/wall1.jpg', 'Aurora live wallpaper', [1, 5], 600, 1066, { duration: 18 }),
      { id: id(), kind: 'note', title: 'Autumn capsule', html: '<h2>Autumn capsule</h2><ul><li>Need brown loafers</li><li>Cream knit (the chunky one)</li></ul>', boards: [boards[0].id], importedAt: now(), updatedAt: now(), deletedAt: null },
      it('photo', 'img/pfp1.jpg', 'Golden hour pfp', [3], 600, 750),
      it('photo', 'img/wall2.jpg', 'Mountain dusk', [1], 600, 800),
      it('photo', 'img/icons1.jpg', 'Pastel icons', [2], 600, 600),
      it('photo', 'img/outfit2.jpg', 'Sage cardigan fit', [0, 3], 600, 750),
      it('video', 'img/video1.jpg', 'Try-on haul', [0], 600, 1066, { duration: 72 })
    ],
    tombstones: { items: [], boards: [] },
    sync: { paired: false, pcName: '', lastSync: '' }
  };
  const prefs = {};
  const ok = (extra) => JSON.stringify(Object.assign({ ok: true, state: db }, extra || {}));
  const find = (i) => db.items.find((x) => x.id === i);
  window.NBNative = {
    state: () => JSON.stringify(db),
    tick() {},
    getPref: (k) => prefs[k] || '',
    setPref: (k, v) => { prefs[k] = v; },
    pick() { window.nbOnToast && window.nbOnToast('(PC preview) The gallery opens here on the phone'); },
    camera() { window.nbOnToast && window.nbOnToast('(PC preview) The camera opens here on the phone'); },
    addNote(b) { const n = { id: id(), kind: 'note', title: 'Untitled note', html: '', boards: b ? [b] : [], importedAt: now(), updatedAt: now(), deletedAt: null }; db.items.unshift(n); return ok({ id: n.id }); },
    update(i, json) { Object.assign(find(i), JSON.parse(json), { updatedAt: now() }); return ok(); },
    bin(i) { find(i).deletedAt = now(); return ok(); },
    restore(i) { find(i).deletedAt = null; return ok(); },
    deleteForever(i) { const gone = db.items.filter((x) => x.deletedAt && (!i || x.id === i)); db.items = db.items.filter((x) => !gone.includes(x)); return ok({ id: String(gone.length) }); },
    addBoard(name) { if (!name.trim()) return JSON.stringify({ error: 'Give the board a name.' }); const b = B(name.trim()); db.boards.push(b); return ok({ id: b.id }); },
    renameBoard(i, name) { db.boards.find((b) => b.id === i).name = name.trim(); return ok(); },
    deleteBoard(i) { db.boards = db.boards.filter((b) => b.id !== i); db.items.forEach((x) => { x.boards = x.boards.filter((b) => b !== i); }); return ok(); },
    sync() { window.nbOnSync(JSON.stringify({ phase: 'error', message: '(PC preview) Syncing only works in the phone app.' })); },
    syncQuiet() {},
    scan() { window.nbOnPair(JSON.stringify({ ok: false, message: '(PC preview) Scanning only works in the phone app.' })); },
    pairManual() { window.nbOnPair(JSON.stringify({ ok: false, message: '(PC preview) Pairing only works in the phone app.' })); },
    unpair() { db.sync = { paired: false }; return JSON.stringify(db); }
  };
}
