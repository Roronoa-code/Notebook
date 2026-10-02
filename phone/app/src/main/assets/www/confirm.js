// A button waiting for its second tap (delete a board): the libraries.dev Border Beam "pulse-inner" glow, in its
// "sunset" reds, breathes inside it (confirm.css holds the package's generated layers). This is the package's own
// pulse loop, ported without React: the same oscillators, 30 frames a second, paused under reduced motion. Static
// colours (the package's staticColors), so it stays in the reds. Border Beam 1.4.1, MIT.
window.NBConfirm = (() => {
  const ID = 'nb-confirm', reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // pulse-inner on a dark surface at the default 2.3 s duration (the package's ge() and so())
  const sp = 0.28, dr = 33, op = 0.48, gh = 0.34, bs = 1.9, ss = 2.6, ghs = 2.4;
  const OSC = [
    ['bw1', 1 - sp, 1 + sp * 1.1, ss * 0.9, 0, ''], ['bh1', 1 + sp * 0.9, 1 - sp * 0.85, ss * 1.26, 0, ''],
    ['bx1', -dr, dr * 0.9, bs * 1.6, 0, 'px'], ['by1', dr * 0.55, -dr * 0.7, bs * 1.6, 0, 'px'],
    ['bw2', 1 + sp, 1 - sp * 0.85, ss * 1.1, 0, ''], ['bh2', 1 - sp * 0.8, 1 + sp * 1.05, ss * 0.81, 0, ''],
    ['bx2', dr * 0.8, -dr * 0.9, bs * 1.88, 0, 'px'], ['by2', -dr, dr * 0.65, bs * 1.88, 0, 'px'],
    ['bw3', 1 - sp * 0.6, 1 + sp * 1.15, ss * 0.98, 0, ''], ['bh3', 1 + sp * 0.75, 1 - sp, ss * 1.4, 0, ''],
    ['bx3', -dr * 0.6, dr, bs * 1.45, 0, 'px'], ['by3', -dr * 0.85, dr * 0.45, bs * 1.45, 0, 'px'],
    ['bgh', 1 - gh, 1 + gh, ghs, 0, ''],
    ['bop-tl', 1 - op, 1, bs, 0, ''], ['bop-tr', 1 - op, 1, bs * 1.32, bs * 0.28, ''],
    ['bop-bl', 1 - op, 1, bs * 0.84, bs * 0.55, ''], ['bop-br', 1 - op, 1, bs * 1.58, bs * 0.83, '']
  ];
  const wave = (x) => (1 - Math.cos(Math.PI * 2 * x)) / 2;
  const armed = new Map(); // button → when it was armed (ms)
  let raf = 0, last = 0;
  function paint(el, t) {
    for (const [p, a, b, period, delay, unit] of OSC) {
      const v = a + (b - a) * wave((t - delay) / period);
      el.style.setProperty(`--${p}-${ID}`, unit ? v.toFixed(2) + 'px' : v.toFixed(4));
    }
  }
  function frame(now) {
    raf = armed.size ? requestAnimationFrame(frame) : 0;
    if (now - last < 1000 / 30 - 2) return;
    last = now;
    for (const [el, at] of armed) { if (!el.isConnected) { armed.delete(el); continue; } paint(el, (now - at) / 1000); }
  }
  function on(el) {
    if (armed.has(el)) return;
    el.dataset.beam = ID; el.removeAttribute('data-fading'); el.setAttribute('data-active', '');
    el.style.setProperty('--beam-strength', '1');
    if (!el.querySelector('[data-beam-bloom]')) { const b = document.createElement('div'); b.setAttribute('data-beam-bloom', 'true'); b.setAttribute('aria-hidden', 'true'); el.appendChild(b); }
    armed.set(el, performance.now());
    paint(el, 0);
    if (!reduced() && !raf) raf = requestAnimationFrame(frame);
  }
  function off(el) {
    if (!armed.has(el)) return;
    armed.delete(el);
    el.removeAttribute('data-active'); el.setAttribute('data-fading', '');
    setTimeout(() => { if (armed.has(el)) return; el.removeAttribute('data-fading'); delete el.dataset.beam; el.querySelector('[data-beam-bloom]')?.remove(); }, 500);
  }
  return { on, off };
})();
