// Search: words (titles, notes, what things are, colours, styles) plus what's in the pictures themselves,
// so "PC" finds photos of your PC even if nobody named them that. The picture part is worked out on
// this PC from the same fingerprints recognition makes. Starting with "my" ("my PC") keeps to your own
// photos and videos (not ones saved from Pinterest or TikTok).
(() => {
  const textOf = (html) => { const d = document.createElement('div'); d.innerHTML = NB.sanitize(html); return d.textContent || ''; };
  const words = (i) => { const L = NB.smart.labelsOf(i); return [i.title, i.sourceTitle || '', i.kind === 'note' ? textOf(i.html) : i.caption || '', ...L.types, ...L.styles, ...L.colours.map((c) => c.name)].join(' ').toLowerCase(); };
  const parse = (q) => {
    const t = String(q || '').trim().toLowerCase();
    if (/^(my|mine|my (photos|stuff|own))$/.test(t)) return { mine: true, text: '' };
    const m = /^my\s+(.+)$/.exec(t);
    return { mine: !!m, text: (m ? m[1] : t).trim() };
  };
  let pictures = { text: '', ids: new Set() }, timer = 0, seq = 0;

  function filter(list, q) {
    const { mine, text } = parse(q);
    const own = mine ? list.filter((i) => NB.smart.sourceOf(i) === 'mine') : list;
    if (!text) return own;
    const seen = pictures.text === text ? pictures.ids : null;
    return own.filter((i) => words(i).includes(text) || (seen && seen.has(i.id)));
  }

  // After typing: ask the PC which pictures show it (a moment after the last key), then redraw.
  function changed(q, redraw) {
    const { text } = parse(q);
    clearTimeout(timer);
    const mine = ++seq;
    const field = document.getElementById('search').closest('.search-wrap');
    NBEffects.set(field, null);
    if (text.length < 2 || text === pictures.text) return;
    timer = setTimeout(async () => {
      NBEffects.set(field, 'beam', Date.now());
      try {
        const r = await nb.searchPictures(text);
        if (mine !== seq || !r || r.error || !Array.isArray(r.ids)) return;
        pictures = { text, ids: new Set(r.ids) };
        redraw();
      } finally { if (mine === seq) NBEffects.set(field, null); }
    }, 220);
  }

  NB.search = { filter, changed };
})();
