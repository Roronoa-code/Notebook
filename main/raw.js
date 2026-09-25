// Camera RAW photos (.dng, e.g. from a phone's Pro or Expert RAW mode). Windows' picture engine can't draw
// them, but each carries a normal JPEG of the same shot inside; that becomes the preview Notebook shows.
// The RAW file itself is kept exactly as it was.
const fsp = require('fs').promises;
const sharp = require('sharp');

const RAW_EXT = ['.dng'];
const isRaw = (file) => RAW_EXT.some((e) => String(file || '').toLowerCase().endsWith(e));

// The largest JPEG inside the file, turned the right way up and shrunk to at most `max` pixels:
// { data, width, height }. Throws if there's none.
async function rawPreview(file, max = 1600) {
  const bytes = await fsp.readFile(file);
  const SOI = Buffer.from([0xff, 0xd8, 0xff]);
  let best = null;
  for (let at = bytes.indexOf(SOI); at >= 0; at = bytes.indexOf(SOI, at + 3)) {
    try {
      const m = await sharp(bytes.subarray(at)).metadata();
      if (m.format === 'jpeg' && m.width && (!best || m.width * m.height > best.area)) best = { at, area: m.width * m.height, orientation: m.orientation };
    } catch { /* not a picture that starts here */ }
  }
  if (!best) throw new Error('no preview inside this RAW file');
  // The turn is usually in the JPEG itself; if not, the RAW file's own orientation says it.
  const outer = best.orientation ? null : (await sharp(file).metadata().catch(() => ({}))).orientation;
  const src = sharp(bytes.subarray(best.at));
  const img = outer === 6 ? src.rotate(90) : outer === 3 ? src.rotate(180) : outer === 8 ? src.rotate(270) : src.rotate();
  const { data, info } = await img.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

module.exports = { rawPreview, isRaw, RAW_EXT };
