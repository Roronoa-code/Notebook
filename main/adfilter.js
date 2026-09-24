// Takes promoted (sponsored) pins out of what Pinterest sends to the Pinterest panel, before the page
// sees it, so ads are never drawn and leave no gaps. It works on the network answers themselves
// (Chrome's own request interception, for the page and any background workers it starts), so it
// catches every route Pinterest uses. Only Pinterest's data answers are touched; nothing is sent anywhere.

const isAd = (o) => o.is_promoted === true || o.is_downstream_promotion === true || o.promoted_is_removable === true ||
  (o.promoter != null && typeof o.promoter === 'object') || (o.recommendation_reason != null && o.recommendation_reason.reason === 'PROMOTED_PIN');
const obj = (x) => x !== null && typeof x === 'object';

// A promoted pin can sit in a list, in a table keyed by its id, or wrapped in a small feed item, and
// lists can also refer to it by id. First find every promoted pin's id, then take it out everywhere.
function find(v, ids, depth = 0) {
  if (depth > 60 || !obj(v)) return;
  if (!Array.isArray(v) && isAd(v) && v.id != null) ids.add(String(v.id));
  for (const x of Array.isArray(v) ? v : Object.values(v)) find(x, ids, depth + 1);
}
const wrapsAd = (x) => Object.keys(x).length <= 4 && Object.values(x).some((c) => obj(c) && !Array.isArray(c) && isAd(c));
const gone = (x, ids) => (obj(x) ? isAd(x) || (x.id != null && ids.has(String(x.id))) || wrapsAd(x) : typeof x === 'string' && ids.has(x));
function drop(v, ids, count, depth = 0) {
  if (depth > 60 || !obj(v)) return v;
  if (Array.isArray(v)) {
    const kept = v.filter((x) => !gone(x, ids));
    count.n += v.length - kept.length;
    return kept.map((x) => drop(x, ids, count, depth + 1));
  }
  for (const k of Object.keys(v)) {
    if ((ids.has(k) && obj(v[k])) || (obj(v[k]) && !Array.isArray(v[k]) && isAd(v[k]))) { delete v[k]; count.n++; }
    else v[k] = drop(v[k], ids, count, depth + 1);
  }
  return v;
}

// Pinterest's answer as text in, the same answer without promoted pins out (unchanged if it isn't JSON).
function filterText(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { text, removed: 0 }; }
  const ids = new Set();
  find(data, ids);
  if (!ids.size) return { text, removed: 0 };
  const count = { n: 0 };
  return { text: JSON.stringify(drop(data, ids, count)), removed: count.n };
}

// The page itself arrives with its first pins as data inside it (<script type="application/json">
// blocks). A promoted pin can be marked in one block and copied plainly into another, so the ads are
// found across all the blocks first, then taken out of each. (Written back with "<" escaped, so no
// text inside can end the block.)
const BLOCK = /(<script\b[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/gi;
function filterHtml(html) {
  const blocks = [];
  for (const m of html.matchAll(BLOCK)) { try { blocks.push({ body: m[2], data: JSON.parse(m[2]) }); } catch { /* not data */ } }
  const ids = new Set();
  for (const b of blocks) find(b.data, ids);
  if (!ids.size) return { text: html, removed: 0 };
  const count = { n: 0 }, cleaned = new Map();
  for (const b of blocks) {
    const before = count.n;
    drop(b.data, ids, count);
    if (count.n > before) cleaned.set(b.body, JSON.stringify(b.data).replace(/</g, '\\u003c'));
  }
  const text = html.replace(BLOCK, (all, open, body, close) => (cleaned.has(body) ? open + cleaned.get(body) + close : all));
  return { text, removed: count.n };
}

// The routes Pinterest loads pins from, and its pages.
const PATTERNS = [
  ...['*://*pinterest.*/resource/*', '*://*pinterest.*/_graphql/*'].map((urlPattern) => ({ urlPattern, requestStage: 'Response' })),
  { urlPattern: '*://*pinterest.*/*', resourceType: 'Document', requestStage: 'Response' }
];
const DROP_HEADERS = /^(content-length|content-encoding|transfer-encoding)$/i;

// Filters every Pinterest data answer the panel (and any worker it starts) receives. Returns a count
// of removed pins for checks. If the browser's interception isn't available, the panel still works.
function attachAdFilter(wc) {
  const stats = { removed: 0, answers: 0 };
  const dbg = wc.debugger;
  try { dbg.attach('1.3'); } catch { return stats; }
  // The page itself is reported with an empty session name, which must not be passed back.
  const send = (method, params = {}, session) => (session ? dbg.sendCommand(method, params, session) : dbg.sendCommand(method, params));
  const start = (session) => Promise.all([
    send('Fetch.enable', { patterns: PATTERNS }, session),
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, session)
  ]).catch(() => {});
  dbg.on('message', async (_e, method, params, session) => {
    if (method === 'Target.attachedToTarget') {
      await start(params.sessionId);
      send('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {});
      return;
    }
    if (method !== 'Fetch.requestPaused') return;
    const { requestId, responseStatusCode: status, responseHeaders = [] } = params;
    const type = (responseHeaders.find((h) => /^content-type$/i.test(h.name)) || {}).value || '';
    const json = /json/i.test(type), html = /text\/html/i.test(type);
    try {
      if (!status || status !== 200 || !(json || html)) { await send('Fetch.continueRequest', { requestId }, session); return; }
      const res = await send('Fetch.getResponseBody', { requestId }, session);
      const raw = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
      const out = html ? filterHtml(raw) : filterText(raw);
      stats.answers++; stats.removed += out.removed;
      if (!out.removed) { await send('Fetch.continueRequest', { requestId }, session); return; }
      await send('Fetch.fulfillRequest', {
        requestId, responseCode: status,
        responseHeaders: responseHeaders.filter((h) => !DROP_HEADERS.test(h.name)),
        body: Buffer.from(out.text, 'utf8').toString('base64')
      }, session);
    } catch {
      send('Fetch.continueRequest', { requestId }, session).catch(() => {}); // never leave a request hanging
    }
  });
  start(undefined);
  return stats;
}

module.exports = { filterText, filterHtml, attachAdFilter, isAd };
