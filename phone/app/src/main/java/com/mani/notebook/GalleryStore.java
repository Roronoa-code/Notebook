package com.mani.notebook;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import android.util.Size;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Set;

// Read shared media through MediaStore. Never read or delete arbitrary paths supplied by the PC.
final class GalleryStore {
    final Context ctx;
    final ContentResolver resolver;
    static final String[] COLUMNS = { "_id", "media_type", "_display_name", "mime_type", "_size", "width", "height", "date_added", "date_modified", "generation_modified", "is_trashed", "duration", "date_expires" };
    GalleryStore(Context ctx) { this.ctx=ctx.getApplicationContext(); resolver=ctx.getContentResolver(); }
    boolean granted(String p) { return ctx.checkSelfPermission(p)==PackageManager.PERMISSION_GRANTED; }
    String scope() {
        if (Build.VERSION.SDK_INT < 30) return "unsupported";
        if (Build.VERSION.SDK_INT < 33) return granted(Manifest.permission.READ_EXTERNAL_STORAGE) ? "All photos and videos" : "No access";
        boolean images=granted(Manifest.permission.READ_MEDIA_IMAGES), videos=granted(Manifest.permission.READ_MEDIA_VIDEO);
        boolean selected=Build.VERSION.SDK_INT>=34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        if (images && videos) return "All photos and videos";
        if (images) return selected ? "All photos and selected videos" : "Photos only";
        if (videos) return selected ? "All videos and selected photos" : "Videos only";
        return selected ? "Selected photos and videos" : "No access";
    }
    void requireAccess() throws IOException { if (scope().equals("No access") || Build.VERSION.SDK_INT<30) throw new IOException("Allow photo and video access on the phone first."); }
    Uri uri(String key) throws IOException {
        if (key==null || !key.matches("[a-zA-Z0-9_-]{1,80}:(image|video):[0-9]{1,20}")) throw new IOException("Invalid Gallery identity");
        String[] parts=key.split(":");
        if (!MediaStore.getExternalVolumeNames(ctx).contains(parts[0])) throw new IOException("Storage volume unavailable");
        try { return ContentUris.withAppendedId(parts[1].equals("image") ? MediaStore.Images.Media.getContentUri(parts[0]) : MediaStore.Video.Media.getContentUri(parts[0]), Long.parseLong(parts[2])); }
        catch (NumberFormatException e) { throw new IOException("Invalid media number"); }
    }
    JSONObject row(Cursor c, String volume, String version) throws Exception {
        long id=c.getLong(0); boolean video=c.getInt(1)==3;
        return new JSONObject().put("key", volume+":"+(video?"video":"image")+":"+id)
            .put("name", c.getString(2)).put("mime", c.getString(3)).put("size", c.getLong(4))
            .put("width", c.getInt(5)).put("height", c.getInt(6)).put("date", c.getLong(7))
            .put("fingerprint", version+":"+c.getLong(4)+":"+c.getLong(8)+":"+c.getLong(9))
            .put("trashed", c.getInt(10)==1).put("duration", c.getLong(11)/1000.0).put("expires", c.getLong(12))
            .put("type", video?"video":"image").put("volume", volume).put("mediaId", Long.toString(id));
    }
    JSONObject inspect(String key) throws Exception {
        requireAccess(); uri(key); String[] parts=key.split(":");
        Uri u=MediaStore.Files.getContentUri(parts[0],Long.parseLong(parts[2])); Bundle args=new Bundle();
        args.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_INCLUDE);
        String volume=key.split(":")[0];
        try (Cursor c=resolver.query(u, COLUMNS, args, null)) { return c!=null && c.moveToFirst() ? row(c, volume, MediaStore.getVersion(ctx,volume)) : null; }
    }
    JSONObject validate(JSONObject expected, boolean trashed) throws Exception {
        JSONObject actual=inspect(expected.getString("key"));
        if (actual==null) throw new IOException("Item is missing or inaccessible");
        if (!actual.getString("key").equals(expected.getString("key")) || actual.getBoolean("trashed")!=trashed || !actual.getString("fingerprint").equals(expected.getString("fingerprint"))) throw new IOException("Item changed since review; refresh before trying again");
        return actual;
    }
    JSONObject list(JSONObject cursor, CancellationSignal cancel) throws Exception {
        requireAccess(); ArrayList<JSONObject> rows=new ArrayList<>();
        Set<String> volumes=MediaStore.getExternalVolumeNames(ctx);
        for (String volume : volumes) {
            String version=MediaStore.getVersion(ctx,volume);
            String where="(media_type=1 OR media_type=3) AND is_pending=0 AND is_trashed=0";
            ArrayList<String> params=new ArrayList<>();
            if (cursor!=null) {
                where+=" AND (date_added < ? OR (date_added = ? AND _id "+(volume.compareTo(cursor.getString("volume"))>0?"<=":"<")+" ?))";
                params.add(cursor.getString("date")); params.add(cursor.getString("date")); params.add(cursor.getString("mediaId"));
            }
            Bundle args=new Bundle();
            args.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, where);
            args.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, params.toArray(new String[0]));
            args.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "date_added DESC, _id DESC");
            args.putInt(ContentResolver.QUERY_ARG_LIMIT,257);
            try (Cursor c=resolver.query(MediaStore.Files.getContentUri(volume), COLUMNS, args, cancel)) {
                int count=0;
                while (c!=null && c.moveToNext() && count++<257) { cancel.throwIfCanceled(); rows.add(row(c,volume,version)); }
            }
        }
        rows.sort((a,b)-> {
            int date=Long.compare(b.optLong("date"),a.optLong("date")); if(date!=0)return date;
            int id=Long.compare(Long.parseLong(b.optString("mediaId")),Long.parseLong(a.optString("mediaId"))); if(id!=0)return id;
            return a.optString("volume").compareTo(b.optString("volume"));
        });
        JSONArray page=new JSONArray(); for(int i=0;i<Math.min(256,rows.size());i++)page.put(rows.get(i));
        JSONObject next=null;
        if(rows.size()>256) { JSONObject last=rows.get(255); next=new JSONObject().put("date",Long.toString(last.getLong("date"))).put("mediaId",last.getString("mediaId")).put("volume",last.getString("volume")); }
        return new JSONObject().put("items",page).put("cursor",next==null?JSONObject.NULL:next).put("scope",scope());
    }
    void preview(JSONObject expected, boolean large, OutputStream out, CancellationSignal cancel) throws Exception {
        JSONObject actual=validate(expected,false); Uri u=uri(expected.getString("key")); Bitmap bitmap;
        if (!large || actual.getString("type").equals("video")) bitmap=resolver.loadThumbnail(u,new Size(large?1280:320,large?1280:320),cancel);
        else bitmap=ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver,u),(decoder,info,source)-> {
            Size size=info.getSize(); double scale=Math.min(1,2048.0/Math.max(size.getWidth(),size.getHeight()));
            decoder.setTargetSize(Math.max(1,(int)(size.getWidth()*scale)),Math.max(1,(int)(size.getHeight()*scale)));
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE); decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB));
        });
        try { cancel.throwIfCanceled(); if(!bitmap.compress(Bitmap.CompressFormat.JPEG,large?88:78,out))throw new IOException("Preview failed"); }
        finally { bitmap.recycle(); }
    }
}
