import { createNativeTreadmillTracker } from "./run-native-treadmill.js?v=20261009-2";
import { createRunTracker } from './run-tracker.js?v=20261009-8';
import { createPhoneSteps } from './run-steps.js?v=20261009-6';
import { createNativeRunTracker, isNativeApp, nativeRunningPlugin } from './run-native-tracker.js';
import { restoreRun } from './run-core.js?v=20261009-8';
import { createRunSync } from './run-cloud.js';
import { createRunMap } from './run-map.js?v=20261009-8';
import { listRecords, getRecord, saveRecord, loadDraft } from './run-store.js';
import { playerSession, saveRunToCloud, loadRunsFromCloud } from './data.js?v=20261009-6';

const $ = id => document.getElementById(id);
const DEFAULT_STRIDE_M = 0.75;
export function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function pace(ms, meters) {
  if (meters < 20 || ms <= 0) return '—';
  const seconds = Math.round(ms / meters);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export async function initializeRunning({ toast }) {
  const native = isNativeApp();
  let current, selected, detailTrigger, detailGeneration = 0, historyGeneration = 0, wake, wakePending, wakeMessage = '', lastMapKey;
  let treadmillSelected = false, tracker, treadmillTracker, treadmillId, legacyTreadmill;
  const { plugin } = native ? await nativeRunningPlugin() : {};
  const phoneSteps = createPhoneSteps({ plugin });
  function activityUI(type) {
    treadmillSelected = type === 'treadmill';
    document.querySelectorAll('[name="runActivity"]').forEach(input => { input.checked = input.value === type; });
    $('runRoutePanel').hidden = treadmillSelected;
    $('mapMessage').hidden = treadmillSelected;
    $('runScreenHint').textContent = treadmillSelected
      ? 'เวลาจับต่อจนกดพักหรือจบ · ระยะทางกรอกเองจากเครื่อง'
      : native ? 'ล็อกจอหรือสลับแอปได้ระหว่างวิ่ง · กดพักหรือจบเพื่อหยุด GPS · การบังคับปิดแอปอาจหยุดบันทึก'
      : 'เว็บจะพยายามบันทึกต่อ · เมื่อล็อกจอ เบราว์เซอร์อาจหยุดส่ง GPS';
  }
  const map = createRunMap({ container: $('runMap'), sketch: $('runSketch'), empty: $('runMapEmpty'), message: $('mapMessage') });
  const detailMap = createRunMap({ container: $('detailMap'), sketch: $('detailSketch'), empty: $('detailMapEmpty'), message: $('detailMapMessage') });
  const runSync = createRunSync({ getSession: playerSession, saveRemote: saveRunToCloud, onChange(value) {
    if (!selected || (value.id && selected.id !== value.id)) return;
    void getRecord(selected.id).then(record => {
      if (!record || selected?.id !== record.id) return;
      selected = record;
      if ($('runDetailDialog').open) {
        $('detailSaveState').textContent = value.cloud_state === 'saved' ? 'บันทึกออนไลน์แล้ว'
          : /anonymous|disabled/i.test(value.message || '') ? 'รอบันทึกออนไลน์ · ยังไม่ได้เปิดการเข้าสู่ระบบในเซิร์ฟเวอร์'
          : /another account/i.test(value.message || '') ? 'รอบันทึกในบัญชีเดิม · รายการนี้ผูกกับบัญชีอื่น'
          : 'รอบันทึกออนไลน์ · ระบบจะลองใหม่อัตโนมัติ';
      }
    }).catch(() => {});
  } });
  let onlineSync;
  function syncOnline() {
    if (onlineSync) return onlineSync;
    onlineSync = (async () => {
      await runSync.flush();
      if (!$('runHistoryPanel').hidden) await refreshCloud();
    })().catch(() => {}).finally(() => { onlineSync = null; });
    return onlineSync;
  }
  window.addEventListener('online', () => void syncOnline());
  setInterval(() => { if (!document.hidden) void syncOnline(); }, 30000);
  async function wakeScreen(enabled) {
    if (!enabled) { if (wake) await wake.release().catch(() => {}); wake = null; return; }
    if (wake || wakePending || document.hidden) return;
    try {
      if (navigator.wakeLock) {
        wakePending = navigator.wakeLock.request('screen');
        const acquired = await wakePending;
        if (document.hidden || !['running', 'acquiring'].includes(current?.mode)) await acquired.release();
        else { wake = acquired; acquired.addEventListener('release', () => { if (wake === acquired) wake = null; }); }
      }
    }
    catch { wakeMessage = 'โทรศัพท์ไม่อนุญาตให้ค้างหน้าจอ กรุณาเปิดหน้านี้ไว้ขณะวิ่ง'; $('runScreenHint').textContent = wakeMessage; }
    finally { wakePending = undefined; }
  }
  function render(value) {
    current = value;
    if (value.run && !value.saved) activityUI(value.run.activity || 'outdoor');
    const locked = Boolean(value.busy || (value.run && !value.saved));
    document.querySelectorAll('[name="runActivity"]').forEach(input => { input.disabled = locked; });
    $('runTreadmillDistance').disabled = value.busy || Boolean(value.saved) || !value.run;
    const automatic = !value.run || value.saved || value.run.activity !== 'treadmill' || value.run.distance_source === 'phone_steps';
    $('runTreadmillRecoveryPanel').hidden = !(treadmillSelected && value.run && !value.saved && !automatic);
    $('runStepMetric').hidden = !(treadmillSelected && automatic);
    $('runStepCount').textContent = (value.run?.steps || 0).toLocaleString('th-TH');
    if (treadmillSelected) $('runScreenHint').textContent = automatic
      ? native ? 'พกโทรศัพท์ติดตัว · ล็อกจอได้ · iPhone รวมก้าวเมื่อกลับเข้าแอป · ระยะทางเป็นค่าประมาณ' : 'พกโทรศัพท์ติดตัวเพื่อจับก้าว · เวลายังเดินต่อ · เบราว์เซอร์อาจหยุดส่งก้าวเมื่อล็อกจอ'
      : native ? 'จับเวลาต่อเมื่อล็อกจอ · กรอกระยะทางจากเครื่องก่อนบันทึก' : 'เวลาจับต่อจนกดพักหรือจบ · ระยะทางกรอกเองจากเครื่อง';
    $('runDistanceLabel').textContent = treadmillSelected && automatic ? 'ระยะทางประมาณจากก้าว' : 'ระยะทาง';
    $('runTreadmillDistance').hidden = automatic;
    document.querySelector('label[for="runTreadmillDistance"]').hidden = automatic;
    if (treadmillSelected && value.run && value.run.id !== treadmillId) {
      treadmillId = value.run.id;
      $('runTreadmillDistance').value = value.run.distance_m ? (value.run.distance_m / 1000).toString() : '';
    }
    $('runDistance').textContent = ((value.run?.distance_m || 0) / 1000).toFixed(2);
    $('runTime').textContent = duration(value.elapsed);
    $('runPace').textContent = pace(value.elapsed, value.run?.distance_m || 0);
    $('runStatus').textContent = { idle: 'พร้อมวิ่ง', acquiring: 'รอ GPS', running: 'กำลังวิ่ง', paused: 'พักอยู่', finished: 'จบการวิ่ง' }[value.mode];
    $('runStatus').dataset.state = value.mode;
    $('runMessage').textContent = value.message;
    $('runStart').textContent = value.mode === 'paused' ? 'วิ่งต่อ' : value.mode === 'finished' ? 'เริ่มรอบใหม่' : 'เริ่มวิ่ง';
    $('runStart').hidden = ['running', 'acquiring'].includes(value.mode);
    $('runStart').disabled = value.busy || !value.ready || (value.mode === 'finished' && !value.saved);
    $('runPause').hidden = !['running', 'acquiring'].includes(value.mode);
    $('runPause').textContent = value.mode === 'acquiring' ? 'ยกเลิกการรอ GPS' : 'พักการวิ่ง';
    $('runFinish').hidden = !value.run || value.saved;
    $('runFinish').textContent = value.mode === 'finished' ? 'บันทึกการวิ่ง' : 'จบและบันทึก';
    $('runFinish').disabled = value.busy || !value.run || value.mode === 'acquiring';
    $('runActions').setAttribute('aria-busy', String(value.busy));
    const mapKey = `${value.run?.id}-${value.run?.points.length}-${value.run?.events?.length}`;
    if (mapKey !== lastMapKey) { map.render(value.run); lastMapKey = mapKey; }
    if (!native) void wakeScreen(value.mode === 'running' || value.mode === 'acquiring');
  }
  tracker = native
    ? createNativeRunTracker({ plugin, onChange: value => { if (!treadmillSelected) render(value); } })
    : createRunTracker({ onChange: render, motion: phoneSteps });
  const outdoorTracker = tracker;
  if (native) treadmillTracker = createNativeTreadmillTracker({ plugin, onChange: value => { if (treadmillSelected) render(value); } });
  document.querySelectorAll('[name="runActivity"]').forEach(input => input.addEventListener('change', async () => {
    if (current?.busy || (current?.run && !current.saved)) return;
    activityUI(input.value);
    if (treadmillSelected) {
      if (native) { tracker = treadmillTracker; await tracker.init(); }
    } else if (native) { tracker = outdoorTracker; await tracker.refresh(); }
    render(tracker.snapshot());
  }));
  $('runTreadmillDistance').addEventListener('input', () => {
    const value = $('runTreadmillDistance').value;
    const valid = value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 200;
    $('runTreadmillDistance').setAttribute('aria-invalid', String(!valid));
    $('runTreadmillError').textContent = valid ? '' : 'กรอกระยะทาง 0–200 กม. จากหน้าจอเครื่อง';
    if (valid) tracker.setDistance?.(Number(value));
  });
  function tab(target) {
    document.querySelector('#screen-run .page-scroll').scrollTop = 0;
    $('runLivePanel').hidden = target !== 'live'; $('runHistoryPanel').hidden = target !== 'history';
    document.querySelectorAll('[data-run-tab]').forEach(button => {
      const active = button.dataset.runTab === target;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    if (target === 'history') { void history(); void syncOnline(); } else requestAnimationFrame(() => map.resize());
  }
  async function history() {
    const request = ++historyGeneration;
    $('runHistoryState').textContent = 'กำลังอ่านประวัติในเครื่อง…';
    try {
      const records = await listRecords(); if (request !== historyGeneration) return;
      $('runHistoryList').replaceChildren();
      $('runHistoryState').textContent = records.length ? '50 รายการล่าสุดในเครื่องนี้' : 'ยังไม่มีการวิ่ง เริ่มบันทึกรอบแรกของคุณ';
      for (const record of records) {
        const item = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.className = 'run-history-item';
        const date = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(record.run.started_at));
        const cloud = record.cloud_state === 'saved' ? 'บันทึกออนไลน์แล้ว' : record.cloud_state === 'pending' ? 'รอบันทึกออนไลน์' : 'เก็บในเครื่อง';
        button.innerHTML = '<span class="run-history-date"></span><strong></strong><span class="run-history-meta"></span><span class="run-history-save"></span>';
        button.querySelector('.run-history-date').textContent = date;
        button.querySelector('strong').textContent = `${(record.run.distance_m / 1000).toFixed(2)} กม.`;
        button.querySelector('.run-history-meta').textContent = `${record.run.activity === 'treadmill' ? record.run.distance_source === 'phone_steps' ? 'ลู่วิ่ง · ประมาณจากก้าว' : 'ลู่วิ่ง · กรอกระยะทางเอง' : 'กลางแจ้ง · GPS'} · ${duration(record.run.elapsed_ms)} · ${pace(record.run.elapsed_ms, record.run.distance_m)} นาที/กม.`;
        button.querySelector('.run-history-save').textContent = cloud;
        button.addEventListener('click', () => void showRecord(record.id, button)); item.appendChild(button); $('runHistoryList').appendChild(item);
      }
    } catch { $('runHistoryState').textContent = 'อ่านประวัติในเครื่องไม่ได้ ลองเปิดหน้านี้อีกครั้ง'; }
  }
  function renderDetails() {
    const run = selected.run;
    $('runDetailTitle').textContent = `${run.activity === 'treadmill' ? 'ลู่วิ่ง' : 'การวิ่ง'} ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(run.started_at))}`;
    $('detailMap').parentElement.hidden = run.activity === 'treadmill';
    $('detailMapMessage').textContent = run.activity === 'treadmill'
      ? run.distance_source === 'phone_steps' ? `ระยะทางประมาณจากก้าว · ${run.steps || 0} ก้าว · ไม่มี GPS` : 'ระยะทางกรอกเองจากลู่วิ่ง · ไม่มี GPS หรือเส้นทาง'
      : 'เส้นทางที่บันทึก · P = พัก / R = วิ่งต่อ · เลขคือครั้งที่พัก';
    $('detailDistance').textContent = `${(run.distance_m / 1000).toFixed(2)} กม.`;
    $('detailTime').textContent = duration(run.elapsed_ms); $('detailPace').textContent = pace(run.elapsed_ms, run.distance_m);
    const measuredSteps = run.distance_source === 'phone_steps';
    $('detailSteps').textContent = measuredSteps ? (run.steps || 0).toLocaleString('th-TH') : '—';
    $('detailStride').textContent = measuredSteps && run.stride_m ? Number(run.stride_m).toFixed(2) : '—';
    $('detailCadence').textContent = measuredSteps && run.elapsed_ms > 0 ? String(Math.round((run.steps || 0) / (run.elapsed_ms / 60000))) : '—';
    $('detailSaveState').textContent = selected.cloud_state === 'saved' ? 'บันทึกออนไลน์แล้ว'
      : selected.cloud_state === 'pending' ? 'รอบันทึกออนไลน์ · ระบบจะลองใหม่อัตโนมัติเมื่อเชื่อมต่อได้'
      : 'ประวัติเดิมในเครื่อง';
    $('runEventList').replaceChildren();
    for (const event of run.events || []) {
      const item = document.createElement('li');
      item.textContent = `${event.type === 'pause' ? 'P' : 'R'}${event.index} · ${event.type === 'pause' ? 'พัก' : 'วิ่งต่อ'}ครั้งที่ ${event.index} · ${new Date(event.at).toLocaleTimeString('th-TH')}${event.lat === null ? ' · ไม่มีตำแหน่ง GPS' : ''}`;
      $('runEventList').appendChild(item);
    }
    $('runEventList').hidden = !(run.events?.length);
    $('runSplits').replaceChildren();
    for (const split of run.splits) {
      const row = document.createElement('tr');
      for (const text of [`${split.km}`, duration(split.duration_ms), `${Math.floor(split.pace_sec / 60)}:${String(Math.round(split.pace_sec) % 60).padStart(2,'0')}`]) {
        const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
      }
      $('runSplits').appendChild(row);
    }
    $('runSplitsEmpty').hidden = run.splits.length > 0;
    $('runSplitsEmpty').textContent = run.activity === 'treadmill'
      ? 'ลู่วิ่งบันทึกระยะทางรวม จึงไม่มีเวลาแยกรายกิโลเมตร' : 'ยังไม่ครบ 1 กิโลเมตร';
    detailMap.render(run);
  }
  async function showRecord(id, trigger) {
    const request = ++detailGeneration;
    try {
      const record = await getRecord(id); if (!record || request !== detailGeneration) return;
      selected = record; detailTrigger = trigger;
      renderDetails(); $('runDetailDialog').showModal();
      $('detailBasemapConsent').checked = record.run.activity !== 'treadmill';
      void detailMap.setBasemap($('detailBasemapConsent').checked);
    } catch { toast('เปิดรายละเอียดการวิ่งไม่ได้'); }
  }
  async function refreshCloud() {
    $('runHistoryState').textContent = 'กำลังโหลดประวัติส่วนตัวจากบัญชี…';
    try {
      const { rows, owner } = await loadRunsFromCloud();
      for (const row of rows) {
        const existing = await getRecord(row.id);
        if (existing && existing.owner && existing.owner !== owner) continue;
        const run = restoreRun({
          id: row.id, status: 'finished', started_at: row.started_at, ended_at: row.ended_at,
          elapsed_ms: Number(row.duration_s) * 1000, resumed_at: null, updated_at: Date.parse(row.ended_at),
          segment: 0, activity: row.activity || 'outdoor', distance_source: row.distance_source || 'gps', steps: row.steps || 0, stride_m: row.stride_m,
          distance_m: Number(row.distance_m), points: row.route, splits: row.splits, events: row.events || [],
        });
        if (run) await saveRecord({ id: row.id, owner, share: true, cloud_state: 'saved', run });
      }
      await history();
    } catch { $('runHistoryState').textContent = 'ยังเชื่อมต่อออนไลน์ไม่ได้ · ประวัติที่บันทึกไว้ยังอยู่'; }
  }
  document.querySelectorAll('[data-run-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.runTab)));
  $('runStart').addEventListener('click', async () => {
    if (native && legacyTreadmill && current?.saved) {
      legacyTreadmill.destroy(); legacyTreadmill = null; tracker = treadmillTracker;
      await tracker.refresh();
    }
    $('runTreadmillError').textContent = '';
    void tracker.start({ activity: treadmillSelected ? 'treadmill' : 'outdoor', automatic: true, stride_m: DEFAULT_STRIDE_M });
  });
  $('runPause').addEventListener('click', () => void tracker.pause());
  $('runFinish').addEventListener('click', async () => {
    if (treadmillSelected && current?.run?.distance_source !== 'phone_steps') {
      const input = $('runTreadmillDistance');
      if (!input.value.trim() || !Number.isFinite(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > 200) {
        $('runTreadmillError').textContent = 'กรอกระยะทาง 0–200 กม. จากเครื่องก่อนบันทึก'; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
      }
      await tracker.setDistance(Number(input.value));
    }
    const record = await tracker.finish(); if (!record) return;
    $('runFinish').hidden = true;
    try { await runSync.enqueue(record); }
    catch { toast('เก็บการวิ่งไว้แล้ว · กำลังรอระบบบันทึกออนไลน์'); }
    await showRecord(record.id, $('runStart'));
    void syncOnline();
  });
  $('detailBasemapConsent').addEventListener('change', () => {
    void detailMap.setBasemap($('detailBasemapConsent').checked);
  });
  $('runCenter').addEventListener('click', () => map.center());
  $('runDetailDialog').addEventListener('close', () => { detailGeneration++; detailTrigger?.focus(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncOnline();
    if (native) { if (!document.hidden) void tracker.refresh(); }
    else if (document.hidden) void tracker.background();
    else void tracker.foreground();
  });
  window.addEventListener('pagehide', event => { if (!native) void (event.persisted ? tracker.background() : tracker.suspend()); });
  window.addEventListener('pageshow', () => { if (native) void tracker.refresh(); else void tracker.foreground(); });
  window.addEventListener('beforeunload', event => {
    if ((!native) && ['running', 'acquiring'].includes(current?.mode)) { event.preventDefault(); event.returnValue = ''; }
  });
  $('runScreenHint').textContent = native
    ? 'ล็อกจอหรือสลับแอปได้ระหว่างวิ่ง · กดพักหรือจบเพื่อหยุด GPS · การบังคับปิดแอปอาจหยุดบันทึก'
    : 'เว็บจะพยายามบันทึกต่อ · เมื่อล็อกจอ เบราว์เซอร์อาจหยุดส่ง GPS';
  document.querySelectorAll('#screen-run button, #runDetailDialog button').forEach(button => { button.disabled = false; });
  // Native recovery must not delay opening the map or the running screen.
  render(tracker.snapshot());
  const trackerReady = tracker.init();
  if (!native) await trackerReady;
  if (native) {
    // Treadmill bridge readiness must never block the running screen: a native
    // getTreadmillState that never answers would otherwise freeze map init and
    // every control (observed on device 2026-10-09). Recovery runs when it lands.
    void (async () => {
      await trackerReady;
      await treadmillTracker.init();
      if (treadmillTracker.snapshot().run && !treadmillTracker.snapshot().saved && (!current?.run || current.saved)) { activityUI('treadmill'); tracker = treadmillTracker; render(tracker.snapshot()); }
      else if (!current?.run || current.saved) {
        const draft = await loadDraft().catch(() => null);
        if (draft?.activity === 'treadmill') {
          // Retain an unsaved foreground-era draft. Finish it before starting native capture.
          activityUI('treadmill');
          legacyTreadmill = createRunTracker({ activity: 'treadmill', motion: phoneSteps, onChange(value) {
            if (tracker === legacyTreadmill) render(value.saved ? value : { ...value, ready: false,
              message: 'รอบเดิมกู้เป็นพัก กรุณาจบและบันทึกก่อนเริ่มรอบใหม่ที่รองรับล็อกจอ' });
          } });
          tracker = legacyTreadmill; await tracker.init();
        }
      }
    })().catch(() => { $('runMessage').textContent = 'กู้การวิ่งในเครื่องไม่ได้ กรุณากลับเข้าแอปอีกครั้ง'; });
  }
  return { enter() {
    void syncOnline();
    void map.setBasemap(true);
    map.resize();
    if (native) void tracker.refresh();
  }, leave() {
    if (!native) void tracker.background();
  } };
}
