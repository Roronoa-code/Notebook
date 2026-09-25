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
  const saving = new Set(); // pin addresses being saved
  let shown = 0;            // how many of the feed's pins are on the page
  let asking = false;       // a next page has been asked for

  const keyNow = () => NB.currentBoardId() || (NB.S.board === 'all' ? 'all' : null);
  const active = () => on && !!keyNow() && !NB.smart.suggestion();

  // Saved | For you (or Ideas on a board), in the header.
  function tabs() {
    if (!keyNow() || NB.smart.suggestion()) return null;
    const pick = (want) => () => { if (on === want) return; on = want; NB.S.anim = true; NB.refreshGrid(); $('page').scrollTo({ top: 0 }); };
    const tab = (label, want) => h('button', { type: 'button', class: 'segbtn' + (on === want ? ' on' : ''), 'aria-pressed': String(on === want), onclick: pick(want) }, label);
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, tab('Saved', false), tab(keyNow() === 'all' ? 'For you' : 'Ideas', true));
  }

  // The line under the title while Ideas are showing, with "New ideas".
  function info() {
    const n = data && data.key === keyNow() ? data.pins.length : 0;
    const busy = data && data.busy;
    const line = h('div', { class: 'count micro' }, n ? h('b', null, n) : '', n ? ` idea${n === 1 ? '' : 's'}` : '', busy ? (n ? ' · finding more…' : 'Finding ideas…') : '');
    const fresh = h('button', { type: 'button', class: 'btn small', disabled: !!busy, onclick: () => { nb.feedRefresh(keyNow()).then(got); } }, icon('restore'), 'New ideas');
    const out = [line, h('div', { class: 'ctx-actions' }, fresh)];
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

  function got(res) {
    if (!res || res.error || !res.feed) { if (res && res.error) toast(res.error, { error: true }); return; }
    if (res.feed.key !== key) return;
    if (!res.feed.busy) asking = false;
    const fresh = data && res.feed.pins.length && data.pins.length && res.feed.pins[0].id !== data.pins[0].id;
    data = res.feed;
    if (fresh) clear(true);
    draw();
    if (active()) NB.refreshContext();
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
    if (data.pins.length - shown < BUFFER && data.more && !asking) { asking = true; nb.feedMore(key).then(got); }
    sentinel.textContent = asking && shown >= data.pins.length ? 'Finding more…' : '';
  }

  function card(p, index) {
    const img = h('img', { src: `nb://notebook/feed/${p.sig}.jpg`, alt: '', loading: 'lazy', decoding: 'async', draggable: false, width: p.w, height: p.h });
    img.addEventListener('error', () => { el.remove(); cards.delete(p.id); }, { once: true }); // a picture Pinterest no longer has
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
    document.querySelector('.ideaview')?.remove();
    const img = h('img', { src: `nb://notebook/feed/${p.sig}.jpg`, alt: p.title || 'A pin from Pinterest', width: p.w, height: p.h });
    const sharp = new Image();
    sharp.src = `nb://notebook/feed/${p.sig}-big.jpg`;
    sharp.decode().then(() => { if (img.isConnected) img.src = sharp.src; }, () => {});
    const box = h('div', { class: 'ideaview', role: 'dialog', 'aria-modal': 'true', 'aria-label': p.title || 'Idea', 'data-pin': p.id });
    const close = () => { document.removeEventListener('keydown', keys, true); box.classList.add('out'); setTimeout(() => box.remove(), 180); };
    const step = (d) => { const i = data.pins.findIndex((x) => x.id === p.id), next = data.pins[i + d]; if (next) { document.removeEventListener('keydown', keys, true); closeup(next); } };
    const keys = (e) => {
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
          h('button', { type: 'button', class: 'btn', onclick: () => { close(); NB.links.openAt(p.url); } }, icon('pin'), 'Open in Pinterest'),
          h('button', { type: 'button', class: 'btn', onclick: () => { close(); const el = cards.get(p.id); if (el) hideIt(p, el); else nb.feedHide(p.id); } }, icon('x'), 'Not for me'),
          h('p', { class: 'hint' }, '← → for the next idea')),
        h('button', { type: 'button', class: 'iconbtn spin iv-close', 'aria-label': 'Close', onclick: close }, icon('x'))));
    mark(box, p);
    document.body.append(box);
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
    el.classList.toggle('saved', state === 'saved');
  }

  async function saveIt(p, el) {
    saving.add(p.url);
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

  NB.ideas = { tabs, info, sync, active, leave: () => { on = false; }, redeal: () => { if (active() && cards.size) { cols = []; ensureCols(); } } };
})();
