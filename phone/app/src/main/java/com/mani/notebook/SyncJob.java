package com.mani.notebook;

import android.app.job.JobParameters;
import android.app.job.JobService;

// Background sync: runs quietly when Android allows (about every 15 minutes with a network).
public class SyncJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            boolean retry = false;
            try {
                SyncClient s = Core.sync(this);
                if (s.paired()) {
                    s.sync(null);
                    Runnable r = Core.onLibraryChanged;
                    if (r != null) r.run();
                }
            } catch (Exception e) {
                ErrorLog.failed("background sync", e);
                retry = false; // PC off or away from home: try again at the next slot
            }
            jobFinished(params, retry);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
