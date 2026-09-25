// Suggested groups and matching sets (build plan A3). Pure functions: they read items, recognition
// results and fingerprints and propose groups. They never move, change or delete anything; the user
// keeps a suggestion as a board, renames it or dismisses it (remembered in <library>/ai/suggestions.json).
const crypto = require('crypto');

const FAMILY = { 'light grey': 'grey', denim: 'blue', 'light blue': 'blue', khaki: 'beige', cream: 'white', tan: 'brown', mustard: 'yellow', lilac: 'purple', burgundy: 'red', olive: 'green', teal: 'green' };
const family = (c) => FAMILY[c] || c;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// What an item is, with the user's corrections winning over what was recognised.
function labelsOf(it) {
  const ai = it.ai || {}, l = it.labels || {};
  const main = l.main || (ai.type && ai.type.main) || null;
  const extra = l.extra || (ai.type && ai.type.extra) || [];
  return { main, types: main ? [main, ...extra.filter((t) => t !== main)] : extra, styles: l.styles || ai.styles || [], colours: ai.colours || [] };
}

const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const sig = (kind, ids) => kind + ':' + crypto.createHash('sha1').update(ids.slice().sort().join(',')).digest('hex').slice(0, 12);

// sRGB hex -> CIE Lab, for colour distances that match what eyes see.
function lab(hex) {
  const n = parseInt(String(hex || '#808080').slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const X = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047, Y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, Z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
// How well two palettes go together (0-1): each colour of one against its nearest in the other, by how much it covers.
function paletteMatch(a, b) {
  if (!a.length || !b.length) return 0;
  const near = (x, ys) => Math.max(...ys.map((y) => { const p = lab(x.hex), q = lab(y.hex); return Math.exp(-Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 22); }));
  const one = (xs, ys) => xs.reduce((s, x) => s + x.share * near(x, ys), 0) / (xs.reduce((s, x) => s + x.share, 0) || 1);
  return (one(a, b) + one(b, a)) / 2;
}

const mostCommon = (xs) => { const m = new Map(); for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
// Near-identical pictures (the same photo saved twice) count once, so they never make a "group" of their own.
function distinct(items, emb) {
  const kept = [];
  for (const it of items) if (!emb[it.id] || !kept.some((k) => emb[k.id] && cos(emb[k.id], emb[it.id]) > 0.97)) kept.push(it);
  return kept;
}
const cohesion = (ids, emb) => { let s = 0, n = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (emb[ids[i]] && emb[ids[j]]) { s += cos(emb[ids[i]], emb[ids[j]]); n++; } return n ? s / n : 0; };

// Outfit groups: outfits that look alike (their fingerprints cluster together), named by their most
// common style and clothing colour; plus whole-style / whole-colour collections when they hang together.
function outfitGroups(items, emb) {
  const outfits = distinct(items.filter((it) => labelsOf(it).types.includes('outfit') && emb[it.id]), emb);
  const name = (ids) => {
    const L = ids.map((id) => labelsOf(outfits.find((o) => o.id === id)));
    // The style the whole group leans to most (summed style scores), else the most common top style.
    const sums = {};
    for (const id of ids) { const it = outfits.find((o) => o.id === id); const sc = !it.labels?.styles && it.ai?.styleScores; if (sc) for (const [k, v] of Object.entries(sc)) sums[k] = (sums[k] || 0) + v; }
    const st = Object.keys(sums).length ? Object.entries(sums).sort((a, b) => b[1] - a[1])[0][0] : mostCommon(L.map((x) => x.styles[0])), co = mostCommon(L.map((x) => family((x.colours[0] || {}).name || '')));
    return [co ? cap(co) : '', st || 'outfits'].filter(Boolean).join(' ');
  };
  // Average-link clustering: keep joining the two most alike groups while they're still clearly alike.
  let clusters = outfits.map((it) => [it.id]);
  for (;;) {
    let best = null;
    for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
      let s = 0; for (const x of clusters[a]) for (const y of clusters[b]) s += cos(emb[x], emb[y]);
      s /= clusters[a].length * clusters[b].length;
      if (!best || s > best.s) best = { a, b, s };
    }
    if (!best || best.s < 0.6) break;
    clusters[best.a] = clusters[best.a].concat(clusters[best.b]);
    clusters.splice(best.b, 1);
  }
  const groups = clusters.filter((c) => c.length >= 2).map((ids) => ({ kind: 'outfits', name: name(ids), ids }));
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const addWide = (label, ids) => { if (ids.length >= 3 && cohesion(ids, emb) >= 0.5 && !groups.some((g) => same(g.ids, ids))) groups.push({ kind: 'outfits', name: label, ids }); };
  const by = (f) => { const m = new Map(); for (const it of outfits) { const k = f(labelsOf(it)); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(it.id); } } return m; };
  for (const [st, ids] of by((L) => L.styles[0])) addWide(`All ${st}`, ids);
  for (const [co, ids] of by((L) => family((L.colours[0] || {}).name || ''))) addWide(`${cap(co)} outfits`, ids);
  // Two groups with the same name read as one: number them.
  const seen = new Map();
  for (const g of groups) { const n = (seen.get(g.name) || 0) + 1; seen.set(g.name, n); if (n > 1) g.name += ` ${n}`; }
  return groups.sort((x, y) => cohesion(y.ids, emb) - cohesion(x.ids, emb)).slice(0, 5);
}

// Matching sets: a wallpaper with the icon and profile picture that suit it best: colours that go
// together plus a similar look (the fingerprints), with a little variety so it isn't the same few pictures.
function matchingSets(items, emb) {
  // Clean examples only: a street photo that also reads as a profile picture isn't used as one.
  // Clean, confident examples only: a street photo that also reads as a profile picture isn't used as one,
  // and neither is anything the PC wasn't sure about (unless you set its type yourself).
  const of = (type) => distinct(items.filter((it) => { const L = labelsOf(it); return L.main === type && !L.types.includes('outfit') && (it.labels?.main === type || !(it.ai?.type?.conf < 0.55)); }), emb);
  const walls = of('wallpaper'), icons = of('icon'), pfps = of('profile picture');
  if (!walls.length || !icons.length || !pfps.length) return [];
  const look = (a, b) => (emb[a.id] && emb[b.id] ? Math.max(0, Math.min(1, (cos(emb[a.id], emb[b.id]) - 0.45) / 0.35)) : 0);
  const score = (a, b) => 0.4 * paletteMatch(labelsOf(a).colours, labelsOf(b).colours) + 0.6 * look(a, b); // a shared look matters more than shared colours
  const sets = [];
  for (const w of walls) for (const i of icons) for (const p of pfps) sets.push({ ids: [w.id, i.id, p.id], score: score(w, i) + score(w, p) + score(i, p), colour: family((labelsOf(w).colours[0] || {}).name || 'mixed') });
  const uses = new Map(), out = [];
  const used = (id) => uses.get(id) || 0;
  for (const s of sets.sort((x, y) => y.score - x.score)) {
    if (s.score < 1.1) break; // below this they don't really go together
    if (s.ids.some((id) => used(id) >= 2)) continue;
    s.ids.forEach((id) => uses.set(id, used(id) + 1));
    out.push({ kind: 'set', name: `${cap(s.colour)} set`, ids: s.ids, score: +s.score.toFixed(3) });
    if (out.length === 3) break; // the best few; more read as a wall of near-copies
  }
  const seen = new Map();
  for (const g of out) { const n = (seen.get(g.name) || 0) + 1; seen.set(g.name, n); if (n > 1) g.name += ` ${n}`; }
  return out;
}

// All suggestions, minus dismissed ones, with the user's names applied.
function suggestions(items, emb, memory = {}) {
  const live = items.filter((it) => !it.deletedAt);
  const all = [...outfitGroups(live, emb), ...matchingSets(live, emb)].map((g) => ({ ...g, sig: sig(g.kind, g.ids) }));
  const dismissed = new Set(memory.dismissed || []), names = memory.names || {};
  return all.filter((g) => !dismissed.has(g.sig)).map((g) => ({ ...g, name: names[g.sig] || g.name }));
}

module.exports = { suggestions, outfitGroups, matchingSets, labelsOf, paletteMatch, family };
