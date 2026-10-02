package com.mani.notebook;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Phone-owned Pinterest Ideas. It keeps its own feeds because PC sync may refresh the older PC cache.
final class PhoneIdeas {
    private static final long STALE_MS = 30 * 60 * 1000L;
    private static final int BATCH = 60, DISK_PINS = 300;
    private static final Pattern PIN_URL = Pattern.compile("https://www\\.pinterest\\.com/pin/(\\d{1,25})/");
    private final Library lib;
    private final SyncClient pc;
    private final File stateFile, imageDir, cacheDir;
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private final ExecutorService imageWorker = Executors.newSingleThreadExecutor();
    private final Set<String> busy = new HashSet<>();
    private final Map<String, JSONObject> sessionFeeds = new HashMap<>();
    private final PhoneVision vision;

    PhoneIdeas(Context ctx, Library lib, SyncClient pc) {
        this.lib = lib;
        this.pc = pc;
        stateFile = new File(ctx.getFilesDir(), "ideas.json");
        cacheDir = new File(ctx.getFilesDir(), "ideas");
        imageDir = new File(cacheDir, "img");
        vision = new PhoneVision(ctx, lib, cacheDir);
    }

    synchronized String feedJson() { return response(null, null).toString(); }

    // Automatic refresh: a warm direct cache is returned immediately; a stale/empty feed is fetched.
    String refresh(String requested, boolean force, boolean more) {
        String key = normaliseKey(requested);
        if (key == null) return response(requested, "That Ideas feed is not available.").toString();
        synchronized (this) {
            if (!busy.add(key)) return response(key, "Ideas are already being refreshed. Try again in a moment.").toString();
        }
        try {
            JSONObject state = readState(), current = feed(state, key);
            JSONArray oldPins = new JSONArray(current.optJSONArray("pins") == null ? "[]" : current.optJSONArray("pins").toString());
            long at = current.optLong("at", 0);
            if (!more && !force && oldPins.length() > 0 && System.currentTimeMillis() - at < STALE_MS) return response(key, null).toString();
            List<PhoneIdeasNet.Source> sources = sources(key, current, more);
            JSONArray pool = current.optJSONArray("pool"); // fetched before, not shown yet (most already fingerprinted)
            boolean poolOnly = more && sources.isEmpty() && pool != null && pool.length() > 0;
            if (sources.isEmpty() && !poolOnly) return response(key, more ? "There are no more ideas in this feed yet." : "There is nothing to search for yet.").toString();
            List<Result> pages = fetch(sources);
            boolean anySuccess = poolOnly, anyPins = poolOnly;
            for (Result result : pages) {
                if (result.page != null) { anySuccess = true; anyPins |= !result.page.pins.isEmpty(); updateSource(result.source, result.page); }
            }
            if (!anySuccess || !anyPins) {
                current.put("error", anySuccess ? "Pinterest sent no pins back. Try again later." : "Couldn’t reach Pinterest. Check the internet connection and try again.").put("offline", !anySuccess);
                synchronized (this) { sessionFeeds.put(key, current); writeState(stateWithFeed(key, current)); }
                return response(key, current.optString("error")).toString();
            }
            List<JSONObject> candidates = new ArrayList<>();
            Set<String> ids = new HashSet<>(), sigs = new HashSet<>();
            Set<String> hidden = hiddenIds(), saved = savedIds();
            if (more) addPins(current.optJSONArray("pins"), candidates, ids, sigs, true, hidden);

            // The sources take turns (as on the PC), so every screen of ideas mixes them rather than one source's pins (one
            // theme), then the next's; what Save and Not for me have taught (PhoneTaste) sets how often and in what order.
            List<String> srcs = new ArrayList<>(); List<List<JSONObject>> lists = new ArrayList<>();
            for (Result result : pages) {
                if (result.page == null) continue;
                String src = result.source.kind + ":" + result.source.arg;
                for (JSONObject pin : result.page.pins) pin.put("src", src);
                srcs.add(src); lists.add(result.page.pins);
            }
            JSONObject taste = PhoneTaste.of(state);
            List<JSONObject> next = new ArrayList<>();
            for (int i = 0; pool != null && i < pool.length(); i++) if (pool.optJSONObject(i) != null) addPin(pool.optJSONObject(i), next, ids, sigs, hidden, saved);
            for (JSONObject pin : PhoneTaste.blend(taste, srcs, lists)) addPin(pin, next, ids, sigs, hidden, saved);
            rank(next, key, true);
            next = byLook(next, key, taste);
            // A first page of BATCH (a search or a pin's related ones: all of them), the next pages 40 at a time; the rest
            // wait in the pool for the next page or New ideas, by then fingerprinted.
            boolean all = key.startsWith("search:") || key.startsWith("pin:");
            int take = all ? next.size() : Math.min(next.size(), more ? 40 : BATCH);
            candidates.addAll(next.subList(0, take));
            JSONArray nextPins = new JSONArray(), rest = new JSONArray();
            for (JSONObject pin : candidates) nextPins.put(pin);
            for (JSONObject pin : next.subList(take, Math.min(next.size(), take + 300))) rest.put(pin);
            current.put("pins", nextPins).put("pool", rest).put("at", more ? current.optLong("at", System.currentTimeMillis()) : System.currentTimeMillis())
                .put("signedIn", false).put("error", JSONObject.NULL).put("offline", false).put("sources", sourcesJson(sources)).put("more", hasMore(sources) || rest.length() > 0);
            synchronized (this) { sessionFeeds.put(key, current); writeState(stateWithFeed(key, current)); }
            prefetch(current);
            vision.want(next); // (shown first, then the pool: fingerprinted in the background for next time)
            return response(key, null).toString();
        } catch (Exception e) {
            synchronized (this) {
                try { JSONObject state = readState(), current = feed(state, key); current.put("error", friendly(e)).put("offline", true); sessionFeeds.put(key, current); writeState(stateWithFeed(key, current)); }
                catch (Exception ignored) { /* the cached feed remains usable */ }
            }
            return response(key, friendly(e)).toString();
        } finally { synchronized (this) { busy.remove(key); } }
    }

    synchronized String hide(String id) {
        if (id == null || !id.matches("\\d{1,25}")) return feedJson();
        try {
            JSONObject state = readState();
            JSONArray hidden = state.optJSONArray("hidden");
            if (hidden == null) hidden = new JSONArray();
            JSONObject pin = findPinById(id);
            if (pin != null) PhoneTaste.learn(PhoneTaste.of(state), pin, false); // (less like this from now on)
            for (int i = hidden.length() - 1; i >= 0; i--) if (id.equals(hidden.optString(i))) hidden.remove(i);
            hidden.put(id);
            while (hidden.length() > 3000) hidden.remove(0);
            state.put("hidden", hidden);
            JSONObject direct = allDirectFeeds(state);
            for (Iterator<String> i = direct.keys(); i.hasNext(); ) removePin(direct.optJSONObject(i.next()), id);
            writeState(state);
            return response(null, null).toString();
        } catch (Exception e) { return response(null, friendly(e)).toString(); }
    }

    // Saves only after the PinResource response and the bounded media download succeed.
    String save(String rawUrl, String boardId) throws Exception {
        Matcher m = PIN_URL.matcher(rawUrl == null ? "" : rawUrl.trim());
        if (!m.matches()) throw new IOException("That is not a Pinterest pin link.");
        String id = m.group(1), url = "https://www.pinterest.com/pin/" + id + "/";
        String body = PhoneIdeasNet.json(PhoneIdeasNet.pinDataUrl(id));
        PhoneIdeasNet.Media media = PhoneIdeasNet.parseMedia(body, id);
        File tmp = new File(cacheDir, "save-" + id + ".part");
        try {
            PhoneIdeasNet.Download got = PhoneIdeasNet.download(media.url, tmp, media.video ? PhoneIdeasNet.MAX_VIDEO : PhoneIdeasNet.MAX_IMAGE, media.video);
            String mime = got.mime;
            if (media.video && !mime.toLowerCase(Locale.ROOT).startsWith("video/")) mime = media.mime;
            if (!media.video && !mime.toLowerCase(Locale.ROOT).startsWith("image/")) mime = media.mime;
            String ext = extension(mime, media.video);
            String title = titleFor(id);
            String board = validBoard(boardId);
            lib.importDownloaded(tmp, title + ext, mime, board, url);
            learnSaved(id);
            return new JSONObject().put("url", url).put("ok", true).put("message", "Saved to your notebook.").toString();
        } finally { tmp.delete(); }
    }

    // A saved pin makes For you lean towards its source, words and colour.
    private synchronized void learnSaved(String id) {
        try { JSONObject pin = findPinById(id), state = readState(); if (pin == null) return; PhoneTaste.learn(PhoneTaste.of(state), pin, true); writeState(state); }
        catch (Exception ignored) { /* the save itself has worked */ }
    }

    // The WebView asks for /feed/<sig>.jpg. It gets a native cached file or a native allowlisted fetch.
    File feedImage(String sig) {
        if (sig == null || !sig.matches("[0-9a-f]{32}")) return null;
        File cached = cachedImage(sig);
        if (cached != null) return cached;
        String url = null;
        try {
            JSONObject pin = findPin(sig);
            if (pin != null) url = pin.optString("img", pin.optString("small", null));
            if (url != null) {
                File part = new File(imageDir, sig + "." + Thread.currentThread().getId() + ".part");
                try {
                    PhoneIdeasNet.Download got = PhoneIdeasNet.download(url, part, PhoneIdeasNet.MAX_IMAGE, false);
                    File already = cachedImage(sig); if (already != null) return already;
                    String ext = extension(got.mime, false);
                    File dest = new File(imageDir, sig + ext);
                    if (!part.renameTo(dest)) part.delete();
                    if (dest.isFile()) return dest;
                } finally { part.delete(); }
            }
        } catch (Exception ignored) { /* an offline feed can still use its cached picture */ }
        try { return pc.feedImage(sig); } catch (Exception ignored) { return null; }
    }

    private List<Result> fetch(List<PhoneIdeasNet.Source> sources) throws Exception {
        List<Future<PhoneIdeasNet.Page>> jobs = new ArrayList<>();
        for (PhoneIdeasNet.Source source : sources) jobs.add(network.submit(() -> PhoneIdeasNet.page(source)));
        List<Result> out = new ArrayList<>();
        for (int i = 0; i < jobs.size(); i++) {
            try { out.add(new Result(sources.get(i), jobs.get(i).get())); }
            catch (Exception e) { out.add(new Result(sources.get(i), null)); }
        }
        return out;
    }

    private List<PhoneIdeasNet.Source> sources(String key, JSONObject current, boolean more) throws Exception {
        if (more) {
            List<PhoneIdeasNet.Source> out = new ArrayList<>();
            JSONArray a = current.optJSONArray("sources");
            for (int i = 0; a != null && i < a.length(); i++) {
                PhoneIdeasNet.Source s = PhoneIdeasNet.Source.from(a.getJSONObject(i));
                if (s.bookmark != null && !s.used.contains(s.bookmark)) out.add(s);
            }
            return out;
        }
        if (key.startsWith("search:")) return List.of(new PhoneIdeasNet.Source("search", key.substring(7)));
        if (key.startsWith("pin:")) return List.of(new PhoneIdeasNet.Source("related", key.substring(4)));
        JSONObject library = new JSONObject(lib.stateJson());
        String boardName = null;
        if (!"all".equals(key)) {
            JSONArray boards = library.optJSONArray("boards");
            for (int i = 0; boards != null && i < boards.length(); i++) if (key.equals(boards.getJSONObject(i).optString("id"))) boardName = boards.getJSONObject(i).optString("name", "");
        }
        List<JSONObject> items = recentItems(library, key);
        List<PhoneIdeasNet.Source> out = new ArrayList<>();
        Set<String> seenIds = new HashSet<>(), seenQueries = new HashSet<>();
        for (JSONObject item : items) {
            String pin = pinId(item.optString("source", ""));
            if (pin != null && seenIds.add(pin) && out.size() < 3) out.add(new PhoneIdeasNet.Source("related", pin));
        }
        for (JSONObject item : items) {
            String query = words(item, boardName);
            if (!query.isEmpty() && seenQueries.add(query.toLowerCase(Locale.ROOT)) && out.size() < 6) out.add(new PhoneIdeasNet.Source("search", query));
        }
        if (out.isEmpty()) out.add(new PhoneIdeasNet.Source("search", "aesthetic mood board"));
        return out;
    }

    private static final class Result {
        final PhoneIdeasNet.Source source; final PhoneIdeasNet.Page page;
        Result(PhoneIdeasNet.Source source, PhoneIdeasNet.Page page) { this.source = source; this.page = page; }
    }

    private static void updateSource(PhoneIdeasNet.Source source, PhoneIdeasNet.Page page) {
        if (source.bookmark != null) source.used.add(source.bookmark);
        source.bookmark = page.bookmark;
        if (source.bookmark != null && source.used.contains(source.bookmark)) source.bookmark = null;
    }

    private void addPin(JSONObject pin, List<JSONObject> out, Set<String> ids, Set<String> sigs, Set<String> hidden, Set<String> saved) {
        String id = pin.optString("id"), sig = pin.optString("sig");
        if (hidden.contains(id) || saved.contains(id) || !ids.add(id) || !sigs.add(sig)) return;
        out.add(pin);
    }

    private void addPins(JSONArray pins, List<JSONObject> out, Set<String> ids, Set<String> sigs, boolean keepHidden, Set<String> hidden) {
        for (int i = 0; pins != null && i < pins.length(); i++) {
            JSONObject pin = pins.optJSONObject(i);
            if (pin == null) continue;
            String id = pin.optString("id"), sig = pin.optString("sig");
            if ((!keepHidden && hidden.contains(id)) || !ids.add(id) || !sigs.add(sig)) continue;
            out.add(pin);
        }
    }

    // With the picture model: pins in order of how much they look like your pictures (the whole library for For you, a
    // board's own for its Ideas, the pin itself for More like this; a search keeps Pinterest's order) and your saves,
    // turned-down look-alikes left out (PhoneVision).
    private List<JSONObject> byLook(List<JSONObject> pins, String key, JSONObject taste) {
        if (!vision.available()) return pins;
        List<float[]> mine = new ArrayList<>();
        if ("all".equals(key)) mine = vision.library(null);
        else if (key.startsWith("pin:")) { try { JSONObject seed = findPinById(key.substring(4)); float[] v = seed == null ? null : vision.pin(seed.optString("sig")); if (v != null) mine.add(v); } catch (Exception ignored) { } }
        else if (!key.startsWith("search:")) mine = vision.library(key);
        return vision.rank(pins, mine, vision.pins(taste.optJSONArray("liked")), vision.pins(taste.optJSONArray("disliked")), taste);
    }

    private void rank(List<JSONObject> pins, String key, boolean more) {
        final String want = key.startsWith("search:") ? key.substring(7) : key.startsWith("pin:") ? "" : key.equals("all") ? "aesthetic mood board" : boardName(key);
        final String[] words = want.toLowerCase(Locale.ROOT).split("\\W+");
        // (For you keeps the sources' turns: its words are only a fallback search, and sorting by them would pull one
        // source's pins back together at the top.)
        if (!key.equals("all")) pins.sort((a, b) -> Integer.compare(score(b, words), score(a, words)));
        if (!more && pins.size() > BATCH && !key.startsWith("search:") && !key.startsWith("pin:")) pins.subList(BATCH, pins.size()).clear();
    }

    private static int score(JSONObject pin, String[] words) {
        String title = pin.optString("title", "").toLowerCase(Locale.ROOT); int score = 0;
        for (String word : words) if (word.length() > 2 && title.contains(word)) score += 2;
        return score;
    }

    private synchronized JSONObject response(String key, String error) {
        try {
            JSONObject out = new JSONObject().put("feeds", new JSONObject());
            JSONObject direct = readState(), merged = mergedFeeds(direct), feeds = out.getJSONObject("feeds");
            Set<String> hidden = hiddenIds(), saved = savedIds();
            for (Iterator<String> i = merged.keys(); i.hasNext(); ) {
                String k = i.next(); if (!validKey(k)) continue;
                JSONObject f = merged.getJSONObject(k), copy = new JSONObject().put("at", f.optLong("at", 0)).put("signedIn", f.has("signedIn") ? f.get("signedIn") : JSONObject.NULL)
                    .put("error", f.has("error") ? f.get("error") : JSONObject.NULL).put("more", f.optBoolean("more", false)).put("pins", outputPins(f.optJSONArray("pins"), hidden, saved));
                feeds.put(k, copy);
            }
            if (key != null) out.put("key", key);
            if (error != null && !error.isEmpty()) out.put("error", error);
            return out;
        } catch (Exception e) {
            JSONObject fallback = new JSONObject();
            try { fallback.put("feeds", new JSONObject()).put("key", key == null ? JSONObject.NULL : key).put("error", "Ideas are unavailable right now."); } catch (Exception ignored) { }
            return fallback;
        }
    }

    private JSONObject mergedFeeds(JSONObject state) throws Exception {
        JSONObject direct = allDirectFeeds(state), pcFeeds = new JSONObject();
        try { pcFeeds = new JSONObject(pc.feedJson()).optJSONObject("feeds"); if (pcFeeds == null) pcFeeds = new JSONObject(); } catch (Exception ignored) { }
        JSONObject out = new JSONObject();
        for (Iterator<String> i = pcFeeds.keys(); i.hasNext(); ) { String k = i.next(); if (validKey(k)) out.put(k, pcFeeds.getJSONObject(k)); }
        for (Iterator<String> i = direct.keys(); i.hasNext(); ) {
            String k = i.next(); if (!validKey(k)) continue;
            JSONObject mine = direct.getJSONObject(k), theirs = out.optJSONObject(k);
            JSONArray minePins = mine.optJSONArray("pins");
            if (theirs == null || minePins != null && minePins.length() > 0 || !mine.optBoolean("offline", false)) {
                // Once a native feed has a result (including a healthy exhausted empty result), it
                // owns its pagination and error metadata. PC refreshes cannot re-enable old pages.
                out.put(k, new JSONObject(mine.toString()));
            } else {
                // A failed first native fetch may still show the last PC cache, but keeps the phone's
                // error so the user knows why it is stale.
                JSONObject fallback = new JSONObject(theirs.toString());
                if (mine.has("error")) fallback.put("error", mine.get("error"));
                out.put(k, fallback);
            }
        }
        return out;
    }

    private JSONArray outputPins(JSONArray input, Set<String> hidden, Set<String> saved) throws Exception {
        JSONArray out = new JSONArray();
        for (int i = 0; input != null && i < input.length(); i++) {
            JSONObject pin = input.optJSONObject(i); if (pin == null || hidden.contains(pin.optString("id"))) continue;
            JSONObject p = new JSONObject().put("id", pin.optString("id")).put("url", pin.optString("url")).put("title", pin.optString("title"))
                .put("w", pin.optInt("w", 474)).put("h", pin.optInt("h", 600)).put("video", pin.optBoolean("video", false))
                .put("sig", pin.optString("sig")).put("saved", saved.contains(pin.optString("id")));
            out.put(p);
        }
        return out;
    }

    private synchronized JSONObject readState() {
        try (InputStream in = new FileInputStream(stateFile)) {
            byte[] bytes = new byte[(int) Math.min(Integer.MAX_VALUE, stateFile.length())]; int off = 0, n;
            while (off < bytes.length && (n = in.read(bytes, off, bytes.length - off)) > 0) off += n;
            JSONObject state = new JSONObject(new String(bytes, 0, off, StandardCharsets.UTF_8));
            if (state.optInt("v", 1) == 1) return state;
        } catch (Exception ignored) { }
        JSONObject empty = new JSONObject();
        try { empty.put("v", 1).put("feeds", new JSONObject()).put("hidden", new JSONArray()); } catch (Exception ignored) { }
        return empty;
    }

    private synchronized void writeState(JSONObject state) throws IOException {
        File parent = stateFile.getParentFile(); if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Couldn't create the Ideas folder.");
        File tmp = new File(stateFile.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(state.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
        if (!tmp.renameTo(stateFile)) throw new IOException("Couldn't save Ideas.");
    }

    private JSONObject stateWithFeed(String key, JSONObject feed) throws Exception {
        JSONObject state = readState(), feeds = state.optJSONObject("feeds"); if (feeds == null) feeds = new JSONObject();
        feeds.put(key, diskFeed(feed)); state.put("feeds", feeds); return state;
    }

    private static JSONObject diskFeed(JSONObject f) throws Exception {
        JSONObject out = new JSONObject(f.toString());
        JSONArray pins = out.optJSONArray("pins") == null ? new JSONArray() : out.optJSONArray("pins");
        if (pins.length() > DISK_PINS) { JSONArray tail = new JSONArray(); for (int i = pins.length() - DISK_PINS; i < pins.length(); i++) tail.put(pins.get(i)); out.put("pins", tail); }
        return out;
    }

    private synchronized JSONObject feed(JSONObject state, String key) {
        JSONObject live = sessionFeeds.get(key); if (live != null) return live;
        JSONObject fs = state.optJSONObject("feeds"); JSONObject f = fs == null ? null : fs.optJSONObject(key);
        if (f != null) return f;
        JSONObject empty = new JSONObject();
        try { empty.put("at", 0).put("pins", new JSONArray()).put("sources", new JSONArray()).put("more", false).put("error", JSONObject.NULL); } catch (Exception ignored) { }
        return empty;
    }

    private synchronized JSONObject allDirectFeeds(JSONObject state) {
        JSONObject out = new JSONObject(), fs = state.optJSONObject("feeds");
        try {
            if (fs != null) for (Iterator<String> i = fs.keys(); i.hasNext(); ) { String k = i.next(); out.put(k, fs.optJSONObject(k)); }
            for (Map.Entry<String, JSONObject> e : sessionFeeds.entrySet()) out.put(e.getKey(), e.getValue());
        } catch (Exception ignored) { }
        return out;
    }

    private JSONArray sourcesJson(List<PhoneIdeasNet.Source> sources) throws Exception { JSONArray a = new JSONArray(); for (PhoneIdeasNet.Source s : sources) a.put(s.json()); return a; }
    private boolean hasMore(List<PhoneIdeasNet.Source> sources) { for (PhoneIdeasNet.Source s : sources) if (s.bookmark != null && !s.used.contains(s.bookmark)) return true; return false; }

    private synchronized Set<String> hiddenIds() throws Exception { Set<String> out = new HashSet<>(); JSONArray a = readState().optJSONArray("hidden"); for (int i = 0; a != null && i < a.length(); i++) out.add(a.optString(i)); return out; }
    private synchronized boolean isHidden(String id) { try { return hiddenIds().contains(id); } catch (Exception e) { return false; } }
    private synchronized Set<String> savedIds() { Set<String> out = new HashSet<>(); try { JSONArray a = new JSONObject(lib.stateJson()).optJSONArray("items"); for (int i = 0; a != null && i < a.length(); i++) { JSONObject it = a.optJSONObject(i); String id = pinId(it == null ? "" : it.optString("source", "")); if (id != null && (it == null || it.isNull("deletedAt"))) out.add(id); } } catch (Exception ignored) { } return out; }

    private synchronized JSONObject findPin(String sig) throws Exception {
        JSONObject direct = allDirectFeeds(readState());
        for (Iterator<String> i = direct.keys(); i.hasNext(); ) { JSONArray pins = direct.getJSONObject(i.next()).optJSONArray("pins"); for (int n = 0; pins != null && n < pins.length(); n++) if (sig.equals(pins.optJSONObject(n).optString("sig"))) return pins.optJSONObject(n); }
        return null;
    }

    private void prefetch(JSONObject f) { imageWorker.execute(() -> { JSONArray pins = f.optJSONArray("pins"); for (int i = 0; pins != null && i < Math.min(6, pins.length()); i++) feedImage(pins.optJSONObject(i).optString("sig")); }); }
    private File cachedImage(String sig) { for (String ext : new String[]{".jpg", ".jpeg", ".png", ".webp", ".gif"}) { File f = new File(imageDir, sig + ext); if (f.isFile()) return f; } return null; }
    private String titleFor(String id) throws Exception { JSONObject p = findPinById(id); String title = p == null ? "Pinterest pin " + id : p.optString("title", "Pinterest pin " + id); title = title.replaceAll("[\\r\\n]+", " ").trim(); return title.isEmpty() ? "Pinterest pin " + id : title.substring(0, Math.min(120, title.length())); }
    private synchronized JSONObject findPinById(String id) throws Exception { JSONObject fs = mergedFeeds(readState()); for (Iterator<String> i = fs.keys(); i.hasNext(); ) { JSONArray p = fs.getJSONObject(i.next()).optJSONArray("pins"); for (int n = 0; p != null && n < p.length(); n++) if (id.equals(p.optJSONObject(n).optString("id"))) return p.optJSONObject(n); } return null; }

    private String validBoard(String id) { if (id == null || id.isEmpty()) return null; try { JSONArray b = new JSONObject(lib.stateJson()).optJSONArray("boards"); for (int i = 0; b != null && i < b.length(); i++) if (id.equals(b.getJSONObject(i).optString("id"))) return id; } catch (Exception ignored) { } return null; }
    private String boardName(String id) { try { JSONArray b = new JSONObject(lib.stateJson()).optJSONArray("boards"); for (int i = 0; b != null && i < b.length(); i++) if (id.equals(b.getJSONObject(i).optString("id"))) return b.getJSONObject(i).optString("name", ""); } catch (Exception ignored) { } return ""; }
    private boolean validKey(String key) { return key != null && ("all".equals(key) || validBoard(key) != null || key.matches("search:.{1,120}") || key.matches("pin:\\d{1,25}")); }
    private String normaliseKey(String raw) { String key = raw == null ? "all" : raw.trim(); if (key.isEmpty()) return "all"; if (key.startsWith("search:")) { String q = key.substring(7).trim(); if (q.isEmpty()) return null; return "search:" + q.substring(0, Math.min(120, q.length())); } return validKey(key) ? key : null; }

    private List<JSONObject> recentItems(JSONObject library, String key) throws Exception {
        List<JSONObject> out = new ArrayList<>(); JSONArray items = library.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) { JSONObject it = items.optJSONObject(i); if (it == null || !it.isNull("deletedAt") || "note".equals(it.optString("kind"))) continue; if (!"all".equals(key) && !hasBoard(it.optJSONArray("boards"), key)) continue; out.add(it); }
        out.sort((a, b) -> b.optString("importedAt", "").compareTo(a.optString("importedAt", "")));
        return out;
    }
    private static boolean hasBoard(JSONArray boards, String id) { for (int i = 0; boards != null && i < boards.length(); i++) if (id.equals(boards.optString(i))) return true; return false; }
    private static String pinId(String source) { Matcher m = PIN_URL.matcher(source == null ? "" : source.trim()); return m.matches() ? m.group(1) : null; }
    private static String words(JSONObject item, String board) {
        List<String> bits = new ArrayList<>(); if (board != null && !board.trim().isEmpty()) bits.add(board.trim());
        String title = item.optString("title", ""); if (!title.isEmpty()) bits.add(title);
        JSONObject labels = item.optJSONObject("labels"); if (labels != null) { bits.add(labels.optString("main", "")); bits.add(labels.optString("styles", "")); bits.add(labels.optString("colours", "")); }
        String q = String.join(" ", bits).replaceAll("[^A-Za-z0-9 ]", " ").replaceAll("\\s+", " ").trim(); return q.substring(0, Math.min(120, q.length()));
    }
    private static String extension(String mime, boolean video) { String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT); if (m.contains("webm")) return ".webm"; if (m.contains("quicktime") || m.contains("mov")) return ".mov"; if (m.contains("png")) return ".png"; if (m.contains("webp")) return ".webp"; return video ? ".mp4" : ".jpg"; }
    private static String friendly(Exception e) { String m = e.getMessage(); return m == null || m.isEmpty() ? "Something went wrong while finding ideas. Try again." : m; }
    private static void removePin(JSONObject f, String id) { if (f == null) return; try { JSONArray old = f.optJSONArray("pins"), next = new JSONArray(); for (int i = 0; old != null && i < old.length(); i++) if (!id.equals(old.optJSONObject(i).optString("id"))) next.put(old.opt(i)); f.put("pins", next); } catch (Exception ignored) { } }
}
