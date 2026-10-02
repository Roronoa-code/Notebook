// Text centring audit for the phone screens: for every control that centres its label (buttons, pills, chips, tabs,
// message pills), where the ink of its words really sits against the middle of the control, from the font's own
// glyph measurements (so tracking after the last letter and a font's tall ascender count, as the eye sees them).
// Opens each screen on the mock bridge in headless Edge at the phone's size. Prints anything off by more than 1px.
// Usage: node scripts/audit-phone-centring.js   (exit code 1 when something is off)
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const MEASURE = () => {
  const c = document.createElement('canvas').getContext('2d');
  const out = [];
  const els = [...document.querySelectorAll('button, .statuspill, .chip, .toast .words > span, .toast > span, .sortpill, .kindpill, .fan-item .lbl, .fan-label')];
  for (const el of els) {
    if (!el.getClientRects().length || el.closest('[hidden], .riding, .ghost, .peek')) continue;
    const cs = getComputedStyle(el);
    if (+cs.opacity === 0 || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.bottom < 0 || r.top > innerHeight) continue;
    // the label: the element's own text, or its only text-bearing child (a span inside a button)
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    let host = el;
    if (!texts.length) { const kids = [...el.children].filter((k) => k.textContent.trim() && k.getClientRects().length && k.tagName !== 'SVG'); if (kids.length !== 1 || kids[0].children.length) continue; host = kids[0]; }
    const hs = getComputedStyle(host), text = host.textContent.replace(/\s+/g, ' ').trim();
    if (!text || hs.whiteSpace === 'normal' && host.getClientRects().length > 1) continue;
    // does the control mean to centre it?
    const flexC = /flex/.test(cs.display) && cs.justifyContent === 'center' && cs.alignItems === 'center';
    const centred = flexC || cs.textAlign === 'center' || (/button/i.test(el.tagName) && !/flex|grid/.test(cs.display));
    if (!centred) continue;
    // other things beside the words (an icon) make it a group: centre the whole group instead
    const icon = [...el.children].find((k) => k !== host && /svg|i|canvas|img/i.test(k.tagName) && k.getClientRects().length);
    const range = document.createRange(); range.selectNodeContents(host);
    const rr = range.getBoundingClientRect();
    c.font = `${hs.fontStyle} ${hs.fontWeight} ${hs.fontSize} ${hs.fontFamily}`;
    const shown = hs.textTransform === 'uppercase' ? text.toUpperCase() : text;
    const m = c.measureText(shown), ls = parseFloat(hs.letterSpacing) || 0;
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + ls * (shown.length - 1);
    const lineTop = rr.top + (rr.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2;
    const base = lineTop + m.fontBoundingBoxAscent;
    const ink = { l: rr.left - m.actualBoundingBoxLeft, r: rr.left - m.actualBoundingBoxLeft + inkW, t: base - m.actualBoundingBoxAscent, b: base + m.actualBoundingBoxDescent };
    if (icon) { const ir = icon.getBoundingClientRect(); ink.l = Math.min(ink.l, ir.left); ink.r = Math.max(ink.r, ir.right); }
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight), bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth);
    const boxL = r.left + bl + pl, boxR = r.right - br - pr;
    const dx = (ink.l + ink.r) / 2 - (boxL + boxR) / 2;
    const dy = (ink.t + ink.b) / 2 - (r.top + r.bottom) / 2;
    const id = (el.id ? '#' + el.id : '') + '.' + [...el.classList].join('.') + (el.dataset.a ? `[${el.dataset.a}]` : '');
    // lower-case text: centre on the x-height band rather than ascenders; caps and digits: on the ink
    out.push({ id, text: text.slice(0, 28), dx: +dx.toFixed(1), dy: +dy.toFixed(1), ls: +ls.toFixed(2), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
  await page.evaluate(() => { document.documentElement.style.setProperty('--st', '28px'); document.documentElement.style.setProperty('--sb', '16px'); });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const home = async () => { for (let i = 0; i < 8 && await page.evaluate(() => nbBack()); i++) await page.waitForTimeout(350); await page.waitForTimeout(700); };
  const bad = [];
  const shot = async (name) => {
    const list = await page.evaluate(MEASURE);
    const off = list.filter((x) => Math.abs(x.dx) > 1 || Math.abs(x.dy) > 1);
    for (const x of off) bad.push({ screen: name, ...x });
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
  };
  await shot('home');
  const first = await page.locator('#homegrid > .card').first().boundingBox();
  await touch('touchStart', first.x + 30, first.y + 30); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(700);
  await shot('picking');
  await page.locator('#selpin').click(); await page.waitForTimeout(900);
  await shot('message');
  await page.waitForTimeout(2800);
  await page.locator('#homesort .sortpill').click(); await page.waitForTimeout(600); await shot('sort'); await page.mouse.click(10, 10); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#tab-ideas').click()); await page.waitForTimeout(900); await shot('ideas');
  await page.locator('#homegrid .card.idea').first().click(); await page.waitForTimeout(900); await shot('idea');
  await home();
  await page.evaluate(() => document.querySelector('#tab-recent').click()); await page.waitForTimeout(700);
  await page.locator('.pile.new').click(); await page.waitForTimeout(900); await shot('newboard'); await home();
  const pile = await page.locator('.pile[data-v]').first().boundingBox();
  await touch('touchStart', pile.x + 40, pile.y + 50); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(900);
  await shot('boardoptions'); await home();
  await page.locator('.pile[data-v]').first().click(); await page.waitForTimeout(900); await shot('board'); await home();
  await page.locator('#pulse').click(); await page.waitForTimeout(900); await shot('sync'); await home();
  await page.locator('#searchbtn').click(); await page.waitForTimeout(900); await shot('search'); await home();
  await page.locator('#homegrid > .card[data-a="open"]').first().click(); await page.waitForTimeout(1100); await shot('item'); await home();
  const orb = await page.locator('#orb').boundingBox();
  await touch('touchStart', orb.x + 30, orb.y + 30); await page.waitForTimeout(700); await shot('fan'); await touch('touchEnd'); await page.waitForTimeout(600);
  await browser.close();
  const seen = new Set();
  for (const b of bad) { const k = b.id + b.text; if (seen.has(k)) continue; seen.add(k); console.log(`${b.screen.padEnd(12)} ${b.id.slice(0, 44).padEnd(44)} "${b.text}"  dx ${b.dx}  dy ${b.dy}  (ls ${b.ls}, ${b.w}×${b.h})`); }
  console.log(seen.size ? `${seen.size} labels off centre by more than 1px` : 'Every centred label is within 1px of its middle.');
  process.exitCode = seen.size ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
