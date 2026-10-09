package com.weston.running;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "WestonRunning", permissions = {
    @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}),
    @Permission(alias = "motion", strings = {Manifest.permission.ACTIVITY_RECOGNITION})
})
public final class WestonRunningPlugin extends Plugin {
    private RunJournal journal;
    private TreadmillJournal treadmill;
    private final Runnable treadmillChanged = () -> notifyListeners("treadmillStateChanged", new JSObject());
    private PluginCall starting;
    private SensorManager stepManager;
    private Sensor stepSensor;
    private long stepTotal;
    private float stepBaseline = -1;
    private final SensorEventListener stepListener = new SensorEventListener() {
        public void onAccuracyChanged(Sensor sensor, int accuracy) { }
        public void onSensorChanged(SensorEvent event) {
            if (stepSensor == null) return;
            if (event.sensor.getType() == Sensor.TYPE_STEP_DETECTOR) stepTotal++;
            else {
                if (stepBaseline < 0 || event.values[0] < stepBaseline) stepBaseline = event.values[0];
                stepTotal = (long) (event.values[0] - stepBaseline);
            }
            JSObject result = new JSObject(); result.put("steps", stepTotal);
            notifyListeners("stepProgress", result);
        }
    };
    @PluginMethod public void startSteps(PluginCall call) {
        post(call, () -> {
            if (Build.VERSION.SDK_INT >= 29 && getPermissionState("motion") != PermissionState.GRANTED)
                requestPermissionForAlias("motion", call, "motionPermission");
            else beginSteps(call);
        });
    }
    @PermissionCallback private void motionPermission(PluginCall call) {
        if (getPermissionState("motion") != PermissionState.GRANTED) { call.reject("Motion permission denied"); return; }
        getActivity().runOnUiThread(() -> beginSteps(call));
    }
    private void stopStepSensor() {
        if (stepManager != null) stepManager.unregisterListener(stepListener);
        stepSensor = null; stepTotal = 0; stepBaseline = -1;
    }
    private void beginSteps(PluginCall call) {
        try {
            if (!getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) throw new Exception("Visible activity required");
            stopStepSensor();
            stepManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            stepSensor = stepManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
            if (stepSensor == null) stepSensor = stepManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (stepSensor == null || !stepManager.registerListener(stepListener, stepSensor, SensorManager.SENSOR_DELAY_NORMAL)) throw new Exception("Step sensor unavailable");
            call.resolve();
        } catch (Exception error) { stopStepSensor(); call.reject("Phone step sensor unavailable"); }
    }
    @PluginMethod public void stopSteps(PluginCall call) {
        post(call, () -> { stopStepSensor(); call.resolve(); });
    }
    @Override protected void handleOnPause() { stopStepSensor(); }
    private final Runnable changed = () -> notifyListeners("stateChanged", new JSObject());

    // Capacitor never settles a call whose plugin method throws: a failed UI-thread
    // post must reject instead of leaving the web side awaiting forever.
    private void post(PluginCall call, Runnable body) {
        try { getActivity().runOnUiThread(body); } catch (Exception error) { call.reject("App window unavailable; try again"); }
    }

    @Override public void load() {
        try { journal = RunJournal.get(getContext()); journal.attach(changed); treadmill = TreadmillJournal.get(getContext()); treadmill.attach(treadmillChanged); }
        catch (Exception error) { journal = null; }
    }
    private boolean available(PluginCall call) {
        if (journal == null) { call.reject("Native journal unavailable; existing file retained"); return false; }
        return true;
    }
    private void resolve(PluginCall call) throws Exception { call.resolve(new JSObject(journal.snapshot().toString())); }
    @PluginMethod public void getState(PluginCall call) {
        if (!available(call)) return;
        try { resolve(call); } catch (Exception error) { call.reject("Cannot read native journal"); }
    }
    @PluginMethod public void start(PluginCall call) {
        post(call, () -> {
            if (!available(call)) return;
            if (starting != null) { call.reject("Location request in progress"); return; }
            if (!getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) { call.reject("Start requires visible activity"); return; }
            starting = call;
            if (getPermissionState("location") != PermissionState.GRANTED) requestPermissionForAlias("location", call, "locationPermission");
            else notificationPermission(call);
        });
    }
    @PermissionCallback private void locationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { starting = null; call.reject("Precise location permission denied"); return; }
        notificationPermission(call);
    }
    private void notificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) requestPermissionForAlias("notifications", call, "notificationResult");
        else begin(call);
    }
    @PermissionCallback private void notificationResult(PluginCall call) { begin(call); }
    private void begin(PluginCall call) {
        post(call, () -> {
            try {
                if (!getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) throw new Exception("Start requires visible activity");
                if (treadmill != null && treadmill.occupied()) throw new Exception("Save treadmill run first");
                journal.start();
                ContextCompat.startForegroundService(getContext(), new Intent(getContext(), RunningService.class));
                resolve(call);
            } catch (Exception error) {
                try { journal.interrupt("เริ่มบันทึกไม่ได้ กรุณากลับเข้าแอปแล้วลองใหม่"); }
                catch (Exception disk) { journal.emergencyPause("เริ่มบันทึกไม่ได้ ข้อมูลเดิมยังอยู่ในเครื่อง"); }
                call.reject("Cannot start foreground location service");
            } finally { starting = null; }
        });
    }
    private void stopService() { getContext().stopService(new Intent(getContext(), RunningService.class)); }
    @PluginMethod public void pause(PluginCall call) {
        post(call, () -> {
            if (!available(call)) return;
            try { journal.pause(System.currentTimeMillis(), "พักการวิ่ง · เวลาและระยะทางหยุดนับ"); stopService(); resolve(call); }
            catch (Exception error) { stopService(); journal.emergencyPause("บันทึกการพักไม่ได้ หยุด GPS แล้ว"); call.reject("Native storage unavailable"); }
        });
    }
    @PluginMethod public void finish(PluginCall call) {
        post(call, () -> {
            if (!available(call)) return;
            try { journal.finish(System.currentTimeMillis()); stopService(); resolve(call); }
            catch (Exception error) { stopService(); journal.emergencyPause("ยังจบการวิ่งไม่ได้ ข้อมูลเดิมยังอยู่ในเครื่อง กดลองอีกครั้ง"); call.reject("Native storage unavailable"); }
        });
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        if (!available(call)) return;
        try { String id = call.getString("id"); if (id == null) throw new Exception("Missing ID"); journal.acknowledge(id); resolve(call); }
        catch (Exception error) { call.reject("Cannot acknowledge native history"); }
    }
    @PluginMethod public void getTreadmillState(PluginCall call) { treadmillCommand(call, "read"); }
    @PluginMethod public void pauseTreadmill(PluginCall call) { treadmillCommand(call, "pause"); }
    @PluginMethod public void finishTreadmill(PluginCall call) { treadmillCommand(call, "finish"); }
    @PluginMethod public void acknowledgeTreadmill(PluginCall call) { treadmillCommand(call, "ack"); }
    @PluginMethod public void setTreadmillDistance(PluginCall call) { treadmillCommand(call, "distance"); }
    private void treadmillCommand(PluginCall call, String action) {
        // Journal-only commands stay off the UI thread (mirrors getState): a busy main
        // thread during startup delayed runOnUiThread indefinitely and froze the web
        // running screen (observed 2026-10-09). The journal is synchronized.
        if ("read".equals(action) || "ack".equals(action) || "distance".equals(action)) {
            try {
                if (treadmill == null) throw new Exception("Native storage unavailable");
                if ("ack".equals(action)) treadmill.acknowledge(call.getString("id"));
                else if ("distance".equals(action)) treadmill.distance(call.getDouble("distance_m", -1.0));
                call.resolve(new JSObject(treadmill.snapshot().toString()));
            } catch (Exception error) { call.reject("Treadmill command failed; existing journal retained"); }
            return;
        }
        post(call, () -> {
            try {
                if (treadmill == null) throw new Exception("Native storage unavailable");
                if ("pause".equals(action)) treadmill.pause(System.currentTimeMillis(), "พักการวิ่ง · ไม่นับก้าวและเวลาพัก");
                else treadmill.finish(System.currentTimeMillis());
                getContext().stopService(new Intent(getContext(), TreadmillService.class));
                call.resolve(new JSObject(treadmill.snapshot().toString()));
            } catch (Exception error) {
                getContext().stopService(new Intent(getContext(), TreadmillService.class));
                if (treadmill != null) treadmill.emergencyPause();
                call.reject("Treadmill command failed; existing journal retained");
            }
        });
    }
    @PluginMethod public void startTreadmill(PluginCall call) {
        post(call, () -> {
            if (Build.VERSION.SDK_INT >= 29 && getPermissionState("motion") != PermissionState.GRANTED)
                requestPermissionForAlias("motion", call, "treadmillMotionPermission");
            else treadmillNotification(call);
        });
    }
    @PermissionCallback private void treadmillMotionPermission(PluginCall call) {
        if (getPermissionState("motion") != PermissionState.GRANTED) { call.reject("Motion permission denied"); return; }
        treadmillNotification(call);
    }
    private void treadmillNotification(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT)
            requestPermissionForAlias("notifications", call, "treadmillNotificationResult");
        else beginTreadmill(call);
    }
    @PermissionCallback private void treadmillNotificationResult(PluginCall call) { beginTreadmill(call); }
    private void beginTreadmill(PluginCall call) {
        post(call, () -> {
            try {
                if (treadmill == null || journal == null) throw new Exception("Native storage unavailable");
                if (!getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) throw new Exception("Visible activity required");
                if (!journal.snapshot().isNull("id")) throw new Exception("Save outdoor run first");
                boolean automatic = treadmill.occupied() ? treadmill.automatic() : call.getBoolean("automatic", true);
                SensorManager manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
                if (automatic && manager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR) == null && manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) == null) throw new Exception("Step sensor unavailable");
                treadmill.start(automatic, call.getDouble("stride_m", .75), System.currentTimeMillis());
                ContextCompat.startForegroundService(getContext(), new Intent(getContext(), TreadmillService.class));
                call.resolve(new JSObject(treadmill.snapshot().toString()));
            } catch (Exception error) { if (treadmill != null) treadmill.emergencyPause(); call.reject(error.getMessage()); }
        });
    }
    @Override protected void handleOnDestroy() {
        stopStepSensor();
        if (journal != null) journal.detach(changed);
        if (treadmill != null) treadmill.detach(treadmillChanged);
        // Native foreground service deliberately outlives the WebView.
    }
}
