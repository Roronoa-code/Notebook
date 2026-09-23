// Android emulator only. Seed its Notebook library with a generated test video first.
// Usage: NOTEBOOK_TEST_EMULATOR=emulator-5586 node scripts/test-phone-video.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

(async () => {
  const serial = process.env.NOTEBOOK_TEST_EMULATOR;
  assert.match(serial || '', /^emulator-\d+$/, 'Only an explicitly selected PC emulator may be tested.');
  const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
  const pid = execFileSync(adb, ['-s', serial, 'shell', 'pidof', 'com.mani.notebook'], { encoding: 'utf8' }).trim();
  execFileSync(adb, ['-s', serial, 'forward', 'tcp:9238', `localabstract:webview_devtools_remote_${pid}`]);
  const targets = await (await fetch('http://127.0.0.1:9238/json')).json();
  const target = targets.find((t) => t.url.startsWith('https://appassets.local/'));
  assert.ok(target, 'Notebook WebView is open');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const p = pending.get(message.id);
    if (p) { pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  try {
    const result = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
      (async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async (ready, name) => {
          const deadline = performance.now() + 8000;
          while (!ready()) { if (performance.now() > deadline) throw Error(name + ' timed out'); await wait(50); }
        };
        if (!document.querySelector('#vid')) {
          document.querySelector('.grip')?.click();
          document.querySelector('.card')?.click();
        }
        await wait(700);
        const v = document.querySelector('#vid');
        if (!v) throw Error('The emulator needs a test video as its first item.');
        await until(() => v.readyState >= 2 || v.error, 'Video metadata');
        if (v.error) throw Error(v.error.message);
        v.pause(); v.currentTime = 0;
        const before = { state: v.readyState, error: v.error?.message, duration: v.duration };
        await v.play();
        await until(() => v.currentTime > .5, 'Playback');
        const playing = { time: v.currentTime, paused: v.paused, width: v.videoWidth, error: v.error?.message };
        v.pause();
        v.currentTime = 3;
        await until(() => !v.seeking && Math.abs(v.currentTime - 3) < .2, 'Seek');
        const seek = { time: v.currentTime, seeking: v.seeking, error: v.error?.message };
        await v.play();
        await until(() => v.currentTime > 3.3, 'Resume');
        const resumed = { time: v.currentTime, paused: v.paused };
        v.pause();
        return { before, playing, seek, resumed };
      })()
    ` });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    const data = result.result.value;
    console.log(JSON.stringify(data, null, 2));
    const out = path.resolve(__dirname, '../test-output/phone-video');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'playback.json'), JSON.stringify(data, null, 2));
    const screenshot = await send('Page.captureScreenshot');
    fs.writeFileSync(path.join(out, 'playback.png'), Buffer.from(screenshot.data, 'base64'));
    assert.ok(data.playing.time > .5 && !data.playing.paused && data.playing.width > 0, 'video plays real frames');
    assert.ok(Math.abs(data.seek.time - 3) < .2 && !data.seek.seeking, 'video seeks');
    assert.ok(data.resumed.time > 3.3 && !data.resumed.paused, 'video resumes after seeking');
    console.log('Emulator video playback, seeking and resume passed.');
  } finally {
    ws.close();
    execFileSync(adb, ['-s', serial, 'forward', '--remove', 'tcp:9238']);
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
