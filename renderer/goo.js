// Liquid droplets (libraries.dev Gooey, ported without React: the same SVG goo, blur then a steep alpha curve, so
// droplets that touch run together, as the + menu does). Used by the New ideas button while a refresh works: its
// arrows melt into three droplets that circle and merge, and pull back together into the arrows when it is done.
// The approved choice D of the refresh options (with the search field's beam). The droplets carry their own start
// (and end) time, so a redraw of the button mid-way carries on from the same moment.
window.NBGoo = (() => {
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  function defs() {
    if (document.getElementById('nbgoodrops')) return;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true'); s.style.position = 'absolute';
    s.innerHTML = '<filter id="nbgoodrops" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"/></filter>';
    document.body.appendChild(s);
  }
  // The droplets' markup: `since` when they started; `out` when they started pulling back together (or 0).
  const html = (since, out = 0) => `<span class="goo" aria-hidden="true" data-since="${since}" data-out="${out}"><svg class="goosvg" viewBox="-22 -22 44 44"><g filter="url(#nbgoodrops)" fill="currentColor"><circle r="0"/><circle r="0"/><circle r="0"/></g></svg></span>`;
  const ease = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  function frame() {
    raf = 0;
    const now = Date.now(), all = document.querySelectorAll('.goo');
    for (const g of all) {
      const since = +g.dataset.since, out = +g.dataset.out, t = (now - since) / 1000;
      const amt = out ? 1 - ease((now - out) / 420) : ease((now - since) / 380);
      if (out && amt <= 0) { g.remove(); continue; }
      g.querySelectorAll('circle').forEach((d, i) => {
        const a = t * 3.2 + (i * Math.PI * 2) / 3, rad = 6.5 * amt * (1 + 0.25 * Math.sin(t * 4 + i));
        d.setAttribute('cx', (Math.cos(a) * rad).toFixed(2)); d.setAttribute('cy', (Math.sin(a) * rad).toFixed(2));
        d.setAttribute('r', (3.6 * amt + (i === 0 ? 0.6 : 0)).toFixed(2));
      });
    }
    if (document.querySelector('.goo') && !calm() && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => { defs(); if (!raf) raf = requestAnimationFrame(frame); };
  new MutationObserver(() => { if (document.querySelector('.goo')) kick(); }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && document.querySelector('.goo')) kick(); });
  return { html };
})();
