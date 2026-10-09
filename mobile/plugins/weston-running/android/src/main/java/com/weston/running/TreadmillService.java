package com.weston.running;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.*;
import android.os.*;
import androidx.core.app.NotificationCompat;

public final class TreadmillService extends Service implements SensorEventListener {
    static final String PAUSE = "com.weston.running.TREADMILL_PAUSE";
    private TreadmillJournal journal;
    private SensorManager sensors;
    private Sensor sensor;
    private PowerManager.WakeLock wake;
    private float baseline = -1;
    private long lastTimestamp;
    private long ownedStart;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable checkpoint = new Runnable() {
        public void run() {
            try {
                if (journal == null || !journal.active()) { stopSelf(); return; }
                if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) throw new SecurityException();
                journal.checkpoint(System.currentTimeMillis()); handler.postDelayed(this, 15000);
            } catch (Exception error) { halt(); }
        }
    };
    @Override public void onCreate() {
        super.onCreate(); sensors = (SensorManager) getSystemService(SENSOR_SERVICE);
        try { journal = TreadmillJournal.get(this); } catch (Exception error) { stopSelf(); }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (journal == null || !journal.active()) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && PAUSE.equals(intent.getAction())) {
            try { journal.pause(System.currentTimeMillis(), "พักการวิ่งจากแจ้งเตือน · กดวิ่งต่อในแอป"); } catch (Exception error) { journal.emergencyPause(); }
            stopSelf(); return START_NOT_STICKY;
        }
        try {
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("weston_treadmill", "วิ่งบนลู่ Weston", NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 2, getPackageManager().getLaunchIntentForPackage(getPackageName()), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            PendingIntent pause = PendingIntent.getService(this, 3, new Intent(this, TreadmillService.class).setAction(PAUSE), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new NotificationCompat.Builder(this, "weston_treadmill").setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Weston กำลังบันทึกวิ่งบนลู่").setContentText("เก็บก้าวและเวลาต่อเมื่อล็อกจอ · ระยะทางประมาณ")
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).addAction(android.R.drawable.ic_media_pause, "พักการวิ่ง", pause).build();
            if (Build.VERSION.SDK_INT >= 34) startForeground(8082, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
            else startForeground(8082, notification);
            if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) throw new SecurityException();
            if (wake == null) {
                ownedStart = journal.segmentStart(); baseline = -1; lastTimestamp = 0;
                wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Weston:Treadmill");
                // CPU only, never holds the display on. Released on every stop path.
                wake.acquire();
                if (journal.automatic()) {
                    sensor = sensors.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
                    if (sensor == null) sensor = sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
                    if (sensor == null || !sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, 0)) throw new Exception("Step sensor unavailable");
                }
                handler.post(checkpoint);
            }
        } catch (Exception error) { halt(); }
        return START_NOT_STICKY;
    }
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }
    public void onSensorChanged(SensorEvent event) {
        if (journal == null || !journal.active()) { stopSelf(); return; }
        if (event.timestamp <= lastTimestamp) return;
        lastTimestamp = event.timestamp;
        long at = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1000000;
        if (at < journal.segmentStart()) return;
        long delta = 1;
        if (event.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
            if (baseline < 0) { baseline = event.values[0]; return; }
            delta = (long) (event.values[0] - baseline); baseline = event.values[0];
            if (delta < 0) { halt(); return; }
        }
        try { journal.steps(delta, at); if (!journal.active()) stopSelf(); } catch (Exception error) { halt(); }
    }
    private void halt() { if (journal != null) journal.emergencyPause(); stopSelf(); }
    @Override public void onDestroy() {
        handler.removeCallbacks(checkpoint); if (sensors != null) sensors.unregisterListener(this);
        if (wake != null && wake.isHeld()) wake.release();
        if (journal != null && journal.active() && journal.segmentStart() == ownedStart) journal.emergencyPause();
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
