// The main screen: board cards, the grid, the dock, search, drag-and-drop and previews.
(() => {
  const { h, icon, toast } = NB;
  const $ = (id) => document.getElementById(id);
  const S = NB.S = { snap: null, board: 'all', q: '', dir: 'r', anim: true, renaming: false, bad: new Set(), queued: new Set(), busy: false };
  const NOTE_TINTS = ['#1F1D16', '#171D27', '#241A1C', '#1A221D'];

  // ---------- data helpers ----------
  const live = () => S.snap.items.filter((i) => !i.deletedAt);
  const binned = () => S.snap.items.filter((i) => i.deletedAt);
  const boardById = (id) => S.snap.boards.find((b) => b.id === id);
  const currentBoardId = () => (boardById(S.board) ? S.board : null);
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = NB.sanitize(html); return d.textContent || ''; };
  const itemsFor = (id) => (id === 'bin' ? binned() : id === 'all' ? live() : live().filter((i) => i.boards.includes(id)));
  NB.visibleItems = () => {
    const q = S.q.trim().toLowerCase();
    const list = itemsFor(S.board);
    return q ? list.filter((i) => (i.title + ' ' + (i.kind === 'note' ? textOf(i.html) : i.caption || '')).toLowerCase().includes(q)) : list;
  };
  NB.boardName = (id) => (boardById(id) || {}).name;

  // Every change goes through here: show errors in plain English, otherwise redraw.
  NB.apply = function apply(res) {
    if (!res) return null;
    if (res.error) { toast(res.error, { error: true }); return null; }
    if (res.snap) {
      S.snap = res.snap;
      if (S.board !== 'all' && S.board !== 'bin' && !boardById(S.board)) S.board = 'all';
      render();
      queueThumbs();
    }
    return res;
  };
  NB.run = async (name, ...args) => {
    if (S.busy) return null;
    S.busy = true;
    document.body.style.cursor = 'progress';
    try { return NB.apply(await nb[name](...args)); } finally { S.busy = false; document.body.style.cursor = ''; }
  };

  // ---------- rendering ----------
  function render() {
    renderBoards();
    renderContext();
    renderGrid();
    $('bin-count').textContent = binned().length;
    $('bin-btn').classList.toggle('on', S.board === 'bin');
    $('bin-btn').setAttribute('aria-pressed', S.board === 'bin');
    $('lib-path').textContent = S.snap.root;
    NB.viewer.refresh();
  }

  function stackFor(id) {
    const items = itemsFor(id);
    const pics = items.filter((i) => i.thumbSrc).slice(0, 3);
    if (pics.length) return pics.map((i) => h('img', { src: i.thumbSrc, alt: '', loading: 'lazy', decoding: 'async' }));
    if (items.some((i) => i.kind === 'note')) return [h('div', { class: 'ph note' }, icon('note'))];
    return [h('div', { class: 'ph blank' })];
  }

  function renderBoards() {
    const nav = $('boards');
    let hl = nav.querySelector('.bhl');
    if (!hl) { hl = h('div', { class: 'bhl', 'aria-hidden': 'true' }); nav.append(hl); }
    for (const el of [...nav.children]) if (el !== hl) el.remove();
    const all = [{ id: 'all', name: 'All items' }, ...S.snap.boards];
    for (const b of all) {
      const n = itemsFor(b.id).length;
      const el = h('button', { type: 'button', class: 'bcard' + (S.board === b.id ? ' on' : ''), 'aria-pressed': String(S.board === b.id), 'data-id': b.id, onclick: () => go(b.id) },
        h('div', { class: 'stack', 'aria-hidden': 'true' }, stackFor(b.id)),
        h('div', null, h('div', { class: 'name' }, b.name), h('div', { class: 'count' }, `${n} item${n === 1 ? '' : 's'}`)));
      if (b.id !== 'all') dropTarget(el, b.id);
      nav.append(el);
    }
    nav.append(h('button', { type: 'button', class: 'bcard add', onclick: newBoard }, icon('plus'), 'New board'));
    requestAnimationFrame(placeHighlight);
  }

  function placeHighlight() {
    const nav = $('boards'), hl = nav.querySelector('.bhl');
    const on = nav.querySelector('.bcard.on');
    if (!hl) return;
    if (!on) { hl.style.opacity = '0'; return; }
    const moved = hl.dataset.at && hl.dataset.at !== on.dataset.id;
    hl.style.transform = `translateX(${on.offsetLeft}px)`;
    hl.style.width = on.offsetWidth + 'px';
    hl.style.opacity = '1';
    if (moved) { hl.classList.remove('go'); void hl.offsetWidth; hl.classList.add('go'); }
    hl.dataset.at = on.dataset.id;
  }

  function renderContext() {
    const box = $('context');
    box.replaceChildren();
    const n = NB.visibleItems().length;
    const q = S.q.trim();
    const board = boardById(S.board);
    if (S.renaming && board) {
      const input = h('input', { class: 'rename', value: board.name, 'aria-label': 'Board name', maxlength: '40' });
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true; S.renaming = false;
        if (save && input.value.trim() && input.value.trim() !== board.name) {
          if (!(await NB.run('renameBoard', board.id, input.value))) renderContext();
        } else renderContext();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
      input.addEventListener('blur', () => finish(true));
      box.append(input);
      requestAnimationFrame(() => { input.focus(); input.select(); });
      return;
    }
    box.append(h('div', { class: 'count' }, h('b', null, n), ` item${n === 1 ? '' : 's'}`, S.board === 'bin' ? ' in the Bin' : '', q ? ` matching “${q}”` : ''));
    if (board) {
      box.append(h('button', { type: 'button', class: 'btn small', onclick: () => { S.renaming = true; renderContext(); } }, 'Rename board'));
      box.append(h('button', { type: 'button', class: 'btn small danger', onclick: () => NB.run('deleteBoard', board.id) }, 'Delete board'));
    }
    if (S.board === 'bin' && binned().length) {
      box.append(h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
        const res = await NB.run('emptyBin');
        if (res && res.count) toast(`Deleted ${res.count} item${res.count === 1 ? '' : 's'} forever`);
      } }, icon('bin'), 'Empty Bin'));
    }
  }

  function card(it, index) {
    const tilt = index % 2 ? '1.3deg' : '-1.3deg';
    const btn = h('button', { type: 'button', class: 'card', 'data-id': it.id, 'aria-label': `Open ${it.title}`, style: { '--tilt': tilt, animationDelay: Math.min(index * 30, 420) + 'ms' }, onclick: () => NB.viewer.open(it.id) });
    if (!it.deletedAt) dragSource(btn, it);
    if (it.kind === 'note') {
      const tint = NOTE_TINTS[[...it.id].reduce((a, c) => a + c.charCodeAt(0), 0) % NOTE_TINTS.length];
      const body = h('div', { class: 'note-body' });
      body.innerHTML = NB.sanitize(it.html);
      const first = [...body.childNodes].find((n) => (n.textContent || '').trim());
      if (first && first.textContent.trim() === it.title) first.remove();
      btn.append(h('div', { class: 'media note-card', style: { background: tint } }, h('h3', { class: 'display' }, it.title), body));
      return btn;
    }
    const media = h('div', { class: 'media' });
    if (it.thumbSrc) {
      media.append(h('img', { src: it.thumbSrc, alt: '', loading: 'lazy', decoding: 'async', draggable: false, width: it.w || undefined, height: it.h || undefined }));
    } else {
      media.append(h('div', { class: 'ph', style: it.w && it.h ? { aspectRatio: `${it.w} / ${it.h}` } : null },
        icon(it.kind === 'video' ? 'video' : 'photo'), S.bad.has(it.id) ? "Can't show a preview of this file" : 'Making preview…'));
    }
    if (it.kind === 'video') media.append(h('span', { class: 'badge' }, icon('play'), NB.duration(it.duration) || 'Video'));
    btn.append(media, h('div', { class: 'cap' }, it.title), it.caption ? h('div', { class: 'cap-note' }, it.caption) : null);
    return btn;
  }

  function renderGrid() {
    const grid = $('grid'), empty = $('empty');
    const list = NB.visibleItems();
    grid.className = 'grid' + (S.anim ? ' anim ' + S.dir : '');
    grid.replaceChildren(...list.map(card));
    S.anim = false;
    empty.hidden = list.length > 0;
    if (list.length) return;
    const board = boardById(S.board);
    const [title, text] = S.q.trim() ? [`Nothing matches “${S.q.trim()}”`, 'Try a different word, or clear the search.']
      : S.board === 'bin' ? ['The Bin is empty', 'Things you delete wait here until you empty the Bin.']
      : board ? ['Nothing on this board yet', `Open any item and tick “${board.name}”, or add new things while you're here and they'll land on this board.`]
      : ['Your notebook is empty', 'Add photos, videos or a note from the dock below, or drag files onto this window.'];
    empty.replaceChildren(h('h2', { class: 'display' }, title), h('p', null, text));
  }

  function refreshCard(id) {
    const it = S.snap.items.find((i) => i.id === id);
    const old = document.querySelector(`.card[data-id="${id}"]`);
    if (it && old) { const fresh = card(it, 0); fresh.style.animation = 'none'; old.replaceWith(fresh); }
  }

  // ---------- dragging items onto boards ----------
  const DRAG_TYPE = 'application/x-notebook-item';
  let dragging = null;

  function dragSource(el, it) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      dragging = it.id;
      e.dataTransfer.setData(DRAG_TYPE, it.id);
      e.dataTransfer.effectAllowed = 'copy';
      el.classList.add('lifted');
      showTray();
    });
    el.addEventListener('dragend', () => { dragging = null; el.classList.remove('lifted'); hideTray(); });
  }

  function dropTarget(el, boardId) {
    const ours = (e) => [...e.dataTransfer.types].includes(DRAG_TYPE);
    el.addEventListener('dragover', (e) => { if (ours(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('dropping'); } });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', (e) => {
      if (!ours(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('dropping');
      addToBoard(e.dataTransfer.getData(DRAG_TYPE), boardId);
    });
  }

  // While dragging, a glass tray of boards appears so you can drop from anywhere on the page.
  function showTray() {
    const tray = $('tray');
    tray.replaceChildren(h('span', { class: 'tray-label' }, 'Drop on a board'));
    for (const b of S.snap.boards) {
      const target = h('div', { class: 'chip tog tray-target' }, b.name);
      dropTarget(target, b.id);
      tray.append(target);
    }
    tray.hidden = false;
  }
  const hideTray = () => { $('tray').hidden = true; };

  async function addToBoard(id, boardId) {
    const it = S.snap.items.find((i) => i.id === id);
    const name = NB.boardName(boardId);
    if (!it || !name) return;
    if (it.boards.includes(boardId)) { toast(`Already on ${name}`); return; }
    const before = it.boards;
    const res = NB.apply(await nb.updateItem(id, { boards: [...before, boardId] }));
    if (res) toast(`Added to ${name}`, { action: { label: 'Undo', run: async () => NB.apply(await nb.updateItem(id, { boards: before })) } });
  }

  // ---------- switching boards ----------
  function go(id) {
    if (id === S.board) return;
    const order = ['all', ...S.snap.boards.map((b) => b.id), 'bin'];
    S.dir = order.indexOf(id) >= order.indexOf(S.board) ? 'r' : 'l';
    S.board = id; S.anim = true; S.renaming = false;
    render();
    $('page').scrollTo({ top: 0, behavior: 'smooth' });
    const el = document.querySelector(`.bcard[data-id="${id}"]`);
    if (el) el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }

  async function newBoard() {
    const res = await NB.run('addBoard', 'New board');
    if (res) { go(res.id); S.renaming = true; renderContext(); }
  }

  // ---------- previews (thumbnails) ----------
  function queueThumbs() {
    for (const it of S.snap.items) {
      if (it.kind !== 'note' && !it.thumbSrc && !S.bad.has(it.id) && !S.queued.has(it.id)) { S.queued.add(it.id); thumbQueue.push(it.id); }
    }
    pumpThumbs();
  }
  const thumbQueue = [];
  let pumping = false;
  async function pumpThumbs() {
    if (pumping) return;
    pumping = true;
    while (thumbQueue.length) {
      const id = thumbQueue.shift();
      const it = S.snap.items.find((i) => i.id === id);
      if (!it) continue;
      try {
        const { bytes, meta } = await (it.kind === 'video' ? videoThumb(it.src) : photoThumb(it.src));
        const res = await nb.saveThumb(id, bytes, meta);
        if (res.error) throw new Error(res.error);
        S.snap = res.snap;
      } catch (err) {
        console.warn('preview failed', id, err);
        S.bad.add(id);
      }
      refreshCard(id);
      renderBoards();
      NB.viewer.refresh();
    }
    pumping = false;
  }

  const toJpeg = (source, w, h) => new Promise((resolve, reject) => {
    const scale = Math.min(1, 640 / w);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('no image'))), 'image/jpeg', 0.85);
  });

  async function photoThumb(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { bytes: await toJpeg(img, img.naturalWidth, img.naturalHeight), meta: { w: img.naturalWidth, h: img.naturalHeight } };
  }

  function videoThumb(src) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      const done = (fn, val) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); fn(val); };
      const timer = setTimeout(() => done(reject, new Error('timed out')), 20000);
      v.muted = true; v.preload = 'auto';
      v.onerror = () => done(reject, new Error('unplayable'));
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 0) * 0.25); };
      v.onseeked = async () => {
        try {
          if (!v.videoWidth) throw new Error('no picture');
          done(resolve, { bytes: await toJpeg(v, v.videoWidth, v.videoHeight), meta: { w: v.videoWidth, h: v.videoHeight, duration: v.duration } });
        } catch (err) { done(reject, err); }
      };
      v.src = src;
    });
  }

  // ---------- adding things ----------
  async function afterImport(res) {
    if (!res || res.cancelled) return;
    const n = res.added.length;
    const where = NB.boardName(currentBoardId());
    if (n) toast(`Added ${n} item${n === 1 ? '' : 's'}${where ? ` to ${where}` : ''}`);
    if (res.skipped.length) {
      const list = res.skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join(', ');
      toast(`${res.skipped.length} file${res.skipped.length === 1 ? ' was' : 's were'} skipped: ${list}${res.skipped.length > 3 ? '…' : ''}`, { error: true });
    }
  }

  async function newNote() {
    const res = await NB.run('addNote', currentBoardId());
    if (res) NB.viewer.open(res.id, { focus: true });
  }

  function wireDock() {
    $('add-photos').onclick = async () => afterImport(await NB.run('pickFiles', 'photos', currentBoardId()));
    $('add-videos').onclick = async () => afterImport(await NB.run('pickFiles', 'videos', currentBoardId()));
    $('new-note').onclick = newNote;
    $('backup').onclick = async () => {
      const res = await NB.run('backup');
      if (res && !res.cancelled) toast(`Backed up ${res.items} items (${NB.bytes(res.bytes)}) to ${res.dir}`);
    };
    $('restore').onclick = restore;
    $('export').onclick = async () => {
      const res = await NB.run('exportAll');
      if (res && !res.cancelled) toast(`Exported ${res.items} items to ${res.dir}`);
    };
    $('bin-btn').onclick = () => go(S.board === 'bin' ? 'all' : 'bin');
    $('search').addEventListener('input', (e) => { S.q = e.target.value; renderContext(); renderGrid(); });
    $('lib-btn').onclick = () => {
      const pop = $('lib-pop');
      pop.hidden = !pop.hidden;
      $('lib-btn').setAttribute('aria-expanded', String(!pop.hidden));
    };
    $('lib-reveal').onclick = () => NB.run('revealLibrary');
    $('lib-open').onclick = async () => {
      const res = await NB.run('useLibrary', 'open');
      if (res && !res.cancelled) { $('lib-pop').hidden = true; S.board = 'all'; S.anim = true; render(); toast('Opened ' + res.snap.root); }
    };
  }

  async function restore() {
    const res = await NB.run('restoreBackup');
    if (!res || res.cancelled) return;
    $('welcome').hidden = true;
    S.board = 'all'; S.anim = true; render();
    toast(`Restored ${res.items} items. Notebook is now using the restored copy at ${res.dir}`, { action: { label: 'Show', run: () => NB.run('revealLibrary') } });
  }

  // ---------- drag and drop ----------
  function wireDrop() {
    const drop = $('drop');
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || !S.snap) return;
      depth++;
      drop.textContent = `Drop to add to ${NB.boardName(currentBoardId()) || 'All items'}`;
      drop.hidden = false;
    });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0; drop.hidden = true;
      if (!S.snap) return;
      const paths = [...e.dataTransfer.files].map((f) => nb.pathForFile(f)).filter(Boolean);
      if (paths.length) afterImport(await NB.run('importPaths', paths, currentBoardId()));
    });
  }

  // ---------- keyboard ----------
  function wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (NB.viewer.isOpen() || !S.snap) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
      else if (e.key === 'Escape') {
        if (!$('lib-pop').hidden) { $('lib-pop').hidden = true; $('lib-btn').setAttribute('aria-expanded', 'false'); }
        else if (S.q) { S.q = ''; $('search').value = ''; renderContext(); renderGrid(); }
      }
    });
    document.addEventListener('mousedown', (e) => {
      const pop = $('lib-pop');
      if (!pop.hidden && !pop.contains(e.target) && !$('lib-btn').contains(e.target)) { pop.hidden = true; $('lib-btn').setAttribute('aria-expanded', 'false'); }
    });
    window.addEventListener('resize', () => requestAnimationFrame(placeHighlight));
  }

  // ---------- start ----------
  async function showWelcome(state) {
    const w = $('welcome');
    w.hidden = false;
    $('w-default').textContent = `Use ${state.defaultPath}`;
    const missing = $('welcome-missing');
    missing.hidden = !state.missing;
    if (state.missing) missing.textContent = `Notebook couldn't find your library at ${state.missing}. If it's on a drive that isn't plugged in, connect it and restart Notebook, or pick an option below.`;
    const use = (mode) => async () => {
      const res = await NB.run('useLibrary', mode);
      if (res && !res.cancelled) { w.hidden = true; if (res.recovered) warnRecovered(); }
    };
    $('w-default').onclick = use('default');
    $('w-choose').onclick = use('choose');
    $('w-open').onclick = use('open');
    $('w-restore').onclick = restore;
  }

  const warnRecovered = () => toast('Your library file was damaged, so Notebook went back to the last good save.', { error: true });

  async function start() {
    wireDock(); wireDrop(); wireKeys();
    if (document.fonts) document.fonts.ready.then(() => placeHighlight());
    const res = NB.apply(await nb.state());
    if (!res) return;
    if (res.status === 'ready') { if (res.recovered) warnRecovered(); } else showWelcome(res);
  }

  start();
})();
