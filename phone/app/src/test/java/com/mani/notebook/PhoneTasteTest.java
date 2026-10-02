package com.mani.notebook;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

// What For you learns from Save and Not for me (PhoneTaste), on plain Java with org.json. Run:
//   javac -cp json.jar -d out PhoneTaste.java PhoneTasteTest.java && java -cp json.jar;out com.mani.notebook.PhoneTasteTest
public final class PhoneTasteTest {
    static JSONObject pin(String id, String src, String title, String about, String colour) throws Exception {
        return new JSONObject().put("id", id).put("src", src).put("title", title).put("about", about).put("colour", colour);
    }
    static String ids(List<JSONObject> l) { StringBuilder b = new StringBuilder(); for (JSONObject p : l) b.append(p.optString("id")).append(' '); return b.toString().trim(); }

    public static void main(String[] args) throws Exception {
        JSONObject state = new JSONObject(), taste = PhoneTaste.of(state);
        String anime = "related:111", decor = "search:room decor", fits = "search:black outfit";
        List<JSONObject> a = Arrays.asList(pin("a1", anime, "Anime boy", "manga panel black white", "#202020"), pin("a2", anime, "Anime girl", "manga art", "#303030"), pin("a3", anime, "Manga page", "", "#101010"));
        List<JSONObject> d = Arrays.asList(pin("d1", decor, "Pink bedroom", "pink flowers on a bed", "#F2A7C3"), pin("d2", decor, "Cosy desk", "wood desk lamp", "#8B6B4A"), pin("d3", decor, "Pink roses", "pink rose bouquet", "#EFA0BD"));
        List<JSONObject> f = Arrays.asList(pin("f1", fits, "Black jacket", "black leather jacket", "#151515"), pin("f2", fits, "Cargo trousers", "black cargo", "#222222"), pin("f3", fits, "Boots", "", "#111111"));
        List<String> srcs = Arrays.asList(anime, decor, fits);
        List<List<JSONObject>> lists = Arrays.asList(a, d, f);

        // Nothing learnt yet: the sources simply take turns, never one theme in a block.
        check("a1 d1 f1 a2 d2 f2 a3 d3 f3".equals(ids(PhoneTaste.blend(taste, srcs, lists))), "untaught, the sources take turns: " + ids(PhoneTaste.blend(taste, srcs, lists)));

        // Not for me on a pink pin: pink flowers and pink roses (another pin, other words, a near colour) sink or go.
        PhoneTaste.learn(taste, pin("x", decor, "Pink aesthetic", "pink flowers wallpaper", "#F4B0C8"), false);
        check(PhoneTaste.score(taste, d.get(0)) < 0 && PhoneTaste.score(taste, d.get(2)) < 0, "pink pins now count against");
        check(PhoneTaste.score(taste, d.get(1)) >= 0, "the desk (not pink) is untouched");
        List<JSONObject> after = PhoneTaste.blend(taste, srcs, lists);
        int d1 = ids(after).indexOf("d1"), d2 = ids(after).indexOf("d2");
        check(d1 < 0 || d1 > d2, "the pink bedroom no longer comes before the desk: " + ids(after));
        check(ids(after).indexOf("d3") < 0 || ids(after).indexOf("d3") > ids(after).indexOf("f3") - 1, "pink roses sink to the end or go: " + ids(after));

        // Two saves of black outfits: that source takes more turns, and black clothes come first in it.
        PhoneTaste.learn(taste, f.get(0), true); PhoneTaste.learn(taste, f.get(1), true);
        List<JSONObject> liked = PhoneTaste.blend(taste, srcs, lists);
        List<String> firstFour = new ArrayList<>(Arrays.asList(ids(liked).split(" ")).subList(0, 4));
        long outfits = firstFour.stream().filter((s) -> s.startsWith("f")).count();
        check(outfits >= 2, "after two saves the outfits come up more often near the top: " + ids(liked));
        check(PhoneTaste.weight(taste, fits) > PhoneTaste.weight(taste, anime) && PhoneTaste.weight(taste, decor) < 1, "source weights: saved up, turned down down");

        // Kept in the state, as written to ideas.json.
        check(state.getJSONObject("taste").getJSONObject("words").optDouble("pink") < 0, "it is remembered in ideas.json");
        // By look (the phone's picture model): pins like your pictures first; nearly the picture you turned down, or one
        // you already have, left out; the same kind as a turned-down one only sinks a little; no fingerprint yet: same place.
        float[] dark = unit(1, 0, 0, 0), darkish = unit(0.8f, 0.6f, 0, 0), pinkDesk = unit(0, 1, 0, 0), deskish = unit(0, 0.8f, 0.6f, 0), other = unit(0, 0, 0, 1);
        java.util.Map<String, float[]> v = new java.util.HashMap<>();
        v.put("s1", darkish); v.put("s2", pinkDesk); v.put("s3", deskish); v.put("s4", other); v.put("s6", dark);
        List<JSONObject> row = Arrays.asList(pin("p4", "x", "", "", "#000000").put("sig", "s4"), pin("p2", "x", "", "", "#000000").put("sig", "s2"), pin("p5", "x", "", "", "#000000").put("sig", "s5"), pin("p3", "x", "", "", "#000000").put("sig", "s3"), pin("p1", "x", "", "", "#000000").put("sig", "s1"), pin("p6", "x", "", "", "#000000").put("sig", "s6"));
        List<JSONObject> looked = PhoneTaste.byLook(row, (p) -> v.get(p.optString("sig")), Arrays.asList(dark), new ArrayList<>(), Arrays.asList(pinkDesk), new JSONObject());
        check(ids(looked).startsWith("p1"), "the pin most like your pictures comes first: " + ids(looked));
        check(!ids(looked).contains("p2") && !ids(looked).contains("p6"), "the turned-down picture and the one you already have are left out: " + ids(looked));
        check(ids(looked).contains("p3"), "the same kind of thing as the turned-down one stays (it only sinks): " + ids(looked));
        check(ids(looked).split(" ")[2].equals("p5"), "a pin without a fingerprint yet keeps its place: " + ids(looked));
        System.out.println("PhoneTaste checks passed: turns between sources, Not for me sinks look-alikes (words, colour and picture), saves bring more of the same, by look your style first, kept in ideas.json.");
    }
    static float[] unit(float... x) { float n = 0; for (float f : x) n += f * f; n = (float) Math.sqrt(n); for (int i = 0; i < x.length; i++) x[i] /= n; return x; }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}
