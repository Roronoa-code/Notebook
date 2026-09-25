// Short, proper names for pictures, made on this PC from what the captioning model says about the
// picture ("A woman in a leather outfit standing in front of a building" becomes "Leather outfit"),
// helped by what recognition found (type, clothing colours, style). Plain functions.

const UK = [[/\bcolor/g, 'colour'], [/\bgray\b/g, 'grey'], [/\bcenter/g, 'centre'], [/\bfavorite/g, 'favourite']];
const PEOPLE = '(?:woman|man|girl|boy|person|lady|guy|model|people|couple|child|kid|men|women)';
const COLOURS = /\b(black|white|grey|gray|red|blue|green|yellow|pink|purple|brown|beige|orange|cream|navy|khaki|denim|gold|silver)\b/;

// The scenery and posing at the end of a caption isn't part of the name.
const TAILS = [
  /\s+(?:is\s+)?(?:standing|sitting|walking|posing|leaning|looking|smiling|holding|taking|lying|running|wearing\s+nothing)\b.*$/,
  /\s+in front of\b.*$/, /\s+(?:on|in|at|by|near|next to|against|behind|under)\s+(?:a|an|the)\s+(?:street|road|sidewalk|pavement|wall|building|fence|park|room|background|foreground|mirror|door|window|field|beach|city|stage|floor|ground|table|bed|car|sky)\b.*$/,
  /\s+in the (?:background|foreground|middle|centre|center|corner)\b.*$/, /\s+coming out of it$/, /\s+on it$/, /\s+on$/, /\s+(?:with|and)\s+(?:a|an|the)\s+(?:sky|background)\b.*$/
];
const GARMENTS = '(?:coat|jacket|hoodie|t-shirt|shirt|top|dress|suit|skirt|jeans|pants|trousers|shorts|sweater|jumper|blazer|cardigan|vest|bra|boots|sneakers|trainers|hat|cap|scarf|uniform|tracksuit|leggings|kimono|gown|costume|outfit|puffer|parka|overalls|dungarees|joggers|sweatshirt|polo|tie|bag)';
const WEAK_END = /\s+(?:and|with|of|in|on|a|an|the|for|to|at|by|wearing)$/;

function tidy(caption) {
  let s = String(caption || '').trim().toLowerCase().replace(/[.!]+$/, '');
  for (const [re, to] of UK) s = s.replace(re, to);
  s = s.replace(/^(?:this is |there is |here is )?(?:a |an |the )/, '');
  // "a blurry image of a red sky" -> "blurry red sky"; "a photo of ..." -> "..."
  s = s.replace(/^((?:[a-z]+ )?)(?:image|picture|photo|photograph|drawing|illustration|painting|render|graphic|screenshot) of (?:a |an |the )?/, '$1');
  for (const re of TAILS) { const t = s.replace(re, ''); if (t.trim().split(/\s+/).length >= 2) s = t; } // never down to one word
  return s.trim();
}

function shorten(s, words = 6, chars = 42) {
  let w = s.split(/\s+/).filter(Boolean).slice(0, words);
  while (w.join(' ').length > chars && w.length > 2) w.pop();
  let out = w.join(' ');
  while (WEAK_END.test(out)) out = out.replace(WEAK_END, '');
  return out;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// caption: the model's sentence. type: 'outfit' | 'wallpaper' | 'icon' | 'profile picture' | 'other'.
// colours: [{ name }] (for outfits, the clothes' colours). styles: ['streetwear', ...]. Returns a name or null.
function nameFrom({ caption, type, colours = [], styles = [] }) {
  const s = tidy(caption);
  const colour = colours[0] && colours[0].name ? colours[0].name.replace('light grey', 'grey') : '';
  if (type === 'outfit') {
    // The clothes are the name: every garment the caption mentions, with the words just before it
    // ("gray coat", "black shirt and black shorts", "blue dress and black hat"), wherever they are.
    const text = String(caption || '').toLowerCase().replace(/\bgray\b/g, 'grey');
    const found = [];
    // Up to two describing words before each garment: not little words, sizes, or another garment.
    const SKIP = `(?:a|an|the|his|her|their|and|with|in|on|of|is|at|to|wearing|walking|standing|sitting|large|small|big|little|tall|${GARMENTS.slice(3, -1)})\\b`;
    const re = new RegExp(`\\b((?:(?!${SKIP})[a-z-]+\\s+){0,2})(${GARMENTS})\\b`, 'g');
    for (const m of text.matchAll(re)) {
      const phrase = [...m[1].trim().split(/\s+/).filter(Boolean), m[2]].join(' ');
      if (!found.some((f) => f.includes(m[2]))) found.push(phrase);
      if (found.length === 2) break;
    }
    if (found.length) {
      const first = found[0].split(' ')[0];
      if (found[1] && found[0].includes(' ') && found[1].startsWith(first + ' ')) found[1] = found[1].slice(first.length + 1); // "black shirt and shorts"
      const thing = found.join(' and ');
      return cap(COLOURS.test(thing) || !colour ? thing : `${colour} ${thing}`);
    }
    const style = styles[0] ? `${styles[0]} ` : '';
    return cap(`${colour ? colour + ' ' : ''}${style}outfit`.replace(/\by2k\b/, 'Y2K'));
  }
  if (!s) return null;
  const name = shorten(s.replace(new RegExp(`^(?:young |old |beautiful |handsome |smiling )?(${PEOPLE})\\s+(?:is\\s+)?wearing\\s+`), '$1 in '));
  return name ? cap(name) : null;
}

// Titles that are just a file's or a website's placeholder: fine to replace with a proper name.
const GENERIC = /^(?:pinterest pin|tiktok post|pasted\b.*|img[-_ ]?\d.*|vid[-_ ]?\d.*|pxl[-_ ]?\d.*|dsc[-_ ]?\d.*|screenshot.*|screen[-_ ]?recording.*|aiselect.*|image|download(?:\s*\(\d+\))?|untitled|photo|video|\d[\d\s_.\-()]*|[a-f0-9]{16,}|pinterest_\d+.*)(?:\s*\(\d+\/\d+\))?$/i;
const isGenericTitle = (title) => GENERIC.test(String(title || '').trim());

module.exports = { nameFrom, tidy, isGenericTitle };
