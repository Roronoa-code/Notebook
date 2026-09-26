package com.mani.notebook;

import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

// The small, signed-out Pinterest client used by phone Ideas. WebView never sees these URLs.
final class PhoneIdeasNet {
    static final String BASE = "https://www.pinterest.com";
    static final int CONNECT_MS = 5000, JSON_TIMEOUT_MS = 20000, MEDIA_TIMEOUT_MS = 60000;
    static final int MAX_JSON = 4 * 1024 * 1024, MAX_IMAGE = 16 * 1024 * 1024, MAX_VIDEO = 256 * 1024 * 1024;
    private static final Pattern ID = Pattern.compile("\\d{1,25}");
    private static final Pattern SIG = Pattern.compile("(?:^|/)([0-9a-f]{32})\\.[a-z0-9]+(?:[?#]|$)", Pattern.CASE_INSENSITIVE);

    static final class Source {
        final String kind, arg;
        String bookmark;
        final Set<String> used = new HashSet<>();
        Source(String kind, String arg) { this.kind = kind; this.arg = arg; }
        String sourceUrl() {
            if ("related".equals(kind)) return "/pin/" + arg + "/";
            return "/search/pins/?q=" + encode(arg) + "&rs=typed";
        }
        JSONObject json() throws Exception {
            JSONObject o = new JSONObject().put("kind", kind).put("arg", arg);
            if (bookmark != null) o.put("bookmark", bookmark);
            JSONArray usedBookmarks = new JSONArray();
            for (String value : used) usedBookmarks.put(value);
            o.put("used", usedBookmarks);
            return o;
        }
        static Source from(JSONObject o) {
            String kind = o.optString("kind", "search"), arg = o.optString("arg", "");
            Source s = new Source(kind, arg);
            String b = o.isNull("bookmark") ? "" : o.optString("bookmark", "");
            s.bookmark = b.isEmpty() ? null : b;
            JSONArray used = o.optJSONArray("used");
            for (int i = 0; used != null && i < used.length(); i++) if (!used.optString(i).isEmpty()) s.used.add(used.optString(i));
            return s;
        }
    }

    static final class Page {
        final List<JSONObject> pins;
        final String bookmark;
        final boolean signedOut;
        Page(List<JSONObject> pins, String bookmark, boolean signedOut) { this.pins = pins; this.bookmark = bookmark; this.signedOut = signedOut; }
    }

    static final class Media {
        final String url;
        final boolean video;
        final String mime;
        Media(String url, boolean video, String mime) { this.url = url; this.video = video; this.mime = mime; }
    }

    static final class Download {
        final String mime;
        final long bytes;
        Download(String mime, long bytes) { this.mime = mime; this.bytes = bytes; }
    }

    private PhoneIdeasNet() {}

    static Page page(Source source) throws IOException {
        try {
        if (!("related".equals(source.kind) || "search".equals(source.kind))) throw new IOException("Pinterest home feeds need a Pinterest sign-in.");
        JSONObject options = new JSONObject();
        JSONArray bookmarks = new JSONArray();
        if (source.bookmark != null && !source.bookmark.isEmpty()) bookmarks.put(source.bookmark);
        options.put("bookmarks", bookmarks);
        String resource;
        if ("related".equals(source.kind)) {
            options.put("pin_id", source.arg).put("context_pin_ids", new JSONArray()).put("search_query", "")
                .put("source", "deep_linking").put("top_level_source", "deep_linking").put("top_level_source_depth", 1)
                .put("is_pdp", false).put("page_size", 25);
            resource = "RelatedModulesResource";
        } else {
            options.put("query", source.arg).put("scope", "pins").put("page_size", 25);
            resource = "BaseSearchResource";
        }
        String request = BASE + "/resource/" + resource + "/get/?source_url=" + encode(source.sourceUrl())
            + "&data=" + encode(new JSONObject().put("options", options).put("context", new JSONObject()).toString());
        String body = getText(request);
        return parsePage(body);
        } catch (IOException e) { throw e; }
        catch (Exception e) { throw new IOException("Couldn't ask Pinterest for Ideas.", e); }
    }

    static Page parsePage(String body) throws IOException {
        try {
            JSONObject root = new JSONObject(body), response = root.optJSONObject("resource_response");
            if (response == null) throw new IOException("Pinterest changed its Ideas response.");
            List<JSONObject> found = new ArrayList<>();
            collectPins(response.opt("data"), found, 0);
            List<JSONObject> pins = new ArrayList<>();
            Set<String> ids = new HashSet<>(), sigs = new HashSet<>();
            for (JSONObject raw : found) {
                JSONObject pin = pinFrom(raw);
                if (pin == null || !ids.add(pin.optString("id")) || !sigs.add(pin.optString("sig"))) continue;
                pins.add(pin);
            }
            String bookmark = response.isNull("bookmark") ? "" : response.optString("bookmark", "");
            if (bookmark.isEmpty() || "-end-".equals(bookmark)) bookmark = null;
            return new Page(pins, bookmark, response.optBoolean("signed_out", false));
        } catch (IOException e) { throw e; }
        catch (Exception e) { throw new IOException("Pinterest sent an unreadable Ideas response.", e); }
    }

    static Media parseMedia(String body, String expectedId) throws IOException {
        try {
            JSONObject root = new JSONObject(body), response = root.optJSONObject("resource_response");
            if (response == null) throw new IOException("Pinterest did not return pin data.");
            JSONObject pin = findPin(response.opt("data"), expectedId, 0);
            if (pin == null) pin = response.optJSONObject("data");
            Media media = pin == null ? null : mediaFrom(pin, true);
            if (media == null) throw new IOException("This pin has no supported photo or video to save.");
            return media;
        } catch (IOException e) { throw e; }
        catch (Exception e) { throw new IOException("Pinterest sent unreadable pin data.", e); }
    }

    static String pinDataUrl(String id) {
        try {
            return BASE + "/resource/PinResource/get/?source_url=" + encode("/pin/" + id + "/")
                + "&data=" + encode(new JSONObject().put("options", new JSONObject().put("id", id)).put("context", new JSONObject()).toString());
        } catch (Exception e) { return BASE + "/pin/" + id + "/"; }
    }

    static String json(String url) throws IOException { return getText(url); }

    static boolean allowedUrl(String raw) {
        try {
            URI u = new URI(raw);
            if (!"https".equalsIgnoreCase(u.getScheme()) || u.getUserInfo() != null || u.getHost() == null) return false;
            String h = u.getHost().toLowerCase(Locale.ROOT);
            return "www.pinterest.com".equals(h) || "pinterest.com".equals(h) || "i.pinimg.com".equals(h)
                || "v1.pinimg.com".equals(h) || "v2.pinimg.com".equals(h);
        } catch (Exception e) { return false; }
    }

    static String signature(String raw) {
        Matcher m = SIG.matcher(raw == null ? "" : raw);
        if (m.find()) return m.group(1).toLowerCase(Locale.ROOT);
        try {
            byte[] digest = MessageDigest.getInstance("MD5").digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(32);
            for (byte b : digest) out.append(String.format(Locale.ROOT, "%02x", b & 255));
            return out.toString();
        } catch (Exception e) { return null; }
    }

    static Download download(String rawUrl, File dest, long maxBytes, boolean video) throws IOException {
        if (!allowedUrl(rawUrl)) throw new IOException("Pinterest returned a media address Notebook cannot safely use.");
        String current = rawUrl;
        for (int hop = 0; hop < 4; hop++) {
            HttpsURLConnection c = open(current, MEDIA_TIMEOUT_MS);
            try {
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = c.getHeaderField("Location");
                    if (next == null) throw new IOException("Pinterest returned an incomplete media redirect.");
                    current = new URL(new URL(current), next).toString();
                    if (!allowedUrl(current)) throw new IOException("Pinterest redirected to an unapproved media address.");
                    continue;
                }
                if (code < 200 || code >= 300) throw new IOException("Pinterest could not provide that media (" + code + ").");
                long declared = c.getContentLengthLong();
                if (declared > maxBytes) throw new IOException(video ? "That video is too large for the phone library." : "That picture is too large for the phone library.");
                String mime = c.getContentType();
                if (!supportedMime(mime, current, video)) throw new IOException(video ? "This pin's video format is not supported." : "This pin's picture format is not supported.");
                File parent = dest.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Couldn't create the Ideas download folder.");
                long got = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(dest)) {
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) > 0) {
                        got += n;
                        if (got > maxBytes) throw new IOException(video ? "That video is too large for the phone library." : "That picture is too large for the phone library.");
                        out.write(buffer, 0, n);
                    }
                    out.getFD().sync();
                }
                if (got == 0) throw new IOException("Pinterest returned an empty media file.");
                if (declared >= 0 && declared != got) throw new IOException("Pinterest media was truncated. Try again.");
                if (!validMediaFile(dest, video)) throw new IOException(video ? "Pinterest returned an invalid video file." : "Pinterest returned an invalid picture file.");
                String cleanMime = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                if (cleanMime.isEmpty() || "application/octet-stream".equals(cleanMime) || "binary/octet-stream".equals(cleanMime)) cleanMime = mimeFromUrl(current, video ? "video/mp4" : "image/jpeg");
                return new Download(cleanMime, got);
            } finally { c.disconnect(); }
        }
        throw new IOException("Pinterest redirected too many times.");
    }

    private static String getText(String rawUrl) throws IOException {
        if (!allowedUrl(rawUrl)) throw new IOException("Pinterest returned an unapproved address.");
        String current = rawUrl;
        for (int hop = 0; hop < 4; hop++) {
            HttpsURLConnection c = open(current, JSON_TIMEOUT_MS);
            try {
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = c.getHeaderField("Location");
                    if (next == null) throw new IOException("Pinterest returned an incomplete redirect.");
                    current = new URL(new URL(current), next).toString();
                    if (!allowedUrl(current)) throw new IOException("Pinterest redirected to an unapproved address.");
                    continue;
                }
                if (code == 401) return "{\"resource_response\":{\"data\":[],\"bookmark\":null,\"signed_out\":true}}";
                if (code == 429) throw new IOException("Pinterest asked Notebook to slow down. Try again in a few minutes.");
                if (code < 200 || code >= 300) throw new IOException("Pinterest is not answering properly just now (" + code + ").");
                long declared = c.getContentLengthLong();
                if (declared > MAX_JSON) throw new IOException("Pinterest sent an Ideas response that was too large.");
                try (InputStream in = c.getInputStream()) { return readLimited(in, MAX_JSON); }
            } finally { c.disconnect(); }
        }
        throw new IOException("Pinterest redirected too many times.");
    }

    private static HttpsURLConnection open(String rawUrl, int timeout) throws IOException {
        if (!allowedUrl(rawUrl)) throw new IOException("Pinterest returned an unapproved address.");
        HttpsURLConnection c = (HttpsURLConnection) new URL(rawUrl).openConnection();
        c.setConnectTimeout(CONNECT_MS);
        c.setReadTimeout(timeout);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        c.setRequestProperty("X-Pinterest-PWS-Handler", "www/index.js");
        return c;
    }

    static boolean supportedMime(String mime, String url, boolean video) {
        String m = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        String u = url.toLowerCase(Locale.ROOT);
        boolean unknown = m.isEmpty() || "application/octet-stream".equals(m) || "binary/octet-stream".equals(m);
        if (video) return unknown ? u.matches(".*\\.(mp4|m4v|webm|mov)(?:[?#].*)?$") : m.startsWith("video/");
        return unknown ? u.matches(".*\\.(jpe?g|png|webp|gif)(?:[?#].*)?$") : m.startsWith("image/");
    }

    private static void collectPins(Object value, List<JSONObject> out, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 10) return;
        if (value instanceof JSONArray) {
            JSONArray a = (JSONArray) value;
            for (int i = 0; i < a.length(); i++) collectPins(a.opt(i), out, depth + 1);
        } else if (value instanceof JSONObject) {
            JSONObject o = (JSONObject) value;
            if (o.has("id") && o.has("images")) out.add(o);
            for (Iterator<String> i = o.keys(); i.hasNext(); ) collectPins(o.opt(i.next()), out, depth + 1);
        }
    }

    private static JSONObject findPin(Object value, String id, int depth) {
        if (value == null || value == JSONObject.NULL || depth > 10) return null;
        if (value instanceof JSONArray) {
            JSONArray a = (JSONArray) value;
            for (int i = 0; i < a.length(); i++) { JSONObject found = findPin(a.opt(i), id, depth + 1); if (found != null) return found; }
        } else if (value instanceof JSONObject) {
            JSONObject o = (JSONObject) value;
            if (id.equals(o.optString("id")) && (o.has("images") || o.has("videos") || o.has("story_pin_data"))) return o;
            for (Iterator<String> i = o.keys(); i.hasNext(); ) { JSONObject found = findPin(o.opt(i.next()), id, depth + 1); if (found != null) return found; }
        }
        return null;
    }

    private static JSONObject pinFrom(JSONObject raw) {
        String id = raw.optString("id", "");
        if (!ID.matcher(id).matches() || isAd(raw)) return null;
        JSONObject images = raw.optJSONObject("images");
        JSONObject big = bestImage(images, true), small = bestImage(images, false);
        if (big == null || small == null) return null;
        String image = big.optString("url", ""), thumb = small.optString("url", "");
        if (!allowedUrl(image) || !allowedUrl(thumb) || !image.toLowerCase(Locale.ROOT).contains("pinimg.com") || !thumb.toLowerCase(Locale.ROOT).contains("pinimg.com")) return null;
        JSONObject out = new JSONObject();
        try {
            out.put("id", id).put("url", BASE + "/pin/" + id + "/").put("title", clean(raw.optString("grid_title", raw.optString("title", raw.optString("description", "")))))
                .put("img", image).put("small", thumb).put("w", Math.max(1, big.optInt("width", 474))).put("h", Math.max(1, big.optInt("height", 600)))
                .put("video", hasVideo(raw)).put("sig", signature(image));
            return out;
        } catch (Exception e) { return null; }
    }

    private static Media mediaFrom(JSONObject pin, boolean original) {
        String video = videoUrl(pin, 0);
        if (hasVideo(pin)) return video != null && allowedUrl(video) ? new Media(video, true, mimeFromUrl(video, "video/mp4")) : null;
        JSONObject image = bestImage(pin.optJSONObject("images"), original);
        String url = image == null ? null : image.optString("url", null);
        return url != null && allowedUrl(url) ? new Media(url, false, mimeFromUrl(url, "image/jpeg")) : null;
    }

    private static JSONObject bestImage(JSONObject images, boolean big) {
        if (images == null) return null;
        JSONObject preferred = null;
        for (String key : new String[]{"orig", "originals", "736x", "564x", "474x", "236x"}) {
            JSONObject image = images.optJSONObject(key);
            if (image == null || !allowedUrl(image.optString("url", ""))) continue;
            if (!big && "236x".equals(key)) return image;
            if (preferred == null || image.optInt("width", 0) > preferred.optInt("width", 0)) preferred = image;
        }
        return preferred;
    }

    private static String videoUrl(JSONObject value, int depth) {
        if (value == null || depth > 8) return null;
        JSONObject list = value.optJSONObject("video_list");
        if (list != null) {
            String best = null; int width = -1;
            for (Iterator<String> i = list.keys(); i.hasNext(); ) {
                JSONObject v = list.optJSONObject(i.next());
                String u = v == null ? null : v.optString("url", null);
                if (u != null && directVideoUrl(u) && v.optInt("width", 0) >= width) { best = u; width = v.optInt("width", 0); }
            }
            if (best != null) return best;
        }
        for (Iterator<String> i = value.keys(); i.hasNext(); ) {
            Object child = value.opt(i.next());
            if (child instanceof JSONObject) { String found = videoUrl((JSONObject) child, depth + 1); if (found != null) return found; }
            if (child instanceof JSONArray) { JSONArray a = (JSONArray) child; for (int n = 0; n < a.length(); n++) { Object x = a.opt(n); if (x instanceof JSONObject) { String found = videoUrl((JSONObject) x, depth + 1); if (found != null) return found; } } }
        }
        return null;
    }

    private static boolean hasVideo(JSONObject value) {
        if (videoUrl(value, 0) != null) return true;
        Object videos = value.opt("videos"), story = value.opt("story_pin_data");
        return (videos instanceof JSONObject && videos != JSONObject.NULL) || (story instanceof JSONObject && story.toString().contains("video_list"));
    }
    private static boolean isAd(JSONObject o) { return o.optBoolean("is_promoted", false) || o.optBoolean("is_promoted_pin", false) || o.optBoolean("promoted", false) || o.has("ad_data") || "promoted".equalsIgnoreCase(o.optString("type")); }
    private static String clean(String s) { return s == null ? "" : s.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim().substring(0, Math.min(240, s.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim().length())); }
    private static boolean directVideoUrl(String url) { return allowedUrl(url) && url.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|m4v|webm|mov)(?:[?#].*)?$"); }
    private static String mimeFromUrl(String url, String fallback) { String u = url.toLowerCase(Locale.ROOT); if (u.contains(".webm")) return "video/webm"; if (u.contains(".mov")) return "video/quicktime"; if (u.contains(".png")) return "image/png"; if (u.contains(".webp")) return "image/webp"; return fallback; }

    static boolean validMediaFile(File file, boolean video) {
        try (InputStream in = new java.io.FileInputStream(file)) {
            byte[] b = new byte[32]; int n = 0, k;
            while (n < b.length && (k = in.read(b, n, b.length - n)) > 0) n += k;
            if (video) {
                boolean ftyp = n >= 8 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p';
                boolean webm = n >= 4 && (b[0] & 255) == 0x1A && (b[1] & 255) == 0x45 && (b[2] & 255) == 0xDF && (b[3] & 255) == 0xA3;
                return (ftyp || webm) && readableVideo(file);
            }
            boolean jpg = n >= 3 && (b[0] & 255) == 0xFF && (b[1] & 255) == 0xD8 && (b[2] & 255) == 0xFF && tail(file, new byte[]{(byte) 0xFF, (byte) 0xD9});
            boolean png = n >= 8 && (b[0] & 255) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' && tail(file, new byte[]{0x49, 0x45, 0x4E, 0x44, (byte) 0xAE, 0x42, 0x60, (byte) 0x82});
            boolean gif = n >= 4 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8' && tail(file, new byte[]{0x3B});
            boolean webp = n >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P';
            return (jpg || png || gif || webp) && readableImage(file);
        } catch (Exception e) { return false; }
    }

    // Bounds-only decode verifies an actual image without allocating its full pixels.
    private static boolean readableImage(File file) {
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), options);
            return options.outWidth > 0 && options.outHeight > 0;
        } catch (Exception e) {
            return false;
        }
    }

    // Container magic is only a cheap first check. MediaMetadataRetriever makes sure a
    // truncated challenge/body cannot be reported as a successful video save.
    private static boolean readableVideo(File file) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String hasVideo = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO);
            int width = parseMetadataInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            int height = parseMetadataInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            return "yes".equalsIgnoreCase(hasVideo) && width > 0 && height > 0;
        } catch (Exception e) {
            return false;
        } finally {
            try { retriever.release(); } catch (Exception ignored) { }
        }
    }

    private static int parseMetadataInt(String value) {
        try { return Integer.parseInt(value == null ? "" : value); }
        catch (Exception ignored) { return 0; }
    }

    private static boolean tail(File file, byte[] wanted) {
        try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
            if (in.length() < wanted.length) return false;
            in.seek(in.length() - wanted.length);
            for (byte b : wanted) if (in.read() != (b & 255)) return false;
            return true;
        } catch (Exception e) { return false; }
    }
    private static String encode(String s) { try { return URLEncoder.encode(s, StandardCharsets.UTF_8.name()); } catch (Exception e) { return ""; } }

    private static String readLimited(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384]; int n, total = 0;
        while ((n = in.read(buffer)) > 0) { total += n; if (total > max) throw new IOException("Pinterest sent an Ideas response that was too large."); out.write(buffer, 0, n); }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
