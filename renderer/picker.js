// Local file/folder picking uses Notebook's own modal; filesystem access stays in main.
NB.picker = function picker(request) {
  const { h, icon } = NB;
  let completed; const done = new Promise(resolve => { completed = resolve; });
  let location = null, parent = null, entries = [], selected = new Set(), turn = 0, closing = false, browsing = false, folderButton;
  const finish = async cancel => {
    if (closing) return; closing = true; choose.disabled = true;
    const answer = cancel ? null : request.folder ? [location] : [...selected];
    const result = await nb.replyUI(request.id, answer);
    if (result.error) { closing = false; modal.fail(result.error); updateChoice(); return; }
    await modal.close(); completed();
  };
  const modal = NB.modal(request.title, { wide: true, cancel: () => finish(true) });
  const places = h('nav', { class: 'picker-places', 'aria-label': 'Folders' });
  const address = h('input', { class: 'field picker-address', value: request.defaultPath, 'aria-label': 'Folder path', spellcheck: false });
  address.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); browse(address.value); } });
  const up = h('button', { class: 'btn small', type: 'button', 'aria-label': 'Parent folder', onclick: () => parent && browse(parent) }, icon('left'), 'Up');
  const filter = h('input', { class: 'field', type: 'search', placeholder: 'Filter this folder', 'aria-label': 'Filter this folder', oninput: () => draw() });
  const files = h('div', { class: 'picker-files', 'aria-label': request.folder ? 'Folders' : 'Files and folders' });
  const status = h('p', { class: 'hint picker-status', role: 'status' });
  const choose = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => finish(false) }, request.buttonLabel || 'Choose');
  const updateChoice = () => {
    choose.disabled = closing || browsing || !location || (!request.folder && !selected.size);
    if (folderButton) folderButton.disabled = closing || browsing || !location;
    status.textContent = request.folder ? 'The current folder will be used.' : selected.size ? `${selected.size} selected` : 'Choose one or more files.';
  };
  function draw() {
    const query = filter.value.trim().toLowerCase();
    const shown = entries.filter(entry => entry.name.toLowerCase().includes(query));
    files.replaceChildren();
    // Render in small batches so large photo folders do not block the window.
    let count = 0;
    const more = () => {
      files.querySelector('.picker-more')?.remove();
      const next = shown.slice(count, count + 200); count += next.length;
      for (const entry of next) {
        const row = h('button', { type: 'button', class: 'picker-entry' + (selected.has(entry.path) ? ' selected' : ''), 'aria-pressed': entry.directory ? null : String(selected.has(entry.path)), onclick: () => {
          if (entry.directory) return browse(entry.path);
          if (selected.has(entry.path)) selected.delete(entry.path); else selected.add(entry.path);
          row.classList.toggle('selected', selected.has(entry.path)); row.setAttribute('aria-pressed', String(selected.has(entry.path))); updateChoice();
        } }, icon(entry.directory ? 'folder' : 'photo'), h('span', null, entry.name), entry.directory ? icon('right') : h('span', { class: 'picker-tick', 'aria-hidden': 'true' }, icon('check')));
        files.append(row);
      }
      if (count < shown.length) files.append(h('button', { type: 'button', class: 'btn picker-more', onclick: more }, `Show more (${shown.length - count} remaining)`));
    };
    more();
    if (!shown.length) files.append(h('p', { class: 'hint' }, query ? 'Nothing matches that name.' : request.folder ? 'No folders inside this folder.' : 'No matching photos or videos in this folder.'));
  }
  async function browse(next) {
    const mine = ++turn; browsing = true; updateChoice(); files.inert = true; modal.fail('');
    files.setAttribute('aria-busy', 'true'); status.textContent = 'Opening folder…';
    const result = await nb.browseFiles(request.id, next);
    if (mine !== turn || closing || !modal.dialog.isConnected) return;
    files.removeAttribute('aria-busy'); browsing = false; files.inert = false;
    if (result.error) { modal.fail(result.error); address.value = location || next; updateChoice(); return; }
    location = result.path; parent = result.parent; entries = result.entries; selected.clear(); filter.value = '';
    address.value = location; up.disabled = !parent;
    draw(); files.scrollTop = 0; NB.motion.show(files); updateChoice();
  }
  const toolbar = h('div', { class: 'picker-toolbar' }, up, address, h('button', { class: 'btn small', type: 'button', onclick: () => browse(address.value) }, 'Go'));
  if (request.folder) {
    const newName = h('input', { class: 'field', placeholder: 'Folder name', 'aria-label': 'New folder name', maxlength: 120 });
    let creating = false;
    const create = async () => {
      if (creating || browsing || !location) return; creating = true;
      const result = await nb.createFolder(request.id, location, newName.value);
      creating = false;
      if (closing || !modal.dialog.isConnected) return;
      if (result.error) return modal.fail(result.error);
      NB.motion.hide(form); newName.value = ''; browse(result.path);
    };
    const form = h('div', { class: 'picker-new', hidden: true }, newName, h('button', { type: 'button', class: 'btn small', onclick: create }, 'Create'));
    newName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    toolbar.append(folderButton = h('button', { type: 'button', class: 'btn small', onclick: () => { if (NB.motion.isOpen(form)) NB.motion.hide(form); else { NB.motion.show(form); newName.focus(); } } }, 'New folder'));
    modal.body.append(toolbar, form);
  } else modal.body.append(toolbar);
  modal.body.append(h('div', { class: 'picker-layout' }, places, h('div', { class: 'picker-main' }, filter, files)), status);
  modal.actions.append(h('button', { type: 'button', class: 'btn', onclick: () => finish(true) }, 'Cancel'), choose);
  modal.dialog.addEventListener('keydown', e => { if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); if (parent) browse(parent); } });
  nb.filePlaces(request.id).then(result => {
    if (!modal.dialog.isConnected || result.error) return;
    places.replaceChildren(...result.places.map(place => h('button', { class: 'navrow', type: 'button', onclick: () => browse(place.path) }, icon('folder'), place.name)));
  });
  browse(request.defaultPath); address.focus({ preventScroll: true });
  return done;
};
