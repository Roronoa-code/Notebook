package com.mani.notebook;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.concurrent.CompletableFuture;

// Durable, immutable batches. Retry only reads the journal/state; it never re-launches consent.
final class GalleryOperations {
    static final int REQUEST=72;
    final GallerySession session; final GalleryStore store; final File dir;
    volatile String pending;
    private CompletableFuture<JSONObject> completion;
    GalleryOperations(GallerySession session, GalleryStore store) {
        this.session=session; this.store=store; dir=new File(store.ctx.getFilesDir(),"gallery-operations"); dir.mkdirs();
    }
    File file(String id) throws IOException { if(!id.matches("[0-9a-f-]{36}"))throw new IOException("Invalid operation ID"); return new File(dir,id+".json"); }
    synchronized JSONObject read(String id) throws Exception {
        AtomicFile f=new AtomicFile(file(id)); if(!f.getBaseFile().exists())return null;
        return new JSONObject(new String(f.readFully(),StandardCharsets.UTF_8));
    }
    synchronized void save(JSONObject o) throws Exception {
        AtomicFile f=new AtomicFile(file(o.getString("id"))); FileOutputStream out=null;
        try { out=f.startWrite(); out.write(o.toString().getBytes(StandardCharsets.UTF_8)); f.finishWrite(out); }
        catch(Exception e) { if(out!=null)f.failWrite(out); throw e; }
    }
    String signature(String action, JSONArray items) throws Exception {
        StringBuilder s=new StringBuilder(action);
        for(int i=0;i<items.length();i++) { JSONObject it=items.getJSONObject(i); s.append('\n').append(it.getString("key")).append('\t').append(it.getString("fingerprint")); }
        return s.toString();
    }
    synchronized CompletableFuture<JSONObject> begin(JSONObject cmd) throws Exception {
        String id=cmd.getString("id"), action=cmd.getString("kind"); JSONArray items=cmd.getJSONObject("args").getJSONArray("items");
        if(!action.equals("trash")&&!action.equals("restore"))throw new IOException("Unsupported operation");
        if(items.length()<1 || items.length()>200)throw new IOException("Choose 1 to 200 items");
        String signature=signature(action,items); JSONObject old=read(id);
        if(old!=null) {
            if(!signature.equals(old.getString("signature")))throw new IOException("Operation ID already used with different items");
            return CompletableFuture.completedFuture(reconcile(id));
        }
        if(pending!=null)throw new IOException("Finish the current phone confirmation first");
        // A process restart must not silently start a new batch while the previous system request is unresolved.
        File[] prior=dir.listFiles((d,n)->n.endsWith(".json"));
        if(prior!=null)for(File f:prior) {
            JSONObject p=read(f.getName().replace(".json",""));
            if(p!=null && (p.optString("status").equals("awaiting consent")||p.optString("status").equals("unknown")))throw new IOException("Check the previous operation on the PC first");
        }
        if(!session.ready() || cmd.getLong("expiresAt")<System.currentTimeMillis())throw new IOException("Open an active cleanup session first");
        ArrayList<Uri> uris=new ArrayList<>(); HashSet<String> unique=new HashSet<>(); JSONArray results=new JSONArray();
        for(int i=0;i<items.length();i++) {
            JSONObject it=items.getJSONObject(i); String key=it.getString("key");
            if(!unique.add(key))throw new IOException("Duplicate item");
            if(action.equals("restore")) {
                JSONObject previous=read(cmd.getJSONObject("args").getString("restoreFrom")); boolean allowed=false;
                if(previous!=null && previous.optString("action").equals("trash")) {
                    JSONArray rr=previous.optJSONArray("results");
                    if(rr!=null)for(int j=0;j<rr.length();j++)if(rr.getJSONObject(j).optString("key").equals(key)&&rr.getJSONObject(j).optString("state").equals("trashed"))allowed=true;
                }
                if(!allowed)throw new IOException("Restore requires Notebook's confirmed trash journal");
            }
            try { store.validate(it,action.equals("restore")); uris.add(store.uri(key)); results.put(new JSONObject().put("key",key).put("state","pending")); }
            catch(Exception e) { results.put(new JSONObject().put("key",key).put("state","stale").put("message",e.getMessage())); }
        }
        JSONObject o=new JSONObject().put("id",id).put("action",action).put("signature",signature).put("items",items).put("results",results)
            .put("status",uris.isEmpty()?"finished":"awaiting consent"); save(o);
        if(uris.isEmpty())return CompletableFuture.completedFuture(o);
        pending=id; completion=new CompletableFuture<>(); CompletableFuture<JSONObject> answer=completion;
        session.activity.runOnUiThread(()-> {
            try {
                if(!session.ready() || cmd.getLong("expiresAt")<System.currentTimeMillis())throw new IOException("Session paused before confirmation");
                PendingIntent request=MediaStore.createTrashRequest(store.resolver,uris,action.equals("trash"));
                ActivityOptions options=ActivityOptions.makeBasic();
                if(Build.VERSION.SDK_INT>=36)options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE);
                else if(Build.VERSION.SDK_INT>=34)options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                session.activity.startIntentSenderForResult(request.getIntentSender(),REQUEST,null,0,0,0,options.toBundle());
                session.message("Confirm the batch on your phone if Android asks.");
            } catch(Exception e) { launchFailed(id,e); }
        });
        return answer;
    }
    private synchronized void launchFailed(String id, Exception error) {
        try { JSONObject o=read(id); o.put("status","failed").put("message",error.getMessage()); save(o); completion.complete(o); }
        catch(Exception e) { completion.completeExceptionally(e); }
        pending=null; completion=null;
    }
    synchronized JSONObject reconcile(String id) throws Exception {
        JSONObject o=read(id);
        if(o==null)return new JSONObject().put("status","not received").put("results",new JSONArray());
        if(id.equals(pending) && completion!=null && !completion.isDone())return new JSONObject().put("status","awaiting consent").put("results",o.getJSONArray("results"));
        if(o.optString("status").equals("failed") || o.optString("status").equals("cancelled"))return o;
        return observe(o, false);
    }
    private synchronized JSONObject observe(JSONObject o, boolean completed) throws Exception {
        boolean finalResult=completed || o.has("systemCancelled");
        JSONArray results=new JSONArray(), items=o.getJSONArray("items"), before=o.getJSONArray("results"); boolean unknown=false;
        for(int i=0;i<items.length();i++) {
            JSONObject it=items.getJSONObject(i), r=new JSONObject().put("key",it.getString("key"));
            if(before.getJSONObject(i).optString("state").equals("stale")) { results.put(before.getJSONObject(i)); continue; }
            try {
                JSONObject actual=store.inspect(it.getString("key"));
                if(actual==null)throw new IOException("Missing or inaccessible; not proof of trashing");
                String[] expected=it.getString("fingerprint").split(":"), seen=actual.getString("fingerprint").split(":");
                if(expected.length!=4 || seen.length!=4 || !expected[0].equals(seen[0]) || !expected[1].equals(seen[1]) || !expected[2].equals(seen[2]))throw new IOException("Media identity changed");
                boolean desired=o.getString("action").equals("trash");
                if(!finalResult && actual.getBoolean("trashed")!=desired && (o.optString("status").equals("awaiting consent") || o.optString("status").equals("unknown")))unknown=true;
                r.put("state",actual.getBoolean("trashed")==desired ? desired?"trashed":"restored" : "unchanged")
                    .put("fingerprint",actual.getString("fingerprint")).put("expires",actual.optLong("expires"));
            } catch(Exception e) { if(!finalResult)unknown=true; r.put("state",finalResult?"unavailable":"unknown").put("message",e.getMessage()); }
            results.put(r);
        }
        o.put("results",results).put("status",unknown?"unknown":"finished"); save(o); return o;
    }
    synchronized void receivedResult(int result) {
        // Clear the in-flight flag before read-only observation, preserving the future for delivery.
        String id=pending; if(id==null)return;
        CompletableFuture<JSONObject> future=completion; pending=null; completion=null;
        session.operationsWorker.execute(()-> {
            try { JSONObject o=observe(read(id),true); o.put("systemCancelled",result!=Activity.RESULT_OK); save(o); future.complete(o); }
            catch(Exception e) { future.completeExceptionally(e); }
            session.message("Batch checked. Continue on your PC.");
        });
    }
}
