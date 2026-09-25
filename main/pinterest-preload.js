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
