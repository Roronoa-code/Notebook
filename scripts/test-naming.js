// Names (main/naming.js): the naming model's answers (real ones it gave for the owner's pictures) tidied
// into titles, and placeholder titles told apart from real ones. Usage: node scripts/test-naming.js
const assert = require('assert/strict');
const { cleanName, isGenericTitle } = require('../main/naming');

const cases = [
  ['X-ray Flower', 'X-ray flower'],
  ['Red PC Gaming Rig', 'Red PC gaming rig'],
  ['Gaming PC with RGB Fans', 'Gaming PC with RGB fans'],
  ['Gaming Room - Red Neon', 'Gaming room red neon'],
  ['"Studio Control Gear."', 'Studio control gear'],
  ['Title: Grey Hoodie Outfit', 'Grey hoodie outfit'],
  ['Gray Color Block Jacket', 'Grey colour block jacket'],
  ['Gaming desk with sword and figures of old heroes in', 'Gaming desk with sword and figures'],
  ['Red Gaming Setup\nThis picture shows', 'Red gaming setup'],
  ['XurnalExillions,omata.D.icator!一辈子在生活中', null],
  ['', null]
];
for (const [raw, want] of cases) assert.equal(cleanName(raw), want, raw);
for (const t of ['Pinterest pin', 'TikTok post (2/5)', '20260919_205043', 'AISelect_20260919_204734', 'IMG_1234', 'Screen_Recording_20250901-203311_TikTok', 'Pasted 25 Sept 14.05']) assert.ok(isGenericTitle(t), t);
for (const t of ['Sizes', 'Sung jin woo Loop', 'Autumn capsule', 'wallpaper dusk']) assert.ok(!isGenericTitle(t), t);
console.log(`Naming passed: ${cases.length} model answers become tidy titles (or none when garbled); placeholder titles are told apart from real ones.`);
