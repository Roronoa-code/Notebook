// Saving a pasted link into the library (build plan B1), and the retry list for links that failed.
// The downloading itself is in downloader.js; this file only files the results. The list lives in
// library.json under `links` (PC only): { retry: [{ url, error, at }], saved: [recent good links] }.

function list(lib) {
  if (!lib.data.links) lib.data.links = { retry: [], saved: [] };
  return lib.data.links;
}

// Saves one link: downloads, copies into the library (onto `boardId` if given), titles the new items
// from the post, keeps the source link, and stacks a photo slideshow. Never throws: { ok, added } or { ok: false, error }.
async function saveLink({ lib, dl, url, boardId }) {
  const L = list(lib);
  url = String(url || '').trim();
  // Not a TikTok or Pinterest link at all: say so, but don't clutter the retry list with it.
  if (!dl.constructor.site(url)) return { ok: false, error: 'That doesn’t look like a TikTok or Pinterest post link.' };
  // Saved before: nothing to download.
  const had = lib.data.items.find((i) => i.source === url);
  if (had) return { ok: true, added: [], already: had.deletedAt ? 'bin' : 'notebook' };
  let got = null;
  try {
    got = await dl.fetch(url);
    const res = await lib.importFiles(got.files, boardId || null);
    if (!res.added.length && res.skipped.length && res.skipped.every((s) => s.duplicate)) {
      L.retry = L.retry.filter((r) => r.url !== url);
      await lib.save();
      return { ok: true, added: [], already: res.skipped.some((s) => /Bin/.test(s.reason)) ? 'bin' : 'notebook' };
    }
    if (!res.added.length) throw Object.assign(new Error(), { friendly: 'The post downloaded but none of its files could be added.' });
    // The post's own description as the title, or a plain one (never a long file name full of hashtags).
    const title = got.title || (dl.constructor.site(url) === 'tiktok' ? 'TikTok post' : 'Pinterest pin');
    res.added.forEach((id, i) => {
      const it = lib.item(id);
      it.title = res.added.length > 1 ? `${title} (${i + 1}/${res.added.length})` : title;
      it.source = url;
      it.named = 'source'; // the post's own wording: a proper name may replace it
    });
    if (res.added.length > 1) await lib.stackItems(res.added); // a slideshow stays together as one stack
    L.retry = L.retry.filter((r) => r.url !== url);
    L.saved = [url, ...L.saved.filter((u) => u !== url)].slice(0, 20);
    await lib.save();
    return { ok: true, added: res.added };
  } catch (err) {
    const error = err.friendly || 'The link couldn’t be saved.';
    L.retry = [{ url, error, at: new Date().toISOString() }, ...L.retry.filter((r) => r.url !== url)].slice(0, 100);
    await lib.save();
    return { ok: false, error };
  } finally {
    if (got && got.dir) await require('fs').promises.rm(got.dir, { recursive: true, force: true });
  }
}

async function forget(lib, url) {
  const L = list(lib);
  L.retry = L.retry.filter((r) => r.url !== url);
  await lib.save();
}

module.exports = { saveLink, forget, list };
