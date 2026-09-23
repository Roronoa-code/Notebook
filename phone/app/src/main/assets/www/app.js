// Notebook phone UI preview: the approved phone design, running on its own with sample items.
// No saving or syncing yet; this build is for trying the look and feel on the phone.
(() => {
  const I = 'img/';
  const BOARDS = [
    { id: 'outfits', name: 'Outfits', icon: 'M12 5a2 2 0 1 1 2 2c-1 0-2 .5-2 1.5V9L3 15c-1 .7-.5 2 .7 2h16.6c1.2 0 1.7-1.3.7-2l-9-6' },
    { id: 'wallpapers', name: 'Wallpapers', icon: 'M3 17l5-6 4 4 3-3 6 5M4 4h16v16H4z' },
    { id: 'icons', name: 'Icons', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6z' },
    { id: 'pfp', name: 'Profile pics', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5' },
    { id: 'sizes', name: 'Clothing sizes', icon: 'M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4' },
    { id: 'vwall', name: 'Videos wallpaper', icon: 'M4 6h12v12H4zM16 10l4-2v8l-4-2' }
  ];
  const WHEEL = BOARDS.concat([{ id: 'new', name: 'New board', icon: 'M12 5v14M5 12h14', isNew: true }]);
  const ITEMS = [
    { id: 'i1', k: 'photo', img: I + 'outfit1.jpg', title: 'Plaid overshirt', b: ['outfits', 'sizes'], ar: '3 / 4', caption: 'chest 27in, want it in black' },
    { id: 'i2', k: 'video', img: I + 'wall1.jpg', title: 'Aurora live wallpaper', b: ['wallpapers', 'vwall'], ar: '9 / 16', dur: '0:18' },
    { id: 'i3', k: 'note', title: 'Autumn capsule', b: ['outfits'], preview: '• Need brown loafers\n• Cream knit (the chunky one)\n• Wide leg trousers' },
    { id: 'i4', k: 'photo', img: I + 'pfp1.jpg', title: 'Golden hour pfp', b: ['pfp'], ar: '4 / 5' },
    { id: 'i5', k: 'photo', img: I + 'wall2.jpg', title: 'Mountain dusk', b: ['wallpapers'], ar: '3 / 4' },
    { id: 'i6', k: 'photo', img: I + 'icons1.jpg', title: 'Pastel icons', b: ['icons'], ar: '1 / 1' },
    { id: 'i7', k: 'photo', img: I + 'outfit2.jpg', title: 'Sage cardigan fit', b: ['outfits', 'pfp'], ar: '4 / 5' },
    { id: 'i8', k: 'video', img: I + 'video1.jpg', title: 'Try-on haul', b: ['outfits'], ar: '9 / 16', dur: '1:12' }
  ];

  const S = {
    screen: 'home', prev: 'home', tab: 'recent', board: 'outfits', item: 'i1', lift: false, add: false, cover: false,
    coverId: null, coverDots: true, focus: 1, playing: false, syncing: false, last: '2 min ago', tidied: false,
    mem: Object.fromEntries(ITEMS.map((it) => [it.id, it.b.slice()])), binned: {}, captions: {}
  };
  const app = document.getElementById('app');
  const $ = (q) => app.querySelector(q);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d, size = 20, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const P = {
    back: 'M15 18l-6-6 6-6', home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
    plus: 'M12 5v14M5 12h14', sync: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4', photo: 'M3 4h18v16H3zM21 16l-5-5-9 9',
    bin: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    note: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', pc: 'M3 4h18v12H3zM8 20h8M12 16v4'
  };
  const live = () => ITEMS.filter((it) => !S.binned[it.id]);
  const onBoard = (id) => live().filter((it) => S.mem[it.id].includes(id));
  const item = () => ITEMS.find((it) => it.id === S.item) || ITEMS[0];
  const caption = (it) => (S.captions[it.id] !== undefined ? S.captions[it.id] : it.caption || '');

  // ---------- pieces ----------
  function card(it, n) {
    const d = `--d:${Math.min(n * 45, 450)}ms`;
    if (it.k === 'note') {
      return `<button type="button" class="card" data-a="open" data-v="${it.id}" style="${d}" aria-label="Open ${esc(it.title)}"><div class="notecard"><div class="t">${esc(it.title)}</div><div class="p">${esc(it.preview)}</div></div></button>`;
    }
    const cap = caption(it);
    return `<button type="button" class="card" data-a="open" data-v="${it.id}" style="${d}" aria-label="Open ${esc(it.title)}">
      <div class="media"><img src="${it.img}" alt="" style="aspect-ratio:${it.ar}">${it.k === 'video' ? `<span class="badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>${it.dur}</span>` : ''}</div>
      <div class="cap">${esc(it.title)}</div>${cap ? `<div class="capnote">${esc(cap)}</div>` : ''}</button>`;
  }

  function pillHTML(b, k) {
    const n = b.isNew ? '' : onBoard(b.id).length;
    return `<button type="button" class="pill" data-pill="${k}" aria-label="${esc(b.name)}">${svg(b.icon, 18, 1.8)}<span class="nm">${esc(b.name)}</span><span class="ct">${b.isNew ? '' : n + (n === 1 ? ' item' : ' items')}</span></button>`;
  }

  // Board wheel: the middle pill is the focused board and the brightest; two show above and below.
  function layoutPills() {
    app.querySelectorAll('.pill').forEach((el) => {
      const k = +el.dataset.pill, dist = k - S.focus, far = Math.abs(dist);
      el.style.top = 92 + dist * 50 + 'px';
      el.style.zIndex = String(10 - far);
      el.style.setProperty('--glow', Math.max(0, 0.22 - far * 0.07).toFixed(2));
      el.style.opacity = far > 2 ? '0' : String([1, 0.8, 0.4][far]);
      el.style.pointerEvents = far > 2 ? 'none' : 'auto';
    });
  }

  function heroHTML() {
    const cov = S.coverId ? ITEMS.find((x) => x.id === S.coverId) : null;
    return `<div class="hero">
      ${cov ? `<img class="cover ${S.coverDots ? 'dots' : 'plain'}" src="${cov.img}" alt=""><div class="coverfade"></div>` : `<img class="dither" src="${I}mani-dither2.png" alt="">`}
      <div class="stackwrap" id="stack">${WHEEL.map(pillHTML).join('')}</div>
      <div class="micro status"><span style="color:#F2F2F2">${String(live().length).padStart(2, '0')} items saved</span><br>Synced with PC · ${esc(S.last)}</div>
      <button type="button" class="iconbtn glass coverbtn" data-a="cover" aria-label="Change cover">${svg(P.photo, 18, 1.9)}</button>
    </div>`;
  }

  function homeHTML(enter) {
    const list = S.tab === 'notes' ? live().filter((x) => x.k === 'note') : live();
    return `<div class="screen${enter ? ' enter' : ''}" style="overflow:hidden">
      ${heroHTML()}
      <div class="lift${S.lift ? ' up' : ''}" id="lift">
        <button type="button" class="grip" data-a="lift" aria-label="${S.lift ? 'Lower items' : 'Lift items up'}"></button>
        <div class="grid${enter ? ' anim' : ''}">${list.map(card).join('')}</div>
      </div>
      <div class="topglass${S.lift ? ' on' : ''}" id="topglass"></div>
      <div class="topbar"><div class="wordmark">notebook<span>.</span></div>
        <div class="seg glass"><button type="button" class="${S.tab === 'recent' ? 'on' : ''}" data-a="tab" data-v="recent">Recent</button><button type="button" class="${S.tab === 'notes' ? 'on' : ''}" data-a="tab" data-v="notes">Notes</button></div>
      </div>
    </div>`;
  }

  function boardHTML(enter) {
    const b = BOARDS.find((x) => x.id === S.board) || BOARDS[0];
    const list = onBoard(b.id);
    const coverImg = (list.find((x) => x.img) || ITEMS[0]).img;
    return `<div class="screen${enter ? ' enter' : ''}">
      <div style="position:relative;height:330px">
        <img src="${coverImg}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(2px)">
        <div class="coverfade"></div>
        <button type="button" class="iconbtn glass" data-a="home" aria-label="Back" style="position:absolute;top:10px;left:16px">${svg(P.back)}</button>
        <div style="position:absolute;left:22px;right:22px;bottom:18px;display:flex;align-items:baseline;gap:12px"><span class="poster" style="font-size:64px">${esc(b.name)}</span><span class="micro">${list.length} items</span></div>
      </div>
      <div class="grid${enter ? ' anim' : ''}" style="padding-top:12px">${list.map(card).join('') || '<p style="margin:20px 4px;color:#9A9A9A">Nothing on this board yet.</p>'}</div>
    </div>`;
  }

  function itemHTML(enter) {
    const it = item();
    const chips = BOARDS.map((b) => { const on = S.mem[it.id].includes(b.id); return `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-a="boardToggle" data-v="${b.id}">${esc(b.name)}</button>`; }).join('');
    const kind = it.k === 'video' ? 'Video · ' + it.dur : it.k === 'note' ? 'Note' : 'Photo';
    const stage = it.k === 'note'
      ? `<div style="position:absolute;inset:0;background:#0F0F0F;padding:70px 26px 0;display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;justify-content:flex-end"><button type="button" class="btn accent" data-a="tidy" style="height:40px">${S.tidied ? 'Undo tidy' : 'Tidy up'}</button></div>
          ${S.tidied ? `<div class="tidied"><div style="font-size:30px;font-weight:300;letter-spacing:-.02em;margin-bottom:12px">Autumn capsule</div><ul style="margin:0;padding-left:22px;display:flex;flex-direction:column;gap:8px;font-size:17px"><li>Need brown loafers</li><li>Cream knit (the chunky one)</li><li>Wide leg trousers</li></ul></div>`
            : `<div style="font-size:18px;line-height:1.6">autumn capsule - need brown loafers, cream knit (the chunky one), wide leg trousers</div>`}
        </div>`
      : `<img src="${it.img}" alt="${esc(it.title)}" style="position:absolute;left:0;top:0;width:100%;height:62%;object-fit:cover">
         ${it.k === 'video' ? `<button type="button" class="glass" data-a="play" aria-label="${S.playing ? 'Pause' : 'Play'}" style="position:absolute;left:50%;top:26%;translate:-50% 0;width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0">${S.playing ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>' : '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>'}</button>` : ''}`;
    return `<div class="screen${enter ? ' enter' : ''}" style="overflow:hidden">
      ${stage}
      <button type="button" class="iconbtn glass" data-a="back" aria-label="Back" style="position:absolute;top:10px;left:16px;z-index:3">${svg(P.back)}</button>
      <span class="glass" style="position:absolute;top:14px;right:16px;z-index:3;height:36px;padding:0 14px;border-radius:999px;display:inline-flex;align-items:center;font-size:12px;font-weight:700">${kind}</span>
      <div class="sheet frost">
        <div class="handle"></div>
        <div style="font-size:26px;line-height:1.1">${esc(it.title)}</div>
        ${it.k !== 'note' ? `<div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="note">Note</label><textarea id="note" class="notebox" placeholder="Why did you save this?">${esc(caption(it))}</textarea></div>` : ''}
        <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Boards</span><div style="display:flex;flex-wrap:wrap;gap:8px">${chips}</div></div>
        <div style="display:flex;gap:10px;margin-top:4px"><button type="button" class="btn danger" data-a="bin">${svg(P.bin, 16)}<span>Move to Bin</span></button><span style="flex:1"></span><button type="button" class="btn white" data-a="back">Done</button></div>
      </div>
    </div>`;
  }

  function syncHTML(enter) {
    return `<div class="screen${enter ? ' enter' : ''}" style="padding:20px 20px 120px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:6px"><div class="poster" style="font-size:64px">Sync</div><div style="font-size:14px;color:#9A9A9A">Phone and PC, over your home Wi-Fi</div></div>
      <div class="glass" style="border-radius:30px;padding:22px;display:flex;flex-direction:column;gap:16px;background:rgba(255,255,255,.05)">
        <div style="display:flex;align-items:center;gap:14px"><span style="width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.2);display:inline-flex;align-items:center;justify-content:center">${svg(P.pc, 24)}</span>
          <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:16px;font-weight:600">Mani's PC</span><span style="font-size:13px;color:#9A9A9A">Home Wi-Fi · paired</span></div></div>
        <div style="font-size:44px;font-weight:200;letter-spacing:-.03em;line-height:1">${S.syncing ? 'Syncing…' : 'Up to date'}</div>
        ${S.syncing ? '<div class="bar"><div></div></div>' : ''}
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          <div style="border-radius:18px;background:rgba(255,255,255,.05);padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span class="lbl">Last sync</span><span style="font-size:16px;font-weight:600">${esc(S.last)}</span></div>
          <div style="border-radius:18px;background:rgba(255,255,255,.05);padding:12px 14px;display:flex;flex-direction:column;gap:2px"><span class="lbl">Waiting</span><span style="font-size:16px;font-weight:600">${S.syncing ? '3 photos' : 'Nothing'}</span></div>
        </div>
        <button type="button" class="btn white" data-a="syncNow" style="width:100%">Sync now</button>
      </div>
      <div class="glass" style="border-radius:30px;padding:20px;display:flex;gap:16px;align-items:center;background:rgba(255,255,255,.04)">
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="#F2F2F2" stroke-width="3" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><path d="M4 20V8a4 4 0 0 1 4-4h12M52 4h12a4 4 0 0 1 4 4v12M68 52v12a4 4 0 0 1-4 4H52M20 68H8a4 4 0 0 1-4-4V52"/><rect x="22" y="22" width="10" height="10" rx="2"/><rect x="40" y="22" width="10" height="10" rx="2"/><rect x="22" y="40" width="10" height="10" rx="2"/><path d="M42 42h8v8"/></svg>
        <div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:15px;font-weight:600">Pair another PC</span><span style="font-size:13px;line-height:1.45;color:#9A9A9A">On your PC, open Notebook and choose Phone, then scan the code it shows.</span><button type="button" class="btn" data-a="scan" style="height:40px;align-self:flex-start">Scan code</button></div>
      </div>
      <div style="font-size:12px;color:#9A9A9A;text-align:center">This preview doesn't sync yet. Nothing leaves your phone.</div>
    </div>`;
  }

  function overlaysHTML() {
    const nav = S.screen === 'item' ? '' : `<nav class="nav glass" aria-label="Main">
      <button type="button" class="navbtn${S.screen === 'home' ? ' on' : ''}" data-a="home" aria-label="Home">${svg(P.home)}${S.screen === 'home' ? '<span>Home</span>' : ''}</button>
      <button type="button" class="navbtn" data-a="search" aria-label="Search">${svg(P.search)}</button>
      <button type="button" class="addbtn${S.add ? ' open' : ''}" data-a="add" aria-label="Add" aria-expanded="${S.add}">${svg(P.plus, 22, 2.4)}</button>
      <button type="button" class="navbtn${S.screen === 'sync' ? ' on' : ''}" data-a="sync" aria-label="Sync">${svg(P.sync)}${S.screen === 'sync' ? '<span>Sync</span>' : ''}</button>
    </nav>`;
    const add = !S.add ? '' : `<div class="popsheet frost">
      <button type="button" class="addrow" data-a="addGallery">${svg(P.photo, 20, 1.9)}Photos and videos from Gallery</button>
      <button type="button" class="addrow" data-a="addCamera">${svg(P.camera, 20, 1.9)}Take a photo</button>
      <button type="button" class="addrow" data-a="addNote">${svg(P.note, 20, 1.9)}New note</button></div>`;
    const tiles = [{ id: '', label: 'MANI' }].concat(live().filter((x) => x.img).map((x) => ({ id: x.id, label: x.title, img: x.img })));
    const cover = !S.cover ? '' : `<div class="popsheet frost" style="padding:16px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;justify-content:space-between"><span class="lbl">Cover</span>
        <div class="seg" style="background:rgba(255,255,255,.06)"><button type="button" class="${S.coverDots ? 'on' : ''}" data-a="dots">Dotted</button><button type="button" class="${S.coverDots ? '' : 'on'}" data-a="plain">Photo</button></div></div>
      <div class="tiles">${tiles.map((t) => { const on = (S.coverId || '') === t.id; return `<button type="button" class="tile${on ? ' on' : ''}" aria-pressed="${on}" aria-label="Use ${esc(t.label)} as cover" data-a="coverPick" data-v="${t.id}">${t.img ? `<img src="${t.img}" alt="">` : '<span class="manitile">MANI</span>'}</button>`; }).join('')}</div></div>`;
    return nav + add + cover + '<div id="toastbox"></div>';
  }

  // ---------- render ----------
  let lastScreen = null;
  function render() {
    const enter = S.screen !== lastScreen;
    lastScreen = S.screen;
    const keepScroll = $('#lift') ? $('#lift').scrollTop : 0;
    const body = { home: homeHTML, board: boardHTML, item: itemHTML, sync: syncHTML }[S.screen](enter);
    app.innerHTML = body + overlaysHTML();
    app.style.setProperty('--hero', Math.round(Math.min(600, window.innerHeight * 0.7)) + 'px');
    if (S.screen === 'home') { layoutPills(); wireHome(); if (!enter && S.lift) $('#lift').scrollTop = keepScroll; }
    const note = $('#note');
    if (note) note.addEventListener('input', () => { S.captions[S.item] = note.value; });
  }

  let toastTimer = null;
  function toast(msg) {
    const box = $('#toastbox');
    if (!box) return;
    box.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { const b = $('#toastbox'); if (b) b.innerHTML = ''; }, 2400);
  }

  function setLift(v) {
    S.lift = v;
    const el = $('#lift');
    if (!el) return;
    el.classList.toggle('up', v);
    $('#topglass').classList.toggle('on', v);
    el.querySelector('.grip').setAttribute('aria-label', v ? 'Lower items' : 'Lift items up');
    if (!v) el.scrollTop = 0;
  }

  function moveFocus(step) {
    S.focus = Math.max(0, Math.min(WHEEL.length - 1, S.focus + step));
    layoutPills();
  }

  function wireHome() {
    // Items sheet: the first swipe up lifts it over the header; after that it scrolls. At the top, swipe down to lower it.
    const lift = $('#lift');
    let y0 = 0;
    lift.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    lift.addEventListener('touchmove', (e) => {
      const dy = y0 - e.touches[0].clientY;
      if (!S.lift && dy > 20) { e.preventDefault(); setLift(true); }
      else if (S.lift && lift.scrollTop <= 0 && dy < -24) { e.preventDefault(); setLift(false); }
    }, { passive: false });
    // Board wheel: swipe up/down to move through boards; tap a dim pill to bring it to the middle, tap the middle one to open it.
    const stack = $('#stack');
    let sy = 0, swiped = false;
    stack.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; swiped = false; }, { passive: true });
    stack.addEventListener('touchmove', (e) => {
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dy) > 36) { moveFocus(dy < 0 ? 1 : -1); sy = e.touches[0].clientY; swiped = true; }
      e.preventDefault();
    }, { passive: false });
    stack.addEventListener('click', (e) => {
      const el = e.target.closest('.pill');
      if (!el || swiped) { swiped = false; return; }
      const k = +el.dataset.pill;
      el.classList.remove('jig'); void el.offsetWidth; el.classList.add('jig');
      if (k !== S.focus) { S.focus = k; layoutPills(); return; }
      const b = WHEEL[k];
      if (b.isNew) { toast('Name your new board'); return; }
      setTimeout(() => go('board', { board: b.id }), 260);
    });
  }

  function go(screen, extra) {
    Object.assign(S, extra || {}, { screen, add: false, cover: false });
    if (screen !== 'home') S.lift = false;
    render();
  }

  // ---------- actions ----------
  const A = {
    home: () => go('home'),
    sync: () => go('sync'),
    search: () => toast('Search opens here'),
    add: () => { S.add = !S.add; S.cover = false; render(); },
    cover: () => { S.cover = !S.cover; S.add = false; render(); },
    coverPick: (v) => { S.coverId = v || null; render(); },
    dots: () => { S.coverDots = true; render(); },
    plain: () => { S.coverDots = false; render(); },
    tab: (v) => { S.tab = v; lastScreen = null; render(); },
    lift: () => setLift(!S.lift),
    addGallery: () => { S.add = false; render(); toast('Opens your Gallery'); },
    addCamera: () => { S.add = false; render(); toast('Opens the camera'); },
    addNote: () => go('item', { item: 'i3', prev: S.screen, tidied: false }),
    open: (v) => go('item', { item: v, prev: S.screen, playing: false, tidied: false }),
    back: () => go(S.prev === 'item' ? 'home' : S.prev),
    bin: () => { S.binned[S.item] = true; go(S.prev === 'item' ? 'home' : S.prev); toast('Moved to Bin · keeps its boards'); },
    boardToggle: (v) => { const m = S.mem[S.item]; S.mem[S.item] = m.includes(v) ? m.filter((x) => x !== v) : m.concat(v); render(); },
    play: () => { S.playing = !S.playing; render(); },
    tidy: () => { S.tidied = !S.tidied; render(); },
    syncNow: () => {
      if (S.syncing) return;
      S.syncing = true; render();
      setTimeout(() => { S.syncing = false; S.last = 'just now'; if (S.screen === 'sync') render(); toast('Sync is coming in a later version'); }, 1800);
    },
    scan: () => toast('Opens the camera to scan')
  };
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.v, el);
  });

  // Android back gesture: close a panel or step back before leaving the app.
  window.nbBack = () => {
    if (S.add || S.cover) { S.add = S.cover = false; render(); return true; }
    if (S.screen === 'home' && S.lift) { setLift(false); return true; }
    if (S.screen === 'item') { A.back(); return true; }
    if (S.screen !== 'home') { go('home'); return true; }
    return false;
  };
  window.addEventListener('resize', () => app.style.setProperty('--hero', Math.round(Math.min(600, window.innerHeight * 0.7)) + 'px'));
  render();
})();
