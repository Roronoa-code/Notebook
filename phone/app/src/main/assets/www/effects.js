// React-free Libraries.dev effects. The same file is copied to the phone by scripts/sync-effects.js.
// Hosts carry their real job's start time, so redraws do not restart the waiting threshold.
(() => {
  const active = new Map(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const selector = '[data-nb-orb], [data-nb-beam]';
  let queued = false, frame = 0;

  function stopFrame() { cancelAnimationFrame(frame); frame = 0; }
  function paint(job, time) {
    const { canvas, ctx, preset, dpr } = job;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 20, 20);
    NotebookOrbEngine.paintFrame(ctx, NotebookOrbEngine.MODE_FRAMES[preset.mode](20, time, preset.opts), true);
  }
  function tick() {
    frame = 0;
    for (const job of active.values()) if (job.ready && job.visible && job.canvas && !document.hidden && !reduced.matches)
      paint(job, performance.now() / 1000 * job.preset.speed);
    if ([...active.values()].some(j => j.ready && j.visible && j.canvas) && !document.hidden && !reduced.matches)
      frame = requestAnimationFrame(tick);
  }
  function visibility(job) {
    if (job.beam) job.beam.toggleAttribute('data-paused', !job.visible || document.hidden);
    if (job.canvas && job.ready && reduced.matches) paint(job, .6);
    if (reduced.matches || document.hidden) stopFrame();
    else if (!frame) tick();
  }
  function dispose(el, job) {
    clearTimeout(job.timer); job.observer.disconnect(); job.node?.remove();
    if (job.position !== undefined) el.style.position = job.position;
    active.delete(el);
  }
  function mount(el) {
    const state = el.dataset.nbOrb, beam = el.hasAttribute('data-nb-beam');
    const since = Number(el.dataset.nbSince) || Date.now();
    const signature = `${state || ''}:${beam}:${since}`;
    const prior = active.get(el);
    if (prior?.signature === signature && (!prior.node || prior.node.parentNode === el)) return;
    if (prior) dispose(el, prior);
    if (!beam && !['searching', 'working', 'connecting', 'composing', 'shaping'].includes(state)) return;
    const job = { signature, visible: false, ready: false };
    active.set(el, job);
    job.observer = new IntersectionObserver(([entry]) => { job.visible = entry.isIntersecting; visibility(job); });
    job.observer.observe(el);
    job.timer = setTimeout(() => {
      if (!el.isConnected || active.get(el) !== job) return;
      job.ready = true;
      if (beam) {
        if (getComputedStyle(el).position === 'static') { job.position = el.style.position; el.style.position = 'relative'; }
        const overlay = job.node = job.beam = document.createElement('span');
        overlay.className = 'nb-effect-beam'; overlay.dataset.beam = 'nb-loading';
        overlay.setAttribute('aria-hidden', 'true'); overlay.setAttribute('data-active', '');
        overlay.style.setProperty('--nb-radius', getComputedStyle(el).borderTopLeftRadius);
        const bloom = document.createElement('span'); bloom.setAttribute('data-beam-bloom', ''); overlay.append(bloom);
        el.append(overlay);
      } else {
        const canvas = job.node = job.canvas = document.createElement('canvas');
        canvas.className = 'nb-effect-orb'; canvas.setAttribute('aria-hidden', 'true');
        job.dpr = Math.min(2, devicePixelRatio || 1); canvas.width = canvas.height = Math.round(20 * job.dpr);
        job.ctx = canvas.getContext('2d');
        if (!job.ctx) { dispose(el, job); return; }
        job.preset = NotebookOrbEngine.resolvePreset(state, 20);
        el.prepend(canvas); paint(job, reduced.matches ? .6 : performance.now() / 1000 * job.preset.speed);
      }
      visibility(job);
    }, Math.max(0, (beam ? 3000 : 2000) - (Date.now() - since)));
  }
  function reconcile() {
    queued = false;
    for (const [el, job] of active) if (!el.isConnected || !el.matches(selector)) dispose(el, job);
    document.querySelectorAll(selector).forEach(mount);
  }
  const observer = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(reconcile); } });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-nb-orb', 'data-nb-beam', 'data-nb-since'] });
  const changed = () => { for (const job of active.values()) visibility(job); };
  reduced.addEventListener('change', changed); document.addEventListener('visibilitychange', changed);
  // Set or clear an effect without replacing the control or its text/focus.
  function set(el, type, since) {
    if (!el) return;
    if (type) {
      const attr = type === 'beam' ? 'data-nb-beam' : 'data-nb-orb';
      const value = type === 'beam' ? '' : type;
      const at = String(since || el.dataset.nbSince || Date.now());
      if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
      if (el.dataset.nbSince !== at) el.dataset.nbSince = at;
      el.setAttribute('aria-busy', 'true');
    } else {
      el.removeAttribute('data-nb-orb'); el.removeAttribute('data-nb-beam'); el.removeAttribute('data-nb-since');
      el.removeAttribute('aria-busy');
    }
  }
  window.NBEffects = { set };
  window.addEventListener('pagehide', () => { stopFrame(); observer.disconnect(); for (const [el, job] of active) dispose(el, job); }, { once: true });
  reconcile();
})();
