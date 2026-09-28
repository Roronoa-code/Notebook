// The Sync screen: pairing with the PC, sync status, and what the app reports while syncing.
window.NBSyncScreen = function NBSyncScreen({ S, $, db, esc, svg, P, ago, plural, live, binned, statusText, home, toast }) {
  let phase = '', since = 0;
  function syncHTML() {
    return `<div class="screen" style="padding:calc(var(--st) + 20px) 20px calc(var(--sb) + 120px);display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:6px"><div class="poster" style="font-size:64px">Sync</div><div style="font-size:14px;color:#9A9A9A">Phone and PC, over your home Wi-Fi. Nothing goes online.</div></div>
      <div id="syncbody"></div>
      <button type="button" class="glass panel binrow" data-a="openBin"><span style="display:flex;align-items:center;gap:12px">${svg(P.bin, 20, 1.8)}<span style="font-size:16px;font-weight:600">Bin</span></span><span class="micro" id="binrowcount">${plural(binned().length, 'item')}</span></button>
    </div>`;
  }

  function syncBodyHTML() {
    const s = db().sync || {};
    if (!s.paired) {
      return `<div class="glass panel">
        <div style="font-size:30px;font-weight:300;letter-spacing:-.02em">Pair with your PC</div>
        <ol class="steps"><li>On your PC, open Notebook and click <b>Phone</b>.</li><li>Tap <b>Scan code</b> here and point your camera at the code.</li></ol>
        <div style="font-size:13px;color:#9A9A9A">You only do this once. After that they stay connected and sync on their own whenever you're home.</div>
        <div id="syncmsg" class="syncmsg" hidden></div>
        <button type="button" class="btn white" data-a="scan" style="width:100%">Scan code</button>
        <button type="button" class="linkbtn" data-a="manual">Type the code instead</button>
      </div>`;
    }
    return `<div class="glass panel">
      <div style="display:flex;align-items:center;gap:14px"><span class="pcicon">${svg(P.pc, 24)}</span>
        <div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:16px;font-weight:600">${esc(s.pcName || 'Your PC')}</span><span style="font-size:13px;color:#9A9A9A">Paired · syncs on its own when you're home</span></div></div>
      <div id="synctitle"${phase === 'connecting' && S.syncing ? ` data-nb-orb="connecting" data-nb-since="${since}" aria-busy="true"` : ''} style="font-size:40px;font-weight:200;letter-spacing:-.03em;line-height:1">${S.syncing ? (phase === 'connecting' ? 'Finding your PC…' : 'Syncing…') : 'Up to date'}</div>
      <div class="bar" id="syncbar"${S.syncing ? '' : ' hidden'}><div></div></div>
      <div id="syncmsg" class="syncmsg" hidden></div>
      <div class="twocol"><div class="stat"><span class="lbl">Last sync</span><span id="synclast">${ago(s.lastSync)}</span></div><div class="stat"><span class="lbl">On this phone</span><span>${plural(live().length, 'item')}</span></div></div>
      <button type="button" class="btn white" data-a="syncNow" style="width:100%">Sync now</button>
      <button type="button" class="linkbtn" data-a="unpair" id="unpairbtn">Forget this PC</button>
    </div>`;
  }

  // ---------- sync feedback from the app ----------
  function showSyncMsg(msg, isError) {
    const m = $('#syncmsg');
    if (!m) return;
    m.hidden = !msg; m.textContent = msg || ''; m.classList.toggle('err', !!isError);
  }
  window.nbOnSync = (json) => {
    const ev = JSON.parse(json);
    if (phase !== ev.phase) { phase = ev.phase; since = Date.now(); }
    const title = $('#synctitle'), bar = $('#syncbar');
    NBEffects.set(title, ev.phase === 'connecting' ? 'connecting' : null, since);
    if (ev.phase === 'error') {
      S.syncing = false;
      if (title) title.textContent = "Couldn't sync";
      if (bar) bar.hidden = true;
      showSyncMsg(ev.message, true);
      if (S.screen !== 'sync') toast(ev.message);
      return;
    }
    if (ev.phase === 'done') {
      S.syncing = false;
      if (ev.status) db().sync = ev.status;
      if (title) title.textContent = 'Up to date';
      if (bar) bar.hidden = true;
      showSyncMsg('');
      if ($('#synclast')) $('#synclast').textContent = ago((db().sync || {}).lastSync);
      if (home()) home().querySelector('#synced').textContent = statusText();
      return;
    }
    S.syncing = true;
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
      if (home()) home().querySelector('#synced').textContent = statusText();
    } else { showSyncMsg(ev.message, true); toast(ev.message); }
  };

  return { syncHTML, syncBodyHTML, showSyncMsg };
};
