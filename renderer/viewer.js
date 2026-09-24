// The open-item panel: full-size photo, in-app video, note editor, boards and Bin actions.
(() => {
  const { h, icon, toast } = NB;
  const V = { id: null, shell: null, returnFocus: null, saveTimer: null, saving: Promise.resolve(), tidyUndo: null, cropping: null };
  const item = () => NB.S.snap && NB.S.snap.items.find((i) => i.id === V.id);

  // ---------- note saving ----------
  function scheduleSave(editor) {
    clearTimeout(V.saveTimer);
    V.saveTimer = setTimeout(() => saveNote(editor), 500);
  }

  function saveNote(editor) {
    clearTimeout(V.saveTimer);
    V.saveTimer = null;
    const id = V.id;
    const html = NB.sanitize(editor.innerHTML);
    const title = NB.noteTitle(html);
    V.saving = V.saving.then(async () => {
      const res = await nb.updateItem(id, { html, title });
      if (res.error) { toast(`Your note couldn't be saved: ${res.error}`, { error: true }); return; }
      NB.S.snap = res.snap;
      const heading = V.shell && V.shell.querySelector('.note-title');
      if (heading && V.id === id) heading.textContent = title;
    });
    return V.saving;
  }

  async function flush() {
    const editor = V.shell && V.shell.querySelector('.editor');
    if (V.saveTimer && editor) saveNote(editor);
    await V.saving;
  }

  // ---------- building the panel ----------
  function stageFor(it) {
    if (it.kind === 'photo') {
      const stage = h('div', { class: 'stage' });
      const img = h('img', { src: it.src, alt: it.title, style: { objectViewBox: V.cropping ? '' : NB.viewBox(it) } });
      img.addEventListener('click', () => stage.classList.toggle('zoomed'));
      img.addEventListener('error', () => stage.replaceChildren(h('p', { class: 'ph' }, "This photo can't be shown. The file is still stored in your library.")));
      stage.append(img);
      return stage;
    }
    if (it.kind === 'video') {
      const stage = h('div', { class: 'stage' });
      const video = h('video', { src: it.src, preload: 'auto', playsInline: true, loop: true, style: { objectViewBox: V.cropping ? '' : NB.viewBox(it) } });
      video.muted = true;
      video.addEventListener('error', () => stage.replaceChildren(h('p', { class: 'ph' },
        "This video's format can't play inside Notebook. It's still safely stored: use “Show file in folder” to open it in another player.")));
      if (V.cropping) { stage.append(video); return stage; }
      stage.append(quietPlayer(it, video));
      return stage;
    }
    return noteEditor(it);
  }

  // The quiet player (like the phone's): plays on a loop with the sound off. Click to pause, drag along
  // the line to move through it, the speaker for sound. Space and M work too.
  function quietPlayer(it, video) {
    const fill = h('div', { class: 'vfill' });
    const time = h('span', { class: 'vtime', 'aria-hidden': 'true' });
    const bar = h('div', { class: 'vbar', role: 'slider', tabindex: '0', 'aria-label': 'Position', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
    const sound = h('button', { type: 'button', class: 'vsound', 'aria-label': 'Sound on', 'aria-pressed': 'false' }, icon('mute'));
    const box = h('div', { class: 'vbox', tabindex: '-1', 'aria-label': 'Video: Space plays or pauses, M for sound' },
      it.thumbSrc ? h('img', { class: 'vposter', src: it.thumbSrc, alt: '', style: { objectViewBox: NB.viewBox(it) } }) : null,
      video, h('span', { class: 'vpaused', 'aria-hidden': 'true' }, icon('play')), time, bar, sound);
    // The still picture stays underneath until the video is really playing, so nothing flashes.
    video.addEventListener('playing', () => { box.classList.add('live'); box.classList.remove('paused'); });
    video.addEventListener('pause', () => box.classList.add('paused'));
    let frame = 0;
    const paint = () => {
      if (!box.isConnected) return;
      const p = video.duration ? video.currentTime / video.duration : 0;
      fill.style.transform = `scaleX(${p.toFixed(4)})`;
      bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      time.textContent = video.duration ? `${NB.duration(video.currentTime)} / ${NB.duration(video.duration)}` : '';
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    video.play().catch(() => box.classList.add('paused'));
    const toggle = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
    const setSound = (on) => {
      video.muted = !on;
      sound.setAttribute('aria-pressed', String(on));
      sound.setAttribute('aria-label', on ? 'Sound off' : 'Sound on');
      sound.replaceChildren(icon(on ? 'sound' : 'mute'));
    };
    box.addEventListener('click', (e) => { if (!e.target.closest('.vbar, .vsound')) toggle(); });
    sound.addEventListener('click', () => setSound(video.muted));
    const seek = (x) => { const r = bar.getBoundingClientRect(); if (video.duration) video.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * video.duration; };
    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId); box.classList.add('seeking'); seek(e.clientX);
      const move = (m) => seek(m.clientX);
      const up = () => { box.classList.remove('seeking'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 2); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); video.currentTime = Math.max(0, video.currentTime - 2); }
    });
    V.player = { toggle, sound: () => setSound(video.muted), stop: () => cancelAnimationFrame(frame) };
    return box;
  }

  function noteEditor(it) {
    const editor = h('div', { class: 'editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note', 'data-placeholder': 'Start typing… then press Tidy up to turn it into a heading and bullet points.', spellcheck: 'true' });
    editor.innerHTML = NB.sanitize(it.html);
    const tidyBtn = h('button', { type: 'button', class: 'btn accent small' }, h('span', null, 'Tidy up'));
    const setTidyLabel = () => { tidyBtn.lastChild.textContent = V.tidyUndo != null ? 'Undo tidy' : 'Tidy up'; };
    V.tidyUndo = null;
    editor.addEventListener('input', () => { if (V.tidyUndo != null) { V.tidyUndo = null; setTidyLabel(); } scheduleSave(editor); });
    editor.addEventListener('paste', (e) => {
      // Paste as plain text so formatting from websites doesn't come along.
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    tidyBtn.addEventListener('click', () => {
      if (V.tidyUndo != null) {
        editor.innerHTML = V.tidyUndo; V.tidyUndo = null;
      } else {
        const tidy = NB.autoTidy(editor.innerText);
        if (!tidy) { toast('Write something first, then tidy it'); return; }
        V.tidyUndo = editor.innerHTML;
        editor.innerHTML = tidy;
        editor.classList.remove('tidied'); void editor.offsetWidth; editor.classList.add('tidied');
      }
      setTidyLabel();
      saveNote(editor);
    });
    const cmd = (label, content, run) => {
      const b = h('button', { type: 'button', class: 'tb', 'aria-label': label, title: label }, content);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
      b.addEventListener('click', () => { editor.focus(); run(); scheduleSave(editor); });
      return b;
    };
    const inHeading = () => { const n = window.getSelection().anchorNode; return !!(n && (n.nodeType === 1 ? n : n.parentElement).closest('h2')); };
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
      cmd('Bold (Ctrl+B)', 'B', () => document.execCommand('bold')),
      cmd('Italic (Ctrl+I)', h('i', { style: { fontFamily: 'Georgia, serif' } }, 'I'), () => document.execCommand('italic')),
      cmd('Bulleted list', icon('list'), () => document.execCommand('insertUnorderedList')),
      cmd('Heading', 'H', () => document.execCommand('formatBlock', false, inHeading() ? 'DIV' : 'H2')),
      h('span', { style: { flex: '1' } }), tidyBtn);
    return h('div', { class: 'editor-wrap' }, toolbar, editor);
  }

  // "+ New board" chip: type a name, press Enter, and the item goes straight onto it.
  function newBoardChip(it) {
    const chip = h('button', { type: 'button', class: 'chip tog add' }, icon('plus'), h('span', null, 'New board'));
    chip.addEventListener('click', () => {
      const input = h('input', { class: 'chip-input', placeholder: 'Board name', maxlength: '40', 'aria-label': 'New board name' });
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        const name = input.value.trim();
        if (!save || !name) { input.replaceWith(chip); return; }
        const made = NB.apply(await nb.addBoard(name));
        if (!made) { input.replaceWith(chip); return; }
        const current = made.snap.items.find((i) => i.id === it.id);
        NB.apply(await nb.updateItem(it.id, { boards: [...current.boards, made.id] }));
        toast(`Made “${NB.boardName(made.id)}” and added this to it`);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; input.blur(); }
      });
      input.addEventListener('blur', () => finish(true));
      chip.replaceWith(input);
      input.focus();
    });
    return chip;
  }

  function boardChips(it) {
    const boards = NB.S.snap.boards;
    return [...boards.map((b) => {
      const on = it.boards.includes(b.id);
      return h('button', { type: 'button', class: 'chip tog' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: async () => {
        const next = on ? it.boards.filter((x) => x !== b.id) : [...it.boards, b.id];
        const res = await nb.updateItem(it.id, { boards: next });
        if (res.error) { toast(res.error, { error: true }); return; }
        NB.S.snap = res.snap;
        refreshSide();
      } }, h('span', null, b.name), on ? icon('check') : null);
    }), newBoardChip(it)];
  }

  // A short note on a photo or video: why it was saved, sizes, where it's from…
  function captionBox(it) {
    const box = h('textarea', { class: 'caption', 'aria-label': 'Note about this item', maxlength: '5000', placeholder: 'Why did you save this? e.g. chest 27in, want it in black' });
    box.value = it.caption || '';
    let timer = null;
    const save = async () => {
      clearTimeout(timer);
      if (box.value === ((item() || {}).caption || '')) return;
      const res = await nb.updateItem(it.id, { caption: box.value });
      if (res.error) toast(`Your note couldn't be saved: ${res.error}`, { error: true }); else NB.S.snap = res.snap;
    };
    box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 600); });
    box.addEventListener('blur', save);
    return box;
  }

  // "Show on phone": on unless switched off here. The PC is the hub, so only the PC decides.
  function phoneSwitch(it) {
    const box = h('input', { type: 'checkbox', id: 'on-phone', checked: it.phone !== false });
    box.addEventListener('change', async () => {
      const res = await nb.setOnPhone([it.id], box.checked);
      if (res.error) { toast(res.error, { error: true }); box.checked = !box.checked; return; }
      NB.S.snap = res.snap;
      toast(box.checked ? 'It will show on your phone after the next sync' : 'It will leave your phone at the next sync. It stays here.');
    });
    return h('label', { class: 'keep', for: 'on-phone' }, box, h('span', null, h('span', { class: 'dname' }, 'Show on phone'),
      h('span', { class: 'hint' }, 'Switch off to keep this on your PC only. Your phone removes its copy when it next syncs.')));
  }

  function metaText(it) {
    const bits = [];
    if (it.deletedAt) bits.push('In the Bin');
    if (it.kind === 'note') bits.push(`Note · last edited ${NB.date(it.updatedAt)}`);
    else {
      bits.push(it.kind === 'video' ? 'Video' : 'Photo');
      if (it.w && it.h) bits.push(`${Math.round(it.w)} × ${Math.round(it.h)}`);
      if (it.duration) bits.push(NB.duration(it.duration));
      bits.push(NB.bytes(it.size), `added ${NB.date(it.importedAt)}`, `original: ${it.originalName}`);
    }
    return bits.join(' · ');
  }

  // Cropping: the whole picture with a frame to drag; the side panel holds Save / Cancel.
  function startCrop() {
    V.cropping = true;
    fill(false);
    const it = item();
    V.crop = NB.crop.edit(V.shell.querySelector('.stage'), it, async (crop) => {
      V.cropping = null; V.crop = null;
      if (crop !== undefined) {
        const res = NB.apply(await nb.updateItem(it.id, { crop }));
        if (res) toast(crop ? 'Cropped. Your original file is unchanged.' : 'Showing the whole picture again');
      }
      if (V.shell && item()) fill(false);
    });
  }
  function cropSide() {
    return h('div', { class: 'side' },
      h('div', { class: 'top' }, h('span'), h('button', { type: 'button', class: 'iconbtn spin', 'aria-label': 'Cancel crop', onclick: () => V.crop.cancel() }, icon('x'))),
      h('h2', { class: 'title-input', style: { margin: '0' } }, 'Crop'),
      h('p', { class: 'hint' }, 'Drag the frame to choose what shows. Drag a corner or edge to resize it. This only changes how it looks in Notebook and on your phone: the original file stays whole.'),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => V.crop.reset() }, 'Show the whole picture'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => V.crop.cancel() }, 'Cancel'), h('span', { style: { flex: '1' } }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => V.crop.save() }, icon('check'), 'Save crop')));
  }

  function side(it) {
    if (V.cropping) return cropSide();
    const list = NB.visibleItems();
    const idx = list.findIndex((i) => i.id === it.id);
    const navBtn = (dir) => h('button', { type: 'button', class: 'iconbtn', 'aria-label': dir < 0 ? 'Previous item' : 'Next item', disabled: idx < 0 || !list[idx + dir], onclick: () => step(dir) }, icon(dir < 0 ? 'left' : 'right'));
    let title;
    if (it.kind === 'note') {
      title = h('h2', { class: 'title-input note-title', style: { margin: '0' } }, it.title);
    } else {
      title = h('textarea', { class: 'title-input', rows: '1', 'aria-label': 'Title', maxlength: '120', spellcheck: 'false' });
      title.value = it.title;
      const save = async () => {
        if (title.value.trim() === it.title) return;
        const res = await nb.updateItem(it.id, { title: title.value });
        if (res.error) toast(res.error, { error: true }); else NB.S.snap = res.snap;
      };
      title.addEventListener('change', save);
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    }
    const actions = it.deletedAt
      ? h('button', { type: 'button', class: 'btn accent', onclick: () => restoreItem(it) }, icon('restore'), 'Restore with its boards')
      : h('button', { type: 'button', class: 'btn danger', onclick: () => binItem(it) }, icon('bin'), 'Move to Bin');
    return h('div', { class: 'side' },
      h('div', { class: 'top' }, h('div', { class: 'nav' }, navBtn(-1), navBtn(1)), h('button', { type: 'button', class: 'iconbtn spin', 'aria-label': 'Close', onclick: close }, icon('x'))),
      title,
      h('p', { class: 'meta micro' }, metaText(it)),
      it.kind !== 'note' ? [h('h4', { class: 'micro' }, 'Note'), captionBox(it)] : null,
      NB.smart.labelsPanel(it),
      h('h4', { class: 'micro' }, 'Boards'),
      h('div', { class: 'tags' }, boardChips(it)),
      h('p', { class: 'hint' }, 'One item can be on several boards. Taking it off a board never deletes it.'),
      it.deletedAt ? null : phoneSwitch(it),
      it.stack && !it.deletedAt ? h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const res = NB.apply(await nb.unstackItem(it.id));
        if (res) { toast('Taken out of the stack'); refreshSide(); }
      } }, icon('stack'), 'Take out of stack') : null,
      !it.deletedAt && it.kind !== 'note' && it.w && it.h ? h('button', { type: 'button', class: 'btn small', onclick: startCrop }, icon('crop'), it.crop ? 'Change crop' : 'Crop') : null,
      it.kind !== 'note' ? h('button', { type: 'button', class: 'linkbtn', onclick: () => nb.revealItem(it.id) }, 'Show file in folder') : null,
      h('div', { class: 'actions' }, actions, h('span', { style: { flex: '1' } }), h('button', { type: 'button', class: 'btn primary', onclick: close }, 'Done')));
  }

  function refreshSide() {
    const it = item();
    const old = V.shell && V.shell.querySelector('.side');
    if (old && old.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return; // don't interrupt typing
    if (it && old) old.replaceWith(side(it));
  }

  function fill(focusEditor) {
    const it = item();
    const panel = V.shell.querySelector('.viewer');
    panel.setAttribute('aria-label', it.title);
    if (V.player) { V.player.stop(); V.player = null; } // the previous item's player
    const stage = stageFor(it);
    // Size the picture area to the photo/video's own shape so there's no empty black space.
    panel.classList.toggle('fit', !!(it.kind !== 'note' && it.w && it.h));
    panel.style.width = '';
    panel.replaceChildren(stage, side(it));
    fitStage();
    const editor = panel.querySelector('.editor');
    if (editor && focusEditor) {
      editor.focus();
      const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } else (panel.querySelector('.vbox') || panel.querySelector('.iconbtn.spin')).focus({ preventScroll: true }); // a video takes the keys (Space, M)
  }

  // Sizes the panel so the photo/video frame matches its shape: no empty black bars.
  function fitStage() {
    const it = item();
    const panel = V.shell && V.shell.querySelector('.viewer.fit');
    if (!panel || !it) return;
    const SIDE = 380, GAP = 26, PAD = 40, M = V.cropping ? 44 : 0; // while cropping, a margin so the frame's corners can be grabbed
    const height = window.innerHeight * 0.9 - PAD - M;
    const maxWidth = window.innerWidth * 0.9 - PAD - GAP - SIDE - M;
    const s = V.cropping ? { w: it.w, h: it.h } : NB.shape(it); // while cropping, the whole picture
    const width = Math.max(320, Math.min(maxWidth, height * (s.w / s.h)));
    const stage = panel.querySelector('.stage');
    stage.style.width = width + M + 'px';
    stage.style.height = Math.min(height, width * (s.h / s.w)) + M + 'px';
    stage.classList.toggle('cropping', !!V.cropping);
    panel.style.width = width + M + PAD + GAP + SIDE + 'px';
  }
  window.addEventListener('resize', fitStage);

  // ---------- actions ----------
  async function binItem(it) {
    await flush();
    const res = NB.apply(await nb.moveToBin(it.id));
    if (!res) return;
    close();
    toast('Moved to Bin', { action: { label: 'Undo', run: async () => NB.apply(await nb.restore(it.id)) } });
  }

  async function restoreItem(it) {
    const res = NB.apply(await nb.restore(it.id));
    if (!res) return;
    const names = (res.snap.items.find((i) => i.id === it.id) || { boards: [] }).boards.map(NB.boardName).filter(Boolean);
    close();
    toast(`Restored to ${names.length ? names.join(' & ') : 'All items'}`);
  }

  async function step(dir) {
    if (V.cropping) return;
    const list = NB.visibleItems();
    const next = list[list.findIndex((i) => i.id === V.id) + dir];
    if (!next) return;
    await flush();
    V.id = next.id;
    fill(false);
  }

  function onKey(e) {
    if (V.cropping) return; // the crop frame has its own keys
    if (e.key === 'Escape' && document.querySelector('.ddlist:not(.out)')) return; // Esc closes the open dropdown first
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"], video');
    if (e.target.closest && e.target.closest('.vbar') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // moving through the video
    if (!typing && V.player && e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); V.player.toggle(); return; }
    if (!typing && V.player && e.key.toLowerCase() === 'm') { e.preventDefault(); V.player.sound(); return; }
    if (!typing && e.key === 'Delete') { const it = item(); if (it && !it.deletedAt) { e.preventDefault(); binItem(it); } }
    if (!typing && e.key === 'ArrowLeft') step(-1);
    if (!typing && e.key === 'ArrowRight') step(1);
  }

  async function close() {
    if (!V.shell) return;
    V.cropping = null; V.crop = null;
    if (V.player) { V.player.stop(); V.player = null; }
    if (V.shell.contains(document.activeElement)) document.activeElement.blur(); // saves a title being edited
    await flush();
    V.shell.remove();
    V.shell = null; V.id = null;
    document.body.classList.remove('viewing');
    window.removeEventListener('keydown', onKey, true);
    NB.apply({ snap: NB.S.snap });
    if (V.returnFocus && document.contains(V.returnFocus)) V.returnFocus.focus();
  }

  NB.viewer = {
    isOpen: () => !!V.shell,
    open(id, opts = {}) {
      if (!V.shell) {
        V.returnFocus = document.activeElement;
        V.shell = h('div', null, h('div', { class: 'scrim', onclick: close }), h('section', { class: 'viewer glass', role: 'dialog', 'aria-modal': 'true' }));
        document.getElementById('viewer-root').append(V.shell);
        document.body.classList.add('viewing');
        window.addEventListener('keydown', onKey, true);
      }
      V.id = id;
      fill(!!opts.focus);
    },
    close,
    // Called after the library changes: close if the item vanished, otherwise update the side panel.
    refresh() { if (V.shell) { if (!item()) { V.shell.remove(); V.shell = null; V.id = null; document.body.classList.remove('viewing'); window.removeEventListener('keydown', onKey, true); } else refreshSide(); } }
  };
})();
