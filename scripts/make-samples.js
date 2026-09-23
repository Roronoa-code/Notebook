// Makes test photos and videos (real JPEGs and H.264 MP4s, like a Samsung phone produces) using ffmpeg.
// Usage: node scripts/make-samples.js <folder>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function makeSamples(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  const out = (name) => path.join(dir, name);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1350', '-frames:v', '1', out('IMG_20250914_171203.jpg')]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=size=1440x1080', '-frames:v', '1', out('wallpaper dusk.jpg')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out('Screen_Recording_20250901-203311_TikTok.mp4')]);
  ff(['-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out('VID_20250902_221540.mp4')]);
  fs.writeFileSync(out('shopping list.txt'), 'not a photo');
  return fs.readdirSync(dir).map((f) => path.join(dir, f));
}

module.exports = { makeSamples };
if (require.main === module) console.log(makeSamples(process.argv[2] || 'test-output/samples').join('\n'));
