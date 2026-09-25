// Previews (thumbnails): made on this PC the first time a photo or video needs one, three at a time,
// and saved next to the library. A file that can't be read is marked so it isn't tried again and again.
(() => {
  function queue() {
    const S = NB.S;
    for (const it of S.snap.items) {
      if (it.kind !== 'note' && !it.thumbSrc && !it.waiting && !S.bad.has(it.id) && !S.queued.has(it.id)) { S.queued.add(it.id); thumbQueue.push(it.id); }
    }
    pumpThumbs();
  }
  // Previews are made three at a time; the board list is redrawn at most a few times a second meanwhile.
  const thumbQueue = [];
  let pumping = 0, boardsSoon = 0;
  const redrawBoardsSoon = () => { if (!boardsSoon) boardsSoon = setTimeout(() => { boardsSoon = 0; NB.renderBoards(); }, 300); };
  function pumpThumbs() { while (pumping < 3 && thumbQueue.length) pumpOne(); }
  async function pumpOne() {
    const S = NB.S;
    pumping++;
    while (thumbQueue.length) {
      const id = thumbQueue.shift();
      const it = S.snap.items.find((i) => i.id === id);
      if (!it) continue;
      try {
        const res = NB.isRaw(it) ? await nb.rawThumb(id) : await (it.kind === 'video' ? videoThumb(it.src) : photoThumb(it.src)).then(({ bytes, meta }) => nb.saveThumb(id, bytes, meta));
        if (res.error) throw new Error(res.error);
        S.snap = res.snap;
      } catch (err) {
        console.warn('preview failed', id, err);
        S.bad.add(id);
      }
      NB.refreshCard(id);
      redrawBoardsSoon();
      NB.viewer.refresh();
    }
    pumping--;
  }

  const toJpeg = (source, w, h) => new Promise((resolve, reject) => {
    const scale = Math.min(1, 640 / w);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('no image'))), 'image/jpeg', 0.85);
  });

  async function photoThumb(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return { bytes: await toJpeg(img, img.naturalWidth, img.naturalHeight), meta: { w: img.naturalWidth, h: img.naturalHeight } };
  }

  function videoThumb(src) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      const done = (fn, val) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); fn(val); };
      const timer = setTimeout(() => done(reject, new Error('timed out')), 20000);
      v.muted = true; v.preload = 'auto';
      v.onerror = () => done(reject, new Error('unplayable'));
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 0) * 0.25); };
      v.onseeked = async () => {
        try {
          if (!v.videoWidth) throw new Error('no picture');
          done(resolve, { bytes: await toJpeg(v, v.videoWidth, v.videoHeight), meta: { w: v.videoWidth, h: v.videoHeight, duration: v.duration } });
        } catch (err) { done(reject, err); }
      };
      v.src = src;
    });
  }

  NB.previews = { queue };
})();
