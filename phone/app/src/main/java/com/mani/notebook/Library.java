package com.mani.notebook;

import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

// The phone's library: the same layout as the PC (library.json + media/ + thumbs/), format v2 from docs/SYNC.md.
// All methods are synchronized so the page, imports and sync never write at the same time.
public class Library {
    final File root, media, thumbs, file;
    private JSONObject data;

    Library(File root) throws IOException, JSONException {
        this.root = root;
        media = new File(root, "media");
        thumbs = new File(root, "thumbs");
        file = new File(root, "library.json");
        if (!media.isDirectory() && !media.mkdirs()) throw new IOException("Couldn't create the library folder.");
        if (!thumbs.isDirectory() && !thumbs.mkdirs()) throw new IOException("Couldn't create the library folder.");
        load();
    }

    static String now() { return Instant.now().toString(); }

    private void load() throws IOException, JSONException {
        File bak = new File(root, "library.json.bak");
        if (file.exists() || bak.exists()) {
            try {
                data = new JSONObject(read(file));
            } catch (Exception e) {
                data = new JSONObject(read(bak)); // library.json damaged: fall back to the previous save
            }
        } else {
            data = new JSONObject();
            data.put("app", "Notebook");
            JSONArray boards = new JSONArray();
            for (String name : new String[]{"Outfits", "Wallpapers", "Icons", "Profile pictures"}) {
                boards.put(new JSONObject().put("id", UUID.randomUUID().toString()).put("name", name).put("updatedAt", now()));
            }
            data.put("boards", boards).put("items", new JSONArray());
        }
        data.put("version", 2);
        if (!data.has("tombstones")) data.put("tombstones", new JSONObject().put("items", new JSONArray()).put("boards", new JSONArray()));
        save();
    }

    private static String read(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            return new String(b, 0, off, "UTF-8");
        }
    }

    // Write to a temp file, flush it to disk, keep the previous save as .bak, then swap it in.
    synchronized void save() throws IOException {
        File tmp = new File(root, "library.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data.toString().getBytes("UTF-8"));
            out.getFD().sync();
        }
        if (file.exists()) copy(file, new File(root, "library.json.bak"));
        if (!tmp.renameTo(file)) throw new IOException("Couldn't save the library.");
    }

    private static void copy(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    synchronized String stateJson() { return data.toString(); }

    synchronized JSONObject metadataForSync() throws JSONException { return new JSONObject(data.toString()); }

    private JSONArray items() throws JSONException { return data.getJSONArray("items"); }
    private JSONArray boards() throws JSONException { return data.getJSONArray("boards"); }

    private JSONObject item(String id) throws JSONException {
        JSONArray a = items();
        for (int i = 0; i < a.length(); i++) if (a.getJSONObject(i).getString("id").equals(id)) return a.getJSONObject(i);
        throw new JSONException("That item no longer exists.");
    }

    private Set<String> boardIds() throws JSONException {
        Set<String> s = new HashSet<>();
        JSONArray b = boards();
        for (int i = 0; i < b.length(); i++) s.add(b.getJSONObject(i).getString("id"));
        return s;
    }

    private JSONArray validBoards(JSONArray ids) throws JSONException {
        Set<String> known = boardIds(), seen = new HashSet<>();
        JSONArray out = new JSONArray();
        if (ids != null) for (int i = 0; i < ids.length(); i++) {
            String id = ids.getString(i);
            if (known.contains(id) && seen.add(id)) out.put(id);
        }
        return out;
    }

    private void prepend(JSONObject it) throws JSONException {
        JSONArray old = items(), next = new JSONArray().put(it);
        for (int i = 0; i < old.length(); i++) next.put(old.get(i));
        data.put("items", next);
    }

    // ---------- items ----------

    synchronized String importUri(ContentResolver cr, Uri uri, String boardId) throws IOException, JSONException {
        String mime = cr.getType(uri);
        if (mime == null) mime = "";
        String kind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "photo" : null;
        if (kind == null) throw new IOException("Not a photo or video.");
        String name = "import";
        try (Cursor c = cr.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) name = c.getString(0);
        } catch (Exception ignored) { /* name is only for display */ }
        String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        if (ext == null) { int dot = name.lastIndexOf('.'); ext = dot > 0 ? name.substring(dot + 1) : (kind.equals("video") ? "mp4" : "jpg"); }
        ext = ext.toLowerCase(Locale.ROOT);
        if (ext.equals("jpeg")) ext = "jpg";
        if (!ext.matches("[a-z0-9]{1,8}")) ext = kind.equals("video") ? "mp4" : "jpg"; // the PC only accepts plain extensions
        String id = UUID.randomUUID().toString();
        String rel = "media/" + id + "." + ext;
        File dest = new File(root, rel), tmp = new File(root, rel + ".part");
        long size = 0;
        try (InputStream in = cr.openInputStream(uri); FileOutputStream out = new FileOutputStream(tmp)) {
            if (in == null) throw new IOException("Couldn't open that file.");
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); size += n; }
            out.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            throw e;
        }
        if (!tmp.renameTo(dest)) { tmp.delete(); throw new IOException("Couldn't copy that file."); }
        int dot = name.lastIndexOf('.');
        JSONObject it = new JSONObject()
            .put("id", id).put("kind", kind).put("title", dot > 0 ? name.substring(0, dot) : name).put("file", rel)
            .put("thumb", JSONObject.NULL).put("originalName", name).put("size", size)
            .put("importedAt", now()).put("updatedAt", now()).put("deletedAt", JSONObject.NULL)
            .put("boards", validBoards(boardId == null || boardId.isEmpty() ? null : new JSONArray().put(boardId)));
        makeThumb(it);
        prepend(it);
        save();
        return id;
    }

    // Small preview for the grid. Photos are turned upright using their EXIF orientation.
    void makeThumb(JSONObject it) {
        try {
            File src = new File(root, it.getString("file"));
            String id = it.getString("id");
            File out = new File(thumbs, id + ".jpg");
            Bitmap bmp;
            int w, h;
            if ("video".equals(it.getString("kind"))) {
                MediaMetadataRetriever r = new MediaMetadataRetriever();
                try {
                    r.setDataSource(src.getAbsolutePath());
                    String dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                    if (dur != null) it.put("duration", Math.round(Long.parseLong(dur) / 100.0) / 10.0);
                    bmp = r.getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                } finally { r.release(); }
                if (bmp == null) return;
                w = bmp.getWidth(); h = bmp.getHeight();
                bmp = scale(bmp, 640);
            } else {
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(src.getAbsolutePath(), o);
                int sample = 1;
                while (o.outWidth / (sample * 2) >= 640) sample *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options();
                o2.inSampleSize = sample;
                bmp = BitmapFactory.decodeFile(src.getAbsolutePath(), o2);
                if (bmp == null) return;
                int rot = 0;
                try {
                    int or = new ExifInterface(src.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                    rot = or == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : or == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : or == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
                } catch (Exception ignored) { /* no EXIF */ }
                if (rot != 0) { Matrix m = new Matrix(); m.postRotate(rot); bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true); }
                boolean swap = rot == 90 || rot == 270;
                w = swap ? o.outHeight : o.outWidth; h = swap ? o.outWidth : o.outHeight;
                bmp = scale(bmp, 640);
            }
            try (FileOutputStream fo = new FileOutputStream(out)) { bmp.compress(Bitmap.CompressFormat.JPEG, 85, fo); }
            it.put("thumb", "thumbs/" + id + ".jpg").put("w", w).put("h", h);
        } catch (Exception ignored) {
            // No preview: the grid shows a placeholder, the item itself is still saved.
        }
    }

    private static Bitmap scale(Bitmap b, int maxW) {
        if (b.getWidth() <= maxW) return b;
        return Bitmap.createScaledBitmap(b, maxW, Math.max(1, Math.round(b.getHeight() * (maxW / (float) b.getWidth()))), true);
    }

    synchronized String addNote(String boardId) throws IOException, JSONException {
        String id = UUID.randomUUID().toString();
        prepend(new JSONObject().put("id", id).put("kind", "note").put("title", "Untitled note").put("html", "")
            .put("importedAt", now()).put("updatedAt", now()).put("deletedAt", JSONObject.NULL)
            .put("boards", validBoards(boardId == null || boardId.isEmpty() ? null : new JSONArray().put(boardId))));
        save();
        return id;
    }

    synchronized void updateItem(String id, JSONObject ch) throws IOException, JSONException {
        JSONObject it = item(id);
        if (ch.has("title")) { String t = ch.getString("title").trim(); it.put("title", t.isEmpty() ? "Untitled note" : t.substring(0, Math.min(120, t.length()))); }
        if (ch.has("html") && "note".equals(it.getString("kind"))) it.put("html", ch.getString("html"));
        if (ch.has("caption") && !"note".equals(it.getString("kind"))) it.put("caption", ch.getString("caption"));
        if (ch.has("boards")) it.put("boards", validBoards(ch.getJSONArray("boards")));
        it.put("updatedAt", now());
        save();
    }

    synchronized void moveToBin(String id) throws IOException, JSONException { item(id).put("deletedAt", now()).put("updatedAt", now()); save(); }

    synchronized void restore(String id) throws IOException, JSONException {
        JSONObject it = item(id);
        it.put("deletedAt", JSONObject.NULL).put("updatedAt", now()).put("boards", validBoards(it.optJSONArray("boards")));
        save();
    }

    // ---------- boards ----------

    synchronized String addBoard(String name) throws IOException, JSONException {
        String clean = name == null ? "" : name.trim();
        if (clean.isEmpty()) throw new JSONException("Give the board a name.");
        if (clean.length() > 40) clean = clean.substring(0, 40);
        JSONArray b = boards();
        for (int i = 0; i < b.length(); i++) if (b.getJSONObject(i).getString("name").equalsIgnoreCase(clean)) throw new JSONException("There's already a board called \"" + clean + "\".");
        String id = UUID.randomUUID().toString();
        b.put(new JSONObject().put("id", id).put("name", clean).put("updatedAt", now()));
        save();
        return id;
    }

    synchronized void renameBoard(String id, String name) throws IOException, JSONException {
        String clean = name == null ? "" : name.trim();
        if (clean.isEmpty()) throw new JSONException("Give the board a name.");
        JSONArray b = boards();
        for (int i = 0; i < b.length(); i++) {
            JSONObject x = b.getJSONObject(i);
            if (!x.getString("id").equals(id) && x.getString("name").equalsIgnoreCase(clean)) throw new JSONException("There's already a board called \"" + clean + "\".");
        }
        for (int i = 0; i < b.length(); i++) if (b.getJSONObject(i).getString("id").equals(id)) b.getJSONObject(i).put("name", clean.substring(0, Math.min(40, clean.length()))).put("updatedAt", now());
        save();
    }

    // Deleting a board keeps its items; a tombstone tells the PC to delete it too.
    synchronized void deleteBoard(String id) throws IOException, JSONException {
        JSONArray b = boards(), keep = new JSONArray();
        for (int i = 0; i < b.length(); i++) if (!b.getJSONObject(i).getString("id").equals(id)) keep.put(b.get(i));
        data.put("boards", keep);
        JSONArray a = items();
        for (int i = 0; i < a.length(); i++) {
            JSONObject it = a.getJSONObject(i);
            JSONArray ib = it.optJSONArray("boards"), nb = new JSONArray();
            boolean changed = false;
            if (ib != null) for (int j = 0; j < ib.length(); j++) { if (ib.getString(j).equals(id)) changed = true; else nb.put(ib.getString(j)); }
            if (changed) it.put("boards", nb).put("updatedAt", now());
        }
        data.getJSONObject("tombstones").getJSONArray("boards").put(new JSONObject().put("id", id).put("at", now()));
        save();
    }

    // ---------- sync ----------

    // Adopt the merged library from the PC. Thumbnails stay our own; files of removed items are deleted.
    synchronized void applyMerged(JSONObject merged) throws IOException, JSONException {
        JSONArray oldItems = items();
        java.util.Map<String, JSONObject> old = new java.util.HashMap<>();
        for (int i = 0; i < oldItems.length(); i++) old.put(oldItems.getJSONObject(i).getString("id"), oldItems.getJSONObject(i));
        JSONArray mi = merged.getJSONArray("items"), next = new JSONArray();
        Set<String> kept = new HashSet<>();
        for (int i = 0; i < mi.length(); i++) {
            JSONObject it = mi.getJSONObject(i);
            String id = it.getString("id");
            kept.add(id);
            JSONObject mine = old.get(id);
            it.put("thumb", mine != null && mine.has("thumb") ? mine.get("thumb") : JSONObject.NULL);
            for (String k : new String[]{"w", "h", "duration"}) if (!it.has(k) || it.isNull(k)) { if (mine != null && mine.has(k)) it.put(k, mine.get(k)); }
            next.put(it);
        }
        for (String id : old.keySet()) {
            if (kept.contains(id)) continue;
            JSONObject gone = old.get(id);
            if (gone.has("file") && !gone.isNull("file")) new File(root, gone.getString("file")).delete();
            new File(thumbs, id + ".jpg").delete();
        }
        data.put("items", next).put("boards", merged.getJSONArray("boards")).put("tombstones", merged.getJSONObject("tombstones"));
        save();
    }

    // First time with a PC: use the PC's boards. Phone boards with the same name (e.g. "Outfits") become the PC's
    // board, so there are no duplicates; phone-only boards are kept. No tombstones: nothing is deleted anywhere.
    synchronized void adoptBoards(JSONArray pcBoards) throws IOException, JSONException {
        java.util.Map<String, String> byName = new java.util.HashMap<>(), remap = new java.util.HashMap<>();
        for (int i = 0; i < pcBoards.length(); i++) byName.put(pcBoards.getJSONObject(i).getString("name").toLowerCase(Locale.ROOT), pcBoards.getJSONObject(i).getString("id"));
        JSONArray next = new JSONArray(), mine = boards();
        for (int i = 0; i < pcBoards.length(); i++) next.put(pcBoards.get(i));
        for (int i = 0; i < mine.length(); i++) {
            JSONObject b = mine.getJSONObject(i);
            String pcId = byName.get(b.getString("name").toLowerCase(Locale.ROOT));
            if (pcId != null) remap.put(b.getString("id"), pcId); else next.put(b);
        }
        data.put("boards", next);
        JSONArray a = items();
        for (int i = 0; i < a.length(); i++) {
            JSONObject it = a.getJSONObject(i);
            JSONArray ib = it.optJSONArray("boards"), nb = new JSONArray();
            if (ib == null) continue;
            boolean changed = false;
            for (int j = 0; j < ib.length(); j++) { String id = ib.getString(j); String to = remap.get(id); if (to != null) { changed = true; id = to; } nb.put(id); }
            if (changed) it.put("boards", nb).put("updatedAt", now());
        }
        save();
    }

    // Two boards with the same name (left over from syncing before boards were matched up) become one:
    // items move to the board that has the most, and a tombstone removes the empty twin on the PC too.
    synchronized boolean dedupeBoards() throws IOException, JSONException {
        JSONArray b = boards(), a = items();
        java.util.Map<String, Integer> count = new java.util.HashMap<>();
        for (int i = 0; i < a.length(); i++) {
            JSONArray ib = a.getJSONObject(i).optJSONArray("boards");
            if (ib != null) for (int j = 0; j < ib.length(); j++) count.merge(ib.getString(j), 1, Integer::sum);
        }
        java.util.Map<String, String> keepByName = new java.util.HashMap<>(), remap = new java.util.HashMap<>();
        for (int i = 0; i < b.length(); i++) {
            String id = b.getJSONObject(i).getString("id"), name = b.getJSONObject(i).getString("name").trim().toLowerCase(Locale.ROOT);
            String kept = keepByName.get(name);
            if (kept == null) { keepByName.put(name, id); continue; }
            if (count.getOrDefault(id, 0) > count.getOrDefault(kept, 0)) { remap.put(kept, id); keepByName.put(name, id); }
            else remap.put(id, kept);
        }
        if (remap.isEmpty()) return false;
        for (String from : new ArrayList<>(remap.keySet())) { // follow chains (three boards with one name)
            String to = remap.get(from);
            while (remap.containsKey(to)) to = remap.get(to);
            remap.put(from, to);
        }
        JSONArray keep = new JSONArray();
        for (int i = 0; i < b.length(); i++) if (!remap.containsKey(b.getJSONObject(i).getString("id"))) keep.put(b.get(i));
        data.put("boards", keep);
        for (int i = 0; i < a.length(); i++) {
            JSONObject it = a.getJSONObject(i);
            JSONArray ib = it.optJSONArray("boards");
            if (ib == null) continue;
            java.util.LinkedHashSet<String> nb = new java.util.LinkedHashSet<>();
            boolean changed = false;
            for (int j = 0; j < ib.length(); j++) { String id = ib.getString(j), to = remap.get(id); if (to != null) changed = true; nb.add(to != null ? to : id); }
            if (changed) it.put("boards", new JSONArray(nb)).put("updatedAt", now());
        }
        JSONArray tomb = data.getJSONObject("tombstones").getJSONArray("boards");
        for (String id : remap.keySet()) tomb.put(new JSONObject().put("id", id).put("at", now()));
        save();
        return true;
    }

    synchronized List<String> missingMedia() throws JSONException {
        List<String> out = new ArrayList<>();
        JSONArray a = items();
        for (int i = 0; i < a.length(); i++) {
            JSONObject it = a.getJSONObject(i);
            if (it.has("file") && !it.isNull("file") && !new File(root, it.getString("file")).exists()) out.add(it.getString("id"));
        }
        return out;
    }

    synchronized String fileOf(String id) throws JSONException { return item(id).optString("file", null); }

    // After a downloaded file arrives: make its preview and save.
    synchronized void afterDownload(String id) throws IOException, JSONException { makeThumb(item(id)); save(); }
}
