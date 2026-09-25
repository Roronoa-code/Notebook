// When a photo or video was taken, for sorting by date. From the picture's own record first (a camera's
// or phone's EXIF date, or an MP4's creation time), otherwise from a dated file name such as
// 20260306_210639.jpg, IMG_20260306_210639.jpg, Screenshot_20260306-210639.png or IMG-20260306-WA0001.jpg.
// Only reads; files are never changed.
const fs = require('fs');
const fsp = fs.promises;

const EARLIEST = Date.UTC(1990, 0, 1);
const sane = (d) => (d && !Number.isNaN(d.getTime()) && d.getTime() >= EARLIEST && d.getTime() <= Date.now() + 864e5 ? d : null);
const local = (y, mo, d, h = 12, mi = 0, s = 0) => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return sane(new Date(y, mo - 1, d, h, mi, s));
};

// The part of a file most likely to hold its dates: the start (photos) and the end (videos keep theirs there too).
async function head(file, size) {
  const fh = await fsp.open(file, 'r');
  try {
    const st = await fh.stat(), n = Math.min(size, st.size);
    const a = Buffer.alloc(n);
    await fh.read(a, 0, n, 0);
    if (st.size <= size * 2) return a;
    const b = Buffer.alloc(size);
    await fh.read(b, 0, size, st.size - size);
    return Buffer.concat([a, b]);
  } finally { await fh.close(); }
}

// EXIF dates look like "2026:03:06 21:06:39" (the time the photo was taken, and when it was last changed): the earliest wins.
function fromExif(buf) {
  let best = null;
  for (const m of buf.toString('latin1').matchAll(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g)) {
    const d = local(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    if (d && (!best || d < best)) best = d;
  }
  return best;
}

// An MP4 or MOV's creation time (seconds since 1904, in its "mvhd" box).
function fromMp4(buf) {
  const at = buf.indexOf('mvhd', 0, 'latin1');
  if (at < 0 || at + 16 > buf.length) return null;
  const v = buf[at + 4];
  const secs = v === 1 ? Number(buf.readBigUInt64BE(at + 8)) : buf.readUInt32BE(at + 8);
  return secs ? sane(new Date(Date.UTC(1904, 0, 1) + secs * 1000)) : null;
}

function fromName(name) {
  const n = String(name || '');
  let m = /(?:^|\D)(20\d{2}|19\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(n);
  if (m) return local(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  m = /(?:^|\D)(20\d{2}|19\d{2})-(\d{2})-(\d{2})[ _T](\d{2})[.\-:](\d{2})[.\-:](\d{2})/.exec(n);
  if (m) return local(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  m = /(?:^|\D)(20\d{2})(\d{2})(\d{2})-WA\d+/i.exec(n) || /(?:^|\D)(20\d{2})-(\d{2})-(\d{2})(?:\D|$)/.exec(n);
  if (m) return local(+m[1], +m[2], +m[3]);
  return null;
}

// The date as an ISO string, or null when nothing says.
async function takenAt(file, name, kind) {
  let d = null;
  try {
    const buf = await head(file, kind === 'video' ? 1 << 20 : 256 << 10);
    d = kind === 'video' ? fromMp4(buf) : fromExif(buf);
  } catch { /* unreadable: try the name */ }
  d = d || fromName(name);
  return d ? d.toISOString() : null;
}

module.exports = { takenAt, fromName, fromExif, fromMp4 };
