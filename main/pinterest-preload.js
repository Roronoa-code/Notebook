// Runs in the Pinterest panel before Pinterest's own code. It takes promoted (sponsored) pins out of
// what Pinterest loads, so they're never drawn and leave no gaps, and hides any that still slip through.
// It only filters what arrives; nothing is sent anywhere and nothing else on the page is changed.
const { contextBridge } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const isAd = (o) => o.is_promoted === true || o.is_downstream_promotion === true || o.promoted_is_removable === true ||
      (o.promoter != null && typeof o.promoter === 'object') || (o.recommendation_reason && o.recommendation_reason.reason === 'PROMOTED_PIN');
    const obj = (x) => x && typeof x === 'object';
    // A promoted pin can sit in a list, in a table keyed by its id, or wrapped in a feed item, and lists
    // can also refer to it by id. First find every promoted pin's id, then take it out everywhere.
    const find = (v, ids, depth = 0) => {
      if (depth > 40 || !obj(v)) return;
      if (!Array.isArray(v) && isAd(v) && v.id != null) ids.add(String(v.id));
      for (const x of Array.isArray(v) ? v : Object.values(v)) find(x, ids, depth + 1);
    };
    const gone = (x, ids) => (obj(x) ? (isAd(x) || (x.id != null && ids.has(String(x.id))) || Object.values(x).some((c) => obj(c) && !Array.isArray(c) && isAd(c) && Object.keys(x).length <= 4)) : typeof x === 'string' && ids.has(x));
    const drop = (v, ids, depth = 0) => {
      if (depth > 40 || !obj(v)) return v;
      if (Array.isArray(v)) {
        const kept = v.filter((x) => !gone(x, ids));
        window.__nbAdsRemoved = (window.__nbAdsRemoved || 0) + (v.length - kept.length);
        return kept.map((x) => drop(x, ids, depth + 1));
      }
      for (const k of Object.keys(v)) {
        if (ids.has(k) && obj(v[k]) || obj(v[k]) && !Array.isArray(v[k]) && isAd(v[k])) { delete v[k]; window.__nbAdsRemoved = (window.__nbAdsRemoved || 0) + 1; }
        else v[k] = drop(v[k], ids, depth + 1);
      }
      return v;
    };
    const clean = (v) => { const ids = new Set(); find(v, ids); return ids.size ? drop(v, ids) : v; };
    const ours = (url) => /\/resource\/|\/_graphql\/|\/graphql\//.test(String(url));
    const cleanText = (t) => { try { return JSON.stringify(clean(JSON.parse(t))); } catch { return t; } };

    // Pinterest's own requests (XMLHttpRequest): hand back the filtered answer.
    const X = XMLHttpRequest.prototype, open = X.open;
    const text = Object.getOwnPropertyDescriptor(X, 'responseText'), resp = Object.getOwnPropertyDescriptor(X, 'response');
    X.open = function (method, url) { this.__nbUrl = url; this.__nbText = undefined; return open.apply(this, arguments); };
    const filtered = (xhr) => {
      if (xhr.readyState !== 4 || !ours(xhr.__nbUrl)) return null;
      if (xhr.__nbText === undefined) xhr.__nbText = cleanText(text.get.call(xhr));
      return xhr.__nbText;
    };
    Object.defineProperty(X, 'responseText', { configurable: true, get() { const f = filtered(this); return f ?? text.get.call(this); } });
    Object.defineProperty(X, 'response', { configurable: true, get() {
      if (this.responseType === '' || this.responseType === 'text') { const f = filtered(this); if (f != null) return f; }
      if (this.responseType === 'json' && this.readyState === 4 && ours(this.__nbUrl)) { const r = resp.get.call(this); return r && clean(r); }
      return resp.get.call(this);
    } });

    // Requests made with fetch.
    const fetch0 = window.fetch;
    window.fetch = async function (input, init) {
      const res = await fetch0.apply(this, arguments);
      const url = typeof input === 'string' ? input : input && input.url;
      if (!ours(url) || !/json/.test(res.headers.get('content-type') || '')) return res;
      const body = cleanText(await res.clone().text());
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    };

    // The pins that come with the page itself.
    new MutationObserver((changes) => {
      for (const c of changes) for (const n of c.addedNodes) {
        if (n.nodeName === 'SCRIPT' && /^__PWS_/.test(n.id || '') && n.type === 'application/json') n.textContent = cleanText(n.textContent);
      }
    }).observe(document, { childList: true, subtree: true });

    // Anything marked as promoted that still gets drawn is hidden.
    const style = () => {
      const s = document.createElement('style');
      s.textContent = `[data-grid-item="true"]:has([data-test-id*="promoted" i], [data-test-id*="sponsor" i], [aria-label^="Promoted" i], [aria-label^="Sponsored" i]) { display: none !important; }`;
      document.documentElement.append(s);
    };
    if (document.documentElement) style(); else document.addEventListener('DOMContentLoaded', style);
    // …and so is any pin whose label underneath says it's sponsored.
    const LABEL = /^\s*(Sponsored|Promoted|Promoted by|Ad)\s*$/i;
    let queued = false;
    const sweep = () => {
      queued = false;
      for (const f of document.querySelectorAll('[data-test-id="pinrep-footer"]')) {
        const item = f.closest('[data-grid-item="true"]');
        if (!item || item.dataset.nbAd) continue;
        const w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) if (LABEL.test(n.nodeValue)) { item.dataset.nbAd = '1'; item.style.setProperty('display', 'none', 'important'); window.__nbAdsHidden = (window.__nbAdsHidden || 0) + 1; break; }
      }
    };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sweep); } }).observe(document, { childList: true, subtree: true });
  }
});
