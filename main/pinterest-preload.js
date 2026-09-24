// Runs in the Pinterest panel. Promoted pins are taken out of Pinterest's answers before they arrive
// (main/adfilter.js); this is the fallback: any pin still labelled as sponsored is hidden.
// It only hides things on the page; nothing is sent anywhere.
const { contextBridge } = require('electron');

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
