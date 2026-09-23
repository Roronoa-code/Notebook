// Stacks (pictures fanned in the space of one card, flicked through with the arrows or a sideways
// scroll) and picking several things at once (Ctrl-click or the tick) to stack, hide from the phone or bin.
(() => {
  const { h, icon, toast } = NB;
  const top = {}; // which picture is on top of each stack, for as long as the app is open

  // ---------- stacks ----------
  const FAN = [
    { t: 'none', o: 1 },
    { t: 'translate(4%, 1%) rotate(4deg) scale(.94)', o: 1 },
    { t: 'translate(-4%, 2%) rotate(-5deg) scale(.9)', o: 1 },
    { t: 'translate(0, 5%) scale(.84)', o: 0 }
  ];
  function place(el) {
    const items = [...el.querySelectorAll('.fanitem')], len = items.length, t = top[el.dataset.stack] || 0;
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
    const len = el.querySelectorAll('.fanitem').length, id = el.dataset.stack;
    top[id] = (((top[id] || 0) + dir) % len + len) % len;
    place(el);
  }

  // members: the stack's items in list order. media(it): the picture part of a card.
  function stackCard(members, index, media) {
    const id = members[0].stack, len = members.length;
    if ((top[id] || 0) >= len) top[id] = 0;
    const first = members[0];
    const el = h('div', { class: 'card stackcard', 'data-stack': id, style: { animationDelay: Math.min(index * 30, 420) + 'ms' } });
    const fan = h('div', { class: 'fan', style: { aspectRatio: first.w && first.h ? `${first.w} / ${first.h}` : '4 / 5' } },
      members.map((m, i) => h('button', { type: 'button', class: 'fanitem', 'data-id': m.id, 'aria-label': `Open ${m.title}, ${i + 1} of ${len} in a stack`,
        onclick: (e) => click(e, members.map((x) => x.id), () => NB.viewer.open(m.id)) }, media(m), h('span', { class: 'sr' }, m.title))));
    el.append(fan,
      h('span', { class: 'stackct', 'aria-hidden': 'true' }, icon('stack'), h('span')),
      h('button', { type: 'button', class: 'fanarrow l', 'aria-label': 'Previous in stack', onclick: () => turn(el, -1) }, icon('left')),
      h('button', { type: 'button', class: 'fanarrow r', 'aria-label': 'Next in stack', onclick: () => turn(el, 1) }, icon('right')),
      pickBox(members.map((x) => x.id)));
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
  function group(list) {
    const done = new Set(), out = [];
    for (const it of list) {
      if (it.stack && !it.deletedAt) {
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
        const res = NB.apply(await nb.stackItems(ids));
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
