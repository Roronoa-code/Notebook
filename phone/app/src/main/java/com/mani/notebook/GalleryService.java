package com.mani.notebook;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

// Keeps a started Gallery cleanup session available to the PC while Notebook is in the background and the phone is
// locked (a foreground service with its own small notification, and a Stop button on it). It does no work itself:
// GallerySession does. A batch that needs Android's consent is announced with a second notification; tapping it opens
// Notebook just long enough to ask.
public class GalleryService extends Service {
    static final String CHANNEL = "gallery", ASK_CHANNEL = "gallery-ask", STOP = "com.mani.notebook.GALLERY_STOP";
    static final String CONFIRM = "com.mani.notebook.GALLERY_CONFIRM";
    static final int ID = 4101, ASK_ID = 4102, PLAY_ID = 4103;
    static volatile boolean running = false;

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Phone Gallery open on your PC", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(ASK_CHANNEL, "Phone Gallery confirmations", NotificationManager.IMPORTANCE_HIGH));
    }
    static PendingIntent openApp(Context c, String action, int code) {
        Intent i = new Intent(c, MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    static Notification build(Context c, String text) {
        PendingIntent stop = PendingIntent.getService(c, 1, new Intent(c, GalleryService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(c, CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Phone Gallery open on your PC")
            .setContentText(text).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(openApp(c, Intent.ACTION_MAIN, 2))
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build()).build();
    }
    static void update(Context c, String text) {
        if (!running) return;
        try { c.getSystemService(NotificationManager.class).notify(ID, build(c, text)); } catch (Exception ignored) { /* notifications off */ }
    }
    // "Trash 12 photos? Tap to confirm." Opens Notebook, which asks Android (no dialog when media management is allowed).
    static void ask(Context c, String title, String text) {
        channels(c);
        Notification n = new Notification.Builder(c, ASK_CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(text)
            .setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).setContentIntent(openApp(c, CONFIRM, 3)).build();
        try { c.getSystemService(NotificationManager.class).notify(ASK_ID, n); } catch (Exception ignored) { /* notifications off */ }
    }
    static void cancelAsk(Context c) { c.getSystemService(NotificationManager.class).cancel(ASK_ID); }
    static void notifyPlain(Context c, int id, String title, String text, PendingIntent tap) {
        channels(c);
        Notification n = new Notification.Builder(c, ASK_CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(text).setAutoCancel(true).setContentIntent(tap).build();
        try { c.getSystemService(NotificationManager.class).notify(id, n); } catch (Exception ignored) { /* notifications off */ }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { GallerySession.get(this).stop(); stopSelf(); return START_NOT_STICKY; }
        channels(this);
        Notification n = build(this, GallerySession.get(this).message());
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC); else startForeground(ID, n);
        running = true;
        return START_NOT_STICKY;
    }
    // Android's daily limit for this kind of background work: the session ends cleanly.
    @Override public void onTimeout(int startId, int type) { GallerySession.get(this).stop(); stopSelf(); }
    @Override public void onDestroy() { running = false; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
