// Recognition on the page (build plan Track A): the filter bar (type, colour, style), the labels on an
// open item with dropdowns to correct them, the style list, the "Recognising…" line and Suggested groups.
(() => {
  const { h, icon, toast } = NB;
  const F = { type: null, colour: null, style: null, from: null }; // active filters
  const TYPE_NAMES = { outfit: 'Outfits', wallpaper: 'Wallpapers', icon: 'Icons', 'profile picture': 'Profile pictures', other: 'Other' };
  const FAMILY = { 'light grey': 'grey', denim: 'blue', 'light blue': 'blue', khaki: 'beige', cream: 'white', tan: 'brown', mustard: 'yellow', lilac: 'purple', burgundy: 'red', olive: 'green', teal: 'green' };
  const family = (c) => FAMILY[c] || c;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const snap = () => NB.S.snap;

  // What an item is: the user's corrections win over what the PC recognised.
  // Colours you set yourself replace what was recognised. Recognised ones only count when they cover
  // a fair part of the picture (a sliver of navy in a dark photo isn't "navy").
  const HEX = { black: '#141416', white: '#F0F0EE', grey: '#808080', navy: '#1C2448', blue: '#2C5ABE', green: '#28823C', beige: '#DCCDAF', brown: '#6E4628', red: '#C81E28', pink: '#F096B4', purple: '#6E3CA0', yellow: '#F0D228', orange: '#F0821E' };
  const COLOURS = Object.keys(HEX);
  function labelsOf(it) {
    const ai = it.ai || {}, l = it.labels || {};
    const main = l.main || (ai.type && ai.type.main) || null;
    const extra = l.extra || (ai.type && ai.type.extra) || [];
    const seen = (ai.colours || []).filter((c, i) => i === 0 || c.share >= 0.2);
    const colours = Array.isArray(l.colours) ? l.colours.map((name) => ({ name, hex: HEX[name] || '#808080', share: 1 })) : seen;
    return { main, types: main ? [main, ...extra.filter((t) => t !== main)] : extra, styles: l.styles || ai.styles || [], colours, corrected: !!it.labels, scanned: !!(ai.type || ai.failed) };
  }
  // Where something came from: saved from a Pinterest or TikTok link, or your own (added from the PC or phone).
  const sourceOf = (it) => (/tiktok\.com/i.test(it.source || '') ? 'tiktok' : /pinterest\.|pin\.it/i.test(it.source || '') ? 'pinterest' : 'mine');
  const FROM = { mine: 'My photos', pinterest: 'Pinterest', tiktok: 'TikTok' };

  // ---------- filters ----------
  function filter(list) {
    return list.filter((it) => {
      if (!F.type && !F.colour && !F.style && !F.from) return true;
      const L = labelsOf(it);
      return (!F.type || L.types.includes(F.type)) && (!F.colour || L.colours.some((c) => family(c.name) === F.colour)) && (!F.style || L.styles.includes(F.style)) && (!F.from || sourceOf(it) === F.from);
    });
  }
  const active = () => !!(F.type || F.colour || F.style || F.from);

  function filterBar(list) {
    const types = snap().types || [];
    const froms = Object.keys(FROM).filter((k) => list.some((it) => sourceOf(it) === k));
    if ((!types.length || !list.some((it) => it.ai)) && froms.length < 2) return null;
    const L = list.map(labelsOf);
    const colours = [...new Map(L.flatMap((x) => x.colours).map((c) => [family(c.name), c.hex])).entries()];
    const styles = (snap().styles || []).filter((s) => L.some((x) => x.styles.includes(s)));
    const chip = (label, on, onclick, extra) => h('button', { type: 'button', class: 'fchip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick }, extra || null, label);
    const set = (k, v) => { F[k] = F[k] === v ? null : v; NB.refreshGrid(); };
    return h('div', { class: 'filters', role: 'toolbar', 'aria-label': 'Filters' },
      froms.length > 1 ? h('div', { class: 'frow' }, froms.map((k) => chip(FROM[k], F.from === k, () => set('from', k)))) : null,
      h('div', { class: 'frow' }, types.filter((t) => L.some((x) => x.types.includes(t))).map((t) => chip(TYPE_NAMES[t] || cap(t), F.type === t, () => set('type', t)))),
      colours.length ? h('div', { class: 'frow' }, colours.slice(0, 12).map(([name, hex]) => chip(cap(name), F.colour === name, () => set('colour', name), h('span', { class: 'swatch', style: { background: hex } })))) : null,
      h('div', { class: 'frow' }, styles.map((s) => chip(cap(s), F.style === s, () => set('style', s))), h('button', { type: 'button', class: 'fchip ghost', onclick: stylesEditor }, icon('note'), 'Styles')),
      active() ? h('button', { type: 'button', class: 'linkbtn', onclick: () => { F.type = F.colour = F.style = F.from = null; NB.refreshGrid(); } }, 'Clear filters') : null);
  }

  // ---------- your style list ----------
  function stylesEditor() {
    const old = document.querySelector('.stylepop');
    if (old) { old.remove(); return; }
    let list = (snap().styles || []).slice();
    const pop = h('div', { class: 'popover stylepop', role: 'dialog', 'aria-label': 'Your styles' });
    const draw = () => {
      const input = h('input', { class: 'chip-input', placeholder: 'Add a style', maxlength: '24', 'aria-label': 'New style' });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { list.push(input.value.trim().toLowerCase()); draw(); pop.querySelector('.chip-input').focus(); } if (e.key === 'Escape') pop.remove(); });
      pop.replaceChildren(h('strong', null, 'Your styles'), h('p', { class: 'hint' }, 'Outfits get their top two styles from this list. Add your own, or remove ones you never use.'),
        h('div', { class: 'tags' }, list.map((s, i) => h('button', { type: 'button', class: 'chip tog on', 'aria-label': `Remove ${s}`, onclick: () => { list.splice(i, 1); draw(); } }, h('span', null, cap(s)), icon('x'))), input),
        h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
          h('button', { type: 'button', class: 'btn small', onclick: () => pop.remove() }, 'Cancel'),
          h('button', { type: 'button', class: 'btn small primary', onclick: async () => {
            const res = NB.apply(await nb.setStyles(list));
            if (res) { pop.remove(); toast('Styles saved. Outfits are being looked at again for the new list.'); }
          } }, 'Save')));
    };
    draw();
    document.body.append(pop);
    pop.querySelector('.chip-input').focus();
  }

  // ---------- labels on an open item ----------
  // One line: what it is (and for outfits, style and colours), with Edit to open the dropdowns.
  function labelsSummary(it, open, onToggle) {
    const L = labelsOf(it);
    if (!L.scanned) return h('p', { class: 'hint recog' }, 'Recognising this on your PC…');
    const up = (s) => cap(s).replace(/^Y2k$/, 'Y2K');
    const outfit = L.types.includes('outfit');
    const what = [L.types.map(up).join(' + '), outfit && L.styles.length ? L.styles.map(up).join(', ') : ''].filter(Boolean).join(' · ');
    return h('button', { type: 'button', class: 'lsum', 'aria-expanded': String(!!open), title: 'What your PC recognised. Edit to correct it.', onclick: onToggle },
      h('span', { class: 'lsum-text' }, what || 'Not sure what this is'),
      outfit ? h('span', { class: 'lsum-dots', 'aria-hidden': 'true' }, L.colours.slice(0, 3).map((c) => h('span', { class: 'swatch', style: { background: c.hex } }))) : null,
      h('span', { class: 'lsum-edit' }, open ? 'Close' : 'Edit'));
  }

  // Colours: tap one to take it off, or add one from the list. Your choice replaces what the PC saw.
  function coloursEditor(it, L, isOutfit, save) {
    const mine = L.colours.map((c) => family(c.name)).filter((c, i, a) => a.indexOf(c) === i);
    const setTo = (next) => save({ colours: next });
    const add = NB.dropdown({ label: 'Add a colour', value: '', options: [{ value: '', label: 'Add a colour' }, ...COLOURS.filter((c) => !mine.includes(c)).map((c) => ({ value: c, label: cap(c) }))], onChange: (v) => { if (v) setTo([...mine, v]); } });
    return [h('h4', { class: 'micro' }, isOutfit ? 'Colours of the clothes' : 'Colours'),
      h('div', { class: 'tags' }, mine.map((c) => h('button', { type: 'button', class: 'colourtag rm', 'aria-label': `Take ${c} off`, title: 'Take this colour off', onclick: () => setTo(mine.filter((x) => x !== c)) },
        h('span', { class: 'swatch', style: { background: HEX[c] || '#808080' } }), cap(c), icon('x'))), add),
      Array.isArray((it.labels || {}).colours) ? h('button', { type: 'button', class: 'linkbtn', onclick: () => save({ colours: null }) }, 'Use the colours the PC saw') : null];
  }

  function labelsPanel(it) {
    if (it.kind === 'note' || it.deletedAt) return null;
    const L = labelsOf(it);
    if (!L.scanned) return h('p', { class: 'hint recog' }, 'Recognising this on your PC…');
    const types = snap().types || [];
    const save = async (changes) => { const res = await nb.setLabels(it.id, changes); if (res.error) toast(res.error, { error: true }); else NB.apply(res); };
    const main = NB.dropdown({ label: 'What this is', value: L.main, options: types.map((t) => ({ value: t, label: cap(t) })),
      onChange: (v) => save({ main: v, extra: L.types.filter((t) => t !== v && t !== L.main) }) });
    const extras = types.filter((t) => t !== L.main).map((t) => {
      const on = L.types.includes(t);
      return h('button', { type: 'button', class: 'chip tog small' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => save({ extra: on ? L.types.filter((x) => x !== t && x !== L.main) : [...L.types.filter((x) => x !== L.main), t] }) }, cap(t));
    });
    const isOutfit = L.types.includes('outfit');
    const styleSel = (n) => NB.dropdown({ label: n ? 'Second style' : 'Style', value: L.styles[n] || '',
      options: [{ value: '', label: n ? 'No second style' : 'No style' }, ...(snap().styles || []).map((s) => ({ value: s, label: cap(s) }))],
      onChange: (v) => { const next = L.styles.slice(0, 2); next[n] = v; save({ styles: next.filter(Boolean) }); } });
    return h('div', { class: 'recog' },
      h('h4', { class: 'micro' }, 'What it is'),
      h('div', { class: 'recrow' }, main, L.corrected ? h('button', { type: 'button', class: 'linkbtn', onclick: () => save({ main: null, extra: null, styles: null }) }, 'Use what the PC saw') : null),
      h('div', { class: 'tags' }, extras),
      coloursEditor(it, L, isOutfit, save),
      isOutfit ? [h('h4', { class: 'micro' }, 'Style'), h('div', { class: 'recrow' }, styleSel(0), styleSel(1))] : null);
  }

  // ---------- "Recognising…" and Suggested ----------
  let status = { state: 'idle' }, list = [], showing = null;
  function renderStatus() {
    const el = document.getElementById('recog-status');
    if (!el) return;
    el.hidden = status.state === 'idle';
    el.textContent = status.state === 'scanning' ? `Recognising ${status.done} of ${status.total}${status.device === 'dml' ? ' on your graphics card' : ''}…`
      : status.state === 'needs-setup' ? 'Recognition needs its models (see the guide).' : status.state === 'error' ? `Recognition stopped: ${status.error}` : '';
  }
  async function loadSuggestions() {
    const res = await nb.suggestions();
    if (res && !res.error) { list = res.suggestions; renderSuggestions(); }
  }
  // Suggested is folded away until you open it (remembered), so the boards keep the room.
  let unfolded = (() => { try { return localStorage.getItem('nb.suggested') === 'open'; } catch { return false; } })();
  // The heading and the rows stay put; opening and closing only slides the rows' height (CSS), so the
  // boards above move smoothly instead of jumping.
  let sug = null, rowsKey = '';
  function renderSuggestions() {
    const box = document.getElementById('suggested');
    if (!box) return;
    box.hidden = !list.length;
    if (!sug) {
      const head = h('button', { type: 'button', class: 'sughead', onclick: () => {
        unfolded = !(unfolded || !!showing);
        try { localStorage.setItem('nb.suggested', unfolded ? 'open' : 'shut'); } catch { /* remembering is a nicety */ }
        if (!unfolded && showing) { showing = null; NB.showSuggestion(null); }
        renderSuggestions();
      } }, icon('right'), h('span', { class: 'micro navlabel' }, 'Suggested'), h('span', { class: 'n' }));
      const rows = h('div', { class: 'suginner' });
      sug = { head, rows, body: h('div', { class: 'sugbody' }, rows) };
      box.replaceChildren(head, sug.body);
    }
    const open = unfolded || !!showing;
    sug.head.setAttribute('aria-expanded', String(open));
    sug.head.querySelector('.n').textContent = list.length;
    box.classList.toggle('open', open);
    sug.body.inert = !open;
    const key = list.map((g) => [g.sig, g.name, g.ids.length, showing === g.sig].join(':')).join('|');
    if (key === rowsKey) return;
    rowsKey = key;
    sug.rows.replaceChildren(...list.map((g, i) => h('button', {
      type: 'button', class: 'navrow sug' + (showing === g.sig ? ' on' : ''), 'aria-pressed': String(showing === g.sig), style: { '--i': i }, onclick: () => show(g.sig)
    }, icon(g.kind === 'set' ? 'photo' : 'stack'), h('span', { class: 'sugname' }, g.name), h('span', { class: 'n' }, g.ids.length))));
  }
  const suggestion = () => list.find((g) => g.sig === showing);
  function show(sig) { showing = showing === sig ? null : sig; renderSuggestions(); NB.showSuggestion(suggestion()); }
  // The actions shown above a suggestion's items.
  function suggestionBar(g) {
    const name = h('input', { class: 'rename small', value: g.name, maxlength: '40', 'aria-label': 'Name for this group' });
    name.addEventListener('change', async () => { const r = await nb.renameSuggestion(g.sig, name.value); if (!r.error) { list = r.suggestions; renderSuggestions(); } });
    return h('div', { class: 'sugbar' },
      h('span', { class: 'micro' }, g.kind === 'set' ? 'Matching set: wallpaper, icon and profile picture' : 'Suggested group'), name,
      h('button', { type: 'button', class: 'btn small primary', onclick: async () => {
        const r = NB.apply(await nb.keepSuggestion(g.sig, name.value));
        if (r) { list = r.suggestions; showing = null; renderSuggestions(); NB.showSuggestion(null, r.id); toast(`Kept as the board “${name.value}”`); }
      } }, icon('plus'), 'Keep as board'),
      h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const r = await nb.dismissSuggestion(g.sig);
        if (!r.error) { list = r.suggestions; showing = null; renderSuggestions(); NB.showSuggestion(null); toast('Dismissed. It won’t be suggested again.'); }
      } }, 'Dismiss'),
      h('p', { class: 'hint' }, 'Suggestions never move, change or delete anything.'));
  }

  nb.onAiProgress((s) => { const was = status.state; status = s; renderStatus(); if (was === 'scanning' && s.state === 'idle') loadSuggestions(); });
  const hideSuggestion = () => { if (showing) { showing = null; renderSuggestions(); } };
  NB.smart = { sourceOf, hideSuggestion, filter, filterBar, labelsPanel, labelsSummary, labelsOf, loadSuggestions, suggestionBar, suggestion, active, clear: () => { F.type = F.colour = F.style = null; } };
  nb.aiStatus().then((r) => { if (r && r.status) { status = r.status; renderStatus(); } });
})();
