// The shortcuts sheet (press ?, or Library → Keyboard shortcuts): every key and gesture in one place.
(() => {
  const { h, icon } = NB;
  function shortcuts() {
    if (document.querySelector('.keys')) return;
    const K = (...k) => h('span', { class: 'kbd' }, k.map((x) => h('kbd', null, x)));
    const row = (keys, what) => h('div', { class: 'krow' }, keys, h('span', null, what));
    const close = () => { sheet.classList.add('out'); scrim.classList.add('out'); setTimeout(() => { sheet.remove(); scrim.remove(); }, 200); window.removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); close(); } };
    const scrim = h('div', { class: 'scrim keys-scrim', onclick: () => close() });
    const sheet = h('section', { class: 'keys popover', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts and gestures' },
      h('div', { class: 'keys-head' }, h('h2', { class: 'display' }, 'Shortcuts'), h('button', { type: 'button', class: 'iconbtn spin', 'aria-label': 'Close', onclick: () => close() }, icon('x'))),
      h('div', { class: 'kgrid' },
        h('div', null, h('h4', { class: 'micro' }, 'Adding'),
          row(K('Ctrl', 'V'), 'Paste a picture, or a TikTok / Pinterest link'),
          row(K('Drag in'), 'Photos, videos, whole folders, or pictures from a browser'),
          row(K('Ctrl', 'N'), 'New note')),
        h('div', null, h('h4', { class: 'micro' }, 'The board'),
          row(K('Ctrl', 'F'), 'Search (words, types, styles, colours)'),
          row(K('Ctrl', '+ / −'), 'Bigger or smaller cards (or Ctrl + wheel)'),
          row(K('Ctrl', 'A'), 'Pick everything showing'),
          row(K('Delete'), 'Move what’s picked to the Bin'),
          row(K('Esc'), 'Stop picking, or clear the search')),
        h('div', null, h('h4', { class: 'micro' }, 'Cards'),
          row(K('Drag onto a card'), 'Stack them'),
          row(K('Drag across a stack'), 'Flick through it (or scroll sideways)'),
          row(K('Drag onto a board'), 'Add it to that board'),
          row(K('Ctrl', 'click'), 'Pick several'),
          row(K('Drag a board'), 'Move it up or down the list (or Alt + ↑ / ↓)')),
        h('div', null, h('h4', { class: 'micro' }, 'Open item'),
          row(K('←', '→'), 'Previous or next'),
          row(K('Delete'), 'Move it to the Bin'),
          row(K('Esc'), 'Close'))));
    document.body.append(scrim, sheet);
    window.addEventListener('keydown', key, true);
    sheet.querySelector('.iconbtn').focus();
  }

  NB.shortcuts = shortcuts;
})();
