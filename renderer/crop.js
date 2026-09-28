// Cropping a photo or video: drag the frame (or its corners and edges) over the whole picture.
// Saved as fractions of the picture ({ x, y, w, h }) and shown with object-view-box, so the file itself never changes.
(() => {
  const { h } = NB;
  const MIN = 0.05;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const full = (c) => c.x < 0.002 && c.y < 0.002 && c.w > 0.996 && c.h > 0.996;
  const round = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));

  // Moves the frame ('move') or drags one of its sides/corners ('n', 'se', …) by dx, dy (fractions).
  function resize(s, d, dx, dy) {
    if (d === 'move') return { x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h), w: s.w, h: s.h };
    let l = s.x, t = s.y, r = s.x + s.w, b = s.y + s.h;
    if (d.includes('w')) l = clamp(l + dx, 0, r - MIN);
    if (d.includes('e')) r = clamp(r + dx, l + MIN, 1);
    if (d.includes('n')) t = clamp(t + dy, 0, b - MIN);
    if (d.includes('s')) b = clamp(b + dy, t + MIN, 1);
    return { x: l, y: t, w: r - l, h: b - t };
  }

  // Puts the crop frame over `stage` (showing the whole picture). done(crop | null | undefined):
  // a crop to save, null to go back to the whole picture, undefined to leave it as it was.
  function edit(stage, it, done) {
    let c = it.crop ? { ...it.crop } : { x: 0, y: 0, w: 1, h: 1 };
    const box = h('div', { class: 'cropbox', tabindex: '0', role: 'group', 'aria-label': 'Crop frame. Drag it to move, drag a corner or edge to resize. Arrow keys move it; Shift and arrows resize it.' },
      ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map((d) => h('span', { class: 'ch ' + d, 'data-d': d })));
    const layer = h('div', { class: 'cropper' }, box);
    const draw = () => Object.assign(box.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' });
    stage.append(layer);
    draw();
    box.focus();
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const d = e.target.dataset.d || 'move', r = layer.getBoundingClientRect(), start = { ...c }, x0 = e.clientX, y0 = e.clientY;
      box.setPointerCapture(e.pointerId);
      box.classList.add('dragging');
      const move = (m) => { c = resize(start, d, (m.clientX - x0) / r.width, (m.clientY - y0) / r.height); draw(); };
      const up = () => { box.classList.remove('dragging'); box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up); };
      box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    });
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const key = (e) => {
      if (NB.modalOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(undefined); }
      else if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button, input, textarea'))) { e.preventDefault(); save(); }
      else if (ARROWS[e.key] && document.activeElement === box) { e.preventDefault(); const [x, y] = ARROWS[e.key]; c = resize(c, e.shiftKey ? 'se' : 'move', x * 0.01, y * 0.01); draw(); }
    };
    window.addEventListener('keydown', key, true);
    function finish(result) { window.removeEventListener('keydown', key, true); layer.remove(); done(result); }
    const save = () => finish(full(c) ? null : round(c));
    return { save, cancel: () => finish(undefined), reset: () => { c = { x: 0, y: 0, w: 1, h: 1 }; draw(); box.focus(); } };
  }

  NB.crop = { edit, resize };
})();
