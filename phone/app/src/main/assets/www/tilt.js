// Things you press lean away from your finger, the way a real object would: cards, board piles and the
// orb tilt in perspective (routine buttons don't: they answer with a small press, and their tap area never moves) toward where they were touched and spring back when you let go. The board rail also
// turns each pile as it passes, so the row reads as a shelf with depth rather than a flat strip.
window.NBTilt = (root) => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEL = '.card:not(.stackcard) .media, .card.stackcard .fan, .pile-stack, .orb';
  let el = null, x0 = 0, y0 = 0, r = null;

  function lean(x, y) {
    if (!el || !r) return;
    const nx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (r.width / 2))), ny = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / (r.height / 2)));
    const big = Math.min(r.width, r.height) > 120, k = big ? 7 : 12; // a large card leans gently, a small button more
    el.style.setProperty('--ry', (nx * k).toFixed(2) + 'deg');
    el.style.setProperty('--rx', (-ny * k).toFixed(2) + 'deg');
  }
  function letGo() {
    if (!el) return;
    const t = el; el = null; r = null;
    t.classList.remove('leaning');
    t.style.removeProperty('--rx'); t.style.removeProperty('--ry');
  }
  root.addEventListener('touchstart', (e) => {
    if (reduced() || e.touches.length > 1) return;
    const t = e.target.closest(SEL);
    letGo();
    if (!t) return;
    el = t; r = t.getBoundingClientRect(); x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    t.classList.add('leaning');
    lean(x0, y0);
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!el) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - x0, t.clientY - y0) > 14) letGo(); // it became a scroll or a drag: stop leaning
  }, { passive: true });
  root.addEventListener('touchend', letGo, { passive: true });
  root.addEventListener('touchcancel', letGo, { passive: true });

  // The rail: piles turn away from the middle as they scroll.
  function coverflow(rail) {
    let frame = 0;
    const paint = () => {
      frame = 0;
      const box = rail.getBoundingClientRect(), mid = box.left + box.width * 0.42;
      for (const p of rail.children) {
        const b = p.getBoundingClientRect(), d = Math.max(-1.2, Math.min(1.2, (b.left + b.width / 2 - mid) / (box.width * 0.55)));
        p.style.setProperty('--cf', (-d * 16).toFixed(2) + 'deg');
      }
    };
    rail.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(paint); }, { passive: true });
    paint();
    gaze(rail);
    return paint;
  }

  // The boards look at you: tilt the phone and every pile turns a little to keep facing you, with the prints behind
  // sliding the other way for depth. "Straight" is however you are holding the phone, and it slowly re-centres, so
  // it only reacts to movement. Eased every frame; paused while Home is covered or the app is in the background.
  function gaze(rail) {
    if (!('DeviceOrientationEvent' in window)) return;
    let base = null, target = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, raf = 0;
    const visible = () => !document.hidden && !el && !root.querySelector('#orb')?.hidden && rail.isConnected && rail.closest('.screen')?.style.visibility !== 'hidden' && !rail.closest('.screen')?.inert;
    const step = () => {
      raf = 0;
      if (reduced() || !visible()) return; // Hold the last pose while another surface moves; no snap back underneath it.
      cur.x += (target.x - cur.x) * 0.12; cur.y += (target.y - cur.y) * 0.12;
      rail.style.setProperty('--gx', cur.x.toFixed(2) + 'deg'); rail.style.setProperty('--gy', cur.y.toFixed(2) + 'deg');
      rail.style.setProperty('--gxn', cur.x.toFixed(2)); rail.style.setProperty('--gyn', cur.y.toFixed(2));
      if (Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.02) raf = requestAnimationFrame(step);
    };
    const feel = (e) => {
      if (e.beta == null || e.gamma == null || reduced()) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      base.b += (e.beta - base.b) * 0.01; base.g += (e.gamma - base.g) * 0.01; // slowly re-centre on how it's held
      if (!visible()) return;
      const clamp = (v, m) => Math.max(-m, Math.min(m, v));
      target = { x: clamp(-(e.beta - base.b) * 0.6, 10), y: clamp((e.gamma - base.g) * 0.7, 14) };
      rail.classList.add('gazing');
      if (!raf && Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.04) raf = requestAnimationFrame(step);
    };
    let native = false; // once the app's own sensor speaks, the browser's (different angles) is ignored
    addEventListener('deviceorientation', (e) => { if (!native) feel(e); });
    window.nbGaze = (beta, gamma) => { if (!native) { native = true; base = null; } feel({ beta, gamma }); }; // from the phone app's own sensor (MainActivity)
  }
  return { coverflow };
};
