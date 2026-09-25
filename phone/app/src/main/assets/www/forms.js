// Small forms on the phone: new board, rename or delete a board, an item in the Bin, pairing by typing.
window.NBForms = function NBForms({ S, $, N, esc, boards, byId, call, toast, wheel, settle, circ, showSyncMsg, updateChrome }) {
  function openForm(kind) {
    S.sheet = kind; S.add = false; S.cover = false;
    const f = $('#formsheet');
    const b = boards().find((x) => x.id === S.board);
    if (kind === 'newBoard') {
      f.innerHTML = `<span class="lbl">New board</span><input class="field" id="f1" maxlength="40" placeholder="Board name" autocomplete="off"><div class="formrow"><button type="button" class="btn" data-a="closeForm">Cancel</button><button type="button" class="btn white" data-a="saveForm">Create</button></div>`;
    } else if (kind === 'editBoard' && b) {
      f.innerHTML = `<span class="lbl">Board</span><input class="field" id="f1" maxlength="40" value="${esc(b.name)}" autocomplete="off"><div class="formrow"><button type="button" class="btn danger" data-a="deleteBoard">Delete board</button><span style="flex:1"></span><button type="button" class="btn white" data-a="saveForm">Save</button></div><div class="hint">Deleting a board keeps everything on it.</div>`;
    } else if (kind === 'binItem' && byId(S.binItem)) {
      const it = byId(S.binItem);
      f.innerHTML = `<span class="lbl">In the Bin</span><div style="font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</div><div class="formrow"><button type="button" class="btn danger" data-a="deleteForever">Delete forever</button><span style="flex:1"></span><button type="button" class="btn white" data-a="restoreItem">Put back</button></div>`;
    } else if (kind === 'manual') {
      f.innerHTML = `<span class="lbl">Pair by typing</span><input class="field" id="f1" inputmode="decimal" placeholder="PC address, e.g. 192.168.0.12" autocomplete="off"><input class="field" id="f2" placeholder="Pairing code" autocapitalize="characters" autocomplete="off"><div class="hint">Both are shown in Notebook on your PC under Phone.</div><div class="formrow"><button type="button" class="btn" data-a="closeForm">Cancel</button><button type="button" class="btn white" data-a="saveForm">Pair</button></div>`;
    }
    updateChrome();
    setTimeout(() => { const i = $('#f1'); if (i) { i.focus(); i.select(); } }, 250);
  }
  function closeForm() { S.sheet = null; updateChrome(); }
  function saveForm() {
    const v1 = ($('#f1') || {}).value || '', v2 = ($('#f2') || {}).value || '';
    if (S.sheet === 'newBoard') {
      const r = call('addBoard', v1);
      if (!r) return;
      closeForm();
      const k = wheel().findIndex((x) => x.id === r.id);
      if (k >= 0) settle(Math.round(S.pos + circ(k, S.pos)));
      toast(`Made “${v1.trim()}”`);
    } else if (S.sheet === 'editBoard') {
      if (call('renameBoard', S.board, v1)) closeForm();
    } else if (S.sheet === 'manual') {
      if (!v1.trim() || !v2.trim()) { toast('Type both the PC address and the code.'); return; }
      closeForm(); showSyncMsg('Pairing…'); N.pairManual(v1, v2);
    }
  }

  return { openForm, closeForm, saveForm };
};
