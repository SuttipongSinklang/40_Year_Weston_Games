package com.weston.running;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Native session, independent of WebView lifetime. All updates are serialized. */
final class TreadmillJournal {
    private static TreadmillJournal instance;
    static synchronized TreadmillJournal get(Context context) throws Exception {
        if (instance == null) instance = new TreadmillJournal(context.getApplicationContext());
        return instance;
    }
    private final AtomicFile file;
    private JSONObject state;
    private Runnable changed;
    private boolean failed;
    private TreadmillJournal(Context context) throws Exception {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "weston-treadmill-v1.json"));
        state = empty(0);
        if (file.getBaseFile().exists() || new File(file.getBaseFile() + ".bak").exists()) {
            state = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            if (state.getInt("version") != 1 || !state.getString("mode").matches("idle|running|paused|finished")) throw new Exception("Invalid treadmill journal");
            if (!state.isNull("id")) UUID.fromString(state.getString("id"));
            if (active()) pause(state.getLong("updated_at"), "การบันทึกถูกขัดจังหวะ กดวิ่งต่อเมื่อพร้อม");
        }
    }
    private static JSONObject empty(long revision) throws Exception {
        return new JSONObject().put("version", 1).put("revision", revision).put("id", JSONObject.NULL)
            .put("mode", "idle").put("message", "พร้อมวิ่งบนลู่ · บันทึกต่อเมื่อล็อกจอ");
    }
    synchronized void attach(Runnable callback) { changed = callback; }
    synchronized void detach(Runnable callback) { if (changed == callback) changed = null; }
    synchronized boolean active() { return "running".equals(state.optString("mode")); }
    synchronized boolean occupied() { return !state.isNull("id"); }
    synchronized boolean automatic() { return "phone_steps".equals(state.optString("distance_source")); }
    synchronized long segmentStart() { return state.optLong("resumed_at"); }
    synchronized JSONObject snapshot() throws Exception { return new JSONObject(state.toString()); }
    private void commit(JSONObject next) throws Exception {
        next.put("revision", state.optLong("revision") + 1);
        FileOutputStream stream = null;
        try {
            stream = file.startWrite(); stream.write(next.toString().getBytes(StandardCharsets.UTF_8));
            stream.getFD().sync(); file.finishWrite(stream);
        } catch (Exception error) { if (stream != null) file.failWrite(stream); failed = true; throw error; }
        state = next; failed = false; if (changed != null) changed.run();
    }
    synchronized void start(boolean automatic, double stride, long at) throws Exception {
        if (failed) throw new Exception("Native storage unavailable");
        if (active()) return;
        if ("finished".equals(state.optString("mode"))) throw new Exception("Save finished run first");
        JSONObject next = snapshot();
        if (state.isNull("id")) {
            if (automatic && (!Double.isFinite(stride) || stride < .3 || stride > 2)) throw new Exception("Invalid stride");
            next.put("id", UUID.randomUUID().toString()).put("started_at", at).put("elapsed_ms", 0)
                .put("steps", 0).put("distance_m", 0).put("distance_source", automatic ? "phone_steps" : "manual")
                .put("stride_m", automatic ? stride : JSONObject.NULL);
        }
        next.put("mode", "running").put("resumed_at", at).put("updated_at", at).put("ended_at", JSONObject.NULL)
            .put("message", "กำลังวิ่งบนลู่ · ล็อกจอได้ · ระยะทางจากก้าวเป็นค่าประมาณ");
        commit(next);
    }
    synchronized void checkpoint(long at) throws Exception {
        if (!active()) return;
        JSONObject next = snapshot(); next.put("updated_at", Math.max(at, state.optLong("updated_at"))); commit(next);
    }
    synchronized void steps(long delta, long at) throws Exception {
        if (!active() || !automatic() || delta <= 0 || delta > 1000 || at < segmentStart()) return;
        long count = state.getLong("steps") + delta;
        if (count > 1000000 || count * state.getDouble("stride_m") > 200000) { pause(at, "ถึงขีดจำกัด กรุณาจบและบันทึก"); return; }
        JSONObject next = snapshot(); next.put("steps", count).put("distance_m", count * state.getDouble("stride_m"))
            .put("updated_at", Math.max(at, state.optLong("updated_at"))); commit(next);
    }
    synchronized void distance(double meters) throws Exception {
        if (automatic() || state.isNull("id") || "finished".equals(state.optString("mode")) || !Double.isFinite(meters) || meters < 0 || meters > 200000) throw new Exception("Invalid manual distance");
        JSONObject next = snapshot(); next.put("distance_m", meters); commit(next);
    }
    synchronized void pause(long at, String message) throws Exception {
        if (!active()) return;
        JSONObject next = snapshot();
        next.put("elapsed_ms", state.getLong("elapsed_ms") + Math.max(0, at - segmentStart()))
            .put("resumed_at", JSONObject.NULL).put("updated_at", at).put("mode", "paused").put("message", message); commit(next);
    }
    synchronized void finish(long at) throws Exception {
        if (state.isNull("id") || "finished".equals(state.optString("mode"))) return;
        pause(at, "พักการวิ่ง");
        JSONObject next = snapshot(); next.put("mode", "finished").put("ended_at", at).put("updated_at", at)
            .put("message", "จบแล้ว · บันทึกเพื่อเก็บประวัติ"); commit(next);
    }
    synchronized void acknowledge(String id) throws Exception {
        if ("finished".equals(state.optString("mode")) && state.optString("id").equals(id)) commit(empty(state.optLong("revision")));
    }
    synchronized void emergencyPause() {
        try { pause(state.optLong("updated_at"), "เก็บข้อมูลไม่ได้ หยุดจับก้าวแล้ว ข้อมูลเดิมยังอยู่"); }
        catch (Exception error) {
            try { state.put("elapsed_ms", state.optLong("elapsed_ms") + Math.max(0, state.optLong("updated_at") - segmentStart()))
                .put("mode", "paused").put("resumed_at", JSONObject.NULL).put("message", "เก็บข้อมูลไม่ได้ หยุดจับก้าวแล้ว"); } catch (Exception ignored) { }
            if (changed != null) changed.run();
        }
    }
}
