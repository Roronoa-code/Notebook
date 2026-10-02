package com.mani.notebook;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ArrayBlockingQueue;

// A session you start once on the phone: from then on it stays available to the PC with Notebook in the background and
// the phone locked (GalleryService keeps it running, with a notification and a Stop button), until you stop it or it
// has not been used for 30 minutes. Library SyncJob and its lock are deliberately not involved. One per app process.
final class GallerySession {
    static final int PERMISSIONS=71;
    static final long IDLE_MS=30*60*1000L;
    private static GallerySession one;
    static synchronized GallerySession get(Context c) { if(one==null)one=new GallerySession(c.getApplicationContext()); return one; }
    final Context ctx; final GalleryStore store; final GalleryOperations operations;
    volatile MainActivity ui; // the app's screen, while it exists (messages, permission prompts, Android's consent)
    private volatile long used=0;
    final ExecutorService operationsWorker=Executors.newSingleThreadExecutor();
    private final ExecutorService control=Executors.newSingleThreadExecutor();
    private final ThreadPoolExecutor media=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(64));
    private final Set<HttpURLConnection> connections=Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Set<CancellationSignal> signals=Collections.newSetFromMap(new ConcurrentHashMap<>());
    volatile boolean active=false, resumed=false;
    private volatile String id="", base="", message="Start a session to clean up from your PC.";
    private GallerySession(Context c) { ctx=c; store=new GalleryStore(c); operations=new GalleryOperations(this,store); }
    // Ready while started and allowed to read photos: the app need not be open, nor the phone unlocked.
    boolean ready() { return active && !store.scope().equals("No access"); }
    String message() { return message; }
    void message(String s) { message=s; MainActivity a=ui; if(a!=null)a.galleryMessage(status()); GalleryService.update(ctx,s); }
    String status() {
        try { return new JSONObject().put("active",active).put("ready",ready()).put("scope",store.scope()).put("message",message)
            .put("manage",Build.VERSION.SDK_INT>=31 && MediaStore.canManageMedia(ctx)).toString(); }
        catch(Exception e) { return "{}"; }
    }
    void permissions() {
        if(Build.VERSION.SDK_INT<30) { message("Gallery cleanup needs Android 11 or later."); return; }
        stop();
        String[] wanted=Build.VERSION.SDK_INT>=34 ? new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED}
            : Build.VERSION.SDK_INT>=33 ? new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO} : new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
        MainActivity a=ui; if(a!=null)a.requestPermissions(wanted,PERMISSIONS);
    }
    void manage() {
        if(Build.VERSION.SDK_INT<31)return;
        try { ui.startActivity(new Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA,Uri.parse("package:"+ctx.getPackageName()))); }
        catch(Exception e) { message("Media-management access is unavailable. Android will ask you to confirm each batch."); }
    }
    void start() {
        if(active)return;
        if(Build.VERSION.SDK_INT<30 || store.scope().equals("No access")) { permissions(); return; }
        active=true; id=UUID.randomUUID().toString(); final String session=id; used=System.currentTimeMillis();
        // (the confirmation notification needs this on Android 13+; the session runs either way)
        MainActivity a=ui;
        if(a!=null && Build.VERSION.SDK_INT>=33 && a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)a.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},PERMISSIONS+10);
        message("Connecting securely to your PC…");
        try { ctx.startForegroundService(new Intent(ctx,GalleryService.class)); } catch(Exception e) { message("Could not keep the session running in the background: "+safe(e)); }
        control.execute(()-> {
            while(active && id.equals(session)) {
                try {
                    base=Core.sync(ctx).galleryBase();
                    send("session",new JSONObject().put("sessionId",session).put("scope",store.scope()),session);
                    message("Ready on your PC. You can leave Notebook and lock your phone.");
                    while(active && id.equals(session)) {
                        if(System.currentTimeMillis()-used>IDLE_MS && operations.pending==null) { message("Closed after 30 minutes without use. Start again when you need it."); stop(); return; }
                        JSONObject response=send("poll",new JSONObject().put("ready",ready()).put("scope",store.scope()),session);
                        if(response.optBoolean("restart"))break;
                        JSONObject cmd=response.optJSONObject("command"); if(cmd!=null) { used=System.currentTimeMillis(); dispatch(cmd,session); }
                    }
                } catch(Exception e) {
                    if(active && id.equals(session))message("Connection paused: "+safe(e));
                    try { Thread.sleep(2000); } catch(InterruptedException ignored) { break; }
                }
            }
        });
    }
    // Leaving the app no longer ends the session (GalleryService keeps it going).
    void pause() { resumed=false; }
    void stop() {
        boolean was=active; String session=id; active=false;
        for(CancellationSignal signal:signals)signal.cancel(); for(HttpURLConnection c:connections)c.disconnect();
        media.getQueue().clear();
        if(was && !base.isEmpty())operationsWorker.execute(()-> { try { send("stop",new JSONObject(),session); } catch(Exception ignored) {} });
        if(was)message("Session stopped. Start again when you are ready.");
        GalleryService.cancelAsk(ctx);
        try { ctx.stopService(new Intent(ctx,GalleryService.class)); } catch(Exception ignored) { /* not running */ }
    }
    void destroy() { stop(); control.shutdownNow(); media.shutdownNow(); operationsWorker.shutdown(); }
    private void dispatch(JSONObject cmd,String session) throws Exception {
        if(!session.equals(cmd.getString("sessionId")) || cmd.getLong("expiresAt")<System.currentTimeMillis() || !ready()) { result(cmd,new JSONObject().put("error","Session paused or request expired"),session); return; }
        String kind=cmd.getString("kind");
        if(kind.equals("trash") || kind.equals("restore")) {
            operationsWorker.execute(()-> {
                try { operations.begin(cmd).whenComplete((value,error)-> { try { result(cmd,error==null?value:new JSONObject().put("error",safe(error)),session); } catch(Exception ignored) {} }); }
                catch(Exception e) { error(cmd,e,session); }
            }); return;
        }
        if(kind.equals("reconcile")) { operationsWorker.execute(()-> { try { result(cmd,operations.reconcile(cmd.getJSONObject("args").getString("operationId")),session); } catch(Exception e) { error(cmd,e,session); } }); return; }
        try { media.execute(()-> {
            CancellationSignal signal=new CancellationSignal(); signals.add(signal);
            try {
                if(!active || !id.equals(session) || !ready())throw new IOException("Session paused");
                JSONObject args=cmd.getJSONObject("args");
                switch(kind) {
                    case "list": result(cmd,store.list(args.optJSONObject("cursor"),signal),session); break;
                    case "thumb": case "preview": case "video": transfer(cmd,session,signal); break;
                    case "hash": {
                        JSONArray keys=args.getJSONArray("keys"); JSONObject hashes=new JSONObject();
                        if(keys.length()>200)throw new IOException("Too many items");
                        for(int i=0;i<keys.length();i++) { String k=keys.getString(i); try { hashes.put(k,store.sha1(k,signal)); } catch(java.util.concurrent.CancellationException e) { throw e; } catch(Exception e) { hashes.put(k,JSONObject.NULL); } }
                        result(cmd,new JSONObject().put("hashes",hashes),session); break;
                    }
                    case "open":
                        JSONObject it=args.getJSONObject("item"); JSONObject actual=store.validate(it,false); Uri uri=store.uri(it.getString("key"));
                        Intent view=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,actual.optString("mime")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
                        MainActivity a=ui;
                        if(a!=null && resumed) a.runOnUiThread(()-> { try { a.startActivity(view); } catch(Exception e) { message("No phone app could open this media."); } });
                        else GalleryService.notifyPlain(ctx,GalleryService.PLAY_ID,"Play on your phone",actual.optString("name","Tap to open it"),PendingIntent.getActivity(ctx,4,view,PendingIntent.FLAG_IMMUTABLE)); // (Android won't open it from the background)
                        result(cmd,new JSONObject().put("ok",true),session); break;
                    default: throw new IOException("Unknown Gallery command");
                }
            } catch(Exception e) { error(cmd,e,session); }
            finally { signals.remove(signal); }
        }); } catch(java.util.concurrent.RejectedExecutionException e) { error(cmd,new IOException("Preview queue full; try again"),session); }
    }
    private void transfer(JSONObject cmd,String session,CancellationSignal signal) throws Exception {
        JSONObject item=cmd.getJSONObject("args").getJSONObject("item"); String kind=cmd.getString("kind");
        JSONObject actual=store.validate(item,false);
        HttpURLConnection c=Core.sync(ctx).galleryConnection(base,"stream/"+cmd.getString("id"),session); connections.add(c);
        try {
            c.setRequestMethod("PUT"); c.setReadTimeout(180000); c.setDoOutput(true); c.setChunkedStreamingMode(65536);
            c.setRequestProperty("Content-Type",kind.equals("video")?actual.getString("mime"):"image/jpeg");
            if(kind.equals("video") && actual.getLong("size")>256L*1024*1024)throw new IOException("This video is over 256 MB. Use Play on phone.");
            try(OutputStream out=c.getOutputStream()) {
                if(kind.equals("video")) {
                    if(!actual.getString("type").equals("video"))throw new IOException("Not a video");
                    try(InputStream in=store.resolver.openInputStream(store.uri(item.getString("key")))) {
                        if(in==null)throw new IOException("Video unavailable"); byte[] buffer=new byte[65536]; long size=0; int n;
                        while((n=in.read(buffer))!=-1) {
                            signal.throwIfCanceled(); if(!ready() || !session.equals(id))throw new IOException("Session paused");
                            size+=n; if(size>256L*1024*1024)throw new IOException("Video exceeds preview limit. Use Play on phone."); out.write(buffer,0,n);
                        }
                    }
                } else store.preview(item,kind.equals("preview"),out,signal);
            }
            if(c.getResponseCode()!=200)throw new IOException("Preview cancelled by PC");
        } finally { connections.remove(c); c.disconnect(); }
    }
    private JSONObject send(String route,JSONObject body,String session) throws Exception {
        HttpURLConnection c=Core.sync(ctx).galleryConnection(base,route,session); connections.add(c);
        try {
            byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8); c.setDoOutput(true); c.setFixedLengthStreamingMode(bytes.length); c.setRequestProperty("Content-Type","application/json");
            try(OutputStream out=c.getOutputStream()) { out.write(bytes); }
            int code=c.getResponseCode();
            try(InputStream in=code==200?c.getInputStream():c.getErrorStream()) {
                if(in==null)throw new IOException("PC returned "+code); ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] buf=new byte[8192]; int n;
                while((n=in.read(buf))!=-1) { if(out.size()+n>1024*1024)throw new IOException("Response too large"); out.write(buf,0,n); }
                JSONObject result=new JSONObject(out.toString("UTF-8")); if(code!=200)throw new IOException(result.optString("error","PC returned "+code)); return result;
            }
        } finally { connections.remove(c); c.disconnect(); }
    }
    private void result(JSONObject cmd,JSONObject value,String session) throws Exception { send("result/"+cmd.getString("id"),value,session); }
    private void error(JSONObject cmd,Exception e,String session) { try { result(cmd,new JSONObject().put("error",safe(e)),session); } catch(Exception ignored) {} }
    private static String safe(Throwable e) { return e.getMessage()==null?e.getClass().getSimpleName():e.getMessage(); }
}
