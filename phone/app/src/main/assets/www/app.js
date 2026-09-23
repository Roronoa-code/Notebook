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
    toastTimer = setTimeout(() => { box.innerHTML = ''; toast.undo = null; }, undo ? 5000 : 2600);
  }
  const tick = () => { try { N.tick(); } catch (e) { /* no haptics */ } };

  // ---------- pieces ----------
  function card(it, n) {
    const d = `--d:${Math.min(n * 40, 400)}ms`;
    const binned = !!it.deletedAt; // in the Bin, tapping a card offers Put back / Delete forever instead of opening it
    if (it.kind === 'note') {
      const body = textOf(it.html).slice(0, 180);
      return `<button type="button" class="card" data-a="${binned ? 'binItem' : 'open'}" data-v="${it.id}" style="${d}" aria-label="Open ${esc(it.title)}"><div class="notecard"><div class="t">${esc(it.title)}</div><div class="p">${esc(body.startsWith(it.title) ? body.slice(it.title.length).trim() : body)}</div></div></button>`;
    }
    const ar = it.w && it.h ? `${it.w} / ${it.h}` : '4 / 5';
    const src = url(it.thumb || (it.kind === 'photo' ? it.file : ''));
    const media = src ? `<img src="${src}" alt="" loading="lazy" decoding="async" style="aspect-ratio:${ar}">` : `<div class="ph" style="aspect-ratio:${ar}">${svg(it.kind === 'video' ? P.camera : P.photo, 22, 1.6)}</div>`;
    return `<button type="button" class="card" data-a="${binned ? 'binItem' : 'open'}" data-v="${it.id}" style="${d}" aria-label="Open ${esc(it.title)}">
      <div class="media">${media}${it.kind === 'video' ? `<span class="badge" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg></span>` : ''}</div></button>`;
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
      stage = `<div class="stage" style="${arStyle(it)}"><video id="vid" src="${url(it.file)}" poster="${url(it.thumb)}" controls playsinline preload="metadata"></video>
        <p class="media-message" role="status"></p></div>`;
    } else {
      stage = `<div class="stage" style="${arStyle(it)}"><button type="button" class="photo-open" aria-label="Expand photo"><img src="${url(it.file)}" alt="${esc(it.title)}" decoding="async"></button></div>`;
    }
    const kind = it.kind === 'note' ? 'Note' : it.kind === 'video' ? 'Video' : 'Photo';
    return `<div class="screen${it.kind !== 'note' ? ' media-screen' : ''}" style="overflow:hidden">
      ${stage}
      <button type="button" class="iconbtn glass" data-a="back" aria-label="Back" style="position:absolute;top:calc(var(--st) + 10px);left:16px;z-index:3">${svg(P.back)}</button>
      <span class="glass kindpill">${kind}</span>
      <div class="sheet frost${it.kind === 'note' ? ' compact' : ''}">
        ${it.kind !== 'note' ? `<details class="media-details"><summary><span>${esc(it.title)}</span><small>Details & boards</small></summary><div class="media-fields">` : '<div class="handle"></div>'}
        ${it.kind !== 'note' ? `<div style="display:flex;flex-direction:column;gap:8px"><label class="lbl" for="note">Note</label><textarea id="note" class="notebox" placeholder="Why did you save this?">${esc(it.caption || '')}</textarea></div>` : ''}
        <div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Boards</span><div class="chips">${chips}</div></div>
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
    <div id="toastbox"></div>`;
  }

  function tilesHTML() {
    const tiles = [{ id: '', label: 'MANI' }].concat(live().filter((x) => x.kind === 'photo' && x.file).map((x) => ({ id: x.id, label: x.title, img: url(x.thumb || x.file) })));
    return tiles.map((t) => { const on = S.coverId === t.id; return `<button type="button" class="tile${on ? ' on' : ''}" aria-pressed="${on}" aria-label="Use ${esc(t.label)} as cover" data-a="coverPick" data-v="${t.id}">${t.img ? `<img src="${t.img}" alt="">` : '<span class="manitile">MANI</span>'}</button>`; }).join('');
  }

  function updateChrome() {
    const nav = $('#nav'), hide = S.screen === 'item';
    if (nav.hidden && !hide && !matchMedia('(prefers-reduced-motion: reduce)').matches) nav.animate([{ opacity: 0, translate: '-50% 24px' }, { opacity: 1, translate: '-50% 0' }], { duration: 380, easing: 'cubic-bezier(.2,.75,.25,1)' });
    nav.hidden = hide;
    $('#nav-home').classList.toggle('on', S.screen === 'home');
    $('#nav-sync').classList.toggle('on', S.screen === 'sync' || S.screen === 'bin');
    $('#nav-search').classList.toggle('on', S.screen === 'search');
    for (const el of app.querySelectorAll('.navbtn[id]')) {
      if (el.classList.contains('on')) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
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
      el.style.setProperty('--glow', Math.max(0, 0.22 - a * 0.09).toFixed(3)); // the middle board is lit
      el.style.zIndex = String(10 - Math.round(a));
      el.style.pointerEvents = a > 2.2 ? 'none' : 'auto';
    });
  }
  // Spins the wheel to a board. The position itself is animated (not each pill), so on a loop every
  // board moves round in the same direction and nothing ever slides the wrong way across the middle.
  let spinFrame = 0;
  function settle(target) {
    if (!looped()) target = Math.max(0, Math.min(count() - 1, target));
    cancelAnimationFrame(spinFrame);
    const start = S.pos, dist = target - start;
    if (Math.abs(dist) < 0.001) { S.pos = target; layoutPills(); return; }
    const dur = Math.min(900, 340 + 190 * Math.sqrt(Math.abs(dist)));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { S.pos = target; layoutPills(); return; }
    const t0 = performance.now();
    let lastFocus = focusIndex();
    const ease = (t) => 1 - Math.pow(1 - t, 3); // quick start, gentle landing
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      S.pos = start + dist * ease(t);
      layoutPills();
      const f = focusIndex();
      if (f !== lastFocus) { lastFocus = f; tick(); } // a tick for every board that passes the middle
      if (t < 1) spinFrame = requestAnimationFrame(step);
      else { S.pos = target; layoutPills(); N.setPref('wheel', String(wrapIndex(S.pos))); }
    };
    spinFrame = requestAnimationFrame(step);
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
      cancelAnimationFrame(spinFrame); // catching the wheel mid-spin stops it where it is
      y0 = lastY = e.touches[0].clientY; lastT = e.timeStamp; pos0 = S.pos; vel = 0; moved = false; lastFocus = focusIndex();
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
    const end = (e) => {
      if (!moved) return;
      // A flick keeps going in the same direction: faster flicks travel further.
      const recent = e && e.timeStamp - lastT < 80 ? vel : 0;
      const fling = Math.max(-6, Math.min(6, recent * 220));
      settle(Math.round(S.pos + fling));
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
      if (k !== focusIndex()) { settle(Math.round(S.pos + circ(k, S.pos))); return; }
      const b = wheel()[k];
      if (b.isNew) { openForm('newBoard'); return; }
      go('board', { board: b.id }, 'push');
    });
  }

  // ---------- screens: build only the one you move to; Home is kept as you left it ----------
  let homeEl = null, currentEl = null, homeVer = 0, boardSig = '';
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
      $('#binrowcount').textContent = plural(binned().length, 'item');
    } else if (S.screen === 'search') {
      $('#searchgrid').innerHTML = searchResults();
    } else if (S.screen === 'bin') {
      const list = binned();
      $('#bincount').textContent = plural(list.length, 'item');
      $('#emptybin').hidden = !list.length;
      $('#bingrid').innerHTML = gridHTML(list, 'The Bin is empty.');
    }
  }

  // Transform and opacity stay on compositor layers; clipping a whole frosted screen repaints it.
  const EASE = 'cubic-bezier(.2,.75,.25,1)', DUR = 460;

  // Photos and videos fly between their card and the open screen, so it reads as the same thing
  // moving rather than one screen swapping for another. Returns null when there's nothing to fly.
  let flight = null;
  function mediaFlight(itemScreen, homeScreen, opening) {
    const it = DB.items.find((x) => x.id === S.item);
    const card = homeScreen.querySelector(`.card[data-v="${CSS.escape(S.item || '')}"] .media`);
    const target = itemScreen.querySelector('.stage img, .stage video');
    if (!it || !card || !target) return null;
    const c = card.getBoundingClientRect(), box = target.getBoundingClientRect();
    if (!c.width || !box.width || c.bottom < 0 || c.top > innerHeight) return null;
    const ar = it.w && it.h ? it.w / it.h : c.width / c.height;
    const w = Math.min(box.width, box.height * ar), h = w / ar;
    const t = { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2 };
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.width = w + 'px'; ghost.style.height = h + 'px';
    const img = document.createElement('img');
    img.src = card.querySelector('img')?.src || url(it.thumb);
    ghost.append(img);
    app.append(ghost);
    const small = { transform: `translate(${c.x}px,${c.y}px) scale(${c.width / w},${c.height / h})`, borderRadius: `${20 * w / c.width}px / ${20 * h / c.height}px` };
    const big = { transform: `translate(${t.x}px,${t.y}px)`, borderRadius: '22px' };
    card.style.opacity = '0'; target.style.opacity = '0';
    Object.assign(ghost.style, opening ? big : small); // where it rests if it has to wait for the full photo
    const anim = ghost.animate(opening ? [small, big] : [big, small], { duration: DUR, easing: EASE });
    const done = () => { target.style.opacity = ''; card.style.opacity = ''; ghost.remove(); if (flight === anim) flight = null; };
    // Opening: keep the small copy up until the full photo is ready, so it never flashes.
    anim.onfinish = () => { if (opening && target.tagName === 'IMG') target.decode().catch(() => {}).then(done); else done(); };
    anim.oncancel = done;
    flight = anim;
    return anim;
  }

  // The photo's shape (width / height) for the rounded media frame; the stage falls back to a plain fit without it.
  const arStyle = (it) => (it.w > 0 && it.h > 0 ? `--ar:${(it.w / it.h).toFixed(4)}` : '');

  function animateSwap(oldEl, el, kind) {
    const stage = $('#stage');
    if (!oldEl || oldEl === el) return;
    if (flight) flight.finish(); // a new move starts from where things really are
    oldEl.inert = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { if (oldEl !== homeEl) oldEl.remove(); else oldEl.style.visibility = 'hidden'; return; }
    const back = kind === 'unzoom' || kind === 'pop';
    if (back) stage.insertBefore(el, oldEl); // the screen being left stays on top while it goes
    const o = { duration: DUR, easing: EASE };
    const card = (kind === 'zoom' ? oldEl : el).querySelector(`.card[data-v="${CSS.escape(S.item || '')}"]`);
    const rect = card?.getBoundingClientRect();
    const scale = rect ? Math.min(rect.width / innerWidth, rect.height / innerHeight) : .84;
    const origin = rect ? `translate(${rect.x + rect.width / 2 - innerWidth / 2}px,${rect.y + rect.height / 2 - innerHeight / 2}px) scale(${scale})` : 'translateY(70px) scale(.84)';
    let outAnim;
    const sheet = (kind === 'zoom' ? el : oldEl).querySelector('.sheet');
    const fly = (kind === 'zoom' || kind === 'unzoom') && (kind === 'zoom' ? mediaFlight(el, oldEl, true) : mediaFlight(oldEl, el, false));
    if (kind === 'zoom' && fly) {
      // Home stays where it is and sinks back slightly; the dark screen fades in behind the flying photo.
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR * 0.7, easing: 'ease-out' });
      sheet?.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.96)', opacity: .6 }], o);
    } else if (kind === 'unzoom' && fly) {
      el.animate([{ transform: 'scale(.96)', opacity: .6 }, { transform: 'none', opacity: 1 }], o);
      sheet?.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], o);
      outAnim = oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR * 0.7, easing: 'ease-in', fill: 'forwards' });
      outAnim.onfinish = null;
      const wait = oldEl.animate([{ visibility: 'visible' }, { visibility: 'visible' }], o); // remove only once the photo has landed
      wait.onfinish = () => oldEl.remove();
      oldEl.style.pointerEvents = 'none';
      return;
    } else if (kind === 'zoom') {
      // Notes (or a card that's off screen): the screen grows out of the card over Home.
      el.animate([{ transform: origin, opacity: .25 }, { transform: 'none', opacity: 1 }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.96)', opacity: .6 }], o);
    } else if (kind === 'unzoom') {
      el.animate([{ transform: 'scale(.96)', opacity: .6 }, { transform: 'none', opacity: 1 }], o);
      outAnim = oldEl.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: origin }], o);
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
    outAnim.onfinish = () => { if (oldEl !== homeEl) oldEl.remove(); else oldEl.style.visibility = 'hidden'; oldEl.style.pointerEvents = ''; }; // Home is kept, just hidden
  }

  function showScreen(kind) {
    const stage = $('#stage');
    const old = currentEl;
    if (old) old.querySelector('video')?.pause();
    let el;
    if (S.screen === 'home' && homeEl) {
      refreshHome();
      homeEl.querySelector('#homegrid').classList.remove('anim');
      el = homeEl;
    } else {
      el = build(S.screen);
      if (!el) { S.screen = 'home'; return showScreen('fade'); }
      if (S.screen === 'home') { homeEl = el; homeVer = dataVer; boardSig = sigOf(); }
    }
    // A quick return can reuse Home before its previous exit animation finishes.
    // Cancel that exit so its callback cannot remove the screen we just returned to.
    el.getAnimations().forEach((animation) => animation.cancel());
    el.inert = false;
    el.style.visibility = '';
    el.style.pointerEvents = '';
    for (const stale of [...stage.children]) {
      if (stale === old || stale === el) continue;
      stale.getAnimations().forEach((animation) => animation.cancel());
      if (stale === homeEl) stale.style.visibility = 'hidden'; else stale.remove();
    }
    if (el !== old) stage.appendChild(el);
    currentEl = el;
    if (S.screen === 'home' && !el.dataset.wired) { el.dataset.wired = '1'; layoutPills(); wireHome(el); wireWheel(el); }
    if (S.screen === 'item') { wireItem(el); wireDismiss(el); }
    if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
    if (S.screen === 'search') {
      const q = el.querySelector('#q');
      q.addEventListener('input', () => { S.query = q.value; el.querySelector('#searchgrid').innerHTML = searchResults(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
      if (!S.query) setTimeout(() => q.focus(), 350);
    }
    animateSwap(old, el, kind);
    updateChrome();
  }

  function go(screen, extra, kind) {
    Object.assign(S, extra || {}, { screen, add: false, cover: false, sheet: null });
    showScreen(kind || 'fade');
  }

  // The items panel's two resting places: down under the boards, or up under the top bar.
  const liftStops = () => ({ up: (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0) + 58, down: parseFloat(app.style.getPropertyValue('--hero')) || 560 });
  const liftY = (el) => new DOMMatrix(getComputedStyle(el).transform).m42;
  let liftFrame = 0;
  function paintLift(el, y) {
    const { up, down } = liftStops();
    el.style.transform = `translateY(${y.toFixed(1)}px)`;
    homeEl.querySelector('#topglass').style.opacity = Math.max(0, Math.min(1, (down - y) / (down - up))).toFixed(3);
  }
  // A small spring: a hard flick arrives fast and bounces a little past, a gentle one just settles.
  function springLift(el, to, v0) {
    cancelAnimationFrame(liftFrame);
    let y = liftY(el), v = v0 || 0, last = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) y = to;
    const step = (now) => {
      const dt = Math.min(32, now - last) / 1000; last = now;
      const a = -210 * (y - to) - 24 * v; // stiffness, damping (slightly under-damped)
      v += a * dt; y += v * dt;
      if (Math.abs(y - to) < 0.4 && Math.abs(v) < 8) { liftFrame = 0; el.style.transform = ''; homeEl.querySelector('#topglass').style.opacity = ''; return; }
      paintLift(el, y);
      liftFrame = requestAnimationFrame(step);
    };
    liftFrame = requestAnimationFrame(step);
  }
  function setLift(v, velocity) {
    S.lift = v;
    const el = homeEl && homeEl.querySelector('#lift');
    if (!el) return;
    const from = liftY(el);
    el.classList.toggle('up', v);
    homeEl.querySelector('#topglass').classList.toggle('on', v);
    el.querySelector('.grip').setAttribute('aria-label', v ? 'Lower items' : 'Lift items up');
    if (!v) el.scrollTop = 0;
    paintLift(el, from); // start the spring from wherever the panel is now
    springLift(el, v ? liftStops().up : liftStops().down, velocity);
  }

  function wireHome(root) {
    const lift = root.querySelector('#lift');
    let y0 = 0, start = 0, dragging = false, caught = false, samples = [];
    lift.addEventListener('touchstart', (e) => {
      caught = !!liftFrame; cancelAnimationFrame(liftFrame); liftFrame = 0; // a finger catches it mid-spring
      y0 = e.touches[0].clientY; start = liftY(lift); dragging = false; samples = [{ y: y0, t: e.timeStamp }];
    }, { passive: true });
    lift.addEventListener('touchmove', (e) => {
      const y = e.touches[0].clientY, dy = y - y0;
      samples.push({ y, t: e.timeStamp }); if (samples.length > 6) samples.shift();
      if (!dragging) {
        // Down: any drag moves it. Up: only a pull-down from the very top of the list (otherwise it scrolls).
        if (Math.abs(dy) < 6 || (S.lift && (lift.scrollTop > 0 || dy < 0))) return;
        dragging = true;
      }
      const { up, down } = liftStops();
      let to = start + (y - y0);
      if (to < up) to = up - (up - to) * 0.25; // rubbery past the ends
      if (to > down) to = down + (to - down) * 0.3;
      paintLift(lift, to);
    }, { passive: true });
    const end = () => {
      if (!dragging) { if (caught) setLift(S.lift); return; } // caught but not dragged: carry on to where it was going
      dragging = false;
      const a = samples[0], b = samples[samples.length - 1];
      const v = b && a && b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px per second, + is down
      const { up, down } = liftStops(), y = liftY(lift);
      const goUp = Math.abs(v) > 350 ? v < 0 : y < (up + down) / 2;
      setLift(goUp, v);
    };
    lift.addEventListener('touchend', end, { passive: true });
    lift.addEventListener('touchcancel', end, { passive: true });
    lift.addEventListener('wheel', (e) => { if (!S.lift && e.deltaY > 0) setLift(true); else if (S.lift && lift.scrollTop <= 0 && e.deltaY < 0) setLift(false); }, { passive: true });
  }

  // Swipe down on an open photo or video to go back: it follows the finger, shrinking a little,
  // with Home showing behind it; let go past the line (or flick) and it flies back into its card.
  function wireDismiss(root) {
    const stage = root.querySelector('.media-screen .stage');
    if (!stage) return;
    let y0 = 0, x0 = 0, t0 = 0, dy = 0, active = false, dragging = false;
    stage.addEventListener('touchstart', (e) => {
      const t = e.touches[0], v = stage.querySelector('video');
      // Leave the video's own controls (bottom of the player) alone.
      if (e.touches.length > 1 || (v && t.clientY > v.getBoundingClientRect().bottom - 70)) { active = false; return; }
      active = true; dragging = false; y0 = t.clientY; x0 = t.clientX; t0 = e.timeStamp; dy = 0;
    }, { passive: true });
    stage.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.touches[0];
      dy = t.clientY - y0;
      if (!dragging) {
        if (dy < 10 || Math.abs(dy) < Math.abs(t.clientX - x0)) return;
        dragging = true;
        root.getAnimations().forEach((x) => x.finish());
        if (homeEl && homeEl !== root && S.prev !== 'board' && S.prev !== 'search') homeEl.style.visibility = '';
      }
      const k = Math.max(0, dy);
      root.style.transform = `translateY(${k}px) scale(${Math.max(0.82, 1 - k / 1800)})`;
      root.style.borderRadius = Math.min(28, k / 5) + 'px';
      root.style.overflow = 'hidden';
    }, { passive: true });
    const end = (e) => {
      if (!active || !dragging) { active = false; return; }
      active = false; dragging = false;
      const v = dy / Math.max(1, e.timeStamp - t0);
      if (dy > 110 || v > 0.6) { A.back(); return; }
      const back = root.animate([{ transform: root.style.transform, borderRadius: root.style.borderRadius }, { transform: 'none', borderRadius: '0px' }], { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
      root.style.transform = ''; root.style.borderRadius = '';
      back.onfinish = () => { if (homeEl && homeEl !== root && currentEl === root) homeEl.style.visibility = 'hidden'; };
    };
    stage.addEventListener('touchend', end, { passive: true });
    stage.addEventListener('touchcancel', end, { passive: true });
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
  const currentBoard = () => (S.screen === 'board' ? S.board : '');
  const A = {
    home: () => go('home', null, 'fade'),
    boardBack: () => go('home', null, 'pop'),
    sync: () => go('sync'),
    search: () => go('search'),
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
      const grid = homeEl.querySelector('#homegrid');
      grid.classList.remove('anim'); grid.innerHTML = gridHTML(homeList(), v === 'notes' ? 'No notes yet. Tap + and choose New note.' : 'Nothing here yet.'); void grid.offsetWidth; grid.classList.add('anim');
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
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.v, el);
  });
  app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('field')) saveForm(); });

  // Android back gesture: close a panel or step back before leaving the app.
  window.nbBack = () => {
    if (NBMedia.closePhoto()) return true;
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
