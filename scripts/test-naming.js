// Proper names from captions (main/naming.js), on real captions the model gave for the test pictures.
// Usage: node scripts/test-naming.js
const assert = require('assert/strict');
const { nameFrom, isGenericTitle } = require('../main/naming');

const outfit = (caption, colour = 'black', styles = ['streetwear']) => nameFrom({ caption, type: 'outfit', colours: [{ name: colour }], styles });
const other = (caption, type) => nameFrom({ caption, type });
const cases = [
  [outfit('A woman walking down a street wearing a coat and scarf.', 'grey'), 'Grey coat and scarf'],
  [outfit('A woman in a leather outfit standing in front of a building.'), 'Black leather outfit'],
  [outfit('A woman walking down a sidewalk in a gray coat.', 'light grey'), 'Grey coat'],
  [outfit('A man in a black shirt and black shorts with orange boots.'), 'Black shirt and shorts'],
  [outfit('A woman in a blue dress and a large black hat.'), 'Blue dress and black hat'],
  [outfit('A man wearing a black hoodie and cargo pants taking a mirror selfie.'), 'Black hoodie and cargo pants'],
  [outfit('A group of people standing on a sidewalk.', 'navy', ['y2k']), 'Navy Y2K outfit'],
  [other('A blurry image of a red sky in the background.', 'wallpaper'), 'Blurry red sky'],
  [other('A colorful image of a tunnel with a blue light coming out of it.', 'wallpaper'), 'Colourful tunnel with a blue light'],
  [other('A blue circle with four white dots on it.', 'icon'), 'Blue circle with four white dots'],
  [other('A graphic of a hand holding a pen and a check mark.', 'icon'), 'Hand holding a pen'],
  [other('A woman with long red hair and green eyes.', 'profile picture'), 'Woman with long red hair'],
  [other('a cartoon image of a boy with long hair', 'profile picture'), 'Cartoon boy with long hair'],
  [other('', 'wallpaper'), null]
];
for (const [got, want] of cases) assert.equal(got, want);
for (const t of ['Pinterest pin', 'TikTok post (2/5)', '20260919_205043', 'AISelect_20260919_204734', 'IMG_1234', 'Screen_Recording_20250901-203311_TikTok', 'Pasted 25 Sept 14.05']) assert.ok(isGenericTitle(t), t);
for (const t of ['Sizes', 'Sung jin woo Loop', 'Autumn capsule', 'wallpaper dusk']) assert.ok(!isGenericTitle(t), t);
console.log(`Naming passed: ${cases.length} captions turn into short proper names; placeholder titles are told apart from real ones.`);
