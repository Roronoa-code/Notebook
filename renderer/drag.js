// Drag and drop inside the app: a card (or stack, or everything picked) onto a board, onto another card
// to stack them, or onto the tray of boards that appears while dragging; and boards up or down the list.
(() => {
  const { h, toast } = NB;
  const $ = (id) => document.getElementById(id);
  const S = () => NB.S;

  const DRAG_TYPE = 'application/x-notebook-item';
  let dragging = null; // the ids being dragged (one card, or every picture in a stack)
  const ours = (e) => [...e.dataTransfer.types].includes(DRAG_TYPE);

  // A card (or stack) can be dragged onto a board, or onto another card to stack them together.
  function dragSource(el, ids) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      const chosen = NB.stacks.picked();
      dragging = ids.some((id) => chosen.includes(id)) ? chosen : ids; // a picked card brings the others along
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragging));
      e.dataTransfer.effectAllowed = 'copyMove';
      el.classList.add('lifted');
      showTray();
    });
    el.addEventListener('dragend', () => { dragging = null; el.classList.remove('lifted'); hideTray(); });
    const onSelf = () => !dragging || dragging.some((id) => ids.includes(id));
    el.addEventListener('dragover', (e) => { if (!ours(e) || onSelf()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('droptarget'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('droptarget'); });
    el.addEventListener('drop', async (e) => {
      el.classList.remove('droptarget');
      if (!ours(e) || onSelf()) return;
      e.preventDefault();
      const moving = dragging;
      const res = NB.apply(await nb.stackItems([...new Set([...ids, ...moving])], NB.currentBoardId()));
      if (res) { NB.stacks.clear(); toast('Stacked. Drag across it to go through them.'); }
    });
  }

  function dropTarget(el, boardId) {
    el.addEventListener('dragover', (e) => { if (ours(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('dropping'); } });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', (e) => {
      if (!ours(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('dropping');
      addToBoard(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)), boardId);
    });
  }

  // While dragging, a glass tray of boards appears so you can drop from anywhere on the page.
  function showTray() {
    const tray = $('tray');
    tray.replaceChildren(h('span', { class: 'tray-label micro' }, 'Drop on a board'));
    for (const b of S().snap.boards) {
      const target = h('div', { class: 'chip tog tray-target' }, b.name);
      dropTarget(target, b.id);
      tray.append(target);
    }
    tray.hidden = false;
  }
  const hideTray = () => { $('tray').hidden = true; };

  async function addToBoard(ids, boardId) {
    const name = NB.boardName(boardId);
    const todo = S().snap.items.filter((i) => ids.includes(i.id) && !i.boards.includes(boardId));
    if (!name) return;
    if (!todo.length) { toast(`Already on ${name}`); return; }
    const before = new Map(todo.map((i) => [i.id, i.boards]));
    for (const it of todo) if (!NB.apply(await nb.updateItem(it.id, { boards: [...it.boards, boardId] }))) return;
    toast(`Added to ${name}`, { action: { label: 'Undo', run: async () => { for (const [id, b] of before) NB.apply(await nb.updateItem(id, { boards: b })); } } });
  }

  // Drag a board up or down the list to move it. The others make room as you go.
  const BOARD_TYPE = 'application/x-notebook-board';
  let movingBoard = null;
  function boardDrag(el, id) {
    el.draggable = true;
    // Keyboard: Alt + up / down moves the focused board.
    el.addEventListener('keydown', async (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const order = S().snap.boards.map((b) => b.id), i = order.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      if (NB.apply(await nb.reorderBoards(order))) { const again = document.querySelector(`.bcard[data-id="${id}"]`); if (again) again.focus(); }
    });
    el.addEventListener('dragstart', (e) => { if (e.target !== el) return; movingBoard = id; e.dataTransfer.setData(BOARD_TYPE, id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('moving'); });
    el.addEventListener('dragend', () => { movingBoard = null; el.classList.remove('moving'); document.querySelectorAll('.bcard.before, .bcard.after').forEach((x) => x.classList.remove('before', 'after')); });
    el.addEventListener('dragover', (e) => {
      if (!movingBoard || movingBoard === id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      el.classList.toggle('after', after); el.classList.toggle('before', !after);
    });
    el.addEventListener('dragleave', () => el.classList.remove('before', 'after'));
    el.addEventListener('drop', async (e) => {
      if (!movingBoard || movingBoard === id) return;
      e.preventDefault(); e.stopPropagation();
      const after = el.classList.contains('after');
      el.classList.remove('before', 'after');
      const order = S().snap.boards.map((b) => b.id).filter((x) => x !== movingBoard);
      order.splice(order.indexOf(id) + (after ? 1 : 0), 0, movingBoard);
      const nav = $('boards'), was = new Map([...nav.querySelectorAll('.bcard[data-id]')].map((c) => [c.dataset.id, c.getBoundingClientRect().top]));
      if (!NB.apply(await nb.reorderBoards(order))) return;
      for (const c of nav.querySelectorAll('.bcard[data-id]')) {
        const dy = (was.get(c.dataset.id) ?? c.getBoundingClientRect().top) - c.getBoundingClientRect().top;
        if (dy) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1)' });
      }
    });
  }

  NB.drag = { TYPE: DRAG_TYPE, source: dragSource, target: dropTarget, board: boardDrag, addToBoard };
})();
