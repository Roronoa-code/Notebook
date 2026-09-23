// Notebook on the phone: the screens. Data lives in the app (window.NBNative, see MainActivity.java);
// this file only draws and asks the app to make changes. Screens update in place, never full redraws.
(() => {
  const N = window.NBNative;
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
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = sanitize(html); return (d.textContent || '').trim(); };

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
    note: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', pc: 'M3 4h18v12H3zM8 20h8M12 16v4', board: 'M4 5h16v14H4zM4 10h16', edit: 'M4 20h4L18 10l-4-4L4 16zM14 6l4 4'
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
      t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(.96)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' })
        .onfinish = () => { if (box.firstElementChild === t) box.innerHTML = ''; }; // fades up and away
    }, undo ? 5000 : 2600);
  }
  const tick = () => { try { N.tick(); } catch (e) { /* no haptics */ } };

  // ---------- pieces ----------
  const aspect = (it) => (it.w && it.h ? `${it.w} / ${it.h}` : '4 / 5');
  // The picture (or note text) inside a card. `fill` makes it fill a fixed box (cards in a stack).
  function inner(it, fill) {
    if (it.kind === 'note') {
      const body = textOf(it.html).slice(0, 180);
      return `<div class="notecard${fill ? ' fill' : ''}"><div class="t">${esc(it.title)}</div><div class="p">${esc(body.startsWith(it.title) ? body.slice(it.title.length).trim() : body)}</div></div>`;
    }
    const size = fill ? '' : ` style="aspect-ratio:${aspect(it)}"`;
    const src = url(it.thumb || (it.kind === 'photo' ? it.file : ''));
    const media = src ? `<img src="${src}" alt="" loading="lazy" decoding="async"${size}>` : `<div class="ph"${size}>${svg(it.kind === 'video' ? P.camera : P.photo, 22, 1.6)}</div>`;
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
  function gridHTML(list, empty, board) {
    const done = new Set(), out = [];
    for (const it of list) {
      if (it.stack && !it.deletedAt && (!board || it.stackIn === board)) {
        if (done.has(it.stack)) continue;
        const members = list.filter((x) => x.stack === it.stack);
        if (members.length > 1) { done.add(it.stack); out.push(stackCard(members, out.length)); continue; }
      }
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

  function pillsHTML() {
    return wheel().map((b, k) => {
      const n = b.isNew ? 0 : onBoard(b.id).length;
      return `<button type="button" class="pill" data-pill="${k}" aria-label="${esc(b.name)}">${svg(b.isNew ? P.plus : P.board, 18, 1.8)}<span class="nm">${esc(b.name)}</span><span class="ct">${b.isNew ? '' : plural(n, 'item')}</span></button>`;
    }).join('');
  }

  function coverHTML() {
    const cov = S.coverId && byId(S.coverId);
    if (cov && cov.file && cov.kind === 'photo') return `<img class="cover ${S.coverDots ? 'dots' : 'plain'}" src="${url(cov.file)}" alt=""><div class="coverfade"></div>`;
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
        <button type="button" class="iconbtn glass coverbtn" data-a="cover" aria-label="Change cover">${svg(P.photo, 18, 1.9)}</button>
      </div>
      <div class="lift" id="lift">
        <button type="button" class="grip" data-a="lift" aria-label="Lift items up"></button>
        <div class="grid anim" id="homegrid">${gridHTML(homeList(), 'Nothing here yet. Tap + to add photos, videos or a note.')}</div>
      </div>
      <div class="topglass" id="topglass"></div>
      <div class="topbar"><div class="wordmark">notebook<span>.</span></div>
        <div class="seg glass"><button type="button" class="on" data-a="tab" data-v="recent" id="tab-recent">Recent</button><button type="button" data-a="tab" data-v="notes" id="tab-notes">Notes</button></div>
      </div>
    </div>`;
  }

  function boardHTML() {
    const b = boards().find((x) => x.id === S.board);
    if (!b) return null;
    const list = onBoard(b.id);
    const cov = list.find((x) => x.thumb || (x.kind === 'photo' && x.file));
    return `<div class="screen">
      <div style="position:relative;height:calc(var(--st) + 300px)">
        ${cov ? `<img src="${url(cov.thumb || cov.file)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(2px)">` : ''}
        <div class="coverfade"></div>
        <button type="button" class="iconbtn glass" data-a="boardBack" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px">${svg(P.back)}</button>
        <button type="button" class="iconbtn glass" data-a="editBoard" aria-label="Rename or delete board" style="position:absolute;top:calc(var(--st) + 10px);right:16px">${svg(P.edit, 18)}</button>
        <div style="position:absolute;left:22px;right:22px;bottom:18px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span class="poster" id="boardname" style="font-size:60px">${esc(b.name)}</span><span class="micro" id="boardcount">${plural(list.length, 'item')}</span></div>
      </div>
      <div class="grid anim" id="boardgrid" style="padding-top:12px">${gridHTML(list, 'Nothing on this board yet. Open an item and tap this board, or tap + while you\'re here.', b.id)}</div>
    </div>`;
  }

  function itemHTML() {
    const it = byId(S.item);
    if (!it) return null;
    const chips = boards().map((b) => { const on = (it.boards || []).includes(b.id); return `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-a="boardToggle" data-v="${b.id}">${esc(b.name)}</button>`; }).join('');
    let stage;
    if (it.kind === 'note') {
      stage = `<div class="notestage"><div class="notebar"><button type="button" class="btn accent" data-a="tidy" id="tidybtn" style="height:40px">Tidy up</button></div>
        <div class="editor" id="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note" data-placeholder="Start typing, then tap Tidy up to turn it into a heading and bullet points.">${sanitize(it.html)}</div></div>`;
    } else if (it.kind === 'video') {
      // Our own quiet player: plays on a loop with the sound off; tap to pause, drag the line to seek.
      stage = `<div class="scrim"></div><div class="stage" style="${arStyle(it)}"><div class="vbox">
        <img class="vposter" src="${url(it.thumb)}" alt="">
        <video id="vid" src="${url(it.file)}" muted loop playsinline preload="auto" aria-label="${esc(it.title)}"></video>
        <span class="vpaused" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg></span>
        <div class="vbar" role="slider" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><div class="vfill"></div></div>
        <button type="button" class="vsound" aria-label="Sound on" aria-pressed="false">${svg('M11 5L6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6', 18)}</button>
      </div><p class="media-message" role="status"></p></div>`;
    } else {
      stage = `<div class="scrim"></div><div class="stage" style="${arStyle(it)}"><button type="button" class="photo-open" aria-label="Expand photo"><img src="${url(it.thumb || it.file)}" data-full="${url(it.file)}" alt="${esc(it.title)}" decoding="async"></button></div>`;
    }
    // Wide pictures leave room below, so their note and boards start open there.
    return `<div class="screen${it.kind !== 'note' ? ' media-screen' : ''}" style="overflow:hidden">
      ${stage}
      <button type="button" class="iconbtn glass lbback" data-a="back" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px;z-index:4">${svg(P.back)}</button>
      ${it.kind === 'note' ? '<span class="glass kindpill">Note</span>' : ''}
      <div class="sheet frost${it.kind === 'note' ? ' compact' : ''}">
        ${it.kind !== 'note' ? `<details class="media-details"${it.w > it.h * 1.1 ? ' open' : ''}><summary><span>${esc(it.title)}</span><small>Details & boards</small></summary><div class="media-fields">` : '<div class="handle"></div>'}
        ${it.kind !== 'note' ? `<div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="note">Note</label><textarea id="note" class="notebox" placeholder="Why did you save this?">${esc(it.caption || '')}</textarea></div>` : ''}
        <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Boards</span><div class="chips">${chips}</div></div>
        ${it.stack ? `<button type="button" class="btn" data-a="unstack" style="align-self:flex-start">Take out of stack</button>` : ''}
        <div style="display:flex;gap:10px"><button type="button" class="btn danger" data-a="bin">${svg(P.bin, 16)}<span>Move to Bin</span></button><span style="flex:1"></span><button type="button" class="btn white" data-a="back">Done</button></div>
        ${it.kind !== 'note' ? '</div></details>' : ''}
      </div>
    </div>`;
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
      <div style="padding:0 20px 16px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:baseline;gap:12px"><span class="poster" style="font-size:64px">Bin</span><span class="micro" id="bincount">${plural(list.length, 'item')}</span></div>
        <div style="font-size:14px;color:#9A9A9A">Things stay here until you delete them. Tap one to put it back.</div>
        <button type="button" class="btn danger" data-a="emptyBin" id="emptybin" style="align-self:flex-start"${list.length ? '' : ' hidden'}>${svg(P.bin, 16)}<span>Empty Bin</span></button>
      </div>
      <div class="grid" id="bingrid">${gridHTML(list, 'The Bin is empty.')}</div>
    </div>`;
  }

  function syncHTML() {
    return `<div class="screen" style="padding:calc(var(--st) + 20px) 20px calc(var(--sb) + 120px);display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:6px"><div class="poster" style="font-size:64px">Sync</div><div style="font-size:14px;color:#9A9A9A">Phone and PC, over your home Wi-Fi. Nothing goes online.</div></div>
      <div id="syncbody"></div>
      <button type="button" class="glass panel binrow" data-a="openBin"><span style="display:flex;align-items:center;gap:12px">${svg(P.bin, 20, 1.8)}<span style="font-size:16px;font-weight:600">Bin</span></span><span class="micro" id="binrowcount">${plural(binned().length, 'item')}</span></button>
    </div>`;
  }

  function syncBodyHTML() {
    const s = DB.sync || {};
    if (!s.paired) {
      return `<div class="glass panel">
        <div style="font-size:30px;font-weight:300;letter-spacing:-.02em">Pair with your PC</div>
        <ol class="steps"><li>On your PC, open Notebook and click <b>Phone</b>.</li><li>Tap <b>Scan code</b> here and point your camera at the code.</li></ol>
        <div style="font-size:13px;color:#9A9A9A">You only do this once. After that they stay connected and sync on their own whenever you're home.</div>
        <div id="syncmsg" class="syncmsg" hidden></div>
        <button type="button" class="btn white" data-a="scan" style="width:100%">Scan code</button>
        <button type="button" class="linkbtn" data-a="manual">Type the code instead</button>
      </div>`;
    }
    return `<div class="glass panel">
      <div style="display:flex;align-items:center;gap:14px"><span class="pcicon">${svg(P.pc, 24)}</span>
        <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:16px;font-weight:600">${esc(s.pcName || 'Your PC')}</span><span style="font-size:13px;color:#9A9A9A">Paired · syncs on its own when you're home</span></div></div>
      <div id="synctitle" style="font-size:40px;font-weight:200;letter-spacing:-.03em;line-height:1">${S.syncing ? 'Syncing…' : 'Up to date'}</div>
      <div class="bar" id="syncbar"${S.syncing ? '' : ' hidden'}><div></div></div>
      <div id="syncmsg" class="syncmsg" hidden></div>
      <div class="twocol"><div class="stat"><span class="lbl">Last sync</span><span id="synclast">${ago(s.lastSync)}</span></div><div class="stat"><span class="lbl">On this phone</span><span>${plural(live().length, 'item')}</span></div></div>
      <button type="button" class="btn white" data-a="syncNow" style="width:100%">Sync now</button>
      <button type="button" class="linkbtn" data-a="unpair" id="unpairbtn">Forget this PC</button>
    </div>`;
  }

  // ---------- persistent parts ----------
  function chromeHTML() {
    return `<div id="stage"></div>
    <nav class="nav glass" id="nav" aria-label="Main">
      <button type="button" class="navbtn" data-a="home" id="nav-home" aria-label="Home">${svg(P.home)}<span class="navlbl">Home</span></button>
      <button type="button" class="navbtn" data-a="search" id="nav-search" aria-label="Search">${svg(P.search)}<span class="navlbl">Search</span></button>
      <button type="button" class="addbtn" data-a="add" id="addbtn" aria-label="Add" aria-expanded="false">${svg(P.plus, 22, 2.4)}</button>
      <button type="button" class="navbtn" data-a="sync" id="nav-sync" aria-label="Sync">${svg(P.sync)}<span class="navlbl">Sync</span></button>
    </nav>
    <div class="popsheet frost" id="addsheet" hidden>
      <button type="button" class="addrow" data-a="addGallery">${svg(P.photo, 20, 1.9)}Photos and videos from Gallery</button>
      <button type="button" class="addrow" data-a="addCamera">${svg(P.camera, 20, 1.9)}Take a photo</button>
      <button type="button" class="addrow" data-a="addNote">${svg(P.note, 20, 1.9)}New note</button>
    </div>
    <div class="popsheet frost" id="coversheet" hidden style="padding:16px;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;justify-content:space-between"><span class="lbl">Cover</span>
        <div class="seg" style="background:rgba(255,255,255,.06)"><button type="button" data-a="dots" id="seg-dots">Dotted</button><button type="button" data-a="plain" id="seg-plain">Photo</button></div></div>
      <div class="tiles" id="tiles"></div>
    </div>
    <div class="popsheet frost formsheet" id="formsheet" hidden></div>
    <div class="popsheet frost selbar" id="selbar" hidden><span id="selcount" style="flex:1;font-weight:600"></span><button type="button" class="btn" data-a="selCancel">Cancel</button><button type="button" class="btn white" data-a="selStack" id="selstack">Stack</button></div>
    <div id="toastbox"></div>`;
  }

  function tilesHTML() {
    const tiles = [{ id: '', label: 'MANI' }].concat(live().filter((x) => x.kind === 'photo' && x.file).map((x) => ({ id: x.id, label: x.title, img: url(x.thumb || x.file) })));
    return tiles.map((t) => { const on = S.coverId === t.id; return `<button type="button" class="tile${on ? ' on' : ''}" aria-pressed="${on}" aria-label="Use ${esc(t.label)} as cover" data-a="coverPick" data-v="${t.id}">${t.img ? `<img src="${t.img}" alt="">` : '<span class="manitile">MANI</span>'}</button>`; }).join('');
  }

  // Pop-ups rise in (CSS) and sink away (here) instead of vanishing.
  function showSheet(el, on) {
    if (on) {
      el.getAnimations().forEach((x) => x.cancel());
      delete el.dataset.leaving;
      el.inert = false;
      if (el.hidden) el.hidden = false;
      return;
    }
    if (el.hidden || el.dataset.leaving) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.hidden = true; return; }
    el.dataset.leaving = '1';
    el.inert = true;
    const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(26px) scale(.97)' }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    a.onfinish = () => { if (el.dataset.leaving) { el.hidden = true; delete el.dataset.leaving; } el.inert = false; a.cancel(); };
  }

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
        const a = nav.animate([{ opacity: 1, translate: '-50% 0' }, { opacity: 0, translate: '-50% 28px' }], { duration: hide ? 240 : 380, easing: 'cubic-bezier(.2,.75,.25,1)', direction: hide ? 'normal' : 'reverse', fill: hide ? 'forwards' : 'none' });
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
  const { animateSwap, setLift, wireHome, wireGrid, wireDismiss, markSelection, toggleSelect, endSelect } = M;
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
    M.flipGrid(hg, () => { hg.innerHTML = gridHTML(homeList(), 'Nothing here yet. Tap + to add photos, videos or a note.'); });
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
    if (S.screen === 'home') refreshHome();
    else if (S.screen === 'board') {
      const b = boards().find((x) => x.id === S.board);
      if (!b) { go('home'); return; }
      const list = onBoard(b.id);
      $('#boardname').textContent = b.name;
      $('#boardcount').textContent = plural(list.length, 'item');
      M.flipGrid($('#boardgrid'), () => { $('#boardgrid').innerHTML = gridHTML(list, 'Nothing on this board yet.', b.id); });
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
  const arStyle = (it) => (it.w > 0 && it.h > 0 ? `--ar:${(it.w / it.h).toFixed(4)}` : '');

  function showScreen(kind) {
    const stage = $('#stage');
    const old = currentEl;
    if (old) old.querySelector('video')?.pause();
    let el;
    if (S.screen === 'home' && homeEl) {
      homeEl.querySelector('#homegrid').classList.remove('anim'); // the first-load entrance is over; changes glide from here
      refreshHome();
      el = homeEl;
    } else if (underEl && underEl.dataset.screen === S.screen && old && old.classList.contains('media-screen')) {
      el = underEl; // back from an open photo to the board / search it was opened from
    } else {
      el = build(S.screen);
      if (!el) { S.screen = 'home'; return showScreen('fade'); }
      el.dataset.screen = S.screen;
      if (S.screen === 'home') { homeEl = el; homeVer = dataVer; boardSig = sigOf(); }
    }
    // A quick return can reuse Home before its previous exit animation finishes.
    // Cancel that exit so its callback cannot remove the screen we just returned to.
    el.getAnimations().forEach((animation) => animation.cancel());
    el.inert = false;
    el.style.visibility = '';
    el.style.pointerEvents = '';
    underEl = el.classList.contains('media-screen') && old && old !== homeEl ? old : null;
    for (const stale of [...stage.children]) {
      if (stale === old || stale === el || stale === underEl) continue;
      stale.getAnimations().forEach((animation) => animation.cancel());
      if (stale === homeEl) stale.style.visibility = 'hidden'; else stale.remove();
    }
    if (el !== old) stage.appendChild(el);
    currentEl = el;
    if (S.screen === 'home' && !el.dataset.wired) { el.dataset.wired = '1'; layoutPills(); wireHome(el); wireWheel(el); }
    if (S.screen === 'item') { wireItem(el); wireDismiss(el); }
    el.querySelectorAll('.grid').forEach(wireGrid);
    if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
    if (S.screen === 'search') {
      const q = el.querySelector('#q');
      q.addEventListener('input', () => { S.query = q.value; el.querySelector('#searchgrid').innerHTML = searchResults(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
      if (!S.query) setTimeout(() => q.focus(), 350);
    }
    animateSwap(old, el, kind);
    if (el.dataset.screen && el === old?.previousElementSibling) refreshScreen(); // a kept screen catches up
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
  function wireItem(root) {
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
  }

  // ---------- small forms (new board, rename, type pairing code) ----------
  function openForm(kind) {
    S.sheet = kind; S.add = false; S.cover = false;
    const f = $('#formsheet');
    const b = boards().find((x) => x.id === S.board);
    if (kind === 'newBoard') {
      f.innerHTML = `<span class="lbl">New board</span><input class="field" id="f1" maxlength="40" placeholder="Board name" autocomplete="off"><div class="formrow"><button type="button" class="btn" data-a="closeForm">Cancel</button><button type="button" class="btn white" data-a="saveForm">Create</button></div>`;
    } else if (kind === 'editBoard' && b) {
      f.innerHTML = `<span class="lbl">Board</span><input class="field" id="f1" maxlength="40" value="${esc(b.name)}" autocomplete="off"><div class="formrow"><button type="button" class="btn danger" data-a="deleteBoard">Delete board</button><span style="flex:1"></span><button type="button" class="btn white" data-a="saveForm">Save</button></div><div class="hint">Deleting a board keeps everything on it.</div>`;
    } else if (kind === 'binItem' && byId(S.binItem)) {
      const it = byId(S.binItem);
      f.innerHTML = `<span class="lbl">In the Bin</span><div style="font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</div><div class="formrow"><button type="button" class="btn danger" data-a="deleteForever">Delete forever</button><span style="flex:1"></span><button type="button" class="btn white" data-a="restoreItem">Put back</button></div>`;
    } else if (kind === 'manual') {
      f.innerHTML = `<span class="lbl">Pair by typing</span><input class="field" id="f1" inputmode="decimal" placeholder="PC address, e.g. 192.168.0.12" autocomplete="off"><input class="field" id="f2" placeholder="Pairing code" autocapitalize="characters" autocomplete="off"><div class="hint">Both are shown in Notebook on your PC under Phone.</div><div class="formrow"><button type="button" class="btn" data-a="closeForm">Cancel</button><button type="button" class="btn white" data-a="saveForm">Pair</button></div>`;
    }
    updateChrome();
    setTimeout(() => { const i = $('#f1'); if (i) { i.focus(); i.select(); } }, 250);
  }
  function closeForm() { S.sheet = null; updateChrome(); }
  function saveForm() {
    const v1 = ($('#f1') || {}).value || '', v2 = ($('#f2') || {}).value || '';
    if (S.sheet === 'newBoard') {
      const r = call('addBoard', v1);
      if (!r) return;
      closeForm();
      const k = wheel().findIndex((x) => x.id === r.id);
      if (k >= 0) settle(Math.round(S.pos + circ(k, S.pos)));
      toast(`Made “${v1.trim()}”`);
    } else if (S.sheet === 'editBoard') {
      if (call('renameBoard', S.board, v1)) closeForm();
    } else if (S.sheet === 'manual') {
      if (!v1.trim() || !v2.trim()) { toast('Type both the PC address and the code.'); return; }
      closeForm(); showSyncMsg('Pairing…'); N.pairManual(v1, v2);
    }
  }

  // ---------- sync feedback from the app ----------
  function showSyncMsg(msg, isError) {
    const m = $('#syncmsg');
    if (!m) return;
    m.hidden = !msg; m.textContent = msg || ''; m.classList.toggle('err', !!isError);
  }
  window.nbOnSync = (json) => {
    const ev = JSON.parse(json);
    const title = $('#synctitle'), bar = $('#syncbar');
    if (ev.phase === 'error') {
      S.syncing = false;
      if (title) title.textContent = "Couldn't sync";
      if (bar) bar.hidden = true;
      showSyncMsg(ev.message, true);
      if (S.screen !== 'sync') toast(ev.message);
      return;
    }
    if (ev.phase === 'done') {
      S.syncing = false;
      if (ev.status) DB.sync = ev.status;
      if (title) title.textContent = 'Up to date';
      if (bar) bar.hidden = true;
      showSyncMsg('');
      if ($('#synclast')) $('#synclast').textContent = ago((DB.sync || {}).lastSync);
      if (homeEl) homeEl.querySelector('#synced').textContent = statusText();
      return;
    }
    S.syncing = true;
    if (bar) bar.hidden = false;
    const words = { connecting: 'Finding your PC…', merging: 'Syncing…', downloading: `Getting ${ev.done + 1} of ${ev.total}`, uploading: `Sending ${ev.done + 1} of ${ev.total}` };
    if (title) title.textContent = ev.phase === 'connecting' ? words.connecting : 'Syncing…';
    showSyncMsg(ev.phase === 'downloading' || ev.phase === 'uploading' ? words[ev.phase] : '');
  };
  window.nbOnPair = (json) => {
    const ev = JSON.parse(json);
    if (ev.ok) {
      DB.sync = ev.status;
      toast(`Paired with ${ev.status.pcName || 'your PC'}`);
      if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
      if (homeEl) homeEl.querySelector('#synced').textContent = statusText();
    } else { showSyncMsg(ev.message, true); toast(ev.message); }
  };

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
    unstack: () => { const it = byId(S.item); if (it && call('unstack', it.id)) { toast('Taken out of the stack'); A.back(); } },
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
    coverPick: (v) => { S.coverId = v || ''; N.setPref('coverId', S.coverId); homeEl.querySelector('#coverslot').innerHTML = coverHTML(); $('#tiles').innerHTML = tilesHTML(); },
    dots: () => { S.coverDots = true; N.setPref('coverDots', '1'); homeEl.querySelector('#coverslot').innerHTML = coverHTML(); updateChrome(); },
    plain: () => { S.coverDots = false; N.setPref('coverDots', '0'); homeEl.querySelector('#coverslot').innerHTML = coverHTML(); updateChrome(); },
    tab: (v) => {
      if (S.tab === v || !homeEl) return;
      S.tab = v;
      homeEl.querySelector('#tab-recent').classList.toggle('on', v === 'recent');
      homeEl.querySelector('#tab-notes').classList.toggle('on', v === 'notes');
      const grid = homeEl.querySelector('#homegrid'), dir = v === 'notes' ? -1 : 1;
      const swap = () => {
        grid.classList.remove('anim'); grid.innerHTML = gridHTML(homeList(), v === 'notes' ? 'No notes yet. Tap + and choose New note.' : 'Nothing here yet.');
        grid.animate([{ opacity: 0, transform: `translateX(${-dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.75,.25,1)' });
      };
      grid.getAnimations().forEach((x) => x.cancel());
      grid.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 28}px)` }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).onfinish = (e) => { e.target.cancel(); swap(); };
    },
    lift: () => setLift(!S.lift),
    addGallery: () => { S.add = false; updateChrome(); N.pick(currentBoard()); },
    addCamera: () => { S.add = false; updateChrome(); N.camera(currentBoard()); },
    addNote: () => { const r = call('addNote', currentBoard()); if (r) go('item', { item: r.id, prev: S.screen }); },
    open: (v) => go('item', { item: v, prev: S.screen }, 'zoom'),
    back: () => { flushSave(); const to = S.prev === 'item' ? 'home' : S.prev; if (S.screen === 'item') go(to, null, 'unzoom'); else go(to, null, S.screen === 'board' ? 'pop' : 'fade'); },
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
    if (S.select && e.target.closest('.grid .card')) { toggleSelect(e.target.closest('.grid .card')); return; }
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.v, el);
  });
  app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('field')) saveForm(); });

  // Android back gesture: close a panel or step back before leaving the app.
  window.nbBack = () => {
    if (NBMedia.closePhoto()) return true;
    if (S.select) { endSelect(); return true; }
    if (S.sheet) { closeForm(); return true; }
    if (S.add || S.cover) { S.add = S.cover = false; updateChrome(); return true; }
    if (S.screen === 'home' && S.lift) { setLift(false); return true; }
    if (S.screen === 'item') { A.back(); return true; }
    if (S.screen === 'board') { go('home', null, 'pop'); return true; }
    if (S.screen !== 'home') { go('home'); return true; }
    return false;
  };
  const setHero = () => app.style.setProperty('--hero', Math.round(Math.min(600, window.innerHeight * 0.7)) + 'px');
  window.addEventListener('resize', setHero);
  setHero();
  app.innerHTML = chromeHTML();
  showScreen('fade');
  // Catch up with the PC quietly when the app opens, and keep "synced x min ago" current.
  if ((DB.sync || {}).paired) setTimeout(() => N.syncQuiet(), 1200);
  setInterval(() => {
    if (homeEl) homeEl.querySelector('#synced').textContent = statusText();
    if (S.screen === 'sync' && $('#synclast')) $('#synclast').textContent = ago((DB.sync || {}).lastSync);
  }, 30000);
})();
