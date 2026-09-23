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
    coverId: pref('coverId', ''), coverDots: pref('coverDots', '1') === '1', tidyUndo: null, syncing: false
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
  function setDB(state) { DB = state; dataVer++; refresh(); }
  window.nbOnState = (json) => setDB(JSON.parse(json));
  window.nbOnToast = (msg) => toast(msg);

  // ---------- helpers ----------
  const app = document.getElementById('app');
  const $ = (q) => app.querySelector(q);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'P', 'DIV', 'BR']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const walk = (node) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1 || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'IMG'].includes(c.tagName)) { c.remove(); continue; }
        walk(c);
        if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
        for (const a of [...c.attributes]) c.removeAttribute(a.name);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }
  // Tidy up (no AI): the first phrase becomes a heading, the rest bullet points. Same rules as the PC.
  function autoTidy(text) {
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const clean = String(text || '').replace(/([?!.])\1+/g, '$1').replace(/^\s*[-*•]\s*/gm, '');
    const parts = clean.split(/\n|,|;|:\s|\s-\s|\.\s|(?<=\?)\s+|\s+also\s+/i).map((x) => x.trim().replace(/[.,]$/, '')).filter(Boolean);
    if (!parts.length) return null;
    const head = parts[0].length <= 40 ? parts.shift() : 'Note';
    return `<h2>${esc(cap(head))}</h2>` + (parts.length ? `<ul>${parts.map((x) => `<li>${esc(cap(x))}</li>`).join('')}</ul>` : '');
  }
  function noteTitle(html) {
    const d = document.createElement('div');
    d.innerHTML = sanitize(html).replace(/<br>|<\/(p|div|h2|h3|li)>/gi, '$&\n');
    const first = d.textContent.split('\n').map((s) => s.trim()).find(Boolean);
    return first ? first.slice(0, 80) : 'Untitled note';
  }
  let toastTimer = null;
  function toast(msg, undo) {
    const box = $('#toastbox');
    box.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? '<button type="button" data-a="undo">Undo</button>' : ''}</div>`;
    toast.undo = undo || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.innerHTML = ''; toast.undo = null; }, undo ? 5000 : 2600);
  }
  const tick = () => { try { N.tick(); } catch (e) { /* no haptics */ } };

  // ---------- pieces ----------
  function card(it, n) {
    const d = `--d:${Math.min(n * 40, 400)}ms`;
    if (it.kind === 'note') {
      const body = textOf(it.html).slice(0, 180);
      return `<button type="button" class="card" data-a="open" data-v="${it.id}" style="${d}" aria-label="Open ${esc(it.title)}"><div class="notecard"><div class="t">${esc(it.title)}</div><div class="p">${esc(body.startsWith(it.title) ? body.slice(it.title.length).trim() : body)}</div></div></button>`;
    }
    const ar = it.w && it.h ? `${it.w} / ${it.h}` : '4 / 5';
    const src = url(it.thumb || (it.kind === 'photo' ? it.file : ''));
    const media = src ? `<img src="${src}" alt="" loading="lazy" decoding="async" style="aspect-ratio:${ar}">` : `<div class="ph" style="aspect-ratio:${ar}">${svg(it.kind === 'video' ? P.camera : P.photo, 22, 1.6)}</div>`;
    const dur = it.duration ? `${Math.floor(it.duration / 60)}:${String(Math.round(it.duration % 60)).padStart(2, '0')}` : 'Video';
    return `<button type="button" class="card" data-a="open" data-v="${it.id}" style="${d}" aria-label="Open ${esc(it.title)}">
      <div class="media">${media}${it.kind === 'video' ? `<span class="badge"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>${dur}</span>` : ''}</div>
      <div class="cap">${esc(it.title)}</div>${it.caption ? `<div class="capnote">${esc(it.caption)}</div>` : ''}</button>`;
  }
  const gridHTML = (list, empty) => list.map(card).join('') || `<p class="empty">${empty}</p>`;
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
      <div class="grid anim" id="boardgrid" style="padding-top:12px">${gridHTML(list, 'Nothing on this board yet. Open an item and tap this board, or tap + while you\'re here.')}</div>
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
      stage = `<div class="stage"><video id="vid" src="${url(it.file)}" poster="${url(it.thumb)}" playsinline preload="metadata"></video>
        <button type="button" class="glass playbtn" data-a="play" id="playbtn" aria-label="Play"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg></button></div>`;
    } else {
      stage = `<div class="stage"><img src="${url(it.file)}" alt="${esc(it.title)}"></div>`;
    }
    const kind = it.kind === 'note' ? 'Note' : it.kind === 'video' ? 'Video' : 'Photo';
    return `<div class="screen" style="overflow:hidden">
      ${stage}
      <button type="button" class="iconbtn glass" data-a="back" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px;z-index:3">${svg(P.back)}</button>
      <span class="glass kindpill">${kind}</span>
      <div class="sheet frost${it.kind === 'note' ? ' compact' : ''}">
        <div class="handle"></div>
        ${it.kind !== 'note' ? `<div style="font-size:24px;line-height:1.15">${esc(it.title)}</div>
          <div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="note">Note</label><textarea id="note" class="notebox" placeholder="Why did you save this?">${esc(it.caption || '')}</textarea></div>` : ''}
        <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Boards</span><div class="chips">${chips}</div></div>
        <div style="display:flex;gap:10px"><button type="button" class="btn danger" data-a="bin">${svg(P.bin, 16)}<span>Move to Bin</span></button><span style="flex:1"></span><button type="button" class="btn white" data-a="back">Done</button></div>
      </div>
    </div>`;
  }

  function syncHTML() {
    return `<div class="screen" style="padding:calc(var(--st) + 20px) 20px calc(var(--sb) + 120px);display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:6px"><div class="poster" style="font-size:64px">Sync</div><div style="font-size:14px;color:#9A9A9A">Phone and PC, over your home Wi-Fi. Nothing goes online.</div></div>
      <div id="syncbody"></div>
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
      <button type="button" class="navbtn" data-a="search" aria-label="Search">${svg(P.search)}</button>
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
    <div id="toastbox"></div>`;
  }

  function tilesHTML() {
    const tiles = [{ id: '', label: 'MANI' }].concat(live().filter((x) => x.kind === 'photo' && x.file).map((x) => ({ id: x.id, label: x.title, img: url(x.thumb || x.file) })));
    return tiles.map((t) => { const on = S.coverId === t.id; return `<button type="button" class="tile${on ? ' on' : ''}" aria-pressed="${on}" aria-label="Use ${esc(t.label)} as cover" data-a="coverPick" data-v="${t.id}">${t.img ? `<img src="${t.img}" alt="">` : '<span class="manitile">MANI</span>'}</button>`; }).join('');
  }

  function updateChrome() {
    $('#nav').hidden = S.screen === 'item';
    $('#nav-home').classList.toggle('on', S.screen === 'home');
    $('#nav-sync').classList.toggle('on', S.screen === 'sync');
    $('#addbtn').classList.toggle('open', S.add);
    $('#addbtn').setAttribute('aria-expanded', String(S.add));
    $('#addsheet').hidden = !S.add;
    const cs = $('#coversheet');
    if (S.cover && cs.hidden) $('#tiles').innerHTML = tilesHTML();
    cs.hidden = !S.cover;
    $('#seg-dots').classList.toggle('on', S.coverDots);
    $('#seg-plain').classList.toggle('on', !S.coverDots);
    $('#formsheet').hidden = !S.sheet;
  }

  // ---------- board wheel: a loop, about five showing, fading out towards the edges ----------
  const STEP = 58;
  const count = () => wheel().length;
  const looped = () => count() >= 5;
  const wrapIndex = (x) => ((Math.round(x) % count()) + count()) % count();
  const focusIndex = () => (looped() ? wrapIndex(S.pos) : Math.max(0, Math.min(count() - 1, Math.round(S.pos))));
  function circ(k, pos) {
    if (!looped()) return k - pos;
    const n = count();
    let d = (((k - pos) % n) + n) % n;
    if (d > n / 2) d -= n;
    return d;
  }
  function layoutPills() {
    const stack = homeEl && homeEl.querySelector('#stack');
    if (!stack) return;
    stack.querySelectorAll('.pill').forEach((el) => {
      const d = circ(+el.dataset.pill, S.pos), a = Math.abs(d);
      el.style.transform = `translateY(${(d * STEP).toFixed(1)}px) scale(${(1 - Math.min(a, 3) * 0.04).toFixed(3)})`;
      el.style.opacity = a >= 2.6 ? '0' : Math.max(0, 1 - a * 0.28 - Math.max(0, a - 1.8) * 0.9).toFixed(3);
      el.style.setProperty('--glow', Math.max(0, 0.22 - a * 0.09).toFixed(3));
      el.style.zIndex = String(10 - Math.round(a));
      el.style.pointerEvents = a > 2.2 ? 'none' : 'auto';
    });
  }
  function settle(target) {
    const before = focusIndex();
    S.pos = looped() ? target : Math.max(0, Math.min(count() - 1, target));
    layoutPills();
    if (focusIndex() !== before) tick();
    N.setPref('wheel', String(wrapIndex(S.pos)));
  }
  function rebuildWheel() {
    const stack = homeEl && homeEl.querySelector('#stack');
    if (!stack) return;
    stack.classList.add('drag');
    stack.innerHTML = pillsHTML();
    layoutPills();
    void stack.offsetWidth;
    stack.classList.remove('drag');
  }
  // Drag follows your finger; letting go snaps to the nearest board (a quick flick carries on a few).
  function wireWheel(root) {
    const stack = root.querySelector('#stack');
    let y0 = 0, pos0 = 0, lastY = 0, lastT = 0, vel = 0, moved = false, lastFocus = 0;
    stack.addEventListener('touchstart', (e) => {
      y0 = lastY = e.touches[0].clientY; lastT = e.timeStamp; pos0 = S.pos; vel = 0; moved = false; lastFocus = focusIndex();
      stack.classList.add('drag');
    }, { passive: true });
    stack.addEventListener('touchmove', (e) => {
      const y = e.touches[0].clientY;
      if (Math.abs(y - y0) > 6) moved = true;
      const dt = Math.max(1, e.timeStamp - lastT);
      vel = 0.7 * vel + 0.3 * ((lastY - y) / STEP / dt);
      lastY = y; lastT = e.timeStamp;
      S.pos = pos0 + (y0 - y) / STEP;
      if (!looped()) S.pos = Math.max(-0.4, Math.min(count() - 0.6, S.pos));
      layoutPills();
      const f = focusIndex();
      if (f !== lastFocus) { lastFocus = f; tick(); }
    }, { passive: true });
    const end = () => {
      stack.classList.remove('drag');
      if (!moved) return;
      const fling = Math.max(-3, Math.min(3, vel * 160));
      const before = lastFocus;
      S.pos = Math.round(S.pos + fling);
      if (!looped()) S.pos = Math.max(0, Math.min(count() - 1, S.pos));
      layoutPills();
      if (focusIndex() !== before) tick();
      N.setPref('wheel', String(wrapIndex(S.pos)));
      stack.dataset.swiped = '1';
      setTimeout(() => { stack.dataset.swiped = ''; }, 80);
    };
    stack.addEventListener('touchend', end, { passive: true });
    stack.addEventListener('touchcancel', end, { passive: true });
    stack.addEventListener('wheel', (e) => { e.preventDefault(); settle(Math.round(S.pos) + Math.sign(e.deltaY)); }, { passive: false });
    stack.addEventListener('click', (e) => {
      const el = e.target.closest('.pill');
      if (!el || stack.dataset.swiped) return;
      const k = +el.dataset.pill;
      el.classList.remove('jig'); void el.offsetWidth; el.classList.add('jig');
      if (k !== focusIndex()) { settle(Math.round(S.pos + circ(k, S.pos))); return; }
      const b = wheel()[k];
      if (b.isNew) { openForm('newBoard'); return; }
      setTimeout(() => go('board', { board: b.id }, 'push'), 180);
    });
  }

  // ---------- screens: build only the one you move to; Home is kept as you left it ----------
  let homeEl = null, homeVer = 0, boardSig = '';
  const builders = { home: homeHTML, board: boardHTML, item: itemHTML, sync: syncHTML };
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
    homeEl.querySelector('#homegrid').innerHTML = gridHTML(homeList(), 'Nothing here yet. Tap + to add photos, videos or a note.');
    homeEl.querySelector('#count').textContent = String(live().length).padStart(2, '0') + ' items saved';
    homeEl.querySelector('#synced').textContent = statusText();
    homeEl.querySelector('#coverslot').innerHTML = coverHTML();
  }

  // After any library change: update whatever screen is showing, in place.
  function refresh() {
    if (S.screen === 'home') refreshHome();
    else if (S.screen === 'board') {
      const b = boards().find((x) => x.id === S.board);
      if (!b) { go('home'); return; }
      const list = onBoard(b.id);
      $('#boardname').textContent = b.name;
      $('#boardcount').textContent = plural(list.length, 'item');
      $('#boardgrid').innerHTML = gridHTML(list, 'Nothing on this board yet.');
    } else if (S.screen === 'item') {
      const it = byId(S.item);
      if (!it || it.deletedAt) { go(S.prev === 'item' ? 'home' : S.prev); return; }
      app.querySelectorAll('[data-a="boardToggle"]').forEach((el) => { const on = (it.boards || []).includes(el.dataset.v); el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); });
    } else if (S.screen === 'sync') {
      $('#syncbody').innerHTML = syncBodyHTML();
    }
  }

  // Moving between screens: items grow out of their card and shrink back into it; other screens slide or fade.
  const EASE = 'cubic-bezier(.22,1,.36,1)', DUR = 440;
  function animateSwap(oldEl, el, kind) {
    const stage = $('#stage');
    if (!oldEl || oldEl === el) return;
    const back = kind === 'unzoom' || kind === 'pop';
    if (back) stage.insertBefore(el, oldEl); // the screen being left stays on top while it goes
    const W = window.innerWidth, H = window.innerHeight;
    const rectInset = (r) => `inset(${r.top}px ${Math.max(0, W - r.right)}px ${Math.max(0, H - r.bottom)}px ${r.left}px round 20px)`;
    const full = 'inset(0px 0px 0px 0px round 0px)';
    const o = { duration: DUR, easing: EASE };
    let outAnim;
    if (kind === 'zoom' && S.fromRect) {
      el.animate([{ clipPath: rectInset(S.fromRect), opacity: 0.7 }, { clipPath: full, opacity: 1 }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0.35 }], o);
    } else if (kind === 'unzoom') {
      const card = el.querySelector(`.card[data-v="${S.fromId}"] .media`);
      const r = card && card.getBoundingClientRect();
      el.animate([{ transform: 'scale(.94)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], o);
      outAnim = r && r.bottom > 0 && r.top < H
        ? oldEl.animate([{ clipPath: full, opacity: 1 }, { clipPath: rectInset(r), opacity: 0.5 }], o)
        : oldEl.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], o);
    } else if (kind === 'push') {
      el.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-22%)', opacity: 0.4 }], o);
    } else if (kind === 'pop') {
      el.animate([{ transform: 'translateX(-22%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], o);
      outAnim = oldEl.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], o);
    } else {
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
      outAnim = oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' });
    }
    oldEl.style.pointerEvents = 'none';
    outAnim.onfinish = () => { oldEl.remove(); oldEl.style.pointerEvents = ''; };
  }

  function showScreen(kind) {
    const stage = $('#stage');
    const old = stage.lastElementChild;
    let el;
    if (S.screen === 'home' && homeEl) {
      refreshHome();
      el = homeEl;
    } else {
      el = build(S.screen);
      if (!el) { S.screen = 'home'; return showScreen('fade'); }
      if (S.screen === 'home') { homeEl = el; homeVer = dataVer; boardSig = sigOf(); }
    }
    if (!el.isConnected) stage.appendChild(el);
    if (S.screen === 'home' && !el.dataset.wired) { el.dataset.wired = '1'; layoutPills(); wireHome(el); wireWheel(el); }
    if (S.screen === 'item') wireItem(el);
    if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
    animateSwap(old, el, kind);
    updateChrome();
  }

  function go(screen, extra, kind) {
    Object.assign(S, extra || {}, { screen, add: false, cover: false, sheet: null });
    showScreen(kind || 'fade');
  }

  function setLift(v) {
    S.lift = v;
    const el = homeEl && homeEl.querySelector('#lift');
    if (!el) return;
    el.classList.toggle('up', v);
    homeEl.querySelector('#topglass').classList.toggle('on', v);
    el.querySelector('.grip').setAttribute('aria-label', v ? 'Lower items' : 'Lift items up');
    if (!v) el.scrollTop = 0;
  }

  function wireHome(root) {
    const lift = root.querySelector('#lift');
    let y0 = 0;
    lift.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    lift.addEventListener('touchmove', (e) => {
      const dy = y0 - e.touches[0].clientY;
      if (!S.lift && dy > 20) setLift(true);
      else if (S.lift && lift.scrollTop <= 0 && dy < -24) setLift(false);
    }, { passive: true });
    lift.addEventListener('wheel', (e) => { if (!S.lift && e.deltaY > 0) setLift(true); else if (S.lift && lift.scrollTop <= 0 && e.deltaY < 0) setLift(false); }, { passive: true });
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
    const vid = root.querySelector('#vid');
    if (vid) {
      const btn = root.querySelector('#playbtn');
      vid.addEventListener('play', () => { btn.hidden = true; });
      vid.addEventListener('pause', () => { btn.hidden = false; });
      vid.addEventListener('click', () => { if (!vid.paused) vid.pause(); });
      vid.addEventListener('error', () => toast("This video can't play here. It's still saved, and you can open it on your PC."));
    }
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
  const currentBoard = () => (S.screen === 'board' ? S.board : '');
  const A = {
    home: () => go('home', null, 'fade'),
    boardBack: () => go('home', null, 'pop'),
    sync: () => go('sync'),
    search: () => toast('Search is coming soon'),
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
      const grid = homeEl.querySelector('#homegrid');
      grid.classList.remove('anim'); grid.innerHTML = gridHTML(homeList(), v === 'notes' ? 'No notes yet. Tap + and choose New note.' : 'Nothing here yet.'); void grid.offsetWidth; grid.classList.add('anim');
    },
    lift: () => setLift(!S.lift),
    addGallery: () => { S.add = false; updateChrome(); N.pick(currentBoard()); },
    addCamera: () => { S.add = false; updateChrome(); N.camera(currentBoard()); },
    addNote: () => { const r = call('addNote', currentBoard()); if (r) go('item', { item: r.id, prev: S.screen }); },
    open: (v, el) => { const m = el.querySelector('.media') || el; S.fromRect = m.getBoundingClientRect(); S.fromId = v; go('item', { item: v, prev: S.screen }, 'zoom'); },
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
    play: () => { const v = $('#vid'); if (v) v.play(); },
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
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.v, el);
  });
  app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('field')) saveForm(); });

  // Android back gesture: close a panel or step back before leaving the app.
  window.nbBack = () => {
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
