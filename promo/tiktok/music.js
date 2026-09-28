// Original 128 BPM backing track for the advert, synthesised from code (no samples, no third-party music).
// Same beat grid as film.js, so hits land on the cuts. Deterministic: seeded noise, no clocks.
'use strict';
const Film = require('./film.js');

function render(rate = 48000) {
  const B = Film.B, n = Math.round(Film.DURATION * rate), out = new Float32Array(n);
  let seed = 7;
  const noise = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 2147483648 - 1; };
  const at = (beat) => Math.round(beat * B * rate);
  function add(beat, seconds, fn) { const s = at(beat); for (let j = 0; j < seconds * rate && s + j < n; j++) out[s + j] += fn(j / rate); }
  const kick = (b, g = .9) => add(b, .32, (t) => g * Math.sin(2 * Math.PI * (45 * t + 95 * (1 - Math.exp(-t * 28)) / 28)) * Math.exp(-t * 9));
  const clap = (b) => { let lp = 0; add(b, .22, (t) => { lp += .5 * (noise() - lp); return .32 * (noise() - lp) * Math.exp(-t * 18) * (t < .012 ? .6 : 1); }); };
  const hat = (b, g) => { let prev = 0; add(b, .05, (t) => { const x = noise(), y = x - prev; prev = x; return g * y * Math.exp(-t * 90); }); };
  const pluck = (b, f, g) => add(b, .35, (t) => g * (Math.sin(2 * Math.PI * f * t) + .35 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 11));
  const boom = (b) => { let lp = 0; add(b, 1.6, (t) => { lp += .03 * (noise() - lp); return .5 * Math.sin(2 * Math.PI * 38 * t) * Math.exp(-t * 3) + 2.2 * lp * Math.exp(-t * 2.2); }); };
  const riser = (from, beats, g) => { let prev = 0; add(from, beats * B, (t) => { const u = t / (beats * B), x = noise(), y = x - prev * (1 - u); prev = x; return g * u * u * y; }); };
  const whoosh = (b) => { let lp = 0; add(b - .5, B, (t) => { const u = t / B, c = .02 + .3 * Math.sin(Math.PI * u); lp += c * (noise() - lp); return .5 * lp * Math.sin(Math.PI * u); }); };

  // Chords per bar (A minor, F, C, G). Bass on the off-beats, pad pumping against the kick.
  const CH = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
  const ROOT = [55, 43.65, 65.41, 49];
  const END = Film.END, groove = (b) => b >= 4 && b < 30;
  for (let b = 0; b < 30; b++) {
    kick(b, b < 4 ? .75 : .9);
    if (b % 2 === 1) clap(b);
    if (groove(b)) {
      hat(b + .5, .22); hat(b + .25, .07); hat(b + .75, .07);
      const bar = Math.floor(b / 4) % 4, f = ROOT[bar] * 2;
      add(b + .5, B * .45, (t) => .34 * Math.tanh(2.2 * Math.sin(2 * Math.PI * f * t)) * Math.min(1, t * 200) * Math.exp(-t * 5));
      if (b >= 8) [0, .5].forEach((o, i) => pluck(b + o, CH[bar][(b * 2 + i) % 3] * 2, .09));
    }
  }
  riser(1.5, 2.5, .25); boom(4); whoosh(4); whoosh(26);
  riser(28, 3, .3);
  for (const c of Film.CHIPS) pluck(c.beat, 1046.5, .12);
  const clicks = (from, beats, len) => { for (let i = 0; i < len; i++) hat(from + i * beats / len, .1); };
  clicks(8.75, 1.25, 14); clicks(21, 1.5, 16);
  kick(END, 1); boom(END);
  // Pad: continuous, sidechained to the kick, fades out over the last bar.
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate, b = t / B;
    if (b < 4) continue;
    const bar = b >= END ? 0 : Math.floor(b / 4) % 4;
    const pump = b >= END ? 1 : 1 - .75 * Math.exp(-(b % 1) * B * 9);
    const fade = b >= END ? Math.max(0, 1 - (b - END) / 5) : Math.min(1, (b - 4) * 2);
    let v = 0; for (const f of CH[bar]) v += Math.sin(2 * Math.PI * f * t) + .3 * Math.sin(2 * Math.PI * f * 2.003 * t);
    lp += .08 * (v - lp);
    out[i] += .06 * lp * pump * fade * (b >= 30 && b < END ? .5 : 1);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) { out[i] = Math.tanh(out[i] * 1.2); peak = Math.max(peak, Math.abs(out[i])); }
  const gain = .8 / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return { samples: out, rate, peak: .8 };
}

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

module.exports = { render, wav };
