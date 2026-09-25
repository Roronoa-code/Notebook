package com.mani.notebook;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.HapticFeedbackConstants;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Notebook on the phone: the screens are a web page bundled in the app; this class gives that page
// the phone's library, the gallery and camera, QR pairing and sync with the PC.
public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.local";
    private static final String LOCAL_NET = "android.permission.ACCESS_LOCAL_NETWORK";
    private static final int REQ_PICK = 1, REQ_CAMERA = 2, REQ_NET = 3;
    private WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService feedWorker = Executors.newSingleThreadExecutor(); // Ideas never wait behind a long sync
    private String pendingBoard = "";
    private Uri cameraUri;
    private Runnable afterNetPermission;
    private int safeTop = 0, safeBottom = 0;

    private void applySafeArea() {
        if (web == null) return;
        web.evaluateJavascript("document.documentElement.style.setProperty('--st','" + safeTop + "px');document.documentElement.style.setProperty('--sb','" + safeBottom + "px');", null);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0A0A"));
        // Full screen: the page draws behind the status bar and gesture bar and keeps its buttons clear of them.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            float d = getResources().getDisplayMetrics().density;
            safeTop = Math.round(bars.top / d);
            safeBottom = Math.round(bars.bottom / d);
            applySafeArea();
            return insets;
        });
        // Test builds only: lets the PC inspect the screens over USB/wireless debugging.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A0A0A"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return serve(request); }

            @Override
            public void onPageFinished(WebView view, String url) { applySafeArea(); }
        });
        web.setHapticFeedbackEnabled(true);
        web.addJavascriptInterface(new Native(), "NBNative");
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(ORIGIN + "/www/index.html");

        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        // A background sync that changes the library refreshes this screen.
        Core.onLibraryChanged = () -> runOnUiThread(this::pushState);
        try { if (Core.sync(this).paired()) Core.scheduleBackgroundSync(this); } catch (Exception ignored) { /* shown on the Sync screen */ }
    }

    @Override
    protected void onDestroy() {
        Core.onLibraryChanged = null;
        super.onDestroy();
    }

    // ---------- serving the page and the library to the WebView ----------

    // Everything is served from https://appassets.local: /www/ from the app, /lib/ from the phone's library. Nothing else loads.
    private WebResourceResponse serve(WebResourceRequest req) {
        Uri u = req.getUrl();
        if (!"appassets.local".equals(u.getHost())) return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        String path = u.getPath() == null ? "" : u.getPath();
        try {
            if (path.startsWith("/www/")) {
                String rel = path.substring(1);
                if (rel.contains("..")) throw new IOException("bad path");
                return new WebResourceResponse(mime(rel), "utf-8", getAssets().open(rel));
            }
            if (path.startsWith("/feed/")) { // Ideas pictures: the phone's copy, or fetched from the PC
                File f = Core.sync(this).feedImage(path.substring(6).replace(".jpg", ""));
                if (f == null) throw new IOException("missing");
                return fileResponse(f, req.getRequestHeaders());
            }
            if (path.startsWith("/lib/")) {
                File base = Core.library(this).root;
                File f = new File(base, path.substring(5));
                if (!f.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator) || !f.isFile()) throw new IOException("missing");
                return fileResponse(f, req.getRequestHeaders());
            }
        } catch (Exception ignored) { /* fall through to 404 */ }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    // Supports partial requests so videos can be scrubbed.
    private static WebResourceResponse fileResponse(File f, Map<String, String> headers) throws IOException {
        long size = f.length();
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Cache-Control", "no-cache");
        String range = null;
        for (Map.Entry<String, String> e : headers.entrySet()) if (e.getKey().equalsIgnoreCase("Range")) range = e.getValue();
        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring(6).split("-", 2);
            long start = parts[0].isEmpty() ? Math.max(0, size - Long.parseLong(parts[1])) : Long.parseLong(parts[0]);
            long end = parts.length > 1 && !parts[1].isEmpty() && !parts[0].isEmpty() ? Math.min(Long.parseLong(parts[1]), size - 1) : size - 1;
            if (start >= size || start > end) {
                h.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse("text/plain", "utf-8", 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
            }
            final long len = end - start + 1;
            h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            h.put("Content-Length", String.valueOf(len));
            // WebView's InputStreamReader applies the request's Range itself. Give it
            // the whole file at byte zero; pre-skipping here skips twice and breaks MP4s.
            return new WebResourceResponse(mime(f.getName()), null, 206, "Partial Content", h, new FileInputStream(f));
        }
        h.put("Content-Length", String.valueOf(size));
        return new WebResourceResponse(mime(f.getName()), null, 200, "OK", h, new FileInputStream(f));
    }

    private static String mime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js")) return "text/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".heic") || n.endsWith(".heif")) return "image/heic";
        if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".3gp")) return "video/3gpp";
        return "application/octet-stream";
    }

    // ---------- talking back to the page ----------

    private void js(String fn, String json) {
        String arg = JSONObject.quote(json);
        runOnUiThread(() -> web.evaluateJavascript("window." + fn + " && window." + fn + "(" + arg + ")", null));
    }

    private String stateJson() throws Exception {
        JSONObject st = new JSONObject(Core.library(this).stateJson());
        st.put("sync", Core.sync(this).status());
        return st.toString();
    }

    private void pushState() {
        try { js("nbOnState", stateJson()); } catch (Exception ignored) { /* next change will retry */ }
    }

    private static String error(Exception e) {
        String m = e.getMessage();
        return new JSONObject(Map.of("error", m == null || m.isEmpty() ? "Something went wrong." : m)).toString();
    }

    private void toast(String msg) { js("nbOnToast", msg); }

    // Runs a library change, then returns the new state (or a plain-English error) to the page.
    private interface Change { String run() throws Exception; }

    private String change(Change c) {
        try {
            String id = c.run();
            JSONObject out = new JSONObject().put("ok", true).put("state", new JSONObject(stateJson()));
            if (id != null) out.put("id", id);
            return out.toString();
        } catch (Exception e) {
            return error(e);
        }
    }

    // ---------- local network permission (Android 17) ----------

    private void withLocalNetwork(Runnable r) {
        if (Build.VERSION.SDK_INT < 37 || checkSelfPermission(LOCAL_NET) == PackageManager.PERMISSION_GRANTED) { r.run(); return; }
        afterNetPermission = r;
        requestPermissions(new String[]{LOCAL_NET}, REQ_NET);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_NET) return;
        Runnable r = afterNetPermission;
        afterNetPermission = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) { if (r != null) r.run(); }
        else js("nbOnSync", "{\"phase\":\"error\",\"message\":\"Notebook needs local network access to reach your PC. Allow it in Settings, Apps, Notebook, Permissions.\"}");
    }

    // ---------- gallery and camera ----------

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_PICK && result == RESULT_OK && data != null) {
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
            importAll(uris);
        } else if (req == REQ_CAMERA) {
            Uri u = cameraUri;
            cameraUri = null;
            if (u == null) return;
            if (result == RESULT_OK) importAll(List.of(u));
            else getContentResolver().delete(u, null, null);
        }
    }

    private void importAll(List<Uri> uris) {
        String board = pendingBoard;
        worker.execute(() -> {
            int ok = 0, failed = 0;
            for (Uri u : uris) {
                try { Core.library(this).importUri(getContentResolver(), u, board); ok++; } catch (Exception e) { failed++; }
                pushState();
            }
            toast(ok == 0 ? "Nothing was added" : "Added " + ok + (ok == 1 ? " item" : " items") + (failed > 0 ? " · " + failed + " couldn't be added" : ""));
            autoSync();
        });
    }

    private void autoSync() {
        try {
            SyncClient s = Core.sync(this);
            if (!s.paired()) return;
            if (Build.VERSION.SDK_INT >= 37 && checkSelfPermission(LOCAL_NET) != PackageManager.PERMISSION_GRANTED) return;
            worker.execute(() -> runSync(true));
        } catch (Exception ignored) { /* shown when they open Sync */ }
    }

    private void runSync(boolean quiet) {
        try {
            Core.sync(this).sync((phase, done, total) -> {
                if (!quiet || phase.equals("downloading") || phase.equals("uploading")) {
                    try { js("nbOnSync", new JSONObject().put("phase", phase).put("done", done).put("total", total).toString()); } catch (Exception ignored) { /* progress only */ }
                }
                if (phase.equals("done")) pushState();
            });
            js("nbOnSync", new JSONObject().put("phase", "done").put("status", Core.sync(this).status()).toString());
        } catch (Exception e) {
            if (!quiet) { try { js("nbOnSync", new JSONObject().put("phase", "error").put("message", e.getMessage()).toString()); } catch (Exception ignored) { /* nothing more to show */ } }
            else pushState();
        }
    }

    // ---------- what the page can call ----------

    private class Native {
        @JavascriptInterface public String state() { try { return stateJson(); } catch (Exception e) { return error(e); } }

        @JavascriptInterface public void tick() {
            runOnUiThread(() -> web.performHapticFeedback(Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : HapticFeedbackConstants.CLOCK_TICK));
        }

        @JavascriptInterface public void pick(String boardId) {
            pendingBoard = boardId == null ? "" : boardId;
            runOnUiThread(() -> {
                // Samsung Gallery first (pick several photos and videos); Android's own picker if it isn't there.
                Intent gallery = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"})
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    .setPackage("com.sec.android.gallery3d");
                try { startActivityForResult(gallery, REQ_PICK); }
                catch (Exception e) { startActivityForResult(new Intent(MediaStore.ACTION_PICK_IMAGES).putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 50), REQ_PICK); }
            });
        }

        @JavascriptInterface public void camera(String boardId) {
            pendingBoard = boardId == null ? "" : boardId;
            runOnUiThread(() -> {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, "Notebook_" + System.currentTimeMillis() + ".jpg");
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Notebook");
                cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (cameraUri == null) { toast("The camera couldn't be opened."); return; }
                Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try { startActivityForResult(i, REQ_CAMERA); } catch (Exception e) { toast("No camera app was found."); }
            });
        }

        @JavascriptInterface public String addNote(String boardId) { return changed(change(() -> Core.library(MainActivity.this).addNote(boardId))); }
        @JavascriptInterface public String update(String id, String json) { return changed(change(() -> { Core.library(MainActivity.this).updateItem(id, new JSONObject(json)); return null; })); }
        @JavascriptInterface public String bin(String id) { return changed(change(() -> { Core.library(MainActivity.this).moveToBin(id); return null; })); }
        @JavascriptInterface public String restore(String id) { return changed(change(() -> { Core.library(MainActivity.this).restore(id); return null; })); }
        @JavascriptInterface public String stack(String idsJson, String board) { return changed(change(() -> Core.library(MainActivity.this).stackItems(new JSONArray(idsJson), board))); }
        @JavascriptInterface public String unstack(String id) { return changed(change(() -> { Core.library(MainActivity.this).unstackItem(id); return null; })); }
        @JavascriptInterface public String deleteForever(String id) { return changed(change(() -> String.valueOf(Core.library(MainActivity.this).deleteForever(id)))); }
        @JavascriptInterface public String addBoard(String name) { return changed(change(() -> Core.library(MainActivity.this).addBoard(name))); }
        @JavascriptInterface public String renameBoard(String id, String name) { return changed(change(() -> { Core.library(MainActivity.this).renameBoard(id, name); return null; })); }
        @JavascriptInterface public String deleteBoard(String id) { return changed(change(() -> { Core.library(MainActivity.this).deleteBoard(id); return null; })); }

        @JavascriptInterface public String getPref(String key) { return getSharedPreferences("ui", MODE_PRIVATE).getString(key, ""); }
        @JavascriptInterface public void setPref(String key, String value) { getSharedPreferences("ui", MODE_PRIVATE).edit().putString(key, value).apply(); }

        // Ideas: the feeds the PC prepared, fetching new ones, saving or hiding a pin, opening it in Pinterest.
        @JavascriptInterface public String feed() { try { return Core.sync(MainActivity.this).feedJson(); } catch (Exception e) { return error(e); } }
        @JavascriptInterface public void feedRefresh() {
            runOnUiThread(() -> withLocalNetwork(() -> feedWorker.execute(() -> {
                try { js("nbOnFeed", Core.sync(MainActivity.this).refreshFeedNow()); }
                catch (Exception e) { js("nbOnFeed", error(e)); }
            })));
        }
        @JavascriptInterface public void feedSave(String url, String boardId) {
            if (!url.matches("https://www\\.pinterest\\.com/pin/\\d+/")) return;
            feedWorker.execute(() -> {
                try {
                    Core.sync(MainActivity.this).feedAction("save", new JSONObject().put("url", url).put("boardId", boardId == null || boardId.isEmpty() ? JSONObject.NULL : boardId));
                    toast("Saving on your PC. It arrives with the next sync.");
                    ui.removeCallbacks(syncSoon);
                    ui.postDelayed(syncSoon, 25000); // the PC needs a moment to download it
                } catch (Exception e) { toast("Saved for later: it goes to your PC when it can reach it."); }
            });
        }
        @JavascriptInterface public void feedHide(String id) {
            if (!id.matches("\\d{1,25}")) return;
            feedWorker.execute(() -> { try { Core.sync(MainActivity.this).feedAction("hide", new JSONObject().put("id", id)); } catch (Exception ignored) { /* sent with the next sync */ } });
        }
        @JavascriptInterface public void openPin(String url) {
            if (!url.matches("https://www\\.pinterest\\.com/pin/\\d+/")) return;
            runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { toast("No app here can open Pinterest links."); } });
        }

        @JavascriptInterface public void sync() { runOnUiThread(() -> withLocalNetwork(() -> worker.execute(() -> runSync(false)))); }
        @JavascriptInterface public void syncQuiet() { autoSync(); }

        @JavascriptInterface public void scan() {
            runOnUiThread(() -> withLocalNetwork(() -> {
                GmsBarcodeScannerOptions o = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
                GmsBarcodeScanning.getClient(MainActivity.this, o).startScan()
                    .addOnSuccessListener(b -> pairWith(b.getRawValue()))
                    .addOnFailureListener(e -> js("nbOnPair", "{\"ok\":false,\"message\":\"The scanner couldn't start. Try again, or type the code instead.\"}"));
            }));
        }

        @JavascriptInterface public void pairManual(String host, String code) {
            runOnUiThread(() -> withLocalNetwork(() -> pairWith("notebook://pair?h=" + Uri.encode(host.trim()) + "&p=47821&c=" + Uri.encode(code.trim()))));
        }

        @JavascriptInterface public String unpair() {
            try { Core.sync(MainActivity.this).unpair(); Core.cancelBackgroundSync(MainActivity.this); return stateJson(); } catch (Exception e) { return error(e); }
        }
    }

    // A change made on the phone gets synced a few seconds after the last edit, if the PC is reachable.
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable syncSoon = this::autoSync;

    private String changed(String result) {
        ui.removeCallbacks(syncSoon);
        ui.postDelayed(syncSoon, 5000);
        return result;
    }

    private void pairWith(String qr) {
        worker.execute(() -> {
            try {
                Core.sync(this).pair(qr == null ? "" : qr);
                Core.scheduleBackgroundSync(this);
                js("nbOnPair", new JSONObject().put("ok", true).put("status", Core.sync(this).status()).toString());
                runSync(false);
            } catch (Exception e) {
                try { js("nbOnPair", new JSONObject().put("ok", false).put("message", e.getMessage()).toString()); } catch (Exception ignored) { /* nothing more to show */ }
            }
        });
    }

    private void goBack() {
        web.evaluateJavascript("window.nbBack ? String(nbBack()) : 'false'", v -> { if (!"\"true\"".equals(v)) finish(); });
    }
}
