import { activeMs, restoreRun } from './run-core.js?v=20261009-8';
import * as storage from './run-store.js';

// A native bridge call that never settles (Capacitor logs the exception but never
// rejects the promise) must surface as an error instead of freezing the tracker.
const PLUGIN_TIMEOUT_MS = 15000;
const withTimeout = (task, ms = PLUGIN_TIMEOUT_MS) => Promise.race([
  Promise.resolve(task),
  new Promise((_, reject) => setTimeout(() => reject(new Error('native bridge timeout')), ms)),
]);


export function restoreTreadmill(state) {
  if (state?.version !== 1 || !Number.isInteger(state.revision) || state.revision < 0
    || !['idle', 'running', 'paused', 'finished'].includes(state.mode)) throw new Error('Invalid native treadmill');
  if (state.id === null && state.mode === 'idle') return null;
  if (typeof state.id !== 'string' || !state.id || state.mode === 'idle'
    || !['phone_steps', 'manual'].includes(state.distance_source)
    || !Number.isFinite(state.started_at) || !Number.isFinite(state.updated_at)
    || state.updated_at < state.started_at || !Number.isFinite(state.elapsed_ms) || state.elapsed_ms < 0
    || !Number.isFinite(state.distance_m) || state.distance_m < 0 || state.distance_m > 200000
    || (state.distance_source === 'manual' && (state.steps !== 0 || state.stride_m != null))
    || (state.mode === 'running' && (!Number.isFinite(state.resumed_at) || state.resumed_at < state.started_at || state.updated_at < state.resumed_at))
    || (state.mode !== 'running' && state.resumed_at != null)
    || (state.mode === 'finished' && (!Number.isFinite(state.ended_at) || state.ended_at < state.started_at))) throw new Error('Invalid treadmill summary');
  const run = restoreRun({ id: state.id, activity: 'treadmill', status: state.mode,
    started_at: new Date(state.started_at).toISOString(), ended_at: state.ended_at == null ? null : new Date(state.ended_at).toISOString(),
    elapsed_ms: state.elapsed_ms, resumed_at: state.resumed_at ?? null, updated_at: state.updated_at,
    distance_m: state.distance_m, distance_source: state.distance_source, steps: state.steps,
    stride_m: state.stride_m ?? null, segment: 0, points: [], splits: [] });
  if (!run) throw new Error('Invalid treadmill measurement');
  // IndexedDB recovery pauses browser drafts; a live native session is authoritative.
  run.status = state.mode; run.elapsed_ms = state.elapsed_ms; run.resumed_at = state.resumed_at ?? null; run.updated_at = state.updated_at;
  return run;
}

export function createNativeTreadmillTracker({ plugin, store = storage, onChange = () => {},
  now = () => Date.now(), visible = () => !document.hidden, schedule = setInterval, unschedule = clearInterval } = {}) {
  let run = null, mode = 'idle', ready = false, busy = false, message = 'กำลังอ่านการวิ่งบนลู่…',
    revision = -1, savedId, nativeId, listener, destroyed = false, queue = Promise.resolve(), refreshing, initialized;
  const snapshot = () => ({ run, mode, ready, busy, message, background: true, saved: !!run && savedId === run.id,
    elapsed: run ? activeMs(run, now()) : 0 });
  const emit = () => { if (!destroyed) onChange(snapshot()); };
  const enqueue = action => { const task = queue.catch(() => {}).then(action); queue = task; return task; };
  function apply(state) {
    if (state.id === nativeId && state.revision < revision) return;
    const restored = restoreTreadmill(state);
    nativeId = state.id; revision = state.revision;
    if (!(state.id === null && run?.status === 'finished' && run.id === savedId)) { run = restored; mode = state.mode; }
    message = savedId && savedId === run?.id ? 'บันทึกการวิ่งในเครื่องแล้ว' : state.message || 'พร้อมวิ่งบนลู่'; emit();
  }
  function refresh() {
    if (destroyed) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = enqueue(async () => {
      try { apply(await withTimeout(plugin.getTreadmillState())); ready = true; }
      catch { message = 'อ่านก้าวไม่ได้ ตรวจสิทธิ์กิจกรรม/การเคลื่อนไหวแล้วกลับเข้าแอป ข้อมูลเดิมยังอยู่'; }
      emit();
    }).finally(() => { refreshing = undefined; }); return refreshing;
  }
  function init() {
    if (initialized) return initialized;
    initialized = (async () => {
      try { listener = await withTimeout(plugin.addListener('treadmillStateChanged', () => { if (visible() && !busy) void refresh(); })); await refresh(); }
      catch { message = 'ระบบลู่วิ่ง native ไม่พร้อม ต้องติดตั้งแอปเวอร์ชันใหม่'; emit(); }
    })(); return initialized;
  }
  async function command(name, args) {
    if (busy || !ready || destroyed) return null;
    busy = true; emit();
    return enqueue(async () => {
      try { apply(await plugin[name](args)); return run; }
      catch {
        try { apply(await plugin.getTreadmillState()); } catch { /* Retain last readable summary. */ }
        message = 'สั่งงานลู่วิ่งไม่ได้ ตรวจสิทธิ์กิจกรรมและบันทึกรอบเดิมให้เสร็จก่อน ข้อมูลเดิมยังอยู่'; return null;
      } finally { busy = false; emit(); }
    });
  }
  async function finish() {
    if (busy || !ready || !run || savedId === run.id) return null;
    busy = true; emit();
    return enqueue(async () => {
      try {
        apply(await plugin.finishTreadmill());
        if (!run || run.status !== 'finished') return null;
        const existing = await store.getRecord(run.id);
        const record = existing || { id: run.id, run: structuredClone(run), owner: null, share: true, cloud_state: 'pending' };
        await store.saveRecord(record);
        await plugin.acknowledgeTreadmill({ id: run.id });
        savedId = run.id; message = 'บันทึกการวิ่งในเครื่องแล้ว'; return record;
      } catch { message = 'ยังบันทึกไม่ครบ ข้อมูลต้นฉบับยังอยู่ในโทรศัพท์ กดบันทึกอีกครั้ง'; return null; }
      finally { busy = false; emit(); }
    });
  }
  const timer = schedule(() => { if (visible() && ready && !busy) { if (mode === 'running') void refresh(); else emit(); } }, 2000);
  return { init, refresh, snapshot, start: options => command('startTreadmill', options), pause: () => command('pauseTreadmill'), finish,
    setDistance: kilometers => command('setTreadmillDistance', { distance_m: kilometers * 1000 }),
    suspend: async () => {}, destroy() { destroyed = true; unschedule(timer); void listener?.remove(); } };
}
