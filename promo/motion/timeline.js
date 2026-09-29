// The film's clock: shots, beats, sound cues and the easing maths. Shared by the renderer (browser) and
// the music (Node), so every hit in the sound lands on the frame where the picture hits.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FPS = 24, BPM = 120, BEAT = 60 / BPM, W = 1920, H = 1080, DURATION = 24;

  // Shots in seconds (hard cuts, covered by a whip, a flash or a burst like the reference).
  const SHOTS = [
    ['desk', 0, 4.5],        // top-down desk, phone, saved things, notifications pop, then the tumble
    ['office', 4.5, 9],      // the PC: cursor, the glass Save button, "it's on your board", cards burst out
    ['burst1', 9, 9.25],     // white-lilac burst
    ['macro', 9.25, 11],     // close-up: the stroke draws round the coat, labels pop up
    ['flash2', 11, 11.25],   // violet halftone flash
    ['board', 11.25, 13],    // overhead board, the ribbon sweeps through
    ['ideas', 13, 15.4],     // pins fly in, "so many ideas" in puffy 3D
    ['burst2', 15.4, 15.667],// speed-line burst
    ['sky', 15.667, 18.5],   // the phone floating, "anywhere", then the info card slides up
    ['ring', 18.5, 20.333],  // a board tile, the halftone ring, "sorted", the tile opens
    ['ui', 20.333, 21.667],  // the real app: search, open photo
    ['finale', 21.667, 24]   // save!!! / sort. / find. / notebook.
  ].map(([id, start, end]) => ({ id, start, end }));

  const shotAt = (t) => SHOTS.find((s) => t >= s.start && t < s.end) || SHOTS[SHOTS.length - 1];

  // Sound cues (seconds). kind: pop, whoosh, impact, riser, click, type, swish, boing, burst, sparkle, slide, tick, drop, draw, reverse.
  const CUES = [
    { t: 0.0, k: 'sparkle', a: 0.35 },
    { t: 1.25, k: 'pop', a: 0.8, p: 1.0 }, { t: 1.583, k: 'pop', a: 0.8, p: 1.19 }, { t: 1.917, k: 'pop', a: 0.85, p: 1.5 },
    { t: 2.0, k: 'riser', a: 0.5, d: 1.0 },
    { t: 3.0, k: 'whoosh', a: 0.9, d: 0.9 }, { t: 3.0, k: 'drop', a: 0.8 },
    { t: 3.9, k: 'reverse', a: 0.5, d: 0.6 },
    { t: 4.5, k: 'impact', a: 0.8 }, { t: 4.3, k: 'whoosh', a: 1.0, d: 0.45 },
    { t: 5.2, k: 'swish', a: 0.5, d: 0.5 },
    { t: 6.0, k: 'riser', a: 0.55, d: 1.0 },
    { t: 6.6, k: 'swish', a: 0.5, d: 0.35 },
    { t: 7.0, k: 'click', a: 1.0 }, { t: 7.0, k: 'impact', a: 1.0 },
    ...[...'ONE LINK LATER'].map((c, i) => ({ t: 7.55 + i * 0.035, k: 'type', a: 0.35 })),
    ...[...'ITS ON YOUR BOARD'].map((c, i) => ({ t: 7.9 + i * 0.042, k: 'type', a: 0.45 })),
    { t: 8.0, k: 'whoosh', a: 0.6, d: 0.8 },
    { t: 8.75, k: 'reverse', a: 0.6, d: 0.25 },
    { t: 9.0, k: 'burst', a: 1.0 },
    { t: 9.35, k: 'draw', a: 0.55, d: 0.95 },
    { t: 9.6, k: 'pop', a: 0.7, p: 1.0 }, { t: 9.85, k: 'pop', a: 0.7, p: 1.12 }, { t: 10.1, k: 'pop', a: 0.7, p: 1.26 }, { t: 10.35, k: 'pop', a: 0.7, p: 1.5 },
    { t: 11.0, k: 'impact', a: 0.8 },
    { t: 11.25, k: 'whoosh', a: 0.8, d: 1.2 },
    { t: 12.4, k: 'swish', a: 0.6, d: 0.5 },
    { t: 13.0, k: 'whoosh', a: 0.7, d: 0.6 },
    { t: 13.5, k: 'boing', a: 0.9, p: 1.0 }, { t: 14.0, k: 'boing', a: 1.0, p: 0.84 }, { t: 14.5, k: 'boing', a: 1.0, p: 1.12 },
    { t: 14.8, k: 'riser', a: 0.6, d: 0.6 },
    { t: 15.4, k: 'burst', a: 1.0 },
    { t: 15.7, k: 'sparkle', a: 0.5 },
    { t: 16.0, k: 'swish', a: 0.35, d: 0.6 },
    { t: 17.5, k: 'slide', a: 0.7 },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ t: 17.75 + i * 0.1, k: 'tick', a: 0.4 })),
    { t: 18.5, k: 'whoosh', a: 0.8, d: 0.5 }, { t: 18.5, k: 'impact', a: 0.6 },
    { t: 19.0, k: 'swish', a: 0.6, d: 0.8 },
    { t: 19.5, k: 'pop', a: 0.7, p: 0.9 },
    { t: 20.0, k: 'whoosh', a: 0.9, d: 0.35 },
    { t: 20.333, k: 'impact', a: 0.6 },
    ...[...'Find anything'].map((c, i) => ({ t: 20.55 + i * 0.045, k: 'type', a: 0.4 })),
    { t: 21.0, k: 'slide', a: 0.5 },
    { t: 21.4, k: 'reverse', a: 0.6, d: 0.27 },
    { t: 21.667, k: 'burst', a: 0.9 },
    { t: 22.25, k: 'impact', a: 0.7 }, { t: 22.583, k: 'impact', a: 0.7 }, { t: 22.917, k: 'impact', a: 0.8 },
    { t: 22.95, k: 'whoosh', a: 0.9, d: 0.5 },
    { t: 23.4, k: 'impact', a: 1.0 }, { t: 23.4, k: 'sparkle', a: 0.5 }
  ];

  // How many exposures make one frame (motion blur), and the shutter as a share of a frame.
  function exposure(t) {
    const id = shotAt(t).id;
    if (['burst1', 'flash2', 'burst2', 'finale'].includes(id)) return { samples: 1, shutter: 0 };
    const fast = (t > 2.9 && t < 4.5) || (t > 4.5 && t < 4.9) || (t > 7.9 && t < 9) || (t > 11.25 && t < 11.7) || (t > 13 && t < 13.6) || (t > 14.8 && t < 15.4) || (t > 19.9 && t < 20.7);
    return fast ? { samples: 12, shutter: 0.7 } : { samples: 6, shutter: 0.5 };
  }

  // Easing and small maths.
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const range = (t, a, b) => clamp((t - a) / (b - a));
  const smooth = (x) => x * x * (3 - 2 * x);
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const inCubic = (x) => x * x * x;
  const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const inExpo = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
  const inOutExpo = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2);
  const outBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  // A damped spring from 0 to 1 (the app's springy feel): overshoots, then settles.
  const spring = (x, freq = 4.5, damp = 6) => (x <= 0 ? 0 : 1 - Math.exp(-damp * x) * Math.cos(freq * Math.PI * 2 * x * 0.5));
  // Seeded random numbers, so every render is identical.
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

  return { FPS, BPM, BEAT, W, H, DURATION, FRAMES: Math.round(DURATION * FPS), SHOTS, shotAt, CUES, exposure,
    clamp, lerp, range, smooth, outCubic, inCubic, inOutCubic, outExpo, inExpo, inOutExpo, outBack, spring, rng };
});
