// Small shared helpers for the page.
window.NB = window.NB || {};

// h('div', { class: 'x', onclick: fn }, child, 'text') builds an element.
NB.h = function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
};

NB.icon = function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
};

// Notes may only contain simple formatting. Anything else is stripped to plain text.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'H2', 'H3', 'P', 'DIV', 'BR']);
NB.sanitize = function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) { child.remove(); continue; }
      walk(child);
      if (!ALLOWED.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
};

NB.escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tidy up (no AI): the first phrase becomes a heading, the rest become bullet points.
NB.autoTidy = function autoTidy(text) {
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const clean = String(text || '').replace(/([?!.])\1+/g, '$1').replace(/^\s*[-*•]\s*/gm, '');
  const parts = clean.split(/\n|,|;|:\s|\s-\s|\.\s|(?<=\?)\s+|\s+also\s+/i).map((x) => x.trim().replace(/[.,]$/, '')).filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0].length <= 40 ? parts.shift() : 'Note';
  const list = parts.map((x) => `<li>${NB.escape(cap(x))}</li>`).join('');
  return `<h2>${NB.escape(cap(head))}</h2>` + (list ? `<ul>${list}</ul>` : '');
};

// The first line of a note becomes its title.
NB.noteTitle = function noteTitle(html) {
  // Mark where each line/block ends first: a detached element has no layout, so innerText can't see line breaks.
  const div = document.createElement('div');
  div.innerHTML = NB.sanitize(html).replace(/<br>|<\/(p|div|h2|h3|li)>/gi, '$&\n');
  const first = div.textContent.split('\n').map((s) => s.trim()).find(Boolean);
  return first ? first.slice(0, 80) : 'Untitled note';
};

NB.duration = (s) => {
  if (!Number.isFinite(s)) return '';
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

NB.bytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1e3)) + ' KB');

NB.date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Messages at the bottom of the screen, with an optional button such as Undo.
NB.toast = function toast(message, opts = {}) {
  const box = document.getElementById('toasts');
  const el = NB.h('div', { class: 'toast' + (opts.error ? ' error' : '') }, NB.h('span', null, message));
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  if (opts.action) el.append(NB.h('button', { type: 'button', onclick: () => { close(); opts.action.run(); } }, opts.action.label));
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(close, opts.error ? 9000 : opts.action ? 6000 : 3800);
};

// A dropdown in the app's own look (instead of Windows' menu). options: [{ value, label }].
// Keyboard: Enter/Space/arrows open it, arrows move, Enter picks, Esc closes.
NB.dropdown = function dropdown({ label, value, options, onChange }) {
  const { h, icon } = NB;
  const current = () => options.find((o) => o.value === value) || options[0];
  const btn = h('button', { type: 'button', class: 'dd', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label }, h('span', null, current().label), icon('right'));
  let list = null, at = 0;
  const close = () => {
    if (!list) return;
    const l = list; list = null;
    btn.setAttribute('aria-expanded', 'false');
    l.classList.add('out');
    setTimeout(() => l.remove(), 180);
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e) => { if (list && !list.contains(e.target) && !btn.contains(e.target)) close(); };
  const mark = () => [...list.children].forEach((o, i) => o.classList.toggle('at', i === at));
  const pick = (o) => { close(); btn.focus(); if (o.value === value) return; value = o.value; btn.firstChild.textContent = o.label; onChange(o.value); };
  const open = () => {
    at = Math.max(0, options.indexOf(current()));
    list = h('div', { class: 'ddlist', role: 'listbox', 'aria-label': label },
      options.map((o, i) => h('div', { role: 'option', class: 'ddopt', 'aria-selected': String(o.value === value), onpointerenter: () => { at = i; mark(); }, onclick: () => pick(o) }, o.label, o.value === value ? icon('check') : null)));
    const r = btn.getBoundingClientRect();
    const below = innerHeight - r.bottom > Math.min(320, options.length * 36 + 16);
    Object.assign(list.style, { left: r.left + 'px', minWidth: r.width + 'px', [below ? 'top' : 'bottom']: (below ? r.bottom + 6 : innerHeight - r.top + 6) + 'px' });
    list.classList.add(below ? 'down' : 'up');
    document.body.append(list);
    btn.setAttribute('aria-expanded', 'true');
    mark();
    document.addEventListener('pointerdown', outside, true);
  };
  btn.addEventListener('click', () => (list ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (!list) { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; mark(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[at]); }
    else if (e.key === 'Tab') close();
  });
  return btn;
};
