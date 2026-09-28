// Runs in the Pinterest panel. Promoted pins are taken out of Pinterest's answers before they arrive
// (main/adfilter.js); this is the fallback: any pin still labelled as sponsored is hidden. It also
// hides pins this PC finds to be AI-made.
// It only hides things on the page; nothing is sent anywhere.
const { contextBridge, ipcRenderer } = require('electron');

// AI-made pins: every pin picture on the page is checked once on this PC (Notebook's detector); a pin
// found to be AI-made is quietly hidden. (This runs beside the page, not inside Pinterest's own code.)
{
  const verdict = new Map(); // picture address -> 'checking' | true | false
  let queued = false;
  const hide = (item) => { item.dataset.nbAi = '1'; item.style.setProperty('display', 'none', 'important'); };
  const scan = () => {
    queued = false;
    for (const img of document.querySelectorAll('[data-grid-item="true"] img[src*="pinimg.com"]')) {
      const item = img.closest('[data-grid-item="true"]'), src = img.currentSrc || img.src;
      if (/\/\d+x\d+_RS\//.test(src) || (img.naturalWidth && img.naturalWidth < 150)) continue; // the little profile pictures under a pin
      if (!item || item.dataset.nbAi) continue;
      const v = verdict.get(src);
      if (v === true) { hide(item); continue; }
      if (v !== undefined) continue;
      verdict.set(src, 'checking');
      ipcRenderer.invoke('pin:ai', src).then((r) => { verdict.set(src, !!(r && r.hide)); if (r && r.hide) scan(); }).catch(() => verdict.delete(src));
    }
  };
  const start = () => new MutationObserver(() => { if (!queued) { queued = true; setTimeout(scan, 200); } }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
}

contextBridge.executeInMainWorld({
  func: () => {
    const LABEL = /^\s*(Sponsored|Promoted|Promoted by|Ad)\s*$/i;
    let queued = false;
    const sweep = () => {
      queued = false;
      for (const f of document.querySelectorAll('[data-test-id="pinrep-footer"]')) {
        const item = f.closest('[data-grid-item="true"]');
        if (!item || item.dataset.nbAd) continue;
        const w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) {
          if (!LABEL.test(n.nodeValue)) continue;
          item.dataset.nbAd = '1';
          item.style.setProperty('display', 'none', 'important');
          window.__nbAdsHidden = (window.__nbAdsHidden || 0) + 1;
          break;
        }
      }
    };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sweep); } }).observe(document, { childList: true, subtree: true });
  }
});
// Notebook's own context menu, isolated from Pinterest's styles.
{
  let dismiss = () => {};
  ipcRenderer.on('pin:context', (_event, point) => {
    dismiss();
    const focus = document.activeElement, host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647' });
    host.dataset.notebookMenu = '';
    const root = host.attachShadow({ mode: 'closed' }), style = document.createElement('style');
    style.textContent = ':host{font:14px system-ui;color:#f2f2f2}button{position:absolute;padding:14px 20px;background:#151515;color:inherit;border:1px solid #ffffff20;border-radius:16px;box-shadow:0 18px 50px #0008;font:inherit;cursor:pointer}button:hover{background:#252525}button:focus-visible{outline:2px solid #9d7bff}';
    const button = document.createElement('button'); button.textContent = 'Save to Notebook';
    root.append(style, button); document.documentElement.append(host);
    button.style.left = Math.max(8, Math.min(point.x, innerWidth - button.offsetWidth - 8)) + 'px';
    button.style.top = Math.max(8, Math.min(point.y, innerHeight - button.offsetHeight - 8)) + 'px';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; document.removeEventListener('keydown', key, true);
      host.style.pointerEvents = 'none';
      button.getAnimations().forEach(a => a.cancel());
      const animation = button.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateY(6px) scale(.98)'}],{duration:reduced?0:140,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});
      animation.finished.then(() => host.remove()); if (focus?.isConnected) focus.focus();
    };
    const key = e => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); } };
    button.onclick = () => { ipcRenderer.send('pin:context-save'); close(); };
    host.addEventListener('pointerdown', e => { if (!e.composedPath().includes(button)) close(); });
    document.addEventListener('keydown', key, true); dismiss = close;
    button.animate([{opacity:0,transform:'translateY(6px) scale(.98)'},{opacity:1,transform:'none'}],{duration:reduced?0:200,easing:'cubic-bezier(.2,.8,.2,1)'});
    button.focus();
  });
}
