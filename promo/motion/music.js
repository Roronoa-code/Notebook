// The film's soundtrack, made from code: an original 120 BPM track (so no rights issues) plus sound design
// (whooshes, pops, clicks, typing, impacts, bursts) placed from Timeline.CUES, so every hit is on its frame.
// Structure follows the reference: a soft start, a drop on the click, a big airy break, a stuttering finish.
'use strict';
const T = require('./timeline.js');

const RATE = 48000, LEN = Math.round(T.DURATION * RATE);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function buses() { const mk = () => ({ L: new Float32Array(LEN), R: new Float32Array(LEN) }); return { drums: mk(), music: mk(), fx: mk(), verb: mk(), delay: mk() }; }

// Write a mono voice into a bus: gen(i, time since start) -> sample. pan -1..1, send to reverb/delay.
function voice(B, bus, t0, dur, gen, { pan = 0, gain = 1, verb = 0, delay = 0 } = {}) {
  const s0 = Math.max(0, Math.round(t0 * RATE)), n = Math.min(LEN - s0, Math.round(dur * RATE));
  if (n <= 0) return;
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4), b = B[bus];
  for (let i = 0; i < n; i++) {
    const v = gen(i, i / RATE), k = s0 + i;
    b.L[k] += v * gl; b.R[k] += v * gr;
    if (verb) { B.verb.L[k] += v * gl * verb; B.verb.R[k] += v * gr * verb; }
    if (delay) { B.delay.L[k] += v * gl * delay; B.delay.R[k] += v * gr * delay; }
  }
}

// Seeded noise and simple filters.
function noiseGen(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s / 4294967296) * 2 - 1; }; }
function svf() { let lp = 0, bp = 0; return (x, f, q = 0.7) => { const F = 2 * Math.sin(Math.PI * Math.min(f, RATE / 6) / RATE); const hp = x - lp - bp / q; bp += F * hp; lp += F * bp; return { lp, bp, hp }; }; }
function onePole(fc) { const a = Math.exp(-2 * Math.PI * fc / RATE); let y = 0; return (x) => (y = x * (1 - a) + y * a); }
// Band-limited saw (polyBLEP).
function saw(freq) { let ph = 0; const dt = freq / RATE; return () => { ph += dt; if (ph >= 1) ph -= 1; let v = 2 * ph - 1; if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; } else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; } return v; }; }

// ——— Instruments
function kick(B, t, a = 1) { let ph = 0; const n = noiseGen(7); voice(B, 'drums', t, 0.45, (i, s) => { const f = 44 + 130 * Math.exp(-s * 32); ph += f / RATE; return (Math.sin(ph * 2 * Math.PI) * Math.exp(-s * 7.5) + (s < 0.004 ? n() * 0.5 : 0)) * a; }, { gain: 0.75 }); }
function clap(B, t, a = 1) { const n = noiseGen(Math.round(t * 1000)), f = svf(); voice(B, 'drums', t, 0.3, (i, s) => { const env = (s < 0.03 ? (Math.exp(-(s % 0.01) * 300)) : Math.exp(-(s - 0.03) * 16)); return f(n(), 1400, 1.2).bp * env * a * 1.6; }, { gain: 0.5, verb: 0.25, pan: 0.05 }); }
function hat(B, t, a = 1, open = false) { const n = noiseGen(Math.round(t * 977)), h1 = svf(); voice(B, 'drums', t, open ? 0.3 : 0.07, (i, s) => h1(n(), 9000, 0.9).hp * Math.exp(-s * (open ? 14 : 70)) * a, { gain: 0.22, pan: 0.25 }); }
function bass(B, t, midi, dur, a = 1) { const o = saw(hz(midi)), f = svf(); let ph = 0; voice(B, 'music', t, dur, (i, s) => { ph += hz(midi) / RATE; const env = Math.min(1, s * 200) * Math.min(1, (dur - s) * 60); const x = f(o() * 0.5, 180 + 900 * Math.exp(-s * 18), 0.9).lp + Math.sin(ph * 2 * Math.PI) * 0.8; return x * env * a; }, { gain: 0.36 }); }
function stab(B, t, notes, dur, a = 1, bright = 1) {
  notes.forEach((m, k) => { const os = [saw(hz(m) * 0.997), saw(hz(m) * 1.003), saw(hz(m + 12) * 1.001)], f = svf(); voice(B, 'music', t, dur + 0.15, (i, s) => { const env = Math.min(1, s * 300) * Math.exp(-Math.max(0, s - dur) * 25) * Math.exp(-s * 3); return f((os[0]() + os[1]() + os[2]() * 0.4) * 0.3, (600 + 3400 * bright * Math.exp(-s * 9)), 1.1).lp * env * a; }, { gain: 0.28, pan: (k - 1.5) * 0.35, verb: 0.35, delay: 0.12 }); });
}
function pad(B, t, notes, dur, a = 1, cut = 1200) {
  notes.forEach((m, k) => { const os = [saw(hz(m) * 0.995), saw(hz(m) * 1.005)], f = svf(); voice(B, 'music', t, dur + 0.8, (i, s) => { const env = Math.min(1, s / 0.5) * Math.min(1, Math.max(0, (dur + 0.8 - s) / 0.8)); return f((os[0]() + os[1]()) * 0.25, cut * (1 + 0.15 * Math.sin(s * 1.3 + k)), 0.8).lp * env * a; }, { gain: 0.26, pan: (k - 1.5) * 0.5, verb: 0.55 }); });
}
function pluck(B, t, midi, a = 1, cut = 3000) { const f = svf(); let ph = 0; voice(B, 'music', t, 0.35, (i, s) => { ph += hz(midi) / RATE; const sq = (ph % 1) < 0.5 ? 1 : -1; return f(sq * 0.4 + Math.sin(ph * 2 * Math.PI) * 0.3, cut * Math.exp(-s * 12) + 300, 1.4).lp * Math.exp(-s * 11) * a; }, { gain: 0.25, pan: ((midi % 5) - 2) * 0.25, delay: 0.35, verb: 0.2 }); }
function bell(B, t, midi, a = 1) { voice(B, 'fx', t, 1.2, (i, s) => { const f0 = hz(midi); const blip = 1 + 0.12 * Math.exp(-s * 60); return (Math.sin(2 * Math.PI * f0 * blip * s) * Math.exp(-s * 5) + 0.35 * Math.sin(2 * Math.PI * f0 * 2.76 * s) * Math.exp(-s * 9) + 0.15 * Math.sin(2 * Math.PI * f0 * 5.4 * s) * Math.exp(-s * 14)) * a; }, { gain: 0.3, verb: 0.4, delay: 0.25, pan: (midi % 3 - 1) * 0.3 }); }

// ——— Sound design
function whoosh(B, t, d, a, seed = 1) { const n = noiseGen(seed), f = svf(); voice(B, 'fx', t - d * 0.55, d * 1.1, (i, s) => { const u = s / (d * 1.1), env = Math.pow(Math.sin(Math.PI * u), 2); return f(n(), 250 + 5000 * Math.pow(Math.sin(Math.PI * u), 3), 1.6).bp * env * a * 2.2; }, { gain: 0.5, verb: 0.3, pan: 0 }); }
function riser(B, t, d, a) { const n = noiseGen(3), f = svf(); let ph = 0; voice(B, 'fx', t, d, (i, s) => { const u = s / d; ph += (180 + 900 * u * u) / RATE; const sw = ((ph % 1) * 2 - 1) * 0.25; return (f(n(), 400 + 7000 * u * u, 2).bp * 1.5 + sw * u) * u * u * a; }, { gain: 0.35, verb: 0.3 }); }
function reverse(B, t, d, a) { const n = noiseGen(9), f = svf(); voice(B, 'fx', t, d, (i, s) => { const u = s / d; return f(n(), 6000, 0.8).hp * Math.pow(u, 3) * a; }, { gain: 0.5, verb: 0.2 }); }
function impact(B, t, a) { const n = noiseGen(21), lp = onePole(900); voice(B, 'fx', t, 1.6, (i, s) => { const sub = Math.sin(2 * Math.PI * (38 * s + 30 * (1 - Math.exp(-s * 8)) / 8)) * Math.exp(-s * 3.2); return (sub * 0.8 + lp(n()) * Math.exp(-s * 14) * 1.5) * a; }, { gain: 0.6, verb: 0.35 }); }
function crash(B, t, a) { const n = noiseGen(31), f = svf(); voice(B, 'fx', t, 1.8, (i, s) => f(n(), 7000, 0.7).hp * Math.exp(-s * 2.6) * a, { gain: 0.3, verb: 0.3, pan: -0.1 }); }
function click(B, t, a) { const n = noiseGen(41); voice(B, 'fx', t, 0.05, (i, s) => (Math.sin(2 * Math.PI * 2100 * s) * Math.exp(-s * 120) + n() * Math.exp(-s * 900) * 0.6) * a, { gain: 0.55 }); }
function type(B, t, a, seed) { const n = noiseGen(seed), f = svf(), p = 2400 + (seed % 7) * 260; voice(B, 'fx', t, 0.04, (i, s) => (f(n(), p, 3).bp * 2 + Math.sin(2 * Math.PI * 180 * s) * 0.3) * Math.exp(-s * 160) * a, { gain: 0.45, pan: ((seed % 5) - 2) * 0.12 }); }
function tick(B, t, a) { voice(B, 'fx', t, 0.05, (i, s) => Math.sin(2 * Math.PI * 1800 * s) * Math.exp(-s * 90) * a, { gain: 0.3, delay: 0.3 }); }
function pop(B, t, a, p = 1) { voice(B, 'fx', t, 0.25, (i, s) => Math.sin(2 * Math.PI * (520 * p) * s * (1 + 0.6 * Math.exp(-s * 40))) * Math.exp(-s * 18) * a, { gain: 0.5, verb: 0.2 }); bell(B, t + 0.01, 84 + Math.round(12 * Math.log2(p)), a * 0.6); }
function boing(B, t, a, p = 1) { let ph = 0; voice(B, 'fx', t, 0.7, (i, s) => { const f = (140 + 260 * Math.exp(-s * 7)) * p * (1 + 0.06 * Math.sin(s * 70) * Math.exp(-s * 5)); ph += f / RATE; return Math.sin(ph * 2 * Math.PI) * Math.exp(-s * 5.5) * a; }, { gain: 0.55, verb: 0.2 }); kick(B, t, a * 0.6); }
function draw(B, t, d, a) { const n = noiseGen(55), f = svf(); voice(B, 'fx', t, d, (i, s) => { const wob = 0.6 + 0.4 * Math.sin(s * 38) * Math.sin(s * 7); return f(n(), 2600 + 900 * Math.sin(s * 9), 4).bp * wob * Math.min(1, s * 20) * Math.min(1, (d - s) * 10) * a; }, { gain: 0.35, pan: 0.2 }); }
function slide(B, t, a) { whoosh(B, t + 0.15, 0.35, a * 0.8, 77); }
function sparkle(B, t, a) { [0, 0.07, 0.15, 0.26, 0.4].forEach((d, i) => bell(B, t + d, [88, 91, 95, 93, 100][i], a * 0.5)); }
function drop(B, t, a) { voice(B, 'fx', t, 1.2, (i, s) => Math.sin(2 * Math.PI * (70 * s - 25 * s * s)) * Math.exp(-s * 2.5) * a, { gain: 0.6 }); }

// ——— Effects: Freeverb-style reverb and a ping-pong delay.
function reverb(inp, out, wet = 0.3) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], alls = [556, 441, 341, 225];
  for (const [ch, spread] of [['L', 0], ['R', 23]]) {
    const x = inp[ch], y = new Float32Array(LEN);
    for (const c of combs) { const n = Math.round((c + spread) * RATE / 44100), buf = new Float32Array(n); let k = 0, st = 0; for (let i = 0; i < LEN; i++) { const o = buf[k]; st = o * 0.72 + st * 0.28; buf[k] = x[i] + st * 0.84; y[i] += o; k = (k + 1) % n; } }
    for (const a of alls) { const n = Math.round((a + spread) * RATE / 44100), buf = new Float32Array(n); let k = 0; for (let i = 0; i < LEN; i++) { const b = buf[k], v = -y[i] + b; buf[k] = y[i] + b * 0.5; y[i] = v; k = (k + 1) % n; } }
    for (let i = 0; i < LEN; i++) out[ch][i] += y[i] * wet * 0.12;
  }
}
function pingpong(inp, out, time = T.BEAT * 0.75, fb = 0.42, wet = 0.5) {
  const n = Math.round(time * RATE), bl = new Float32Array(n), br = new Float32Array(n); let k = 0; const lp = [onePole(4200), onePole(4200)];
  for (let i = 0; i < LEN; i++) { const dl = bl[k], dr = br[k]; bl[k] = lp[0](inp.L[i] + inp.R[i] * 0.5 + dr * fb); br[k] = lp[1](dl * fb); out.L[i] += dl * wet; out.R[i] += dr * wet; k = (k + 1) % n; }
}

// ——— The arrangement
const PROG = [[53, 57, 60, 64], [55, 59, 62, 64], [57, 60, 64, 67], [52, 55, 59, 62]];
const ROOTS = [41, 43, 45, 40];
const chordAt = (t) => PROG[Math.floor(t / 2) % 4], rootAt = (t) => ROOTS[Math.floor(t / 2) % 4];
const inAny = (t, spans) => spans.some(([a, b]) => t >= a - 1e-6 && t < b - 1e-6);
const GROOVE = [[4.5, 6.5], [7.0, 9.0], [9.25, 11.0], [11.25, 15.4], [18.5, 21.667]];
const FULL = [[7.0, 9.0], [11.25, 15.4], [20.333, 21.667]];

function render() {
  const B = buses(), kicks = [];
  // Pads: the whole way, quieter in the grooves, big in the break and the end.
  for (let bar = 0; bar < 12; bar++) {
    const t = bar * 2; if (t >= 21.667) break;
    const breakdown = t >= 15.667 - 1 && t < 18.5, cut = breakdown ? 2200 : t < 3 ? 700 : 1100;
    pad(B, t, chordAt(t), Math.min(2, 21.667 - t), breakdown ? 1.3 : t < 3 ? 0.8 : 0.7, cut);
  }
  pad(B, 23.4, [53, 57, 60, 64, 67, 72], 0.6, 1.6, 2600);
  // Arp (16ths): soft intro, grooves, sparkly break.
  for (let s = 0; s < T.DURATION * 8; s++) {
    const t = s / 8; if (!inAny(t, [[0.5, 3.0], [4.5, 6.5], [9.25, 11.0], [15.8, 18.5], [18.5, 21.4]])) continue;
    const ch = chordAt(t), pat = [0, 1, 2, 3, 2, 1, 3, 2], m = ch[pat[s % 8]] + 12 + (t > 15.8 && t < 18.5 && s % 4 === 3 ? 12 : 0);
    pluck(B, t, m, t < 3 ? 0.55 + t * 0.12 : 0.8, t >= 9.25 && t < 11 ? 1400 : 3200);
  }
  // Drums, bass and stabs.
  for (let s = 0; s < T.DURATION * 4; s++) {
    const t = s / 4, beat = s % 2 === 0, onBeat = s % 2 === 0, beatNo = Math.floor(s / 2) % 4;
    if (inAny(t, GROOVE)) {
      if (onBeat) { kick(B, t, 1); kicks.push(t); }
      if (onBeat && (beatNo === 1 || beatNo === 3) && t >= 4.5) clap(B, t, inAny(t, FULL) ? 1 : 0.7);
      if (!beat) hat(B, t, 0.9, beatNo === 3 && inAny(t, FULL));
      if (inAny(t, [[11.25, 15.4]])) hat(B, t + 0.125, 0.45);
      const r = rootAt(t); bass(B, t, s % 4 === 3 ? r + 12 : r, 0.22, inAny(t, FULL) ? 1 : 0.75);
      if (inAny(t, FULL) && !beat && s % 4 === 1) stab(B, t, chordAt(t).map((m) => m + 12), 0.14, 0.9, 1.1);
    }
  }
  [3.0, 3.75, 4.0].forEach((t) => { kick(B, t, 0.9); kicks.push(t); });
  [3.5, 4.25].forEach((t) => clap(B, t, 0.6));
  for (let t = 15.0; t < 15.4; t += 1 / 16) clap(B, t, 0.25 + (t - 15) * 1.6);
  // Finale stutters, one per word.
  [[21.75, 1], [22.25, 0.9], [22.583, 0.9], [22.917, 1]].forEach(([t, a]) => { stab(B, t, [57, 60, 64, 67].map((m) => m + 12), 0.1, a, 1.3); kick(B, t, 1); kicks.push(t); bass(B, t, 45, 0.3, 1); });
  stab(B, 23.4, [53, 57, 60, 64, 67].map((m) => m + 12), 0.4, 1.1, 1.4); kick(B, 23.4, 1.1); kicks.push(23.4); bass(B, 23.4, 41, 0.55, 1.2);
  // Sound design from the film's cues.
  let seed = 100;
  for (const c of T.CUES) {
    const a = c.a || 1; seed++;
    ({ pop: () => pop(B, c.t, a, c.p || 1), whoosh: () => whoosh(B, c.t, c.d || 0.6, a, seed), impact: () => impact(B, c.t, a), riser: () => riser(B, c.t, c.d || 1, a),
      click: () => click(B, c.t, a), type: () => type(B, c.t, a, seed), swish: () => whoosh(B, c.t, c.d || 0.4, a * 0.7, seed), boing: () => boing(B, c.t, a, c.p || 1),
      burst: () => { impact(B, c.t, a); crash(B, c.t, a); whoosh(B, c.t, 0.25, a * 0.6, seed); }, sparkle: () => sparkle(B, c.t, a), slide: () => slide(B, c.t, a),
      tick: () => tick(B, c.t, a), drop: () => drop(B, c.t, a), draw: () => draw(B, c.t, c.d || 1, a), reverse: () => reverse(B, c.t, c.d || 0.5, a) }[c.k] || (() => {}))();
  }
  // Duck the music under each kick (sidechain), then effects and the master.
  const duck = new Float32Array(LEN).fill(1);
  for (const k of kicks) { const s0 = Math.round(k * RATE); for (let i = 0; i < RATE * 0.3 && s0 + i < LEN; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - 0.55 * Math.exp(-i / RATE * 11)); }
  const mix = { L: new Float32Array(LEN), R: new Float32Array(LEN) };
  pingpong(B.delay, B.music);
  reverb(B.verb, mix, 1);
  const hpL = svf(), hpR = svf();
  for (let i = 0; i < LEN; i++) {
    mix.L[i] += B.drums.L[i] * 0.9 + B.music.L[i] * duck[i] + B.fx.L[i];
    mix.R[i] += B.drums.R[i] * 0.9 + B.music.R[i] * duck[i] + B.fx.R[i];
    mix.L[i] = hpL(mix.L[i], 28, 0.7).hp; mix.R[i] = hpR(mix.R[i], 28, 0.7).hp;
  }
  // Glue: gentle soft clip, fade the last moment, then normalise to -1 dBFS.
  let peak = 0;
  for (let i = 0; i < LEN; i++) {
    const fade = Math.min(1, (LEN - i) / (RATE * 0.25));
    mix.L[i] = Math.tanh(mix.L[i] * 1.25) * fade; mix.R[i] = Math.tanh(mix.R[i] * 1.25) * fade;
    peak = Math.max(peak, Math.abs(mix.L[i]), Math.abs(mix.R[i]));
  }
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < LEN; i++) { mix.L[i] *= g; mix.R[i] *= g; }
  return { left: mix.L, right: mix.R, rate: RATE, peak: +(peak * g).toFixed(4) };
}

function wav(left, right, rate = RATE) {
  const n = left.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4); }
  return buf;
}

module.exports = { render, wav, RATE };
if (require.main === module) {
  const path = require('path'), fs = require('fs'), out = path.join(__dirname, 'out', 'music.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const m = render(); fs.writeFileSync(out, wav(m.left, m.right, m.rate)); console.log('Wrote', out, 'peak', m.peak);
}
