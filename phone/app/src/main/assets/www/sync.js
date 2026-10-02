// The Sync screen: pairing with the PC, sync status, and what the app reports while syncing.
window.NBSyncScreen = function NBSyncScreen({ S, $, db, esc, svg, P, ago, plural, live, binned, statusText, home, toast, top }) {
  let phase = '', since = 0;
  const chevron = svg('M9 6l6 6-6 6', 16);
  const row = (a, label, hint = '') => `<button type="button" class="rowbtn" data-a="${a}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>${chevron}</button>`;
  // Gallery cleanup shows where the session is and one next step: allow access, start, or stop. Sample mode
  // only describes it; real phone operations happen in your own notebook.
  let gallery = {};
  function galleryHTML() {
    const s = gallery, paired = !!(db().sync || {}).paired;
    let state, main = '', rows = '';
    if (window.NBNative.demo) state = 'Works in your own notebook, once it is paired with your PC. The sample notebook never touches your photos.';
    else if (!paired) state = 'Pair with your PC above first.';
    else if (!window.NBNative.galleryStatus) state = 'Not available on this version of the app.';
    else if (s.scope === 'No access') { state = 'Notebook needs access to your photos and videos first.'; main = '<button class="btn white wide" type="button" data-a="galleryPermissions">Allow photo access</button>'; }
    else if (!s.active) {
      state = s.message || 'Clear this phone’s photos from your PC. Start once, then put your phone away: it stays available until you stop it (or 30 minutes unused).';
      main = '<button class="btn white wide" type="button" data-a="galleryStart">Start cleanup</button>';
      rows = row('galleryPermissions', 'Photo access', esc(s.scope || '')) + (s.manage ? '' : row('galleryManage', 'Fewer confirmation prompts')) + row('pastePairingLink', 'Paste secure pairing link');
    } else {
      state = s.message || (s.ready ? 'Ready on your PC.' : 'Connecting securely to your PC…');
      main = `<button class="btn wide" type="button" data-a="galleryStop">${s.ready ? 'Stop cleanup' : 'Cancel'}</button>`;
    }
    const busy = s.active && !s.ready ? ` data-nb-orb="connecting" data-nb-since="${gallery.since || Date.now()}" aria-busy="true"` : '';
    return `<h2 class="poster sectiontitle">Gallery cleanup</h2><p class="syncmsg" id="gallery-status" role="status"${busy}>${esc(state)}</p>${main}${rows ? `<div class="rows">${rows}</div>` : ''}`;
  }
  function paintGallery() { const el = document.getElementById('gallery-session'); if (el) el.innerHTML = galleryHTML(); }
  window.nbOnGallery = (json) => {
    const next = JSON.parse(json || '{}');
    if (next.active && !(gallery.active && !gallery.ready)) next.since = Date.now(); else next.since = gallery.since;
    const changed = JSON.stringify({ ...next, since: 0 }) !== JSON.stringify({ ...gallery, since: 0 });
    gallery = next;
    if (changed) paintGallery();
  };
  setInterval(() => {
    if (document.getElementById('gallery-session') && window.NBNative?.galleryStatus && !window.NBNative.demo) window.nbOnGallery(NBNative.galleryStatus());
  }, 1500);
  function syncHTML() {
    if (window.NBNative?.galleryStatus && !window.NBNative.demo) { try { gallery = JSON.parse(NBNative.galleryStatus() || '{}'); } catch (e) { gallery = {}; } }
    return `<div class="screen util">
      ${top('Sync', 'home')}
      <div class="utilbody sync">
        <div id="syncbody">${syncBodyHTML()}</div>
        <section class="panel" id="gallery-session">${galleryHTML()}</section>
        <button type="button" class="panel binrow" data-a="openBin"><span style="display:flex;align-items:center;gap:12px">${svg(P.bin, 20, 1.8)}<span style="font-size:16px;font-weight:600">Bin</span></span><span class="micro" id="binrowcount">${plural(binned().length, 'item')}</span></button>
      </div>
    </div>`;
  }

  function syncBodyHTML() {
    const s = db().sync || {};
    if (window.NBNative.demo) {
      return `<div class="samplebar" role="note"><div><b>Sample notebook</b><span>Made-up boards and pictures. Nothing here syncs.</span></div><button type="button" class="btn white" data-a="demoOff">Back to mine</button></div>`;
    }
    if (!s.paired) {
      return `<div class="panel">
        <div class="poster" style="font-size:34px">Pair with your PC</div>
        <ol class="steps"><li>PC: open Notebook, click <b>Phone</b>.</li><li>Here: tap <b>Scan code</b>.</li></ol>
        <div id="syncmsg" class="syncmsg" hidden></div>
        <button type="button" class="btn white" data-a="scan" style="width:100%"><span class="face">Scan code</span></button>
        <div class="rows">${row('manual', 'Type the code instead')}${window.NBNative.demo === undefined ? row('demoOn', 'Try a sample notebook first', 'Made-up pictures; your notebook is untouched') : ''}</div>
      </div>`;
    }
    return `<div class="panel">
      <div style="display:flex;align-items:center;gap:14px"><span class="pcicon">${svg(P.pc, 24)}</span>
        <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:16px;font-weight:600">${esc(s.pcName || 'Your PC')}</span><span style="font-size:13px;color:var(--text-3)">Paired</span></div></div>
      <div class="poster" id="synctitle"${phase === 'connecting' && S.syncing ? ` data-nb-orb="connecting" data-nb-since="${since}" aria-busy="true"` : ''} style="font-size:44px">${S.syncing ? (phase === 'connecting' ? 'Finding your PC…' : 'Syncing…') : 'Up to date'}</div>
      <div class="bar" id="syncbar"${S.syncing ? '' : ' hidden'}><div></div></div>
      <div id="syncmsg" class="syncmsg" hidden></div>
      <div class="twocol"><div class="stat"><span class="lbl">Last sync</span><span id="synclast">${ago(s.lastSync)}</span></div><div class="stat"><span class="lbl">On this phone</span><span>${plural(live().length, 'item')}</span></div></div>
      <button type="button" class="btn white" data-a="syncNow" id="syncbtn" style="width:100%"><span class="face">${S.syncing ? 'Syncing…' : 'Sync now'}</span></button>
      <div class="rows"><button type="button" class="rowbtn danger" data-a="unpair" id="unpairbtn"><span>Forget this PC</span>${chevron}</button></div>
    </div>`;
  }

  // ---------- sync feedback from the app ----------
  function showSyncMsg(msg, isError) {
    const m = $('#syncmsg');
    if (!m) return;
    m.hidden = !msg; m.textContent = msg || ''; m.classList.toggle('err', !!isError);
  }
  // The wait/success/retry states live on the same button (approved): the label is replaced by the orb while it
  // works, then a soft green Done, or a red glow and a small shake on failure.
  let doneTimer = 0;
  function swapFace(btn, text) {
    const f = btn && btn.querySelector('.face');
    if (!f || f.textContent === text) return;
    const ease = 'cubic-bezier(.22,1,.36,1)';
    f.getAnimations().forEach((a) => a.cancel());
    f.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 120, easing: ease }).onfinish = () => {
      f.textContent = text; f.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: ease });
    };
  }
  function syncButton(state, since) {
    const btn = $('#syncbtn'), orb = document.getElementById('orb');
    if (orb) orb.classList.toggle('busy', state === 'working');
    if (window.nbPaintStatus) window.nbPaintStatus();
    if (!btn) return;
    clearTimeout(doneTimer);
    btn.classList.remove('working', 'done', 'fail');
    NBEffects.set(btn, state === 'working' ? 'working' : null, since);
    if (state === 'working') { btn.classList.add('working'); swapFace(btn, 'Syncing…'); }
    else if (state === 'done') {
      btn.classList.add('done'); swapFace(btn, 'Done'); window.nbHap && window.nbHap('success');
      doneTimer = setTimeout(() => { btn.classList.remove('done'); swapFace(btn, 'Sync now'); }, 2200);
    } else if (state === 'fail') { btn.classList.add('fail'); swapFace(btn, 'Try again'); window.nbHap && window.nbHap('fail'); }
    else swapFace(btn, 'Sync now');
  }
  // Away from the Sync screen a problem is said in one short sentence that fits the message pill; what to do about
  // it is shown on the Sync screen, where there is room to read it.
  const headline = (m) => { const first = String(m || '').match(/^[^.!?]*[.!?]/); return first && first[0].length < String(m).length ? first[0] : m; };
  window.nbOnSync = (json) => {
    const ev = JSON.parse(json);
    if (phase !== ev.phase) { phase = ev.phase; since = Date.now(); }
    const title = $('#synctitle'), bar = $('#syncbar');
    NBEffects.set(title, ev.phase === 'connecting' ? 'connecting' : null, since);
    if (ev.phase === 'error') {
      S.syncing = false; syncButton('fail');
      if (title) title.textContent = "Couldn't sync";
      if (bar) bar.hidden = true;
      showSyncMsg(ev.message, true);
      S.syncFailed = true; if (window.nbPaintStatus) window.nbPaintStatus();
      if (S.screen !== 'sync') toast(headline(ev.message)); // the whole explanation waits on the Sync screen
      return;
    }
    if (ev.phase === 'done') {
      S.syncing = false; S.syncFailed = false; syncButton('done');
      if (ev.status) db().sync = ev.status;
      if (title) title.textContent = 'Up to date';
      if (bar) bar.hidden = true;
      showSyncMsg('');
      if ($('#synclast')) $('#synclast').textContent = ago((db().sync || {}).lastSync);
      if (window.nbPaintStatus) window.nbPaintStatus();
      return;
    }
    S.syncing = true; if (!$('#syncbtn')?.classList.contains('working')) syncButton('working', since);
    if (bar) bar.hidden = false;
    const words = { connecting: 'Finding your PC…', merging: 'Syncing…', downloading: `Getting ${ev.done + 1} of ${ev.total}`, uploading: `Sending ${ev.done + 1} of ${ev.total}` };
    if (title) title.textContent = ev.phase === 'connecting' ? words.connecting : 'Syncing…';
    showSyncMsg(ev.phase === 'downloading' || ev.phase === 'uploading' ? words[ev.phase] : '');
  };
  window.nbOnPair = (json) => {
    const ev = JSON.parse(json);
    if (ev.ok) {
      db().sync = ev.status;
      toast(`Paired with ${ev.status.pcName || 'your PC'}`);
      if (S.screen === 'sync') $('#syncbody').innerHTML = syncBodyHTML();
      if (window.nbPaintStatus) window.nbPaintStatus();
    } else { showSyncMsg(ev.message, true); toast(ev.message); }
  };

  return { syncHTML, syncBodyHTML, showSyncMsg };
};
