// The Pinterest ad filter on its own: promoted pins leave lists, id tables, feed wrappers and id
// references; everything else is untouched. Usage: node scripts/test-adfilter.js
const assert = require('assert/strict');
const { filterText } = require('../main/adfilter');

const pin = (id, extra) => ({ id, type: 'pin', images: { orig: { url: 'x' } }, promoter: null, is_promoted: false, ...extra });
const ad = (id) => pin(id, { is_promoted: true, promoter: { id: 'adv' }, recommendation_reason: { reason: 'PROMOTED_PIN' } });

// A feed page: ads in the list, in a keyed table, wrapped in a small item and referred to by id.
const page = {
  resource_response: { data: [pin('1'), ad('AbC'), pin('2'), { type: 'story', pin: ad('XyZ') }, pin('3')], bookmark: 'b' },
  pins: { 1: pin('1'), AbC: ad('AbC') },
  order: ['1', 'AbC', '2'],
  board: { id: 'b1', cover_pin: pin('9'), pin_count: 4 }
};
const out = filterText(JSON.stringify(page));
const got = JSON.parse(out.text);
assert.deepEqual(got.resource_response.data.map((p) => p.id), ['1', '2', '3'], 'ads leave the list, and wrapped ones go with their wrapper');
assert.deepEqual(Object.keys(got.pins), ['1'], 'ads leave id tables');
assert.deepEqual(got.order, ['1', '2'], 'references to ads go too');
assert.equal(got.board.cover_pin.id, '9', 'ordinary pins are untouched');
assert.equal(got.resource_response.bookmark, 'b');
assert.equal(out.removed, 4); // two from the list, one from the table, one reference

// Different ad markers each count on their own.
for (const mark of [{ is_promoted: true }, { promoter: { id: 'a' } }, { is_downstream_promotion: true }, { promoted_is_removable: true }, { recommendation_reason: { reason: 'PROMOTED_PIN' } }]) {
  const r = JSON.parse(filterText(JSON.stringify({ data: [pin('1'), pin('2', mark)] })).text);
  assert.deepEqual(r.data.map((p) => p.id), ['1'], 'marker ' + JSON.stringify(mark));
}

// No ads, or not JSON: handed back exactly as it came.
const plain = JSON.stringify({ data: [pin('1'), pin('2')] });
assert.equal(filterText(plain).text, plain);
assert.equal(filterText('<html>not json').text, '<html>not json');
// The page itself: its data blocks are cleaned, "<" inside text can't end the block, everything else stays.
const { filterHtml } = require('../main/adfilter');
const block = JSON.stringify({ feed: [pin('1', { title: 'a </script> b' }), ad('Zz')] }).replace(/</g, '\\u003c');
const html = `<html><head><script id="__PWS_INITIAL_PROPS__" type="application/json">${block}</script><script>var x = 1;</script></head><body>hi</body></html>`;
const hOut = filterHtml(html);
assert.equal(hOut.removed, 1);
const inner = hOut.text.match(/type="application\/json">([\s\S]*?)<\/script>/)[1];
assert.ok(!inner.includes('<'), 'no raw "<" inside the data block');
assert.deepEqual(JSON.parse(inner).feed.map((p) => p.id), ['1']);
assert.equal(JSON.parse(inner).feed[0].title, 'a </script> b');
assert.ok(hOut.text.includes('<script>var x = 1;</script>') && hOut.text.endsWith('<body>hi</body></html>'));
assert.equal(filterHtml('<html>no data</html>').text, '<html>no data</html>');
console.log('Ad filter passed: promoted pins leave lists, id tables, wrappers, references and the page\'s own data; other answers are untouched.');
