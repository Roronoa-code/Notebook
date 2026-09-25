// Sorting a board (or All items): newest or oldest added, by the date the photo or video was taken
// (read from the picture itself, or its dated file name), or by name. Each board remembers its own.
// Sorted by date taken, the board is split into months with a heading for each.
(() => {
  const { h } = NB;
  const OPTIONS = [
    { value: 'added', label: 'Newest added' },
    { value: 'added-old', label: 'Oldest added' },
    { value: 'taken', label: 'Date taken, newest' },
    { value: 'taken-old', label: 'Date taken, oldest' },
    { value: 'name', label: 'Name' }
  ];
  const key = (board) => 'nb.sort.' + board;
  const get = (board) => { try { const v = localStorage.getItem(key(board)); return OPTIONS.some((o) => o.value === v) ? v : 'added'; } catch { return 'added'; } };
  const set = (board, v) => { try { localStorage.setItem(key(board), v); } catch { /* remembering is a nicety */ } };
  const time = (iso) => (iso ? Date.parse(iso) : NaN);
  const byTaken = (dir) => (a, b) => {
    const x = time(a.takenAt), y = time(b.takenAt);
    if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1; // undated at the end
    return (Number.isNaN(x) ? 0 : dir * (y - x)) || (time(b.importedAt) - time(a.importedAt));
  };

  function apply(list, board) {
    const how = get(board);
    if (how === 'added') return list;
    const out = list.slice();
    if (how === 'added-old') out.sort((a, b) => time(a.importedAt) - time(b.importedAt));
    else if (how === 'taken') out.sort(byTaken(1));
    else if (how === 'taken-old') out.sort(byTaken(-1));
    else if (how === 'name') out.sort((a, b) => String(a.title).localeCompare(String(b.title), 'en-GB', { numeric: true, sensitivity: 'base' }));
    return out;
  }

  function menu(board, redraw) {
    return h('div', { class: 'sortbox' }, NB.dropdown({ label: 'Sort', value: get(board), options: OPTIONS, onChange: (v) => { set(board, v); redraw(); } }));
  }

  // The cards with a month heading before each new month (only when sorted by date taken).
  const headings = new Map(); // label -> element, kept so they glide rather than flash
  const monthOf = (x) => { const it = Array.isArray(x) ? x[0] : x; const t = time(it.takenAt); return Number.isNaN(t) ? 'No date' : new Date(t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
  function withHeadings(groups, els, board) {
    if (!get(board).startsWith('taken') || NB.smart.suggestion()) return els;
    const out = [];
    let last = null;
    groups.forEach((x, i) => {
      const m = monthOf(x);
      if (m !== last) {
        if (!headings.has(m)) headings.set(m, h('h3', { class: 'dategroup' }, m));
        out.push(headings.get(m));
        last = m;
      }
      out.push(els[i]);
    });
    return out;
  }

  NB.sort = { apply, menu, withHeadings, get };
})();
