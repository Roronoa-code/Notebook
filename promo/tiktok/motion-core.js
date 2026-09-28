/* Maths from the Product-Motion-Agent-Pack (examples/motion-core.js), unchanged. No dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MotionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function finite(value, name = 'value') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
    return value;
  }
  function clamp(value, min = 0, max = 1) {
    finite(value); finite(min, 'min'); finite(max, 'max');
    if (max < min) throw new RangeError('max must be >= min');
    return Math.min(max, Math.max(min, value));
  }
  function lerp(a, b, u) { return finite(a) + (finite(b) - a) * finite(u); }
  function progress(time, onset, duration) {
    finite(time, 'time'); finite(onset, 'onset'); finite(duration, 'duration');
    if (duration <= 0) throw new RangeError('duration must be > 0');
    return clamp((time - onset) / duration);
  }
  function smootherstep(value) {
    const u = clamp(value);
    return u * u * u * (u * (u * 6 - 15) + 10);
  }
  function bezierAxis(s, p1, p2) {
    const inv = 1 - s;
    return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
  }
  function cubicBezier(x1, y1, x2, y2) {
    [x1, y1, x2, y2].forEach(v => finite(v));
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new RangeError('Bezier x controls must be in [0, 1]');
    return function (value) {
      const u = clamp(value);
      if (u === 0 || u === 1) return u;
      let low = 0, high = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (bezierAxis(mid, x1, x2) < u) low = mid; else high = mid;
      }
      return bezierAxis((low + high) / 2, y1, y2);
    };
  }
  function criticalSpring(time, from, target, velocity = 0, omega = 12) {
    [time, from, target, velocity, omega].forEach(v => finite(v));
    if (time < 0 || omega <= 0) throw new RangeError('time >= 0 and omega > 0 required');
    const y0 = from - target, b = velocity + omega * y0, decay = Math.exp(-omega * time);
    return {position: target + (y0 + b * time) * decay, velocity: (b - omega * (y0 + b * time)) * decay};
  }
  function project(point, camera, focalPx, centre = {x: 640, y: 390}, near = 1) {
    [point.x, point.y, point.z, camera.x, camera.y, camera.z, focalPx, centre.x, centre.y, near].forEach(v => finite(v));
    if (near <= 0 || focalPx <= 0) throw new RangeError('near and focalPx must be > 0');
    const z = point.z - camera.z;
    if (z < near) throw new RangeError('point is behind the near plane');
    return {x: centre.x + focalPx * (point.x - camera.x) / z, y: centre.y + focalPx * (point.y - camera.y) / z, scale: focalPx / z, z};
  }
  function beatFrame(index, bpm, offset, fps) {
    [index, bpm, offset, fps].forEach(v => finite(v));
    if (bpm <= 0 || fps <= 0) throw new RangeError('bpm and fps must be > 0');
    return Math.round((offset + index * 60 / bpm) * fps);
  }
  return Object.freeze({finite, clamp, lerp, progress, smootherstep, cubicBezier, criticalSpring, project, beatFrame});
});
