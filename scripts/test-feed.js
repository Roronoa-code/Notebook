// Focused offline checks for Feed's pagination, persistence, ranking and feedback rules.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { Feed } = require('../main/feed');

const ROOT = path.resolve(__dirname, '..', 'test-output', 'feed-test');
const iso = (n = 0) => new Date(Date.now() - n * 1000).toISOString();
const pin = (id, title = `Idea ${id}`) => {
  const sig = Number(id).toString(16).padStart(32, '0');
  return { id: String(id), url: `https://www.pinterest.com/pin/${id}/`, img: `https://i.pinimg.com/474x/${sig}.jpg`, small: `https://i.pinimg.com/236x/${sig}.jpg`, w: 474, h: 600, title, video: false, sig };
};

class Source {
  constructor(total = 360) { this.total = total; this.calls = []; this.fail = false; this.signedOut = false; }
  async page(s) {
    this.calls.push({ ...s });
    if (this.fail) throw Object.assign(new Error('offline'), { kind: 'offline' });
    const start = s.bookmark ? Number(s.bookmark) : 0;
    const count = Math.min(60, Math.max(0, this.total - start));
    return { pins: Array.from({ length: count }, (_, i) => pin(100000 + start + i)), bookmark: start + count < this.total ? String(start + count) : null, signedOut: this.signedOut && s.kind === 'home' };
  }
  async bytes(url) { return Buffer.from(String(url).match(/\/([0-9a-f]{32})\./i)?.[1] || 'pin'); }
}

const defaultEmbed = async (bytes) => { const v = Array(360).fill(0); v[(parseInt(bytes.toString(), 16) || 0) % v.length] = 1; return v; };
const makeFeed = ({ dir, lib, source, embeddings = {}, embed = defaultEmbed, aiQuick, aiHide, aiKnown, onChange = () => {} } = {}) => new Feed({
  getLib: () => lib,
  dir,
  source,
  embeddings: async () => embeddings,
  embed,
  aiHide: aiHide || (async () => false),
  aiQuick: aiQuick || (async () => 0),
  aiKnown: aiKnown || (() => null),
  onChange,
  log: { error: () => {} }
});

const waitFor = async (fn) => {
  const until = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > until) throw new Error('timed out waiting for feed state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  const lib = { data: { boards: [{ id: 'board-1', name: 'Ideas', phone: true }], items: [] } };
  const source = new Source(360);
  const feed = makeFeed({ dir: path.join(ROOT, 'normal'), lib, source });

  await feed.load('all', 'fresh');
  while (feed.get('all', { load: false }).more) await feed.load('all', 'more');
  assert.equal(feed.get('all', { load: false }).pins.length, 360, 'new pages remain available after passing 300 pins');
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, 'normal', 'feeds.json'), 'utf8'));
  assert.equal(saved.feeds.all.pins.length, 300, 'normal feeds persist their newest 300 pins');
  assert.equal(saved.feeds.all.sources[0].bookmark, null, 'the final page has no stale bookmark');

  const restarted = makeFeed({ dir: path.join(ROOT, 'normal'), lib, source });
  assert.equal(restarted.get('all', { load: false }).pins.length, 300, 'normal feed restores its persisted tail');
  await feed.load('search:  summer outfits  ', 'fresh');
  assert.ok(feed.get('search:summer outfits', { load: false }), 'direct search feed uses the requested query');
  await feed.save();
  const afterSearch = JSON.parse(fs.readFileSync(path.join(ROOT, 'normal', 'feeds.json'), 'utf8'));
  assert.equal(afterSearch.feeds['search:summer outfits'], undefined, 'direct feeds stay transient and are not warmed from disk');

  // All uses the newest imported pictures for its profile. The oldest 400th picture is deliberately different.
  const recentItems = Array.from({ length: 401 }, (_, i) => ({ id: `item-${i}`, kind: 'photo', importedAt: iso(i), updatedAt: iso(i), boards: [], deletedAt: null }));
  recentItems[0].labels = { main: 'outfit' };
  const recLib = { data: { boards: [], items: recentItems } };
  const recSource = new Source(2);
  recSource.page = async (s) => ({ pins: [pin(900001, 'newest match'), pin(900002, 'oldest match')], bookmark: null });
  recSource.bytes = async (url) => Buffer.from(String(url).includes(pin(900001).sig) ? 'new' : 'old');
  const recEmb = Object.fromEntries(recentItems.map((item) => [item.id, [0, 0]]));
  recEmb['item-0'] = [1, 0];
  recEmb['item-400'] = [0, 1];
  const recFeed = makeFeed({ dir: path.join(ROOT, 'recency'), lib: recLib, source: recSource, embeddings: recEmb, embed: async (bytes) => bytes.toString() === 'new' ? [0.8, 0.6] : [0.6, 0.8] });
  await recFeed.load('all', 'fresh');
  const recPins = recFeed.get('all', { load: false }).pins;
  assert.equal(recPins[0].id, '900001', 'All ranks against the newest 400 imported pictures');
  assert.deepEqual(recLib.data.items[0].labels, { main: 'outfit' }, 'owner labels remain untouched');

  // One source can fail while another answers; an all-source failure keeps the old pins and does not retry on every read.
  const partialLib = { data: { boards: [], items: [{ id: 'named', kind: 'photo', aiName: 'linen outfit', importedAt: iso(), boards: [], deletedAt: null }] } };
  const partialSource = new Source(1);
  const originalPage = partialSource.page.bind(partialSource);
  partialSource.page = async (s) => { if (s.kind === 'search') throw Object.assign(new Error('changed'), { kind: 'changed' }); return originalPage(s); };
  const partialFeed = makeFeed({ dir: path.join(ROOT, 'partial'), lib: partialLib, source: partialSource });
  await partialFeed.load('all', 'fresh');
  const beforeFailure = partialFeed.get('all', { load: false }).pins.length;
  assert.ok(beforeFailure > 0, 'a successful source still supplies partial results');
  partialSource.fail = true;
  const callsBefore = partialSource.calls.length;
  await partialFeed.load('all', 'fresh');
  assert.equal(partialFeed.get('all', { load: false }).pins.length, beforeFailure, 'all-source failures preserve old results');
  assert.equal(partialFeed.get('all').busy, false, 'failed feeds settle cleanly');
  const afterFailure = partialSource.calls.length;
  assert.ok(afterFailure > callsBefore && afterFailure <= callsBefore + 2, 'the failed refresh made one bounded attempt');
  partialFeed.get('all');
  assert.equal(partialSource.calls.length, afterFailure, 'a recent failure does not busy-loop on reads');

  // A cached picture is enough to rebuild a hidden pin's vector after restart.
  const hiddenDir = path.join(ROOT, 'hidden');
  const hiddenSource = new Source(1);
  const hiddenLib = { data: { boards: [], items: [] } };
  const hiddenFeed = makeFeed({ dir: hiddenDir, lib: hiddenLib, source: hiddenSource, embed: async (bytes) => [bytes.length, 0] });
  await hiddenFeed.load('all', 'fresh');
  const hiddenPin = hiddenFeed.get('all', { load: false }).pins[0];
  await hiddenFeed.image(hiddenPin.sig);
  const offlineSource = new Source(1);
  offlineSource.bytes = async () => null;
  const hiddenRestart = makeFeed({ dir: hiddenDir, lib: hiddenLib, source: offlineSource, embed: async (bytes) => [bytes.length, 0] });
  await hiddenRestart.hide(hiddenPin.id);
  assert.equal(hiddenRestart.state.hidden.includes(hiddenPin.id), true, 'hidden pin survives restart');
  assert.equal(hiddenRestart.state.hiddenVecs.length, 1, 'cached image rebuilds the negative-learning vector');

  // Delayed AI work must settle after a hide, preserve another feed's result, and not trigger an
  // automatic refresh while the first batch is still being checked.
  const delayedSource = new Source(1);
  delayedSource.page = async (s) => ({ pins: s.arg === 'hide' ? [pin(910001), pin(910003)] : [pin(910002)], bookmark: null });
  const releases = [];
  const changes = [];
  const delayed = makeFeed({
    dir: path.join(ROOT, 'delayed'),
    lib: { data: { boards: [], items: [] } },
    source: delayedSource,
    aiQuick: async () => 1,
    aiHide: async () => new Promise((resolve) => releases.push(resolve)),
    onChange: (key) => changes.push(key)
  });
  await delayed.load('search:hide', 'fresh');
  await waitFor(() => delayed.feed('search:hide').checking === 1);
  const callsWhileChecking = delayedSource.calls.length;
  delayed.get('search:hide');
  assert.equal(delayedSource.calls.length, callsWhileChecking, 'an all-doubtful batch does not auto-refresh while checking');

  await delayed.load('search:keep', 'fresh');
  await waitFor(() => delayed.feed('search:keep').checking === 1);
  await delayed.hide('910001');
  const savedHidden = JSON.parse(fs.readFileSync(path.join(ROOT, 'delayed', 'feeds.json'), 'utf8'));
  assert.ok(savedHidden.hidden.includes('910001'), 'hide persists before deferred AI work settles');
  const changesBeforeSettlement = changes.length;
  releases.splice(0).forEach((resolve) => resolve(false));
  await waitFor(() => delayed.feed('search:hide').checking === 0 && delayed.feed('search:keep').checking === 0);
  assert.equal(delayed.get('search:hide', { load: false }).busy, false, 'hidden feed clears checking after hide');
  assert.ok(changes.length > changesBeforeSettlement, 'settlement emits a change after hide');
  assert.equal(delayed.get('search:hide', { load: false }).pins.some((p) => p.id === '910001'), false, 'a hidden delayed result is discarded');
  assert.equal(delayed.get('search:hide', { load: false }).pins.some((p) => p.id === '910003'), true, 'an unrelated delayed result in the same feed is preserved');
  assert.equal(delayed.get('search:keep', { load: false }).pins.some((p) => p.id === '910002'), true, 'an unrelated delayed result is preserved');

  // A successful batch whose candidates are all filtered is still a completed, empty feed: reads
  // should wait for staleness instead of starting the same request over and over.
  const filteredSource = new Source(1);
  filteredSource.page = async () => ({ pins: [pin(920001)], bookmark: null });
  const filtered = makeFeed({ dir: path.join(ROOT, 'filtered'), lib: { data: { boards: [], items: [] } }, source: filteredSource, aiKnown: () => true });
  await filtered.load('all', 'fresh');
  assert.equal(filtered.get('all', { load: false }).pins.length, 0, 'filtered candidates leave an empty feed');
  const filteredCalls = filteredSource.calls.length;
  assert.equal(filtered.get('all').busy, false, 'an empty completed feed is settled');
  assert.equal(filteredSource.calls.length, filteredCalls, 'an empty completed feed does not auto-refetch on read');

  console.log('All feed checks passed.');
})().catch((err) => { console.error('FAILED:', err); process.exit(1); });
