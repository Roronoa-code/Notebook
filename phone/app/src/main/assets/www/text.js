// Plain-text and safe note formatting shared by the phone screens.
window.NBText = (() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'P', 'DIV', 'BR']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const walk = (node) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1 || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'IMG'].includes(c.tagName)) { c.remove(); continue; }
        walk(c);
        if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
        for (const a of [...c.attributes]) c.removeAttribute(a.name);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }
  // Tidy up (no AI): the first phrase becomes a heading, the rest bullet points. Same rules as the PC.
  function autoTidy(text) {
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const clean = String(text || '').replace(/([?!.])\1+/g, '$1').replace(/^\s*[-*•]\s*/gm, '');
    const parts = clean.split(/\n|,|;|:\s|\s-\s|\.\s|(?<=\?)\s+|\s+also\s+/i).map((x) => x.trim().replace(/[.,]$/, '')).filter(Boolean);
    if (!parts.length) return null;
    const head = parts[0].length <= 40 ? parts.shift() : 'Note';
    return `<h2>${esc(cap(head))}</h2>` + (parts.length ? `<ul>${parts.map((x) => `<li>${esc(cap(x))}</li>`).join('')}</ul>` : '');
  }
  function noteTitle(html) {
    const d = document.createElement('div');
    d.innerHTML = sanitize(html).replace(/<br>|<\/(p|div|h2|h3|li)>/gi, '$&\n');
    const first = d.textContent.split('\n').map((s) => s.trim()).find(Boolean);
    return first ? first.slice(0, 80) : 'Untitled note';
  }
  return { escape: esc, sanitize, autoTidy, noteTitle };
})();
