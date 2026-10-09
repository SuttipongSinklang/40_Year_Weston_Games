import { activeMs } from './run-core.js';
import { replayNativeRun } from './run-native-replay.js';
import * as storage from './run-store.js';

// A native bridge call that never settles (Capacitor logs the exception but never
// rejects the promise) must surface as an error instead of freezing the tracker.
const PLUGIN_TIMEOUT_MS = 15000;
const withTimeout = (task, ms = PLUGIN_TIMEOUT_MS) => Promise.race([
  Promise.resolve(task),
  new Promise((_, reject) => setTimeout(() => reject(new Error('native bridge timeout')), ms)),
]);

export const isNativeApp = () => globalThis.Capacitor?.isNativePlatform?.() === true;

export async function nativeRunningPlugin() {
  const { registerPlugin } = await import('../assets/vendor/capacitor/native-bridge.js');
  // Capacitor's Proxy exposes a callable `then`. Returning it directly from
  // async would invoke WestonRunning.then() and never settle. Box the handle.
  return { plugin: registerPlugin('WestonRunning') };
}

export function createNativeRunTracker({ plugin, onChange = () => {}, store = storage,
  now = () => Date.now(), visible = () => !document.hidden, schedule = setInterval, unschedule = clearInterval } = {}) {
  let run = null, mode = 'idle', ready = false, busy = false, message = 'กำลังตรวจการวิ่งในเครื่อง…',
    savedId, nativeId, revision = -1, listener, destroyed = false, queue = Promise.resolve(), refreshing;
  const snapshot = () => ({ run, mode, ready, busy, message, background: true, saved: !!run && savedId === run.id,
    elapsed: run ? activeMs(run, now()) : 0 });
  const emit = () => { if (!destroyed) onChange(snapshot()); };
  const enqueue = action => {
    const task = queue.catch(() => {}).then(action); queue = task; return task;
  };
  function apply(state) {
    if (state.id === nativeId && state.revision < revision) return;
    const restored = replayNativeRun(state);
    if (state.id !== nativeId) { revision = -1; nativeId = state.id; }
    revision = state.revision;
    if (!(state.id === null && run?.status === 'finished' && savedId === run.id)) {
      run = restored.run; mode = state.mode;
    }
    message = state.message || ({ idle: 'พร้อมวิ่ง · บันทึกต่อได้เมื่อล็อกจอ', acquiring: 'กำลังรอ GPS ที่ชัดเจน',
      running: 'กำลังวิ่ง · บันทึกต่อเมื่อล็อกจอ', paused: 'พักอยู่ · กดวิ่งต่อเมื่อพร้อม',
      finished: 'จบแล้ว · กดบันทึกเพื่อเก็บเข้าประวัติ' }[mode]);
    if (mode === 'finished' && savedId === run?.id) message = 'บันทึกการวิ่งในเครื่องแล้ว';
    emit();
    return restored.full;
  }
  async function read() {
    const state = await withTimeout(plugin.getState());
    const full = apply(state);
    if (full && ['running', 'acquiring'].includes(mode)) {
      apply(await plugin.pause()); message = 'ถึงขีดจำกัดเส้นทาง กรุณาจบและบันทึกรอบนี้'; emit();
    }
  }
  function refresh() {
    if (destroyed) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = enqueue(async () => {
      try { await read(); ready = true; }
      catch { message = 'อ่านการวิ่งจากโทรศัพท์ไม่ได้ กลับเข้าแอปแล้วลองอีกครั้ง'; }
      emit();
    }).finally(() => { refreshing = undefined; });
    return refreshing;
  }
  async function init() {
    try {
      // No GPS request: attach listener before reading so a concurrent native fix isn't lost.
      listener = await withTimeout(plugin.addListener('stateChanged', () => { void refresh(); }));
      await refresh();
    } catch { message = 'ระบบ GPS ของแอปไม่พร้อม กรุณาติดตั้งแอปเวอร์ชันที่มีระบบวิ่ง'; emit(); }
  }
  async function command(name) {
    if (busy || !ready) return null;
    busy = true; emit();
    return enqueue(async () => {
      try { apply(await plugin[name]()); return run; }
      catch (error) {
        // Refresh authoritative state: native may have stopped even if the response failed.
        await read().catch(() => {});
        message = /permission|denied|authorization|precise/i.test(error?.message || '')
          ? 'ต้องอนุญาตตำแหน่งที่แม่นยำในตั้งค่าแอป แล้วกดเริ่มอีกครั้ง'
          : /disabled|provider/i.test(error?.message || '') ? 'เปิดบริการตำแหน่งของโทรศัพท์แล้วลองใหม่'
          : 'สั่งงานระบบวิ่งไม่ได้ ข้อมูลที่บันทึกยังอยู่ในเครื่อง กรุณาลองอีกครั้ง';
        return null;
      } finally { busy = false; emit(); }
    });
  }
  async function finish() {
    if (busy || !ready || !run || savedId === run.id) return null;
    busy = true; emit();
    return enqueue(async () => {
      try {
        apply(await plugin.finish());
        if (!run || run.status !== 'finished') return null;
        // Preserve an already saved/cloud-bound record when a previous ack was interrupted.
        const existing = await store.getRecord(run.id);
        const record = existing || { id: run.id, run: structuredClone(run), owner: null, share: true, cloud_state: 'pending' };
        await store.saveRecord(record);
        // Never erase the durable native journal before the history transaction commits.
        await plugin.acknowledge({ id: run.id });
        savedId = run.id; message = 'บันทึกการวิ่งในเครื่องแล้ว'; return record;
      } catch { message = 'ยังเก็บเข้าประวัติไม่ครบ ข้อมูล GPS ยังอยู่ในโทรศัพท์ กดบันทึกอีกครั้ง'; return null; }
      finally { busy = false; emit(); }
    });
  }
  const timer = schedule(() => {
    if (visible() && ready && !busy) { if (['running', 'acquiring'].includes(mode)) void refresh(); else emit(); }
  }, 2000);
  return { init, snapshot, refresh, start: () => command('start'), pause: () => command('pause'), finish,
    // Native service owns capture; lifecycle/navigation never pause an active session.
    suspend: async () => {},
    destroy() { destroyed = true; unschedule(timer); void listener?.remove(); } };
}
