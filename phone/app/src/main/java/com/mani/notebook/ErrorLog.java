package com.mani.notebook;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;

// The phone's error log: script errors on the screens, crashes and failed syncs, kept in the app's own
// storage (about the last 256 KB) and handed to the PC with the next sync, which adds it to its own log.
// It's there so problems can be found without anyone having to notice them first.
final class ErrorLog {
    private static File file, sending;
    private static boolean crashes;

    static synchronized void init(Context ctx) {
        if (file != null) return;
        file = new File(ctx.getFilesDir(), "errors.log");
        sending = new File(ctx.getFilesDir(), "errors.sending.log");
        if (crashes) return;
        crashes = true;
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> { add("crash", e); if (before != null) before.uncaughtException(t, e); });
    }

    static synchronized void add(String where, String text) {
        if (file == null) return;
        try {
            if (file.length() > 256 * 1024) { File old = new File(file.getPath() + ".old"); old.delete(); file.renameTo(old); }
            try (FileOutputStream out = new FileOutputStream(file, true)) { out.write((Library.now() + " [" + where + "] " + text + "\n").getBytes(StandardCharsets.UTF_8)); }
        } catch (Exception ignored) { /* the log must never break anything */ }
    }

    static void add(String where, Throwable e) {
        StringWriter w = new StringWriter();
        e.printStackTrace(new PrintWriter(w));
        add(where, w.toString().trim());
    }

    // A failure worth keeping: not "the PC isn't around" (normal away from home) or a dropped connection.
    static void failed(String where, Exception e) {
        if (SyncClient.CANT_FIND.equals(e.getMessage())) return;
        for (Throwable t = e; t != null; t = t.getCause()) if (t.getClass().getName().startsWith("java.net.")) return;
        add(where, e);
    }

    // What to send to the PC (the last 48 KB of it), or "" when there's nothing. It's set aside first, so
    // anything logged meanwhile waits for next time; sent() lets go of it once the PC has it.
    static synchronized String take() {
        if (file == null) return "";
        if (!sending.exists() && file.exists() && file.length() > 0 && !file.renameTo(sending)) return "";
        if (!sending.exists()) return "";
        try (InputStream in = new FileInputStream(sending)) {
            long skip = Math.max(0, sending.length() - 48 * 1000);
            if (skip > 0 && in.skip(skip) < skip) return "";
            byte[] b = new byte[(int) (sending.length() - skip)];
            int n = 0, k;
            while (n < b.length && (k = in.read(b, n, b.length - n)) > 0) n += k;
            return new String(b, 0, n, StandardCharsets.UTF_8);
        } catch (Exception e) { return ""; }
    }

    static synchronized void sent() { if (sending != null) sending.delete(); }

    private ErrorLog() {}
}
