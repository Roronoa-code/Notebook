// Checks for the advert's frame maths (no browser): node --test promo/tiktok/test.cjs
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Film = require('./film.js');
const Music = require('./music.js');
const TOTAL = Math.round(Film.DURATION * Film.FPS);

function walk(value, visit, key = 'state') {
  if (typeof value === 'number') visit(key, value);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, k);
}

test('every frame is finite, alphas are bounded, rectangles are valid', () => {
  for (let f = 0; f < TOTAL; f++) {
    const s = Film.evaluate(f);
    walk(s, (k, v) => assert.ok(Number.isFinite(v), `frame ${f}: ${k} is not finite`));
    for (const c of s.cards || []) {
      assert.ok(c.alpha >= 0 && c.alpha <= 1, `frame ${f}: ${c.id} alpha ${c.alpha}`);
      assert.ok(c.rect.width > 0 && c.rect.height > 0 && c.rect.radius >= 0, `frame ${f}: ${c.id} rect`);
    }
  }
});

test('frames do not depend on render order', () => {
  const a = Film.evaluate(400);
  Film.evaluate(0); Film.evaluate(719); Film.evaluate(123.5);
  assert.deepEqual(Film.evaluate(400), a);
});

test('each shot settles before the next begins (readable holds)', () => {
  // [settled frame, last frame of the shot] must match exactly.
  for (const [a, b] of [[86, 112], [164, 196], [335, 365], [433, 435], [472, 509]]) {
    const x = Film.evaluate(a), y = Film.evaluate(b);
    assert.deepEqual({ ...x, t: 0, beat: 0 }, { ...y, t: 0, beat: 0 }, `frames ${a}..${b} should hold still`);
  }
});

test('the saved card grows from the paste bar and lands in the first slot', () => {
  const card = (f) => Film.evaluate(f).cards.find((c) => c.id === 'nw');
  assert.equal(card(147).alpha, 0);
  assert.ok(card(148).alpha === 1 && card(148).rect.y < 600 && card(148).rect.width > 474);
  assert.deepEqual(card(180).rect, Film.LAYOUT_B.nw);
});

test('only pictures that match the search stay after filtering', () => {
  const s = Film.evaluate(350);
  for (const c of s.cards) assert.equal(c.alpha > 0, !!Film.ITEMS[c.id].match, c.id);
});

test('the phone screen keeps the board at uniform scale and ends inside the frame', () => {
  const s = Film.evaluate(420);
  const r = s.clip, k = s.camera.s;
  const screen = { x: s.camera.x + r.x * k, y: s.camera.y + r.y * k, w: r.width * k, h: r.height * k };
  assert.ok(Math.abs(screen.w - 500) < 1e-6 && Math.abs(screen.h - 1083) < 1e-6);
  assert.ok(screen.x > 0 && screen.y > 0 && screen.x + screen.w < 1080 && screen.y + screen.h < 1920);
});

test('music is deterministic, full length and below full scale', () => {
  const a = Music.render(), b = Music.render();
  assert.equal(a.samples.length, Math.round(Film.DURATION * a.rate));
  assert.deepEqual(a.samples.slice(0, 48000 * 3), b.samples.slice(0, 48000 * 3));
  let peak = 0; for (const v of a.samples) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  assert.ok(peak <= .9);
});

test('hook shows a word and a picture on the very first frame', () => {
  const s = Film.evaluate(0);
  assert.equal(s.hook.words[0].word, 'SCREENSHOTS.');
  assert.equal(s.cards.find((c) => c.id === 'g0').alpha, 1);
});

test('bad input is rejected', () => {
  assert.throws(() => Film.evaluate(NaN), TypeError);
  assert.throws(() => Film.evaluate(0, 0), RangeError);
});
