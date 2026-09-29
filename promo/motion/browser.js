// A headless browser for the capture and render scripts: Microsoft Edge on Windows (as the other checks use),
// otherwise Playwright's Chromium (PLAYWRIGHT_BROWSERS_PATH) or NOTEBOOK_PROMO_BROWSER.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

function chromiumPath() {
  if (process.env.NOTEBOOK_PROMO_BROWSER) return process.env.NOTEBOOK_PROMO_BROWSER;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) return null;
  const dir = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = dir && path.join(root, dir, 'chrome-linux', 'chrome');
  return exe && fs.existsSync(exe) ? exe : null;
}

function launch(extraArgs = []) {
  const args = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...extraArgs];
  if (process.platform === 'win32' && !process.env.NOTEBOOK_PROMO_BROWSER) return chromium.launch({ channel: 'msedge', headless: true, args });
  return chromium.launch({ executablePath: chromiumPath() || undefined, headless: true, args });
}

module.exports = { launch };
