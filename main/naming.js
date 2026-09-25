// Names for pictures. The naming model (namer.js) is asked for a short title; this tidies what it says
// into the app's style ("Red PC Gaming Rig" -> "Red PC gaming rig"), and tells placeholder titles
// (camera file names, "Pinterest pin") apart from real ones. Plain functions.

const UK = [[/\bcolor/gi, 'colour'], [/\bgray\b/gi, 'grey'], [/\bcenter/gi, 'centre'], [/\bfavorite/gi, 'favourite'], [/\bjewelry/gi, 'jewellery']];

// The model's answer as a title: sentence case (short all-capital words like PC or RGB stay), UK
// spelling, no quotes or trailing full stop, at most six words. null if it isn't usable.
function cleanName(raw) {
  let s = String(raw || '').split('\n')[0].trim();
  s = s.replace(/^["'“‘]+|["'”’.!]+$/g, '').replace(/^title:\s*/i, '').replace(/\s+[-–—:|]\s+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /[^\x20-\x7EÀ-ɏ’'&]/.test(s)) return null; // not plain words: better no name than a garbled one
  for (const [re, to] of UK) s = s.replace(re, (m) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to));
  let words = s.split(' ').slice(0, 6);
  while (words.join(' ').length > 48 && words.length > 2) words.pop();
  words = words.map((w, i) => (/^[A-Z0-9]{2,5}s?$/.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()));
  while (words.length > 1 && /^(and|with|of|in|on|a|an|the|for|to|at|by)$/i.test(words[words.length - 1])) words.pop();
  const out = words.join(' ');
  return out.length >= 2 ? out : null;
}

// Titles that are just a file's or a website's placeholder: fine to replace with a proper name.
const GENERIC = /^(?:pinterest pin|tiktok post|pasted\b.*|img[-_ ]?\d.*|vid[-_ ]?\d.*|pxl[-_ ]?\d.*|dsc[-_ ]?\d.*|screenshot.*|screen[-_ ]?recording.*|aiselect.*|image|download(?:\s*\(\d+\))?|untitled|photo|video|\d[\d\s_.\-()]*|[a-f0-9]{16,}|pinterest_\d+.*)(?:\s*\(\d+\/\d+\))?$/i;
const isGenericTitle = (title) => GENERIC.test(String(title || '').trim());

module.exports = { cleanName, isGenericTitle };
