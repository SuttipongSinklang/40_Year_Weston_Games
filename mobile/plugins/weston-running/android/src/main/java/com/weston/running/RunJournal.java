package com.weston.running;

import android.content.Context;
import android.location.Location;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Process singleton: a WebView reload never owns or interrupts native capture. */
final class RunJournal {
    private static RunJournal instance;
    static synchronized RunJournal get(Context context) throws Exception {
        if (instance == null) instance = new RunJournal(context.getApplicationContext());
        return instance;
    }
    private final AtomicFile file;
    private JSONObject state;
    private boolean diskFailed;
    private Runnable changed;
    private int fixes;

    private RunJournal(Context context) throws Exception {
        // noBackupFilesDir excludes both cloud backup and device-to-device backup.
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "weston-run-v1.json"));
        if (file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists()) {
            state = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            validate(state);
            fixes = countFixes(state);
            if (active()) pause(lastAt(), "การบันทึกถูกขัดจังหวะ กดวิ่งต่อเมื่อพร้อม");
        } else state = empty(0);
    }
    private static JSONObject empty(long revision) throws Exception {
        return new JSONObject().put("version", 1).put("id", JSONObject.NULL).put("mode", "idle")
            .put("events", new JSONArray()).put("revision", revision).put("message", "พร้อมวิ่ง · บันทึกต่อได้เมื่อล็อกจอ");
    }
    private static void validate(JSONObject data) throws Exception {
        if (data.getInt("version") != 1 || data.getJSONArray("events").length() > 40010
            || !data.getString("mode").matches("idle|acquiring|running|paused|finished")) throw new Exception("Invalid native journal");
        if (!data.isNull("id")) UUID.fromString(data.getString("id"));
        long previous = Long.MIN_VALUE;
        JSONArray events = data.getJSONArray("events");
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i);
            long at = event.getLong("at");
            if (at < previous || !event.getString("type").matches("fix|pause|finish")) throw new Exception("Invalid journal event");
            previous = at;
        }
    }
    private static int countFixes(JSONObject data) throws Exception {
        int count = 0; JSONArray events = data.getJSONArray("events");
        for (int i = 0; i < events.length(); i++) if ("fix".equals(events.getJSONObject(i).getString("type"))) count++;
        return count;
    }
    synchronized void attach(Runnable callback) { changed = callback; }
    synchronized void detach(Runnable callback) { if (changed == callback) changed = null; }
    synchronized JSONObject snapshot() throws Exception { return new JSONObject(state.toString()); }
    synchronized boolean active() { String mode = state.optString("mode"); return "running".equals(mode) || "acquiring".equals(mode); }
    private long lastAt() { JSONArray events = state.optJSONArray("events"); return events.length() == 0 ? 0 : events.optJSONObject(events.length() - 1).optLong("at"); }
    private void commit(JSONObject next) throws Exception {
        if (next.getJSONArray("events").length() > 40010) throw new Exception("Native journal transition limit");
        next.put("revision", state.optLong("revision") + 1);
        byte[] bytes = next.toString().getBytes(StandardCharsets.UTF_8);
        FileOutputStream stream = null;
        try {
            stream = file.startWrite(); stream.write(bytes); stream.getFD().sync(); file.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            diskFailed = true; throw error;
        }
        state = next; fixes = countFixes(next); diskFailed = false;
        if (changed != null) changed.run();
    }
    synchronized void start() throws Exception {
        if (diskFailed) throw new Exception("Native storage unavailable");
        if (active()) return;
        if ("finished".equals(state.optString("mode"))) throw new Exception("Save finished run first");
        if (fixes >= 10000) throw new Exception("Run journal full; finish recording");
        if (state.getJSONArray("events").length() >= 40000) throw new Exception("Run journal transition limit; finish recording");
        JSONObject next = snapshot();
        if (next.isNull("id")) next.put("id", UUID.randomUUID().toString());
        next.put("mode", "acquiring").put("acquisition_at", System.currentTimeMillis())
            .put("message", "กำลังรอ GPS · เวลาเริ่มเมื่อได้ตำแหน่งชัดเจน");
        commit(next);
    }
    synchronized void pause(long at, String message) throws Exception {
        if (!active()) return;
        JSONObject next = snapshot();
        if (fixes == 0) next = empty(state.optLong("revision"));
        else { next.getJSONArray("events").put(new JSONObject().put("type", "pause").put("at", Math.max(lastAt(), at))); next.put("mode", "paused"); }
        next.remove("acquisition_at"); next.put("message", message); commit(next);
    }
    synchronized void finish(long at) throws Exception {
        if ("finished".equals(state.optString("mode")) || state.isNull("id")) return;
        JSONObject next = snapshot();
        if (fixes == 0) next = empty(state.optLong("revision"));
        else { next.getJSONArray("events").put(new JSONObject().put("type", "finish").put("at", Math.max(lastAt(), at))); next.put("mode", "finished").put("message", "จบแล้ว · กดบันทึกเพื่อเก็บเข้าประวัติ"); }
        next.remove("acquisition_at"); commit(next);
    }
    synchronized void interrupt(String message) throws Exception { pause(lastAt(), message); }
    synchronized void acknowledge(String id) throws Exception {
        if ("finished".equals(state.optString("mode")) && id.equals(state.optString("id"))) commit(empty(state.optLong("revision")));
    }
    synchronized void fix(Location location, long arrival) throws Exception {
        if (!active()) return;
        double lat = location.getLatitude(), lng = location.getLongitude(), accuracy = location.getAccuracy();
        long at = location.getTime();
        if (!Double.isFinite(lat) || !Double.isFinite(lng) || !Double.isFinite(accuracy) || Math.abs(lat) > 90 || Math.abs(lng) > 180
            || !location.hasAccuracy() || accuracy < 0 || accuracy > 40 || at < arrival - 15000 || at > arrival + 10000
            || at < lastAt() || at < state.optLong("acquisition_at", 0)) return;
        JSONArray events = state.getJSONArray("events");
        for (int i = events.length() - 1; i >= 0; i--) {
            JSONObject event = events.getJSONObject(i);
            if ("fix".equals(event.optString("type"))) { if (at <= event.getLong("timestamp")) return; break; }
        }
        JSONObject next = snapshot();
        next.getJSONArray("events").put(new JSONObject().put("type", "fix").put("at", at).put("timestamp", at)
            .put("latitude", lat).put("longitude", lng).put("accuracy", accuracy));
        next.put("mode", "running").put("message", "กำลังวิ่ง · บันทึกต่อเมื่อล็อกจอ");
        if (fixes + 1 >= 10000 || next.getJSONArray("events").length() >= 40000) {
            next.getJSONArray("events").put(new JSONObject().put("type", "pause").put("at", at));
            next.put("mode", "paused").put("message", "ถึงขีดจำกัดจุด GPS กรุณาจบและบันทึกรอบนี้");
        }
        commit(next);
    }
    synchronized void emergencyPause(String message) {
        // Failed write leaves the last durable file untouched; represent that capture stopped.
        try {
            JSONObject next = snapshot();
            if (fixes == 0) next = empty(state.optLong("revision"));
            else if (active()) { next.getJSONArray("events").put(new JSONObject().put("type", "pause").put("at", lastAt())); next.put("mode", "paused"); }
            next.put("message", message).put("revision", state.optLong("revision") + 1);
            state = next; if (changed != null) changed.run();
        } catch (Exception ignored) { /* Original durable file is retained. */ }
    }
}
