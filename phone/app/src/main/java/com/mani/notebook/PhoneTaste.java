package com.mani.notebook;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// What For you has learnt from Save and Not for me, kept on the phone in ideas.json ("taste"). Every pin carries the
// source it came from, the words Pinterest describes it with and its main colour. A save makes its source, words and
// colour count for more; Not for me makes them count against (more strongly). New ideas then come in that order: the
// sources take turns, liked ones more often, and pins like ones you turned down sink or are left out.
final class PhoneTaste {
    private static final Set<String> STOP = new HashSet<>(Arrays.asList(
        "the", "and", "for", "with", "from", "this", "that", "your", "you", "are", "was", "has", "have", "into", "over",
        "pin", "pins", "image", "photo", "picture", "may", "contain", "contains", "idea", "ideas", "pinterest", "its", "our"));
    private static final double DROP = -3; // as unlike as this, a pin is left out

    static JSONObject of(JSONObject state) throws Exception {
        JSONObject t = state.optJSONObject("taste");
        if (t == null) { t = new JSONObject(); state.put("taste", t); }
        if (t.optJSONObject("sources") == null) t.put("sources", new JSONObject());
        if (t.optJSONObject("words") == null) t.put("words", new JSONObject());
        if (t.optJSONArray("colours") == null) t.put("colours", new JSONArray());
        return t;
    }

    // A pin's own words (title, description, Pinterest's description of the picture), plain and singular.
    static Set<String> words(JSONObject pin) {
        Set<String> out = new LinkedHashSet<>();
        for (String w : (pin.optString("title", "") + " " + pin.optString("about", "")).toLowerCase(Locale.ROOT).split("[^a-z]+")) {
            if (w.length() < 3 || STOP.contains(w)) continue;
            out.add(w.length() > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.substring(0, w.length() - 1) : w);
            if (out.size() >= 30) break;
        }
        return out;
    }

    // Saved (`liked`) or turned down: its source, words and colour move that way.
    static void learn(JSONObject taste, JSONObject pin, boolean liked) throws Exception {
        String src = pin.optString("src", "");
        if (!src.isEmpty()) {
            JSONObject s = taste.getJSONObject("sources"), c = s.optJSONObject(src);
            if (c == null) { c = new JSONObject(); s.put(src, c); }
            c.put(liked ? "s" : "h", c.optInt(liked ? "s" : "h") + 1);
        }
        JSONObject words = taste.getJSONObject("words");
        for (String w : words(pin)) words.put(w, Math.max(-6, Math.min(6, words.optDouble(w, 0) + (liked ? 1 : -1.5))));
        if (words.length() > 600) { // the faintest go first
            List<String> keys = new ArrayList<>(); for (Iterator<String> i = words.keys(); i.hasNext(); ) keys.add(i.next());
            keys.sort((a, b) -> Double.compare(Math.abs(words.optDouble(a)), Math.abs(words.optDouble(b))));
            for (int i = 0; i < keys.size() - 500; i++) words.remove(keys.get(i));
        }
        String sig = pin.optString("sig", ""); // (its picture's fingerprint, when the phone has the picture model)
        if (!sig.isEmpty()) { JSONArray l = taste.optJSONArray(liked ? "liked" : "disliked"); if (l == null) { l = new JSONArray(); taste.put(liked ? "liked" : "disliked", l); } l.put(sig); while (l.length() > 80) l.remove(0); }
        int[] rgb = rgb(pin.optString("colour", ""));
        if (rgb != null) {
            JSONArray colours = taste.getJSONArray("colours");
            colours.put(new JSONObject().put("c", pin.optString("colour")).put("v", liked ? 1 : -1));
            while (colours.length() > 40) colours.remove(0);
        }
    }

    // How much more (or less) often a source takes its turn.
    static double weight(JSONObject taste, String src) {
        JSONObject c = taste.optJSONObject("sources") == null ? null : taste.optJSONObject("sources").optJSONObject(src);
        if (c == null) return 1;
        return Math.max(0.15, Math.min(4, (1 + 2.0 * c.optInt("s")) / (1 + 1.5 * c.optInt("h"))));
    }

    // Above 0: like what was saved. Below: like what was turned down.
    static double score(JSONObject taste, JSONObject pin) {
        double score = 0;
        JSONObject words = taste.optJSONObject("words");
        if (words != null) for (String w : words(pin)) score += words.optDouble(w, 0);
        int[] mine = rgb(pin.optString("colour", ""));
        JSONArray colours = taste.optJSONArray("colours");
        for (int i = 0; mine != null && colours != null && i < colours.length(); i++) {
            JSONObject c = colours.optJSONObject(i); int[] other = c == null ? null : rgb(c.optString("c"));
            if (other == null) continue;
            double near = Math.max(0, 1 - Math.sqrt(sq(mine[0] - other[0]) + sq(mine[1] - other[1]) + sq(mine[2] - other[2])) / 70);
            score += near * (c.optInt("v") < 0 ? -1.5 : 0.75);
        }
        return score;
    }

    // Each source's pins (best liked first), taking turns by weight; pins as unlike as DROP are left out.
    static List<JSONObject> blend(JSONObject taste, List<String> srcs, List<List<JSONObject>> lists) {
        int n = lists.size();
        List<List<JSONObject>> ranked = new ArrayList<>();
        double[] w = new double[n], taken = new double[n];
        int[] at = new int[n];
        for (int i = 0; i < n; i++) {
            List<JSONObject> l = new ArrayList<>();
            for (JSONObject p : lists.get(i)) if (score(taste, p) > DROP) l.add(p);
            l.sort((a, b) -> Double.compare(score(taste, b), score(taste, a))); // (stable: Pinterest's order where equal)
            ranked.add(l); w[i] = weight(taste, srcs.get(i));
        }
        List<JSONObject> out = new ArrayList<>();
        while (true) {
            int best = -1;
            for (int i = 0; i < n; i++) if (at[i] < ranked.get(i).size() && (best < 0 || (taken[i] + 1) / w[i] < (taken[best] + 1) / w[best])) best = i;
            if (best < 0) return out;
            out.add(ranked.get(best).get(at[best]++)); taken[best]++;
        }
    }

    // (With the phone's picture model, PhoneVision.) Pins with a fingerprint go in order of how much they look like `mine` (your pictures) and `liked` (pins you
    // saved), a little less like `disliked` (Not for me: nearly the same picture is left out; the same kind of thing only sinks a little, so one
    // turned-down pink desk doesn't take every desk away), each a little less if it looks like the
    // ones just before it (so a run of the same thing doesn't happen) and left out when it is a picture you already
    // have or one just shown. Pins not fingerprinted yet keep their places. `taste`: PhoneTaste's word and colour score.
    static List<JSONObject> byLook(List<JSONObject> pins, java.util.function.Function<JSONObject, float[]> vecOf, List<float[]> mine, List<float[]> liked, List<float[]> disliked, JSONObject taste) {
        List<Integer> slots = new ArrayList<>(); List<JSONObject> left = new ArrayList<>(); List<float[]> lv = new ArrayList<>(); List<Float> score = new ArrayList<>();
        List<JSONObject> out = new ArrayList<>(pins);
        for (int i = 0; i < pins.size(); i++) {
            JSONObject p = pins.get(i); float[] v = vecOf.apply(p);
            if (v == null) continue;
            float no = 0; for (float[] u : disliked) no = Math.max(no, dot(u, v));
            float have = 0; for (float[] u : mine) have = Math.max(have, dot(u, v));
            slots.add(i); out.set(i, null);
            if (no > 0.9f || have > 0.92f) continue; // (nearly the same as one turned down, or already yours)
            left.add(p); lv.add(v);
            score.add(closeness(v, mine) + 0.5f * closeness(v, liked) - 0.8f * Math.max(0, no - 0.78f) + 0.03f * (float) Math.max(-4, Math.min(4, score(taste, p))));
        }
        List<float[]> recent = new ArrayList<>(); List<JSONObject> picked = new ArrayList<>();
        while (!left.isEmpty()) {
            int best = -1; float bestV = -1e9f;
            for (int i = 0; i < left.size(); i++) {
                float same = 0; for (int k = Math.max(0, recent.size() - 20); k < recent.size(); k++) same = Math.max(same, dot(recent.get(k), lv.get(i)));
                float v = score.get(i) - 0.4f * Math.max(0, same - 0.55f) - (same > 0.92f ? 10 : 0);
                if (v > bestV) { bestV = v; best = i; }
            }
            if (bestV > -5) { picked.add(left.get(best)); recent.add(lv.get(best)); }
            left.remove(best); lv.remove(best); score.remove(best);
        }
        for (int i = 0; i < slots.size(); i++) out.set(slots.get(i), i < picked.size() ? picked.get(i) : null);
        out.removeIf((p) -> p == null);
        return out;
    }

    static float dot(float[] a, float[] b) { float s = 0; for (int i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]; return s; }
    // How much a pin looks like a set of pictures: the mean of its three closest matches (as on the PC).
    static float closeness(float[] v, List<float[]> set) {
        if (v == null || set.isEmpty()) return 0;
        float a = -2, b = -2, c = -2;
        for (float[] u : set) { float d = dot(u, v); if (d > a) { c = b; b = a; a = d; } else if (d > b) { c = b; b = d; } else if (d > c) c = d; }
        int n = Math.min(3, set.size()); return (a + (n > 1 ? b : 0) + (n > 2 ? c : 0)) / n;
    }
    private static double sq(double v) { return v * v; }
    private static int[] rgb(String hex) {
        if (hex == null || !hex.matches("#[0-9a-fA-F]{6}")) return null;
        int v = Integer.parseInt(hex.substring(1), 16);
        return new int[]{ (v >> 16) & 255, (v >> 8) & 255, v & 255 };
    }
}
