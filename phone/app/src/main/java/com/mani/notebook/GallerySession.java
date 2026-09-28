package com.mani.notebook;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.WindowManager;
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

// Explicit foreground session. Library SyncJob and its lock are deliberately not involved.
final class GallerySession {
    static final int PERMISSIONS=71;
    final MainActivity activity; final GalleryStore store; final GalleryOperations operations;
    final ExecutorService operationsWorker=Executors.newSingleThreadExecutor();
    private final ExecutorService control=Executors.newSingleThreadExecutor();
    private final ThreadPoolExecutor media=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(64));
    private final Set<HttpURLConnection> connections=Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Set<CancellationSignal> signals=Collections.newSetFromMap(new ConcurrentHashMap<>());
    volatile boolean active=false, resumed=false;
    private volatile String id="", base="", message="Start a session to clean up from your PC.";
    GallerySession(MainActivity a) { activity=a; store=new GalleryStore(a); operations=new GalleryOperations(this,store); }
    boolean ready() { return active && resumed && !activity.getSystemService(KeyguardManager.class).isKeyguardLocked() && !store.scope().equals("No access"); }
    void message(String s) { message=s; activity.galleryMessage(status()); }
    String status() {
        try { return new JSONObject().put("active",active).put("ready",ready()).put("scope",store.scope()).put("message",message)
            .put("manage",Build.VERSION.SDK_INT>=31 && MediaStore.canManageMedia(activity)).toString(); }
        catch(Exception e) { return "{}"; }
    }
    void permissions() {
        if(Build.VERSION.SDK_INT<30) { message("Gallery cleanup needs Android 11 or later."); return; }
        stop();
        String[] wanted=Build.VERSION.SDK_INT>=34 ? new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED}
            : Build.VERSION.SDK_INT>=33 ? new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO} : new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
        activity.requestPermissions(wanted,PERMISSIONS);
    }
    void manage() {
        if(Build.VERSION.SDK_INT<31)return;
        try { activity.startActivity(new Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA,Uri.parse("package:"+activity.getPackageName()))); }
        catch(Exception e) { message("Media-management access is unavailable. Android will ask you to confirm each batch."); }
    }
    void start() {
        if(active)return;
        if(Build.VERSION.SDK_INT<30 || store.scope().equals("No access")) { permissions(); return; }
        active=true; id=UUID.randomUUID().toString(); final String session=id;
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        message("Connecting securely to your PC…");
        control.execute(()-> {
            while(active && id.equals(session)) {
                try {
                    base=Core.sync(activity).galleryBase();
                    send("session",new JSONObject().put("sessionId",session).put("scope",store.scope()),session);
                    message("Ready on your PC. Keep Notebook open and your phone unlocked.");
                    while(active && id.equals(session)) {
                        JSONObject response=send("poll",new JSONObject().put("ready",ready()).put("scope",store.scope()),session);
                        if(response.optBoolean("restart"))break;
                        JSONObject cmd=response.optJSONObject("command"); if(cmd!=null)dispatch(cmd,session);
                    }
                } catch(Exception e) {
                    if(active && id.equals(session))message("Connection paused: "+safe(e));
                    try { Thread.sleep(2000); } catch(InterruptedException ignored) { break; }
                }
            }
        });
    }
    void pause() {
        resumed=false;
        // The system consent Activity pauses us too. Preserve its one pending batch, but advertise not ready.
        if(operations.pending==null)stop();
    }
    void stop() {
        boolean was=active; String session=id; active=false;
        for(CancellationSignal signal:signals)signal.cancel(); for(HttpURLConnection c:connections)c.disconnect();
        media.getQueue().clear();
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(was && !base.isEmpty())operationsWorker.execute(()-> { try { send("stop",new JSONObject(),session); } catch(Exception ignored) {} });
        message("Session stopped. Start again when you are ready.");
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
                    case "open":
                        JSONObject it=args.getJSONObject("item"); JSONObject actual=store.validate(it,false); Uri uri=store.uri(it.getString("key"));
                        activity.runOnUiThread(()-> {
                            try {
                                if(!ready())throw new IOException("Session paused");
                                activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,actual.optString("mime")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                            } catch(Exception e) { message("No phone app could open this media."); }
                        });
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
        HttpURLConnection c=Core.sync(activity).galleryConnection(base,"stream/"+cmd.getString("id"),session); connections.add(c);
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
        HttpURLConnection c=Core.sync(activity).galleryConnection(base,route,session); connections.add(c);
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
