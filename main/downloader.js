// Saving from links (build plan B1). Kept on its own so a fix after TikTok or Pinterest change their
// sites only touches this file. It runs two free tools from the tools folder (D:\Notebook Tools\bin):
// yt-dlp (TikTok videos) and gallery-dl (TikTok photo slideshows, Pinterest pins). Nothing here updates
// by itself: update() runs only when the user presses "Update downloader".
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

class LinkError extends Error { constructor(msg) { super(msg); this.friendly = msg; } }

const MEDIA = /\.(jpe?g|png|webp|gif|mp4|m4v|mov|webm)$/i;

// Plain words for what went wrong, from the tools' own messages.
function explain(text) {
  const t = String(text || '');
  if (/private|not available in your country|geo.?restrict/i.test(t)) return "This post is private or not available here, so it can't be saved.";
  if (/log ?in|sign ?in|authoriz|cookies|401|403/i.test(t)) return 'This post needs a signed-in account to see it. It’s in your retry list.';
  if (/404|not found|could not be found|removed|deleted|does not exist|no longer available|post not available|no results/i.test(t)) return 'This post has been removed or the link is wrong.';
  if (/ip address is blocked|rate.?limit|too many requests|429/i.test(t)) return 'The site is refusing downloads from this connection for now. Try again later from the retry list.';
  if (/getaddrinfo|timed out|timeout|connection|network|ssl|resolve/i.test(t)) return 'Couldn’t reach the site. Check the internet connection and try again from the retry list.';
  if (/unsupported url|no suitable extractor/i.test(t)) return 'That doesn’t look like a TikTok or Pinterest post link.';
  return 'The downloader couldn’t save this one. Sites change often: try "Update downloader", then retry it from the list.';
}

class Downloader {
  constructor({ binDir, tmpDir, ffmpegDir = null, log = console }) {
    Object.assign(this, { binDir, tmpDir, ffmpegDir, log });
  }

  tool(name) { return path.join(this.binDir, name + '.exe'); }
  ready() { return fs.existsSync(this.tool('yt-dlp')) && fs.existsSync(this.tool('gallery-dl')); }

  run(name, args, timeoutMs = 180000) {
    return new Promise((resolve) => {
      execFile(this.tool(name), args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr) + (err && err.killed ? '\ntimed out' : '') });
      });
    });
  }

  // Which site a link is from ('tiktok', 'pinterest'), or null.
  static site(url) {
    let u;
    try { u = new URL(String(url).trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/(^|\.)tiktok\.com$/i.test(u.hostname)) return 'tiktok';
    if (/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname) || /^pin\.it$/i.test(u.hostname)) return 'pinterest';
    return null;
  }

  // Downloads one post into a fresh temporary folder. Resolves to { files, title }; throws LinkError in plain words.
  async fetch(url) {
    const site = Downloader.site(url);
    if (!site) throw new LinkError('That doesn’t look like a TikTok or Pinterest post link.');
    if (!this.ready()) throw new LinkError('The downloader tools aren’t set up on this PC yet (see the guide).');
    const dir = path.join(this.tmpDir, crypto.randomUUID());
    await fsp.mkdir(dir, { recursive: true });
    const ff = this.ffmpegDir ? ['--ffmpeg-location', this.ffmpegDir] : [];
    const attempts = site === 'tiktok' && !/\/photo\//.test(url)
      ? [['yt-dlp', ['--no-playlist', '--no-progress', '-f', 'b', ...ff, '-o', path.join(dir, '%(id)s.%(ext)s'), '--write-info-json', url]], ['gallery-dl', ['-D', dir, '--write-metadata', url]]]
      : [['gallery-dl', ['-D', dir, '--write-metadata', url]], ...(site === 'tiktok' ? [] : [['yt-dlp', ['--no-playlist', '--no-progress', ...ff, '-o', path.join(dir, '%(id)s.%(ext)s'), '--write-info-json', url]]])];
    let last = '';
    for (const [tool, args] of attempts) {
      const res = await this.run(tool, args);
      const files = (await fsp.readdir(dir)).filter((f) => MEDIA.test(f)).map((f) => path.join(dir, f));
      if (files.length) return { files: files.sort(), title: await this.titleFrom(dir), dir };
      last += `\n[${tool}] ${res.stderr.slice(-1500)}`;
    }
    this.log.error('link save failed', url, last);
    await fsp.rm(dir, { recursive: true, force: true });
    throw new LinkError(explain(last));
  }

  // A title from the post's description, if the tools saved one.
  async titleFrom(dir) {
    for (const f of await fsp.readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const m = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
        const t = m.title || m.description || m.desc || m.grid_title || (m.content && m.content.desc) || '';
        const clean = String(t).replace(/\s+/g, ' ').replace(/#\S+/g, '').trim();
        if (clean) return clean.slice(0, 80);
      } catch { /* not metadata */ }
    }
    return '';
  }

  // "Check my links": can the tools still read each link? (Nothing is downloaded.)
  async check(urls) {
    const out = [];
    for (const url of urls) {
      const site = Downloader.site(url);
      const tool = site === 'tiktok' && !/\/photo\//.test(url) ? 'yt-dlp' : 'gallery-dl';
      const res = await this.run(tool, tool === 'yt-dlp' ? ['--simulate', '--no-playlist', url] : ['--simulate', url], 90000);
      out.push({ url, ok: res.ok && !/error/i.test(res.stderr.split('\n').filter((l) => !/warning/i.test(l)).join('\n')), why: res.ok ? '' : explain(res.stderr) });
    }
    return out;
  }

  // "Update downloader": only when pressed. Both tools update themselves in place.
  async update() {
    const a = await this.run('yt-dlp', ['-U'], 300000);
    const b = await this.run('gallery-dl', ['--update'], 300000);
    return { ytdlp: (a.stdout + a.stderr).trim().split('\n').pop(), gallerydl: (b.stdout + b.stderr).trim().split('\n').pop(), versions: await this.versions() };
  }

  async versions() {
    const a = await this.run('yt-dlp', ['--version'], 30000), b = await this.run('gallery-dl', ['--version'], 30000);
    return { ytdlp: a.stdout.trim(), gallerydl: b.stdout.trim() };
  }
}

module.exports = { Downloader, LinkError, explain };
