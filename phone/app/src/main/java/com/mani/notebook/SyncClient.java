package com.mani.notebook;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

// Talks to Notebook on the PC over the home Wi-Fi, following docs/SYNC.md.
public class SyncClient {
    interface Progress { void update(String phase, int done, int total); }

    static final int DISCOVERY_PORT = 47822;
    static final String CANT_FIND = "Can't find your PC. Make sure it's switched on with Notebook running, and that your phone is on the same Wi-Fi.";
    private final Library lib;
    private final SharedPreferences p;
    private final File feedFile, feedDir;

    SyncClient(Context ctx, Library lib) {
        this.lib = lib;
        this.p = ctx.getSharedPreferences("sync", Context.MODE_PRIVATE);
        this.feedFile = new File(ctx.getFilesDir(), "feed.json");
        this.feedDir = new File(ctx.getCacheDir(), "feed");
        if (!p.contains("deviceId")) p.edit().putString("deviceId", UUID.randomUUID().toString()).apply();
    }

    boolean paired() { return p.getString("token", null) != null; }

    JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("paired", paired()).put("pcName", p.getString("pcName", "")).put("lastSync", p.getString("lastSync", ""));
        } catch (Exception ignored) { /* can't happen with plain values */ }
        return o;
    }

    // ---------- pairing (one QR scan, once) ----------

    void pair(String qr) throws Exception {
        Uri u = Uri.parse(qr.trim());
        if (!"notebook".equals(u.getScheme()) || !"pair".equals(u.getHost())) throw new IOException("That isn't a Notebook pairing code. On your PC, open Notebook and choose Phone.");
        String hosts = u.getQueryParameter("h"), code = u.getQueryParameter("c"), pcId = u.getQueryParameter("id");
        int port = parsePort(u.getQueryParameter("p"));
        if (hosts == null || code == null) throw new IOException("That pairing code is incomplete. Show a new one on the PC.");
        JSONObject body = new JSONObject().put("code", code.trim().toUpperCase()).put("deviceId", p.getString("deviceId", "")).put("deviceName", Build.MANUFACTURER.substring(0, 1).toUpperCase() + Build.MANUFACTURER.substring(1) + " " + Build.MODEL);
        IOException last = null;
        for (String host : hosts.split(",")) {
            host = host.trim();
            if (host.isEmpty()) continue;
            try {
                JSONObject res = new JSONObject(request("POST", "http://" + host + ":" + port + "/api/pair", body.toString(), null, 5000));
                p.edit().putString("token", res.getString("token")).putString("pcId", res.optString("pcId", pcId))
                    .putString("pcName", res.optString("pcName", "your PC")).putString("host", host).putInt("port", port).apply();
                return;
            } catch (HttpError e) {
                throw e; // the PC answered (e.g. wrong or expired code): no point trying other addresses
            } catch (IOException e) {
                last = e;
            }
        }
        // None of the addresses answered: look for the PC on the network instead.
        String[] found = discover(pcId);
        if (found != null) {
            JSONObject res = new JSONObject(request("POST", "http://" + found[0] + ":" + found[1] + "/api/pair", body.toString(), null, 5000));
            p.edit().putString("token", res.getString("token")).putString("pcId", res.optString("pcId", pcId))
                .putString("pcName", res.optString("pcName", "your PC")).putString("host", found[0]).putInt("port", Integer.parseInt(found[1])).apply();
            return;
        }
        throw new IOException(CANT_FIND, last);
    }

    void unpair() { p.edit().remove("adopted").remove("token").remove("pcId").remove("pcName").remove("host").remove("port").remove("lastSync").apply(); }

    private static int parsePort(String s) {
        try { return s == null ? 47821 : Integer.parseInt(s); } catch (NumberFormatException e) { return 47821; }
    }

    // ---------- finding the PC ----------

    private String base() throws Exception {
        String host = p.getString("host", null);
        int port = p.getInt("port", 47821);
        if (host != null && ping("http://" + host + ":" + port)) return "http://" + host + ":" + port;
        String[] found = discover(p.getString("pcId", null)); // the PC's address changed (e.g. router restarted)
        if (found != null) {
            p.edit().putString("host", found[0]).putInt("port", Integer.parseInt(found[1])).apply();
            String b = "http://" + found[0] + ":" + found[1];
            if (ping(b)) return b;
        }
        throw new IOException(CANT_FIND);
    }

    private boolean ping(String base) throws IOException {
        try { request("GET", base + "/api/ping", null, p.getString("token", null), 2500); return true; }
        catch (HttpError e) {
            if (e.status == 401) { unpair(); throw new IOException("This phone was unpaired on the PC. Tap Scan code to pair again."); }
            return false;
        }
        catch (Exception e) { return false; }
    }

    // Shout "is Notebook here?" on the Wi-Fi and wait briefly for the PC to answer with its address.
    private String[] discover(String pcId) {
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            s.setSoTimeout(1500);
            byte[] msg = "NOTEBOOK_DISCOVER".getBytes(StandardCharsets.UTF_8);
            s.send(new DatagramPacket(msg, msg.length, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));
            byte[] buf = new byte[2048];
            long end = System.currentTimeMillis() + 1500;
            while (System.currentTimeMillis() < end) {
                DatagramPacket r = new DatagramPacket(buf, buf.length);
                s.receive(r);
                JSONObject o = new JSONObject(new String(r.getData(), 0, r.getLength(), StandardCharsets.UTF_8));
                if (!"Notebook".equals(o.optString("app"))) continue;
                if (pcId != null && !pcId.isEmpty() && !pcId.equals(o.optString("pcId"))) continue;
                return new String[]{r.getAddress().getHostAddress(), String.valueOf(o.optInt("port", 47821))};
            }
        } catch (Exception ignored) { /* nobody answered */ }
        return null;
    }

    // ---------- sync ----------

    void sync(Progress cb) throws Exception {
        if (!paired()) throw new IOException("Pair with your PC first: tap Scan code and scan the code shown in Notebook on the PC.");
        if (!Core.syncLock.tryLock()) return; // a sync is already running
        try {
            if (cb != null) cb.update("connecting", 0, 0);
            String b = base();
            String token = p.getString("token", null);
            if (!p.getBoolean("adopted", false)) {
                // Ask the PC for its boards first (sending nothing changes nothing on the PC), then line ours up with them.
                JSONObject empty = new JSONObject().put("deviceId", p.getString("deviceId", "")).put("boards", new JSONArray()).put("items", new JSONArray())
                    .put("tombstones", new JSONObject().put("items", new JSONArray()).put("boards", new JSONArray()));
                lib.adoptBoards(new JSONObject(request("POST", b + "/api/sync", empty.toString(), token, 30000)).getJSONArray("boards"));
                p.edit().putBoolean("adopted", true).apply();
            }
            lib.dedupeBoards();
            JSONObject body = lib.metadataForSync();
            body.put("deviceId", p.getString("deviceId", ""));
            if (cb != null) cb.update("merging", 0, 0);
            JSONObject res = new JSONObject(request("POST", b + "/api/sync", body.toString(), token, 30000));
            lib.applyMerged(res);

            List<String> missing = lib.missingMedia();
            for (int i = 0; i < missing.size(); i++) {
                if (cb != null) cb.update("downloading", i, missing.size());
                download(b, token, missing.get(i));
            }
            JSONArray needs = res.optJSONArray("pcNeeds");
            int n = needs == null ? 0 : needs.length();
            for (int i = 0; i < n; i++) {
                if (cb != null) cb.update("uploading", i, n);
                upload(b, token, needs.getString(i));
            }
            p.edit().putString("lastSync", Library.now()).apply();
            // Ideas: pins saved or hidden while away go to the PC, then the latest feeds come back.
            try { sendFeedQueue(b, token); refreshFeed(b, token); } catch (Exception ignored) { /* ideas never stop a sync */ }
            if (cb != null) cb.update("done", n + missing.size(), n + missing.size());
        } finally {
            Core.syncLock.unlock();
        }
    }

    private void download(String b, String token, String id) throws Exception {
        String rel = lib.fileOf(id);
        if (rel == null) return;
        File dest = new File(lib.root, rel), tmp = new File(lib.root, rel + ".part");
        HttpURLConnection c = open("GET", b + "/api/media/" + id, token, 60000);
        try {
            if (c.getResponseCode() == 404) return; // the PC doesn't have it either
            check(c);
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[65536];
                int k;
                while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
                out.getFD().sync();
            }
            long expected = c.getContentLengthLong();
            if (expected >= 0 && tmp.length() != expected) { tmp.delete(); throw new IOException("A file didn't download completely. It will be tried again next sync."); }
            if (!tmp.renameTo(dest)) { tmp.delete(); throw new IOException("Couldn't save a downloaded file."); }
            lib.afterDownload(id);
        } finally { c.disconnect(); }
    }

    private void upload(String b, String token, String id) throws Exception {
        String rel = lib.fileOf(id);
        if (rel == null) return;
        File f = new File(lib.root, rel);
        if (!f.exists()) return;
        HttpURLConnection c = open("PUT", b + "/api/media/" + id, token, 120000);
        try {
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(f.length());
            c.setRequestProperty("Content-Type", "application/octet-stream");
            c.setRequestProperty("X-Notebook-Size", String.valueOf(f.length()));
            try (InputStream in = new FileInputStream(f); OutputStream out = c.getOutputStream()) {
                byte[] buf = new byte[65536];
                int k;
                while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
            }
            check(c);
        } finally { c.disconnect(); }
    }

    // ---------- Ideas (the Pinterest-style feed the PC prepares) ----------

    // The feeds as last fetched: { "feeds": { "all": { "pins": [...] }, "<boardId>": {...} }, "fetchedAt": "…" }.
    synchronized String feedJson() {
        try (InputStream in = new FileInputStream(feedFile)) { return readAll(in); } catch (Exception e) { return "{\"feeds\":{}}"; }
    }

    private synchronized void writeFeed(JSONObject o) throws IOException {
        File tmp = new File(feedFile.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(o.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
        if (!tmp.renameTo(feedFile)) throw new IOException("Couldn't save the ideas.");
    }

    // Fetches the feeds now (the Ideas screen asks when they're old). Returns the new feed JSON.
    String refreshFeedNow() throws Exception {
        if (!paired()) throw new IOException("Pair with your PC first, then ideas arrive from it.");
        String b = base(), token = p.getString("token", null);
        sendFeedQueue(b, token);
        refreshFeed(b, token);
        return feedJson();
    }

    private void refreshFeed(String b, String token) throws Exception {
        JSONObject o = new JSONObject(request("GET", b + "/api/feed", null, token, 20000));
        o.put("fetchedAt", Library.now());
        writeFeed(o);
        // The first pictures of each feed are fetched now, so ideas show even away from home.
        java.util.Set<String> keep = new java.util.HashSet<>();
        JSONObject feeds = o.optJSONObject("feeds");
        if (feeds == null) return;
        for (java.util.Iterator<String> k = feeds.keys(); k.hasNext(); ) {
            JSONArray pins = feeds.getJSONObject(k.next()).optJSONArray("pins");
            for (int i = 0; pins != null && i < pins.length(); i++) {
                String sig = pins.getJSONObject(i).optString("sig");
                keep.add(sig);
                if (i < 24) fetchImage(b, token, sig);
            }
        }
        File[] old = feedDir.listFiles();
        if (old != null) for (File f : old) if (!keep.contains(f.getName().replace(".jpg", ""))) f.delete();
    }

    // A pin's picture: from the phone's copy, or fetched from the PC (null when neither works).
    File feedImage(String sig) {
        if (!sig.matches("[0-9a-f]{32}")) return null;
        File f = new File(feedDir, sig + ".jpg");
        if (f.exists()) return f;
        String host = p.getString("host", null), token = p.getString("token", null);
        if (host == null || token == null || System.currentTimeMillis() < feedOfflineUntil) return null;
        try { fetchImage("http://" + host + ":" + p.getInt("port", 47821), token, sig); }
        catch (Exception e) { feedOfflineUntil = System.currentTimeMillis() + 60000; return null; } // away from home: stop trying for a minute
        return f.exists() ? f : null;
    }
    private volatile long feedOfflineUntil = 0;

    private void fetchImage(String b, String token, String sig) throws IOException {
        if (!sig.matches("[0-9a-f]{32}")) return;
        File dest = new File(feedDir, sig + ".jpg");
        if (dest.exists()) return;
        if (!feedDir.isDirectory() && !feedDir.mkdirs()) return;
        File tmp = new File(feedDir, sig + "." + Thread.currentThread().getId() + ".part");
        HttpURLConnection c = open("GET", b + "/api/feed/img/" + sig, token, 15000);
        try {
            if (c.getResponseCode() != 200) return;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[65536];
                int k;
                while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
            }
            if (!tmp.renameTo(dest)) tmp.delete();
        } finally { c.disconnect(); tmp.delete(); }
    }

    // Save or hide a pin ("save" { url, boardId } or "hide" { id }). Sent now if the PC is reachable,
    // otherwise kept and sent with the next sync. The phone's copy of the feed shows it straight away.
    void feedAction(String kind, JSONObject body) throws Exception {
        JSONObject o = new JSONObject(feedJson());
        JSONObject feeds = o.optJSONObject("feeds");
        if (feeds != null) for (java.util.Iterator<String> k = feeds.keys(); k.hasNext(); ) {
            JSONObject f = feeds.getJSONObject(k.next());
            JSONArray pins = f.optJSONArray("pins"), kept = new JSONArray();
            for (int i = 0; pins != null && i < pins.length(); i++) {
                JSONObject pin = pins.getJSONObject(i);
                if (kind.equals("hide") && pin.optString("id").equals(body.optString("id"))) continue;
                if (kind.equals("save") && pin.optString("url").equals(body.optString("url"))) pin.put("saved", true);
                kept.put(pin);
            }
            f.put("pins", kept);
        }
        writeFeed(o);
        synchronized (this) {
            JSONArray q = new JSONArray(p.getString("feedQueue", "[]"));
            q.put(new JSONObject().put("kind", kind).put("body", body));
            p.edit().putString("feedQueue", q.toString()).apply();
        }
        String b = base(); // throws when the PC can't be reached: it stays queued
        sendFeedQueue(b, p.getString("token", null));
    }

    private synchronized void sendFeedQueue(String b, String token) throws Exception {
        JSONArray q = new JSONArray(p.getString("feedQueue", "[]"));
        while (q.length() > 0) {
            JSONObject a = q.getJSONObject(0);
            try { request("POST", b + "/api/feed/" + a.getString("kind"), a.getJSONObject("body").toString(), token, 15000); }
            catch (HttpError e) { /* the PC turned it down (e.g. that pin is gone): drop it */ }
            q.remove(0);
            p.edit().putString("feedQueue", q.toString()).apply();
        }
    }

    // ---------- HTTP ----------

    static class HttpError extends IOException {
        final int status;
        HttpError(int status, String msg) { super(msg); this.status = status; }
    }

    private static HttpURLConnection open(String method, String url, String token, int readTimeout) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(4000);
        c.setReadTimeout(readTimeout);
        c.setInstanceFollowRedirects(false);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        return c;
    }

    private static void check(HttpURLConnection c) throws IOException {
        int code = c.getResponseCode();
        if (code >= 200 && code < 300) return;
        String msg = "The PC replied with an error (" + code + ").";
        try (InputStream err = c.getErrorStream()) {
            if (err != null) msg = new JSONObject(readAll(err)).optString("error", msg);
        } catch (Exception ignored) { /* keep the generic message */ }
        throw new HttpError(code, msg);
    }

    private static String request(String method, String url, String json, String token, int readTimeout) throws IOException {
        HttpURLConnection c = open(method, url, token, readTimeout);
        try {
            if (json != null) {
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(bytes.length);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
            }
            check(c);
            try (InputStream in = c.getInputStream()) { return readAll(in); }
        } finally { c.disconnect(); }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int k;
        while ((k = in.read(buf)) > 0) b.write(buf, 0, k);
        return b.toString("UTF-8");
    }
}
