// Notebook on the phone: the screens. Data lives in the app (window.NBNative, see MainActivity.java);
// this file only draws and asks the app to make changes. Screens update in place, never full redraws.
(() => {
  const N = window.NBNative;
  const motionStyle = getComputedStyle(document.documentElement);
  const EASE = motionStyle.getPropertyValue('--ease').trim(), FAST = parseFloat(motionStyle.getPropertyValue('--t-fast')), NORMAL = parseFloat(motionStyle.getPropertyValue('--t-normal'));
  const LIB = window.NB_LIB ?? '/lib/';
  const url = (rel) => (rel ? LIB + rel : '');

  // ---------- data ----------
  let DB = JSON.parse(N.state());
  let dataVer = 0;
  const pref = (k, d) => { const v = N.getPref(k); return v === '' ? d : v; };
  const S = {
    screen: 'home', prev: 'home', tab: 'recent', board: null, item: null, lift: false,
    add: false, cover: false, sheet: null, pos: Number(pref('wheel', '0')) || 0,
    coverId: pref('coverId', ''), coverDots: pref('coverDots', '1') === '1', tidyUndo: null, syncing: false,
    stackTop: {}, select: null
  };
  const boards = () => DB.boards;
  const live = () => DB.items.filter((it) => !it.deletedAt);
  const onBoard = (id) => live().filter((it) => (it.boards || []).includes(id));
  const byId = (id) => DB.items.find((it) => it.id === id);
  const wheel = () => boards().concat([{ id: '__new', name: 'New board', isNew: true }]);
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = sanitize(html).replace(/<\/(li|p|div|h[1-6])>|<br\s*\/?>/gi, ' $&'); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }; // lines and list items keep a space between them

  // Every change goes through the app, which replies with the new library (or a plain-English error).
  function call(method, ...args) {
    const r = JSON.parse(N[method](...args));
    if (r.error) { toast(r.error); return null; }
    if (r.state) setDB(r.state);
    return r;
  }
  function setDB(state) {
    const changed = JSON.stringify([DB.boards, DB.items]) !== JSON.stringify([state.boards, state.items]);
    DB = state;
    if (changed) { dataVer++; refresh(); }
    else if (S.screen === 'sync') refresh();
    if (homeEl) homeEl.querySelector('#synced').textContent = statusText();
  }
  window.nbOnState = (json) => setDB(JSON.parse(json));
  window.nbOnToast = (msg) => toast(msg);

  // ---------- helpers ----------
  const app = document.getElementById('app');
  const $ = (q) => app.querySelector(q);
  const { escape: esc, sanitize, autoTidy, noteTitle } = NBText;
  const svg = (d, size = 20, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const P = {
    back: 'M15 18l-6-6 6-6', home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
    plus: 'M12 5v14M5 12h14', sync: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4', photo: 'M3 4h18v16H3zM21 16l-5-5-9 9',
    bin: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    note: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', pc: 'M3 4h18v12H3zM8 20h8M12 16v4', board: 'M4 4h6v8H4zM14 4h6v5h-6zM4 16h6v4H4zM14 13h6v7h-6z', edit: 'M4 20h4L18 10l-4-4L4 16zM14 6l4 4'
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return plural(Math.round(s / 60), 'min') + ' ago';
    if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  let toastTimer = null;
  function toast(msg, undo) {
    const box = $('#toastbox');
    box.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? '<button type="button" data-a="undo">Undo</button>' : ''}</div>`;
    toast.undo = undo || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.undo = null;
      const t = box.firstElementChild;
      if (!t || matchMedia('(prefers-reduced-motion: reduce)').matches) { box.innerHTML = ''; return; }
      t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(.96)' }], { duration: 220, easing: EASE, fill: 'forwards' })
        .onfinish = () => { if (box.firstElementChild === t) box.innerHTML = ''; }; // fades up and away
    }, undo ? 5000 : 2600);
  }
  const tick = () => { try { N.tick(); } catch (e) { /* no haptics */ } };

  // ---------- pieces ----------
  // A crop ({ x, y, w, h } as fractions, set on the PC) only changes how the picture is shown: object-view-box.
  const shapeOf = (it) => (it.w && it.h ? [it.w * (it.crop ? it.crop.w : 1), it.h * (it.crop ? it.crop.h : 1)] : null);
  const vb = (it) => { const c = it.crop; return c ? `object-view-box:inset(${c.y * 100}% ${(1 - c.x - c.w) * 100}% ${(1 - c.y - c.h) * 100}% ${c.x * 100}%);` : ''; };
  const aspect = (it) => { const s = shapeOf(it); return s ? `${s[0]} / ${s[1]}` : '4 / 5'; };
  // The picture (or note text) inside a card. `fill` makes it fill a fixed box (cards in a stack).
  function inner(it, fill) {
    if (it.kind === 'note') {
      const body = textOf(it.html).slice(0, 180);
      return `<div class="notecard${fill ? ' fill' : ''}"><div class="t">${esc(it.title)}</div><div class="p">${esc(body.startsWith(it.title) ? body.slice(it.title.length).trim() : body)}</div></div>`;
    }
    const size = fill ? '' : ` style="aspect-ratio:${aspect(it)}"`;
    const src = url(it.thumb || (it.kind === 'photo' ? it.file : ''));
    const media = src ? `<img src="${src}" alt="" loading="lazy" decoding="async" style="${fill ? '' : `aspect-ratio:${aspect(it)};`}${vb(it)}">` : `<div class="ph"${size}>${svg(it.kind === 'video' ? P.camera : P.photo, 22, 1.6)}</div>`;
    return `<div class="media${fill ? ' fill' : ''}">${media}${it.kind === 'video' ? `<span class="badge" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg></span>` : ''}</div>`;
  }
  function card(it, n) {
    const binned = !!it.deletedAt; // in the Bin, tapping a card offers Put back / Delete forever instead of opening it
    return `<button type="button" class="card" data-a="${binned ? 'binItem' : 'open'}" data-v="${it.id}" style="--d:${Math.min(n * 40, 400)}ms" aria-label="Open ${esc(it.title)}">${inner(it)}</button>`;
  }
  // A stack: its pictures fanned in the space of one card (the first one's shape). Flick left or right to go through them.
  const FAN = [
    { t: 'none', o: 1 },
    { t: 'translate(10%, 2%) rotate(7deg) scale(.92)', o: 1 },
    { t: 'translate(-9%, 3%) rotate(-8deg) scale(.88)', o: 1 },
    { t: 'translate(0, 5%) scale(.86)', o: 0 }
  ];
  const fanStyle = (k) => { const f = FAN[Math.min(k, 3)]; return `--t:${f.t};opacity:${f.o};z-index:${10 - k}${k ? ';pointer-events:none' : ''}`; };
  // A stack keeps a fixed order (oldest first) and remembers its top picture by id, so a sync that
  // re-sorts the list never changes its shape or which picture is showing.
  const stackOrder = (members) => members.slice().sort((x, y) => (x.importedAt || '').localeCompare(y.importedAt || '') || x.id.localeCompare(y.id));
  function stackCard(unordered, n) {
    const members = stackOrder(unordered), id = members[0].stack, len = members.length;
    const top = Math.max(0, members.findIndex((m) => m.id === S.stackTop[id]));
    return `<div class="card stackcard" data-stack="${id}" style="--d:${Math.min(n * 40, 400)}ms">
      <div class="fan" style="aspect-ratio:${aspect(members[0])}">${members.map((m, i) => `<button type="button" class="fanitem" data-a="open" data-v="${m.id}" style="${fanStyle((i - top + len) % len)}" aria-label="Open ${esc(m.title)}, ${i + 1} of ${len} in a stack">${inner(m, true)}</button>`).join('')}</div>
      <span class="stackct" aria-hidden="true">${top + 1}/${len}</span></div>`;
  }
  // Inside a board (`board`), only stacks made in that board group; the rest show as loose cards.
  // Sorted by date taken (`sortKey`): a heading before each new month.
  function gridHTML(list, empty, board, sortKey) {
    const done = new Set(), out = [], months = SO.byMonth(sortKey);
    let month = null;
    const heading = (it) => { if (!months) return; const m = SO.monthOf(it); if (m !== month) { month = m; out.push(`<h3 class="dategroup">${esc(m)}</h3>`); } };
    for (const it of list) {
      if (it.stack && !it.deletedAt && (!board || it.stackIn === board)) {
        if (done.has(it.stack)) continue;
        const members = list.filter((x) => x.stack === it.stack);
        if (members.length > 1) { done.add(it.stack); heading(it); out.push(stackCard(members, out.length)); continue; }
      }
      heading(it);
      out.push(card(it, out.length));
    }
    return out.join('') || `<p class="empty">${empty}</p>`;
  }
  // Brings a stack's next (+1) or previous (-1) picture to the top.
  function turnStack(el, dir) {
    const items = [...el.querySelectorAll('.fanitem')], len = items.length, id = el.dataset.stack;
    const now = Math.max(0, items.findIndex((b) => b.dataset.v === S.stackTop[id]));
    const top = (((now + dir) % len) + len) % len;
    S.stackTop[id] = items[top].dataset.v;
    items.forEach((b, i) => { b.style.cssText = fanStyle((i - top + len) % len); });
    el.querySelector('.stackct').textContent = `${top + 1}/${len}`;
    tick();
  }
  const homeList = () => (S.tab === 'notes' ? live().filter((x) => x.kind === 'note') : live());
  // Home's grid: Recent, Notes, or For you (ideas from Pinterest, picked by the PC).
  const homeGrid = () => (S.tab === 'ideas' ? I.gridHTML('all') : gridHTML(SO.apply(homeList(), 'all'), S.tab === 'notes' ? 'No notes yet. Tap + and choose New note.' : 'Nothing here yet. Tap + to add photos, videos or a note.', null, 'all'));

  function pillsHTML() {
    return wheel().map((b, k) => {
      const n = b.isNew ? 0 : onBoard(b.id).length;
      return `<button type="button" class="pill" data-pill="${k}" aria-label="${esc(b.name)}">${svg(b.isNew ? P.plus : P.board, 22, 1.8)}<span class="nm">${esc(b.name)}</span><span class="ct">${b.isNew ? '' : plural(n, 'item')}</span></button>`;
    }).join('');
  }

  function coverHTML() {
    const cov = S.coverId && byId(S.coverId);
    if (cov && cov.file && cov.kind === 'photo') return `<img class="cover ${S.coverDots ? 'dots' : 'plain'}" src="${url(cov.file)}" alt="" style="${vb(cov)}"><div class="coverfade"></div>`;
    return '<img class="dither" src="img/mani-disperse.png" alt="">';
  }

  function statusText() {
    const s = DB.sync || {};
    return s.paired ? `Synced with ${s.pcName || 'your PC'} · ${ago(s.lastSync)}` : 'Not paired with your PC yet';
  }

  // ---------- screens ----------
  function homeHTML() {
    return `<div class="screen" style="overflow:hidden">
      <div class="hero">
        <div id="coverslot">${coverHTML()}</div>
        <div class="stackwrap" id="stack">${pillsHTML()}</div>
        <div class="micro status"><span id="count" style="color:#F2F2F2">${String(live().length).padStart(2, '0')} items saved</span><br><span id="synced">${esc(statusText())}</span></div>
        <button type="button" class="iconbtn glass coverbtn" data-a="cover" aria-label="Change background">${svg(P.photo, 18, 1.9)}</button>
      </div>
      <div class="lift" id="lift">
        <button type="button" class="grip" data-a="lift" aria-label="Lift items up"></button>
        <div class="panelbar"><div class="seg glass slide" id="homeseg" style="--i:${['recent', 'notes', 'ideas'].indexOf(S.tab)}"><button type="button" class="${S.tab === 'recent' ? 'on' : ''}" data-a="tab" data-v="recent" id="tab-recent">Recent</button><button type="button" class="${S.tab === 'notes' ? 'on' : ''}" data-a="tab" data-v="notes" id="tab-notes">Notes</button><button type="button" class="${S.tab === 'ideas' ? 'on' : ''}" data-a="tab" data-v="ideas" id="tab-ideas">For you</button></div>
          <span id="homesort">${S.tab === 'ideas' ? '' : SO.pillHTML('all')}</span></div>
        <div class="grid anim" id="homegrid">${homeGrid()}</div>
      </div>
      <div class="topglass" id="topglass"></div>
      <div class="topbar"><div class="wordmark">notebook<span>.</span></div></div>
    </div>`;
  }

  const boardGrid = (id) => (S.btab === 'ideas' ? I.gridHTML(id) : gridHTML(SO.apply(onBoard(id), id), 'Nothing on this board yet. Open an item and tap this board, or tap + while you\'re here.', id, id));
  function boardHTML() {
    const b = boards().find((x) => x.id === S.board);
    if (!b) return null;
    const list = onBoard(b.id);
    const cov = list.find((x) => x.thumb || (x.kind === 'photo' && x.file));
    return `<div class="screen">
      <div style="position:relative;height:calc(var(--st) + 300px)">
        ${cov ? `<img src="${url(cov.thumb || cov.file)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(2px);${vb(cov)}">` : ''}
        <div class="coverfade"></div>
        <button type="button" class="iconbtn glass" data-a="boardBack" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px">${svg(P.back)}</button>
        <button type="button" class="iconbtn glass" data-a="editBoard" aria-label="Rename or delete board" style="position:absolute;top:calc(var(--st) + 10px);right:16px">${svg(P.edit, 18)}</button>
        <div style="position:absolute;left:16px;right:16px;bottom:18px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span class="poster" id="boardname" style="font-size:60px">${esc(b.name)}</span><span class="micro" id="boardcount">${plural(list.length, 'item')}</span></div>
      </div>
      <div class="panelbar boardbar"><div class="seg glass slide" id="boardseg" style="--i:${S.btab === 'ideas' ? 1 : 0}"><button type="button" class="${S.btab === 'ideas' ? '' : 'on'}" data-a="btab" data-v="saved" id="btab-saved">Saved</button><button type="button" class="${S.btab === 'ideas' ? 'on' : ''}" data-a="btab" data-v="ideas" id="btab-ideas">Ideas</button></div><span id="boardsort" style="margin-left:auto">${S.btab === 'ideas' ? '' : SO.pillHTML(b.id)}</span></div>
      <div class="grid anim" id="boardgrid">${boardGrid(b.id)}</div>
    </div>`;
  }

  // The open item's screen (item.js).
  const { itemHTML, peekHTML } = NBItem({ S, esc, svg, P, url, vb, sanitize, byId, boards, arStyle: (it) => arStyle(it) });

  // The pictures an open item can be swiped through: those in the grid it was opened from, in order.
  const swipeList = () => {
    const seen = new Set();
    return [...(underEl || homeEl || document).querySelectorAll('.grid [data-a="open"][data-v]')].map((b) => b.dataset.v)
      .filter((id) => { const it = byId(id); return it && it.kind !== 'note' && !seen.has(id) && seen.add(id); });
  };
  // Swiped to another picture: it takes this one's place (no animation: it's already where it belongs).
  function swapItem(id, carry) {
    flushSave();
    S.item = id;
    const old = currentEl, el = build('item');
    if (!el) return;
    el.dataset.screen = 'item';
    el.dataset.ver = dataVer;
    old.replaceWith(el);
    currentEl = el;
    wireItem(el, carry);
    updateChrome();
  }

  // Search: titles, notes (on photos and in notes) and board names. Only the results update as you type.
  function matches(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return live().filter((it) => {
      const hay = [it.title, it.caption, it.kind === 'note' ? textOf(it.html) : '', ...(it.boards || []).map((id) => (boards().find((b) => b.id === id) || {}).name)].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  const searchResults = () => (S.query || '').trim()
    ? gridHTML(matches(S.query), `Nothing matches “${esc(S.query.trim())}”.`)
    : '<p class="empty">Search your titles, notes and board names.</p>';
  function searchHTML() {
    return `<div class="screen" style="padding-top:calc(var(--st) + 20px)">
      <div style="padding:0 20px 14px"><div class="poster" style="font-size:64px;margin-bottom:14px">Search</div>
        <input class="field searchbox" id="q" type="search" enterkeyhint="search" placeholder="Try “black” or “outfits”" autocomplete="off" aria-label="Search" value="${esc(S.query || '')}"></div>
      <div class="grid" id="searchgrid">${searchResults()}</div>
    </div>`;
  }

  const binned = () => DB.items.filter((it) => it.deletedAt);
  function binHTML() {
    const list = binned();
    return `<div class="screen" style="padding-top:calc(var(--st) + 70px)">
      <button type="button" class="iconbtn glass" data-a="binBack" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px">${svg(P.back)}</button>
      <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:baseline;gap:12px"><span class="poster" style="font-size:64px">Bin</span><span class="micro" id="bincount">${plural(list.length, 'item')}</span></div>
        <div style="font-size:14px;color:var(--text-3)">Things stay here until you delete them. Tap one to put it back.</div>
        <button type="button" class="btn danger" data-a="emptyBin" id="emptybin" style="align-self:flex-start"${list.length ? '' : ' hidden'}>${svg(P.bin, 16)}<span>Empty Bin</span></button>
      </div>
      <div class="grid" id="bingrid">${gridHTML(list, 'The Bin is empty.')}</div>
    </div>`;
  }

  const { syncHTML, syncBodyHTML, showSyncMsg } = NBSyncScreen({ S, $, db: () => DB, esc, svg, P, ago, plural, live, binned, statusText, home: () => homeEl, toast });

  // ---------- persistent parts ----------
  function chromeHTML() {
    return `<div id="stage"></div>
    <nav class="nav glass" id="nav" aria-label="Main">
      <button type="button" class="navbtn" data-a="home" id="nav-home" aria-label="Home">${svg(P.home)}<span class="navlbl">Home</span></button>
      <button type="button" class="navbtn" data-a="search" id="nav-search" aria-label="Search">${svg(P.search)}<span class="navlbl">Search</span></button>
      <button type="button" class="addbtn" data-a="add" id="addbtn" aria-label="Add" aria-expanded="false">${svg(P.plus, 22, 2.4)}</button>
      <button type="button" class="navbtn" data-a="sync" id="nav-sync" aria-label="Sync">${svg(P.sync)}<span class="navlbl">Sync</span></button>
    </nav>
    <div class="popscrim" id="popscrim" data-a="closePops" hidden></div>
    <div class="popsheet frost" id="addsheet" hidden>
      <button type="button" class="addrow" data-a="addGallery">${svg(P.photo, 20, 1.9)}Photos and videos from Gallery</button>
      <button type="button" class="addrow" data-a="addCamera">${svg(P.camera, 20, 1.9)}Take a photo</button>
      <button type="button" class="addrow" data-a="addNote">${svg(P.note, 20, 1.9)}New note</button>
    </div>
    <div class="popsheet frost" id="coversheet" hidden>
      <div class="pophead" data-pop-drag><span class="lbl">Background</span><button type="button" class="btn popdone" data-a="closePops">Done</button></div>
      <div class="seg coverseg" style="background:rgba(255,255,255,.06)"><button type="button" data-a="dots" id="seg-dots">Dotted</button><button type="button" data-a="plain" id="seg-plain">Photo</button></div>
      <div class="tiles" id="tiles"></div>
    </div>
    <div class="popsheet frost formsheet" id="formsheet" hidden></div>
    <div class="popsheet frost selbar" id="selbar" hidden><span id="selcount" style="flex:1;font-weight:600"></span><button type="button" class="btn" data-a="selCancel">Cancel</button><button type="button" class="btn white" data-a="selStack" id="selstack">Stack</button></div>
    <div id="toastbox"></div>`;
  }

  function tilesHTML() {
    const tiles = [{ id: '', label: 'MANI' }].concat(live().filter((x) => x.kind === 'photo' && x.file).map((x) => ({ id: x.id, label: x.title, img: url(x.thumb || x.file) })));
    return tiles.map((t) => { const on = S.coverId === t.id; return `<button type="button" class="tile${on ? ' on' : ''}" aria-pressed="${on}" aria-label="Use ${esc(t.label)} as cover" data-a="coverPick" data-v="${t.id}">${t.img ? `<img src="${t.img}" alt="" loading="lazy" decoding="async">` : '<span class="manitile">MANI</span>'}</button>`; }).join('');
  }

  const showSheet = (el, on) => M.showSheet(el, on);
  const closePops = () => { if (S.sheet) closeForm(); S.add = S.cover = false; updateChrome(); };

  function updateChrome() {
    // The bar slides away under an open item and back when it closes. An open item sits on top of the
    // screen it came from, so that screen's tab stays selected (nothing pops in on the way back).
    const nav = $('#nav'), hide = S.screen === 'item', calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tab = S.screen === 'item' ? (S.prev === 'item' ? 'home' : S.prev) : S.screen;
    if (hide !== !!nav.dataset.away) {
      nav.dataset.away = hide ? '1' : '';
      nav.inert = hide;
      nav.getAnimations().forEach((x) => x.cancel());
      if (!hide) nav.hidden = false;
      if (!calm) {
        const a = nav.animate([{ opacity: 1, translate: '-50% 0' }, { opacity: 0, translate: '-50% 28px' }], { duration: hide ? 240 : 380, easing: EASE, direction: hide ? 'normal' : 'reverse', fill: hide ? 'forwards' : 'none' });
        if (hide) a.onfinish = () => { if (nav.dataset.away) nav.hidden = true; a.cancel(); };
      } else nav.hidden = hide;
    }
    $('#nav-home').classList.toggle('on', tab === 'home');
    $('#nav-sync').classList.toggle('on', tab === 'sync' || tab === 'bin');
    $('#nav-search').classList.toggle('on', tab === 'search');
    for (const el of app.querySelectorAll('.navbtn[id]')) {
      if (el.classList.contains('on')) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    $('#addbtn').classList.toggle('open', S.add);
    $('#addbtn').setAttribute('aria-expanded', String(S.add));
    showSheet($('#addsheet'), S.add);
    const cs = $('#coversheet');
    if (S.cover && cs.hidden) $('#tiles').innerHTML = tilesHTML();
    showSheet(cs, S.cover);
    $('#seg-dots').classList.toggle('on', S.coverDots);
    $('#seg-plain').classList.toggle('on', !S.coverDots);
    showSheet($('#formsheet'), !!S.sheet);
    showSheet($('#popscrim'), S.add || S.cover || !!S.sheet);
    const n = S.select ? S.select.size : 0;
    showSheet($('#selbar'), !!S.select);
    const cards = S.select ? M.pickedCards() : 0;
    if (S.select) { $('#selcount').textContent = cards ? `${cards} picked` : 'Tap things to stack'; $('#selstack').disabled = cards < 2; }
  }

  // ---------- screens: build only the one you move to; Home is kept as you left it ----------
  let homeEl = null, currentEl = null, underEl = null, homeVer = 0, boardSig = '';
  const Wh = NBWheel({ S, N, tick, home: () => homeEl, wheel, pillsHTML, openForm: (k) => openForm(k), go: (...x) => go(...x) });
  const { layoutPills, settle, rebuildWheel, wireWheel, circ } = Wh;
  const M = NBMotion({
    S, app, tick, $, url, updateChrome: () => updateChrome(), home: () => homeEl, current: () => currentEl,
    actions: () => A, db: () => DB, turnStack
  });
  const SO = NBSort({ N, esc });
  const I = NBIdeas({ N, S, $, esc, toast, paired: () => !!(DB.sync || {}).paired, boardName: () => (S.screen === 'board' ? (boards().find((b) => b.id === S.board) || {}).name : ''), rerender: () => { dataVer++; refresh(); } });
  const { animateSwap, setLift, wireHome, wireGrid, markSelection, toggleSelect, endSelect } = M;
  const builders = { home: homeHTML, board: boardHTML, item: itemHTML, sync: syncHTML, search: searchHTML, bin: binHTML };
  const sigOf = () => boards().map((b) => b.id + ':' + b.name).join('|');

  function build(name) {
    const html = builders[name]();
    if (!html) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.firstElementChild;
  }

  function refreshHome() {
    if (!homeEl || homeVer === dataVer) return;
    homeVer = dataVer;
    const sig = sigOf();
    if (sig !== boardSig) { boardSig = sig; rebuildWheel(); }
    else homeEl.querySelectorAll('.pill').forEach((el) => { const b = wheel()[+el.dataset.pill]; if (b && !b.isNew) el.querySelector('.ct').textContent = plural(onBoard(b.id).length, 'item'); });
    const hg = homeEl.querySelector('#homegrid');
    M.flipGrid(hg, () => { hg.innerHTML = homeGrid(); });
    homeEl.querySelector('#count').textContent = String(live().length).padStart(2, '0') + ' items saved';
    homeEl.querySelector('#synced').textContent = statusText();
    homeEl.querySelector('#coverslot').innerHTML = coverHTML();
  }

  // After any library change: update whatever screen is showing, in place.
  function refresh() {
    refreshScreen();
    if (S.select) markSelection();
  }
  function refreshScreen() {
    if (currentEl) currentEl.dataset.ver = dataVer;
    if (S.screen === 'home') refreshHome();
    else if (S.screen === 'board') {
      const b = boards().find((x) => x.id === S.board);
      if (!b) { go('home'); return; }
      const list = onBoard(b.id);
      $('#boardname').textContent = b.name;
      $('#boardcount').textContent = plural(list.length, 'item');
      M.flipGrid($('#boardgrid'), () => { $('#boardgrid').innerHTML = boardGrid(b.id); });
    } else if (S.screen === 'item') {
      const it = byId(S.item);
      if (!it || it.deletedAt) { go(S.prev === 'item' ? 'home' : S.prev, null, it && it.deletedAt ? 'binned' : 'fade'); return; }
      app.querySelectorAll('[data-a="boardToggle"]').forEach((el) => { const on = (it.boards || []).includes(el.dataset.v); el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); });
    } else if (S.screen === 'sync') {
      $('#syncbody').innerHTML = syncBodyHTML();
      $('#binrowcount').textContent = plural(binned().length, 'item');
    } else if (S.screen === 'search') {
      $('#searchgrid').innerHTML = searchResults();
    } else if (S.screen === 'bin') {
      const list = binned();
      $('#bincount').textContent = plural(list.length, 'item');
      $('#emptybin').hidden = !list.length;
      M.flipGrid($('#bingrid'), () => { $('#bingrid').innerHTML = gridHTML(list, 'The Bin is empty.'); });
    }
  }

  // The photo's shape (width / height) for the rounded media frame; the stage falls back to a plain fit without it.
  const arStyle = (it) => { const s = shapeOf(it); return s && s[0] > 0 && s[1] > 0 ? `--ar:${(s[0] / s[1]).toFixed(4)}` : ''; };

  function showScreen(kind) {
    const stage = $('#stage');
    const old = currentEl;
    if (old) old.querySelector('video')?.pause();
    let el;
    if (S.screen === 'home' && homeEl) {
      homeEl.querySelector('#homegrid').classList.remove('anim'); // the first-load entrance is over; changes glide from here
      refreshHome();
      el = homeEl;
    } else if (underEl && underEl.dataset.screen === S.screen && old && old.dataset.screen === 'item') {
      el = underEl; // back from an open item to the board / search it was opened from, as you left it
      el.querySelectorAll('.grid.anim').forEach((g) => g.classList.remove('anim')); // no second entrance
    } else {
      el = build(S.screen);
      if (!el) { S.screen = 'home'; return showScreen('fade'); }
      el.dataset.screen = S.screen;
      el.dataset.ver = dataVer;
      if (S.screen === 'home') { homeEl = el; homeVer = dataVer; boardSig = sigOf(); }
    }
    // A quick return can reuse Home before its previous exit animation finishes.
    // Cancel that exit so its callback cannot remove the screen we just returned to.
    el.getAnimations().forEach((animation) => animation.cancel());
    el.inert = false;
    el.style.visibility = '';
    el.style.pointerEvents = '';
    underEl = S.screen === 'item' && old && old !== homeEl ? old : null; // kept under an open item (photo or note)
    for (const stale of [...stage.children]) {
      if (stale === old || stale === el || stale === underEl) continue;
      stale.getAnimations().forEach((animation) => animation.cancel());
      if (stale === homeEl) stale.style.visibility = 'hidden'; else stale.remove();
    }
    // Moving a screen within the page resets its scrolling: note where it was and put it back after.
    const scrolled = [el, ...el.querySelectorAll('.lift')].map((n) => [n, n.scrollTop]);
    const back = kind === 'unzoom' || kind === 'pop';
    if (el !== old && (el.parentNode !== stage || !back)) stage.appendChild(el); // going back, it's already in place under the one leaving
    currentEl = el;
    if (S.screen === 'home' && !el.dataset.wired) { el.dataset.wired = '1'; layoutPills(); wireHome(el); wireWheel(el); }
    if (S.screen === 'item') wireItem(el);
    el.querySelectorAll('.grid').forEach(wireGrid);
    if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
    if (S.screen === 'search') {
      const q = el.querySelector('#q');
      q.addEventListener('input', () => { S.query = q.value; el.querySelector('#searchgrid').innerHTML = searchResults(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
      if (!S.query) setTimeout(() => q.focus(), 350);
    }
    animateSwap(old, el, kind);
    for (const [n, top] of scrolled) if (n.scrollTop !== top) n.scrollTop = top;
    // A kept screen catches up, only if something changed while it was covered (no needless redraw).
    if (el.dataset.screen && el === old?.previousElementSibling && +el.dataset.ver !== dataVer) refreshScreen();
    updateChrome();
  }

  function go(screen, extra, kind) {
    if (document.activeElement && document.activeElement.matches('input, textarea, [contenteditable="true"]')) document.activeElement.blur();
    Object.assign(S, extra || {}, { screen, add: false, cover: false, sheet: null, select: null });
    showScreen(kind || 'fade');
  }

  // Notes and captions save a moment after you stop typing.
  let saveTimer = null;
  function saveSoon(fn) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; fn(); }, 600); }
  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; if (flushSave.fn) flushSave.fn(); } }
  function wireItem(root, carry) {
    const it = byId(S.item);
    flushSave.fn = null;
    const note = root.querySelector('#note');
    if (note) {
      flushSave.fn = () => call('update', it.id, JSON.stringify({ caption: note.value }));
      note.addEventListener('input', () => saveSoon(flushSave.fn));
    }
    const ed = root.querySelector('#editor');
    if (ed) {
      S.tidyUndo = null;
      flushSave.fn = () => { const html = sanitize(ed.innerHTML); call('update', it.id, JSON.stringify({ html, title: noteTitle(html) })); };
      ed.addEventListener('input', () => { if (S.tidyUndo !== null) { S.tidyUndo = null; $('#tidybtn').textContent = 'Tidy up'; } saveSoon(flushSave.fn); });
      ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
      if (!it.html) setTimeout(() => ed.focus(), 350);
    }
    const img = root.querySelector('img[data-full]');
    if (img && img.dataset.full !== img.getAttribute('src')) {
      const full = new Image();
      full.src = img.dataset.full;
      full.decode().then(() => { img.src = full.src; }, () => { img.src = full.src; });
    }
    NBMedia.wire(root);
    NBViewer.wire(root, { id: it.id, list: swipeList(), peek: peekHTML, go: swapItem, close: () => A.leaveItem(), under: () => underEl || homeEl, carry });
  }

  // ---------- small forms (new board, rename, type pairing code): forms.js ----------
  const { openForm, closeForm, saveForm } = NBForms({ S, $, N, esc, boards, byId, call, toast, wheel, settle, circ, showSyncMsg, updateChrome: () => updateChrome() });

  // ---------- actions ----------
  const TABS = { home: 0, board: 0, search: 1, sync: 2, bin: 2 };
  const tabKind = (to) => { const from = TABS[S.screen] ?? 0; return TABS[to] === from ? 'fade' : TABS[to] > from ? 'tabR' : 'tabL'; };
  const currentBoard = () => (S.screen === 'board' ? S.board : '');
  const A = {
    home: () => go('home', null, tabKind('home')),
    boardBack: () => go('home', null, 'pop'),
    sync: () => go('sync', null, tabKind('sync')),
    search: () => go('search', null, tabKind('search')),
    selCancel: () => endSelect(),
    stackIds: (ids) => { if (call('stack', JSON.stringify(ids), currentBoard())) toast('Stacked. Flick it sideways to go through them.'); },
    selStack: () => { const ids = [...S.select]; if (call('stack', JSON.stringify(ids), currentBoard())) { endSelect(); toast(`Stacked ${ids.length}. Flick it sideways to go through them.`); } },
    unstack: () => { const it = byId(S.item); if (it && call('unstack', it.id)) { toast('Taken out of the stack'); A.leaveItem(); } },
    openBin: () => go('bin', null, 'push'),
    binBack: () => go('sync', null, 'pop'),
    binItem: (v) => { S.binItem = v; openForm('binItem'); },
    restoreItem: () => { const it = byId(S.binItem); if (it && call('restore', it.id)) { closeForm(); toast('Put back'); } },
    deleteForever: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'Tap again to delete for good'; return; }
      if (call('deleteForever', S.binItem)) { closeForm(); toast('Deleted for good'); }
    },
    emptyBin: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.querySelector('span').textContent = `Tap again to delete ${plural(binned().length, 'item')} for good`; return; }
      const r = call('deleteForever', '');
      if (r) toast(`Deleted ${plural(Number(r.id) || 0, 'item')} for good`);
    },
    add: () => { S.add = !S.add; S.cover = false; S.sheet = null; updateChrome(); },
    cover: () => { S.cover = !S.cover; S.add = false; updateChrome(); },
    coverPick: (v) => {
      S.coverId = v || ''; N.setPref('coverId', S.coverId); homeEl.querySelector('#coverslot').innerHTML = coverHTML();
      $('#tiles').querySelectorAll('.tile').forEach((el) => { const on = el.dataset.v === S.coverId; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); });
    },
    dots: () => { S.coverDots = true; N.setPref('coverDots', '1'); homeEl.querySelector('#coverslot').innerHTML = coverHTML(); updateChrome(); },
    plain: () => { S.coverDots = false; N.setPref('coverDots', '0'); homeEl.querySelector('#coverslot').innerHTML = coverHTML(); updateChrome(); },
    tab: (v) => {
      if (S.tab === v || !homeEl) return;
      const order = ['recent', 'notes', 'ideas'], dir = order.indexOf(v) > order.indexOf(S.tab) ? -1 : 1;
      S.tab = v;
      for (const t of order) homeEl.querySelector('#tab-' + t).classList.toggle('on', v === t);
      homeEl.querySelector('#homeseg').style.setProperty('--i', order.indexOf(v));
      const grid = homeEl.querySelector('#homegrid');
      homeEl.querySelector('#homesort').innerHTML = v === 'ideas' ? '' : SO.pillHTML('all');
      const swap = () => {
        grid.classList.remove('anim'); grid.innerHTML = homeGrid();
        grid.animate([{ opacity: 0, transform: `translateX(${-dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: NORMAL, easing: EASE });
      };
      grid.getAnimations().forEach((x) => x.cancel());
      grid.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 28}px)` }], { duration: FAST, easing: EASE, fill: 'forwards' }).onfinish = (e) => { e.target.cancel(); swap(); };
    },
    lift: () => setLift(!S.lift),
    btab: (v) => {
      if ((S.btab || 'saved') === v || S.screen !== 'board') return;
      S.btab = v;
      $('#btab-saved').classList.toggle('on', v === 'saved'); $('#btab-ideas').classList.toggle('on', v === 'ideas');
      $('#boardseg').style.setProperty('--i', v === 'ideas' ? 1 : 0);
      $('#boardsort').innerHTML = v === 'ideas' ? '' : SO.pillHTML(S.board);
      const g = $('#boardgrid');
      g.classList.remove('anim'); g.innerHTML = boardGrid(S.board);
      g.animate([{ opacity: 0, transform: `translateX(${v === 'ideas' ? 28 : -28}px)` }, { opacity: 1, transform: 'none' }], { duration: NORMAL, easing: EASE });
    },
    idea: (v) => { const html = I.sheetHTML(v); if (!html) return; S.sheet = 'idea'; S.add = false; S.cover = false; $('#formsheet').innerHTML = html; updateChrome(); tick(); },
    ideaSave: () => { I.save(S.screen === 'board' ? S.board : ''); closeForm(); },
    ideaHide: () => { closeForm(); I.hide(); },
    ideaOpen: () => { I.openPin(); closeForm(); },
    ideasNow: () => I.now(),
    closePops,
    // Sort: a small sheet of choices; the cards glide to their new places.
    sortOpen: (x, el) => { if (!SO.closeMenu()) { SO.openMenu(app, el, S.screen === 'board' ? S.board : 'all'); tick(); } },
    sortPick: (v) => {
      const onBoardScreen = S.screen === 'board', key = onBoardScreen ? S.board : 'all';
      SO.closeMenu();
      if (SO.get(key) === v) return;
      SO.set(key, v);
      const grid = onBoardScreen ? $('#boardgrid') : homeEl && homeEl.querySelector('#homegrid');
      if (!grid) return;
      grid.classList.remove('anim');
      M.flipGrid(grid, () => { grid.innerHTML = onBoardScreen ? boardGrid(key) : homeGrid(); });
      (onBoardScreen ? $('#boardsort') : homeEl.querySelector('#homesort')).innerHTML = SO.pillHTML(key);
    },
    addGallery: () => { S.add = false; updateChrome(); N.pick(currentBoard()); },
    addCamera: () => { S.add = false; updateChrome(); N.camera(currentBoard()); },
    addNote: () => { const r = call('addNote', currentBoard()); if (r) go('item', { item: r.id, prev: S.screen }); },
    open: (v) => go('item', { item: v, prev: S.screen }, 'zoom'),
    back: () => { if (S.screen !== 'item' || !NBViewer.back()) A.leaveItem(); },
    leaveItem: () => { flushSave(); const to = S.prev === 'item' ? 'home' : S.prev; if (S.screen === 'item') go(to, null, 'unzoom'); else go(to, null, S.screen === 'board' ? 'pop' : 'fade'); },
    bin: () => {
      flushSave();
      const id = S.item;
      if (!call('bin', id)) return;
      if (S.screen === 'item') go(S.prev === 'item' ? 'home' : S.prev);
      toast('Moved to Bin', () => call('restore', id));
    },
    undo: () => { const f = toast.undo; $('#toastbox').innerHTML = ''; toast.undo = null; if (f) f(); },
    boardToggle: (v) => {
      const it = byId(S.item);
      const has = (it.boards || []).includes(v);
      call('update', it.id, JSON.stringify({ boards: has ? it.boards.filter((x) => x !== v) : (it.boards || []).concat(v) }));
    },
    tidy: (x, el) => {
      const ed = $('#editor');
      if (S.tidyUndo !== null) { ed.innerHTML = S.tidyUndo; S.tidyUndo = null; el.textContent = 'Tidy up'; }
      else {
        const t = autoTidy(ed.innerText);
        if (!t) { toast('Write something first, then tidy it'); return; }
        S.tidyUndo = ed.innerHTML; ed.innerHTML = t; el.textContent = 'Undo tidy';
        ed.classList.remove('tidied'); void ed.offsetWidth; ed.classList.add('tidied');
      }
      clearTimeout(saveTimer); saveTimer = null;
      if (flushSave.fn) flushSave.fn();
    },
    editBoard: () => openForm('editBoard'),
    deleteBoard: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'Tap again to delete'; return; }
      const name = (boards().find((b) => b.id === S.board) || {}).name;
      if (call('deleteBoard', S.board)) { closeForm(); go('home'); toast(`Deleted the board “${name}”. Its items are still in your notebook.`); }
    },
    closeForm: () => closeForm(),
    saveForm: () => saveForm(),
    scan: () => { showSyncMsg(''); N.scan(); },
    manual: () => openForm('manual'),
    syncNow: () => { showSyncMsg(''); N.sync(); },
    unpair: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'Tap again to forget this PC'; return; }
      DB = JSON.parse(N.unpair());
      $('#syncbody').innerHTML = syncBodyHTML();
      if (homeEl) homeEl.querySelector('#synced').textContent = statusText();
    }
  };
  app.addEventListener('click', (e) => {
    if (M.takeSwallowed()) return;
    if (!e.target.closest('.sortmenu, .sortpill')) SO.closeMenu(); // a tap anywhere else closes the sort menu
    if (S.select && e.target.closest('.grid .card:not(.idea)')) { toggleSelect(e.target.closest('.grid .card')); return; }
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.v, el);
  });
  app.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.nbBack(); else if (e.key === 'Enter' && e.target.classList.contains('field')) saveForm(); });

  // Android back gesture: close a panel or step back before leaving the app.
  window.nbBack = () => {
    if (S.select) { endSelect(); return true; }
    if (SO.closeMenu()) return true;
    if (S.sheet) { closeForm(); return true; }
    if (S.add || S.cover) { S.add = S.cover = false; updateChrome(); return true; }
    if (S.screen === 'home' && S.lift) { setLift(false); return true; }
    if (S.screen === 'item') { A.back(); return true; }
    if (S.screen === 'board') { A.boardBack(); return true; }
    if (S.screen === 'bin') { A.binBack(); return true; }
    if (S.screen !== 'home') { A.home(); return true; }
    return false;
  };
  const setHero = () => app.style.setProperty('--hero', Math.round(Math.min(600, window.innerHeight * 0.7)) + 'px');
  window.addEventListener('resize', setHero);
  setHero();
  app.innerHTML = chromeHTML();
  M.wirePops([...app.querySelectorAll('#addsheet, #coversheet, #formsheet')], closePops);
  showScreen('fade');
  // Catch up with the PC quietly when the app opens, and keep "synced x min ago" current.
  if ((DB.sync || {}).paired) setTimeout(() => N.syncQuiet(), 1200);
  setInterval(() => {
    if (homeEl) homeEl.querySelector('#synced').textContent = statusText();
    if (S.screen === 'sync' && $('#synclast')) $('#synclast').textContent = ago((DB.sync || {}).lastSync);
  }, 30000);
})();
