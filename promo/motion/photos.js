// The photos on the film's mood board: free-to-use Unsplash photos, fetched through picsum.photos by id.
// Downloaded once into promo/motion/out/photos (not kept in git). Credits are in README.md.
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, 'out', 'photos');
const BOARDS = ['Outfits', 'Wallpapers', 'Icons', 'Profile pictures', 'City'];
// A word the app's stand-in recogniser understands, so the labels look like the real ones.
const HINT = { Outfits: 'outfit', Wallpapers: 'wallpaper', Icons: 'icon', 'Profile pictures': 'portrait', City: 'city' };

// [picsum id, board, title, width, height, photographer]
const LIST = [
  [64, 'Outfits', 'Sunglasses and daisies', 900, 1200, 'Alexander Shustov'],
  [669, 'Outfits', 'Orange parka', 900, 1200, 'Luke Pamer'],
  [823, 'Outfits', 'Red beanie', 900, 1125, 'Benjamin Combs'],
  [836, 'Outfits', 'Hat and guitar', 900, 1200, 'Lechon Kirb'],
  [1005, 'Outfits', 'Mustard scarf', 900, 1125, 'Matthew Wiebe'],
  [338, 'Outfits', 'Hood up', 900, 1200, 'Patryk Sobczak'],
  [473, 'Outfits', 'Long black coat', 900, 1350, 'Todd Quackenbush'],
  [883, 'Outfits', 'Puffer by the lake', 900, 1200, 'Joshua Earle'],
  [758, 'Outfits', 'Striped wrap', 900, 1125, 'Eli DeFaria'],
  [91, 'Outfits', 'Film camera fit', 900, 1200, 'Jennifer Trovato'],
  [662, 'Outfits', 'Black boots', 900, 1200, 'Caleb Ekeroth'],
  [455, 'Outfits', 'Cargo trousers', 900, 1350, 'Amanda Sandlin'],
  [1027, 'Profile pictures', 'Auburn', 900, 1125, 'Roksolana Zasiadko'],
  [996, 'Profile pictures', 'Golden profile', 900, 900, 'Léa Dubedout'],
  [65, 'Profile pictures', 'Late sun', 900, 1125, 'Alexander Shustov'],
  [901, 'Wallpapers', 'Aurora', 900, 1600, 'Marcelo Quinan'],
  [903, 'Wallpapers', 'Pink galaxy', 900, 1600, 'Greg Rakozy'],
  [974, 'Wallpapers', 'Under the Milky Way', 900, 1600, 'Greg Rakozy'],
  [683, 'Wallpapers', 'Star trails', 900, 1600, 'ahmadreza sajadi'],
  [907, 'Wallpapers', 'Blue peak', 900, 1600, 'Pierre Bouillot'],
  [906, 'Wallpapers', 'Matterhorn', 900, 1350, 'Andras Toth'],
  [1041, 'Wallpapers', 'Deep wave', 900, 1600, 'Tim Marshall'],
  [866, 'Wallpapers', 'Pink pier', 900, 1350, 'Samuel Zeller'],
  [788, 'Wallpapers', 'Red sky', 900, 1350, 'Michael Baird'],
  [870, 'Wallpapers', 'Lighthouse', 900, 1600, 'Joshua Hibbert'],
  [1016, 'Wallpapers', 'Canyon', 900, 1200, 'Philippe Wuyts'],
  [1043, 'Wallpapers', 'Valley', 900, 1350, 'Christian Joudrey'],
  [952, 'Icons', 'Stripes', 900, 900, 'Noah Rosenfield'],
  [1079, 'Icons', 'Ring of light', 900, 900, 'Kamesh Vedula'],
  [893, 'Icons', 'Curves', 900, 900, 'Samuel Zeller'],
  [1069, 'Icons', 'Jellyfish', 900, 1125, 'Marat Gilyadzinov'],
  [1080, 'Icons', 'Strawberries', 900, 900, 'veeterzy'],
  [949, 'Icons', 'White spiral', 900, 1125, 'Drew Patrick Miller'],
  [953, 'Icons', 'Rotunda', 900, 900, 'Alexandre Perotto'],
  [1048, 'City', 'Look up', 900, 1350, 'Anthony Delanoix'],
  [1033, 'City', 'Escalator', 900, 1200, 'Erez Attias'],
  [402, 'City', 'Golden street', 900, 1350, 'Loudge'],
  [736, 'City', 'Empire State', 900, 1600, 'Ben Dumond'],
  [396, 'City', 'Tunnel', 900, 1200, 'Sam X'],
  [1047, 'City', 'Old alley', 900, 1350, 'sergee bee']
].map(([id, board, title, w, h, by]) => ({ id, board, title, w, h, by, name: `${title} ${HINT[board]}`, file: path.join(DIR, board, `${title} ${HINT[board]}.jpg`) }));

function get(url, file, hops = 5) {
  return new Promise((ok, bad) => https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops) { res.resume(); return get(new URL(res.headers.location, url).href, file, hops - 1).then(ok, bad); }
    if (res.statusCode !== 200) { res.resume(); return bad(new Error(`${url}: HTTP ${res.statusCode}`)); }
    const tmp = file + '.part', out = fs.createWriteStream(tmp);
    res.pipe(out); out.on('finish', () => { fs.renameSync(tmp, file); ok(); }); out.on('error', bad);
  }).on('error', bad));
}

async function ensure() {
  for (const p of LIST) {
    if (fs.existsSync(p.file)) continue;
    fs.mkdirSync(path.dirname(p.file), { recursive: true });
    await get(`https://picsum.photos/id/${p.id}/${p.w}/${p.h}`, p.file);
  }
  return LIST;
}

// Boards taken in turn, so the All board looks like a real, mixed mood board.
function mixed(list = LIST) {
  const by = BOARDS.map((b) => list.filter((p) => p.board === b)), out = [];
  for (let i = 0; by.some((g) => g.length); i++) { const g = by[i % by.length]; if (g.length) out.push(g.shift()); }
  return out;
}

module.exports = { LIST, BOARDS, DIR, ensure, mixed };
if (require.main === module) ensure().then((l) => console.log(`${l.length} photos in ${DIR}`), (e) => { console.error(e); process.exit(1); });
