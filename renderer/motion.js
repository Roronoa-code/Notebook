// One reversible motion for transient Notebook surfaces, plus the shared in-app modal shell.
(() => {
  const moving = new WeakMap(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function set(el, open, anchor) {
    if (!el) return Promise.resolve(false);
    if (!open && el.hidden) return Promise.resolve(true);
    const old = moving.get(el), current = old?.animation ? getComputedStyle(el) : null;
    const from = current && { opacity: current.opacity, transform: current.transform };
    old?.animation?.cancel();
    el.classList.add('motion-surface'); el.hidden = false;
    const base = old?.base ?? getComputedStyle(el).transform;
    const rest = base === 'none' ? '' : base;
    const folded = el.classList.contains('scrim') ? base : `${rest} translateY(6px) scale(.98)`;
    if (anchor?.isConnected) {
      el.motionAnchor = anchor;
      const a = anchor.getBoundingClientRect(), b = el.getBoundingClientRect();
      el.style.transformOrigin = `${Math.max(0, Math.min(b.width, a.left + a.width / 2 - b.left))}px ${a.bottom <= b.top + 8 ? 'top' : a.top >= b.bottom - 8 ? 'bottom' : 'center'}`;
    }
    el.dataset.motionOpen = String(open); el.inert = !open;
    const state = { base, animation: null }; moving.set(el, state);
    const finish = () => {
      if (moving.get(el) !== state) return false;
      el.hidden = !open; state.animation?.cancel(); state.animation = null;
      return true;
    };
    if (reduced.matches) return Promise.resolve(finish());
    state.animation = el.animate([from || { opacity: open ? 0 : 1, transform: open ? folded : base }, { opacity: open ? 1 : 0, transform: open ? base : folded }],
      { duration: open ? 200 : 140, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    return state.animation.finished.then(finish, () => false);
  }
  NB.motion = {
    show: (el, anchor) => set(el, true, anchor), hide: el => set(el, false),
    remove: async el => {
      if (!el) return; const focused = el.contains(document.activeElement);
      if (await set(el, false)) { el.remove(); if (focused && document.activeElement === document.body && el.motionAnchor?.isConnected) el.motionAnchor.focus({ preventScroll: true }); }
    },
    isOpen: el => !!el && !el.hidden && el.dataset.motionOpen !== 'false',
    find: selector => [...document.querySelectorAll(selector)].find(el => el.dataset.motionOpen !== 'false')
  };
  NB.modalOpen = () => !!document.querySelector('dialog.notebook-dialog[open]');
  NB.modal = (title, { wide = false, cancel = () => {} } = {}) => {
    const focus = document.activeElement, { h } = NB;
    const body = h('div', { class: 'dialog-body' }), actions = h('div', { class: 'dialog-actions' });
    const error = h('p', { class: 'dialog-error', role: 'alert', hidden: true });
    const dialog = h('dialog', { class: 'notebook-dialog' + (wide ? ' wide' : ''), 'aria-labelledby': 'notebook-dialog-title' },
      h('h2', { id: 'notebook-dialog-title' }, title), body, error, actions);
    dialog.addEventListener('cancel', e => { e.preventDefault(); cancel(); });
    document.body.append(dialog); dialog.showModal(); NB.motion.show(dialog);
    return { dialog, body, actions, error,
      fail: message => { error.hidden = !message; error.textContent = message || ''; },
      close: async () => { await NB.motion.hide(dialog); dialog.close(); dialog.remove(); if (focus?.isConnected) focus.focus({ preventScroll: true }); }
    };
  };
  let requests = Promise.resolve();
  nb.onUIRequest(request => { requests = requests.then(() => handleRequest(request)); });
  async function handleRequest(request) {
    if (request.kind === 'pick') return NB.picker(request);
    let completed; const done = new Promise(resolve => { completed = resolve; });
    let closing = false;
    const finish = async accepted => {
      if (closing) return; closing = true;
      modal.dialog.inert = true;
      await modal.close(); await nb.replyUI(request.id, accepted); completed();
    };
    const modal = NB.modal(request.message, { cancel: () => finish(false) });
    modal.body.append(NB.h('p', { class: 'hint' }, request.detail));
    const cancel = NB.h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancel');
    modal.actions.append(cancel, NB.h('button', { class: 'btn danger confirm-accept', type: 'button', onclick: () => finish(true) }, request.okLabel));
    cancel.focus({ preventScroll: true });
    return done;
  }
})();
// Replace browser title bubbles with the same small Notebook surface.
(() => {
  let tip, timer, target;
  const clean = node => {
    if (!(node instanceof Element)) return;
    for (const el of [node, ...node.querySelectorAll('[title]')]) if (el.hasAttribute('title')) {
      el.dataset.notebookTip = el.getAttribute('title');
      if (!el.hasAttribute('aria-description')) el.setAttribute('aria-description', el.dataset.notebookTip);
      el.removeAttribute('title');
    }
  };
  clean(document.documentElement);
  new MutationObserver(records => records.forEach(r => { if (r.type === 'attributes') clean(r.target); else r.addedNodes.forEach(clean); }))
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  const hide = () => { clearTimeout(timer); if (tip) { NB.motion.remove(tip); tip = null; } target = null; };
  const show = e => {
    const el = e.target.closest?.('[data-notebook-tip]'); if (el === target) return;
    hide(); if (!el) return; target = el;
    timer = setTimeout(() => {
      if (!el.isConnected) return;
      tip = NB.h('div', { class: 'notebook-tip', role: 'tooltip' }, el.dataset.notebookTip);
      (el.closest('dialog') || document.body).append(tip);
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + (r.width - t.width) / 2)) + 'px';
      tip.style.top = (r.bottom + t.height + 14 < innerHeight ? r.bottom + 8 : r.top - t.height - 8) + 'px';
      NB.motion.show(tip, el);
    }, e.type === 'focusin' ? 200 : 500);
  };
  document.addEventListener('pointerover', show); document.addEventListener('focusin', show);
  document.addEventListener('pointerout', e => { if (target && !target.contains(e.relatedTarget)) hide(); });
  for (const event of ['pointerdown', 'keydown', 'focusout', 'scroll']) document.addEventListener(event, hide, true);
})();
// Keep keyboard focus in the visible sheet; HTML dialogs already do this themselves.
window.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || NB.modalOpen()) return;
  const sheet = [...document.querySelectorAll('.viewer, .phone, .keys, .ideaview')].reverse().find(el => NB.motion.isOpen(el) && !el.closest('[inert]'));
  if (!sheet) return;
  const buttons = [...sheet.querySelectorAll('button, input, textarea, [tabindex="0"], [contenteditable="true"]')].filter(el => !el.disabled && el.getClientRects().length && !el.closest('[inert]'));
  const first = buttons[0], last = buttons.at(-1);
  if (first && (!sheet.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last))) {
    e.preventDefault(); (e.shiftKey ? last : first).focus();
  }
}, true);
