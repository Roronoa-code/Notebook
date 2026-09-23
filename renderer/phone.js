// The Phone panel: QR code and pairing code, paired phones, "keep ready" and whether sync is running.
(() => {
  const { h, icon, toast } = NB;
  const P = { shell: null, returnFocus: null, timer: null, status: null };

  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function call(name, ...args) {
    const res = await nb[name](...args);
    if (res.error) { toast(res.error, { error: true }); return null; }
    P.status = res.status;
    if (P.shell) render();
    return res;
  }

  function pairBox(s) {
    let box;
    if (s.qr) {
      box = h('div', { class: 'qr' }, h('img', { src: s.qr, alt: 'QR code to pair your phone', width: '240', height: '240', draggable: false }));
    } else {
      const text = !s.running ? 'The QR code appears once sync is running.'
        : s.codeState === 'used' ? 'That code has been used. Press New code to pair another phone.'
        : 'That code has run out. Press New code for a fresh one.';
      box = h('div', { class: 'qr gone' }, h('p', null, text));
    }
    return h('div', { class: 'pair' }, box,
      s.code ? [h('div', { class: 'micro' }, 'Pairing code'), h('div', { class: 'code', 'aria-label': 'Pairing code ' + s.code.split('').join(' ') }, s.code)] : null);
  }

  function statusLine(s) {
    let text, bad = false;
    if (s.running) text = `Ready: listening on port ${s.port}. This PC is called “${s.pcName}”.`;
    else if (s.error) { text = s.error; bad = true; }
    else text = 'Sync starts once a library is open.';
    const lines = [h('p', { class: 'status' + (bad ? ' bad' : '') }, text)];
    if (s.running && !s.addresses.length) lines.push(h('p', { class: 'status bad' }, "This PC isn't connected to a network, so your phone can't reach it."));
    if (s.running && s.discoveryError) lines.push(h('p', { class: 'hint' }, s.discoveryError));
    return lines;
  }

  function devices(s) {
    if (!s.devices.length) return h('p', { class: 'hint' }, 'No phones paired yet.');
    return h('ul', { class: 'devices' }, s.devices.map((d) => h('li', null,
      h('div', null, h('div', { class: 'dname' }, d.name), h('div', { class: 'hint' }, d.lastSyncAt ? `Last synced ${when(d.lastSyncAt)}` : 'Paired, not synced yet')),
      h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
        if (await call('syncUnpair', d.deviceId)) toast(`Unpaired ${d.name}. It will need a new code to sync again.`);
      } }, 'Unpair'))));
  }

  function render() {
    const s = P.status;
    const panel = P.shell.querySelector('.phone');
    const hadFocus = panel.contains(document.activeElement) && document.activeElement.id;
    const keep = h('input', { type: 'checkbox', id: 'keep-ready', checked: s.keepReady, onchange: (e) => call('syncKeepReady', e.target.checked) });
    panel.replaceChildren(
      h('div', { class: 'phone-head' },
        h('h2', { class: 'ctx-title', id: 'phone-title' }, 'Phone'),
        h('button', { type: 'button', class: 'iconbtn spin', id: 'phone-close', 'aria-label': 'Close', onclick: close }, icon('x'))),
      h('div', { class: 'phone-body' },
        pairBox(s),
        h('div', { class: 'phone-side' },
          h('p', { class: 'lead' }, 'Open Notebook on your phone, tap Sync, then Scan code.'),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn small', id: 'phone-new-code', disabled: !s.running, onclick: () => call('syncNewCode') }, 'New code'),
            h('span', { class: 'hint' }, 'Each code works once and lasts 10 minutes.')),
          h('h4', { class: 'micro' }, 'Paired phones'),
          devices(s),
          h('label', { class: 'keep', for: 'keep-ready' }, keep,
            h('span', null, h('span', { class: 'dname' }, 'Keep Notebook ready for your phone'),
              h('span', { class: 'hint' }, 'Your phone can sync whenever this PC is on, even if the Notebook window is closed.'))),
          h('div', { class: 'phone-foot' }, statusLine(s), h('p', { class: 'hint' }, 'If Windows asks, choose Allow on private networks.')))));
    if (hadFocus && document.getElementById(hadFocus)) document.getElementById(hadFocus).focus();
    // Redraw when the code runs out, so an expired code is never shown as if it still works.
    clearTimeout(P.timer);
    if (s.codeExpiresAt) P.timer = setTimeout(() => call('syncStatus'), Math.max(0, s.codeExpiresAt - Date.now()) + 500);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }

  async function open() {
    if (P.shell) return;
    P.returnFocus = document.activeElement;
    P.shell = h('div', null, h('div', { class: 'scrim', onclick: close }),
      h('section', { class: 'phone glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'phone-title' }));
    document.getElementById('viewer-root').append(P.shell);
    window.addEventListener('keydown', onKey, true);
    if (!(await call('syncOpen'))) { close(); return; }
    const first = document.getElementById('phone-close');
    if (first) first.focus();
  }

  function close() {
    if (!P.shell) return;
    clearTimeout(P.timer);
    P.shell.remove();
    P.shell = null;
    window.removeEventListener('keydown', onKey, true);
    if (P.returnFocus && document.contains(P.returnFocus)) P.returnFocus.focus();
  }

  // Pairing, syncs and unpairing change the list, so refresh while the panel is open.
  nb.onSyncChanged(() => { if (P.shell) call('syncStatus'); });

  NB.phone = { open, close, isOpen: () => !!P.shell };
})();
