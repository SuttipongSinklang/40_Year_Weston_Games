package com.weston.running;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.util.Log;
import android.os.PowerManager;
import android.os.ParcelFileDescriptor;
import java.io.InputStream;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import androidx.test.platform.app.InstrumentationRegistry;
import com.weston.fitquest.MainActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Runs against the actual packaged WebView/native service, with GPS supplied by emulator console. */
@RunWith(AndroidJUnit4.class)
public class RunningEmulatorTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;

    private String js(String code) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        activity.runOnUiThread(() -> activity.getBridge().getWebView().evaluateJavascript(code, result -> {
            value.set(result); latch.countDown();
        }));
        boolean completed=latch.await(45, TimeUnit.SECONDS);
        if (!completed) screenshot("evaluation-timeout");
        assertTrue("WebView evaluation timed out", completed);
        Object decoded = new JSONTokener(value.get()).nextValue();
        return String.valueOf(decoded);
    }
    private void waitFor(String condition, long timeout) throws Exception {
        long end = System.currentTimeMillis() + timeout;
        while (System.currentTimeMillis() < end) {
            if ("true".equals(js("Boolean(" + condition + ")"))) return;
            Thread.sleep(500);
        }
        screenshot("failure");
        fail("Condition timed out: " + condition + " ; " + js("JSON.stringify({run:document.getElementById('runMessage')?.textContent,map:document.getElementById('mapMessage')?.textContent,errors:window.__emuErrors})"));
    }
    private JSONObject state() throws Exception { return RunJournal.get(activity).snapshot(); }
    private int fixes() throws Exception {
        JSONArray events = state().getJSONArray("events"); int count = 0;
        for (int i=0; i<events.length(); i++) if ("fix".equals(events.getJSONObject(i).optString("type"))) count++;
        return count;
    }
    private void waitFixes(int minimum) throws Exception {
        long end = System.currentTimeMillis() + 30000;
        while (System.currentTimeMillis() < end) { if (fixes() >= minimum) return; Thread.sleep(500); }
        fail("Native GPS fixes missing: " + state());
    }
    private void screenshot(String name) throws Exception {
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        File file = new File(activity.getExternalFilesDir(null), "emulator-" + name + ".png");
        try (FileOutputStream out = new FileOutputStream(file)) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); }
        bitmap.recycle(); Log.i("WestonEmulatorTest", "SCREENSHOT " + file);
    }
    @Test public void mapGpsPauseResumeBackgroundAndHistory() throws Exception {
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(launch);
        // Install the network guard before loading app JS, including SDKs that bind fetch.
        assertTrue(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
        instrumentation.runOnMainSync(() -> {
            WebViewCompat.addDocumentStartJavaScript(activity.getBridge().getWebView(),
                "window.__emuErrors=[];window.addEventListener('error',e=>window.__emuErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__emuErrors.push(String(e.reason)));const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>String(input?.url||input).includes('.supabase.co')?Promise.reject(new Error('Emulator fixture: cloud disabled')):originalFetch(input,init);",
                Collections.singleton("*"));
            activity.getBridge().getWebView().reload();
        });
        Thread.sleep(1000);
        waitFor("document.readyState === 'complete' && document.getElementById('runMessage')", 90000);
        js("location.hash='run'");
        waitFor("document.getElementById('screen-run').classList.contains('active') && !document.getElementById('runStart').disabled", 35000);
        assertEquals("true", js("Capacitor.isNativePlatform()"));
        waitFor("!document.getElementById('runMap').hidden && document.querySelector('#runMap .leaflet-control-zoom') && [...document.querySelectorAll('#runMap img.leaflet-tile')].some(t=>t.complete && t.naturalWidth>0)", 45000);
        screenshot("map-ready"); Log.i("WestonEmulatorTest", "PASS real street tiles / native bridge / start ready");
        js("document.getElementById('runStart').click()");
        waitFixes(3);
        waitFor("document.getElementById('runStatus').dataset.state==='running' && document.querySelector('#runMap .leaflet-overlay-pane path')", 15000);
        screenshot("running");
        js("document.getElementById('runPause').click()");
        waitFor("document.getElementById('runStatus').dataset.state==='paused'", 15000);
        int pausedFixes=fixes(); Thread.sleep(4000);
        assertEquals("Pausing must stop GPS recording",pausedFixes,fixes());
        assertTrue(js("document.getElementById('runMap').textContent").contains("P1"));
        js("document.getElementById('runStart').click()");
        waitFixes(pausedFixes+2);
        waitFor("document.getElementById('runMap').textContent.includes('R1')",15000);
        int beforeBackground=fixes();
        activity.runOnUiThread(() -> activity.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        Thread.sleep(10000);
        assertTrue("Native GPS must keep recording while another app is foreground",fixes()>beforeBackground);
        int beforeLock=fixes();
        try (InputStream command = new ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation().executeShellCommand("input keyevent 223"))) { while (command.read()!=-1) {} }
        Thread.sleep(1000);
        assertFalse("Emulator screen must be off",activity.getSystemService(PowerManager.class).isInteractive());
        Thread.sleep(8000);
        assertTrue("Native GPS must keep recording with the screen off",fixes()>beforeLock);
        try (InputStream command = new ParcelFileDescriptor.AutoCloseInputStream(instrumentation.getUiAutomation().executeShellCommand("input keyevent 224"))) { while (command.read()!=-1) {} }
        activity.runOnUiThread(() -> activity.startActivity(new Intent(activity,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
        Thread.sleep(2000);
        screenshot("resumed"); Log.i("WestonEmulatorTest", "PASS GPS / P1 R1 / paused fixes excluded / background and screen-off capture");
        js("document.getElementById('runFinish').click()");
        waitFor("document.getElementById('runDetailDialog').open && !document.getElementById('detailMap').hidden && document.querySelector('#detailMap .leaflet-overlay-pane path') && [...document.querySelectorAll('#detailMap img.leaflet-tile')].filter(t=>t.complete && t.naturalWidth>0).length>=2",45000);
        assertTrue(js("document.getElementById('detailMap').textContent").contains("P1"));
        assertTrue(js("document.getElementById('detailMap').textContent").contains("R1"));
        // Wait for the final route viewport, not leftover tiles from the initial map view.
        Thread.sleep(2500);
        waitFor("[...document.querySelectorAll('#detailMap img.leaflet-tile')].length>0 && [...document.querySelectorAll('#detailMap img.leaflet-tile')].every(t=>t.complete && t.naturalWidth>0)",45000);
        screenshot("saved-route");
        File mapReport=new File(activity.getExternalFilesDir(null),"emulator-map-diagnostics.json");
        String mapInfo=js("JSON.stringify({map:document.getElementById('detailMap').getBoundingClientRect().toJSON(),tiles:[...document.querySelectorAll('#detailMap img.leaflet-tile')].map(t=>({src:t.src,complete:t.complete,width:t.naturalWidth,rect:t.getBoundingClientRect().toJSON()}))})");
        try(FileOutputStream out=new FileOutputStream(mapReport)){out.write(mapInfo.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        js("window.__emuRecords=null;import(new URL('/js/run-store.js',location.href).href).then(s=>s.listRecords()).then(r=>window.__emuRecords=r)");
        waitFor("window.__emuRecords?.length===1",10000);
        JSONObject record = new JSONObject(js("JSON.stringify(window.__emuRecords[0])"));
        assertTrue(record.getJSONObject("run").getJSONArray("points").length()>=4);
        assertEquals(2,record.getJSONObject("run").getJSONArray("events").length());
        assertEquals("pending",record.getString("cloud_state"));
        assertTrue(record.getJSONObject("run").getDouble("distance_m")>0);
        File report=new File(activity.getExternalFilesDir(null),"emulator-record.json");
        try(FileOutputStream out=new FileOutputStream(report)){out.write(record.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        Log.i("WestonEmulatorTest","PASS history / saved route / numbered pause-resume / cloud fixture isolated");
    }
}
