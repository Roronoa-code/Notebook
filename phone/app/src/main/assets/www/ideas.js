// Ideas on the phone: "For you" on Home and "Ideas" on each board. The PC picks the pins (from Pinterest,
// ranked against your boards) and sends them with each sync; their pictures come from the PC and are kept
// on the phone. Tap a pin for Save, Open in Pinterest or Not for me.
window.NBIdeas = function NBIdeas({ N, S, $, esc, toast, paired, boardName, rerender }) {
  const FEED = window.NB_FEED ?? '/feed/';
  const read = () => { try { const d = JSON.parse(N.feed()); return d && d.feeds ? d : { feeds: {} }; } catch (e) { return { feeds: {} }; } };
  let data = read(), asked = 0, wanted = false;
  const askedFor = {};
  const pins = (key) => ((data.feeds[key] || {}).pins || []);
  const pinById = (id) => { for (const f of Object.values(data.feeds)) { const p = (f.pins || []).find((x) => x.id === id); if (p) return p; } return null; };

  // Older than half an hour (or never fetched): ask the PC for the latest, quietly.
  function freshen(key, empty) {
    if (!paired()) return;
    // A board with no ideas yet: ask the PC to make them now (once a minute at most).
    if (empty && key !== 'all' && Date.now() - (askedFor[key] || 0) > 60000) { askedFor[key] = Date.now(); N.feedRefresh(key); return; }
    if (Date.now() - asked < 60000) return;
    const at = Date.parse(data.fetchedAt || '') || 0;
    if (Date.now() - at < 30 * 60000) return;
    asked = Date.now();
    N.feedRefresh('');
  }
  window.nbOnFeed = (json) => {
    const d = JSON.parse(json);
    const was = more;
    more = null;
    if (d.error) { if (wanted) toast(d.error); wanted = false; if (was) { moreAt = Date.now(); markMore(); } return; }
    wanted = false;
    data = d.feeds ? d : { feeds: {} };
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
      if (!f || !f.more || more || !paired() || Date.now() - moreAt < 30000) continue;
      if (box.scrollHeight - box.scrollTop - box.clientHeight > box.clientHeight * 2.5) continue;
      more = key; moreAt = 0;
      markMore();
      N.feedMore(key);
    }
  }
  let frame = 0;
  document.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; ahead(); }); }, { capture: true, passive: true });
  function markMore() { document.querySelectorAll('.ideas-more').forEach((el) => { el.textContent = more && el.dataset.key === more ? 'Finding more…' : ''; }); }

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
      <div class="media"><img src="${FEED}${esc(p.sig)}.jpg" alt="" loading="lazy" decoding="async" style="aspect-ratio:${+p.w || 4} / ${+p.h || 5}">${p.video ? PLAY : ''}${p.saved ? TICK : ''}</div></button>`;
  }

  // The grid's contents for a feed ('all' or a board id).
  function gridHTML(key) {
    const list = pins(key), err = (data.feeds[key] || {}).error;
    freshen(key, !list.length);
    requestAnimationFrame(ahead);
    if (list.length) {
      const note = err ? `<p class="ideanote">No new ideas just now. ${esc(err)}</p>` : '';
      return `${note}<div class="ideacols" data-key="${esc(key)}">${deal(list, 0).map((c) => `<div class="ideacol">${c.join('')}</div>`).join('')}</div><p class="ideas-more" data-key="${esc(key)}" aria-live="polite">${more === key ? 'Finding more…' : ''}</p>`;
    }
    if (err) return `<p class="empty">Couldn’t get ideas. ${esc(err)}${paired() ? '<br><button type="button" class="btn" data-a="ideasNow" style="margin-top:14px">Try again</button>' : ''}</p>`;
    const why = !paired() ? 'Pair with your PC and ideas from Pinterest arrive here, picked to match your boards.'
      : key === 'all' ? 'No ideas yet. They come from Notebook on your PC with the next sync.' : 'No ideas for this board yet. Open it on your PC, or sync again in a bit.';
    return `<p class="empty">${why}${paired() ? '<br><button type="button" class="btn" data-a="ideasNow" style="margin-top:14px">Get ideas now</button>' : ''}</p>`;
  }

  // Tapping a pin: a small sheet with Save, Open in Pinterest and Not for me.
  let open = null;
  function sheetHTML(id) {
    const p = pinById(id);
    if (!p) return null;
    open = p;
    const where = boardName() || 'your notebook';
    return `<div class="ideasheet"><img src="${FEED}${esc(p.sig)}.jpg" alt="" style="aspect-ratio:${+p.w || 4} / ${+p.h || 5}"><div style="min-width:0"><span class="lbl">From Pinterest</span><div class="ideat">${esc(p.title || 'Untitled pin')}</div></div></div>
      ${p.saved ? '<button type="button" class="btn" disabled>Saved</button>' : `<button type="button" class="btn white" data-a="ideaSave">Save to ${esc(where)}</button>`}
      <div class="formrow"><button type="button" class="btn" data-a="ideaHide">Not for me</button><button type="button" class="btn" data-a="ideaOpen">Open in Pinterest</button></div>`;
  }
  function save(boardId) {
    if (!open) return;
    N.feedSave(open.url, boardId || '');
    for (const f of Object.values(data.feeds)) for (const p of f.pins || []) if (p.url === open.url) p.saved = true;
    rerender();
  }
  function hide() {
    if (!open) return;
    const id = open.id;
    N.feedHide(id);
    for (const f of Object.values(data.feeds)) f.pins = (f.pins || []).filter((p) => p.id !== id);
    const el = document.querySelector(`.card.idea[data-v="${CSS.escape(id)}"]`);
    if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = rerender;
    else rerender();
    toast('Fewer like that from now on');
  }
  // A picture that can't be had (away from home and not kept yet): that pin is left out.
  document.addEventListener('error', (e) => { const c = e.target.closest && e.target.closest('.card.idea'); if (c && e.target.tagName === 'IMG') c.remove(); }, true);
  const openPin = () => { if (open) N.openPin(open.url); };
  const now = () => { if (!paired()) return; wanted = true; asked = Date.now(); toast('Asking your PC for ideas…'); N.feedRefresh(S.screen === 'board' ? S.board : ''); };

  return { gridHTML, sheetHTML, save, hide, openPin, now };
};
