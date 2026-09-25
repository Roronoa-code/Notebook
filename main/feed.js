// Ideas: a Pinterest-style feed inside Notebook. "For you" on All items and "Ideas" on each board,
// picked from Pinterest (your Pinterest home feed when you're signed in to the Pinterest panel, "More
// like this" for pins you saved there, and searches made from what's on the board), then ranked on this
// PC by how much each pin looks like the board. Promoted pins and AI-made pins are left out.
// Pinterest is only asked when a feed is looked at (or has gone stale for the phone), one feed at a time.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { isAd } = require('./adfilter');
const { labelsOf, family } = require('./suggest');

const BASE = 'https://www.pinterest.com';
const STALE = 3 * 60 * 60 * 1000; // looked at after this long, a feed is refreshed
const PER_BATCH = 60;              // new pins checked per load
const KEEP = 300;                  // pins kept per feed
const SAME = 0.92;                 // this alike (fingerprints) counts as the same picture: one you have, or one already shown
const DOUBT = 0.5;                 // the quick AI detector's score from which a pin needs a second opinion
const TYPE_WORD = { outfit: 'outfit', wallpaper: 'wallpaper', icon: 'app icon', 'profile picture': 'pfp' };
// What went wrong, in plain words (shown on the PC and the phone).
const WHY = {
  offline: 'Couldn’t reach Pinterest. Check the internet connection and try again.',
  busy: 'Pinterest asked Notebook to slow down. Try again in a few minutes.',
  down: 'Pinterest isn’t answering properly just now. Try again later.',
  changed: 'Pinterest has changed how it works, so Notebook can’t get ideas from it. Notebook needs an update for this.',
  empty: 'Pinterest sent no pins back. If this keeps happening, Pinterest may have changed and Notebook needs an update.',
  broken: 'Something went wrong while finding ideas. Try again.'
};
const failure = (kind, message) => Object.assign(new Error(message), { kind });

const signatureOf = (url) => { const m = /\/([0-9a-f]{32})\.(?:jpe?g|png|webp|gif)/i.exec(String(url || '')); return m ? m[1].toLowerCase() : null; };
const pinIdOf = (url) => { const m = /pinterest\.[a-z.]+\/pin\/(\d+)/i.exec(String(url || '')); return m ? m[1] : null; };
const clean = (s) => String(s || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const shuffle = (xs) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mostCommon = (xs) => { const m = new Map(); for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };

// Every pin in one of Pinterest's answers, wherever it sits in it.
function pinsIn(data, out = [], depth = 0) {
  if (depth > 8 || !data || typeof data !== 'object') return out;
  if (!Array.isArray(data) && data.type === 'pin' && data.images) { out.push(data); return out; }
  for (const v of Array.isArray(data) ? data : Object.values(data)) pinsIn(v, out, depth + 1);
  return out;
}

// What Notebook keeps of a pin. Promoted pins are dropped here.
function pinFrom(o) {
  if (!o || isAd(o) || !/^\d+$/.test(String(o.id))) return null;
  const big = o.images['474x'] || o.images['736x'] || o.images['236x'], small = o.images['236x'] || big;
  const sig = big && signatureOf(big.url);
  if (!sig || !small || !small.url) return null;
  const video = o.videos != null || (!!o.story_pin_data && /"video_list"/.test(JSON.stringify(o.story_pin_data)));
  return { id: String(o.id), url: `${BASE}/pin/${o.id}/`, img: big.url, small: small.url, w: big.width || 474, h: big.height || 600, title: clean(o.grid_title || o.title || o.description), video, sig };
}

// Pinterest's own data routes, asked the way its website asks them, signed in as you (the Pinterest
// panel's session). Search and "More like this" work signed out too; the home feed needs you signed in.
class PinterestSource {
  constructor(getSession) { this.ses = getSession; }
  async call(resource, sourceUrl, options) {
    const u = `${BASE}/resource/${resource}/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}`;
    let res;
    try { res = await this.ses().fetch(u, { credentials: 'include', signal: AbortSignal.timeout(20000), headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'X-Pinterest-PWS-Handler': 'www/index.js' } }); } catch (err) { throw failure('offline', err.message); }
    if (res.status === 401) return { pins: [], bookmark: null, signedOut: true };
    if (!res.ok) throw failure(res.status === 429 ? 'busy' : res.status >= 500 ? 'down' : 'changed', `Pinterest answered ${res.status}`);
    let r;
    try { r = (await res.json()).resource_response; } catch (err) { throw failure('changed', 'not JSON: ' + err.message); }
    if (!r || typeof r !== 'object') throw failure('changed', 'no resource_response');
    return { pins: pinsIn(r.data).map(pinFrom).filter(Boolean), bookmark: r.bookmark && r.bookmark !== '-end-' ? r.bookmark : null };
  }
  page(s) {
    const bookmarks = s.bookmark ? [s.bookmark] : [];
    if (s.kind === 'home') return this.call('UserHomefeedResource', '/', { field_set_key: 'hf_grid', in_nux: false, prependPartner: false, prependUserNews: false, static_feed: false, bookmarks });
    if (s.kind === 'related') return this.call('RelatedModulesResource', `/pin/${s.arg}/`, { pin_id: s.arg, context_pin_ids: [], search_query: '', source: 'deep_linking', top_level_source: 'deep_linking', top_level_source_depth: 1, is_pdp: false, page_size: 25, bookmarks });
    return this.call('BaseSearchResource', `/search/pins/?q=${encodeURIComponent(s.arg)}&rs=typed`, { query: s.arg, scope: 'pins', page_size: 25, bookmarks });
  }
  async bytes(url) {
    try { const r = await this.ses().fetch(url, { signal: AbortSignal.timeout(15000) }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; } catch { return null; }
  }
}

// A stand-in for the checks (NOTEBOOK_FAKE_FEED=1): made-up pins with plain coloured pictures, no internet.
class FakeSource {
  constructor(fail = null) { this.fail = fail; } // 'offline', 'changed'…: every page fails that way
  async page(s) {
    await new Promise((r) => setTimeout(r, 150));
    if (this.fail) throw failure(this.fail, 'stand-in failure');
    const start = s.bookmark ? Number(s.bookmark) : 0;
    const pins = Array.from({ length: 12 }, (_, i) => {
      const n = 100000 + (s.kind === 'home' ? 0 : s.kind === 'related' ? 5000 : 9000) + (s.arg || '').length * 100 + start + i;
      const sig = (n.toString(16) + 'a'.repeat(32)).slice(0, 32);
      return { id: String(n), url: `${BASE}/pin/${n}/`, img: `https://i.pinimg.com/474x/aa/bb/cc/${sig}.jpg`, small: `https://i.pinimg.com/236x/aa/bb/cc/${sig}.jpg`, w: 474, h: 474 + (n % 5) * 60, title: `Idea ${n}`, video: n % 7 === 0, sig };
    });
    return { pins, bookmark: start < 24 ? String(start + 12) : null, signedOut: s.kind === 'home' };
  }
  async bytes(url) {
    const n = parseInt(signatureOf(url).slice(0, 5), 16);
    return require('sharp')({ create: { width: 236, height: 300, channels: 3, background: { r: (n * 37) % 256, g: (n * 91) % 256, b: (n * 53) % 256 } } }).jpeg().toBuffer();
  }
}

// The searches that describe a board (or the whole library): its name, its usual colour, style and
// type, and the names of a couple of things on it.
function queriesFor(items, board) {
  const L = items.map(labelsOf);
  const type = mostCommon(L.map((x) => x.main)), word = TYPE_WORD[type] || '';
  const style = mostCommon(L.map((x) => x.styles[0])), colour = mostCommon(L.map((x) => family((x.colours[0] || {}).name || '')));
  const qs = [];
  if (board && !/^new board$/i.test(board.name.trim())) qs.push(board.name.toLowerCase().includes(word.split(' ').pop()) || !word ? board.name : `${board.name} ${word}`);
  const described = [colour, style, word].filter(Boolean);
  if (described.length >= 2) qs.push(described.join(' '));
  for (const it of shuffle(items.filter((i) => i.aiName)).slice(0, 2)) {
    const w = TYPE_WORD[labelsOf(it).main] || '';
    qs.push(w && !it.aiName.toLowerCase().includes(w) ? `${it.aiName} ${w}` : it.aiName);
  }
  const seen = new Set();
  return qs.map((q) => q.trim().toLowerCase()).filter((q) => q && !seen.has(q) && seen.add(q)).slice(0, 3);
}

// How much a pin looks like a set of pictures: the mean of its three closest matches.
function closeness(v, vecs) {
  if (!v || !vecs.length) return 0;
  const s = vecs.map((u) => (u.length === v.length ? dot(u, v) : 0)).sort((a, b) => b - a).slice(0, 3);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

// Best matches first, but not ten of the same thing in a row; pins too like one you hid go down.
function rank(cands, profile, hiddenVecs, shown) {
  for (const c of cands) {
    c.score = closeness(c.vec, profile);
    const avoid = c.vec ? Math.max(0, ...hiddenVecs.filter((u) => u.length === c.vec.length).map((u) => dot(u, c.vec))) : 0;
    c.score -= Math.max(0, avoid - 0.6);
  }
  let left = cands.slice();
  // A board's feed stays on topic: the weakest quarter of a batch is left out.
  if (profile.length && left.length > 16) { const cut = left.map((c) => c.score).sort((a, b) => a - b)[Math.floor(left.length / 4)]; left = left.filter((c) => c.score >= cut); }
  const picked = [], recent = shown.filter((p) => p.vec).slice(-20);
  while (left.length) {
    let best = -1, bestV = -Infinity;
    for (let i = 0; i < left.length; i++) {
      const c = left[i];
      const same = c.vec ? Math.max(0, ...[...recent, ...picked.slice(-20)].filter((p) => p.vec && p.vec.length === c.vec.length).map((p) => dot(p.vec, c.vec))) : 0;
      const v = c.score - 0.4 * Math.max(0, same - 0.55) - (same > SAME ? 10 : 0);
      if (v > bestV) { bestV = v; best = i; }
    }
    const [c] = left.splice(best, 1);
    if (bestV > -5) picked.push(c); // near-copies of a pin already shown are dropped
  }
  return picked;
}

// Runs `fn` over `xs`, `n` at a time.
async function pool(xs, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) await fn(xs[i++]); }));
}

class Feed {
  // getLib(); embeddings(lib) -> { itemId: vec }; embed(bytes) -> vec|null; aiHide(url, bytes) -> bool (full
  // check); aiQuick(bytes) -> quick detector's score|null; aiKnown(url) -> true/false if already decided, else null;
  // source: PinterestSource or FakeSource; dir: where feeds and pictures are kept; onChange(key).
  constructor({ getLib, embeddings, embed, aiHide, aiQuick = async () => 0, aiKnown = () => null, prepare = async () => {}, source, dir, onChange = () => {}, log = console }) {
    Object.assign(this, { getLib, embeddings, embed, aiHide, aiQuick, aiKnown, prepare, source, dir, onChange, log });
    this.file = path.join(dir, 'feeds.json');
    this.imgDir = path.join(dir, 'img');
    this.state = { v: 1, feeds: {}, hidden: [], hiddenVecs: [] };
    try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (s.v === 1) this.state = { ...this.state, ...s }; } catch { /* first time */ }
    for (const f of Object.values(this.state.feeds)) f.busy = false;
    this.vecs = new Map(); // picture fingerprint by pin, for this session
    this.queue = Promise.resolve();
    this.waiting = new Set();
    this.fetching = new Map();
  }

  feed(key) { return this.state.feeds[key] || (this.state.feeds[key] = { at: 0, pins: [], sources: [], signedIn: null, error: null, busy: false }); }
  savedIds() { const lib = this.getLib(); return new Set(lib ? lib.data.items.filter((i) => !i.deletedAt).map((i) => pinIdOf(i.source)).filter(Boolean) : []); }
  validKey(key) { const lib = this.getLib(); return key === 'all' || !!(lib && lib.data.boards.some((b) => b.id === key)); }

  // A feed as the page (or the phone) shows it. Loads it first if it's empty or stale.
  get(key, { load = true } = {}) {
    if (!this.validKey(key)) return null;
    const f = this.feed(key), saved = this.savedIds();
    if (load) f.seen = Date.now();
    if (load && !f.busy && (!f.pins.length || Date.now() - f.at > STALE)) this.load(key, 'fresh');
    return { key, at: f.at, busy: f.busy || [...this.waiting].some((j) => j.startsWith(key + ':')), signedIn: f.signedIn, error: f.error, more: f.sources.some((s) => s.bookmark),
      pins: f.pins.map((p) => ({ id: p.id, url: p.url, title: p.title, w: p.w, h: p.h, video: p.video, sig: p.sig, saved: saved.has(p.id) })) };
  }

  // Queues a load: 'fresh' replaces the feed, 'more' adds the next page. One at a time, never twice.
  load(key, mode) {
    const job = key + ':' + mode;
    if (this.waiting.has(job) || !this.validKey(key)) return this.queue;
    this.waiting.add(job);
    this.onChange(key);
    this.queue = this.queue.then(() => this.build(key, mode)).catch((err) => this.log.error('feed', err)).finally(() => { this.waiting.delete(job); this.onChange(key); });
    return this.queue;
  }

  async build(key, mode) {
    const lib = this.getLib();
    if (!lib || !this.validKey(key)) return;
    const f = this.feed(key);
    f.busy = true; this.onChange(key);
    try {
      const items = lib.data.items.filter((i) => !i.deletedAt && i.kind !== 'note' && (key === 'all' || i.boards.includes(key)));
      let sources;
      if (mode === 'more') sources = f.sources.filter((s) => s.bookmark);
      else {
        const board = key === 'all' ? null : lib.data.boards.find((b) => b.id === key);
        const seeds = shuffle([...new Set(items.map((i) => pinIdOf(i.source)).filter(Boolean))]).slice(0, key === 'all' ? 2 : 3);
        sources = [...(key === 'all' ? [{ kind: 'home' }] : []), ...seeds.map((arg) => ({ kind: 'related', arg })), ...queriesFor(items, board).map((arg) => ({ kind: 'search', arg }))];
        if (!sources.length) sources = [{ kind: 'search', arg: 'aesthetic mood board' }];
      }
      if (!sources.length) return;
      this.prepare().catch(() => {}); // the models load while Pinterest answers
      const pages = await Promise.all(sources.map((s) => this.source.page(s).then((p) => ({ s, p }), (err) => ({ s, err }))));
      for (const x of pages) if (x.err) this.log.error('feed', `${x.s.kind} ${x.err.message}`);
      if (pages.every((x) => x.err)) { f.error = WHY[pages[0].err.kind] || WHY.offline; return; }
      if (pages.every((x) => !x.p.pins.length) && sources.length > 1) { f.error = WHY.empty; return; }
      const home = pages.find((x) => x.s.kind === 'home');
      if (home && home.p) f.signedIn = !home.p.signedOut;
      const next = pages.map(({ s, p }) => ({ ...s, bookmark: p ? p.bookmark : null }));
      // Take turns from each source, skipping pins already shown, hidden or saved.
      const skip = new Set([...(mode === 'more' ? f.pins.map((p) => p.id) : []), ...this.state.hidden, ...this.savedIds()]);
      const sigs = new Set(mode === 'more' ? f.pins.map((p) => p.sig) : []);
      const lists = pages.map((x) => (x.p ? x.p.pins : [])), cands = [];
      for (let i = 0; cands.length < PER_BATCH && lists.some((l) => i < l.length); i++) {
        for (const l of lists) { const p = l[i]; if (p && !skip.has(p.id) && !sigs.has(p.sig)) { skip.add(p.id); sigs.add(p.sig); cands.push(p); } }
      }
      // Each picture is looked at on this PC. The quick AI detector sorts them first: clearly real pins
      // show straight away; doubtful ones wait for the stronger detector's second opinion and are
      // added below if they pass. AI-made pins are left out; the rest get a fingerprint for ranking.
      await pool(cands, 6, async (c) => {
        c.bytes = await this.source.bytes(c.small);
        if (!c.bytes) { c.drop = true; return; }
        const known = this.aiKnown(c.small);
        if (known === true) { c.drop = true; return; }
        const quick = known === false ? 0 : await this.aiQuick(c.bytes);
        c.doubt = quick != null && quick >= DOUBT;
        c.vec = this.vecs.get(c.sig) || await this.embed(c.bytes).catch(() => null);
        if (c.vec) this.vecs.set(c.sig, c.vec);
      });
      const emb = await this.embeddings(lib);
      const mine = items.map((i) => emb[i.id]).filter(Boolean);
      const profile = key === 'all' ? mine.slice(-400) : mine;
      // Already in your notebook (the same picture): not an idea.
      const ranked = (list, shown) => rank(list.filter((c) => !c.drop && !(c.vec && mine.some((u) => u.length === c.vec.length && dot(u, c.vec) > SAME))), profile, this.state.hiddenVecs, shown)
        .map(({ vec, drop, score, bytes, doubt, ...p }) => p);
      const shownOf = (pins) => pins.map((p) => ({ vec: this.vecs.get(p.sig) }));
      const clear = cands.filter((c) => !c.doubt), doubtful = cands.filter((c) => c.doubt && !c.drop);
      const early = ranked(clear, mode === 'more' ? shownOf(f.pins) : []);
      f.pins = (mode === 'more' ? [...f.pins, ...early] : early).slice(0, KEEP);
      f.error = null;
      if (mode === 'fresh') f.at = Date.now();
      f.sources = next;
      // Doubtful pins get their second opinion without holding up the next page; the ones that pass go below.
      if (doubtful.length) {
        f.checking = (f.checking || 0) + 1;
        pool(doubtful, 3, async (c) => { if (await this.aiHide(c.small, c.bytes)) c.drop = true; })
          .then(() => { const have = new Set(f.pins.map((p) => p.id)); f.pins = [...f.pins, ...ranked(doubtful.filter((c) => !have.has(c.id)), shownOf(f.pins))].slice(0, KEEP); })
          .catch((err) => this.log.error('feed', err))
          .finally(() => { f.checking--; this.onChange(key); this.save().catch((err) => this.log.error('feed', err)); });
      }
    } catch (err) {
      f.error = WHY.broken;
      throw err;
    } finally {
      f.busy = false;
      await this.save();
    }
  }

  // "Not for me": the pin goes, and pins like it are ranked lower from now on.
  async hide(pinId) {
    pinId = String(pinId);
    let sig = null;
    for (const f of Object.values(this.state.feeds)) { const p = f.pins.find((x) => x.id === pinId); if (p) sig = p.sig; f.pins = f.pins.filter((x) => x.id !== pinId); }
    this.state.hidden = [...this.state.hidden.filter((x) => x !== pinId), pinId].slice(-3000);
    const vec = sig && this.vecs.get(sig);
    if (vec) this.state.hiddenVecs = [...this.state.hiddenVecs, vec].slice(-200);
    await this.save();
  }

  // The file for a pin's picture (downloaded the first time it's shown), or null. `big`: the sharper
  // copy for the close-up.
  async image(sig, big = false) {
    if (!/^[0-9a-f]{32}$/.test(sig)) return null;
    const name = sig + (big ? '-big' : ''), file = path.join(this.imgDir, name + '.jpg');
    if (fs.existsSync(file)) return file;
    const pin = Object.values(this.state.feeds).flatMap((f) => f.pins).find((p) => p.sig === sig);
    if (!pin) return null;
    if (!this.fetching.has(name)) {
      this.fetching.set(name, (async () => {
        const bytes = (big && await this.source.bytes(pin.img.replace(/\/\d+x\//, '/736x/'))) || await this.source.bytes(pin.img) || await this.source.bytes(pin.small);
        if (!bytes) return null;
        await fsp.mkdir(this.imgDir, { recursive: true });
        await fsp.writeFile(file + '.tmp', bytes);
        await fsp.rename(file + '.tmp', file);
        return file;
      })().catch(() => null).finally(() => this.fetching.delete(name)));
    }
    return this.fetching.get(name);
  }

  // Keeps For you and the boards looked at in the last week fresh in the background, so opening their
  // Ideas is instant. (Other boards load when first opened.)
  warm() {
    for (const [k, f] of Object.entries(this.state.feeds)) {
      if (this.validKey(k) && !f.busy && Date.now() - f.at > STALE && (k === 'all' || Date.now() - (f.seen || 0) < 7 * 864e5)) this.load(k, 'fresh');
    }
  }

  // Every feed for the phone (All and each board), stale ones refreshed in the background for next time.
  // `want`: the feed the phone is looking at ('all' or a board): loaded now if it has none yet, and with
  // `more`, its next page (waiting up to 20 seconds). That feed is sent whole; the others' first 150 pins.
  async forPhone(want, more = false) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (want && this.validKey(want)) {
      const had = this.feed(want).pins.length;
      if (more && had && this.feed(want).sources.some((s) => s.bookmark)) await Promise.race([this.load(want, 'more'), wait(20000)]);
      else { this.get(want); if (!had) await Promise.race([this.queue, wait(15000)]); } // a first set, if it's quick
    }
    const lib = this.getLib();
    const keys = ['all', ...(lib ? lib.data.boards.filter((b) => b.phone !== false).map((b) => b.id) : [])];
    const feeds = {};
    for (const k of keys) { const f = this.get(k, { load: false }); if (f) feeds[k] = { at: f.at, signedIn: f.signedIn, error: f.error, more: f.more, pins: f.pins.slice(0, k === want ? KEEP : 150) }; }
    this.warm();
    return { feeds };
  }

  // One save at a time (they share a temporary file).
  save() {
    const run = () => this.write();
    this.saving = (this.saving || Promise.resolve()).then(run, run);
    return this.saving;
  }

  async write() {
    const { feeds, hidden, hiddenVecs } = this.state;
    // The feeds themselves stay the same objects (a load still running keeps adding to them); only the
    // written copy leaves out the busy flag, and feeds of deleted boards go.
    for (const k of Object.keys(feeds)) if (!this.validKey(k)) delete feeds[k];
    const keep = Object.fromEntries(Object.entries(feeds).map(([k, { busy, checking, ...f }]) => [k, f]));
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.file + '.tmp', JSON.stringify({ v: 1, feeds: keep, hidden, hiddenVecs }));
    await fsp.rename(this.file + '.tmp', this.file);
    // Pictures no feed shows any more are removed.
    const used = new Set(Object.values(keep).flatMap((f) => f.pins.flatMap((p) => [p.sig + '.jpg', p.sig + '-big.jpg'])));
    const files = await fsp.readdir(this.imgDir).catch(() => []);
    await Promise.all(files.filter((x) => x.endsWith('.jpg') && !used.has(x)).map((x) => fsp.rm(path.join(this.imgDir, x), { force: true })));
  }
}

module.exports = { Feed, PinterestSource, FakeSource, pinFrom, pinsIn, pinIdOf, queriesFor, rank };
