// Sorting on the phone, as on the PC: newest or oldest added, by the date a photo or video was taken
// (worked out by the PC and sent with each sync), or by name. Home and each board remember their own.
// Sorted by date taken, the grid gets a heading for each month.
window.NBSort = function NBSort({ N, esc }) {
  const OPTIONS = [
    { value: 'added', label: 'Newest added' },
    { value: 'added-old', label: 'Oldest added' },
    { value: 'taken', label: 'Date taken, newest' },
    { value: 'taken-old', label: 'Date taken, oldest' },
    { value: 'name', label: 'Name' }
  ];
  const get = (key) => { const v = N.getPref('sort.' + key); return OPTIONS.some((o) => o.value === v) ? v : 'added'; };
  const set = (key, v) => N.setPref('sort.' + key, v);
  const label = (key) => OPTIONS.find((o) => o.value === get(key)).label;
  const time = (iso) => (iso ? Date.parse(iso) : NaN);
  // When it was taken, or for things with no such date (saved pins, screenshots), the day it was saved.
  const dated = (it) => time(it.takenAt || it.importedAt);
  const byTaken = (dir) => (a, b) => (dir * (dated(b) - dated(a))) || 0;

  function apply(list, key) {
    const how = get(key);
    if (how === 'added') return list;
    const out = list.slice();
    if (how === 'added-old') out.sort((a, b) => time(a.importedAt) - time(b.importedAt));
    else if (how === 'taken') out.sort(byTaken(1));
    else if (how === 'taken-old') out.sort(byTaken(-1));
    else out.sort((a, b) => String(a.title).localeCompare(String(b.title), 'en-GB', { numeric: true, sensitivity: 'base' }));
    return out;
  }

  const byMonth = (key) => !!key && get(key).startsWith('taken');
  const monthOf = (it) => { const t = dated(it); return Number.isNaN(t) ? 'No date' : new Date(t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };

  const TICK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  const sheetHTML = (key) => `<span class="lbl" style="padding:4px 16px 0">Sort</span>` + OPTIONS.map((o) => {
    const on = o.value === get(key);
    return `<button type="button" class="addrow${on ? ' on' : ''}" aria-pressed="${on}" data-a="sortPick" data-v="${o.value}"><span style="flex:1">${esc(o.label)}</span>${on ? TICK : ''}</button>`;
  }).join('');
  const pillHTML = (key) => `<button type="button" class="sortpill" data-a="sortOpen" aria-label="Sort: ${esc(label(key))}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg><span>${esc(label(key))}</span></button>`;

  return { apply, get, set, byMonth, monthOf, sheetHTML, pillHTML };
};
