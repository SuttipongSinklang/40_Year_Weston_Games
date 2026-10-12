// Browser GPS may start with an approximate or cached fix, even in high accuracy mode.
export const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
export function usableBrowserFix(fix, now, maxAge = 15000, maxAccuracy = 20) {
  return Boolean(fix && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= maxAccuracy
    && Number.isFinite(fix.timestamp) && fix.timestamp >= now - maxAge
    && fix.timestamp <= now + 1000);
}
export function locateBrowserPosition({ geo = navigator.geolocation, now = Date.now,
  timeout = 20000, schedule = setTimeout, cancel = clearTimeout,
  onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    let watch, timer, finished = false, best;
    const abort = () => finish(new Error('หยุดหาตำแหน่งเมื่อออกจากหน้าวิ่ง · กด ◎ เพื่อลองใหม่'));
    const finish = (error, fix) => {
      if (finished) return;
      finished = true;
      if (watch !== undefined) geo.clearWatch(watch);
      cancel(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(fix);
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = schedule(() => {
      // Approximate preview never becomes a recorded route point.
      if (best && usableBrowserFix(best, now(), 15000, 1000)) finish(null, best);
      else finish(new Error('ยังไม่ได้ตำแหน่ง GPS · ตรวจสิทธิ์ตำแหน่งของ Safari และลองในพื้นที่เปิด'));
    }, timeout);
    try {
      watch = geo.watchPosition(position => {
        const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, timestamp: position.timestamp };
        if (!usableBrowserFix(fix, now(), 15000, 1000)) return;
        if (!best || !usableBrowserFix(best, now(), 15000, 1000) || fix.accuracy <= best.accuracy) {
          best = fix;
          onProgress(fix);
        }
        if (usableBrowserFix(fix, now(), 5000)) finish(null, fix);
      }, error => {
        if (error.code === 1) finish(new Error('เปิดสิทธิ์ตำแหน่งที่แม่นยำของ Safari แล้วลองใหม่'));
        else if (error.code === 2) finish(new Error('Safari หาตำแหน่งไม่ได้ · ตรวจว่าบริการหาตำแหน่งเปิดอยู่ แล้วลองในพื้นที่เปิด'));
        else if (error.code === 3) {
          if (best && usableBrowserFix(best, now(), 15000, 1000)) finish(null, best);
          else finish(new Error('GPS หมดเวลารอ · กด ◎ เพื่อลองใหม่'));
        }
        // Temporary errors keep waiting for a fresh, accurate position until the deadline.
      }, GPS_OPTIONS);
      if (finished) geo.clearWatch(watch);
    } catch { finish(new Error('เปิด GPS ไม่ได้ กรุณาตรวจสิทธิ์ตำแหน่ง')); }
  });
}
