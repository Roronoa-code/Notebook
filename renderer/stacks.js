// Stacks (pictures fanned in the space of one card, flicked through by dragging across them, a sideways
// scroll or the arrow keys) and picking several things at once (Ctrl-click or the tick) to stack, hide from the phone or bin.
(() => {
  const { h, icon, toast } = NB;
  const top = {}; // the id of the picture on top of each stack, for as long as the app is open

  // ---------- stacks ----------
  const FAN = [
    { t: 'none', o: 1 },
    { t: 'translate(4%, 1%) rotate(4deg) scale(.94)', o: 1 },
    { t: 'translate(-4%, 2%) rotate(-5deg) scale(.9)', o: 1 },
    { t: 'translate(0, 5%) scale(.84)', o: 0 }
  ];
  const ratioOf = (m) => { const s = m && NB.shape(m); return s ? `${s.w} / ${s.h}` : '4 / 5'; };
  // The stack takes the shape of the picture on top (so it's never cropped), gliding between shapes.
  function place(el, glide) {
    const items = [...el.querySelectorAll('.fanitem')], len = items.length;
    const t = Math.max(0, items.findIndex((b) => b.dataset.id === top[el.dataset.stack]));
    const fan = el.querySelector('.fan'), ratio = ratioOf(el._members[t]);
    if (fan.style.aspectRatio !== ratio) {
      const h0 = glide ? fan.offsetHeight : 0;
      fan.style.aspectRatio = ratio;
      const h1 = glide ? fan.offsetHeight : 0;
      if (h0 && h1 && Math.abs(h0 - h1) > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) fan.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.04)' });
    }
    items.forEach((b, i) => {
      const k = (i - t + len) % len, f = FAN[Math.min(k, 3)];
      b.style.setProperty('--t', f.t);
      b.style.opacity = f.o;
      b.style.zIndex = 10 - k;
      b.tabIndex = k ? -1 : 0;
      b.style.pointerEvents = k ? 'none' : '';
    });
    el.querySelector('.stackct span').textContent = `${t + 1}/${len}`;
  }
  function turn(el, dir) {
    const items = [...el.querySelectorAll('.fanitem')], len = items.length, id = el.dataset.stack;
    const now = Math.max(0, items.findIndex((b) => b.dataset.id === top[id]));
    top[id] = items[(((now + dir) % len) + len) % len].dataset.id;
    place(el, true);
  }

  // Drag across a stack with the mouse to flick through it; the top picture follows the mouse.
  // A drag that starts mostly up or down still picks the stack up (onto a board or another card).
  // A sideways one rides the browser's drag with an invisible drag picture.
  const SWIPE = 'application/x-notebook-swipe';
  const blank = new Image(); blank.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  function swipe(el) {
    let down = null, last = null; // the drag's own position is where it started, so the direction comes from the mouse
    el.addEventListener('pointerdown', (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; last = down; });
    el.addEventListener('pointermove', (e) => { if (down) last = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('dragstart', (e) => {
      if (!down || Math.abs(last.x - down.x) <= Math.abs(last.y - down.y)) return;
      e.stopImmediatePropagation(); // not a drag onto a board or card
      e.dataTransfer.setData(SWIPE, '1');
      e.dataTransfer.setDragImage(blank, 0, 0);
      e.dataTransfer.effectAllowed = 'move';
      const topEl = el.querySelector('.fanitem[tabindex="0"]'), x0 = down.x;
      let dx = last.x - x0;
      topEl.style.transition = 'none';
      const follow = (d) => { if (!d.clientX && !d.clientY) return; dx = d.clientX - x0; topEl.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`; };
      const end = () => {
        el.removeEventListener('drag', follow); el.removeEventListener('dragend', end); document.removeEventListener('dragover', follow);
        topEl.style.transition = ''; topEl.style.transform = '';
        if (Math.abs(dx) > 50) turn(el, dx < 0 ? 1 : -1);
      };
      el.addEventListener('drag', follow); el.addEventListener('dragend', end); document.addEventListener('dragover', follow);
    });
    // Over its own stack a swipe shows a normal cursor, and letting go there does nothing else.
    const isSwipe = (e) => [...e.dataTransfer.types].includes(SWIPE);
    el.addEventListener('dragover', (e) => { if (isSwipe(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    el.addEventListener('drop', (e) => { if (isSwipe(e)) { e.preventDefault(); e.stopPropagation(); } });
  }

  // members: the stack's items in list order. media(it): the picture part of a card.
  // Fixed order (oldest first), so a sync that re-sorts the list never changes a stack's shape.
  function stackCard(unordered, index, media) {
    const members = unordered.slice().sort((x, y) => (x.importedAt || '').localeCompare(y.importedAt || '') || x.id.localeCompare(y.id));
    const id = members[0].stack, len = members.length;
    const first = members[0];
    const el = h('div', { class: 'card stackcard', 'data-stack': id, style: { animationDelay: Math.min(index * 30, 420) + 'ms' } });
    el._members = members;
    const fan = h('div', { class: 'fan', style: { aspectRatio: ratioOf(first) } },
      members.map((m, i) => h('button', { type: 'button', class: 'fanitem', 'data-id': m.id, 'aria-label': `Open ${m.title}, ${i + 1} of ${len} in a stack. Drag across or use the arrow keys to go through it.`,
        onclick: (e) => click(e, members.map((x) => x.id), () => NB.viewer.open(m.id)) }, media(m), h('span', { class: 'sr' }, m.title))));
    el.append(fan, h('span', { class: 'stackct', 'aria-hidden': 'true' }, icon('stack'), h('span')), pickBox(members.map((x) => x.id)));
    swipe(el);
    NB.dragSource(el, members.map((x) => x.id));
    // A sideways scroll (trackpad, tilt wheel or Shift + wheel) flicks through too.
    let wait = 0;
    el.addEventListener('wheel', (e) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      if (performance.now() < wait) return;
      wait = performance.now() + 280;
      turn(el, dx > 0 ? 1 : -1);
    }, { passive: false });
    el.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); turn(el, e.key === 'ArrowRight' ? 1 : -1); el.querySelector('.fanitem[tabindex="0"]').focus(); } });
    place(el);
    return el;
  }

  // Items in list order, with each stack (two or more of its items in the list) as one entry.
  // Inside a board (`boardId`), only stacks made in that board group; the rest show as loose cards.
  function group(list, boardId) {
    const done = new Set(), out = [];
    for (const it of list) {
      if (it.stack && !it.deletedAt && (!boardId || it.stackIn === boardId)) {
        if (done.has(it.stack)) continue;
        const members = list.filter((x) => x.stack === it.stack);
        if (members.length > 1) { done.add(it.stack); out.push(members); continue; }
      }
      out.push(it);
    }
    return out;
  }

  // ---------- picking ----------
  const picked = new Set();
  function pickBox(ids) {
    return h('span', { class: 'pick', role: 'checkbox', 'aria-checked': 'false', 'aria-label': 'Pick', tabindex: '-1', onclick: (e) => { e.stopPropagation(); toggle(ids); } }, icon('check'));
  }
  // A click on a card: with Ctrl/Shift held (or while picking) it picks; otherwise it opens.
  function click(e, ids, open) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || picked.size) { e.preventDefault(); toggle(ids); } else open();
  }
  function toggle(ids) {
    const on = !ids.every((id) => picked.has(id));
    ids.forEach((id) => (on ? picked.add(id) : picked.delete(id)));
    mark();
  }
  function clear() { if (!picked.size) return; picked.clear(); mark(); }
  function idsOf(card) { return card.classList.contains('stackcard') ? [...card.querySelectorAll('.fanitem')].map((b) => b.dataset.id) : [card.dataset.id]; }
  function mark() {
    const live = new Set(NB.S.snap.items.filter((i) => !i.deletedAt).map((i) => i.id));
    for (const id of [...picked]) if (!live.has(id)) picked.delete(id);
    for (const c of document.querySelectorAll('.grid .card')) {
      const on = picked.size > 0 && idsOf(c).every((id) => picked.has(id));
      c.classList.toggle('sel', on);
      const box = c.querySelector('.pick');
      if (box) box.setAttribute('aria-checked', String(on));
    }
    document.body.classList.toggle('picking', picked.size > 0);
    bar();
  }
  function bar() {
    const el = document.getElementById('selbar');
    const n = picked.size;
    el.hidden = !n;
    if (!n) return;
    const items = NB.S.snap.items.filter((i) => picked.has(i.id));
    const allOff = items.every((i) => i.phone === false);
    const ids = [...picked];
    el.replaceChildren(
      h('span', { class: 'count' }, `${n} picked`),
      h('button', { type: 'button', class: 'btn small', disabled: n < 2, onclick: async () => {
        const res = NB.apply(await nb.stackItems(ids, NB.currentBoardId()));
        if (res) { picked.clear(); mark(); toast(`Stacked ${n}. Use the arrows (or scroll sideways) to go through them.`); }
      } }, icon('stack'), 'Stack'),
      h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const res = NB.apply(await nb.setOnPhone(ids, allOff));
        if (res) { picked.clear(); mark(); toast(allOff ? `${n === 1 ? 'It' : 'They'}'ll show on your phone after the next sync` : `${n === 1 ? 'It' : 'They'}'ll leave your phone at the next sync. ${n === 1 ? 'It stays' : 'They stay'} here.`); }
      } }, icon(allOff ? 'phone' : 'phone-off'), allOff ? 'Show on phone' : 'Hide from phone'),
      h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
        for (const id of ids) if (!NB.apply(await nb.moveToBin(id))) return;
        picked.clear(); mark();
        toast(`Moved ${n} to the Bin`, { action: { label: 'Undo', run: async () => { for (const id of ids) NB.apply(await nb.restore(id)); } } });
      } }, icon('bin'), 'Move to Bin'),
      h('button', { type: 'button', class: 'iconbtn spin', 'aria-label': 'Stop picking', onclick: clear }, icon('x')));
  }

  NB.stacks = { stackCard, group, click, pickBox, mark, clear, isPicking: () => picked.size > 0 };
})();
