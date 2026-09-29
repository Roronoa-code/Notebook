// Checks for the motion film's clock, cues, photos and music (no browser): node --test promo/motion/test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./timeline.js');
const Photos = require('./photos.js');
const Music = require('./music.js');

test('shots run back to back and cover the whole film', () => {
  assert.equal(T.SHOTS[0].start, 0);
  for (let i = 1; i < T.SHOTS.length; i++) assert.equal(T.SHOTS[i].start, T.SHOTS[i - 1].end, T.SHOTS[i].id);
  assert.equal(T.SHOTS[T.SHOTS.length - 1].end, T.DURATION);
  assert.equal(T.FRAMES, 576);
  for (let f = 0; f < T.FRAMES; f++) { const t = f / T.FPS, s = T.shotAt(t); assert.ok(t >= s.start && t < s.end, `frame ${f}`); }
});

test('every cue is inside the film and every exposure is sane', () => {
  for (const c of T.CUES) { assert.ok(c.t >= 0 && c.t < T.DURATION, `${c.k} at ${c.t}`); assert.ok(c.a > 0 && c.a <= 1, `${c.k} level`); }
  for (let f = 0; f < T.FRAMES; f++) { const e = T.exposure(f / T.FPS); assert.ok(e.samples >= 1 && e.samples <= 16 && e.shutter >= 0 && e.shutter <= 1); }
});

test('easing starts at 0 and ends at 1', () => {
  for (const k of ['smooth', 'outCubic', 'inCubic', 'inOutCubic', 'outExpo', 'inExpo', 'inOutExpo', 'outBack']) {
    assert.ok(Math.abs(T[k](0)) < 1e-9, k); assert.ok(Math.abs(T[k](1) - 1) < 1e-9, k);
  }
  assert.ok(Math.abs(T.spring(1) - 1) < 0.02);
  const a = T.rng(5), b = T.rng(5); for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('the photo list is complete and the boards match the app', () => {
  assert.equal(Photos.LIST.length, 40);
  assert.equal(new Set(Photos.LIST.map((p) => p.id)).size, 40);
  assert.equal(new Set(Photos.LIST.map((p) => p.name)).size, 40);
  for (const p of Photos.LIST) assert.ok(Photos.BOARDS.includes(p.board) && p.by, p.name);
  assert.equal(Photos.mixed().length, 40);
});

test('music is deterministic, full length, below full scale, and hits land on the cues', () => {
  const a = Music.render(), b = Music.render();
  assert.equal(a.left.length, Math.round(T.DURATION * Music.RATE));
  assert.deepEqual(a.left.subarray(100000, 100200), b.left.subarray(100000, 100200));
  let peak = 0; for (let i = 0; i < a.left.length; i++) { assert.ok(Number.isFinite(a.left[i]) && Number.isFinite(a.right[i])); peak = Math.max(peak, Math.abs(a.left[i]), Math.abs(a.right[i])); }
  assert.ok(peak < 0.95 && peak > 0.5, `peak ${peak}`);
  // Loudness just after the big hits is well above just before them.
  const rms = (t0, t1) => { let s = 0, n = 0; for (let i = Math.round(t0 * Music.RATE); i < Math.round(t1 * Music.RATE); i++) { s += a.left[i] ** 2; n++; } return Math.sqrt(s / n); };
  for (const t of [7.0, 9.0, 15.4, 23.4]) assert.ok(rms(t, t + 0.08) > rms(t - 0.08, t) * 1.3, `hit at ${t}`);
  // The break after the burst is quieter than the drop.
  assert.ok(rms(16, 17.4) < rms(11.5, 13));
  const w = Music.wav(a.left, a.right, a.rate);
  assert.equal(w.toString('ascii', 0, 4), 'RIFF'); assert.equal(w.length, 44 + a.left.length * 4);
});
