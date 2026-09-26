package com.mani.notebook;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

// Offline Android checks: scripts/test-phone-ideas-native.ps1, with an explicit emulator selected.
public final class PhoneIdeasNetTest {
    public static void main(String[] args) throws Exception {
        check(PhoneIdeasNet.allowedUrl("https://www.pinterest.com/resource/BaseSearchResource/get/"), "Pinterest API URL");
        check(PhoneIdeasNet.allowedUrl("https://i.pinimg.com/474x/aa/bb/cc/0123456789abcdef0123456789abcdef.jpg"), "Pinterest picture URL");
        check(!PhoneIdeasNet.allowedUrl("http://i.pinimg.com/a.jpg"), "plain HTTP is blocked");
        check(!PhoneIdeasNet.allowedUrl("https://evil.example/i.jpg"), "unapproved host is blocked");

        String big = "https://i.pinimg.com/474x/aa/bb/cc/0123456789abcdef0123456789abcdef.jpg";
        String small = "https://i.pinimg.com/236x/aa/bb/cc/0123456789abcdef0123456789abcdef.jpg";
        String json = new JSONObject().put("resource_response", new JSONObject()
            .put("bookmark", "page-2")
            .put("data", new JSONObject().put("results", new org.json.JSONArray()
                .put(new JSONObject().put("id", "123456").put("title", "Black outfit")
                    .put("images", new JSONObject().put("474x", new JSONObject().put("url", big).put("width", 474).put("height", 600))
                        .put("236x", new JSONObject().put("url", small).put("width", 236).put("height", 300))))
                .put(new JSONObject().put("id", "999").put("is_promoted", true).put("images", new JSONObject().put("474x", new JSONObject().put("url", big))))))).toString();
        PhoneIdeasNet.Page page = PhoneIdeasNet.parsePage(json);
        check(page.pins.size() == 1 && "123456".equals(page.pins.get(0).optString("id")), "pin parsing and ad filtering");
        check("page-2".equals(page.bookmark), "bookmark parsing");
        check("0123456789abcdef0123456789abcdef".equals(page.pins.get(0).optString("sig")), "picture signature");

        String photoData = new JSONObject().put("resource_response", new JSONObject().put("data", new JSONObject().put("id", "123456")
            .put("images", new JSONObject().put("orig", new JSONObject().put("url", big))).put("videos", JSONObject.NULL))).toString();
        check(!PhoneIdeasNet.parseMedia(photoData, "123456").video, "videos:null stays a photo");
        String videoData = new JSONObject().put("resource_response", new JSONObject().put("data", new JSONObject().put("id", "123456")
            .put("images", new JSONObject().put("orig", new JSONObject().put("url", big))).put("videos", new JSONObject().put("video_list", new JSONObject()
                .put("hls", new JSONObject().put("url", "https://v1.pinimg.com/videos/a.m3u8").put("width", 1080))
                .put("mp4", new JSONObject().put("url", "https://v1.pinimg.com/videos/a.mp4").put("width", 720)))))).toString();
        check(PhoneIdeasNet.parseMedia(videoData, "123456").video, "direct MP4 wins over HLS");
        check(PhoneIdeasNet.parseMedia(videoData, "123456").url.endsWith("a.mp4"), "HLS is not selected for a direct save");
        check(!PhoneIdeasNet.supportedMime("text/html", big, false), "HTML is not an image fallback");
        File shortJpeg = File.createTempFile("notebook-ideas", ".jpg");
        try (FileOutputStream out = new FileOutputStream(shortJpeg)) { out.write(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff}); }
        check(!PhoneIdeasNet.validMediaFile(shortJpeg, false), "truncated image is rejected");
        shortJpeg.delete();
        File fakeJpeg = File.createTempFile("notebook-ideas", ".jpg");
        try (FileOutputStream out = new FileOutputStream(fakeJpeg)) { out.write(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xd9}); }
        check(!PhoneIdeasNet.validMediaFile(fakeJpeg, false), "magic-only image is rejected");
        fakeJpeg.delete();
        File headerOnlyMp4 = File.createTempFile("notebook-ideas", ".mp4");
        try (FileOutputStream out = new FileOutputStream(headerOnlyMp4)) { out.write(new byte[]{0, 0, 0, 8, 'f', 't', 'y', 'p'}); }
        check(!PhoneIdeasNet.validMediaFile(headerOnlyMp4, true), "header-only video is rejected");
        headerOnlyMp4.delete();

        PhoneIdeasNet.Source source = new PhoneIdeasNet.Source("search", "black outfit");
        source.bookmark = "page-2";
        source.used.add("page-1");
        check("page-2".equals(PhoneIdeasNet.Source.from(source.json()).bookmark), "bookmark round trip");
        check(PhoneIdeasNet.pinDataUrl("123456").startsWith("https://www.pinterest.com/resource/PinResource/get/"), "pin data endpoint");
        System.out.println("PhoneIdeasNet offline checks passed");
    }

    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
    private PhoneIdeasNetTest() {}
}
