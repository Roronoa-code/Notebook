// The main screen: the sidebar (add, search, boards, Bin, Phone, Library), the mood board grid, drag-and-drop and previews.
(() => {
  const { h, icon, toast } = NB;
  const $ = (id) => document.getElementById(id);
  const S = NB.S = { snap: null, board: 'all', q: '', dir: 'r', anim: true, renaming: false, bad: new Set(), queued: new Set(), busy: false };
  const NOTE_TINTS = ['#171717', '#141414', '#1A1A1A', '#121212'];

  // ---------- data helpers ----------
  const live = () => S.snap.items.filter((i) => !i.deletedAt);
  const binned = () => S.snap.items.filter((i) => i.deletedAt);
  const boardById = (id) => S.snap.boards.find((b) => b.id === id);
  const currentBoardId = () => (boardById(S.board) ? S.board : null);
  NB.currentBoardId = currentBoardId;
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = NB.sanitize(html); return d.textContent || ''; };
  const itemsFor = (id) => (id === 'bin' ? binned() : id === 'all' ? live() : live().filter((i) => i.boards.includes(id)));
  NB.visibleItems = () => {
    const q = S.q.trim().toLowerCase();
    const g = NB.smart.suggestion();
    const list = g ? live().filter((i) => g.ids.includes(i.id)) : NB.smart.filter(itemsFor(S.board));
    return q ? searchIn(list, q) : list;
  };
  // Title, notes, and what it is (type, style, clothing colours).
  const words = (i) => { const L = NB.smart.labelsOf(i); return [i.title, i.kind === 'note' ? textOf(i.html) : i.caption || '', ...L.types, ...L.styles, ...L.colours.map((c) => c.name)].join(' ').toLowerCase(); };
  const searchIn = (list, q) => list.filter((i) => words(i).includes(q));
  NB.refreshGrid = () => { renderContext(); renderGrid(); };
  // Showing a suggested group (or back to the boards). `boardId`: jump to a board made from it.
  NB.showSuggestion = (g, boardId) => {
    S.anim = true;
    if (boardId) { go(boardId); return; }
    render();
  };
  NB.boardName = (id) => (boardById(id) || {}).name;
  NB.refreshCard = (id) => refreshCard(id);
  NB.renderBoards = () => renderBoards();

  // Every change goes through here: show errors in plain English, otherwise redraw.
  NB.apply = function apply(res) {
    if (!res) return null;
    if (res.error) { toast(res.error, { error: true }); return null; }
    if (res.snap) {
      S.snap = res.snap;
      if (S.board !== 'all' && S.board !== 'bin' && !boardById(S.board)) S.board = 'all';
      render();
      NB.previews.queue();
      clearTimeout(apply.sug); apply.sug = setTimeout(() => NB.smart.loadSuggestions(), 600); // groups follow the library
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
    NB.stacks.mark();
  }

  function stackFor(id) {
    const items = itemsFor(id);
    const pics = items.filter((i) => i.thumbSrc).slice(0, 3);
    if (pics.length) return pics.map((i) => h('img', { src: i.thumbSrc, alt: '', loading: 'lazy', decoding: 'async', style: { objectViewBox: NB.viewBox(i) } }));
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
        h('div', null, h('div', { class: 'name' }, b.name), h('div', { class: 'count micro' }, `${n} item${n === 1 ? '' : 's'}`)));
      if (b.id !== 'all') { dropTarget(el, b.id); boardDrag(el, b.id); }
      nav.append(el);
    }
    nav.append(h('button', { type: 'button', class: 'bcard add', onclick: newBoard }, icon('plus'), 'New board'));
    requestAnimationFrame(placeHighlight);
  }

  // Drag a board up or down the list to move it. The others make room as you go.
  const BOARD_TYPE = 'application/x-notebook-board';
  let movingBoard = null;
  function boardDrag(el, id) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { if (e.target !== el) return; movingBoard = id; e.dataTransfer.setData(BOARD_TYPE, id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('moving'); });
    el.addEventListener('dragend', () => { movingBoard = null; el.classList.remove('moving'); document.querySelectorAll('.bcard.before, .bcard.after').forEach((x) => x.classList.remove('before', 'after')); });
    el.addEventListener('dragover', (e) => {
      if (!movingBoard || movingBoard === id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      el.classList.toggle('after', after); el.classList.toggle('before', !after);
    });
    el.addEventListener('dragleave', () => el.classList.remove('before', 'after'));
    el.addEventListener('drop', async (e) => {
      if (!movingBoard || movingBoard === id) return;
      e.preventDefault(); e.stopPropagation();
      const after = el.classList.contains('after');
      el.classList.remove('before', 'after');
      const order = S.snap.boards.map((b) => b.id).filter((x) => x !== movingBoard);
      order.splice(order.indexOf(id) + (after ? 1 : 0), 0, movingBoard);
      const nav = $('boards'), was = new Map([...nav.querySelectorAll('.bcard[data-id]')].map((c) => [c.dataset.id, c.getBoundingClientRect().top]));
      if (!NB.apply(await nb.reorderBoards(order))) return;
      for (const c of nav.querySelectorAll('.bcard[data-id]')) {
        const dy = (was.get(c.dataset.id) ?? c.getBoundingClientRect().top) - c.getBoundingClientRect().top;
        if (dy) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1)' });
      }
    });
  }

  function placeHighlight() {
    const nav = $('boards'), hl = nav.querySelector('.bhl');
    const on = nav.querySelector('.bcard.on');
    if (!hl) return;
    if (!on) { hl.style.opacity = '0'; return; }
    const moved = hl.dataset.at && hl.dataset.at !== on.dataset.id;
    hl.style.transform = `translateY(${on.offsetTop}px)`;
    hl.style.height = on.offsetHeight + 'px';
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
    const g = NB.smart.suggestion();
    if (g) {
      box.append(h('h2', { class: 'ctx-title' + (renderContext.last === g.sig ? ' still' : '') }, g.name), h('div', { class: 'count micro' }, h('b', null, n), ` item${n === 1 ? '' : 's'}`), NB.smart.suggestionBar(g));
      renderContext.last = g.sig;
      return;
    }
    const titleKey = S.board + (S.snap.root || '');
    box.append(h('h2', { class: 'ctx-title' + (titleKey === renderContext.last ? ' still' : '') }, board ? board.name : S.board === 'bin' ? 'Bin' : 'All items'));
    renderContext.last = titleKey;
    box.append(h('div', { class: 'count micro' }, h('b', null, n), ` item${n === 1 ? '' : 's'}`, S.board === 'bin' ? ' in the Bin' : '', q ? ` matching “${q}”` : ''));
    if (board) {
      const rename = h('button', { type: 'button', class: 'btn small', onclick: () => { S.renaming = true; renderContext(); } }, 'Rename board');
      // Deleting asks once more (a second click within a few seconds). Its items always stay in your notebook.
      box.append(h('div', { class: 'ctx-actions' }, rename, h('button', { type: 'button', class: 'btn small danger', onclick: async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.sure) {
          b.dataset.sure = '1'; b.textContent = 'Click again to delete';
          setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Delete board'; } }, 3500);
          return;
        }
        const name = board.name;
        if (await NB.run('deleteBoard', board.id)) toast(`Deleted the board “${name}”. Its items are still in your notebook.`);
      } }, 'Delete board')));
    }
    if (S.board !== 'bin') { const bar = NB.smart.filterBar(itemsFor(S.board)); if (bar) box.append(bar); }
    if (S.board === 'bin' && binned().length) {
      box.append(h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
        const res = await NB.run('emptyBin');
        if (res && res.count) toast(`Deleted ${res.count} item${res.count === 1 ? '' : 's'} forever`);
      } }, icon('bin'), 'Empty Bin'));
    }
  }

  // The picture part of a card (also used for the pictures inside a stack).
  function media(it) {
    if (it.kind === 'note') {
      const tint = NOTE_TINTS[[...it.id].reduce((a, c) => a + c.charCodeAt(0), 0) % NOTE_TINTS.length];
      const body = h('div', { class: 'note-body' });
      body.innerHTML = NB.sanitize(it.html);
      const first = [...body.childNodes].find((n) => (n.textContent || '').trim());
      if (first && first.textContent.trim() === it.title) first.remove();
      return h('div', { class: 'media note-card', style: { background: tint } }, h('h3', { class: 'display' }, it.title), body);
    }
    const box = h('div', { class: 'media' });
    const shape = NB.shape(it);
    if (it.thumbSrc) {
      // A GIF moves on the board: the card shows the file itself (its preview is only a still).
      box.append(h('img', { src: /\.gif$/i.test(it.file || '') ? it.src : it.thumbSrc, alt: '', loading: 'lazy', decoding: 'async', draggable: false, width: shape ? Math.round(shape.w) : undefined, height: shape ? Math.round(shape.h) : undefined, style: { objectViewBox: NB.viewBox(it) } }));
    } else {
      box.append(h('div', { class: 'ph', style: shape ? { aspectRatio: `${shape.w} / ${shape.h}` } : null },
        icon(it.kind === 'video' ? 'video' : 'photo'), it.waiting ? 'Waiting for your phone to send this' : S.bad.has(it.id) ? "Can't show a preview of this file" : 'Making preview…'));
    }
    if (it.kind === 'video') box.append(h('span', { class: 'badge' }, icon('play'), NB.duration(it.duration) || 'Video'));
    if (it.phone === false) box.append(h('span', { class: 'offphone', title: 'Not on your phone' }, icon('phone-off')));
    return box;
  }

  function card(it, index) {
    const tilt = index % 2 ? '1.3deg' : '-1.3deg';
    const btn = h('button', { type: 'button', class: 'card', 'data-id': it.id, 'aria-label': `Open ${it.title}`, style: { '--tilt': tilt, animationDelay: Math.min(index * 30, 420) + 'ms' },
      onclick: (e) => (it.deletedAt ? NB.viewer.open(it.id) : NB.stacks.click(e, [it.id], () => NB.viewer.open(it.id))) });
    if (!it.deletedAt) dragSource(btn, [it.id]);
    if (it.kind === 'video' && it.src) hoverPlay(btn, it);
    btn.append(media(it), h('span', { class: 'sr' }, it.title));
    if (!it.deletedAt) btn.append(NB.stacks.pickBox([it.id]));
    return btn;
  }

  // A video card plays (quietly, on a loop) while the pointer rests on it, so the board keeps moving.
  function hoverPlay(btn, it) {
    let wait = 0, v = null;
    btn.addEventListener('mouseenter', () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      wait = setTimeout(() => {
        const box = btn.querySelector('.media');
        if (!box || v) return;
        v = h('video', { class: 'hoverplay', src: it.src, loop: true, playsInline: true, preload: 'auto', style: { objectViewBox: NB.viewBox(it) } });
        v.muted = true;
        v.addEventListener('playing', () => v && v.classList.add('on'), { once: true });
        box.append(v);
        v.play().catch(() => {});
      }, 160);
    });
    btn.addEventListener('mouseleave', () => {
      clearTimeout(wait);
      if (!v) return;
      const x = v; v = null;
      x.classList.remove('on');
      setTimeout(() => { x.pause(); x.removeAttribute('src'); x.load(); x.remove(); }, 260);
    });
  }

  // Card size: Ctrl + mouse wheel over the board, or Ctrl + plus / minus (Ctrl + 0 goes back). Each step
  // is one column more or less, so it always visibly changes. Remembered as a card width.
  const GAP = 22, DEFAULT = 250;
  let size = (() => { try { const v = +localStorage.getItem('nb.cardSize'); return v >= 120 && v <= 900 ? v : DEFAULT; } catch { return DEFAULT; } })();
  document.documentElement.style.setProperty('--card', size + 'px');
  function resize(step) {
    const W = $('grid').clientWidth || 1000;
    const cols = (w) => Math.max(1, Math.floor((W + GAP) / (w + GAP)));
    const want = step === 0 ? cols(DEFAULT) : Math.max(1, Math.min(10, cols(size) - step));
    const next = step === 0 ? DEFAULT : Math.floor((W + GAP) / want) - GAP;
    if (next === size || next < 120) return;
    size = next;
    try { localStorage.setItem('nb.cardSize', String(size)); } catch { /* remembering is a nicety */ }
    glideAround(() => document.documentElement.style.setProperty('--card', size + 'px'));
  }
  let wheelWait = 0;
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !e.target.closest('#page')) return;
    e.preventDefault();
    if (performance.now() < wheelWait) return;
    wheelWait = performance.now() + 180;
    resize(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || NB.viewer.isOpen() || (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]'))) return;
    const k = { '=': 1, '+': 1, '-': -1, '_': -1, 0: 0 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    resize(k);
  });

  // Runs `change` (anything that moves cards without redrawing them) and glides every card from
  // where it was to where it ends up.
  function glideAround(change) {
    const grid = $('grid');
    const cards = [...grid.querySelectorAll(':scope > .card')];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const was = reduce ? null : cards.map((c) => c.getBoundingClientRect());
    change();
    if (!was) return;
    cards.forEach((c, i) => {
      const a = was[i], b = c.getBoundingClientRect();
      if (!b.width || (a.bottom < 0 && b.bottom < 0) || (a.top > innerHeight && b.top > innerHeight)) return;
      const sx = a.width / b.width, dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
      c.animate([{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx})` }, { transformOrigin: 'top left', transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.9,.3,1)' });
    });
  }

  // Cards that haven't changed are kept (no reload, no flash). When the list changes in place (a filter,
  // a stack, a sync) every card glides from where it was to where it goes; new ones grow in, gone ones fade.
  const kept = new Map(); // key -> { sig, el }
  const sigOf = (it) => [it.id, it.updatedAt, it.thumbSrc, it.phone, it.waiting, S.bad.has(it.id), NB.viewBox(it)].join('|');
  const idsIn = (el) => (el.classList.contains('stackcard') ? [...el.querySelectorAll('.fanitem')].map((b) => b.dataset.id) : [el.dataset.id]);
  function renderGrid() {
    const grid = $('grid'), empty = $('empty');
    const list = NB.visibleItems();
    const glide = !S.anim && grid.querySelector(':scope > .card') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = new Map(), beforeId = new Map();
    if (glide) for (const el of grid.querySelectorAll(':scope > .card')) { const r = el.getBoundingClientRect(); before.set(el, r); for (const id of idsIn(el)) beforeId.set(id, r); }
    const els = NB.stacks.group(list, NB.smart.suggestion() ? null : currentBoardId()).map((x, i) => {
      const key = Array.isArray(x) ? 's:' + x.map((m) => m.id).sort().join(',') : 'c:' + x.id;
      const sig = Array.isArray(x) ? x.map(sigOf).join(';') : sigOf(x);
      const hit = kept.get(key);
      if (hit && hit.sig === sig && !S.anim) return hit.el;
      const el = Array.isArray(x) ? NB.stacks.stackCard(x, i, media) : card(x, i);
      if (glide) el.style.animation = 'none';
      kept.set(key, { sig, el });
      return el;
    });
    // Cards filtered out are kept for when they come back; only cards whose items are gone are dropped.
    const alive = new Set(S.snap.items.map((i) => i.id));
    for (const [k] of kept) if (!k.slice(2).split(',').every((id) => alive.has(id))) kept.delete(k);
    grid.className = 'grid' + (S.anim ? ' anim ' + S.dir : '');
    grid.replaceChildren(...els);
    S.anim = false;
    if (glide) {
      const ease = 'cubic-bezier(.2,.9,.3,1)';
      const onScreen = (r) => r && r.bottom > -100 && r.top < innerHeight + 100;
      for (const el of els) {
        const was = before.get(el) || idsIn(el).map((id) => beforeId.get(id)).find(Boolean), now = el.getBoundingClientRect();
        if (!onScreen(now) && !onScreen(was)) continue; // off screen either way: nothing to watch
        if (!was) { el.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: ease, delay: 80 }); continue; }
        const dx = was.left - now.left, dy = was.top - now.top;
        if (Math.abs(dx) + Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 460, easing: ease });
      }
      // Cards that left fade where they were (or shrink into the stack they joined).
      for (const [el, r] of before) {
        if (els.includes(el) || r.bottom < 0 || r.top > innerHeight) continue;
        const into = els.find((x) => idsIn(el).some((id) => idsIn(x).includes(id)));
        if (into && (el.classList.contains('stackcard') || !into.classList.contains('stackcard'))) continue; // just redrawn: it glides as the new card
        // A copy fades (the card itself is kept, ready for when a filter brings it back),
        // under the cards that stay, which glide over it.
        const ghost = el.cloneNode(true);
        ghost.className = 'card-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        const g = grid.getBoundingClientRect();
        Object.assign(ghost.style, { position: 'absolute', left: r.left - g.left + 'px', top: r.top - g.top + 'px', width: r.width + 'px', margin: 0, pointerEvents: 'none', animation: 'none' });
        grid.prepend(ghost);
        const to = into ? into.getBoundingClientRect() : null;
        const end = to ? `translate(${to.left + to.width / 2 - (r.left + r.width / 2)}px, ${to.top + 40 - r.top}px) scale(.5)` : 'scale(.92)';
        ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: end }], { duration: to ? 340 : 260, easing: 'ease-in', fill: 'forwards' }).onfinish = () => ghost.remove();
      }
    }
    empty.hidden = list.length > 0;
    if (list.length) return;
    const board = boardById(S.board);
    const [title, text] = S.q.trim() ? [`Nothing matches “${S.q.trim()}”`, 'Try a different word, or clear the search.']
      : S.board === 'bin' ? ['The Bin is empty', 'Things you delete wait here until you empty the Bin.']
      : NB.smart.active() ? ['Nothing matches these filters', 'Try another type, colour or style, or clear the filters.']
      : board ? ['Nothing on this board yet', `Open any item and tick “${board.name}”, or add new things while you're here and they'll land on this board.`]
      : ['Your notebook is empty', 'Add photos, videos or a note from the top left, or drag files onto this window.'];
    // Searching inside a board: say if there are matches elsewhere, and take you there.
    const elsewhere = S.q.trim() && board ? searchIn(live(), S.q.trim().toLowerCase()).length : 0;
    empty.replaceChildren(h('h2', { class: 'display' }, title), h('p', null, text),
      elsewhere ? h('button', { type: 'button', class: 'btn', onclick: () => go('all') }, `Show ${elsewhere} in All items`) : '');
  }

  function refreshCard(id) {
    const it = S.snap.items.find((i) => i.id === id);
    const old = document.querySelector(`.card[data-id="${id}"]`);
    if (it && old) { const fresh = card(it, 0); fresh.style.animation = 'none'; old.replaceWith(fresh); NB.stacks.mark(); }
    const inStack = document.querySelector(`.fanitem[data-id="${id}"]`);
    if (it && inStack) { inStack.querySelector('.media').replaceWith(media(it)); }
  }

  // ---------- dragging items onto boards ----------
  const DRAG_TYPE = 'application/x-notebook-item';
  let dragging = null; // the ids being dragged (one card, or every picture in a stack)
  const ours = (e) => [...e.dataTransfer.types].includes(DRAG_TYPE);

  // A card (or stack) can be dragged onto a board, or onto another card to stack them together.
  function dragSource(el, ids) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      const chosen = NB.stacks.picked();
      dragging = ids.some((id) => chosen.includes(id)) ? chosen : ids; // a picked card brings the others along
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragging));
      e.dataTransfer.effectAllowed = 'copyMove';
      el.classList.add('lifted');
      showTray();
    });
    el.addEventListener('dragend', () => { dragging = null; el.classList.remove('lifted'); hideTray(); });
    const onSelf = () => !dragging || dragging.some((id) => ids.includes(id));
    el.addEventListener('dragover', (e) => { if (!ours(e) || onSelf()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('droptarget'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('droptarget'); });
    el.addEventListener('drop', async (e) => {
      el.classList.remove('droptarget');
      if (!ours(e) || onSelf()) return;
      e.preventDefault();
      const moving = dragging;
      const res = NB.apply(await nb.stackItems([...new Set([...ids, ...moving])], currentBoardId()));
      if (res) { NB.stacks.clear(); toast('Stacked. Drag across it to go through them.'); }
    });
  }
  NB.dragSource = dragSource;
  NB.addToBoard = (ids, boardId) => addToBoard(ids, boardId);

  function dropTarget(el, boardId) {
    el.addEventListener('dragover', (e) => { if (ours(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('dropping'); } });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', (e) => {
      if (!ours(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('dropping');
      addToBoard(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)), boardId);
    });
  }

  // While dragging, a glass tray of boards appears so you can drop from anywhere on the page.
  function showTray() {
    const tray = $('tray');
    tray.replaceChildren(h('span', { class: 'tray-label micro' }, 'Drop on a board'));
    for (const b of S.snap.boards) {
      const target = h('div', { class: 'chip tog tray-target' }, b.name);
      dropTarget(target, b.id);
      tray.append(target);
    }
    tray.hidden = false;
  }
  const hideTray = () => { $('tray').hidden = true; };

  async function addToBoard(ids, boardId) {
    const name = NB.boardName(boardId);
    const todo = S.snap.items.filter((i) => ids.includes(i.id) && !i.boards.includes(boardId));
    if (!name) return;
    if (!todo.length) { toast(`Already on ${name}`); return; }
    const before = new Map(todo.map((i) => [i.id, i.boards]));
    for (const it of todo) if (!NB.apply(await nb.updateItem(it.id, { boards: [...it.boards, boardId] }))) return;
    toast(`Added to ${name}`, { action: { label: 'Undo', run: async () => { for (const [id, b] of before) NB.apply(await nb.updateItem(id, { boards: b })); } } });
  }

  // ---------- switching boards ----------
  function go(id) {
    if (id === S.board) return;
    const order = ['all', ...S.snap.boards.map((b) => b.id), 'bin'];
    S.dir = order.indexOf(id) >= order.indexOf(S.board) ? 'r' : 'l';
    S.board = id; S.anim = true; S.renaming = false;
    NB.stacks.clear();
    NB.smart.hideSuggestion();
    if (NB.links && NB.links.isOpen()) NB.links.closePanel(); // choosing a board leaves Pinterest
    render();
    $('page').scrollTo({ top: 0, behavior: 'smooth' });
    const el = document.querySelector(`.bcard[data-id="${id}"]`);
    if (el) el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }

  async function newBoard() {
    const res = await NB.run('addBoard', 'New board');
    if (res) { go(res.id); S.renaming = true; renderContext(); }
  }

  // ---------- adding things ----------
  async function afterImport(res) {
    if (!res || res.cancelled) return;
    const n = res.added.length;
    const where = NB.boardName(currentBoardId());
    if (n) toast(`Added ${n} item${n === 1 ? '' : 's'}${where ? ` to ${where}` : ''}`);
    // The same picture twice isn't an error: say where the one you already have is.
    const twins = res.skipped.filter((s) => s.duplicate), bad = res.skipped.filter((s) => !s.duplicate);
    if (twins.length === 1) toast(`${twins[0].name}: ${twins[0].reason}`, { action: { label: 'Show it', run: () => NB.viewer.open(twins[0].duplicate) } });
    else if (twins.length) toast(`${twins.length} were already in your notebook, so they weren’t added twice`);
    if (bad.length) {
      const list = bad.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join(', ');
      toast(`${bad.length} file${bad.length === 1 ? ' was' : 's were'} skipped: ${list}${bad.length > 3 ? '…' : ''}`, { error: true });
    }
  }
  NB.afterImport = afterImport;

  // Pictures that aren't files on disk (pasted, or dragged out of a browser) are sent over as bytes.
  const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/heic': '.heic', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
  NB.importBlobs = async (files) => {
    const stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/[:,]/g, (c) => (c === ':' ? '.' : ''));
    const all = { added: [], skipped: [] };
    for (const f of files) {
      const ext = EXT[f.type] || '';
      const named = /\.[a-z0-9]{2,5}$/i.test(f.name) && !/^image\.(png|jpe?g)$/i.test(f.name); // "image.png" is just what browsers call a copied picture
      const res = await nb.importData(named ? f.name : `Pasted ${stamp}${files.length > 1 ? ` (${files.indexOf(f) + 1})` : ''}${ext}`, new Uint8Array(await f.arrayBuffer()), currentBoardId());
      if (res.error) { toast(res.error, { error: true }); continue; }
      all.added.push(...res.added); all.skipped.push(...res.skipped);
      NB.apply(res);
    }
    afterImport(all);
  };

  async function newNote() {
    const res = await NB.run('addNote', currentBoardId());
    if (res) NB.viewer.open(res.id, { focus: true });
  }

  // "Back up every week" in the Library menu.
  function wireAutoBackup() {
    const box = $('auto-backup'), info = $('auto-backup-info');
    const ago = (iso) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
    const draw = (s) => {
      box.checked = !!s.on;
      info.replaceChildren(!s.on ? 'Keeps the last 3 copies in a folder you choose, ideally on another drive.'
        : s.running ? `Backing up now to ${s.dir}…` : `To ${s.dir}${s.last ? ` · last one ${ago(s.last)}` : ''} · `,
      ...(s.on && !s.running ? [h('button', { type: 'button', class: 'linkbtn', onclick: async () => draw(await nb.autoBackupFolder()) }, 'Change folder')] : []));
    };
    nb.autoBackup().then(draw);
    box.addEventListener('change', async () => {
      const s = await nb.setAutoBackup(box.checked);
      if (s.error) { toast(s.error, { error: true }); box.checked = false; return; }
      draw(s);
    });
    nb.onAutoBackup((s) => {
      draw(s);
      if (s.status === 'done') toast(`Backed up automatically: ${s.items} items (${NB.bytes(s.bytes)})`);
      if (s.status === 'failed') toast(`The weekly backup didn’t work: ${s.error}`, { error: true });
    });
  }

  function wireDock() {
    $('add-photos').onclick = async () => afterImport(await NB.run('pickFiles', 'photos', currentBoardId()));
    $('add-videos').onclick = async () => afterImport(await NB.run('pickFiles', 'videos', currentBoardId()));
    $('new-note').onclick = newNote;
    $('backup').onclick = async () => {
      const res = await NB.run('backup');
      if (res && !res.cancelled) toast(`Backed up ${res.items} items (${NB.bytes(res.bytes)}) to ${res.dir}`);
      closeLib();
    };
    $('restore').onclick = restore;
    wireAutoBackup();
    $('phone').onclick = () => NB.phone.open();
    $('export').onclick = async () => {
      const res = await NB.run('exportAll');
      if (res && !res.cancelled) toast(`Exported ${res.items} items to ${res.dir}`);
      closeLib();
    };
    $('bin-btn').onclick = () => go(S.board === 'bin' ? 'all' : 'bin');
    $('lib-keys').onclick = () => { $('lib-pop').hidden = true; $('lib-btn').setAttribute('aria-expanded', 'false'); NB.shortcuts(); };
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

  const closeLib = () => { $('lib-pop').hidden = true; $('lib-btn').setAttribute('aria-expanded', 'false'); };

  async function restore() {
    closeLib();
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
    // Files from Explorer, pictures dragged out of a browser, or a TikTok/Pinterest link dragged in.
    const types = (e) => [...(e.dataTransfer?.types || [])];
    const hasFiles = (e) => types(e).includes('Files') || (types(e).includes('text/uri-list') && !types(e).includes(DRAG_TYPE));
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
      const files = [...e.dataTransfer.files];
      const paths = files.map((f) => nb.pathForFile(f)).filter(Boolean);
      const loose = files.filter((f) => !nb.pathForFile(f) && /^(image|video)\//.test(f.type));
      const link = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('#'));
      if (paths.length) afterImport(await NB.run('importPaths', paths, currentBoardId()));
      else if (loose.length) NB.importBlobs(loose);
      else if (link && NB.links.isLink(link)) NB.links.save(link);
      else if (link) toast('Drop photos or videos here, or a TikTok or Pinterest link. To keep a picture from a website, drag the picture itself.', { error: true });
    });
  }

  // ---------- keyboard ----------
  function wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (NB.viewer.isOpen() || NB.phone.isOpen() || !S.snap) return;
      const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); }
      else if (!typing && e.ctrlKey && e.key.toLowerCase() === 'a' && S.board !== 'bin') { e.preventDefault(); NB.stacks.pickAll(); }
      else if (!typing && e.key === 'Delete' && NB.stacks.isPicking()) { e.preventDefault(); NB.stacks.binPicked(); }
      else if (!typing && e.key === '?') { e.preventDefault(); NB.shortcuts(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
      else if (e.key === 'Escape') {
        if (NB.stacks.isPicking()) NB.stacks.clear();
        else if (!$('lib-pop').hidden) { $('lib-pop').hidden = true; $('lib-btn').setAttribute('aria-expanded', 'false'); }
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

  // A phone sync changed the library: redraw with the new list. An open item stays open
  // (it only closes if the phone removed it), and new photos and videos get previews.
  function wireSync() {
    nb.onLibraryChanged(({ snap, arrived }) => {
      if (!snap || !S.snap) return;
      for (const id of arrived || []) { S.bad.delete(id); S.queued.delete(id); }
      NB.apply({ snap });
    });
  }

  async function start() {
    wireDock(); wireDrop(); wireKeys(); wireSync();
    if (document.fonts) document.fonts.ready.then(() => placeHighlight());
    const res = NB.apply(await nb.state());
    if (!res) return;
    if (res.status === 'ready') { if (res.recovered) warnRecovered(); } else showWelcome(res);
  }

  start();
})();
