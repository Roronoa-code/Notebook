// Tabs as one strip under your thumb (Home: Recent / Notes / For you, a board: Saved / Ideas).
// The pane follows the finger one to one from the first move (the panes either side are made ready beforehand, with
// their pictures decoded, so nothing has to be built mid-swipe), the next one slides in beside it, and letting go
// carries on with your speed on a spring: far or fast enough commits, otherwise it goes back.
// The labels' brightness, the tab line and the sort button all come from the one position, so there is only ever
// one current tab and they never disagree. A new touch or tap mid-flight carries on from where the strip is.
// A swipe that begins on a stack (which flicks through its own pictures), the rail or a field is left alone.
window.NBPager = (ctx) => {
  const { S, tick } = ctx;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The tab line is liquid (libraries.dev Gooey, Move, ported without React; approved): its front edge is exactly at
  // the tab position (--i), its back edge and a small droplet follow a little behind, in one goo layer, so it
  // stretches slightly while it travels and settles as one crisp line. The stretch is kept small.
  function liquidLine(tabs) {
    const goo = document.createElement('span');
    goo.className = 'tabgoo'; goo.setAttribute('aria-hidden', 'true');
    goo.innerHTML = '<i class="tl"></i><i class="td"></i>';
    tabs.appendChild(goo);
    const line = goo.firstChild, drop = goo.lastChild, HALF = 21, STRETCH = 10, TRAIL = 8;
    const s = { h: 0, t: 0, d: 0, vt: 0, vd: 0 };
    let raf = 0, last = 0, ready = false;
    const target = () => { const b = tabs.querySelector('button'), w = b ? b.offsetWidth : 78, i = parseFloat(tabs.style.getPropertyValue('--i')) || 0; return (i + 0.5) * w; };
    const paint = () => {
      const l = Math.min(s.h, s.t) - HALF, w = Math.abs(s.h - s.t) + HALF * 2;
      line.style.transform = `translateX(${l.toFixed(1)}px)`; line.style.width = w.toFixed(1) + 'px';
      drop.style.transform = `translateX(${(s.d - 3.5).toFixed(1)}px)`;
      drop.style.opacity = Math.min(1, Math.abs(s.d - s.h) / 12).toFixed(2); // only a droplet while it trails
    };
    const step = (now) => {
      const dt = Math.max(0, Math.min(0.032, (now - last) / 1000)); last = now;
      const x = target();
      s.h = x; // exactly where the strip is
      const spring = (p, v, k, c, max) => { s[v] += (-k * (s[p] - x) - c * s[v]) * dt; s[p] += s[v] * dt; if (Math.abs(s[p] - x) > max) { s[p] = x + Math.sign(s[p] - x) * max; s[v] = 0; } };
      spring('t', 'vt', 900, 60, STRETCH); spring('d', 'vd', 500, 45, TRAIL);
      paint();
      const still = Math.abs(s.t - x) < 0.3 && Math.abs(s.d - x) < 0.3 && Math.abs(s.vt) + Math.abs(s.vd) < 6;
      if (still) { s.t = s.d = x; s.vt = s.vd = 0; paint(); raf = 0; goo.classList.remove('moving'); } else raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!ready || reduced()) { ready = tabs.isConnected && !!tabs.offsetWidth; s.h = s.t = s.d = target(); paint(); return; }
      if (!raf) { last = performance.now(); goo.classList.add('moving'); raf = requestAnimationFrame(step); }
    };
    requestAnimationFrame(kick);
    return { kick };
  }

  // cfg: { pager, grid, tabs (selectors), order: [tab...], get(), html(tab), commit(tab, nodes), sort }
  function wire(root, cfg) {
    const pager = root.querySelector(cfg.pager), grid = root.querySelector(cfg.grid), tabs = root.querySelector(cfg.tabs);
    const lineFx = liquidLine(tabs);
    // The first tab's word lines up with the page's left edge (the buttons are wider than their words).
    const align = () => { const b = tabs.querySelector('button'), r = document.createRange(); if (!b) return; r.selectNodeContents(b); const w = r.getBoundingClientRect().width; if (w) tabs.style.marginLeft = (-(b.clientWidth - w) / 2).toFixed(1) + 'px'; };
    align(); document.fonts?.ready.then(align);
    const W = () => pager.clientWidth || innerWidth;
    const idx = () => cfg.order.indexOf(cfg.get());
    let peek = null, peekTab = null, span = 0, dx = 0, stopSpring = null, x0 = 0, y0 = 0, base = 0, axis = 'no', samples = [], live = false, lag = 0, lagAt = 0;
    let trip = null; // a tapped journey: the line goes from where it was to its tab as the pane travels
    const ready = new Map(); // the panes either side, made ready while nothing is moving

    // Label brightness, the line, the sort button and accessibility all come from the same fractional position.
    // Sort belongs to the saved tabs, not Ideas (the last tab): it fades as the strip moves towards Ideas.
    const sort = cfg.sort && root.querySelector(cfg.sort), last = cfg.order.length - 1;
    // A tapped journey past a tab in between (Recent to For you) lights only the two ends: the one it leaves dims as
    // the one it goes to brightens; the tab it passes over never lights up.
    const mark = (pos) => {
      const near = trip ? trip.to : Math.round(pos);
      const p = trip && trip.to !== trip.from ? Math.max(0, Math.min(1, (pos - trip.from) / (trip.to - trip.from))) : 0;
      [...tabs.querySelectorAll('button')].forEach((b, k) => {
        const on = k === near;
        b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
        const lit = trip ? (k === trip.to ? p : k === Math.round(trip.from) ? 1 - p : 0) : Math.max(0, 1 - Math.abs(pos - k));
        b.style.setProperty('--on', lit.toFixed(3));
      });
      if (sort) {
        const v = Math.max(0, Math.min(1, last - pos)), e = v * v * (3 - 2 * v);
        sort.style.opacity = e < 1 ? e.toFixed(3) : '';
        sort.style.visibility = e <= 0.001 ? 'hidden' : '';
        sort.inert = e < 0.5; sort.setAttribute('aria-hidden', String(e < 0.5));
      }
    };
    const paint = (x) => {
      dx = x;
      grid.style.transform = x ? `translate3d(${x.toFixed(1)}px,0,0)` : '';
      if (peek) peek.style.transform = `translate3d(${(x + Math.sign(span) * W()).toFixed(1)}px,0,0)`;
      const pos = trip ? trip.from + (trip.to - trip.from) * Math.max(0, Math.min(1, (x - trip.x0) / (trip.x1 - trip.x0 || 1))) : Math.max(0, Math.min(cfg.order.length - 1, idx() - x / W())); // one pane width is one tab
      tabs.style.setProperty('--i', pos.toFixed(3));
      mark(pos);
      lineFx.kick();
    };
    // A pane for `tab`, beside the screen: its pictures load and decode now, so it never shows empty slots when it
    // slides in. It is laid out exactly as it will be once it lands (the pager clips it, so it never lengthens the
    // page): the cards that slide in are the cards that stay.
    const make = (tab) => {
      const el = document.createElement('div');
      el.className = 'grid peek' + (tab === 'notes' ? ' notes' : '');
      el.setAttribute('aria-hidden', 'true');
      el.dataset.tab = tab;
      fill(el, tab);
      el.style.visibility = 'hidden';
      pager.appendChild(el);
      return el;
    };
    const fill = (el, tab) => {
      el.innerHTML = cfg.html(tab, true).replace(/loading="lazy"/g, 'loading="eager"').replace(/decoding="sync"/g, 'decoding="async"');
      [...el.querySelectorAll('img')].slice(0, 10).forEach((img) => { if (img.decode) img.decode().catch(() => {}); });
    };
    const park = (el) => { el.classList.add('parked'); el.style.visibility = 'hidden'; el.style.transform = ''; el.style.height = '0px'; ready.set(el.dataset.tab, el); };
    // Make the neighbours ready (and drop any that no longer are), once the strip is at rest.
    let prepTimer = 0;
    const prepare = () => {
      clearTimeout(prepTimer);
      prepTimer = setTimeout(() => {
        if (live || !root.isConnected) return;
        const i = idx(), want = [cfg.order[i - 1], cfg.order[i + 1]].filter(Boolean);
        for (const [t, el] of ready) if (!want.includes(t)) { el.remove(); ready.delete(t); }
        for (const t of want) if (!ready.has(t)) park(make(t));
      }, 120);
    };
    const mount = (tab) => {
      if (peek) park(peek);
      peek = ready.get(tab) || make(tab);
      ready.delete(tab);
      peek.style.height = '';
      peekTab = tab;
      if (cfg.shown && cfg.shown(tab)) fill(peek, tab); // coming into view started something (Ideas asked for): it says so
      peek.classList.remove('parked'); peek.style.visibility = '';
      span = cfg.order.indexOf(tab) - idx();
    };
    const clear = () => { trip = null; if (peek) park(peek); peek = null; peekTab = null; span = 0; paint(0); tabs.classList.remove('drag'); grid.style.transform = ''; live = false; prepare(); };
    // Lands on `tab`: its pane becomes the grid. `offset` keeps it where it is on screen (a mid-flight rebase). The
    // pane that was showing becomes the ready neighbour for going back.
    const land = (tab, offset = 0) => {
      const was = cfg.get(), nodes = peek ? [...peek.childNodes] : null;
      const old = [...grid.childNodes];
      if (peek) peek.remove(); peek = null; peekTab = null; span = 0;
      cfg.commit(tab, nodes);
      if (nodes && Math.abs(cfg.order.indexOf(was) - cfg.order.indexOf(tab)) === 1 && !ready.has(was)) {
        const el = document.createElement('div');
        el.className = 'grid peek' + (was === 'notes' ? ' notes' : '');
        el.setAttribute('aria-hidden', 'true'); el.dataset.tab = was;
        el.replaceChildren(...old);
        pager.appendChild(el); park(el);
      }
      paint(offset);
    };
    const finish = (commit, tab) => {
      stopSpring = null; trip = null;
      if (commit) { land(tab); tabs.classList.remove('drag'); live = false; tabs.style.setProperty('--i', cfg.order.indexOf(tab)); mark(cfg.order.indexOf(tab)); lineFx.kick(); prepare(); }
      else clear();
    };
    // Mid-flight and past half way: the pane coming in becomes the current one, from exactly where it is.
    const rebase = () => { if (peek && Math.abs(dx) > W() / 2) land(peekTab, dx + Math.sign(span) * W()); };
    // Critically damped: visually there in about 0.2 s, no bounce, carrying the finger's speed.
    function spring(to, v, done) {
      if (reduced()) { paint(to); done(); return; }
      let x = dx, last = performance.now(), frame = 0;
      const k = 800, d = 56;
      const step = (now) => {
        let dt = Math.max(0, Math.min(64, now - last)) / 1000; last = now;
        while (dt > 0) { const h = Math.min(dt, 0.008); dt -= h; v += (-k * (x - to) - d * v) * h; x += v * h; }
        if (Math.abs(x - to) < 0.8 && Math.abs(v) < 20) { stopSpring = null; paint(to); done(); return; }
        paint(x);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      stopSpring = () => { cancelAnimationFrame(frame); stopSpring = null; };
    }

    // Something else took over the swipe (another finger, a system gesture): go back to the tab we were on.
    const abortDrag = () => { if (!live) return; if (stopSpring) stopSpring(); setTimeout(() => { if (S.gesture === 'pager') S.gesture = null; }, 0); spring(0, 0, () => finish(false)); };
    pager.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1 && axis === 'h') { axis = 'no'; return abortDrag(); } // a second finger lands mid-swipe: settle where we were
      if (e.touches.length > 1 || S.select || e.target.closest('.stackcard, input, textarea, .fanitem')) { axis = 'no'; return; }
      if (stopSpring) { stopSpring(); rebase(); } // caught mid-flight: hold it where it is
      base = live ? dx : 0; lag = 0;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; axis = live ? 'h' : null; samples = [{ x: x0, t: e.timeStamp }];
      if (live) S.gesture = 'pager';
    }, { passive: true });
    pager.addEventListener('touchmove', (e) => {
      if (axis === 'no' || axis === 'v') return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY, mx = x - x0, my = y - y0;
      if (axis === null) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        axis = Math.abs(mx) > Math.abs(my) * 1.25 && !S.gesture ? 'h' : 'v';
        if (axis === 'v') return;
        live = true; trip = null; tabs.classList.add('drag'); S.gesture = 'pager';
        lag = mx; lagAt = mx; // the finger has already travelled this far: the pane starts from where it is and catches up
      }
      const catchUp = lag ? Math.max(0, 1 - Math.abs(mx - lagAt) / 24) : 0; // all caught up after 24px more
      const want = base + mx - lag * catchUp, dir = want < 0 ? 1 : -1, next = cfg.order[idx() + dir];
      if (span !== 0 && Math.sign(span) !== dir) { park(peek); peek = null; peekTab = null; span = 0; }
      if (next && !peek && want) mount(next);
      const eff = next ? want : want * 0.28; // no pane that way: a rubbery edge
      samples.push({ x, t: e.timeStamp }); if (samples.length > 6) samples.shift();
      paint(eff);
    }, { passive: true });
    const end = () => {
      if (axis !== 'h') return;
      axis = 'no';
      setTimeout(() => { if (S.gesture === 'pager') S.gesture = null; }, 0);
      const a = samples[0], b = samples[samples.length - 1], v = b && a && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms
      const dir = dx < 0 ? 1 : -1, tab = cfg.order[idx() + dir];
      const commit = !!(peek && tab && (Math.abs(dx) > W() * 0.3 || (Math.abs(v) > 0.45 && Math.sign(v) === -dir)));
      if (commit) tick();
      spring(commit ? -dir * W() : 0, v * 1000, () => finish(commit, tab));
    };
    pager.addEventListener('touchend', end, { passive: true });
    pager.addEventListener('touchcancel', end, { passive: true });

    // A tapped tab takes the same journey, however many tabs away, starting from wherever the strip is now.
    function goTo(tab) {
      const was = parseFloat(tabs.style.getPropertyValue('--i')); // where the line is now, before anything lands
      if (stopSpring) { stopSpring(); rebase(); }
      const at = idx(), to = cfg.order.indexOf(tab);
      if (to < 0) return;
      if (to === at) { if (live) spring(0, 0, () => finish(false)); return; } // back to where we were: reverse
      const dir = to > at ? 1 : -1;
      live = true; tabs.classList.add('drag');
      const from = Number.isNaN(was) ? at : was;
      if (peekTab !== tab) { const keep = dx; mount(tab); span = dir; dx = keep; }
      trip = { from, to, x0: dx, x1: -dir * W() };
      paint(dx);
      tick();
      spring(-dir * W(), 0, () => finish(true, tab));
    }
    // The library changed: panes waiting beside the grid are brought up to date, so a tab never lands stale.
    const sync = () => { if (peek && peekTab) fill(peek, peekTab); for (const [t, el] of ready) fill(el, t); };
    mark(idx());
    prepare();
    return { goTo, sync, busy: () => live };
  }
  return { wire };
};
