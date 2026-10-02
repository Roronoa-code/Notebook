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
    add: false, cover: false, sheet: null,
    coverId: pref('coverId', ''), coverDots: pref('coverDots', '1') === '1', tidyUndo: null, syncing: false,
    stackTop: {}, select: null
  };
  const boards = () => DB.boards;
  const live = () => DB.items.filter((it) => !it.deletedAt);
  const onBoard = (id) => live().filter((it) => (it.boards || []).includes(id));
  // A new note is a draft until something is written in it (or it is put on a board): opening + and going straight
  // back leaves the notebook exactly as it was. It becomes a real note the moment it has something in it.
  let draft = null;
  const byId = (id) => (draft && id === draft.id ? draft : DB.items.find((it) => it.id === id));
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
    if (batching) { held ||= changed; return; }
    if (changed) { dataVer++; refresh(); }
    else if (S.screen === 'sync') refresh();
    paintStatus();
  }
  // Several changes that are one thing to you (binning or putting back picked cards, an Undo) are one transaction:
  // the screen, the count and the grid update once, from the finished library, never from a half-way state.
  let batching = 0, held = false;
  function batch(fn) {
    batching++;
    try { return fn(); } finally {
      if (!--batching) { const was = held; held = false; if (was) { dataVer++; refresh(); } paintStatus(); }
    }
  }
  window.nbOnState = (json) => { if (!N.demo) setDB(JSON.parse(json)); }; // the sample notebook never shows the real library the app pushes after a sync
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
  const PIN = 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v7';
  const pinMark = `<span class="pinmark" aria-hidden="true">${svg(PIN, 13, 2.4)}</span>`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return plural(Math.round(s / 60), 'min') + ' ago';
    if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  // One place for messages. While the bottom action area is out, a message is the orb itself (dock.js): the orb (or
  // the picking bar, or the shelf, or a small form) becomes a pill that carries the words and Undo, measured at its
  // final size and place before it shows, then folds back into the orb. Otherwise (an open item, the header picture)
  // it is a plain pill low on the screen, above whatever sheet is open there (it follows that sheet as it moves).
  let toastTimer = null, toastSeq = 0;
  const toastWatch = new ResizeObserver(() => placeToast());
  function placeToast() {
    const box = $('#toastbox'), t = box && box.firstElementChild;
    if (!t || t.classList.contains('orbtoast')) return;
    const sb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')) || 0;
    let bottom = sb + 24;
    const covers = [currentEl && currentEl.querySelector('.sheet'), $('#formsheet')].filter((el) => el && !el.hidden && !el.classList.contains('riding') && el.getClientRects().length);
    for (const el of covers) bottom = Math.max(bottom, innerHeight - el.getBoundingClientRect().top + 12);
    box.style.setProperty('--toast-b', Math.round(Math.min(bottom, innerHeight * 0.7)) + 'px');
  }
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // `icon`: 'bin' for things gone to the Bin or deleted. `from`: an open small form that becomes this message.
  function toast(msg, undo, icon, from) {
    const box = $('#toastbox');
    const words = `${icon === 'bin' ? `<i class="toasticon bad" aria-hidden="true">${svg(P.bin, 20, 2)}</i>` : ''}<span>${esc(msg)}</span>${undo ? '<b class="sep" aria-hidden="true"></b><button type="button" data-a="undo">Undo</button>' : ''}`;
    toast.undo = undo || null;
    toastSeq++;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => foldToast(), 1000); // every message, Undo too, is gone within about a second and a half, folding included (owner's choice)
    if (Dk.say(words, { from })) return;
    box.innerHTML = `<div class="toast" role="status">${words}</div>`;
    toastWatch.disconnect();
    const sheet = currentEl && currentEl.querySelector('.sheet');
    if (sheet) toastWatch.observe(sheet);
    placeToast();
  }
  // The message goes: the orb's pill folds back into the orb; the plain pill sinks and fades. `now`: at once.
  function foldToast(now) {
    clearTimeout(toastTimer);
    toast.undo = null;
    const box = $('#toastbox'), t = box.firstElementChild;
    if (!t) return;
    if (t === Dk.pill()) { if (now) Dk.drop(); else Dk.fold(); return; }
    if (now || calm()) { box.innerHTML = ''; return; }
    t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.97)' }], { duration: 220, easing: EASE, fill: 'forwards' })
      .onfinish = () => { if (box.firstElementChild === t) box.innerHTML = ''; }; // sinks and fades
  }
  const tick = () => { try { N.tick(); } catch (e) { /* no haptics */ } };
  const hap = (kind) => { try { N.haptic(kind); } catch (e) { tick(); } };
  window.nbHap = hap;

  // ---------- pieces ----------
  // A crop ({ x, y, w, h } as fractions, set on the PC) only changes how the picture is shown: object-view-box.
  const shapeOf = (it) => (it.w && it.h ? [it.w * (it.crop ? it.crop.w : 1), it.h * (it.crop ? it.crop.h : 1)] : null);
  const vb = (it) => { const c = it.crop; return c ? `object-view-box:inset(${c.y * 100}% ${(1 - c.x - c.w) * 100}% ${(1 - c.y - c.h) * 100}% ${c.x * 100}%);` : ''; };
  const aspect = (it) => { const s = shapeOf(it); return s ? `${s[0]} / ${s[1]}` : '4 / 5'; };
  // The picture (or note text) inside a card. `fill` makes it fill a fixed box (cards in a stack).
  function inner(it, fill) {
    if (it.kind === 'note') {
      const body = textOf(it.html).slice(0, 180);
      const title = it.title || 'Untitled note', split = title.lastIndexOf(' ', 28);
      const cut = title.length > 28 && split > 12 ? split : Math.min(title.length, 28);
      const rest = body.toLowerCase().startsWith(title.toLowerCase()) ? body.slice(title.length).trim() : body;
      const excerpt = [title.slice(cut).trim(), rest].filter(Boolean).join(' ');
      return `<div class="notecard${fill ? ' fill' : ''}"><div class="t">${esc(title.slice(0, cut))}</div>${excerpt ? `<div class="p">${esc(excerpt)}</div>` : ''}</div>`;
    }
    const size = fill ? '' : ` style="aspect-ratio:${aspect(it)}"`;
    const src = url(it.thumb || (it.kind === 'photo' ? it.file : ''));
    const media = src ? `<img src="${src}" alt="" loading="eager" decoding="sync" style="${fill ? '' : `aspect-ratio:${aspect(it)};`}${vb(it)}">` : `<div class="ph"${size}>${svg(it.kind === 'video' ? P.camera : P.photo, 22, 1.6)}</div>`;
    return `<div class="media${fill ? ' fill' : ''}">${media}${it.kind === 'video' ? `<span class="badge" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg></span>` : ''}</div>`;
  }
  function card(it, n) {
    const binned = !!it.deletedAt; // in the Bin, tapping a card offers Put back / Delete forever instead of opening it
    const pin = !binned && SO.isPinned(it.id);
    return `<button type="button" class="card" data-a="${binned ? 'binItem' : 'open'}" data-v="${it.id}" data-n="${n}" style="--d:${Math.min(n * 40, 400)}ms" aria-label="Open ${esc(it.title)}${pin ? ', pinned' : ''}">${inner(it)}${pin ? pinMark : ''}</button>`;
  }
  // A stack: its pictures and notes fanned in the space of one card. Its size is a fixed rule: the shape of its first
  // (oldest) member, a note as compact as its words, so flicking through never changes its size. Each card carries its
  // own number in a corner its words keep clear of; only the front one shows it. Flick sideways to go through it
  // (stacks.js).
  // A stack keeps a fixed order (oldest first) and remembers its front card by id, so a sync that re-sorts the list
  // never changes its shape or which card is showing. A new stack puts the card it was made from in front.
  const stackOrder = (members) => members.slice().sort((x, y) => (x.importedAt || '').localeCompare(y.importedAt || '') || x.id.localeCompare(y.id));
  function stackCard(unordered, n) {
    const members = stackOrder(unordered), id = members[0].stack, len = members.length;
    if (!members.some((m) => m.id === S.stackTop[id]) && members.some((m) => m.id === S.nextFront)) S.stackTop[id] = S.nextFront;
    const top = Math.max(0, members.findIndex((m) => m.id === S.stackTop[id])), first = members[0];
    const size = first.kind === 'note' ? inner(first) : `<div class="fansize" style="aspect-ratio:${aspect(first)}"></div>`;
    return `<div class="card stackcard" data-stack="${id}" data-n="${n}" style="--d:${Math.min(n * 40, 400)}ms">
      <div class="fan"><div class="fansizer" aria-hidden="true">${size}</div>${members.map((m, i) => `<button type="button" class="fanitem" data-a="open" data-v="${m.id}" style="${ST.restStyle((i - top + len) % len)}" aria-label="Open ${esc(m.title)}, ${i + 1} of ${len} in a stack">${inner(m, true)}<span class="stackct" aria-hidden="true">${i + 1}/${len}</span></button>`).join('')}</div>
      ${members.some((m) => SO.isPinned(m.id)) ? pinMark : ''}</div>`;
  }
  // Inside a board (`board`), only stacks made in that board group; the rest show as loose cards.
  // Sorted by date taken (`sortKey`): a heading before each new month.
  // How tall a card will be, in column widths (pictures from their shape, notes from their words).
  function tall(it) {
    const w = (innerWidth - 32 - 12) / 2, gap = 12 / w;
    if (it.kind !== 'note') { const s = shapeOf(it); return (s ? s[1] / s[0] : 1.25) + gap; }
    const title = it.title || 'Untitled note', body = textOf(it.html).slice(0, 180);
    const t = Math.ceil(Math.min(title.length, 28) / Math.max(6, (w - 50) / 10)), b = body ? Math.min(8, Math.ceil(body.length / Math.max(10, (w - 28) / 6.5))) : 0;
    return (32 + t * 23 + (b ? 8 + b * 18.75 : 0)) / w + gap;
  }
  // Each card into the shorter column, in order (as For you does), so the newest run across the top. The columns
  // are written one after the other with a column break between them: they never rebalance or swap cards later.
  function dealt(out, est) {
    const html = [];
    for (let i = 0; i < out.length;) {
      if (est[i] == null) { html.push(out[i++]); continue; }
      const h = [0, 0], cols = [[], []];
      for (; i < out.length && est[i] != null; i++) { const c = h[0] <= h[1] + 0.001 ? 0 : 1; h[c] += est[i]; cols[c].push(out[i]); }
      if (cols[1].length) cols[1][0] = cols[1][0].replace('class="card', 'class="card colbreak');
      html.push(...cols[0], ...cols[1]);
    }
    return html.join('');
  }
  function gridHTML(list, empty, board, sortKey, singleColumn = false) {
    const done = new Set(), out = [], est = [], months = SO.byMonth(sortKey);
    let month = null;
    const heading = (it) => { if (!months) return; const m = SO.monthOf(it); if (m !== month) { month = m; out.push(`<h3 class="dategroup">${esc(m)}</h3>`); est.push(null); } };
    for (const it of list) {
      if (it.stack && !it.deletedAt && (!board || it.stackIn === board)) {
        if (done.has(it.stack)) continue;
        const members = list.filter((x) => x.stack === it.stack);
        if (members.length > 1) { done.add(it.stack); heading(it); out.push(stackCard(members, out.length)); est.push(tall(members[0])); continue; }
      }
      heading(it);
      out.push(card(it, out.length)); est.push(tall(it));
    }
    if (out.length) return singleColumn ? out.join('') : dealt(out, est);
    const [head, body] = empty.includes('|') ? empty.split('|') : ['Nothing yet', empty];
    const demo = S.screen === 'home' && head === 'Nothing yet' && !(DB.sync || {}).paired && window.NBNative.demo === undefined ? '<button type="button" class="btn" data-a="demoOn" style="margin-top:16px">Try a sample notebook</button>' : '';
    return `<div class="empty"><b>${head}</b><span>${body}</span>${demo}</div>`;
  }
  const homeList = (tab = S.tab) => (tab === 'notes' ? live().filter((x) => x.kind === 'note') : live());
  // Home's grid: Recent, Notes, or For you (Pinterest ideas, also available without the PC).
  const homeGrid = (tab = S.tab, quiet) => (tab === 'ideas' ? I.gridHTML('all', quiet) : gridHTML(SO.apply(homeList(tab), 'all'), tab === 'notes' ? 'No notes|Tap + to write one.' : 'Nothing yet|Tap + to add photos, videos or a note.', null, 'all', tab === 'notes'));

  // Boards are little piles of prints: their newest pictures fanned, the name in bold under them.
  const pileImgs = (id) => onBoard(id).filter((it) => it.thumb || (it.kind === 'photo' && it.file)).slice(0, 3);
  // Pinned boards come first, in the order you pinned them. Pins live on this phone only (like the sort order), so
  // the library and sync are untouched.
  const pinned = () => { try { const ids = JSON.parse(N.getPref('pins') || '[]'); return Array.isArray(ids) ? ids.filter((id) => boards().some((b) => b.id === id)) : []; } catch (e) { return []; } };
  const railBoards = () => { const p = pinned(); return [...p.map((id) => boards().find((b) => b.id === id)), ...boards().filter((b) => !p.includes(b.id))]; };
  window.nbPinned = pinned;
  function railHTML() {
    const pins = pinned();
    const piles = railBoards().map((b) => {
      const imgs = pileImgs(b.id), n = onBoard(b.id).length;
      const stack = imgs.length ? imgs.map((it) => `<img class="pile-img" src="${url(it.thumb || it.file)}" alt="" decoding="sync" style="${vb(it)}">`).join('') : `<div class="pile-ph"><b>${esc((b.name.trim()[0] || '').toUpperCase())}</b></div>`;
      const pin = pins.includes(b.id);
      return `<button type="button" class="pile${pin ? ' pinned' : ''}" data-a="pile" data-v="${b.id}" aria-label="${esc(b.name)}, ${plural(n, 'item')}${pin ? ', pinned' : ''}. Hold for board options"><span class="pile-stack">${stack}</span><span class="nm">${esc(b.name)}</span><span class="ct">${pin ? svg(PIN, 11, 2.4) : ''}${plural(n, 'item')}</span></button>`;
    });
    piles.push(`<button type="button" class="pile new" data-a="newBoard" aria-label="Create a new board"><span class="pile-stack"><div class="pile-ph">${svg(P.plus, 30, 2)}</div></span><span class="nm">Create board</span><span class="ct">New</span></button>`);
    return piles.join('');
  }

  function coverHTML() {
    const cov = S.coverId && byId(S.coverId);
    // Dotted: drawn from the photo's own dots (dots.js), the same ones that move when it is pressed.
    if (cov && cov.file && cov.kind === 'photo') return S.coverDots
      ? `<canvas class="cover dots" data-src="${url(cov.file)}" data-crop="${cov.crop ? [cov.crop.x, cov.crop.y, cov.crop.w, cov.crop.h].join(',') : ''}" aria-hidden="true"></canvas>`
      : `<img class="cover plain" src="${url(cov.file)}" alt="" style="${vb(cov)}">`;
    return '<div class="maniink"><img src="img/mani-disperse.png" alt=""><img src="img/mani-disperse-purple.png" alt=""></div>';
  }

  // The rail, redrawn only when it actually changes; the piles glide to their new places (a deleted board leaves
  // where it was, the rest close up), and every cover is decoded ahead, so a first sweep never shows a label
  // before its picture.
  function setRail(quiet) {
    const rail = homeEl && homeEl.querySelector('#rail'), html = railHTML();
    if (!rail || html === rail.__html) return;
    const put = () => { rail.innerHTML = html; rail.__html = html; warmRail(rail); };
    if (quiet) { const keep = rail.scrollLeft; put(); rail.scrollLeft = keep; } else M.flipRail(rail, put);
    if (homeEl.__cf) homeEl.__cf();
  }
  const warmRail = (rail) => rail.querySelectorAll('img').forEach((img) => { if (img.decode) img.decode().catch(() => {}); });

  // The header picture, redrawn only when it actually changes (a sync never flashes it).
  let coverSig = null;
  function setCover(force) {
    const cov = S.coverId && byId(S.coverId), sig = [S.coverId, S.coverDots, cov && cov.file, cov && JSON.stringify(cov.crop || '')].join('|');
    if (!homeEl || (!force && sig === coverSig)) return;
    coverSig = sig;
    homeEl.querySelector('#coverslot').innerHTML = coverHTML();
    D.paintCover();
  }

  // Connection status, labelled: opens Sync. A purple dot when paired, beating while syncing, a ring if unpaired;
  // the sample notebook says so here, before you ever reach Sync.
  function paintStatus() {
    const d = homeEl && homeEl.querySelector('#pulse');
    if (!d) return;
    const s = DB.sync || {}, demo = !!window.NBNative.demo;
    // "Synced" only while the last try reached the PC; when it couldn't, the pill says so (the purple dot goes hollow)
    // and Sync explains, with when it last worked.
    const away = s.paired && S.syncFailed && !S.syncing;
    d.className = 'statuspill' + (demo ? ' sample' : S.syncing ? ' busy' : away ? '' : s.paired ? ' on' : '');
    d.querySelector('span').textContent = demo ? 'Sample' : S.syncing ? 'Syncing' : away ? 'PC offline' : s.paired ? 'Synced' : 'Not paired';
    d.setAttribute('aria-label', demo ? 'Sample notebook. Open Sync' : statusText() + '. Open Sync');
  }
  window.nbPaintStatus = () => paintStatus();
  function statusText() {
    const s = DB.sync || {};
    if (s.paired && S.syncFailed) return `Couldn't reach ${s.pcName || 'your PC'} · last synced ${ago(s.lastSync)}`;
    return s.paired ? `Synced with ${s.pcName || 'your PC'} · ${ago(s.lastSync)}` : 'Not paired with your PC yet';
  }

  // ---------- screens ----------
  // The big number counts up to its value, and rolls to a new one when things are added or removed.
  let shown = 0, countFrame = 0;
  function rollCount(el, to) {
    cancelAnimationFrame(countFrame);
    const from = shown, t0 = performance.now(), dur = from === to ? 0 : Math.min(900, 300 + Math.abs(to - from) * 12);
    const step = (now) => {
      // (a frame's time can be from before this started: never outside the old and new numbers)
      const t = dur ? Math.max(0, Math.min(1, (now - t0) / dur)) : 1, v = Math.max(Math.min(from, to), Math.min(Math.max(from, to), Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))));
      shown = v; el.innerHTML = String(v).padStart(2, '0') + '<i>.</i>';
      if (t < 1) countFrame = requestAnimationFrame(step);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { shown = to; el.innerHTML = String(to).padStart(2, '0') + '<i>.</i>'; return; }
    countFrame = requestAnimationFrame(step);
  }
  const countHTML = () => `${String(live().length).padStart(2, '0')}<i>.</i>`;
  const tabsHTML = () => ['recent', 'notes', 'ideas'].map((t, k) => `<button type="button" role="tab" aria-selected="${S.tab === t}" class="${S.tab === t ? 'on' : ''}" data-a="tab" data-v="${t}" id="tab-${t}">${['Recent', 'Notes', 'For you'][k]}</button>`).join('');
  function homeHTML() {
    return `<div class="screen" id="homescroll">
      <header class="mast" id="mast">
        <div class="mast-top"><div class="wordmark">notebook<span>.</span></div><div class="countbox"><span class="bignum" id="count">00<i>.</i></span><span class="lbl">saved</span></div>
          <button type="button" class="statuspill" id="pulse" data-a="sync" data-route="liquid"><i aria-hidden="true"></i><span></span></button>
          <button type="button" class="iconbtn" id="searchbtn" data-a="search" data-route="liquid" aria-label="Search">${svg(P.search, 19)}</button></div>
        <div class="mani" id="mani" role="img" aria-label="Header picture. Press and hold to change it"><div id="coverslot"></div></div>
      </header>
      <div class="rail" id="rail">${railHTML()}</div>
      <div class="coverdim" id="coverdim" data-a="cover" hidden></div>
      <section class="coverpanel" id="coverpanel" role="dialog" aria-label="Header picture" hidden><div class="coverbody">
        <div class="coverhead"><span class="poster">Header picture</span><button type="button" class="btn quiet popdone" data-a="cover">Done</button></div>
        <div class="covertiles tiles"></div><div class="coverseg"></div></div></section>
      <div class="tabsbar" id="tabsbar"><div class="tabs" id="homeseg" role="tablist" aria-label="Show" style="--i:${['recent', 'notes', 'ideas'].indexOf(S.tab)}">${tabsHTML()}</div><span id="homesort" class="sortslot">${SO.pillHTML('all')}</span></div>
      <div class="pager" id="homepager"><div class="grid anim${S.tab === 'notes' ? ' notes' : ''}" id="homegrid">${homeGrid()}</div></div>
    </div>`;
  }

  const boardGrid = (id, tab = S.btab, quiet) => (tab === 'ideas' ? I.gridHTML(id, quiet) : gridHTML(SO.apply(onBoard(id), id), 'Nothing on this board yet. Open an item and tap this board, or tap + while you\'re here.', id, id));
  function boardHTML() {
    const b = boards().find((x) => x.id === S.board);
    if (!b) return null;
    const list = onBoard(b.id);
    return `<div class="screen">
      <div class="bhead">
        <button type="button" class="iconbtn" data-a="boardBack" aria-label="Back" style="left:16px">${svg(P.back)}</button>
        <button type="button" class="iconbtn" data-a="editBoard" aria-label="Rename or delete board" style="right:16px">${svg(P.edit, 18)}</button>
        <div class="poster" id="boardname">${esc(b.name)}</div><div class="micro" id="boardcount">${plural(list.length, 'item')}</div>
      </div>
      <div class="tabsbar" id="boardbar"><div class="tabs two" id="boardseg" role="tablist" aria-label="Show" style="--i:${S.btab === 'ideas' ? 1 : 0}"><button type="button" role="tab" aria-selected="${S.btab !== 'ideas'}" class="${S.btab === 'ideas' ? '' : 'on'}" data-a="btab" data-v="saved" id="btab-saved">Saved</button><button type="button" role="tab" aria-selected="${S.btab === 'ideas'}" class="${S.btab === 'ideas' ? 'on' : ''}" data-a="btab" data-v="ideas" id="btab-ideas">Ideas</button></div><span id="boardsort" class="sortslot">${SO.pillHTML(b.id)}</span></div>
      <div class="pager" id="boardpager"><div class="grid anim" id="boardgrid">${boardGrid(b.id)}</div></div>
    </div>`;
  }

  // A board's name is big, but a long word never breaks in two ("WALLPAPER / S"): it shrinks until it fits the line.
  function fitTitle(el) {
    if (!el || !el.isConnected) return;
    el.style.fontSize = '';
    const max = parseFloat(getComputedStyle(el).fontSize), room = el.clientWidth;
    const c = fitTitle.c || (fitTitle.c = document.createElement('canvas').getContext('2d'));
    c.font = `400 ${max}px Anton, Impact, sans-serif`;
    const widest = Math.max(...el.textContent.toUpperCase().split(/\s+/).map((w) => c.measureText(w).width * 1.01));
    if (widest > room) el.style.fontSize = Math.max(40, Math.floor((max * room) / widest)) + 'px';
  }

  // The open item's screen (item.js).
  const { itemHTML, peekHTML } = NBItem({ S, esc, svg, P, url, vb, sanitize, byId, boards, arStyle: (it) => arStyle(it) });

  // The pictures an open item can be swiped through: those in the grid it was opened from, in order.
  const swipeList = () => {
    const seen = new Set();
    return [...(underEl || homeEl || document).querySelectorAll('.grid:not(.peek) [data-a="open"][data-v]')].map((b) => b.dataset.v)
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
  // What the PC recognised in a picture (or your corrections, which win), as the PC's own search uses it:
  // its type, styles and colours ("black" finds black things; "denim" also counts as "blue").
  const FAMILY = { 'light grey': 'grey', denim: 'blue', 'light blue': 'blue', khaki: 'beige', cream: 'white', tan: 'brown', mustard: 'yellow', lilac: 'purple', burgundy: 'red', olive: 'green', teal: 'green' };
  function seenWords(it) {
    const ai = it.ai || {}, l = it.labels || {};
    const types = [l.main || (ai.type && ai.type.main), ...(l.extra || (ai.type && ai.type.extra) || [])];
    const colours = Array.isArray(l.colours) ? l.colours : (ai.colours || []).filter((c, i) => i === 0 || c.share >= 0.2).map((c) => c.name);
    return [...types, ...(l.styles || ai.styles || []), ...colours.flatMap((c) => [c, FAMILY[c] || ''])].filter(Boolean);
  }
  function matches(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return live().filter((it) => {
      const hay = [it.title, it.caption, it.kind === 'note' ? textOf(it.html) : '', ...(it.boards || []).map((id) => (boards().find((b) => b.id === id) || {}).name), ...seenWords(it)].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  // Search (approved C1): Back and the search field share the top line; results come straight under it with a
  // quiet count. Before you type, it offers the colours and boards you actually have as quick picks.
  const COLOUR_HEX = { black: '#141416', white: '#F0F0EE', grey: '#808080', navy: '#1C2448', blue: '#2C5ABE', green: '#28823C', beige: '#DCCDAF', brown: '#6E4628', red: '#C81E28', pink: '#F096B4', purple: '#6E3CA0', yellow: '#F0D228', orange: '#F0821E' };
  function quickPicks() {
    const count = new Map();
    for (const it of live()) for (const w of new Set(seenWords(it))) if (COLOUR_HEX[w]) count.set(w, (count.get(w) || 0) + 1);
    const colours = [...count].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => `<button type="button" class="chip" data-a="searchFor" data-v="${c}"><i class="sw" style="background:${COLOUR_HEX[c]}" aria-hidden="true"></i>${c[0].toUpperCase() + c.slice(1)}</button>`);
    const bs = boards().map((b) => [b, onBoard(b.id).length]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b]) => `<button type="button" class="chip" data-a="searchFor" data-v="${esc(b.name)}">${esc(b.name)}</button>`);
    return `<div class="quickpicks">${colours.length ? `<span class="lbl">Colours</span><div class="chips">${colours.join('')}</div>` : ''}${bs.length ? `<span class="lbl">Boards</span><div class="chips">${bs.join('')}</div>` : ''}<p class="helper">Searches titles, notes, boards and what's in your pictures.</p></div>`;
  }
  function searchResults() {
    const q = (S.query || '').trim();
    if (!q) return quickPicks();
    const found = matches(q);
    if (!found.length) return `<p class="helper searchnone">Nothing matches “${esc(q)}”.</p>`;
    return `<p class="searchcount">${plural(found.length, 'thing')}</p>${gridHTML(found, 'x')}`;
  }
  // Utility screens share one top: Back, then a small title (Sync, Bin) or the search field (Search).
  const utilTop = (title, back, extra = '') => `<div class="utiltop"><button type="button" class="iconbtn" data-a="${back}" aria-label="Back">${svg(P.back)}</button>${title ? `<h1 class="poster toptitle">${title}</h1>` : ''}${extra}</div>`;
  function searchHTML() {
    return `<div class="screen util">
      ${utilTop('', 'home', `<label class="topsearch">${svg(P.search, 18)}<input id="q" type="search" enterkeyhint="search" placeholder="Search your notebook" autocomplete="off" aria-label="Search titles, notes, boards and what's in your pictures" value="${esc(S.query || '')}"></label>`)}
      <div class="grid" id="searchgrid">${searchResults()}</div>
    </div>`;
  }

  const binned = () => DB.items.filter((it) => it.deletedAt);
  function binHTML() {
    const list = binned();
    return `<div class="screen util">
      ${utilTop('Bin', 'binBack')}
      <div class="utilbody">
        <span class="micro" id="bincount">${plural(list.length, 'item')}</span>
        <p class="helper">Things stay here until you delete them. Tap one to put it back.</p>
        <button type="button" class="btn danger" data-a="emptyBin" id="emptybin" style="align-self:flex-start"${list.length ? '' : ' hidden'}>${svg(P.bin, 16)}<span>Empty Bin</span></button>
      </div>
      <div class="grid" id="bingrid">${gridHTML(list, 'Bin is empty|Nothing here. Things you bin wait here until you delete them.')}</div>
    </div>`;
  }

  const { syncHTML, syncBodyHTML, showSyncMsg } = NBSyncScreen({ S, $, db: () => DB, esc, svg, P, ago, plural, live, binned, statusText, home: () => homeEl, toast, top: utilTop });

  // ---------- persistent parts ----------
  function chromeHTML() {
    return `<div id="stage"></div>
    <div class="statusscrim" aria-hidden="true"></div>
    <button type="button" class="orb" id="orb" aria-label="New note. Hold for photos and camera" aria-haspopup="menu" aria-expanded="false">${svg(P.plus, 28, 2.6)}</button>
    <div class="shelf" id="shelf" hidden></div>
    <div class="shelfmini" id="shelfmini" aria-hidden="true" hidden></div>
    <div class="pullind" id="pullind" aria-hidden="true">${svg(P.sync, 20, 2.4)}</div>
    <div class="popscrim" id="popscrim" data-a="closePops" hidden></div>
    <div class="popsheet frost formsheet" id="formsheet" hidden></div>
    <div class="selbar" id="selbar" role="toolbar" aria-label="Selected items" hidden><button type="button" class="selx" data-a="selCancel" aria-label="Stop selecting">${svg('M6 6l12 12M18 6L6 18', 18, 2.4)}</button><span id="selcount"></span><button type="button" class="selx" data-a="selPin" id="selpin" aria-label="Pin to the top">${svg(PIN, 18, 2.2)}</button><button type="button" class="selx" data-a="selBin" id="selbin" aria-label="Move to Bin">${svg(P.bin, 18)}</button><button type="button" class="btn white" data-a="selStack" id="selstack" title="Select at least two items">Stack</button></div>
    <div id="toastbox"></div>`;
  }

  // Dotted or the plain photo: two icons, shown once a photo is the picture.
  const segHTML = () => (S.coverId ? `<span class="lbl">Style</span><button type="button" class="chip${S.coverDots ? ' on' : ''}" data-a="dots" aria-pressed="${S.coverDots}">${svg('M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01', 18, 3.2)}<span>Dotted</span></button><button type="button" class="chip${S.coverDots ? '' : ' on'}" data-a="plain" aria-pressed="${!S.coverDots}">${svg(P.photo, 18, 1.9)}<span>Photo</span></button>` : '');
  function tilesHTML() {
    const tiles = [{ id: '', label: 'MANI' }].concat(live().filter((x) => x.kind === 'photo' && x.file).map((x) => ({ id: x.id, label: x.title, img: url(x.thumb || x.file) })));
    return tiles.map((t) => { const on = S.coverId === t.id; return `<button type="button" class="tile${on ? ' on' : ''}" aria-pressed="${on}" aria-label="Use ${esc(t.label)} as cover" data-a="coverPick" data-v="${t.id}">${t.img ? `<img src="${t.img}" alt="" loading="lazy" decoding="async">` : '<span class="manitile">MANI</span>'}</button>`; }).join('');
  }

  const showSheet = (el, on) => M.showSheet(el, on, on ? null : updateChrome);
  const closePops = () => { if (S.sheet && keyboardBusy()) return; if (S.sheet) closeForm(); updateChrome(); }; // (a tap as the keyboard moves the form is not a tap beside it)

  function updateChrome() {
    // The bottom action area (dock.js) shows what is going on, always out of the +: the orb, the picking bar while
    // cards are picked, the shelf while they're carried, a small form. Under an open item or the header picture it
    // steps out of the way; while a new note grows out of the orb (or folds back) the orb is that note.
    const scrim = $('#popscrim');
    // (a Pinterest idea flying back into its pin gives the + back as it goes: ideaview.js keeps it unpressable until then)
    const away = (S.screen === 'item' && !S.sheet) || !!S.cover || !!S.orbBusy || (!!S.ideaView && !S.ideaLeaving);
    // The picking bar's count and what it allows are settled first, from the same picked set, so it comes out of the
    // + already right (Stack needs two or more) and never changes look on the way.
    const cards = S.select ? Dg.pickedCards() : 0;
    if (S.select) { $('#selcount').textContent = `${cards} selected`; $('#selstack').disabled = cards < 2; $('#selbin').disabled = cards < 1; const pin = $('#selpin'), all = cards > 0 && [...S.select].every(SO.isPinned); pin.disabled = cards < 1; pin.classList.toggle('on', all); pin.setAttribute('aria-label', all ? 'Unpin' : 'Pin to the top'); }
    if (away) Dk.to('away', { instant: !!S.orbBusy });
    else Dk.want(S.sheet ? 'form' : S.dragging ? (S.shelfOpen ? 'boards' : 'drag') : S.select ? 'pick' : 'orb');
    showSheet(scrim, !!S.sheet);
    if ((away || S.select || S.dragging) && F.isOpen()) F.close();
    if ($('#toastbox').firstElementChild) { toastWatch.disconnect(); const sh = currentEl && currentEl.querySelector('.sheet'); if (sh) toastWatch.observe(sh); placeToast(); }
  }

  // ---------- screens: build only the one you move to; Home is kept as you left it ----------
  let homeEl = null, currentEl = null, underEl = null, homeVer = 0;
  let quietGrid = false; // a change made on the way to another screen: the grid behind updates without moving
  let flipSkip = null;   // a card something else is bringing in (a new stack its cards fly into) keeps still
  let D = null;
  const T = NBTilt(app);
  const M = NBMotion({
    S, app, tick, $, home: () => homeEl, current: () => currentEl, actions: () => A,
    orbBack: () => { S.orbBusy = false; Dk.to('orb', { instant: true }); updateChrome(); },
    coverOpen: () => S.cover, dots: { startCharge: (x, y) => D && D.startCharge(x, y), cancelCharge: () => D && D.cancelCharge() }
  });
  const Dk = NBDock({ $ });
  const ST = NBStacks({ S, tick });
  const Dg = NBDrag({
    S, app, tick, $, esc, url, db: () => DB, actions: () => A, updateChrome: () => updateChrome(), stacks: ST,
    swallowClick: M.swallowClick, clearSwallow: M.clearSwallow
  });
  D = NBDots({ S, hap, home: () => homeEl, tiles: () => tilesHTML(), seg: () => segHTML(), dim: (on) => { const d = homeEl && homeEl.querySelector('#coverdim'); if (d) d.hidden = !on; updateChrome(); } });
  const SO = NBSort({ N, esc });
  const Pg = NBPager({ S, tick });
  const I = NBIdeas({ N, S, $, esc, toast, boardName: () => (S.screen === 'board' ? (boards().find((b) => b.id === S.board) || {}).name : ''), rerender: () => refreshIdeas(), reveal: () => {}, saved: () => IV.refresh() });
  const IV = NBIdeaView({ S, $, esc, I, tick, updateChrome: () => updateChrome() });
  const { animateSwap, wireHome } = M;
  const { wireGrid, markSelection, toggleSelect, endSelect } = Dg;
  // The orb's actions, on the arc: the ones you use most nearest the thumb.
  const fanItems = () => [
    { id: 'addGallery', label: 'Photos', icon: svg(P.photo, 22, 1.9) },
    { id: 'addNote', label: 'Note', icon: svg(P.note, 22, 1.9) },
    { id: 'addCamera', label: 'Camera', icon: svg(P.camera, 22, 1.9) }
  ]; // creation only, always in this order; Search and Sync live in Home's header
  const F = NBFan({ app, hap, items: fanItems, run: (id) => A[id](), tap: () => A.addNote() });
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
    setRail(quietGrid);
    const hg = homeEl.querySelector('#homegrid');
    hg.classList.remove('anim'); // the first-load entrance is over: an update must not replay it (every card blinked out)
    if (quietGrid) hg.innerHTML = homeGrid(); else M.flipGrid(hg, () => { hg.innerHTML = homeGrid(); }, flipSkip);
    homeEl.__pager?.sync();
    rollCount(homeEl.querySelector('#count'), live().length);
    paintStatus();
    setCover();
  }

  // Redraws keep the cursor in an Ideas search field that is being typed in.
  function keepIdeaFocus(fn) {
    const query = document.activeElement?.matches('.idea-query') ? document.activeElement : null;
    const focus = query && { base: query.closest('form').dataset.base, start: query.selectionStart, end: query.selectionEnd };
    fn();
    if (focus) {
      const next = [...document.querySelectorAll('.ideas-search')].find((form) => form.dataset.base === focus.base)?.querySelector('input');
      if (next) { next.focus({ preventScroll: true }); next.setSelectionRange(focus.start, focus.end); }
    }
  }
  // After any library change: update whatever screen is showing, in place.
  function refresh() { keepIdeaFocus(() => { refreshScreen(); if (S.select) markSelection(); }); }
  // Ideas arrived or changed: only the Ideas panes redraw (never the masthead, rail or count), including a pane
  // waiting beside the grid mid-swipe, so a tab never lands showing an old state.
  function refreshIdeas() {
    IV.refresh();
    keepIdeaFocus(() => {
      if (homeEl) {
        if (S.tab === 'ideas') homeEl.querySelector('#homegrid').innerHTML = homeGrid('ideas');
        homeEl.__pager?.sync();
      }
      const board = S.screen === 'board' ? currentEl : underEl?.dataset.screen === 'board' ? underEl : null;
      if (board && board.__pager) {
        if ((S.btab || 'saved') === 'ideas') board.querySelector('#boardgrid').innerHTML = boardGrid(S.board, 'ideas');
        board.__pager.sync();
      }
    });
  }
  function refreshScreen() {
    if (currentEl) currentEl.dataset.ver = dataVer;
    if (S.screen === 'home') refreshHome();
    else if (S.screen === 'board') {
      const b = boards().find((x) => x.id === S.board);
      if (!b) { go('home'); return; }
      const list = onBoard(b.id);
      $('#boardname').textContent = b.name; fitTitle($('#boardname'));
      $('#boardcount').textContent = plural(list.length, 'item');
      $('#boardgrid').classList.remove('anim');
      if (quietGrid) $('#boardgrid').innerHTML = boardGrid(b.id); else M.flipGrid($('#boardgrid'), () => { $('#boardgrid').innerHTML = boardGrid(b.id); }, flipSkip);
      currentEl.__pager?.sync();
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
      M.flipGrid($('#bingrid'), () => { $('#bingrid').innerHTML = gridHTML(list, 'Bin is empty|Nothing here. Things you bin wait here until you delete them.'); });
    }
  }

  // The photo's shape (width / height) for the rounded media frame; the stage falls back to a plain fit without it.
  const arStyle = (it) => { const s = shapeOf(it); return s && s[0] > 0 && s[1] > 0 ? `--ar:${(s[0] / s[1]).toFixed(4)}` : ''; };

  // A swiped or tapped tab has landed: the strip has already shown the new pane, so this only puts the state right.
  function commitHomeTab(t, nodes) {
    S.tab = t;
    for (const k of ['recent', 'notes', 'ideas']) homeEl.querySelector('#tab-' + k).classList.toggle('on', k === t);
    const g = homeEl.querySelector('#homegrid');
    g.classList.remove('anim');
    g.classList.toggle('notes', t === 'notes');
    if (nodes) g.replaceChildren(...nodes); else g.innerHTML = homeGrid(t);
  }
  function commitBoardTab(t, nodes) {
    S.btab = t;
    $('#btab-saved').classList.toggle('on', t === 'saved'); $('#btab-ideas').classList.toggle('on', t === 'ideas');
    const g = $('#boardgrid');
    g.classList.remove('anim');
    if (nodes) g.replaceChildren(...nodes); else g.innerHTML = boardGrid(S.board, t);
  }

  function showScreen(kind) {
    const stage = $('#stage');
    const old = currentEl;
    if (old) old.querySelector('video')?.pause();
    let el;
    // Back from an open item, the screen underneath is still covered by it: it catches up at once, without moving,
    // so the item lands on a card that is already exactly where it will stay.
    const fromItem = !!old && old.dataset.screen === 'item' && S.screen !== 'item';
    const turning = [...stage.children].find((n) => n.__route && n.dataset.screen === S.screen && (S.screen !== 'item' || n.dataset.item === S.item));
    if (S.screen === 'home' && homeEl) {
      homeEl.querySelector('#homegrid').classList.remove('anim'); // the first-load entrance is over; changes glide from here
      quietGrid = fromItem; refreshHome(); quietGrid = false;
      el = homeEl;
    } else if (underEl && underEl.dataset.screen === S.screen && fromItem) {
      el = underEl; // back from an open item to the board / search it was opened from, as you left it
      el.querySelectorAll('.grid.anim').forEach((g) => g.classList.remove('anim')); // no second entrance
    } else if (turning) {
      el = turning; // still folding away: it turns round
    } else {
      el = build(S.screen);
      if (!el) { S.screen = 'home'; return showScreen('fade'); }
      el.dataset.screen = S.screen;
      el.dataset.ver = dataVer;
      if (S.screen === 'home') { homeEl = el; homeVer = dataVer; }
      if (S.screen === 'item') { el.dataset.item = S.item; if (draft && S.item === draft.id) { el.dataset.draft = '1'; el.__draft = draft; } }
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
      if (stale.__route) { cancelAnimationFrame(stale.__route.raf); if (stale.__route.end) stale.__route.end(); stale.__route = null; }
      if (stale === homeEl) { stale.style.visibility = 'hidden'; stale.style.opacity = ''; } else stale.remove();
    }
    // Moving a screen within the page resets its scrolling: note where it was and put it back after.
    const scrolled = [el].map((n) => [n, n.scrollTop]);
    const back = kind === 'unzoom' || kind === 'pop' || kind === 'close' || kind === 'binned';
    if (el !== old && (el.parentNode !== stage || !back)) stage.appendChild(el); // going back, it's already in place under the one leaving
    currentEl = el;
    if (S.screen === 'home' && !el.dataset.wired) {
      el.dataset.wired = '1'; setCover(true); warmRail(el.querySelector('#rail')); wireHome(el); el.__cf = T.coverflow(el.querySelector('#rail')); rollCount(el.querySelector('#count'), live().length); paintStatus();
      el.__pager = Pg.wire(el, { pager: '#homepager', grid: '#homegrid', tabs: '#homeseg', order: ['recent', 'notes', 'ideas'], get: () => S.tab, html: (t, quiet) => homeGrid(t, quiet), shown: (t) => t === 'ideas' && I.look('all'), commit: commitHomeTab, sort: '#homesort' });
    }
    if (S.screen === 'board' && !el.dataset.wired) {
      el.dataset.wired = '1';
      el.__pager = Pg.wire(el, { pager: '#boardpager', grid: '#boardgrid', tabs: '#boardseg', order: ['saved', 'ideas'], get: () => S.btab || 'saved', html: (t, quiet) => boardGrid(S.board, t, quiet), shown: (t) => t === 'ideas' && I.look(S.board), commit: commitBoardTab, sort: '#boardsort' });
      fitTitle(el.querySelector('#boardname'));
      const bar = el.querySelector('#boardbar'), st = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
      el.addEventListener('scroll', () => bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= st() + 1), { passive: true }); // a backing only once it sticks
    }
    const ut = el.querySelector(':scope > .utiltop');
    if (ut && !el.__utw) { el.__utw = 1; el.addEventListener('scroll', () => ut.classList.toggle('stuck', el.scrollTop > 4), { passive: true }); }
    if (S.screen === 'item' && !el.dataset.wired) { el.dataset.wired = '1'; wireItem(el); }
    el.querySelectorAll('.grid:not(.peek)').forEach(wireGrid);
    if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
    if (S.screen === 'search' && !el.dataset.wired) {
      el.dataset.wired = '1';
      const q = el.querySelector('#q');
      q.addEventListener('input', () => { S.query = q.value; el.querySelector('#searchgrid').innerHTML = searchResults(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
      if (!S.query) setTimeout(() => q.focus(), 350);
    }
    for (const [n, top] of scrolled) if (n.scrollTop !== top) n.scrollTop = top;
    // A kept screen catches up, only if something changed while it was covered (no needless redraw).
    if (el !== homeEl && +el.dataset.ver !== dataVer) { quietGrid = fromItem; refreshScreen(); quietGrid = false; }
    animateSwap(old, el, kind);
    updateChrome();
  }

  function go(screen, extra, kind) {
    if (document.activeElement && document.activeElement.matches('input, textarea, [contenteditable="true"]')) document.activeElement.blur();
    D.closeNow();
    if (S.select) endSelect(); // picking belongs to the screen it was started on: don't leave cards marked behind it
    Object.assign(S, extra || {}, { screen, add: false, cover: false, sheet: null, select: null });
    showScreen(kind || 'fade');
  }

  // The open note is a draft (see byId): it becomes a real note, with `fields`, and the screen carries on as that note.
  const isDraft = () => !!draft && S.item === draft.id;
  function keepDraft(fields) {
    if (!isDraft()) return true;
    const boardsOn = draft.boards.slice(), r = call('addNote', boardsOn[0] || '');
    if (!r) return false;
    draft = null; S.item = r.id;
    const scr = [...$('#stage').children].find((n) => n.dataset.draft);
    if (scr) { scr.dataset.item = r.id; delete scr.dataset.draft; scr.__draft = null; }
    const rest = { ...(fields || {}) };
    if (boardsOn.length > 1) rest.boards = boardsOn;
    if (Object.keys(rest).length) call('update', r.id, JSON.stringify(rest));
    return true;
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
      flushSave.fn = () => {
        const html = sanitize(ed.innerHTML);
        if (isDraft()) { if (textOf(html)) keepDraft({ html, title: noteTitle(html) }); return; } // nothing written yet: still just a draft
        call('update', S.item, JSON.stringify({ html, title: noteTitle(html) }));
      };
      ed.addEventListener('input', () => { if (S.tidyUndo !== null) { S.tidyUndo = null; $('#tidybtn').textContent = 'Tidy up'; } saveSoon(flushSave.fn); });
      ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
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
  const { openForm, closeForm, saveForm, keyboardBusy } = NBForms({ S, $, N, esc, boards, byId, call, toast, showSyncMsg, updateChrome: () => updateChrome() });

  // ---------- actions ----------
  // Search and Sync open out of their controls in Home's header and fold back into them; anything else fades.
  const OPENS = { search: '#searchbtn', sync: '#pulse' };
  const tabKind = (to) => {
    if (OPENS[to] && S.screen === 'home') { S.origin = homeEl.querySelector(OPENS[to]); return 'open'; }
    if (OPENS[S.screen] && to === 'home') { S.origin = homeEl && homeEl.querySelector(OPENS[S.screen]); return 'close'; }
    return 'fade';
  };
  const pileOf = (id) => homeEl && homeEl.querySelector(`.pile[data-v="${CSS.escape(id || '')}"] .pile-stack`);
  const currentBoard = () => (S.screen === 'board' ? S.board : '');
  const A = {
    home: () => go('home', null, tabKind('home')),
    boardBack: () => { if (!I.back()) go('home', { origin: pileOf(S.board) }, 'close'); },
    sync: () => go('sync', null, tabKind('sync')),
    search: () => go('search', null, tabKind('search')),
    searchFor: (v) => { const q = $('#q'); if (!q) return; q.value = v; S.query = v; $('#searchgrid').innerHTML = searchResults(); tick(); },
    selCancel: () => endSelect(),
    // Picked things stay at the top of every list (or come off it again), with the grid moving to show it.
    // The picking bar itself becomes the message (then folds into the orb): the + never shows in between.
    selPin: () => {
      const ids = [...S.select], on = !ids.every(SO.isPinned);
      SO.setPins(ids, on);
      toast(on ? `Pinned ${plural(ids.length, 'thing')} to the top` : `Unpinned ${plural(ids.length, 'thing')}`);
      endSelect(); dataVer++; refresh();
    },
    // Picked things go to the Bin together, with one Undo that puts them all back.
    selBin: () => {
      const ids = [...S.select].filter((id) => byId(id) && !byId(id).deletedAt);
      if (!ids.length) return;
      const done = batch(() => ids.filter((id) => call('bin', id)));
      if (done.length) toast(`${plural(done.length, 'thing')} moved to Bin`, () => { const back = batch(() => done.filter((id) => call('restore', id))); if (back.length) toast(`Restored ${plural(back.length, 'thing')}`); }, 'bin');
      endSelect();
    },
    // Stacked: the new stack's place and size are settled first (it waits hidden, its neighbours making their one
    // move), then the cards fly into it together and hand over as they land. `lead` goes in front. Returns its id.
    stackIds: (ids, lead) => {
      S.nextFront = lead || ids[0];
      flipSkip = (c) => c.classList.contains('stackcard') && ids.some((id) => c.querySelector(`.fanitem[data-v="${CSS.escape(id)}"]`));
      const r = call('stack', JSON.stringify(ids), currentBoard());
      flipSkip = null; S.nextFront = null;
      if (!r) return null;
      const first = N.getPref('stackHint') !== '1';
      if (first) N.setPref('stackHint', '1');
      toast(`Stacked ${ids.length}${first ? ' · flick to go through' : ''}`);
      return r.id;
    },
    selStack: () => {
      const ids = [...S.select];
      if (ids.length < 2) return;
      const grid = currentEl && currentEl.querySelector('.grid:not(.peek)'), faces = Dg.lift(grid ? [...grid.querySelectorAll(':scope > .card.sel')] : []);
      const id = A.stackIds(ids, ids[0]);
      endSelect();
      if (!id) { faces.remove(); return; }
      Dg.converge(faces.faces, id, faces.remove);
    },
    unstack: () => { const it = byId(S.item); if (it && call('unstack', it.id)) { toast('Taken out of the stack'); A.leaveItem(); } },
    openBin: () => go('bin', null, 'push'),
    binBack: () => go('sync', null, 'pop'),
    binItem: (v) => { S.binItem = v; openForm('binItem'); },
    restoreItem: () => { const it = byId(S.binItem); if (it && call('restore', it.id)) { closeForm(); toast('Restored'); } },
    deleteForever: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.textContent = 'Tap again to delete for good'; return; }
      if (call('deleteForever', S.binItem)) { closeForm(); toast('Deleted for good'); }
    },
    emptyBin: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; el.querySelector('span').textContent = `Tap again to delete ${plural(binned().length, 'item')} for good`; return; }
      const r = call('deleteForever', '');
      if (r) toast(`Deleted ${plural(Number(r.id) || 0, 'item')} for good`);
    },
    closeFan: () => F.close(),
    // Dropped on a board in the shelf: added to it (and kept where it was), with an Undo.
    fileTo: (ids, boardId) => {
      const before = ids.map((id) => [id, ((byId(id) || {}).boards || []).slice()]);
      if (!batch(() => { for (const id of ids) { const it = byId(id); if (it && !(it.boards || []).includes(boardId) && !call('update', id, JSON.stringify({ boards: (it.boards || []).concat(boardId) }))) return false; } return true; })) return false;
      const name = (boards().find((b) => b.id === boardId) || {}).name || 'the board';
      toast(`Filed in ${name}`, () => batch(() => { for (const [id, bs] of before) call('update', id, JSON.stringify({ boards: bs })); }));
      return true;
    },
    cover: () => { F.close(); if (S.cover) D.close(); else D.open(); },
    coverPick: (v) => {
      const changed = (v || '') !== S.coverId;
      S.coverId = v || ''; N.setPref('coverId', S.coverId);
      if (changed) setCover();
      $('#coverpanel').querySelectorAll('.tile').forEach((el) => { const on = el.dataset.v === S.coverId; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); });
      D.close(changed);
    },
    dots: () => setStyle(true),
    plain: () => setStyle(false),
    tab: (v) => { if (S.tab === v || !homeEl) return; homeEl.__pager.goTo(v); },
    pile: (v, el) => { hap('soft'); go('board', { board: v, btab: 'saved', origin: el.querySelector('.pile-stack') }, 'open'); },
    newBoard: () => openForm('newBoard'),
    btab: (v) => { if ((S.btab || 'saved') === v || S.screen !== 'board') return; currentEl.__pager.goTo(v); },
    // A pin opens full screen out of itself (ideaview.js); its actions sit under the picture.
    idea: (v) => IV.open(v),
    ideaClose: () => IV.close(),
    ideaSave: () => { I.save(S.screen === 'board' ? S.board : ''); IV.refresh(); },
    ideaHide: () => IV.close(() => I.hide(), 'away'),
    ideaOpen: () => I.openPin(),
    ideaRelated: () => IV.close(() => I.related(), 'away'),
    ideasBack: () => I.back(),
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
    addGallery: () => { N.pick(currentBoard()); },
    addCamera: () => { N.camera(currentBoard()); },
    // A new note: the orb opens up into it (it is the note now, so it doesn't drop away first). It is only a draft
    // until something is written in it, so nothing else on the screen changes. Tapping + while an untouched note is
    // still folding back into the orb turns that same note round.
    addNote: () => {
      window.nbFanOrigin = null;
      flushSave();
      const folding = [...$('#stage').children].find((n) => n.__route && n.dataset.draft && n.__draft);
      draft = folding ? folding.__draft : { id: 'draft:' + Date.now(), kind: 'note', title: 'Untitled note', html: '', boards: currentBoard() ? [currentBoard()] : [] };
      hap('soft');
      S.orbBusy = !calm();
      go('item', { item: draft.id, prev: S.screen === 'item' ? S.prev : S.screen }, 'grow');
      S.orbBusy = false;
    },
    open: (v) => go('item', { item: v, prev: S.screen }, 'zoom'),
    back: () => { if (S.screen !== 'item' || !NBViewer.back()) A.leaveItem(); },
    // Leaving a note that never had anything written in it: nothing was ever saved, and it folds back into the orb,
    // which is there again the moment it lands.
    leaveItem: () => {
      flushSave();
      const to = S.prev === 'item' ? 'home' : S.prev;
      if (S.screen !== 'item') { go(to, null, S.screen === 'board' ? 'pop' : 'fade'); return; }
      if (isDraft()) { draft = null; S.orbBusy = !calm(); }
      go(to, null, 'unzoom');
    },
    bin: () => {
      flushSave();
      const id = S.item;
      if (isDraft()) { draft = null; go(S.prev === 'item' ? 'home' : S.prev, null, 'binned'); return; } // nothing to bin: it just goes
      if (!call('bin', id)) return;
      if (S.screen === 'item') go(S.prev === 'item' ? 'home' : S.prev, null, 'binned');
      // The message names what was binned, so it stays clear after opening something else. A newer deletion
      // replaces it (and its Undo); older ones wait in the Bin.
      const title = (byId(id) || {}).title || 'item';
      toast(`“${title.length > 15 ? title.slice(0, 14) + '…' : title}” moved to Bin`, () => { if (call('restore', id)) toast('Restored'); }, 'bin');
    },
    undo: () => { const f = toast.undo, seq = toastSeq; toast.undo = null; if (f) f(); if (toastSeq === seq) foldToast(); }, // a new message (Put back) takes the same pill
    boardToggle: (v, el) => {
      if (isDraft()) { // choosing a board is something: the note is kept, on the boards it now has
        const has = draft.boards.includes(v), next = has ? draft.boards.filter((x) => x !== v) : draft.boards.concat(v), ed = $('#editor'), html = ed ? sanitize(ed.innerHTML) : '';
        draft.boards = next;
        if (keepDraft({ boards: next, ...(textOf(html) ? { html, title: noteTitle(html) } : {}) })) pour(el, !has);
        return;
      }
      const it = byId(S.item);
      const has = (it.boards || []).includes(v);
      if (call('update', it.id, JSON.stringify({ boards: has ? it.boards.filter((x) => x !== v) : (it.boards || []).concat(v) }))) pour(el, !has);
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
    pinBoard: (x, el) => {
      const p = pinned(), on = !p.includes(S.board);
      N.setPref('pins', JSON.stringify(on ? [...p, S.board] : p.filter((id) => id !== S.board)));
      el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); el.setAttribute('aria-label', on ? 'Unpin from the front' : 'Pin to the front');
      tick();
      setRail(false);
    },
    // Delete: tap once and it turns red, tap again and the bar itself shrinks into the "Deleted" message, which later
    // folds back into the orb. Its items stay in the notebook; Undo makes the board again with the same items.
    deleteBoard: (x, el) => {
      if (!el.dataset.sure) {
        // Armed: the libraries.dev Border Beam pulse breathes inside it (confirm.js) until a second tap, or it calms
        // down after four seconds.
        el.dataset.sure = '1'; el.classList.add('sure'); el.setAttribute('aria-label', 'Tap again to delete the board'); hap('soft');
        NBConfirm.on(el);
        clearTimeout(el.__disarm);
        el.__disarm = setTimeout(() => { delete el.dataset.sure; el.classList.remove('sure'); el.setAttribute('aria-label', 'Delete board (its items stay)'); NBConfirm.off(el); }, 4000);
        return;
      }
      clearTimeout(el.__disarm); NBConfirm.off(el);
      const b = boards().find((z) => z.id === S.board);
      if (!b) return;
      const { id, name } = b, ids = onBoard(id).map((it) => it.id), wasPinned = pinned().includes(id);
      const undo = () => {
        const r = batch(() => {
          const made = call('addBoard', name);
          if (!made) return null;
          for (const i of ids) { const it = byId(i); if (it && !(it.boards || []).includes(made.id)) call('update', i, JSON.stringify({ boards: (it.boards || []).concat(made.id) })); }
          if (wasPinned) N.setPref('pins', JSON.stringify([...pinned(), made.id]));
          held = true; // (the pin order is part of it: the rail redraws once, with the board back in its place)
          return made;
        });
        if (r) toast(`“${name}” is back`);
      };
      toast(`Deleted “${name}”`, undo, 'bin', $('#formsheet')); // the bar becomes the message, set up before the change (which can leave the board's screen)
      const ok = call('deleteBoard', id);
      closeForm();
      if (!ok) return; // the pill says why instead
      hap('success');
      if (S.screen === 'board') go('home');
    },
    closeForm: () => closeForm(),
    saveForm: () => saveForm(),
    pullSync: () => { if ((DB.sync || {}).paired) N.sync(); else { toast('Pair with your PC first'); } },
    demoOn: () => { N.setPref('demo', '1'); (N.reload || (() => location.reload()))(); },
    demoOff: () => N.exitDemo(),
    galleryStart: () => N.galleryStart?.(),
    galleryStop: () => N.galleryStop?.(),
    galleryPermissions: () => N.galleryPermissions?.(),
    galleryManage: () => N.galleryManage?.(),
    pastePairingLink: () => N.pastePairingLink?.(),
    scan: () => { showSyncMsg(''); N.scan(); },
    manual: () => openForm('manual'),
    syncNow: () => { showSyncMsg(''); N.sync(); },
    unpair: (x, el) => {
      if (!el.dataset.sure) { el.dataset.sure = '1'; (el.querySelector('span') || el).textContent = 'Tap again to forget this PC'; return; }
      DB = JSON.parse(N.unpair());
      $('#syncbody').innerHTML = syncBodyHTML();
      paintStatus();
    }
  };
  // Liquid choices: a chosen chip fills with purple poured from where it was tapped, on the approved Liquid curve,
  // and drains back into that point when turned off (one progress number, so a quick re-tap turns it round).
  let tapAt = null;
  app.addEventListener('pointerdown', (e) => { const c = e.target.closest('.chip'); tapAt = c ? { c, x: e.clientX, y: e.clientY } : null; }, true);
  function pour(chip, on) {
    if (!chip || !chip.isConnected) return;
    const r = chip.getBoundingClientRect(), at = tapAt && tapAt.c === chip ? tapAt : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const x = at.x - r.left, y = at.y - r.top, far = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) + 2;
    const st = chip.__pour || (chip.__pour = { p: on ? 0 : 1, raf: 0 });
    cancelAnimationFrame(st.raf);
    chip.style.setProperty('--px', x.toFixed(1) + 'px'); chip.style.setProperty('--py', y.toFixed(1) + 'px');
    const from = st.p, to = on ? 1 : 0, ms = (on ? 420 : 300) * Math.max(0.4, Math.abs(to - from)), t0 = performance.now();
    const done = () => { chip.style.removeProperty('--pr'); chip.classList.remove('poured'); chip.__pour = null; };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    const step = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0) / ms)); st.p = from + (to - from) * window.NBLiquid.fluidOpen(t);
      chip.style.setProperty('--pr', Math.max(0, st.p * far).toFixed(1) + 'px');
      chip.classList.toggle('poured', st.p > 0.55); // the text turns dark only once the purple is under it
      if (t < 1) st.raf = requestAnimationFrame(step); else done();
    };
    chip.style.setProperty('--pr', Math.max(0, from * far).toFixed(1) + 'px');
    st.raf = requestAnimationFrame(step);
  }
  // Dotted / Photo: switch in place (no redraw), so the choice pours across.
  function setStyle(dots) {
    if (S.coverDots === dots) return;
    S.coverDots = dots; N.setPref('coverDots', dots ? '1' : '0'); setCover();
    $('#coverpanel .coverseg').querySelectorAll('.chip').forEach((c) => { const on = (c.dataset.a === 'dots') === dots; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); pour(c, on); });
  }
  app.addEventListener('click', (e) => {
    if (M.takeSwallowed()) return;
    if (!e.target.closest('.sortmenu, .sortpill') && SO.closeMenu()) return; // a tap anywhere else only closes the sort menu
    if (S.select && e.target.closest('.grid .card:not(.idea)')) { toggleSelect(e.target.closest('.grid .card')); return; }
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) A[el.dataset.a](el.dataset.v, el);
  });
  // Buttons on an open item's sheet act on a clean press and release on the button itself. Straight after the
  // sheet has been dragged, the browser can drop the click that should follow such a tap (audit F14: taps on the
  // Bin that did nothing); the press is still real, so it is honoured, and the late click (if any) is ignored.
  let press = null, pressFired = 0;
  const SHEET_BTN = '.sheet button';
  app.addEventListener('pointerdown', (e) => { const b = e.isPrimary && e.button === 0 && e.target.closest(SHEET_BTN); press = b && !b.disabled ? { b, id: e.pointerId, x: e.clientX, y: e.clientY } : null; }, true);
  app.addEventListener('pointercancel', () => { press = null; }, true);
  app.addEventListener('pointerup', (e) => {
    const p = press; press = null;
    if (!p || p.id !== e.pointerId || e.target.closest(SHEET_BTN) !== p.b || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 8) return; // 8px: the sheet's own drag threshold
    p.b.__firedAt = pressFired = performance.now();
    p.b.click(); // acts on release, once
  }, true);
  app.addEventListener('click', (e) => {
    const b = e.isTrusted && e.target.closest(SHEET_BTN);
    if (b && b.__firedAt && performance.now() - b.__firedAt < 700) { b.__firedAt = 0; e.stopImmediatePropagation(); e.preventDefault(); return; } // already done on release
    // The same tap's own click, after that button closed its screen (Bin, Done): it would land on whatever is now
    // underneath (a card in the grid, opening it). It belongs to the button, so it goes nowhere.
    if (e.isTrusted && pressFired && performance.now() - pressFired < 450) { pressFired = 0; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  app.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.nbBack(); else if (e.key === 'Enter' && e.target.classList.contains('field')) saveForm(); });

  // Android back gesture: close a panel or step back before leaving the app.
  window.nbBack = () => {
    if (Dg.cancel()) return true; // mid-carry: it all goes home, the picking stays
    if (S.select) { endSelect(); return true; }
    if (SO.closeMenu()) return true;
    if (S.sheet) { closeForm(); return true; }
    if (F.isOpen()) { F.close(); return true; }
    if (S.ideaView) { IV.close(); return true; }
    if (S.cover) { D.close(); return true; }
    if (I.back()) return true;
    if (S.screen === 'item') { A.back(); return true; }
    if (S.screen === 'board') { A.boardBack(); return true; }
    if (S.screen === 'bin') { A.binBack(); return true; }
    if (S.screen !== 'home') { A.home(); return true; }
    return false;
  };
  app.innerHTML = chromeHTML();
  M.wirePops([...app.querySelectorAll('#formsheet')], closePops);
  F.wire();
  showScreen('fade');
  // Catch up with the PC quietly when the app opens, and keep "synced x min ago" current.
  if ((DB.sync || {}).paired) setTimeout(() => N.syncQuiet(), 1200);
  setInterval(() => {
    paintStatus();
    if (S.screen === 'sync' && $('#synclast')) $('#synclast').textContent = ago((DB.sync || {}).lastSync);
  }, 30000);
})();
