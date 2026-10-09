package com.weston.running;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

public final class RunningService extends Service implements LocationListener {
    static final String PAUSE = "com.weston.running.PAUSE";
    private static final String CHANNEL = "weston_running";
    private static final int NOTIFICATION = 8081;
    private LocationManager locations;
    private RunJournal journal;
    private boolean requesting;

    @Override public void onCreate() {
        super.onCreate();
        locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        try { journal = RunJournal.get(this); } catch (Exception error) { stopSelf(); }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (journal == null) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && PAUSE.equals(intent.getAction())) {
            halt("พักการวิ่ง · กดวิ่งต่อในแอปเมื่อพร้อม", false);
            return START_NOT_STICKY;
        }
        if (!journal.active()) { stopSelf(); return START_NOT_STICKY; }
        try {
            NotificationManager notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "การวิ่ง Weston", NotificationManager.IMPORTANCE_LOW));
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent open = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            PendingIntent pause = PendingIntent.getService(this, 1, new Intent(this, RunningService.class).setAction(PAUSE), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Weston กำลังบันทึกการวิ่ง")
                .setContentText("บันทึก GPS ต่อขณะล็อกจอ · แตะเพื่อกลับเข้าแอป")
                .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .addAction(android.R.drawable.ic_media_pause, "พักการวิ่ง", pause).build();
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION, notification);
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw new SecurityException("Precise location permission required");
            if (!locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw new IllegalStateException("GPS provider disabled");
            if (!requesting) {
                requesting = true;
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 3, this, getMainLooper());
            }
        } catch (Exception error) {
            halt(error instanceof SecurityException ? "สิทธิ์ตำแหน่งถูกปิด กรุณาเปิดตำแหน่งที่แม่นยำแล้วลองใหม่"
                : "เริ่ม GPS ไม่ได้ เปิดบริการตำแหน่งแล้วลองใหม่", false);
        }
        // No automatic restart after termination, force-stop or reboot.
        return START_NOT_STICKY;
    }
    @Override public void onLocationChanged(Location location) {
        if (journal == null || !journal.active()) { stopSelf(); return; }
        try {
            journal.fix(location, System.currentTimeMillis());
            if (!journal.active()) stopSelf();
        } catch (Exception error) { halt("บันทึก GPS ในเครื่องไม่ได้ หยุดติดตามแล้ว กรุณาเก็บหรือส่งออกข้อมูลก่อนปิดแอป", true); }
    }
    private void halt(String message, boolean storageError) {
        removeUpdates();
        if (journal != null) {
            try { journal.pause(System.currentTimeMillis(), message); }
            catch (Exception error) { journal.emergencyPause(message); }
            if (storageError) journal.emergencyPause(message);
        }
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    private void removeUpdates() {
        if (locations != null && requesting) {
            requesting = false;
            try { locations.removeUpdates(this); } catch (SecurityException ignored) { }
        }
    }
    @Override public void onProviderDisabled(String provider) { if (LocationManager.GPS_PROVIDER.equals(provider)) halt("GPS ถูกปิด เปิดตำแหน่งแล้วกดวิ่งต่อ", false); }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        removeUpdates();
        if (journal != null && journal.active()) {
            try { journal.interrupt("ระบบหยุดการบันทึก กดวิ่งต่อเมื่อกลับเข้าแอป"); }
            catch (Exception error) { journal.emergencyPause("ระบบหยุดการบันทึก ข้อมูลเดิมยังอยู่ในเครื่อง"); }
        }
        super.onDestroy();
    }
}
