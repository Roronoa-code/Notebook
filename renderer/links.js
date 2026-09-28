// Saving from links (build plan B1) and the Pinterest panel (B2) on the page:
// paste a TikTok or Pinterest link anywhere (or into "Save a link") and it saves by itself; failures
// go to the retry list under Links; the Pinterest panel shows the real site with "Save to library".
(() => {
  const { h, icon, toast } = NB;
  const $ = (id) => document.getElementById(id);
  const isLink = (s) => /^https?:\/\/([\w-]+\.)*(tiktok\.com|pinterest\.[a-z.]+|pin\.it)\//i.test(String(s).trim());
  let retry = [];

  // ---------- saving ----------
  async function save(url) {
    url = String(url).trim();
    if (!isLink(url)) { toast('That doesn’t look like a TikTok or Pinterest post link.', { error: true }); return; }
    const board = NB.S.board !== 'all' && NB.S.board !== 'bin' ? NB.S.board : null;
    await nb.saveLink(url, board); // the result arrives through onLinkSaved
  }
  nb.onLinkSaving(({ url }) => {
    const msg = `Saving from ${/tiktok/i.test(url) ? 'TikTok' : 'Pinterest'}…`;
    setStatus(msg);
    toast(msg, { key: 'link-save:' + url, duration: 0 });
    NBEffects.set($('link-input').closest('.linkwrap'), 'beam', Date.now());
  });
  nb.onLinkSaved((r) => {
    NBEffects.set($('link-input').closest('.linkwrap'), null);
    retry = r.retry || retry;
    renderCount();
    if (r.snap) NB.apply({ snap: r.snap });
    if (r.ok) {
      const n = r.added.length;
      const source = /tiktok/i.test(r.url) ? 'TikTok' : 'Pinterest';
      const msg = r.already ? (r.already === 'bin' ? 'You saved that before: it’s in your Bin' : 'Already in your notebook')
        : n > 1 ? `Added ${n} ${source} photos — stacked together` : `${source} added to your notebook`;
      setStatus(msg); toast(msg, { key: 'link-save:' + r.url, success: !r.already, duration: 6000 });
    } else {
      setStatus(r.error); toast(r.error, { key: 'link-save:' + r.url, error: true, action: { label: 'Links', run: openLinks } });
    }
    if (NB.motion.find('.linkspop')) drawLinks();
  });

  // Paste a link anywhere (not while typing somewhere) and it's saved straight away. A pasted picture
  // (a screenshot, or an image copied from a browser) is added the same way.
  document.addEventListener('paste', (e) => {
    if (NB.modalOpen()) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
    const media = [...e.clipboardData.files].filter((f) => /^(image|video)\//.test(f.type));
    if (media.length) { e.preventDefault(); NB.importBlobs(media); return; }
    const text = (e.clipboardData.getData('text/plain') || '').trim();
    if (isLink(text)) { e.preventDefault(); save(text); }
  });
  const box = $('link-input');
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && box.value.trim()) { save(box.value); box.value = ''; } });
  box.addEventListener('paste', (e) => { const t = e.clipboardData.getData('text/plain'); if (isLink(t)) { e.preventDefault(); save(t); box.value = ''; } });

  // ---------- Links: retry list, check, update ----------
  function renderCount() { const n = $('links-count'); n.textContent = retry.length || ''; }
  async function openLinks() {
    const old = NB.motion.find('.linkspop');
    if (old) { NB.motion.remove(old); $('links-btn').setAttribute('aria-expanded', 'false'); return; }
    const pop = h('div', { class: 'popover linkspop', role: 'dialog', 'aria-label': 'Saved links' });
    document.body.append(pop);
    $('links-btn').setAttribute('aria-expanded', 'true');
    await drawLinks(); if (pop.isConnected && NB.motion.isOpen(pop)) NB.motion.show(pop, $('links-btn'));
  }
  async function drawLinks(note) {
    const pop = NB.motion.find('.linkspop');
    if (!pop) return;
    const info = await nb.links();
    if (!pop.isConnected || !NB.motion.isOpen(pop)) return;
    retry = info.retry || [];
    renderCount();
    const busy = (btn, label) => { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.dataset.idleLabel = btn.lastChild.textContent; btn.lastChild.textContent = label; NBEffects.set(btn.firstElementChild, 'working', Date.now()); };
    const done = async (btn, note) => {
      const slot = btn.firstElementChild;
      slot.classList.add('done');
      if (slot.querySelector('canvas') && !matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 180));
      NBEffects.set(slot, null);
      btn.lastChild.textContent = btn.dataset.idleLabel;
      if (btn.isConnected) drawLinks(note);
    };
    const check = h('button', { type: 'button', class: 'btn small', onclick: async () => {
      busy(check, 'Checking…');
      const r = await nb.checkLinks();
      if (r.error) return done(check, r.error);
      const bad = r.results.filter((x) => !x.ok).length;
      done(check, bad ? `${bad} of ${r.results.length} recent links can’t be read now. Try Update downloader.` : `All ${r.results.length} recent links still work.`);
    } }, h('span', { class: 'work-icon', 'aria-hidden': 'true' }, icon('check')), h('span', null, 'Check my links'));
    const update = h('button', { type: 'button', class: 'btn small', onclick: async () => {
      busy(update, 'Updating…');
      const r = await nb.updateDownloader();
      done(update, r.error || `Downloader updated: yt-dlp ${r.update.versions.ytdlp}, gallery-dl ${r.update.versions.gallerydl}.`);
    } }, h('span', { class: 'work-icon', 'aria-hidden': 'true' }, icon('restore')), h('span', null, 'Update downloader'));
    pop.replaceChildren(...[ // (a null left in would show as the word "null")
      h('strong', null, 'Saving from links'),
      h('p', { class: 'hint' }, 'Paste a TikTok or Pinterest link anywhere and it’s saved to your notebook. Anything that fails waits here.'),
      !info.ready ? h('p', { class: 'hint bad' }, 'The downloader tools aren’t set up on this PC yet (see the guide).') : null,
      retry.length ? h('ul', { class: 'retry' }, retry.map((r) => h('li', null,
        h('div', { class: 'rurl' }, r.url.replace(/^https?:\/\/(www\.)?/, '')), h('div', { class: 'hint' }, r.error),
        h('div', { class: 'rbtns' },
          h('button', { type: 'button', class: 'btn small', onclick: () => save(r.url) }, 'Retry'),
          h('button', { type: 'button', class: 'btn small', onclick: async () => { const x = await nb.forgetLink(r.url); retry = x.retry; drawLinks(); } }, 'Remove'))))) : h('p', { class: 'hint' }, 'Nothing waiting to retry.'),
      h('div', { class: 'popgrid' }, check, update),
      note ? h('p', { class: 'status' }, note) : null,
      info.versions ? h('p', { class: 'hint' }, `yt-dlp ${info.versions.ytdlp} · gallery-dl ${info.versions.gallerydl}. Nothing updates by itself.`) : null].filter(Boolean));
  }
  $('links-btn').addEventListener('click', openLinks);
  document.addEventListener('mousedown', (e) => { const p = NB.motion.find('.linkspop'); if (p && !p.contains(e.target) && !$('links-btn').contains(e.target)) { NB.motion.remove(p); $('links-btn').setAttribute('aria-expanded', 'false'); } });

  // ---------- Pinterest panel ----------
  const panel = $('pinpanel'), host = $('pinhost'), status = $('pinstatus');
  function setStatus(msg) { if (status) status.textContent = msg || ''; }
  const rect = () => { const r = host.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
  let open = false, aside = false, panelTurn = 0;
  async function openPanel(url) {
    const mine = ++panelTurn; open = true;
    document.body.classList.add('pinning');
    const entering = NB.motion.show(panel, $('pin-btn'));
    $('pin-btn').classList.add('on');
    $('pin-btn').setAttribute('aria-pressed', 'true');
    await entering;
    if (open && mine === panelTurn && !aside) pinState(await nb.pinOpen(rect(), url));
  }
  async function closePanel() {
    if (!open) return;
    const mine = ++panelTurn; open = false;
    await nb.pinClose();
    if (mine !== panelTurn) return;
    NB.motion.hide(panel);
    document.body.classList.remove('pinning');
    $('pin-btn').classList.remove('on');
    $('pin-btn').setAttribute('aria-pressed', 'false');
  }
  function pinState(s) {
    if (!s) return;
    $('pin-save').disabled = !s.pin;
    $('pin-save').dataset.pin = s.pin || '';
    $('pin-back').disabled = !s.canBack;
    if (!s.pin) setStatus('Open a pin, then Save to library. Or right-click any pin and choose Save to Notebook.');
  }
  nb.onPinState(pinState);
  // "Hide AI pins": on by default; shows how many were hidden this time.
  const aiBox = $('pin-ai'), aiText = $('pin-ai-text');
  const drawAi = (s) => { aiBox.checked = !!s.hide; aiText.textContent = s.hide && s.hidden ? `${s.hidden} AI pin${s.hidden === 1 ? '' : 's'} hidden` : 'Hide AI pins'; };
  nb.pinAiSetting().then((s) => s && !s.error && drawAi(s));
  aiBox.addEventListener('change', async () => { const s = await nb.pinAiSetting(aiBox.checked); if (s && !s.error) drawAi(s); });
  nb.onPinAi((s) => drawAi({ hide: aiBox.checked, hidden: s.hidden }));
  new ResizeObserver(() => { if (open) nb.pinBounds(rect()); }).observe(host);
  $('pin-btn').addEventListener('click', () => (open ? closePanel() : openPanel()));
  $('pin-close').addEventListener('click', closePanel);
  $('pin-back').addEventListener('click', () => nb.pinBack());
  $('pin-home').addEventListener('click', () => nb.pinHome());
  $('pin-save').addEventListener('click', async () => { const r = await nb.pinSave(); if (r && r.error) setStatus(r.error); });
  window.addEventListener('keydown', (e) => { if (!NB.modalOpen() && e.key === 'Escape' && open && !aside) closePanel(); });

  // Pinterest is drawn over the page, so anything opened on top of it (a menu, the Phone panel, an open
  // item, the shortcuts sheet) would be hidden behind it. Pinterest steps aside until that closes.
  const OVERLAY = '.popover:not([hidden]), .viewer, .phone, .ddlist, .keys, .ideaview, dialog[open]';
  let checking = false;
  const check = () => {
    checking = false;
    if (!open) { aside = false; return; }
    const covered = !!document.querySelector(OVERLAY);
    if (covered && !aside) { aside = true; nb.pinClose(); }
    else if (!covered && aside) { aside = false; nb.pinOpen(rect()).then(pinState); }
  };
  new MutationObserver(() => { if (!checking) { checking = true; requestAnimationFrame(check); } })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

  // Opens a pin in the Pinterest panel (from Ideas).
  async function openAt(url) {
    if (!open) openPanel(url);
    else pinState(await nb.pinGo(url));
  }
  NB.links = { save, isLink, closePanel, openAt, isOpen: () => open };
  nb.links().then((i) => { retry = i.retry || []; renderCount(); });
})();
