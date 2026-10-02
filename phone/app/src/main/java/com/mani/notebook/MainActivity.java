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
    private GallerySession gallery;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService feedWorker = Executors.newSingleThreadExecutor(); // Ideas never wait behind a long sync
    private String pendingBoard = "";
    private Uri cameraUri;
    private Runnable afterNetPermission;
    private int safeTop = 0, safeBottom = 0;

    // The boards on Home turn to face you as the phone tilts. The WebView doesn't pass the tilt on reliably, so the
    // app reads it here (the game rotation sensor, no permission) and hands the page the angles about 30 times a
    // second while it is in front; nothing runs in the background.
    private android.hardware.SensorManager sensors;
    private final float[] rot = new float[9], ang = new float[3];
    private long lastTilt = 0;
    private double sentBeta = Double.NaN, sentGamma = Double.NaN;
    private final android.hardware.SensorEventListener tilt = new android.hardware.SensorEventListener() {
        @Override public void onSensorChanged(android.hardware.SensorEvent e) {
            long now = android.os.SystemClock.uptimeMillis();
            if (web == null || now - lastTilt < 33) return;
            lastTilt = now;
            android.hardware.SensorManager.getRotationMatrixFromVector(rot, e.values);
            android.hardware.SensorManager.getOrientation(rot, ang);
            double beta = Math.toDegrees(-ang[1]), gamma = Math.toDegrees(ang[2]);
            // Sensor noise must not keep the WebView drawing while the phone is still.
            if (Math.abs(beta - sentBeta) < 0.15 && Math.abs(gamma - sentGamma) < 0.15) return;
            sentBeta = beta; sentGamma = gamma;
            web.evaluateJavascript("window.nbGaze&&nbGaze(" + String.format(java.util.Locale.ROOT, "%.2f,%.2f", beta, gamma) + ")", null);
        }
        @Override public void onAccuracyChanged(android.hardware.Sensor s, int a) { }
    };
    private void tiltOn(boolean on) {
        sentBeta = sentGamma = Double.NaN;
        if (sensors == null) sensors = (android.hardware.SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensors == null) return;
        sensors.unregisterListener(tilt);
        android.hardware.Sensor g = sensors.getDefaultSensor(android.hardware.Sensor.TYPE_GAME_ROTATION_VECTOR);
        if (on && g != null) sensors.registerListener(tilt, g, android.hardware.SensorManager.SENSOR_DELAY_GAME);
    }

    private void applySafeArea() {
        if (web == null) return;
        web.evaluateJavascript("document.documentElement&&(document.documentElement.style.setProperty('--st','" + safeTop + "px'),document.documentElement.style.setProperty('--sb','" + safeBottom + "px'),document.documentElement.classList.add('nobar'));", null);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ErrorLog.init(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0A0A"));
        // Full screen: the page draws behind the status bar and gesture bar and keeps its buttons clear of them.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            float d = getResources().getDisplayMetrics().density;
            // The status bar is hidden (it slides in over the app if you swipe down), so the page uses the whole
            // screen; the top only stays clear of the camera hole (less a little, since it sits in the middle).
            int cut = insets.getInsets(WindowInsets.Type.displayCutout()).top;
            safeTop = Math.max(Math.round(bars.top / d), Math.max(0, Math.round(cut / d) - 8));
            safeBottom = Math.round(bars.bottom / d);
            applySafeArea();
            if (!imeMoving) keyboard(insets, false); // (a keyboard that appears without sliding)
            return insets;
        });
        // The keyboard's height every frame while it slides, so a small form rides on top of it the whole way
        // instead of jumping to where the keyboard will end up (the page itself only hears the final size).
        if (Build.VERSION.SDK_INT >= 30) root.setWindowInsetsAnimationCallback(new android.view.WindowInsetsAnimation.Callback(android.view.WindowInsetsAnimation.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            @Override public void onPrepare(android.view.WindowInsetsAnimation a) { if ((a.getTypeMask() & WindowInsets.Type.ime()) != 0) imeMoving = true; }
            @Override public WindowInsets onProgress(WindowInsets insets, List<android.view.WindowInsetsAnimation> running) {
                for (android.view.WindowInsetsAnimation a : running) if ((a.getTypeMask() & WindowInsets.Type.ime()) != 0) { keyboard(insets, true); break; }
                return insets;
            }
            @Override public void onEnd(android.view.WindowInsetsAnimation a) {
                if ((a.getTypeMask() & WindowInsets.Type.ime()) == 0) return;
                imeMoving = false;
                WindowInsets now = root.getRootWindowInsets();
                if (now != null) keyboard(now, false);
            }
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
        // Script errors on the screens go to the error log (and on to the PC with the next sync).
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                if (m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) ErrorLog.add("screen", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return false;
            }
        });
        web.setHapticFeedbackEnabled(true);
        web.addJavascriptInterface(new Native(), "NBNative");
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideStatusBar();
        gallery = GallerySession.get(this); gallery.ui = this; // (the session itself outlives this screen)
        web.loadUrl(ORIGIN + "/www/index.html");

        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        // A background sync that changes the library refreshes this screen.
        Core.onLibraryChanged = () -> runOnUiThread(this::pushState);
        try { if (Core.sync(this).paired()) Core.scheduleBackgroundSync(this); } catch (Exception ignored) { /* shown on the Sync screen */ }
        worker.execute(() -> { try { if (Core.library(this).fillThumbs()) pushState(); } catch (Exception ignored) { /* previews are a nicety */ } });
    }

    @Override
    protected void onDestroy() {
        if (gallery != null && gallery.ui == this) { gallery.ui = null; gallery.resumed = false; }
        Core.onLibraryChanged = null;
        super.onDestroy();
    }

    private void hideStatusBar() {
        android.view.WindowInsetsController c = getWindow().getInsetsController();
        if (c == null) return;
        c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsets.Type.statusBars());
    }

    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if (focus) hideStatusBar(); }

    @Override protected void onResume() {
        super.onResume(); tiltOn(true);
        // A Gallery batch waiting for Android's consent (the confirmation notification was tapped, or the app was opened).
        if (gallery != null) { gallery.ui = this; gallery.resumed = true; gallery.operations.launch(this); }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); }
    @Override protected void onPause() { tiltOn(false); if (gallery != null) gallery.pause(); super.onPause(); }
    void galleryMessage(String value) { js("nbOnGallery", value); }

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
            if (path.startsWith("/feed/")) { // Ideas pictures: native cache, Pinterest, or the PC cache
                File f = Core.ideas(this).feedImage(path.substring(6).replaceFirst("\\.[a-z0-9]+$", ""));
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

    private boolean imeMoving = false;
    private int keyboardDp = -1;
    // The keyboard's height above the gesture bar, in the page's pixels.
    private void keyboard(WindowInsets insets, boolean moving) {
        if (Build.VERSION.SDK_INT < 30 || web == null) return;
        float d = getResources().getDisplayMetrics().density;
        int ime = insets.getInsets(WindowInsets.Type.ime()).bottom, bars = insets.getInsets(WindowInsets.Type.systemBars()).bottom;
        int dp = Math.round(Math.max(0, ime - bars) / d);
        if (dp == keyboardDp && moving) return;
        keyboardDp = dp;
        web.evaluateJavascript("window.nbKeyboard&&window.nbKeyboard(" + dp + "," + moving + ")", null);
    }

    private void pushState() {
        try { js("nbOnState", stateJson()); } catch (Exception ignored) { /* next change will retry */ }
    }

    private static String error(Exception e) {
        String m = e.getMessage();
        return new JSONObject(Map.of("error", m == null || m.isEmpty() ? "Something went wrong." : m)).toString();
    }

    private void toast(String msg) { js("nbOnToast", msg); }

    private String feedError(String want, Exception e) {
        String key = want == null || want.trim().isEmpty() ? "all" : want;
        try {
            JSONObject out = new JSONObject(Core.ideas(this).feedJson());
            out.put("key", key).put("error", e.getMessage() == null ? "Ideas are unavailable right now." : e.getMessage());
            return out.toString();
        } catch (Exception ignored) {
            try {
                return new JSONObject().put("feeds", new JSONObject()).put("key", key)
                    .put("error", e.getMessage() == null ? "Ideas are unavailable right now." : e.getMessage()).toString();
            } catch (Exception impossible) {
                return "{\"feeds\":{},\"key\":\"all\",\"error\":\"Ideas are unavailable right now.\"}";
            }
        }
    }

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
        if (code == GallerySession.PERMISSIONS) {
            if (!gallery.store.scope().equals("No access")) withLocalNetwork(() -> gallery.start());
            else gallery.message("Photo access was not granted. You can change access when ready.");
            return;
        }
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
        if (req == GalleryOperations.REQUEST) { gallery.operations.receivedResult(result); return; }
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
            ErrorLog.failed("sync", e);
            if (!quiet) { try { js("nbOnSync", new JSONObject().put("phase", "error").put("message", e.getMessage()).toString()); } catch (Exception ignored) { /* nothing more to show */ } }
            else pushState();
        }
    }

    // ---------- what the page can call ----------

    private class Native {
        @JavascriptInterface public String state() { try { return stateJson(); } catch (Exception e) { return error(e); } }
        @JavascriptInterface public String galleryStatus() { return gallery.status(); }
        @JavascriptInterface public void galleryStart() { runOnUiThread(() -> withLocalNetwork(() -> gallery.start())); }
        @JavascriptInterface public void galleryStop() { runOnUiThread(() -> gallery.stop()); }
        @JavascriptInterface public void galleryPermissions() { runOnUiThread(() -> gallery.permissions()); }
        @JavascriptInterface public void galleryManage() { runOnUiThread(() -> gallery.manage()); }
        @JavascriptInterface public void pairSecure(String link) {
            runOnUiThread(() -> withLocalNetwork(() -> {
                if (Uri.parse(link.trim()).getQueryParameter("f") == null) { gallery.message("Copy the secure pairing link from Notebook on your PC."); return; }
                pairWith(link);
            }));
        }
        @JavascriptInterface public void pastePairingLink() {
            runOnUiThread(() -> {
                android.widget.EditText input = new android.widget.EditText(MainActivity.this);
                input.setHint("Paste the pairing link copied from your PC");
                new android.app.AlertDialog.Builder(MainActivity.this).setTitle("Pair securely with your PC").setView(input)
                    .setNegativeButton("Cancel", null).setPositiveButton("Pair", (d, w) -> pairSecure(input.getText().toString())).show();
            });
        }

        @JavascriptInterface public void tick() {
            runOnUiThread(() -> web.performHapticFeedback(Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_FREQUENT_TICK : HapticFeedbackConstants.CLOCK_TICK));
        }

        // Richer feel than the tick: "soft" (a light tap), "heavy" (picking something up), "success" and "fail".
        @JavascriptInterface public void haptic(String kind) {
            int c;
            if ("heavy".equals(kind)) c = HapticFeedbackConstants.LONG_PRESS;
            else if ("success".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.LONG_PRESS;
            else if ("fail".equals(kind)) c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            else c = HapticFeedbackConstants.VIRTUAL_KEY;
            final int f = c;
            runOnUiThread(() -> web.performHapticFeedback(f));
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

        // The page can't reload itself (every navigation is refused), so it asks the app to open its screens again.
        @JavascriptInterface public void reload() { runOnUiThread(() -> web.loadUrl(ORIGIN + "/www/index.html")); }
        @JavascriptInterface public String getPref(String key) { return getSharedPreferences("ui", MODE_PRIVATE).getString(key, ""); }
        @JavascriptInterface public void setPref(String key, String value) { getSharedPreferences("ui", MODE_PRIVATE).edit().putString(key, value).apply(); }

        // Ideas: native Pinterest feeds work away from the PC; the PC cache is only a fallback.
        @JavascriptInterface public String feed() { try { return Core.ideas(MainActivity.this).feedJson(); } catch (Exception e) { return error(e); } }
        @JavascriptInterface public void feedRefresh(String want) {
            feedWorker.execute(() -> { try { js("nbOnFeed", Core.ideas(MainActivity.this).refresh(want, false, false)); } catch (Exception e) { js("nbOnFeed", feedError(want, e)); } });
        }
        @JavascriptInterface public void feedReload(String want) {
            feedWorker.execute(() -> { try { js("nbOnFeed", Core.ideas(MainActivity.this).refresh(want, true, false)); } catch (Exception e) { js("nbOnFeed", feedError(want, e)); } });
        }
        // The next page of a feed (the phone asks while a few screens of pins are still below).
        @JavascriptInterface public void feedMore(String want) {
            feedWorker.execute(() -> { try { js("nbOnFeed", Core.ideas(MainActivity.this).refresh(want, false, true)); } catch (Exception e) { js("nbOnFeed", feedError(want, e)); } });
        }
        @JavascriptInterface public void feedSave(String url, String boardId) {
            feedWorker.execute(() -> {
                try { js("nbOnIdeaSaved", Core.ideas(MainActivity.this).save(url, boardId)); pushState(); }
                catch (Exception e) { try { js("nbOnIdeaSaved", new JSONObject().put("url", url == null ? "" : url).put("ok", false).put("message", e.getMessage() == null ? "That pin could not be saved. Try again." : e.getMessage()).toString()); } catch (Exception ignored) { } }
            });
        }
        @JavascriptInterface public void feedHide(String id) {
            if (id == null || !id.matches("\\d{1,25}")) return;
            feedWorker.execute(() -> {
                try { Core.ideas(MainActivity.this).hide(id); } catch (Exception ignored) { }
                // Keep the PC's negative signal when possible; feed browsing never waits for it.
                try { Core.sync(MainActivity.this).feedAction("hide", new JSONObject().put("id", id)); } catch (Exception ignored) { /* queued for the next sync */ }
            });
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
