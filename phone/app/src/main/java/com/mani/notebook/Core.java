package com.mani.notebook;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

import java.io.File;
import java.util.concurrent.locks.ReentrantLock;

// One library and one sync client for the whole app, shared by the screen and the background sync job.
final class Core {
    private static Library lib;
    private static SyncClient sync;
    static final ReentrantLock syncLock = new ReentrantLock();
    static volatile Runnable onLibraryChanged; // the open screen listens here to refresh after a background sync

    static synchronized Library library(Context ctx) throws Exception {
        if (lib == null) lib = new Library(new File(ctx.getFilesDir(), "library"));
        return lib;
    }

    static synchronized SyncClient sync(Context ctx) throws Exception {
        if (sync == null) sync = new SyncClient(ctx.getApplicationContext(), library(ctx));
        return sync;
    }

    // Once paired, the phone checks in with the PC about every 15 minutes whenever it has a network, even with the app closed.
    static void scheduleBackgroundSync(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null) return;
        JobInfo job = new JobInfo.Builder(1, new ComponentName(ctx, SyncJob.class))
            .setPeriodic(15 * 60 * 1000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build();
        js.schedule(job);
    }

    static void cancelBackgroundSync(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(1);
    }

    private Core() {}
}
