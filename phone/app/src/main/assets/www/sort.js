// Sorting on the phone, as on the PC: newest or oldest saved, by the date a photo or video was taken
// (worked out by the PC and sent with each sync), or by name. Home and each board remember their own.
// Sorted by date taken, the grid gets a heading for each month.
window.NBSort = function NBSort({ N, esc }) {
  const OPTIONS = [
    { value: 'added', label: 'Newest saved' },
    { value: 'added-old', label: 'Oldest saved' },
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

  // Newest / oldest added go by the day each thing was saved (not the order the PC's list happens to be in). Things
  // saved together in one go (a batch from the gallery) keep the order they were taken in.
  const batch = (it) => Math.floor((time(it.importedAt) || 0) / 60000);
  const byAdded = (dir) => (a, b) => (dir * (batch(b) - batch(a))) || (dir * (dated(b) - dated(a))) || 0;
  // Pinned things stay at the top whatever the order, the most recently pinned first. Kept on this phone.
  const pins = () => { try { const p = JSON.parse(N.getPref('itemPins') || '[]'); return Array.isArray(p) ? p : []; } catch (e) { return []; } };
  const isPinned = (id) => pins().includes(id);
  function setPins(ids, on) { const p = pins().filter((x) => !ids.includes(x)); N.setPref('itemPins', JSON.stringify(on ? ids.concat(p) : p)); }
  function apply(list, key) {
    const how = get(key), out = list.slice();
    if (how === 'added') out.sort(byAdded(1));
    else if (how === 'added-old') out.sort(byAdded(-1));
    else if (how === 'taken') out.sort(byTaken(1));
    else if (how === 'taken-old') out.sort(byTaken(-1));
    else out.sort((a, b) => String(a.title).localeCompare(String(b.title), 'en-GB', { numeric: true, sensitivity: 'base' }));
    const p = pins(), rank = (it) => { const i = p.indexOf(it.id); return i < 0 ? p.length : i; };
    return p.length ? out.sort((a, b) => rank(a) - rank(b)) : out;
  }

  const byMonth = (key) => !!key && get(key).startsWith('taken');
  const monthOf = (it) => { const t = dated(it); return Number.isNaN(t) ? 'No date' : new Date(t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };

  const TICK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  // The pill always says the order in use, briefly; the menu has the full wording.
  const SHORT = { added: 'Newest', 'added-old': 'Oldest', taken: 'Taken ↓', 'taken-old': 'Taken ↑', name: 'A–Z' };
  const pillHTML = (key) => `<button type="button" class="sortpill" data-a="sortOpen" aria-haspopup="menu" aria-label="Sort: ${esc(label(key))}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg><span>${esc(SHORT[get(key)])}</span></button>`;

  // The menu swells out of the sort button's lower edge like a drop (fluid.js) and goes back into it on the way out.
  let menu = null, menuFor = null;
  function openMenu(root, pill, key) {
    closeMenu(true);
    const r = pill.getBoundingClientRect();
    menu = document.createElement('div');
    menu.className = 'sortmenu';
    menu.setAttribute('role', 'menu');
    menu.style.visibility = 'hidden';
    menu.style.top = Math.round(r.bottom + 8) + 'px';
    menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
    menu.innerHTML = OPTIONS.map((o) => { const on = o.value === get(key); return `<button type="button" role="menuitemradio" aria-checked="${on}" class="${on ? 'on' : ''}" data-a="sortPick" data-v="${o.value}"><span>${esc(o.label)}</span>${on ? TICK : ''}</button>`; }).join('');
    root.appendChild(menu);
    menuFor = pill;
    NBFluid.drop(menu, pill, true);
  }
  function closeMenu(now) {
    if (!menu) return false;
    const m = menu, pill = menuFor; menu = null; menuFor = null;
    m.classList.add('out'); // on its way out: not tappable
    if (now) { m.__drop && m.__drop.svg.remove(); pill.classList.remove('joining'); m.remove(); return true; }
    NBFluid.drop(m, pill, false, () => m.remove());
    return true;
  }

  return { apply, get, set, byMonth, monthOf, pillHTML, openMenu, closeMenu, isPinned, setPins };
};
