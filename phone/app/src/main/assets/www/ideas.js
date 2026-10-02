// Native Pinterest discovery, with cached ideas available offline. The WebView stays local.
window.NBIdeas = function NBIdeas({ N, S, $, esc, toast, boardName, rerender, reveal, saved = () => {} }) {
  const FEED = window.NB_FEED ?? '/feed/';
  const read = () => { try { const d = JSON.parse(N.feed()); return d && d.feeds ? d : { feeds: {} }; } catch (e) { return { feeds: {} }; } };
  let data = read();
  const loaded = new Set(); // pictures that have fully arrived once (drawn at once next time)
  const askedFor = {};
  const pending = new Set(), saving = new Map(), journeys = new Map();
  // Asks still unanswered, per feed. Answers come back in the order they were asked, so an answer that arrives while
  // a newer ask is out has been superseded: it is dropped, and only the newest one changes what is shown.
  // One publication rule (NBF-02): a feed already showing pins changes only when it was asked to (New ideas, a
  // first load, a search). A quiet recheck of old pins is kept aside (`staged`): it never swaps the set being looked
  // at; its new pins join the bottom when the end is reached, and the phone has them ready next time anyway.
  const asks = {}, gen = {}, quiet = {}, staged = {}, settled = {}; // settled: when a refresh finished (its droplets pull back together)
  const ask = (key, still = false) => { asks[key] = (asks[key] || 0) + 1; gen[key] = (gen[key] || 0) + 1; quiet[key] = still; if (!still) pending.add(key); };
  const looking = (key) => showing() && currentKey() === key;
  const orbAttrs = (at) => at ? ` data-nb-orb="searching" data-nb-since="${at}" aria-busy="true"` : '';
  const baseKey = () => S.screen === 'board' ? S.board : 'all';
  const journey = (base = baseKey()) => {
    if (!journeys.has(base)) journeys.set(base, { trail: [{ key: base, title: '', top: 0 }], draft: '' });
    return journeys.get(base);
  };
  const currentKey = () => journey().trail.at(-1).key;
  const scrollBox = () => S.screen === 'board' ? $('#boardgrid')?.closest('.screen') : $('#homescroll');
  const showing = () => (S.screen === 'home' && S.tab === 'ideas') || (S.screen === 'board' && S.btab === 'ideas');
  function browse(key, title) {
    const j = journey();
    if (j.trail.at(-1).key === key) return;
    j.trail.at(-1).top = scrollBox()?.scrollTop || 0;
    j.trail.push({ key, title, top: 0 });
    reveal();
    rerender();
    if (scrollBox()) scrollBox().scrollTop = 0;
  }
  function back() {
    if (!showing() || journey().trail.length < 2) return false;
    journey().trail.pop();
    rerender();
    if (scrollBox()) scrollBox().scrollTop = journey().trail.at(-1).top;
    return true;
  }
  const pins = (key) => ((data.feeds[key] || {}).pins || []);
  const pinById = (id) => { for (const f of Object.values(data.feeds)) { const p = (f.pins || []).find((x) => x.id === id); if (p) return p; } return null; };

  // Recheck stale content when opened, independently of pairing or library sync.
  function freshen(key, empty) {
    if (pending.has(key) || staged[key] || Date.now() - (askedFor[key] || 0) < 60000) return false;
    const at = Number((data.feeds[key] || {}).at) || Date.parse(data.fetchedAt || '') || 0;
    if (!empty && Date.now() - at < 30 * 60000) return false;
    askedFor[key] = Date.now(); ask(key, !empty); // pins already showing: a quiet recheck, nothing turns or moves
    N.feedRefresh(key);
    return empty;
  }
  // `list` after the pins already published for `key`: the ones shown keep their order, only new ids join the end.
  const extend = (key, list) => { const have = new Set(pins(key).map((p) => p.id)); return [...pins(key), ...(list || []).filter((p) => !have.has(p.id))]; };
  window.nbOnFeed = async (json) => {
    const d = JSON.parse(json);
    const key = d.key, was = key && more === key ? more : null;
    if (was) more = null;
    if (key && !was && asks[key]) {
      asks[key]--;
      if (asks[key] > 0) return; // superseded by a newer ask: that one publishes
    }
    const g = gen[key], still = !was && !!quiet[key];
    // Every answer carries every feed the phone keeps; only the one it answers may change. Others are taken only
    // when nothing of theirs has been shown yet.
    const incoming = d.feeds || {};
    for (const k of Object.keys(incoming)) if (k !== key && !data.feeds[k]) data.feeds[k] = incoming[k];
    if (d.fetchedAt) data.fetchedAt = d.fetchedAt;
    if (d.error) {
      if (key) { pending.delete(key); settled[key] = Date.now(); }
      if (was) moreAt = Date.now();
      if (!still) { // (a quiet recheck that failed keeps what is shown, and says nothing)
        if (key && !was) data.feeds[key] = { ...data.feeds[key], error: d.error };
        if (!key || looking(key)) toast(d.error);
      }
      rerender(); return;
    }
    const next = key && incoming[key];
    if (!next) { if (key) pending.delete(key); return; }
    if (was) {
      const before = pins(was).length;
      data.feeds[was] = { ...next, pins: extend(was, next.pins) };
      if (data.feeds[was].error || pins(was).length <= before) moreAt = Date.now();
      if (!append(was)) rerender();
      return;
    }
    if (still && pins(key).length) { staged[key] = next; return; } // kept aside: the set being read stays
    // Keep the old visible grid until its replacement pictures have decoded; a slow or missing file
    // gets the same-size fallback below instead of holding the refresh open indefinitely.
    if (looking(key)) {
      await Promise.race([
        Promise.all((next.pins || []).slice(0, 8).map((p) => {
          const img = new Image(); img.src = `${FEED}${p.sig}.jpg`;
          return img.decode().catch(() => {});
        })),
        new Promise((resolve) => setTimeout(resolve, 1600))
      ]);
      if (gen[key] !== g) return; // asked again while the pictures decoded: the newer answer publishes
    }
    delete staged[key];
    data.feeds[key] = next;
    if (pending.has(key)) { pending.delete(key); settled[key] = Date.now(); }
    rerender();
  };

  // The next page, asked for while a few screens of pins are still below (once at a time; after a
  // failure, not again for half a minute). New pins join the bottom of the columns; nothing moves.
  let more = null, moreAt = 0, moreSince = 0;
  function ahead() {
    for (const cols of document.querySelectorAll('.ideacols')) {
      const box = cols.closest('.screen');
      if (!box || !box.isConnected || box.closest('[hidden]')) continue;
      const key = cols.dataset.key, f = data.feeds[key];
      if (box.scrollHeight - box.scrollTop - box.clientHeight > box.clientHeight * 2.5) continue;
      if (staged[key] && !more && !pending.has(key)) { // the quiet recheck's new pins join the bottom, nothing above moves
        data.feeds[key] = { ...staged[key], pins: extend(key, staged[key].pins) };
        delete staged[key];
        if (!append(key)) rerender();
        continue;
      }
      if (!f || !f.more || f.error || more || pending.has(key) || Date.now() - moreAt < 30000) continue;
      more = key; moreAt = 0; moreSince = Date.now();
      markMore();
      N.feedMore(key);
    }
  }
  let frame = 0;
  document.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; ahead(); }); }, { capture: true, passive: true });
  function markMore() {
    document.querySelectorAll('.ideas-more').forEach((el) => {
      const busy = more && el.dataset.key === more;
      el.textContent = busy ? 'Finding more…' : '';
      NBEffects.set(el, busy ? 'searching' : null, moreSince);
    });
    document.querySelectorAll('[data-a="ideasNow"]').forEach((button) => { button.disabled = pending.has(currentKey()) || more === currentKey(); });
  }
  // A refresh starting: only the button that asked changes (and the unseen status line), in place.
  function markPending() {
    document.querySelectorAll('.ideas-refresh[data-key]').forEach((b) => {
      const busy = pending.has(b.dataset.key);
      b.classList.toggle('turning', busy); b.disabled = busy; b.setAttribute('aria-label', busy ? 'Finding new ideas' : 'New ideas');
      if (busy && !b.querySelector('.goo')) b.insertAdjacentHTML('beforeend', NBGoo.html(askedFor[b.dataset.key] || Date.now()));
      const form = b.parentNode.querySelector('.ideas-search');
      if (form) NBEffects.set(form, busy ? 'beam' : null, (askedFor[b.dataset.key] || Date.now()) - 3000);
    });
    document.querySelectorAll('.ideas-pending[data-key]').forEach((p) => { p.textContent = pending.has(p.dataset.key) ? 'Finding new ideas…' : ''; });
  }

  // Two columns, each pin into the shorter one (by its shape), so the layout is the same however it's built.
  function deal(list, onto, make = card) {
    const hgt = [0, 0], out = [[], []];
    list.forEach((p, i) => { const c = hgt[0] <= hgt[1] ? 0 : 1; hgt[c] += (+p.h || 5) / (+p.w || 4) + 0.1; if (i >= onto) out[c].push(make(p, i - onto)); });
    return out;
  }
  function append(key) {
    const cols = [...document.querySelectorAll('.ideacols')].find((c) => c.dataset.key === key);
    if (!cols) return false;
    const list = pins(key), col = cols.querySelectorAll('.ideacol');
    const have = [...col].map((c) => [...c.querySelectorAll('.card.idea')].map((x) => x.dataset.v).join());
    // Only when the cards on screen are exactly the start of this list, column by column, in order.
    const shown = cols.querySelectorAll('.card.idea').length;
    const was = shown ? deal(list.slice(0, shown), 0, (p) => p.id).map((c) => c.join()) : null;
    if (!was || was.join('|') !== have.join('|')) return false;
    const add = deal(list, shown);
    add.forEach((cards, i) => col[i].insertAdjacentHTML('beforeend', cards.join('')));
    markMore();
    requestAnimationFrame(ahead);
    return true;
  }

  const PLAY = '<span class="badge" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg></span>';
  const TICK = '<span class="ideatick" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>';
  function card(p, n) {
    return `<button type="button" class="card idea${p.saved ? ' saved' : ''}" data-a="idea" data-v="${esc(p.id)}" style="--d:${Math.min(n * 40, 400)}ms" aria-label="${esc(p.title || 'Idea')}${p.saved ? ', saved' : ''}">
      <div class="media" style="aspect-ratio:${+p.w || 4} / ${+p.h || 5}"><img src="${FEED}${esc(p.sig)}.jpg" alt="" loading="eager" decoding="sync"${loaded.has(p.sig) ? ' class="ready"' : ''}>${p.video ? PLAY : ''}${p.saved ? TICK : saving.has(p.url) ? `<span class="idea-saving" data-nb-orb="working" data-nb-since="${saving.get(p.url)}" aria-busy="true">Saving…</span>` : ''}</div></button>`;
  }

  // `quiet`: made ready beside the screen, not looked at yet, so it asks for nothing new (look() does, once it shows).
  // The Ideas pane has come into view: fresh ideas are asked for if these are old. True if that changed what it shows.
  function look(base) {
    const key = journey(base).trail.at(-1).key;
    requestAnimationFrame(ahead);
    return freshen(key, !pins(key).length);
  }
  function gridHTML(base, quiet) {
    const j = journey(base), entry = j.trail.at(-1), key = entry.key;
    const list = pins(key), err = (data.feeds[key] || {}).error;
    if (!quiet) look(base);
    // One request, one signal: a first load shows its progress in the results area only; a refresh keeps the
    // results and shows its progress on the New ideas button that asked for it. A search being looked up also
    // lights its field once the wait passes three seconds.
    const busy = pending.has(key), first = !list.length, scope = base === 'all' ? 'your whole notebook' : (boardName() || 'this board');
    const turning = busy && !first;
    // A refresh (approved option D): the search field's lower edge carries the libraries.dev beam at once, and the
    // button's arrows melt into liquid droplets (goo.js) that pull back into the arrows when the ideas land.
    const searching = busy && first && key.startsWith('search:') ? ` data-nb-beam data-nb-since="${askedFor[key]}"` : turning ? ` data-nb-beam data-nb-since="${askedFor[key] - 3000}"` : '';
    const out = settled[key] && Date.now() - settled[key] < 420 ? settled[key] : 0, goo = turning ? NBGoo.html(askedFor[key]) : out ? NBGoo.html(askedFor[key] || out, out) : '';
    // One line (approved A1): Back (only while browsing a search or "more like this"), the search field with its
    // icon inside (the keyboard's search key sends it), and a small round New ideas button that turns while it
    // works. On a first load the button just waits.
    const I = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    // A refresh is read out, never a visible line: the pictures don't move because a request started or ended.
    const refresh = `<button type="button" class="iconbtn ideas-refresh${turning ? ' turning' : ''}" data-a="ideasNow" data-key="${esc(key)}" aria-label="${busy ? 'Finding new ideas' : 'New ideas'}"${busy ? ' disabled' : ''}${out ? ' data-settling' : ''}>${I('M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4')}${goo}</button>`;
    const back = j.trail.length > 1 ? `<button type="button" class="iconbtn" data-a="ideasBack" aria-label="Back to ideas">${I('M15 18l-6-6 6-6')}</button>` : '';
    const tools = `<div class="ideas-tools"><div class="ideas-line">${back}<form class="ideas-search" data-base="${esc(base)}"${searching}>${I('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5')}<input type="search" class="idea-query" aria-label="Search Pinterest ideas for ${esc(scope)}" placeholder="Search Pinterest" maxlength="120" value="${esc(j.draft)}" enterkeyhint="search"></form>${refresh}</div>${entry.title ? `<p class="ideas-heading">${esc(entry.title)}</p>` : ''}</div>`;
    if (!first) {
      const note = err ? `<p class="ideanote">No new ideas just now. ${esc(err)}</p>` : `<p class="ideas-pending" role="status" data-key="${esc(key)}">${busy ? 'Finding new ideas…' : ''}</p>`; // (read out, not shown)
      return `${tools}${note}<div class="ideacols" data-key="${esc(key)}">${deal(list, 0).map((c) => `<div class="ideacol">${c.join('')}</div>`).join('')}</div><p class="ideas-more" data-key="${esc(key)}" aria-live="polite"${orbAttrs(more === key ? moreSince : 0)}>${more === key ? 'Finding more…' : ''}</p>`;
    }
    if (busy) return `${tools}<p class="ideas-status" role="status"${orbAttrs(askedFor[key])}>Finding ideas…</p>`;
    return `${tools}<div class="empty ideas-empty" role="status"><b>${err ? 'No ideas' : 'Nothing yet'}</b><span>${esc(err || 'No ideas here yet. Try another search.')}</span><button type="button" class="btn quiet" data-a="ideasNow">${err ? 'Try again' : 'New ideas'}</button></div>`;
  }

  document.addEventListener('input', (e) => { const form = e.target.closest('.ideas-search'); if (form) journey(form.dataset.base).draft = e.target.value; });
  document.addEventListener('submit', (e) => {
    if (!e.target.matches('.ideas-search')) return;
    e.preventDefault();
    const input = e.target.querySelector('input'), query = input.value.trim().replace(/\s+/g, ' ');
    if (query) { input.blur(); browse('search:' + query, query); }
  });

  // Tapping a pin: a small sheet with Save, Open in Pinterest and Not for me.
  let open = null;
  function sheetHTML(id) {
    const p = pinById(id);
    if (!p) return null;
    open = p;
    const where = boardName() || 'your notebook';
    return `<div class="idea-sheet-header"><span class="lbl">From Pinterest</span><button type="button" class="btn" data-a="closeForm">Done</button></div><div class="ideasheet"><img src="${FEED}${esc(p.sig)}.jpg" alt="${esc(p.title || 'Pinterest idea')}" style="aspect-ratio:${+p.w || 4} / ${+p.h || 5}"><div class="ideat">${esc(p.title || 'Untitled pin')}</div></div>
      ${p.saved ? '<button type="button" class="btn" disabled>Saved</button>' : saving.has(p.url) ? `<button type="button" class="btn" disabled data-nb-orb="working" data-nb-since="${saving.get(p.url)}" aria-busy="true">Saving…</button>` : `<button type="button" class="btn white" data-a="ideaSave">Save to ${esc(where)}</button>`}
      <button type="button" class="btn" data-a="ideaRelated">More like this</button>
      <div class="formrow"><button type="button" class="btn" data-a="ideaHide">Not for me</button><button type="button" class="btn" data-a="ideaOpen">Open in Pinterest</button></div>`;
  }
  // A save starting or finishing changes only that pin's cards, in place: the feed is never redrawn for it (a redraw
  // could bring back a card a picture is flying into).
  function paintSaved(url) {
    for (const p of new Set(Object.values(data.feeds).flatMap((f) => (f.pins || []).filter((x) => x.url === url)))) {
      document.querySelectorAll(`.card.idea[data-v="${CSS.escape(p.id)}"]`).forEach((c) => {
        const media = c.querySelector('.media');
        media.querySelectorAll('.ideatick, .idea-saving').forEach((n) => n.remove());
        media.insertAdjacentHTML('beforeend', p.saved ? TICK : saving.has(p.url) ? `<span class="idea-saving" data-nb-orb="working" data-nb-since="${saving.get(p.url)}" aria-busy="true">Saving…</span>` : '');
        c.classList.toggle('saved', !!p.saved);
        c.setAttribute('aria-label', `${p.title || 'Idea'}${p.saved ? ', saved' : ''}`);
      });
    }
  }
  function save(boardId) {
    if (!open || open.saved || saving.has(open.url)) return;
    saving.set(open.url, Date.now());
    N.feedSave(open.url, boardId || '');
    paintSaved(open.url);
  }
  window.nbOnIdeaSaved = (json) => {
    const result = JSON.parse(json);
    if (!saving.has(result.url)) return; // (an answer already had)
    saving.delete(result.url);
    if (result.ok) for (const f of Object.values(data.feeds).concat(Object.values(staged))) for (const p of f.pins || []) if (p.url === result.url) p.saved = true;
    if (!result.ok) toast(result.message || 'Couldn’t save this idea. Try again.');
    paintSaved(result.url);
    saved();
  };
  function hide(from) {
    if (!open) return;
    const id = open.id;
    N.feedHide(id);
    for (const f of Object.values(data.feeds)) f.pins = (f.pins || []).filter((p) => p.id !== id);
    toast('Idea hidden', null, null, from);
    const cards = () => [...document.querySelectorAll('.ideacols .card.idea')].filter((c) => c.getClientRects().length);
    const was = new Map(cards().map((c) => [c.dataset.v, c.getBoundingClientRect()]));
    const leaving = document.querySelector(`.ideacols .card.idea[data-v="${CSS.escape(id)}"]`);
    const r = leaving && leaving.getBoundingClientRect(), host = leaving && leaving.closest('.screen');
    const picture = r && host && r.width ? leaving.cloneNode(true) : null;
    rerender();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (picture) {
      const hr = host.getBoundingClientRect();
      picture.removeAttribute('data-a'); picture.inert = true; picture.setAttribute('aria-hidden', 'true');
      Object.assign(picture.style, { position: 'absolute', margin: '0', pointerEvents: 'none', zIndex: '-1', left: (r.left - hr.left) + 'px', top: (r.top - hr.top + host.scrollTop) + 'px', width: r.width + 'px', height: r.height + 'px' });
      host.appendChild(picture);
      picture.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.82)' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).onfinish = () => picture.remove();
    }
    for (const c of cards()) {
      const a = was.get(c.dataset.v), b = c.getBoundingClientRect();
      if (a && Math.abs(a.left - b.left) + Math.abs(a.top - b.top) > 1) c.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px)` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
  // A picture that can't be had (away from home and not kept yet): that pin is left out.
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest || !img.closest('.card.idea .media')) return;
    const sig = (img.getAttribute('src') || '').split('/').pop().replace(/\.[a-z]+$/, '');
    if (sig) loaded.add(sig);
    img.classList.add('ready');
  }, true);
  document.addEventListener('error', (e) => { const media = e.target.closest && e.target.closest('.card.idea .media'); if (media && e.target.tagName === 'IMG') media.classList.add('failed'); }, true);
  const openPin = () => { if (open) N.openPin(open.url); };
  const now = () => { const key = currentKey(); if (pending.has(key) || more === key) return; delete staged[key]; askedFor[key] = Date.now(); ask(key); N.feedReload(key); if (pins(key).length) markPending(); else rerender(); };
  const related = () => { if (open) browse('pin:' + open.id, 'More like ' + (open.title || 'this pin')); };

  const select = (id) => { const p = pinById(id); if (p) open = p; return p; };
  const isSaving = (u) => saving.get(u) || 0;
  return { gridHTML, look, sheetHTML, select, isSaving, boardName, save, hide, openPin, now, related, back };
};
