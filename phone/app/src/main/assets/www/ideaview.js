// A Pinterest idea, full screen: the picture grows out of the pin that was tapped to fill the screen (whole, never
// cropped), the grain darkens behind it, and a few actions sit under it: Save (the main one), More like this and
// Not for me side by side, and Open in Pinterest up by Back. Drag the picture down and it follows the finger and
// shrinks; let go far or fast enough and it flies back into its pin, otherwise it settles. Back does the same.
window.NBIdeaView = (ctx) => {
  const { $, esc, I, tick, updateChrome } = ctx;
  const tokens = getComputedStyle(document.documentElement);
  const EASE = tokens.getPropertyValue('--ease').trim(), DUR = parseFloat(tokens.getPropertyValue('--t-screen')) || 380;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FEED = window.NB_FEED ?? '/feed/';
  const icon = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  let el = null, pin = null, busy = false, turn = 0;
  const R = parseFloat(tokens.getPropertyValue('--r-card')) || 20;
  // While the picture is out, its pin's card shows nothing in its place (one picture on screen, never two). Kept by
  // the pin's id in a style rule rather than on one element, so a card drawn again meanwhile (a save finishing, more
  // pins arriving) is born hidden too. Its space stays; it shows again in the same frame the picture is removed.
  const veil = document.head.appendChild(document.createElement('style'));
  const own = (id) => { veil.textContent = id ? `.card.idea[data-v="${CSS.escape(id)}"] .media { visibility: hidden; }` : ''; };
  // The picture's pose right now (mid-animation included), so whatever comes next starts from what is on screen.
  const pose = (img) => { const m = getComputedStyle(img).transform; return m && m !== 'none' ? m : 'none'; };
  // Corners the size of the card's, whatever the scale the picture is drawn at.
  const corners = (sx, sy) => `${(R / sx).toFixed(2)}px / ${(R / sy).toFixed(2)}px`;

  const cardMedia = () => (pin && document.querySelector(`.grid:not(.peek) .card.idea[data-v="${CSS.escape(pin.id)}"] .media`)) || null;
  const onScreen = (r) => r && r.width && r.bottom > 0 && r.top < innerHeight;
  // Where the picture rests: as large as it fits between the top bar and the actions, its own shape.
  function fitted() {
    const sb = parseFloat(tokens.getPropertyValue('--sb')) || 0, st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
    const acts = el.querySelector('.iv-actions').getBoundingClientRect().height;
    const top = st + 72, bottom = innerHeight - acts - sb - 34, w = innerWidth - 24, h = Math.max(120, bottom - top);
    const ar = (+pin.w || 4) / (+pin.h || 5), fw = Math.min(w, h * ar), fh = fw / ar;
    return { x: (innerWidth - fw) / 2, y: top + (h - fh) / 2, w: fw, h: fh };
  }
  const place = (img, r) => Object.assign(img.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  // The transform that draws the resting picture over rectangle `r`.
  const over = (to, r) => `translate(${(r.left + r.width / 2 - (to.x + to.w / 2)).toFixed(1)}px,${(r.top + r.height / 2 - (to.y + to.h / 2)).toFixed(1)}px) scale(${(r.width / to.w).toFixed(4)},${(r.height / to.h).toFixed(4)})`;
  const overCorners = (to, r) => corners(r.width / to.w, r.height / to.h);

  function actionsHTML() {
    const p = pin, where = I.boardName() || 'your notebook';
    const save = p.saved ? `<button type="button" class="btn iv-save" disabled>${icon('M20 6L9 17l-5-5', 18)}<span>Saved</span></button>`
      : I.isSaving(p.url) ? `<button type="button" class="btn iv-save" disabled data-nb-orb="working" data-nb-since="${I.isSaving(p.url)}" aria-busy="true"><span>Saving…</span></button>`
        : `<button type="button" class="btn white iv-save" data-a="ideaSave"><span>Save to ${esc(where)}</span></button>`;
    return `${p.title ? `<p class="iv-title">${esc(p.title)}</p>` : ''}${save}<div class="iv-row"><button type="button" class="btn" data-a="ideaRelated">${icon('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7', 18)}<span>More like this</span></button><button type="button" class="btn" data-a="ideaHide">${icon('M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.7-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2', 18)}<span>Not for me</span></button></div>`;
  }

  function open(id) {
    if (busy) return;
    pin = I.select(id);
    if (!pin) return;
    el = document.createElement('div');
    el.className = 'ideaview'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', pin.title || 'Pinterest idea');
    el.innerHTML = `<div class="iv-scrim"></div>
      <div class="iv-top"><button type="button" class="iconbtn" data-a="ideaClose" aria-label="Back">${icon('M15 18l-6-6 6-6')}</button><span class="lbl">From Pinterest</span><button type="button" class="iconbtn" data-a="ideaOpen" aria-label="Open in Pinterest">${icon('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', 18)}</button></div>
      <img class="iv-img" src="${FEED}${esc(pin.sig)}.jpg" alt="${esc(pin.title || 'Pinterest idea')}" decoding="sync">
      <div class="iv-actions">${actionsHTML()}</div>`;
    $('#stage').after(el);
    turn++;
    ctx.S.ideaView = true; updateChrome();
    const img = el.querySelector('.iv-img'), rest = fitted();
    place(img, rest);
    wire(img);
    tick();
    const m = cardMedia(), r = m && m.getBoundingClientRect();
    own(pin.id);
    if (calm()) return;
    const o = { duration: DUR, easing: EASE };
    el.querySelector('.iv-scrim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR * 0.7, easing: EASE });
    [el.querySelector('.iv-top'), el.querySelector('.iv-actions')].forEach((n) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { ...o, delay: DUR * 0.3, fill: 'backwards' }));
    if (onScreen(r)) img.animate([{ transform: over(rest, r), borderRadius: overCorners(rest, r) }, { transform: 'none', borderRadius: `${R}px` }], o);
    else img.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], o);
  }

  // Back into its pin (or away, when the pin is gone or off screen). `then` runs once it has gone.
  // The + comes back with the same motion (it rises as the picture flies home) but can't be pressed until the
  // picture has gone.
  function close(then, how = 'back') {
    if (!el || busy) { if (then) then(); return; }
    busy = true;
    const t = ++turn;
    const node = el, img = node.querySelector('.iv-img'), rest = { x: parseFloat(img.style.left), y: parseFloat(img.style.top), w: parseFloat(img.style.width), h: parseFloat(img.style.height) };
    const scrim = node.querySelector('.iv-scrim'), dim = getComputedStyle(scrim).opacity;
    const from = pose(img), radius = getComputedStyle(img).borderRadius; // (from wherever it is: dragged, or still opening)
    img.getAnimations().forEach((a) => a.cancel());
    node.style.pointerEvents = 'none';
    ctx.S.ideaLeaving = true; updateChrome();
    const orb = $('#orb'); if (orb) orb.inert = true;
    let ended = false;
    const done = () => {
      if (ended || t !== turn) return; // (once, and only for this close)
      ended = true;
      own(null); node.remove(); if (el === node) el = null; busy = false;
      ctx.S.ideaView = false; ctx.S.ideaLeaving = false; updateChrome();
      if (orb && !orb.hidden) orb.inert = false;
      if (then) then();
    };
    if (calm()) { done(); return; }
    const o = { duration: DUR, easing: EASE, fill: 'forwards' };
    scrim.animate([{ opacity: dim }, { opacity: 0 }], o);
    [node.querySelector('.iv-top'), node.querySelector('.iv-actions')].forEach((n) => n.animate([{ opacity: getComputedStyle(n).opacity }, { opacity: 0 }], { duration: 160, fill: 'forwards' }));
    // Measured now (the list may have scrolled or changed since it opened), in the same screen coordinates.
    const m = how === 'back' ? cardMedia() : null, r = m && m.getBoundingClientRect();
    let a;
    if (onScreen(r)) a = img.animate([{ transform: from, borderRadius: radius }, { transform: over(rest, r), borderRadius: overCorners(rest, r) }], o);
    else a = img.animate([{ transform: from, opacity: 1 }, { transform: `${from === 'none' ? '' : from} scale(.8)`, opacity: 0 }], o); // no card to go to: it simply goes
    a.onfinish = done; a.oncancel = done;
  }

  // Drag the picture down: it follows the finger, shrinking a little, and the dark lifts with it.
  function wire(img) {
    let y0 = null, x0 = 0, dy = 0, dx = 0, t0 = 0, base = '';
    const scrim = el.querySelector('.iv-scrim'), chrome = [el.querySelector('.iv-top'), el.querySelector('.iv-actions')];
    const paint = () => {
      const k = Math.max(0, dy), s = 1 - Math.min(0.35, k / 1400);
      img.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) ${base} scale(${s.toFixed(4)})`;
      scrim.style.opacity = String(Math.max(0.15, 1 - k / 420));
      chrome.forEach((n) => { n.style.opacity = String(Math.max(0, 1 - k / 160)); });
    };
    img.addEventListener('pointerdown', (e) => { if (busy) return; y0 = e.clientY; x0 = e.clientX; t0 = e.timeStamp; dy = dx = 0; img.setPointerCapture(e.pointerId); base = img.getAnimations().length ? pose(img).replace('none', '') : ''; img.getAnimations().forEach((a) => a.cancel()); }); // (caught while opening: held where it is)
    img.addEventListener('pointermove', (e) => { if (y0 === null) return; dy = e.clientY - y0; dx = (e.clientX - x0) * 0.6; if (dy < 0) dy *= 0.25; paint(); });
    const end = (e) => {
      if (y0 === null) return;
      const v = dy / Math.max(1, e.timeStamp - t0);
      y0 = null;
      if (dy > 110 || (dy > 30 && v > 0.6)) { close(); return; }
      const from = img.style.transform;
      base = '';
      img.style.transform = ''; scrim.style.opacity = ''; chrome.forEach((n) => { n.style.opacity = ''; });
      if (!calm() && from) img.animate([{ transform: from }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.34,1.3,.5,1)' });
    };
    img.addEventListener('pointerup', end); img.addEventListener('pointercancel', end);
  }

  // The actions under the picture change in place (Saving…, Saved).
  const refresh = () => { if (!el || !pin) return; pin = I.select(pin.id) || pin; el.querySelector('.iv-actions').innerHTML = actionsHTML(); };
  return { open, close, refresh, isOpen: () => !!el && !busy, current: () => pin };
};
