package com.mani.notebook;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Process;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.FloatBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

// The picture model on the phone: the same CLIP ViT-L/14 the PC uses, in its 8-bit form (about 300 MB, put into the
// app at build time from D:\Notebook Tools, never kept in the project). It gives a picture a fingerprint (768 numbers;
// alike pictures have alike fingerprints). In the background, one at a time, it fingerprints the library's own pictures
// and every Pinterest pin the phone fetches; For you then puts pins that look like your things first (PhoneIdeas).
// Fingerprints are kept in ideas/vectors.bin. The model is let go after a minute with nothing to do (it holds a lot of
// memory). Without the model in the app everything else works as before.
final class PhoneVision {
    static final String ASSET = "models/clip-vision.onnx";
    private static final int SIZE = 224, DIM = 768, KEEP = 3000;
    private static final float[] MEAN = { 0.48145466f, 0.4578275f, 0.40821073f }, STD = { 0.26862954f, 0.26130258f, 0.27577711f };
    private final Context ctx;
    private final Library lib;
    private final File store, tmpDir;
    private final ExecutorService worker = Executors.newSingleThreadExecutor((r) -> { Thread t = new Thread(() -> { Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); r.run(); }, "notebook-vision"); t.setDaemon(true); return t; });
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor((r) -> { Thread t = new Thread(r, "notebook-vision-idle"); t.setDaemon(true); return t; });
    private final Map<String, float[]> vecs = Collections.synchronizedMap(new LinkedHashMap<>(256, 0.75f, true)); // "pin:<sig>" or "item:<id>:<updatedAt>"
    private final Set<String> queued = Collections.synchronizedSet(new LinkedHashSet<>());
    private final boolean present;
    private OrtEnvironment env; private OrtSession session; private long lastUse; private int unsaved;

    PhoneVision(Context ctx, Library lib, File cacheDir) {
        this.ctx = ctx; this.lib = lib;
        store = new File(cacheDir, "vectors.bin"); tmpDir = new File(cacheDir, "vision");
        boolean ok; try (AssetFileDescriptor fd = ctx.getAssets().openFd(ASSET)) { ok = fd.getLength() > 1_000_000; } catch (Exception e) { ok = false; }
        present = ok;
        if (present) worker.execute(this::load);
    }

    boolean available() { return present; }
    float[] pin(String sig) { return sig == null ? null : vecs.get("pin:" + sig); }

    // Pins to fingerprint (in the order given), each from its small picture.
    void want(List<JSONObject> pins) {
        if (!present) return;
        for (JSONObject p : pins) {
            String sig = p.optString("sig"), url = p.optString("small", p.optString("img", ""));
            if (sig.isEmpty() || url.isEmpty() || vecs.containsKey("pin:" + sig) || !queued.add(sig)) continue;
            worker.execute(() -> { try { if (!vecs.containsKey("pin:" + sig)) pinVec(sig, url); } catch (Exception ignored) { } finally { queued.remove(sig); idle(); } });
        }
    }

    // The library's own pictures (newest first, or one board's), as fingerprints; the missing ones are fingerprinted
    // in the background and count from the next time.
    List<float[]> library(String board) {
        List<float[]> out = new ArrayList<>();
        if (!present) return out;
        try {
            JSONArray items = new JSONObject(lib.stateJson()).optJSONArray("items");
            List<JSONObject> list = new ArrayList<>();
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null || !it.isNull("deletedAt") || "note".equals(it.optString("kind"))) continue;
                if (board != null && !onBoard(it, board)) continue;
                list.add(it);
            }
            list.sort((a, b) -> b.optString("importedAt", "").compareTo(a.optString("importedAt", "")));
            for (JSONObject it : list.subList(0, Math.min(400, list.size()))) {
                String key = "item:" + it.optString("id") + ":" + it.optString("updatedAt");
                float[] v = vecs.get(key);
                if (v != null) { out.add(v); continue; }
                String rel = it.isNull("thumb") ? (("photo".equals(it.optString("kind")) && !it.isNull("file")) ? it.optString("file") : null) : it.optString("thumb");
                if (rel == null || !queued.add(key)) continue;
                File f = new File(lib.root, rel);
                worker.execute(() -> { try { Bitmap b = decode(f); if (b != null) put(key, embed(b)); } catch (Exception ignored) { } finally { queued.remove(key); idle(); } });
            }
        } catch (Exception ignored) { }
        return out;
    }
    private static boolean onBoard(JSONObject it, String board) { JSONArray b = it.optJSONArray("boards"); for (int i = 0; b != null && i < b.length(); i++) if (board.equals(b.optString(i))) return true; return false; }


    List<JSONObject> rank(List<JSONObject> pins, List<float[]> mine, List<float[]> liked, List<float[]> disliked, JSONObject taste) { return PhoneTaste.byLook(pins, (p) -> pin(p.optString("sig")), mine, liked, disliked, taste); }
    List<float[]> pins(JSONArray sigs) { List<float[]> out = new ArrayList<>(); for (int i = 0; sigs != null && i < sigs.length(); i++) { float[] v = pin(sigs.optString(i)); if (v != null) out.add(v); } return out; }

    private void pinVec(String sig, String url) throws Exception {
        if (!tmpDir.isDirectory()) tmpDir.mkdirs();
        File part = new File(tmpDir, sig + ".part");
        try {
            PhoneIdeasNet.download(url, part, PhoneIdeasNet.MAX_IMAGE, false);
            Bitmap b = decode(part);
            if (b != null) put("pin:" + sig, embed(b));
        } finally { part.delete(); }
    }
    private void put(String key, float[] v) {
        if (v == null) return;
        vecs.put(key, v);
        synchronized (this) { if (++unsaved >= 20) save(); }
    }

    private static Bitmap decode(File f) {
        if (f == null || !f.isFile()) return null;
        BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getPath(), o);
        if (o.outWidth <= 0 || o.outHeight <= 0) return null;
        int sample = 1; while (Math.min(o.outWidth, o.outHeight) / (sample * 2) >= SIZE) sample *= 2;
        BitmapFactory.Options d = new BitmapFactory.Options(); d.inSampleSize = sample; d.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeFile(f.getPath(), d);
    }

    // CLIP's own preparation: shortest side 224, the middle 224 x 224, its mean and spread per colour.
    private synchronized float[] embed(Bitmap src) throws Exception {
        if (session == null) open();
        lastUse = System.currentTimeMillis();
        float s = (float) SIZE / Math.min(src.getWidth(), src.getHeight());
        Bitmap scaled = Bitmap.createScaledBitmap(src, Math.max(SIZE, Math.round(src.getWidth() * s)), Math.max(SIZE, Math.round(src.getHeight() * s)), true);
        int x0 = (scaled.getWidth() - SIZE) / 2, y0 = (scaled.getHeight() - SIZE) / 2;
        int[] px = new int[SIZE * SIZE];
        scaled.getPixels(px, 0, SIZE, x0, y0, SIZE, SIZE);
        if (scaled != src) scaled.recycle();
        src.recycle();
        FloatBuffer in = FloatBuffer.allocate(3 * SIZE * SIZE);
        for (int c = 0; c < 3; c++) for (int i = 0; i < px.length; i++) in.put((((px[i] >> (16 - 8 * c)) & 255) / 255f - MEAN[c]) / STD[c]);
        in.rewind();
        try (OnnxTensor t = OnnxTensor.createTensor(env, in, new long[]{ 1, 3, SIZE, SIZE }); OrtSession.Result r = session.run(Collections.singletonMap("pixel_values", t))) {
            float[] v = ((float[][]) r.get(0).getValue())[0];
            float n = 0; for (float x : v) n += x * x; n = (float) Math.sqrt(n);
            if (n <= 0 || v.length != DIM) return null;
            for (int i = 0; i < v.length; i++) v[i] /= n;
            return v;
        }
    }
    private void open() throws Exception {
        env = OrtEnvironment.getEnvironment();
        try (AssetFileDescriptor fd = ctx.getAssets().openFd(ASSET); FileInputStream in = new FileInputStream(fd.getFileDescriptor())) {
            MappedByteBuffer model = in.getChannel().map(FileChannel.MapMode.READ_ONLY, fd.getStartOffset(), fd.getLength());
            OrtSession.SessionOptions o = new OrtSession.SessionOptions();
            o.setIntraOpNumThreads(4);
            o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            session = env.createSession(model, o);
        }
    }
    // Nothing left to do for a minute: the model lets go of its memory (fingerprints already made are kept).
    private void idle() {
        if (!queued.isEmpty()) return;
        synchronized (this) { if (unsaved > 0) save(); }
        timer.schedule(() -> { synchronized (this) { if (queued.isEmpty() && session != null && System.currentTimeMillis() - lastUse >= 59_000) { try { session.close(); } catch (Exception ignored) { } session = null; } } }, 60, TimeUnit.SECONDS);
    }

    private void load() {
        if (!store.isFile()) return;
        try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(store)))) {
            int n = in.readInt();
            for (int i = 0; i < n; i++) { String k = in.readUTF(); float[] v = new float[DIM]; for (int j = 0; j < DIM; j++) v[j] = in.readFloat(); vecs.put(k, v); }
        } catch (Exception ignored) { /* a broken file is simply rebuilt */ }
    }
    private synchronized void save() {
        unsaved = 0;
        File tmp = new File(store.getPath() + ".tmp");
        try {
            List<Map.Entry<String, float[]>> all;
            synchronized (vecs) { all = new ArrayList<>(vecs.entrySet()); }
            if (all.size() > KEEP) all = all.subList(all.size() - KEEP, all.size()); // (the least recently used go)
            try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(tmp)))) {
                out.writeInt(all.size());
                for (Map.Entry<String, float[]> e : all) { out.writeUTF(e.getKey()); for (float x : e.getValue()) out.writeFloat(x); }
            }
            if (!tmp.renameTo(store)) tmp.delete();
        } catch (Exception ignored) { tmp.delete(); }
    }
}
