// Phone <-> PC merge, following docs/SYNC.md exactly. Plain functions so they can be tested alone.
// The PC does all the merging; the phone adopts whatever comes back.

const TOMBSTONE_DAYS = 90;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = ['photo', 'video', 'note'];

class SyncError extends Error {
  constructor(message, status = 400) { super(message); this.friendly = message; this.status = status; }
}

const time = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

// A crop is { x, y, w, h }: fractions of the picture (the file itself is never changed).
// Returns a clean copy, or null if it isn't a sensible crop.
function cleanCrop(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const v = ['x', 'y', 'w', 'h'].map((k) => c[k]);
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, w, h] = v;
  if (x < 0 || y < 0 || w < 0.02 || h < 0.02 || x + w > 1.001 || y + h > 1.001) return null;
  return { x, y, w, h };
}

// Checks what the phone sent before anything is merged. Anything odd rejects the whole sync
// rather than quietly dropping it, because the phone replaces its own list with our answer.
function cleanRemote(body) {
  const bad = (why) => { throw new SyncError(`The phone sent a library Notebook couldn't read (${why}). Nothing was changed.`); };
  if (!body || typeof body !== 'object') bad('not a library');
  if (!Array.isArray(body.boards) || !Array.isArray(body.items)) bad('boards or items missing');
  const t = body.tombstones || { items: [], boards: [] };
  if (typeof t !== 'object' || !Array.isArray(t.items || []) || !Array.isArray(t.boards || [])) bad('tombstones');
  const seen = new Set();
  const checkId = (id, what) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) bad(`${what} id`);
  };
  for (const b of body.boards) {
    if (!b || typeof b !== 'object') bad('board');
    checkId(b.id, 'board');
    if (seen.has('b' + b.id)) bad('duplicate board');
    seen.add('b' + b.id);
    if (typeof b.name !== 'string' || !b.name.trim()) bad('board name');
    if (!isIso(b.updatedAt)) bad('board date');
  }
  for (const it of body.items) {
    if (!it || typeof it !== 'object') bad('item');
    checkId(it.id, 'item');
    if (seen.has('i' + it.id)) bad('duplicate item');
    seen.add('i' + it.id);
    if (!KINDS.includes(it.kind)) bad('item type');
    if (!isIso(it.updatedAt)) bad('item date');
    if (!Array.isArray(it.boards) || it.boards.some((x) => typeof x !== 'string')) bad('item boards');
    if (it.deletedAt != null && !isIso(it.deletedAt)) bad('bin date');
    if (typeof it.title !== 'string') bad('item title');
    if (it.stack != null && (typeof it.stack !== 'string' || !ID_RE.test(it.stack))) bad('item stack');
    if (it.stackIn != null && (typeof it.stackIn !== 'string' || !ID_RE.test(it.stackIn))) bad('item stack board');
    if (it.labels != null && (typeof it.labels !== 'object' || Array.isArray(it.labels))) bad('item labels');
    if (it.crop != null && !cleanCrop(it.crop)) bad('item crop');
    delete it.phone; // "show on phone" belongs to the PC; whatever the phone sends is ignored
    if (it.kind === 'note') {
      if (it.file != null) bad('a note with a file');
    } else {
      // file must be exactly media/<id><ext>: this is what keeps uploads inside the media folder.
      const m = typeof it.file === 'string' && /^media\/([A-Za-z0-9_-]{1,64})(\.[a-z0-9]{1,8})$/.exec(it.file);
      if (!m || m[1] !== it.id) bad('file name');
    }
  }
  const tombs = (list) => list.map((x) => {
    if (!x || typeof x !== 'object') bad('tombstone');
    checkId(x.id, 'tombstone');
    if (!isIso(x.at)) bad('tombstone date');
    return { id: x.id, at: x.at };
  });
  return { boards: body.boards, items: body.items, tombstones: { items: tombs(t.items || []), boards: tombs(t.boards || []) } };
}

// Rule 1: union of both sides; for the same id keep the latest `at`.
function unionTombstones(a, b) {
  const map = new Map();
  for (const x of [...a, ...b]) {
    const have = map.get(x.id);
    if (!have || time(x.at) > time(have.at)) map.set(x.id, { id: x.id, at: x.at });
  }
  return [...map.values()];
}

function pruneTombstones(tombstones, nowMs = Date.now()) {
  const cutoff = nowMs - TOMBSTONE_DAYS * 864e5;
  const keep = (list) => list.filter((x) => time(x.at) >= cutoff);
  return { items: keep(tombstones.items || []), boards: keep(tombstones.boards || []) };
}

// Replaces the contents of `target` with `source`, keeping the same object so anything
// holding a reference to the item (e.g. a thumbnail being saved) still points at the live one.
function replaceInPlace(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}

const fill = (v) => (v == null ? null : v);

// Merges `remote` (already cleaned) into `data` (the PC library, changed in place).
// Returns the PC items that tombstones removed, so their files can be deleted.
function mergeInto(data, remote, nowMs = Date.now()) {
  const local = data.tombstones || { items: [], boards: [] };
  const tombstones = pruneTombstones({
    items: unionTombstones(local.items || [], remote.tombstones.items),
    boards: unionTombstones(local.boards || [], remote.tombstones.boards)
  }, nowMs);
  const tombItem = new Map(tombstones.items.map((x) => [x.id, time(x.at)]));
  const tombBoard = new Map(tombstones.boards.map((x) => [x.id, time(x.at)]));

  // Rule 2: boards, union by id, higher updatedAt wins; ties keep the PC's copy.
  const boards = new Map(data.boards.map((b) => [b.id, b]));
  const boardOrder = data.boards.slice();
  for (const rb of remote.boards) {
    const lb = boards.get(rb.id);
    if (!lb) { const copy = { ...rb }; boards.set(rb.id, copy); boardOrder.push(copy); }
    else if (time(rb.updatedAt) > time(lb.updatedAt)) replaceInPlace(lb, { ...rb });
  }
  data.boards = boardOrder.filter((b) => !(tombBoard.has(b.id) && tombBoard.get(b.id) >= time(b.updatedAt)));

  // Rule 3: items, union by id, higher updatedAt wins the whole item, except thumb (always ours)
  // and w/h/duration (filled in from whichever side has them).
  const items = new Map(data.items.map((i) => [i.id, i]));
  const order = data.items.slice();
  for (const ri of remote.items) {
    const li = items.get(ri.id);
    if (!li) {
      const copy = { ...ri, thumb: null, w: fill(ri.w), h: fill(ri.h), duration: fill(ri.duration) };
      if (ri.kind === 'note') { delete copy.thumb; delete copy.w; delete copy.h; delete copy.duration; }
      items.set(ri.id, copy); order.push(copy);
      continue;
    }
    if (time(ri.updatedAt) > time(li.updatedAt)) {
      const keep = { thumb: li.thumb, w: li.w, h: li.h, duration: li.duration };
      const next = { ...ri };
      if (li.phone === false) next.phone = false; // the PC's "show on phone" survives a newer phone edit
      if (li.ai) next.ai = li.ai; else delete next.ai; // what the PC recognised stays the PC's own, like its thumbnails
      if (li.hash) next.hash = li.hash; // and so does its file fingerprint
      if ('thumb' in keep && keep.thumb !== undefined) next.thumb = keep.thumb; else delete next.thumb;
      for (const k of ['w', 'h', 'duration']) if (next[k] == null && keep[k] != null) next[k] = keep[k];
      if (next.takenAt == null && li.takenAt != null) next.takenAt = li.takenAt; // when it was taken: from whichever side knows
      replaceInPlace(li, next);
    } else {
      for (const k of ['w', 'h', 'duration', 'takenAt']) if (li[k] == null && ri[k] != null) li[k] = ri[k];
    }
  }
  const removed = [];
  const kept = [];
  for (const it of order) {
    if (tombItem.has(it.id) && tombItem.get(it.id) >= time(it.updatedAt)) { if (data.items.includes(it)) removed.push(it); }
    else kept.push(it);
  }

  // Rule 4: drop board references that point to boards no longer present.
  const present = new Set(data.boards.map((b) => b.id));
  for (const it of kept) {
    const clean = [...new Set((it.boards || []).filter((id) => present.has(id)))];
    if (clean.length !== (it.boards || []).length) it.boards = clean;
  }
  // Newest first, like the PC's own list. Stable, so equal dates keep their order.
  data.items = kept.map((it, i) => [it, i]).sort((a, b) => time(b[0].importedAt) - time(a[0].importedAt) || a[1] - b[1]).map((x) => x[0]);
  data.tombstones = tombstones;
  return { removed };
}

// What the phone gets back: everything except items the PC has set not to show on the phone.
// A hidden item whose file the PC hasn't received yet is still sent, so the phone keeps (and uploads) it.
function forPhone(items, pcNeeds) {
  const waiting = new Set(pcNeeds);
  return items.filter((it) => it.phone !== false || waiting.has(it.id));
}

module.exports = { cleanRemote, cleanCrop, mergeInto, forPhone, unionTombstones, pruneTombstones, SyncError, TOMBSTONE_DAYS, ID_RE };
