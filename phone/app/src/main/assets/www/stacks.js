// Stacks: pictures and notes fanned in the space of one card. Flick one sideways to go through it: left brings the
// next to the front, right the one before. One number says where a stack is (whole numbers at rest), and every
// card's place, turn, size, depth and number come from it, so the front and the ones behind always move together.
// Dragging, the front card tucks a short way aside (it stays within the stack's own area) and slips behind as the
// next one rises; letting go settles on a spring from where it is, at the finger's speed, with no after-wobble.
// A touch mid-settle catches it where it is, and a quick second flick goes on to the next one.
window.NBStacks = (ctx) => {
  const { S, tick } = ctx;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Resting places by depth (0 = front): x and y in % of the card, turn in degrees, scale, opacity.
  // The ones behind peek out only a little, within the gap around the card: never over the next column or off screen.
  const REST = [{ x: 0, y: 0, r: 0, s: 1, o: 1 }, { x: 4, y: 1.5, r: 4, s: 0.94, o: 1 }, { x: -4, y: 2.5, r: -4, s: 0.92, o: 1 }, { x: 0, y: 4, r: 0, s: 0.9, o: 0 }];
  const rest = (d) => REST[Math.min(d, 3)];
  const TUCK = 6, TURN = 4, SPAN = 0.8; // how far the front tucks aside (% of its width: within the fan's own spread) and turns; drag per step (card widths)
  const mod = (a, n) => ((a % n) + n) % n;
  const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: a.r + (b.r - a.r) * t, s: a.s + (b.s - a.s) * t, o: a.o + (b.o - a.o) * t });
  const css = (p) => `translate(${p.x.toFixed(2)}%,${p.y.toFixed(2)}%) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
  // The resting style at depth d (app.js draws stacks with it too). Only the front card takes taps and shows its number.
  const restStyle = (d) => { const p = rest(d); return `transform:${css(p)};opacity:${p.o};z-index:${10 - d};--front:${d ? 0 : 1}${d ? ';pointer-events:none' : ''}`; };

  function state(el) {
    if (el.__st) return el.__st;
    const items = [...el.querySelectorAll('.fanitem')];
    const base = Math.max(0, items.findIndex((b) => b.dataset.v === S.stackTop[el.dataset.stack]));
    return (el.__st = { items, len: items.length, base, pos: 0, v: 0, raf: 0, n0: 0, p0: 0, samples: [], w: 160, shown: 0 });
  }
  function paint(st) {
    const k = Math.floor(st.pos), q = st.pos - k, top = mod(st.base + k, st.len);
    st.items.forEach((b, i) => {
      const d = mod(i - top, st.len);
      let p, z, front;
      if (d === 0) { // the front: tucks aside and slips behind as the next one rises
        const bump = Math.sin(Math.PI * q);
        p = mix(rest(0), rest(st.len - 1), q);
        p.x -= TUCK * bump; p.r -= TURN * bump;
        z = q < 0.5 ? 30 : 0;
        front = Math.max(0, 1 - q / 0.5) ** 2;
      } else {
        p = mix(rest(d), rest(d - 1), q);
        z = Math.round(20 - (d - q) * 2);
        front = d === 1 ? Math.max(0, (q - 0.5) / 0.5) ** 2 : 0;
      }
      b.style.transform = css(p); b.style.opacity = p.o.toFixed(3); b.style.zIndex = String(z);
      b.style.setProperty('--front', front.toFixed(3)); b.style.pointerEvents = 'none';
    });
    const shown = Math.round(st.pos); // the card in front now: one tick as it takes over
    if (shown !== st.shown) { st.shown = shown; tick(); }
  }
  function commit(el, st) {
    const n = Math.round(st.pos);
    st.base = mod(st.base + n, st.len); st.pos = 0; st.v = 0; st.shown = 0; st.raf = 0;
    S.stackTop[el.dataset.stack] = st.items[st.base].dataset.v;
    st.items.forEach((b, i) => { b.style.cssText = restStyle(mod(i - st.base, st.len)); });
  }

  const busy = (el) => !!(el.__st && el.__st.raf);
  function begin(el) {
    const st = state(el);
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    st.n0 = Math.round(st.pos); st.p0 = st.pos; st.samples = []; st.w = el.offsetWidth || st.w;
  }
  function move(el, dx, time) {
    const st = state(el);
    st.samples.push([dx, time]); if (st.samples.length > 5) st.samples.shift();
    st.pos = Math.max(st.n0 - 1, Math.min(st.n0 + 1, st.p0 - dx / (SPAN * st.w)));
    paint(st);
  }
  // One decision on letting go: a flick goes one on (or back) from where the touch began; otherwise it goes to
  // whichever is nearer, needing a third of the way to change. Then one spring, and the number is set once.
  function end(el, dx, time, cancelled) {
    const st = state(el);
    const a = st.samples[0], b = st.samples[st.samples.length - 1];
    const v = a && b && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0; // px/ms, + is rightwards
    let to = st.n0;
    if (!cancelled && Math.abs(v) > 0.35) to = st.n0 + (v < 0 ? 1 : -1);
    else if (!cancelled) to = st.pos - st.n0 > 0.3 ? st.n0 + 1 : st.pos - st.n0 < -0.3 ? st.n0 - 1 : st.n0;
    else to = Math.round(st.pos);
    S.stackTop[el.dataset.stack] = st.items[mod(st.base + to, st.len)].dataset.v; // a redraw meanwhile shows where it's going
    if (calm()) { st.pos = to; commit(el, st); return; }
    // Critically damped, carrying the finger's speed; it lands on its card and stops there (reaching it early is
    // arriving, never passing it: nothing swings on and back).
    let vel = cancelled ? 0 : (-v * 1000) / (SPAN * st.w), last = performance.now();
    const w = 18;
    const step = (now) => {
      const dt = Math.max(0, Math.min(0.032, (now - last) / 1000)); last = now;
      vel += (-w * w * (st.pos - to) - 2 * w * vel) * dt;
      const next = Math.max(st.n0 - 1, Math.min(st.n0 + 1, st.pos + vel * dt));
      if ((st.pos - to) * (next - to) <= 0 || (Math.abs(next - to) < 0.002 && Math.abs(vel) < 0.02)) { st.pos = to; commit(el, st); return; }
      st.pos = next;
      paint(st);
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }
  return { restStyle, busy, begin, move, end };
};
