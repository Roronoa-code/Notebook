// New custom-dialog/picker/motion flows only. All data is temporary; no OS input automation.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), { EventEmitter } = require('events');
const { _electron: electron } = require('playwright-core');
const { Library } = require('../main/library');
const APP = path.resolve(__dirname, '..'), OUT = path.join(APP, 'test-output', 'interface-motion-' + process.pid);
async function bridgeChecks(files) {
  const handlers = {}, owner = new EventEmitter(), sent = [];
  owner.isDestroyed = () => false; owner.send = (_channel, request) => sent.push(request);
  const ui = require('../main/ui')({ ipcMain: { handle: (channel, fn) => handlers[channel] = fn }, app: { getPath: () => files }, getWin: () => ({ webContents: owner, contentView: { children: [] }, isDestroyed: () => false }) });
  const call = (channel, ...args) => handlers['ui:' + channel]({ sender: owner }, ...args);
  const first = ui.pick({ folder: true, defaultPath: files }); await new Promise(setImmediate);
  const id = sent.at(-1).id;
  assert.ok((await call('browse', 'wrong', files)).error);
  assert.ok((await handlers['ui:browse']({ sender: {} }, id, files)).error);
  for (const name of ['../escape', 'CON', 'folder.', 'a/b']) assert.ok((await call('mkdir', id, files, name)).error);
  assert.ok((await call('reply', id, [path.join(files, 'sample.png')])).error);
  await call('reply', id, null); assert.equal((await first).canceled, true);
  const second = ui.pick({ folder: false, extensions: ['png'], defaultPath: files }); await new Promise(setImmediate);
  assert.ok((await call('reply', sent.at(-1).id, [path.join(files, 'hidden.txt')])).error);
  const stale = ui.confirm('Queued during reload', '', 'Delete');
  owner.emit('did-start-navigation'); assert.equal((await second).canceled, true); assert.equal(await stale, false);
  const confirm = ui.confirm('Delete?', 'Test', 'Delete'), queued = ui.confirm('Again?', 'Test', 'Delete');
  await new Promise(setImmediate); const before = sent.length;
  await call('reply', sent.at(-1).id, false); assert.equal(await confirm, false);
  await new Promise(setImmediate); assert.equal(sent.length, before + 1);
  await call('reply', sent.at(-1).id, true); assert.equal(await queued, true);
  console.log('PASS request ownership, validation, cancellation, reload and queue');
}
(async () => {
  if (process.env.NOTEBOOK_EXE) {
    const asar = require('@electron/asar'), archive = path.join(path.dirname(process.env.NOTEBOOK_EXE), 'resources', 'app.asar');
    for (const dir of ['main', 'renderer']) for (const name of fs.readdirSync(path.join(APP, dir), { recursive: true })) {
      const relative = path.join(dir, name), source = path.join(APP, relative);
      if (fs.statSync(source).isFile()) assert.deepEqual(asar.extractFile(archive, relative), fs.readFileSync(source), 'Packaged file differs: ' + relative);
    }
    console.log('PASS every packaged main/renderer file matches source');
  }
  const files = path.join(OUT, 'files'), libraryPath = path.join(OUT, 'library'), userData = path.join(OUT, 'userdata');
  fs.mkdirSync(files, { recursive: true }); fs.mkdirSync(userData, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(files, 'sample.png'), png); fs.writeFileSync(path.join(files, 'second.png'), png); fs.writeFileSync(path.join(files, 'hidden.txt'), 'Not a photo');
  await bridgeChecks(files);
  const lib = await Library.openOrCreate(libraryPath), board = await lib.addBoard('Motion board'), note = await lib.addNote(board);
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ libraryPath, lastImportDir: files }));
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env: { ...process.env, NOTEBOOK_USER_DATA: userData, NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47869', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_FAKE_NAMES: '1', NOTEBOOK_FAKE_FEED: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' } });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(12000);
    await page.waitForFunction(() => window.NB?.motion && NB.S?.snap);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = dialog.showMessageBox = () => { throw new Error('Native dialog invoked'); }; });
    const closed = () => page.waitForFunction(() => !NB.modalOpen() && !NB.S.busy);
    await page.locator(`.bcard[data-id="${board}"]`).click();
    await page.getByRole('button', { name: 'Delete board', exact: true }).click();
    await page.locator('dialog').waitFor();
    assert.match(await page.locator('dialog').innerText(), /Every item/);
    await page.evaluate(() => document.getAnimations().forEach(a => { if (Number.isFinite(a.effect.getTiming().iterations)) a.finish(); }));
    await page.screenshot({ path: path.join(OUT, 'confirmation.png') });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
    await page.keyboard.press('Escape'); await closed();
    assert.equal(await page.evaluate(id => NB.S.snap.boards.some(b => b.id === id), board), true);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Delete board');
    assert.equal(await page.locator('.toast').filter({ hasText: 'Deleted the board' }).count(), 0);
    await page.getByRole('button', { name: 'Rename board', exact: true }).click();
    await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Renamed board');
    assert.equal(await page.locator('#context .ctx-actions').isVisible(), true);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => !NB.S.renaming && !NB.S.busy);
    assert.equal(await page.locator('#context h2').textContent(), 'Renamed board');
    await page.getByRole('button', { name: 'Rename board', exact: true }).click();
    await page.getByRole('textbox', { name: 'Board name', exact: true }).fill('Do not save');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !NB.S.renaming);
    assert.equal(await page.locator('#context h2').textContent(), 'Renamed board');
    await page.locator('#board-phone').evaluate(el => window.originalSwitch = el);
    await page.locator('#board-phone').click(); await page.waitForFunction(() => !document.querySelector('#board-phone').disabled);
    assert.equal(await page.evaluate(() => originalSwitch === document.querySelector('#board-phone')), true);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('board:onPhone'); ipcMain.handle('board:onPhone', () => ({ error: 'Test toggle failure' })); });
    await page.locator('#board-phone').click(); await page.waitForFunction(() => !document.querySelector('#board-phone').disabled);
    assert.equal(await page.locator('#board-phone').isChecked(), false);
    console.log('PASS confirmation cancellation, stable rename and switch rollback');
    // Picker: filtering, two selected files, originals intact, invalid path and cancellation.
    await page.locator('#add-photos').click(); await page.locator('.picker-entry').first().waitFor();
    assert.equal(await page.locator('.picker-entry').filter({ hasText: 'hidden.txt' }).count(), 0);
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(path.join(files, 'missing'));
    await page.getByRole('button', { name: 'Go', exact: true }).click(); await page.locator('.dialog-error:not([hidden])').waitFor();
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(files);
    await page.getByRole('button', { name: 'Go', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.dialog-error').hidden);
    await page.getByRole('button', { name: 'sample.png', exact: true }).click(); await page.getByRole('button', { name: 'second.png', exact: true }).click();
    await page.evaluate(() => document.getAnimations().forEach(a => { if (Number.isFinite(a.effect.getTiming().iterations)) a.finish(); }));
    await page.screenshot({ path: path.join(OUT, 'file-picker.png') });
    await page.locator('dialog .dialog-actions .primary').click(); await closed();
    assert.deepEqual(fs.readFileSync(path.join(files, 'sample.png')), png);
    assert.equal(await page.evaluate(() => NB.S.snap.items.filter(i => i.kind === 'photo').length), 1);
    // Export picker includes folder creation, and Escape leaves no exported files.
    await page.evaluate(() => { window.pendingExport = nb.exportAll(); });
    await page.locator('dialog').waitFor();
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(files); await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.waitForFunction(p => document.querySelector('.picker-address').value === p && !document.querySelector('.picker-files').hasAttribute('aria-busy'), files);
    await page.getByRole('button', { name: 'New folder', exact: true }).click(); await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('Chosen folder');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.picker-address').value.endsWith('Chosen folder'));
    await page.keyboard.press('Escape'); await closed(); assert.equal((await page.evaluate(() => pendingExport)).cancelled, true);
    assert.deepEqual(fs.readdirSync(path.join(files, 'Chosen folder')), []);
    console.log('PASS real file import, filtering, invalid paths, folder creation and cancellation');
    // Both stages of Restore share the picker queue; cancelling stage two keeps the current library.
    await page.evaluate(() => { window.backupResult = nb.backup(); }); await page.locator('dialog').waitFor();
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(files); await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog .primary').disabled);
    await page.locator('dialog .primary').click(); await closed(); const backup = await page.evaluate(() => backupResult);
    assert.ok(!backup.error, JSON.stringify(backup));
    await page.evaluate(() => { window.restoreResult = nb.restoreBackup(); }); await page.locator('dialog').waitFor();
    await page.getByRole('textbox', { name: 'Folder path', exact: true }).fill(backup.dir); await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog .primary').disabled);
    await page.locator('dialog .primary').click();
    await page.waitForFunction(() => document.querySelector('dialog h2')?.textContent.includes('put the restored'));
    assert.equal(await page.locator('dialog').count(), 1);
    await page.keyboard.press('Escape'); await closed(); assert.equal((await page.evaluate(() => restoreResult)).cancelled, true);
    assert.equal((await page.evaluate(() => nb.state())).snap.root, libraryPath);

    await page.getByRole('button', { name: 'Sort', exact: true }).click();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(180);
    assert.equal(await page.locator('.ddlist').count(), 0);
    await page.evaluate(() => { NB.S.snap.types = ['outfit']; NB.S.snap.items[0].ai = { type: { main: 'outfit' } }; NB.refreshGrid(); });
    await page.getByRole('button', { name: 'Styles', exact: true }).click(); await page.locator('.stylepop').waitFor();
    await page.keyboard.press('Escape'); await page.waitForTimeout(180); assert.equal(await page.locator('.stylepop').count(), 0);
    await page.evaluate(() => NB.stacks.pickAll()); await page.waitForFunction(() => NB.motion.isOpen(document.getElementById('selbar')));
    await page.getByRole('button', { name: 'Add to board', exact: true }).click(); await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape'); await page.waitForTimeout(180); assert.equal(await page.getByRole('menu').count(), 0);
    await page.evaluate(() => { NB.stacks.clear(); NB.stacks.pickAll(); }); await page.waitForTimeout(250);
    assert.equal(await page.locator('#selbar').evaluate(el => !el.hidden && !el.inert), true);
    await page.evaluate(() => NB.stacks.clear());
    // Saved/Ideas retains the same segmented control so its indicator can slide.
    await page.locator('.seg').evaluate(el => window.savedTabs = el);
    await page.getByRole('button', { name: 'Ideas', exact: true }).click();
    assert.equal(await page.evaluate(() => savedTabs === document.querySelector('.seg')), true);
    await page.getByRole('button', { name: 'Saved', exact: true }).click();
    // Shared surfaces reopen cleanly before their closing animation finishes.
    for (const [button, surface] of [['#lib-btn', '#lib-pop'], ['#links-btn', '.linkspop']]) {
      await page.evaluate(([button]) => { const b = document.querySelector(button); b.click(); }, [button]);
      await page.waitForFunction(s => NB.motion.isOpen(NB.motion.find(s)), surface);
      await page.evaluate(button => { const b = document.querySelector(button); b.click(); b.click(); }, button);
      await page.waitForTimeout(280);
      assert.equal(await page.locator(surface).count(), 1); assert.equal(await page.locator(surface).evaluate(el => !el.hidden && !el.inert), true);
      await page.keyboard.press('Escape');
    }
    await page.locator('#phone').click(); await page.locator('#phone-close').waitFor();
    await page.evaluate(() => { window.pendingPick = nb.pickFiles('photos'); }); await page.locator('dialog').waitFor();
    await page.keyboard.press('Escape'); await closed(); assert.equal(await page.evaluate(() => NB.phone.isOpen()), true);
    await page.evaluate(() => { NB.phone.close(); NB.phone.open(); }); await page.waitForTimeout(350);
    assert.equal(await page.locator('.phone').count(), 1); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.evaluate(() => NB.shortcuts()); await page.locator('.keys').waitFor(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    assert.equal(await page.locator('.keys').count(), 0);
    const continuity = await page.evaluate(async () => {
      const el = document.getElementById('lib-pop'); NB.motion.show(el); await new Promise(r => setTimeout(r, 65));
      const before = getComputedStyle(el).opacity; NB.motion.hide(el); const after = getComputedStyle(el).opacity;
      NB.motion.show(el); await new Promise(r => setTimeout(r, 230));
      return { jump: Math.abs(before-after), open: !el.hidden && !el.inert };
    });
    assert.ok(continuity.jump < .03); assert.equal(continuity.open, true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(async () => { const el = document.getElementById('lib-pop'); await NB.motion.hide(el); return el.hidden; }), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('PASS rapid reversal, reduced motion, nested dialog Escape and panel cleanup');
    await page.evaluate(id => NB.viewer.open(id), note); await page.locator('.viewer').waitFor();
    await page.evaluate(id => { NB.viewer.close(); NB.viewer.open(id); }, note); await page.waitForTimeout(300);
    assert.equal(await page.locator('.viewer').count(), 1); assert.equal(await page.locator('.viewer').evaluate(el => !el.inert), true);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !NB.viewer.isOpen());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('ui:tray'));
    await page.waitForFunction(() => NB.motion.isOpen(document.querySelector('#lib-pop'))); await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
    await page.locator('#add-photos').click(); await page.locator('dialog').waitFor();
    assert.equal(await page.locator('dialog').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth), true);
    await page.keyboard.press('Escape'); await closed();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    // The remote panel receives a local stand-in document: this test never requests Pinterest.
    await app.evaluate(({ session }) => session.fromPartition('persist:pinterest').protocol.handle('https', () => new Response('<html><body><a href="https://www.pinterest.com/pin/123/">A test pin</a></body></html>', { headers: { 'content-type': 'text/html' } })));
    await page.locator('#pin-btn').click();
    await page.waitForTimeout(450);
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL().includes('pinterest.com'));
      if (!wc) throw new Error('Pinterest stand-in did not open');
      wc.emit('context-menu', {}, { linkURL: 'https://www.pinterest.com/pin/123/', x: 60, y: 60 });
      await new Promise(r => setTimeout(r, 230));
      if (!await wc.executeJavaScript('!!document.querySelector("[data-notebook-menu]")')) throw new Error('Custom pin menu missing');
      await wc.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      await new Promise(r => setTimeout(r, 200));
      if (await wc.executeJavaScript('!!document.querySelector("[data-notebook-menu]")')) throw new Error('Custom pin menu did not close');
    });
    await page.evaluate(() => NB.links.closePanel());
    console.log('PASS viewer reversal, tray surface, narrow layout and offline Pinterest context menu');

    await page.getByRole('button', { name: 'Delete board', exact: true }).click(); await page.locator('dialog .confirm-accept').click(); await closed();
    assert.equal(await page.evaluate(id => NB.S.snap.boards.some(b => b.id === id), board), false);
    assert.equal(await page.evaluate(id => NB.S.snap.items.some(i => i.id === id && !i.deletedAt), note), true);
    await page.evaluate(async id => NB.apply(await nb.moveToBin(id)), note);
    await page.locator('#bin-btn').click(); await page.getByRole('button', { name: 'Empty Bin', exact: true }).click();
    await page.locator('dialog').waitFor(); await page.keyboard.press('Escape'); await closed();
    assert.equal(await page.evaluate(id => NB.S.snap.items.some(i => i.id === id), note), true);
    await page.getByRole('button', { name: 'Empty Bin', exact: true }).click(); await page.locator('dialog .confirm-accept').click(); await closed();
    assert.equal(await page.evaluate(id => NB.S.snap.items.some(i => i.id === id), note), false);
    assert.deepEqual(errors, []);
    console.log('PASS confirmed deletion keeps items; no page errors. Evidence: ' + OUT);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
