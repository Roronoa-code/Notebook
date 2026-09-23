// Runs in the Pinterest panel before Pinterest's own code. It takes promoted (sponsored) pins out of
// what Pinterest loads, so they're never drawn and leave no gaps, and hides any that still slip through.
// It only filters what arrives; nothing is sent anywhere and nothing else on the page is changed.
const { contextBridge } = require('electron');

contextBridge.executeInMainWorld({
  func: () => {
    const isAd = (o) => o.is_promoted === true || o.is_downstream_promotion === true || o.promoted_is_removable === true ||
      (o.promoter != null && typeof o.promoter === 'object');
    // Removes promoted pins from any list inside Pinterest's data.
    const clean = (v, depth = 0) => {
      if (depth > 40 || !v || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.filter((x) => { const ad = !!(x && typeof x === 'object' && isAd(x)); if (ad) window.__nbAdsRemoved = (window.__nbAdsRemoved || 0) + 1; return !ad; }).map((x) => clean(x, depth + 1));
      for (const k of Object.keys(v)) v[k] = clean(v[k], depth + 1);
      return v;
    };
    const ours = (url) => /\/resource\/|\/_ngjs\/resource\//.test(String(url));
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
  }
});
