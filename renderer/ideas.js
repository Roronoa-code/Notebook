// Ideas: the Pinterest-style feed. "For you" on All items and "Ideas" on each board, next to "Saved".
// Pins are picked and ranked by the PC (main/feed.js); here they're laid out in columns (new ones are
// added to the shortest column, so nothing jumps), saved with one click, hidden, or opened in Pinterest.
(() => {
  const { h, icon, toast } = NB;
  const $ = (id) => document.getElementById(id);
  const GAP = 22;
  const FIRST = 30, PAGE = 24, BUFFER = 40; // cards shown at first, added per step, and pins kept ready below
  let on = false;          // showing Ideas instead of Saved
  let key = null;          // which feed is on screen ('all' or a board id)
  let data = null;         // that feed as last loaded
  const cards = new Map(); // pin id -> card
  let cols = [];
  const saving = new Map(); // pin addresses -> time saving began
  let busySince = 0, busyKey = null;
  let refreshing = 0, settled = 0; // a New ideas request in flight (its start), and when the last one landed
  let shown = 0;            // how many of the feed's pins are on the page
  let asking = false;       // a next page has been asked for
  let context = null, trail = [], draft = '', restoreTop = null, restoreCount = 0;

  const baseKey = () => NB.currentBoardId() || (NB.S.board === 'all' ? 'all' : null);
  const keyNow = () => {
    const base = baseKey();
    if (context !== base) { context = base; trail = []; draft = ''; restoreTop = null; }
    return trail.length ? trail[trail.length - 1].key : base;
  };
  const active = () => on && !!keyNow() && !NB.smart.suggestion();

  function browse(k, title) {
    if (k === keyNow()) return;
    if (!trail.length) trail.push({ key: baseKey(), title: '', top: $('page').scrollTop, shown });
    else Object.assign(trail[trail.length - 1], { top: $('page').scrollTop, shown });
    trail.push({ key: k, title, top: 0 });
    key = null; restoreTop = 0; restoreCount = 0; NB.S.anim = true; NB.refreshGrid();
  }
  function back() {
    if (trail.length < 2) return false;
    trail.pop(); restoreTop = trail[trail.length - 1].top; restoreCount = trail[trail.length - 1].shown || 0;
    if (trail.length === 1) trail = [];
    key = null; NB.S.anim = true; NB.refreshGrid();
    return true;
  }

  // Saved | For you (or Ideas on a board), in the header.
  function tabs(previous) {
    if (!keyNow() || NB.smart.suggestion()) return null;
    const pick = (want) => () => { if (on === want) return; on = want; NB.S.anim = true; NB.refreshGrid(); $('page').scrollTo({ top: 0 }); };
    const tab = (label, want) => h('button', { type: 'button', class: 'segbtn' + (on === want ? ' on' : ''), 'aria-pressed': String(on === want), onclick: pick(want) }, label);
    const group = previous || h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, tab('Saved', false), tab('Ideas', true));
    [...group.children].forEach((button, i) => { button.classList.toggle('on', on === !!i); button.setAttribute('aria-pressed', String(on === !!i)); });
    group.lastChild.textContent = baseKey() === 'all' ? 'For you' : 'Ideas';
    return group;
  }

  // The line under the title while Ideas are showing, with "New ideas".
  function info() {
    const n = data && data.key === keyNow() ? data.pins.length : 0;
    const busy = data && data.busy;
    // A refresh (the approved look, as on the phone): the search field's lower edge carries the libraries.dev beam
    // and the New ideas arrows melt into liquid droplets (goo.js) that pull back into the arrows when ideas land.
    const turning = !!refreshing && n > 0;
    const line = h('div', { class: 'count micro' }, n ? h('b', null, n) : '', n ? ` idea${n === 1 ? '' : 's'}` : '', busy && !turning ? (n ? ' · finding more…' : 'Finding ideas…') : '');
    NBEffects.set(line, busy && !turning ? 'searching' : null, busySince);
    const out1 = !turning && settled && Date.now() - settled < 420 ? settled : 0;
    const ico = h('span', { class: 'refresh-ico' + (turning ? ' turning' : '') + (out1 ? ' settling' : '') }, icon('restore'));
    if (turning || out1) ico.insertAdjacentHTML('beforeend', NBGoo.html(refreshing || out1, turning ? 0 : out1));
    const fresh = h('button', { type: 'button', class: 'btn small', disabled: !!busy || turning, 'aria-busy': String(turning), onclick: refresh }, ico, turning ? 'Finding ideas…' : 'New ideas');
    const out = [line, h('div', { class: 'ctx-actions' }, fresh)];
    const input = h('input', { type: 'search', class: 'search', 'aria-label': 'Search Pinterest ideas', placeholder: 'Search Pinterest ideas', maxlength: 120, value: draft, oninput: (e) => { draft = e.target.value; } });
    out.push(h('form', { class: 'ideas-search', onsubmit: (e) => { e.preventDefault(); const q = input.value.trim().replace(/\s+/g, ' '); if (q) browse('search:' + q, q); } },
      h('div', { class: 'search-wrap', ...(turning ? { 'data-nb-beam': '', 'data-nb-since': String(refreshing - 3000) } : {}) }, icon('search'), input), h('button', { type: 'submit', class: 'btn small' }, 'Search')));
    if (trail.length > 1) out.push(h('div', { class: 'ideas-breadcrumb' }, h('button', { type: 'button', class: 'btn small', onclick: back }, 'Back to ideas'), h('span', null, trail[trail.length - 1].title)));
    if (data && data.key === keyNow() && data.error && data.pins.length) out.push(h('p', { class: 'hint ideas-hint' }, 'No new ideas just now. ' + data.error));
    if (data && data.key === 'all' && data.signedIn === false) {
      out.push(h('p', { class: 'hint ideas-hint' }, 'Sign in to Pinterest (in the Pinterest panel) and your Pinterest home feed is mixed in too. ',
        h('button', { type: 'button', class: 'linkbtn', onclick: () => $('pin-btn').click() }, 'Open Pinterest')));
    }
    return out;
  }

  // Called after every redraw of the page: shows Ideas or the saved items, and loads the right feed.
  function sync() {
    const box = $('ideas');
    const show = active();
    box.hidden = !show;
    $('grid').hidden = show;
    if (show) $('empty').hidden = true;
    if (!show) return;
    const k = keyNow();
    if (k !== key || NB.S.anim) { key = k; data = data && data.key === k ? data : null; clear(true); if (data) draw(); nb.feed(k).then(got); }
  }

  function refresh() {
    if (refreshing) return;
    refreshing = Date.now(); NB.refreshContext();
    const k = keyNow();
    const mine = refreshing;
    // It lands when the feed stops being busy (got() hears it); a request that fails or never answers still settles.
    nb.feedRefresh(k).then(got, () => settle());
    setTimeout(() => { if (refreshing === mine) settle(); }, 45000);
  }
  // The refresh has landed (or failed): the droplets pull back into the arrows.
  function settle() { refreshing = 0; settled = Date.now(); if (active()) NB.refreshContext(); }

  function got(res) {
    if (refreshing && res && (res.error || (res.feed && !res.feed.busy))) settle();
    if (!res || res.error || !res.feed) { if (res && res.error) toast(res.error, { error: true }); return; }
    if (res.feed.key !== key) return;
    if (!res.feed.busy) asking = false;
    const fresh = data && res.feed.pins.length && data.pins.length && res.feed.pins[0].id !== data.pins[0].id;
    if (res.feed.busy) { if (!busySince || busyKey !== key) busySince = Date.now(); busyKey = key; }
    else { busySince = 0; busyKey = null; }
    data = res.feed;
    if (fresh) clear(true);
    if (restoreTop !== null) shown = Math.max(shown, restoreCount);
    draw();
    if (restoreTop !== null && data.pins.length) { $('page').scrollTop = restoreTop; restoreTop = null; }
    if (active()) {
      const input = document.activeElement, editing = input?.matches('.ideas-search input');
      const selection = editing ? [input.selectionStart, input.selectionEnd] : null;
      NB.refreshContext();
      if (editing) { const next = document.querySelector('.ideas-search input'); next?.focus({ preventScroll: true }); if (next) next.setSelectionRange(...selection); }
    }
  }
  nb.onFeedChanged(({ key: k }) => { if (active() && k === key) nb.feed(k).then(got); });

  function clear(animate) {
    const box = $('ideas');
    cards.clear();
    cols = [];
    shown = 0;
    box.replaceChildren();
    box.className = 'ideas' + (animate ? ' anim ' + NB.S.dir : '');
  }

  // The number of columns that fit, using the same card size as the saved items.
  function colCount() {
    const W = $('ideas').clientWidth || $('page').clientWidth - 84;
    const card = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card')) || 250;
    return Math.max(1, Math.floor((W + GAP) / (card + GAP)));
  }
  function ensureCols() {
    const box = $('ideas'), n = colCount();
    if (cols.length === n) return;
    const order = [...cards.values()]; // re-deal every card in order when the width changes
    cols = Array.from({ length: n }, () => h('div', { class: 'ideacol' }));
    box.replaceChildren(...cols, sentinel);
    for (const el of order) shortest().append(el);
  }
  const shortest = () => cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight ? b : a));

  function draw() {
    const box = $('ideas');
    if (!data) return;
    const pins = data.pins;
    if (!pins.length) {
      cards.clear(); cols = [];
      box.replaceChildren(data.busy ? h('div', { class: 'ideas-wait' }, ...Array.from({ length: 10 }, (_, i) => h('div', { class: 'ph-card', style: { height: 220 + (i % 3) * 70 + 'px', animationDelay: i * 80 + 'ms' } })))
        : h('div', { class: 'empty' }, h('h2', { class: 'display' }, data.error ? 'Couldn’t load ideas' : 'No ideas yet'),
          h('p', null, data.error || 'Add a few things here first, then Notebook can find more like them.'),
          h('button', { type: 'button', class: 'btn', onclick: () => nb.feedRefresh(key).then(got) }, 'Try again')));
      return;
    }
    if (!cols.length) box.replaceChildren();
    ensureCols();
    const want = new Set(pins.map((p) => p.id));
    for (const [id, el] of cards) if (!want.has(id)) { el.remove(); cards.delete(id); }
    shown = Math.min(pins.length, Math.max(shown, FIRST));
    let i = 0;
    for (const p of pins.slice(0, shown)) {
      const had = cards.get(p.id);
      if (had) { mark(had, p); continue; }
      const el = card(p, i++);
      cards.set(p.id, el);
      shortest().append(el);
    }
    sentinel.hidden = !data.more && shown >= pins.length;
    requestAnimationFrame(ahead);
  }

  // Keeps ahead of the scroll: within a few screens of the end, more of the pins already here are put
  // on the page, and the next page is asked for while plenty are still waiting below.
  function ahead() {
    if (!active() || !data || !data.pins.length || !cols.length) return;
    const pg = $('page');
    if (pg.scrollHeight - pg.scrollTop - pg.clientHeight < pg.clientHeight * 2.5 && shown < data.pins.length) { shown += PAGE; draw(); return; }
    if (data.pins.length - shown < BUFFER && data.more && !data.error && !asking) { asking = true; busySince ||= Date.now(); nb.feedMore(key).then(got); }
    sentinel.textContent = asking && shown >= data.pins.length ? 'Finding more…' : '';
    NBEffects.set(sentinel, asking && shown >= data.pins.length ? 'searching' : null, busySince);
  }

  function card(p, index) {
    const img = h('img', { src: `nb://notebook/feed/${p.sig}.jpg`, alt: '', loading: 'lazy', decoding: 'async', draggable: false, width: p.w, height: p.h });
    img.addEventListener('error', () => { el.remove(); cards.delete(p.id); }, { once: true }); // a picture Pinterest no longer has
    // shown only once it has fully arrived: its card keeps its shape and a plain surface until then, never half a picture
    if (img.complete && img.naturalWidth) img.classList.add('ready'); else img.addEventListener('load', () => img.classList.add('ready'), { once: true });
    const save = h('button', { type: 'button', class: 'btn small accent idea-save', onclick: () => saveIt(p, el) });
    const media = h('div', { class: 'media' }, img,
      h('button', { type: 'button', class: 'idea-open', 'aria-label': `Look at ${p.title || 'this pin'}`, onclick: () => closeup(p) }),
      p.video ? h('span', { class: 'badge' }, icon('play'), 'Video') : null,
      save,
      h('button', { type: 'button', class: 'iconbtn idea-hide', 'aria-label': 'Not for me', title: 'Not for me', onclick: () => hideIt(p, el) }, icon('x')));
    const el = h('div', { class: 'card idea', 'data-pin': p.id, style: { '--tilt': index % 2 ? '1.3deg' : '-1.3deg', animationDelay: Math.min(index * 30, 420) + 'ms' } },
      media, p.title ? h('div', { class: 'idea-title' }, p.title) : null);
    mark(el, p);
    return el;
  }

  // A pin up close, inside Notebook (instant: its picture is already here; a sharper copy follows).
  // Save, Open in Pinterest, Not for me; ← → go through the ideas, Esc closes.
  function closeup(p) {
    NB.motion.find('.ideaview')?.closeIdea();
    const focus = document.activeElement;
    // Always as large as the close-up allows, in the pin's own shape (not the downloaded file's size), so it never
    // changes size when the sharper copy arrives and the flight from the pin lands exactly.
    const ar = (+p.w || 4) / (+p.h || 5);
    const img = h('img', { src: `nb://notebook/feed/${p.sig}.jpg`, alt: p.title || 'A pin from Pinterest', width: p.w, height: p.h, style: { width: `min(660px, 58vw, calc((88vh - 36px) * ${ar.toFixed(4)}))`, aspectRatio: `${+p.w || 4} / ${+p.h || 5}`, height: 'auto' } });
    const sharp = new Image();
    sharp.src = `nb://notebook/feed/${p.sig}-big.jpg`;
    sharp.decode().then(() => { if (img.isConnected) img.src = sharp.src; }, () => {});
    const box = h('div', { class: 'ideaview', role: 'dialog', 'aria-modal': 'true', 'aria-label': p.title || 'Idea', 'data-pin': p.id });
    const close = () => {
      if (box.inert) return; box.inert = true; box.dataset.motionOpen = 'false';
      document.removeEventListener('keydown', keys, true);
      const flight = box.flyClose && box.flyClose();
      Promise.all([...box.children].map(el => NB.motion.hide(el)).concat(flight ? [flight.finished.catch(() => {})] : [])).then(() => { box.remove(); if (!NB.motion.find('.ideaview') && focus?.isConnected) focus.focus(); });
    };
    box.closeIdea = close;
    // The picture flies between its pin in the grid and the close-up: a copy of it travels on top of everything
    // (the panel around it only fades), while the pin and the close-up's own picture wait hidden until it lands.
    const pinMedia = () => { const c = cards.get(p.id); const m = c && c.querySelector('.media'); const r = m && m.getBoundingClientRect(); return r && r.width && r.bottom > 0 && r.top < innerHeight ? { m, r } : null; };
    const fly = (from, to, hide) => {
      const f = img.cloneNode();
      f.className = 'iv-flyer'; f.removeAttribute('width'); f.removeAttribute('height');
      Object.assign(f.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
      document.body.append(f);
      hide.forEach((n) => { n.style.visibility = 'hidden'; });
      const t = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
      const a = f.animate([{ transform: t }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)' });
      const land = () => { f.remove(); hide.forEach((n) => { n.style.visibility = ''; }); };
      a.onfinish = land; a.oncancel = land; setTimeout(land, 900);
      return a;
    };
    const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.flyOpen = (rest) => { const at = pinMedia(); return at && !still() && rest.width ? fly(at.r, rest, [at.m, img]) : null; };
    box.flyClose = () => { const at = pinMedia(), r = img.getBoundingClientRect(); return at && !still() && r.width ? fly(r, at.r, [at.m, img]) : null; };

    const step = (d) => { const i = data.pins.findIndex((x) => x.id === p.id), next = data.pins[i + d]; if (next) { document.removeEventListener('keydown', keys, true); closeup(next); } };
    const keys = (e) => {
      if (NB.modalOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowRight' ? 1 : -1); }
    };
    box.append(h('div', { class: 'iv-back', onclick: close }),
      h('div', { class: 'iv-panel' },
        h('div', { class: 'iv-pic' }, img, p.video ? h('span', { class: 'badge' }, icon('play'), 'Video') : null),
        h('div', { class: 'iv-side' },
          h('span', { class: 'micro' }, 'From Pinterest'),
          h('h3', { class: 'display' }, p.title || 'Untitled pin'),
          h('button', { type: 'button', class: 'btn accent idea-save', onclick: () => saveIt(p, box) }),
          h('button', { type: 'button', class: 'btn idea-related', onclick: () => { close(); browse('pin:' + p.id, 'More like ' + (p.title || 'this pin')); } }, 'More like this'),
          h('button', { type: 'button', class: 'btn', onclick: () => { close(); NB.links.openAt(p.url); } }, icon('pin'), 'Open in Pinterest'),
          h('button', { type: 'button', class: 'btn', onclick: () => { close(); const el = cards.get(p.id); if (el) hideIt(p, el); else nb.feedHide(p.id); } }, icon('x'), 'Not for me'),
          h('p', { class: 'hint' }, '← → for the next idea')),
        h('button', { type: 'button', class: 'iconbtn spin iv-close', 'aria-label': 'Close', onclick: close }, icon('x'))));
    mark(box, p);
    document.body.append(box);
    const rest = img.getBoundingClientRect(); // where it will rest (measured before the panel starts its own entrance)
    [...box.children].forEach(el => NB.motion.show(el, focus));
    box.flyOpen(rest);
    document.addEventListener('keydown', keys, true);
    box.querySelector('.idea-save').focus();
  }

  // The Save button: Save, Saving…, or Saved.
  function mark(el, p) {
    const b = el && el.querySelector('.idea-save');
    if (!b) return;
    const state = p.saved ? 'saved' : saving.has(p.url) ? 'saving' : 'save';
    if (b.dataset.state === state) return;
    b.dataset.state = state;
    b.disabled = state !== 'save';
    b.replaceChildren(...(state === 'saved' ? [icon('check'), 'Saved'] : state === 'saving' ? ['Saving…'] : [icon('plus'), 'Save']));
    NBEffects.set(b, state === 'saving' ? 'beam' : null, saving.get(p.url));
    el.classList.toggle('saved', state === 'saved');
  }

  async function saveIt(p, el) {
    saving.set(p.url, Date.now());
    mark(el, p); mark(cards.get(p.id), p);
    const res = await nb.feedSave(p.url, NB.currentBoardId());
    if (res && res.error) { saving.delete(p.url); mark(el, p); mark(cards.get(p.id), p); toast(res.error, { error: true }); }
  }
  // The saved link's result (the toast itself comes from links.js).
  nb.onLinkSaved((r) => {
    if (!saving.delete(r.url)) return;
    const p = data && data.pins.find((x) => x.url === r.url);
    const el = p && cards.get(p.id);
    if (p) p.saved = !!r.ok;
    if (el) mark(el, p);
    const open = document.querySelector('.ideaview');
    if (p && open && open.dataset.pin === p.id) mark(open, p);
  });

  async function hideIt(p, el) {
    const done = () => { el.remove(); cards.delete(p.id); if (data) data.pins = data.pins.filter((x) => x.id !== p.id); };
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 220, easing: 'ease-in' }).onfinish = done;
    const res = await nb.feedHide(p.id);
    if (res && res.error) toast(res.error, { error: true });
  }

  // The end of the list: says when the next page is on its way.
  const sentinel = h('div', { class: 'ideas-more micro', 'aria-live': 'polite' });
  let frame = 0;
  $('page').addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; ahead(); }); }, { passive: true });
  new ResizeObserver(() => { if (active() && cards.size) ensureCols(); }).observe($('ideas'));
  document.addEventListener('keydown', (e) => {
    if (NB.modalOpen()) return;
    if (e.key === 'Escape' && active() && !document.querySelector('.ideaview') && !e.target.closest('input, textarea, [contenteditable]') && back()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  NB.ideas = { tabs, info, sync, active, leave: () => { on = false; trail = []; }, redeal: () => { if (active() && cards.size) { cols = []; ensureCols(); } } };
})();
