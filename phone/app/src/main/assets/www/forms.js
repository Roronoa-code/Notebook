// Small forms on the phone: new board, rename or delete a board, an item in the Bin, pairing by typing, a Pinterest
// idea. Every one opens the same way, as a sheet rising from the bottom edge (the + is kept for making things).
window.NBForms = function NBForms({ S, $, N, esc, boards, byId, call, toast, showSyncMsg, updateChrome }) {
  let focusTimer = 0, closeTimer = 0, closeToken = 0, closing = false;
  // One owner for the keyboard's height, which is the only thing that moves a small form up and down. On the phone
  // the app reports it every frame while the keyboard slides (window.nbKeyboard), so the form rides on top of it
  // the whole way. Elsewhere (the browser's own resize, which arrives as one final number) the form follows that
  // number on a quick spring from where it is drawn now. Either way it never jumps, and it is never applied twice.
  const kb = { at: 0, to: 0, v: 0, raf: 0, native: false, moving: false, changed: 0, watch: new Set() };
  // (while the form rides the bottom surface into or out of the +, the surface owns its place: it isn't moved under it)
  const paintKb = () => { const f = $('#formsheet'); if (f && !f.classList.contains('riding')) f.style.setProperty('--keyboard', kb.at.toFixed(1) + 'px'); kb.watch.forEach((w) => w()); };
  window.nbKeyboard = (dp, moving) => {
    kb.native = true; cancelAnimationFrame(kb.raf); kb.raf = 0;
    kb.at = kb.to = Math.max(0, +dp || 0); kb.moving = !!moving; kb.changed = performance.now();
    paintKb();
  };
  const fromViewport = () => {
    if (kb.native) return;
    const viewport = window.visualViewport;
    kb.to = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
    kb.changed = performance.now();
    if (kb.raf || Math.abs(kb.to - kb.at) < 0.5) { if (!kb.raf) { kb.at = kb.to; paintKb(); } return; }
    let last = performance.now();
    const step = (now) => {
      let dt = Math.max(0, Math.min(0.064, (now - last) / 1000)); last = now;
      while (dt > 0) { const h = Math.min(dt, 0.008), w = 24; dt -= h; kb.v += (-w * w * (kb.at - kb.to) - 2 * w * kb.v) * h; kb.at += kb.v * h; }
      kb.moving = Math.abs(kb.at - kb.to) > 0.5 || Math.abs(kb.v) > 5;
      if (!kb.moving) { kb.at = kb.to; kb.v = 0; kb.raf = 0; } else kb.raf = requestAnimationFrame(step);
      kb.changed = performance.now();
      paintKb();
    };
    kb.raf = requestAnimationFrame(step);
  };
  window.visualViewport?.addEventListener('resize', fromViewport);
  window.visualViewport?.addEventListener('scroll', fromViewport);
  window.addEventListener('resize', fromViewport);
  // The keyboard is on its way (or only just arrived): a tap beside the form lands where the form was a moment ago,
  // so it isn't taken as "close the form".
  const keyboardBusy = () => kb.moving || performance.now() - kb.changed < 350;
  function openForm(kind, html) {
    cancelAnimationFrame(focusTimer); clearTimeout(closeTimer); closeToken++; closing = false;
    S.sheet = kind; S.add = false; S.cover = false;
    const f = $('#formsheet');
    f.classList.toggle('boardbar', kind === 'editBoard');
    f.inert = false;
    paintKb();
    const b = boards().find((x) => x.id === S.board);
    if (kind === 'idea') f.innerHTML = html;
    else if (kind === 'newBoard') {
      f.innerHTML = `<span class="lbl">Create board</span><input class="field" id="f1" maxlength="40" placeholder="Board name" autocomplete="off"><div class="formrow"><button type="button" class="btn" data-a="closeForm">Cancel</button><button type="button" class="btn white" data-a="saveForm">Create board</button></div>`;
    } else if (kind === 'editBoard' && b) {
      const pin = (window.nbPinned ? window.nbPinned() : []).includes(b.id);
      // Compact, like the picking bar: the name (tap to rename), close; pin, delete (tap twice), save.
      f.innerHTML = `<input class="field" id="f1" maxlength="40" value="${esc(b.name)}" autocomplete="off" aria-label="Board name" enterkeyhint="done"><button type="button" class="selx" data-a="closeForm" aria-label="Close board options"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button><button type="button" class="selx${pin ? ' on' : ''}" data-a="pinBoard" aria-pressed="${pin}" aria-label="${pin ? 'Unpin from the front' : 'Pin to the front'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v7"/></svg></button><button type="button" class="selx danger" data-a="deleteBoard" aria-label="Delete board (its items stay)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg><span class="surelbl">Delete?</span></button><button type="button" class="btn white" data-a="saveForm">Save</button>`;
    } else if (kind === 'binItem' && byId(S.binItem)) {
      const it = byId(S.binItem);
      f.innerHTML = `<span class="lbl">In the Bin</span><div style="font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</div><div class="formrow"><button type="button" class="btn danger" data-a="deleteForever">Delete forever</button><span style="flex:1"></span><button type="button" class="btn white" data-a="restoreItem">Put back</button></div>`;
    } else if (kind === 'manual') {
      f.innerHTML = `<span class="lbl">Pair by typing</span><input class="field" id="f1" inputmode="decimal" placeholder="PC address, e.g. 192.168.0.12" autocomplete="off"><input class="field" id="f2" placeholder="Pairing code" autocapitalize="characters" autocomplete="off"><div class="hint">Both are shown in Notebook on your PC under Phone.</div><div class="formrow"><button type="button" class="btn" data-a="closeForm">Cancel</button><button type="button" class="btn white" data-a="saveForm">Pair</button></div>`;
    }
    updateChrome();
    // A form that is just for typing (New board, pairing) brings up the keyboard by itself, the moment it has grown
    // out of the + and can be typed in; board options wait for a tap in the field.
    if (kind === 'newBoard' || kind === 'manual') {
      const t0 = performance.now();
      const ready = () => {
        if (S.sheet !== kind || closing) return;
        const field = $('#f1');
        if (field && !f.inert && !f.classList.contains('riding')) { field.focus({ preventScroll: true }); return; }
        if (performance.now() - t0 < 1500) focusTimer = requestAnimationFrame(ready);
      };
      focusTimer = requestAnimationFrame(ready);
    }
  }
  function closeForm() {
    if (closing || !S.sheet) return;
    closing = true; cancelAnimationFrame(focusTimer);
    const f = $('#formsheet'), active = document.activeElement;
    const typing = (!!active && f.contains(active) && active.matches('input, textarea')) || kb.at > 40; // (tapping Cancel may already have taken the focus)
    if (active && f.contains(active)) active.blur();
    f.inert = true;
    const token = ++closeToken;
    // Typing: the form rides the keyboard down first, then folds away from where it has landed.
    const finish = () => {
      kb.watch.delete(check);
      if (token !== closeToken) return;
      clearTimeout(closeTimer);
      S.sheet = null; closing = false; updateChrome();
    };
    const start = performance.now();
    const check = () => { if (kb.at < 40 && !kb.moving && performance.now() - start >= 120) finish(); };
    if (!typing) finish();
    else {
      kb.watch.add(check);
      closeTimer = setTimeout(finish, 700);
      setTimeout(check, 140);
    }
  }
  // Something missing: the white button that was pressed says so itself (in a row, it stretches across as the
  // buttons beside it step aside), then turns back into itself a moment later or as soon as you type. No new pop-up.
  const EASE = getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease';
  function nudge(btn, msg) {
    if (!btn) return;
    try { window.nbHap && window.nbHap('fail'); } catch (e) { /* no haptics */ }
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches, row = btn.parentNode.classList.contains('formrow') ? btn.parentNode : null;
    const others = row ? [...row.children].filter((k) => k !== btn) : [];
    if (btn.__back) { btn.__back(true); }
    const label = btn.innerHTML, w0 = btn.getBoundingClientRect().width, ow = others.map((k) => k.getBoundingClientRect().width), gap = row ? getComputedStyle(row).columnGap : '0px';
    btn.innerHTML = `<span class="nudgeword">${esc(msg)}</span>`;
    if (row) row.classList.add('saying');
    btn.classList.add('saying');
    const w1 = btn.getBoundingClientRect().width;
    const o = { duration: 380, easing: EASE };
    if (!calm) {
      btn.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }], o);
      btn.firstChild.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: 110, easing: EASE, fill: 'backwards' });
      others.forEach((k, i) => k.animate([{ maxWidth: ow[i] + 'px', opacity: 1 }, { maxWidth: '0px', opacity: 0 }], o));
      if (row) row.animate([{ columnGap: gap }, { columnGap: '0px' }], o);
    }
    const field = btn.closest('.formsheet')?.querySelector('.field');
    let timer = 0;
    const back = (now) => {
      clearTimeout(timer); field?.removeEventListener('input', onType); btn.__back = null;
      if (!btn.isConnected) return;
      const a = btn.getBoundingClientRect().width;
      btn.innerHTML = label; btn.classList.remove('saying'); if (row) row.classList.remove('saying');
      if (now || calm) return;
      const b = btn.getBoundingClientRect().width;
      btn.animate([{ width: a + 'px' }, { width: b + 'px' }], o);
      btn.firstChild?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 120, fill: 'backwards' });
      others.forEach((k, i) => k.animate([{ maxWidth: '0px', opacity: 0 }, { maxWidth: ow[i] + 'px', opacity: 1 }], o));
      if (row) row.animate([{ columnGap: '0px' }, { columnGap: gap }], o);
    };
    const onType = () => back(false);
    field?.addEventListener('input', onType);
    field?.focus({ preventScroll: true });
    timer = setTimeout(() => back(false), 2000);
    btn.__back = back;
  }
  function saveForm() {
    const v1 = ($('#f1') || {}).value || '', v2 = ($('#f2') || {}).value || '';
    const pressed = $('#formsheet [data-a="saveForm"]');
    if (S.sheet === 'newBoard' && !v1.trim()) { nudge(pressed, 'Give the board a name'); return; }
    if (S.sheet === 'editBoard' && !v1.trim()) { nudge(pressed, 'Name it'); return; }
    if (S.sheet === 'manual' && (!v1.trim() || !v2.trim())) { nudge(pressed, 'Type both first'); return; }
    if (S.sheet === 'newBoard') {
      const r = call('addBoard', v1);
      if (!r) return;
      closeForm();
      requestAnimationFrame(() => { const pile = document.querySelector(`.pile[data-v="${r.id}"]`); if (pile) pile.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); });
      toast(`Made “${v1.trim()}”`);
    } else if (S.sheet === 'editBoard') {
      if (call('renameBoard', S.board, v1)) closeForm();
    } else if (S.sheet === 'manual') {
      closeForm(); showSyncMsg('Pairing…'); N.pairManual(v1, v2);
    }
  }

  return { openForm, closeForm, saveForm, keyboardBusy };
};
