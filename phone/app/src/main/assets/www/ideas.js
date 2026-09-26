// Native Pinterest discovery, with cached ideas available offline. The WebView stays local.
window.NBIdeas = function NBIdeas({ N, S, $, esc, toast, boardName, rerender, reveal }) {
  const FEED = window.NB_FEED ?? '/feed/';
  const read = () => { try { const d = JSON.parse(N.feed()); return d && d.feeds ? d : { feeds: {} }; } catch (e) { return { feeds: {} }; } };
  let data = read();
  const askedFor = {};
  const pending = new Set(), saving = new Set(), journeys = new Map();
  const baseKey = () => S.screen === 'board' ? S.board : 'all';
  const journey = (base = baseKey()) => {
    if (!journeys.has(base)) journeys.set(base, { trail: [{ key: base, title: '', top: 0 }], draft: '' });
    return journeys.get(base);
  };
  const currentKey = () => journey().trail.at(-1).key;
  const scrollBox = () => S.screen === 'board' ? $('#boardgrid')?.closest('.screen') : $('#lift');
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
    if (pending.has(key) || Date.now() - (askedFor[key] || 0) < 60000) return;
    const at = Number((data.feeds[key] || {}).at) || Date.parse(data.fetchedAt || '') || 0;
    if (!empty && Date.now() - at < 30 * 60000) return;
    askedFor[key] = Date.now(); pending.add(key);
    N.feedRefresh(key);
  }
  window.nbOnFeed = (json) => {
    const d = JSON.parse(json);
    const key = d.key, was = key && more === key ? more : null;
    if (key) pending.delete(key);
    if (was) more = null;
    const before = was ? pins(was).length : 0;
    data = { ...data, ...d, feeds: { ...data.feeds, ...d.feeds } };
    if (d.error) {
      if (key) data.feeds[key] = { ...data.feeds[key], error: d.error };
      toast(d.error); if (was) moreAt = Date.now(); rerender(); return;
    }
    if (was && (data.feeds[was]?.error || pins(was).length <= before)) moreAt = Date.now();
    if (!(was && append(was))) rerender();
  };

  // The next page, asked for while a few screens of pins are still below (once at a time; after a
  // failure, not again for half a minute). New pins join the bottom of the columns; nothing moves.
  let more = null, moreAt = 0;
  function ahead() {
    for (const cols of document.querySelectorAll('.ideacols')) {
      const box = cols.closest('.lift') || cols.closest('.screen');
      if (!box || !box.isConnected || box.closest('[hidden]')) continue;
      const key = cols.dataset.key, f = data.feeds[key];
      if (!f || !f.more || f.error || more || pending.has(key) || Date.now() - moreAt < 30000) continue;
      if (box.scrollHeight - box.scrollTop - box.clientHeight > box.clientHeight * 2.5) continue;
      more = key; moreAt = 0;
      markMore();
      N.feedMore(key);
    }
  }
  let frame = 0;
  document.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; ahead(); }); }, { capture: true, passive: true });
  function markMore() {
    document.querySelectorAll('.ideas-more').forEach((el) => { el.textContent = more && el.dataset.key === more ? 'Finding more…' : ''; });
    document.querySelectorAll('[data-a="ideasNow"]').forEach((button) => { button.disabled = pending.has(currentKey()) || more === currentKey(); });
  }

  // Two columns, each pin into the shorter one (by its shape), so the layout is the same however it's built.
  function deal(list, onto) {
    const hgt = [0, 0], out = [[], []];
    list.forEach((p, i) => { const c = hgt[0] <= hgt[1] ? 0 : 1; hgt[c] += (+p.h || 5) / (+p.w || 4) + 0.1; if (i >= onto) out[c].push(card(p, i - onto)); });
    return out;
  }
  function append(key) {
    const cols = [...document.querySelectorAll('.ideacols')].find((c) => c.dataset.key === key);
    if (!cols) return false;
    const list = pins(key), have = [...cols.querySelectorAll('.card.idea')].map((c) => c.dataset.v);
    if (!have.length || list.length < have.length || have.some((id) => !list.slice(0, have.length).some((p) => p.id === id))) return false;
    const add = deal(list, have.length), col = cols.querySelectorAll('.ideacol');
    add.forEach((cards, i) => col[i].insertAdjacentHTML('beforeend', cards.join('')));
    markMore();
    requestAnimationFrame(ahead);
    return true;
  }

  const PLAY = '<span class="badge" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg></span>';
  const TICK = '<span class="ideatick" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>';
  function card(p, n) {
    return `<button type="button" class="card idea${p.saved ? ' saved' : ''}" data-a="idea" data-v="${esc(p.id)}" style="--d:${Math.min(n * 40, 400)}ms" aria-label="${esc(p.title || 'Idea')}${p.saved ? ', saved' : ''}">
      <div class="media"><img src="${FEED}${esc(p.sig)}.jpg" alt="" loading="lazy" decoding="async" style="aspect-ratio:${+p.w || 4} / ${+p.h || 5}">${p.video ? PLAY : ''}${p.saved ? TICK : saving.has(p.url) ? '<span class="idea-saving">Saving…</span>' : ''}</div></button>`;
  }

  function gridHTML(base) {
    const j = journey(base), entry = j.trail.at(-1), key = entry.key;
    const list = pins(key), err = (data.feeds[key] || {}).error;
    freshen(key, !list.length);
    requestAnimationFrame(ahead);
    const tools = `<div class="ideas-tools"><form class="ideas-search" data-base="${esc(base)}"><input type="search" class="field idea-query" aria-label="Search Pinterest ideas" placeholder="Search Pinterest ideas" maxlength="120" value="${esc(j.draft)}" enterkeyhint="search"><button type="submit" class="btn">Search</button></form><div class="ideas-controls">${j.trail.length > 1 ? '<button type="button" class="btn" data-a="ideasBack">Back to ideas</button>' : ''}<button type="button" class="btn" data-a="ideasNow" ${pending.has(key) ? 'disabled' : ''}>${pending.has(key) ? 'Finding ideas…' : 'New ideas'}</button></div>${entry.title ? `<p class="ideas-heading">${esc(entry.title)}</p>` : ''}</div>`;
    if (list.length) {
      const note = err ? `<p class="ideanote">No new ideas just now. ${esc(err)}</p>` : '';
      return `${tools}${note}<div class="ideacols" data-key="${esc(key)}">${deal(list, 0).map((c) => `<div class="ideacol">${c.join('')}</div>`).join('')}</div><p class="ideas-more" data-key="${esc(key)}" aria-live="polite">${more === key ? 'Finding more…' : ''}</p>`;
    }
    return `${tools}<p class="empty" aria-live="polite">${esc(err || (pending.has(key) ? 'Finding ideas…' : 'No ideas here yet. Try another search or get new ideas.'))}</p>`;
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
      ${p.saved ? '<button type="button" class="btn" disabled>Saved</button>' : saving.has(p.url) ? '<button type="button" class="btn" disabled>Saving…</button>' : `<button type="button" class="btn white" data-a="ideaSave">Save to ${esc(where)}</button>`}
      <button type="button" class="btn" data-a="ideaRelated">More like this</button>
      <div class="formrow"><button type="button" class="btn" data-a="ideaHide">Not for me</button><button type="button" class="btn" data-a="ideaOpen">Open in Pinterest</button></div>`;
  }
  function save(boardId) {
    if (!open || open.saved || saving.has(open.url)) return;
    saving.add(open.url);
    N.feedSave(open.url, boardId || '');
    rerender();
  }
  window.nbOnIdeaSaved = (json) => {
    const result = JSON.parse(json);
    saving.delete(result.url);
    if (result.ok) for (const f of Object.values(data.feeds)) for (const p of f.pins || []) if (p.url === result.url) p.saved = true;
    if (!result.ok) toast(result.message || 'Couldn’t save this idea. Try again.');
    rerender();
  };
  function hide() {
    if (!open) return;
    const id = open.id;
    N.feedHide(id);
    for (const f of Object.values(data.feeds)) f.pins = (f.pins || []).filter((p) => p.id !== id);
    const el = document.querySelector(`.card.idea[data-v="${CSS.escape(id)}"]`);
    if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = rerender;
    else rerender();
    toast('Idea hidden');
  }
  // A picture that can't be had (away from home and not kept yet): that pin is left out.
  document.addEventListener('error', (e) => { const c = e.target.closest && e.target.closest('.card.idea'); if (c && e.target.tagName === 'IMG') c.remove(); }, true);
  const openPin = () => { if (open) N.openPin(open.url); };
  const now = () => { const key = currentKey(); if (pending.has(key) || more === key) return; askedFor[key] = Date.now(); pending.add(key); N.feedReload(key); rerender(); };
  const related = () => { if (open) browse('pin:' + open.id, 'More like ' + (open.title || 'this pin')); };

  return { gridHTML, sheetHTML, save, hide, openPin, now, related, back };
};
