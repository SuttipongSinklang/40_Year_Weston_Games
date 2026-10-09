import { createRun, activeMs, addPosition, pauseRun, resumeRun, finishRun, restoreRun } from './run-core.js?v=20261009-8';
import * as storage from './run-store.js';

export function createRunTracker({ onChange = () => {}, store = storage, geo = navigator.geolocation,
  activity = 'outdoor', motion,
  secure = globalThis.isSecureContext, now = () => Date.now(), schedule = setInterval, unschedule = clearInterval } = {}) {
  let run, mode = 'idle', watch, token, lease = false, generation = 0, message = 'พร้อมบันทึกการวิ่ง', ready = false, busy = false;
  let writes = Promise.resolve(), checkpointAt = 0, renewAt = 0, savedId, suspending;
  const emit = () => onChange({ run, mode, message, ready, busy, saved: Boolean(run && savedId === run.id), elapsed: run ? activeMs(run, now()) : 0 });
  const clearWatch = () => { generation++; if (watch !== undefined) geo?.clearWatch(watch); watch = undefined; void motion?.stop().catch(() => {}); };
  async function release() { if (lease) { lease = false; await store.runLease(token, 'release').catch(() => {}); } }
  function persist() {
    if (!run || !lease) return writes;
    run.updated_at = now();
    const copy = structuredClone(run), owner = token;
    writes = writes.catch(() => {}).then(async () => {
      // Timers can sleep past the lease deadline. Renew the same owner before any resumed sensor write.
      if (!await store.runLease(owner, 'renew')) throw new Error('Run lease was taken by another tab');
      await store.saveDraft(copy, owner);
    });
    return writes;
  }
  async function storageFailure() {
    clearWatch(); if (run?.status === 'running') pauseRun(run, now());
    mode = run ? 'paused' : 'idle'; message = 'บันทึกในเครื่องไม่ได้ หยุดติดตามแล้ว กรุณาเปิดหน้านี้ไว้แล้วลองบันทึกอีกครั้ง';
    ready = false; await release(); emit();
  }
  async function acquire() {
    if (lease) return true;
    token = store.newRunId(); lease = await store.runLease(token);
    if (!lease) { message = 'มีการวิ่งเปิดอยู่ในอีกแท็บ กรุณาใช้แท็บนั้น'; emit(); return false; }
    const current = await store.loadDraft();
    if (current && current.id !== run?.id) {
      run = restoreRun(current, now()); mode = run ? 'paused' : 'idle';
      message = 'พบการวิ่งจากอีกแท็บ กดวิ่งต่อเพื่อใช้รายการนี้'; await release(); emit(); return false;
    }
    if (run && !current && run.status !== 'finished') {
      run = null; mode = 'idle'; message = 'การวิ่งนี้ถูกบันทึกในอีกแท็บแล้ว กรุณาเริ่มรอบใหม่'; await release(); emit(); return false;
    }
    return true;
  }
  async function init() {
    try {
      const draft = await store.loadDraft();
      run = draft ? restoreRun(draft, now()) : null;
      mode = 'idle';
      if (run?.status === 'finished') { mode = 'finished'; message = 'พบการวิ่งที่ยังไม่ได้เก็บเข้าประวัติ กดบันทึกการวิ่ง'; }
      else if (run) { mode = 'paused'; message = 'กู้การวิ่งค้างไว้แล้ว กดวิ่งต่อเมื่อต้องการ'; }
      ready = true;
    } catch { message = 'พื้นที่จัดเก็บไม่พร้อม ยังเริ่มการวิ่งไม่ได้'; }
    emit();
  }
  async function start(options = {}) {
    if (busy || mode === 'running' || mode === 'acquiring' || !ready) return;
    if (run?.status === 'finished' && savedId !== run.id) return;
    const type = run && run.status !== 'finished' ? run.activity || 'outdoor' : options.activity || activity;
    if (!['outdoor', 'treadmill'].includes(type)) return;
    if (type === 'outdoor' && !secure) { message = 'GPS ต้องเปิดเว็บผ่าน HTTPS บนโทรศัพท์ หรือ localhost บนเครื่องนี้'; emit(); return; }
    if (type === 'outdoor' && !geo) { message = 'เบราว์เซอร์นี้ไม่รองรับ GPS'; emit(); return; }
    busy = true; emit();
    try {
      const automatic = type === 'treadmill' && (run && run.status !== 'finished' ? run.distance_source === 'phone_steps' : options.automatic);
      const stride = run?.status !== 'finished' && run?.distance_source === 'phone_steps' ? run.stride_m : Number(options.stride_m || 0.75);
      if (automatic) {
        if (!motion || !Number.isFinite(stride) || stride < 0.3 || stride > 2) throw new Error('Motion unavailable');
        const motionRequest = generation;
        try { await motion.prepare(); }
        catch { message = 'เปิดเซ็นเซอร์ไม่ได้ ต้องใช้ HTTPS/โทรศัพท์ที่รองรับ และอนุญาตการเคลื่อนไหว'; emit(); return; }
        if (motionRequest !== generation) { await motion.stop().catch(() => {}); return; }
      }
      if (run?.status === 'finished') { run = null; savedId = undefined; }
      if (!await acquire()) return;
      if (type === 'treadmill') {
        if (!run) { run = createRun({ id: store.newRunId(), now: now() }); run.activity = 'treadmill'; }
        else resumeRun(run, now());
        mode = 'running';
        if (automatic) {
          run.distance_source = 'phone_steps'; run.stride_m = stride; run.steps ||= 0;
          motion.start(count => {
            if (mode !== 'running' || run.distance_source !== 'phone_steps' || !Number.isInteger(count) || count < 1 || count > 100) return;
            run.steps += count; run.distance_m = Math.round(run.steps * run.stride_m * 1000) / 1000;
            message = 'กำลังนับก้าวอัตโนมัติ · ระยะทางประมาณจากความยาวก้าว';
            if (run.distance_m > 200000) { void pause('ถึงขีดจำกัดระยะทาง กรุณาจบและบันทึก'); return; }
            void persist().catch(storageFailure); emit();
          }, () => { message = 'ไม่มีข้อมูลก้าวจากเซ็นเซอร์ · เวลายังเดินต่อ แต่ไม่ประมาณก้าวที่หายไป'; emit(); });
          message = 'รอก้าวจากเซ็นเซอร์ · พกโทรศัพท์ที่เอวหรือกระเป๋ากางเกง ระยะทางเป็นค่าประมาณ';
        } else { run.distance_source = 'manual'; message = 'กำลังจับเวลาลู่วิ่ง · กรอกระยะทางจากเครื่อง ไม่มีการใช้ GPS'; }
        await persist(); emit(); return;
      }
      mode = 'acquiring'; message = 'กำลังขอ GPS · เวลาจะเริ่มเมื่อได้ตำแหน่งที่ชัดเจน'; emit();
      const request = ++generation;
      watch = geo.watchPosition(position => {
        if (request !== generation || !['acquiring', 'running'].includes(mode)) return;
        const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, timestamp: position.timestamp };
        if (mode === 'acquiring') {
          if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180
            || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 40
            || !Number.isFinite(fix.timestamp) || now() - fix.timestamp > 15000 || fix.timestamp > now() + 10000) {
            message = 'GPS ยังคลาดเคลื่อนมาก ลองออกไปในพื้นที่เปิด'; emit(); return;
          }
          if (!run) run = createRun({ id: store.newRunId(), now: now() });
          else resumeRun(run, now());
          mode = 'running';
        }
        const result = addPosition(run, fix, now());
        if (result.reason === 'full') { void pause('ถึงขีดจำกัดจุดเส้นทางแล้ว กรุณาจบและบันทึกรอบนี้'); return; }
        message = result.accepted || result.reason === 'jitter'
          ? `กำลังวิ่ง · GPS ±${Math.round(fix.accuracy)} ม.`
          : 'GPS ไม่นิ่ง กำลังรอตำแหน่งที่แม่นยำขึ้น';
        if (result.accepted) void persist().catch(storageFailure);
        emit();
      }, error => {
        if (request !== generation) return;
        const details = error.code === 1 ? 'ไม่อนุญาตตำแหน่ง เปิดสิทธิ์ตำแหน่งของเว็บแล้วลองใหม่'
          : error.code === 2 ? 'ยังหาตำแหน่งไม่ได้ ลองออกไปในพื้นที่เปิดแล้วกดวิ่งต่อ'
          : 'GPS หมดเวลารอ กดเริ่มหรือวิ่งต่อเพื่อลองใหม่';
        if (error.code === 1) void pause(details);
        else { message = 'รอตำแหน่ง GPS ใหม่ · เวลายังเดินต่อ ช่วงไม่มี GPS จะไม่คิดระยะทาง'; emit(); }
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    } catch { await storageFailure(); }
    finally { if (mode !== 'running' && mode !== 'acquiring') await motion?.stop().catch(() => {}); busy = false; emit(); }
  }
  async function pause(detail = 'พักการวิ่ง · เวลาและระยะทางหยุดนับ') {
    clearWatch();
    if (run?.status === 'running') pauseRun(run, now());
    mode = run ? 'paused' : 'idle'; message = detail; emit();
    try { await persist(); } catch { await storageFailure(); }
    if (!run) await release();
  }
  async function finish() {
    if (busy || !run || savedId === run.id) return null;
    busy = true; clearWatch();
    if (run.status !== 'finished') finishRun(run, now());
    mode = 'finished'; emit();
    const record = { id: run.id, run: structuredClone(run), owner: null, share: true, cloud_state: 'pending' };
    try {
      if (!await acquire()) return null;
      await writes.catch(() => {}); await store.finishDraft(record, token); lease = false;
      savedId = run.id; message = 'บันทึกการวิ่งในเครื่องแล้ว'; return record;
    } catch { message = 'ยังบันทึกประวัติไม่ได้ กดบันทึกอีกครั้ง และเปิดหน้านี้ไว้จนบันทึกสำเร็จ'; return null; }
    finally { busy = false; emit(); }
  }
  const timer = schedule(async () => {
    if (lease && now() - renewAt >= 5000) {
      renewAt = now();
      try { if (!await store.runLease(token, 'renew')) { await storageFailure(); return; } }
      catch { await storageFailure(); return; }
    }
    if (mode === 'running' && now() - checkpointAt >= 5000) {
      checkpointAt = now(); void persist().catch(storageFailure);
    }
    if (mode === 'running') emit();
  }, 1000);
  return { init, start, pause, finish, snapshot: () => ({ run, mode, message, ready, busy, saved: Boolean(run && savedId === run.id), elapsed: run ? activeMs(run, now()) : 0 }),
    async background() {
      // Visibility alone is not a user Pause. Keep the watch/listener, checkpoint, and let the OS decide delivery.
      if (busy) { clearWatch(); return; }
      try { await persist(); } catch { await storageFailure(); }
    },
    async foreground() {
      if (run && lease) {
        try { await persist(); } catch { await storageFailure(); return; }
      }
      emit();
    },
    setDistance(km) {
      if (!run || run.activity !== 'treadmill' || run.distance_source === 'phone_steps' || savedId === run.id || busy
        || !Number.isFinite(km) || km < 0 || km > 200) return false;
      run.distance_m = Math.round(km * 1000); run.splits = [];
      void persist().catch(storageFailure); emit(); return true;
    },
    suspend() {
      if (suspending) return suspending;
      suspending = (async () => {
        if (busy) clearWatch();
        if (mode === 'running' || mode === 'acquiring') await pause('พักอัตโนมัติเมื่อออกจากหน้าเว็บ กดวิ่งต่อเมื่อกลับมา');
        await release();
      })().finally(() => { suspending = undefined; });
      return suspending;
    },
    destroy() { clearWatch(); unschedule(timer); void release(); } };
}
