import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreTreadmill, createNativeTreadmillTracker } from '../webgame/js/run-native-treadmill.js';
const T = Date.parse('2026-10-09T00:00:00Z');
const ID = 'a0000000-0000-4000-8000-000000000001';
const state = (extra = {}) => ({ version: 1, revision: 1, id: ID, mode: 'running', started_at: T,
  updated_at: T, resumed_at: T, ended_at: null, elapsed_ms: 0, steps: 0, stride_m: .75,
  distance_m: 0, distance_source: 'phone_steps', message: '', ...extra });
const idle = () => ({ version: 1, revision: 0, id: null, mode: 'idle', message: '' });
function fixture(initial = state()) {
  let durable = initial, clock = T, visible = true, notify, tick;
  const calls = [], records = new Map();
  const plugin = {
    async addListener(name, callback) { assert.equal(name, 'treadmillStateChanged'); notify = callback; return { remove() {} }; },
    async getTreadmillState() { calls.push('read'); return structuredClone(durable); },
    async startTreadmill(options) { calls.push('start'); durable = state({ revision: durable.revision + 1, ...options }); return structuredClone(durable); },
    async pauseTreadmill() { calls.push('pause'); durable = { ...durable, revision: durable.revision + 1, mode: 'paused', elapsed_ms: durable.elapsed_ms + clock - durable.resumed_at, resumed_at: null, updated_at: clock }; return structuredClone(durable); },
    async finishTreadmill() {
      calls.push('finish');
      if (durable.mode !== 'finished') durable = { ...durable, revision: durable.revision + 1, mode: 'finished',
        elapsed_ms: durable.elapsed_ms + (durable.resumed_at == null ? 0 : clock - durable.resumed_at), resumed_at: null, updated_at: clock, ended_at: clock };
      return structuredClone(durable);
    },
    async acknowledgeTreadmill({ id }) { calls.push('ack'); assert.ok(records.has(id)); durable = idle(); },
    async setTreadmillDistance({ distance_m }) { calls.push('distance'); durable = { ...durable, distance_m, revision: durable.revision + 1 }; return structuredClone(durable); },
  };
  const store = { async getRecord(id) { return structuredClone(records.get(id)); }, async saveRecord(r) { calls.push('save'); records.set(r.id, structuredClone(r)); } };
  const tracker = createNativeTreadmillTracker({ plugin, store, now: () => clock, visible: () => visible,
    schedule: cb => { tick = cb; return 1; }, unschedule() {} });
  return { tracker, plugin, store, calls, records, time(t) { clock = t; }, hide() { visible = false; }, show() { visible = true; },
    native(value) { durable = value; }, notify() { notify(); }, tick() { tick(); }, get durable() { return durable; } };
}
test('native treadmill live snapshot stays running and elapsed continues across a long lock', async () => {
  const e = fixture(); await e.tracker.init(); e.hide(); e.time(T + 900000); await e.tracker.suspend(); e.tick();
  assert.equal(e.tracker.snapshot().elapsed, 900000); assert.equal(e.tracker.snapshot().run.status, 'running');
  assert.ok(!e.calls.includes('pause')); assert.ok(!e.calls.includes('start'));
  e.native(state({ revision: 2, steps: 1800, distance_m: 1350, updated_at: T + 900000 })); e.show(); await e.tracker.refresh();
  assert.equal(e.tracker.snapshot().run.steps, 1800); assert.equal(e.tracker.snapshot().run.distance_m, 1350);
  await e.tracker.refresh(); assert.equal(e.tracker.snapshot().run.steps, 1800, 'replace cumulative steps; never add twice');
  assert.deepEqual(e.tracker.snapshot().run.points, []);
});
test('native treadmill paused interval excludes time and native totals exclude paused steps', async () => {
  const e = fixture(state({ mode: 'paused', resumed_at: null, elapsed_ms: 60000, updated_at: T + 60000, steps: 120, distance_m: 90 }));
  e.time(T + 3600000); await e.tracker.init(); assert.equal(e.tracker.snapshot().elapsed, 60000);
  e.native(state({ revision: 2, resumed_at: T + 3600000, updated_at: T + 3600000, elapsed_ms: 60000, steps: 120, distance_m: 90 }));
  await e.tracker.refresh(); e.time(T + 3630000); assert.equal(e.tracker.snapshot().elapsed, 90000);
});
test('history commit precedes native ack; retry after disk failure is idempotent', async () => {
  const e = fixture(state({ steps: 20, distance_m: 15 })); e.time(T + 10000); await e.tracker.init();
  const save = e.store.saveRecord; e.store.saveRecord = async () => { throw new Error('Disk full'); };
  assert.equal(await e.tracker.finish(), null); assert.ok(!e.calls.includes('ack')); assert.equal(e.durable.mode, 'finished');
  e.store.saveRecord = save; const r = await e.tracker.finish(); assert.equal(r.run.elapsed_ms, 10000);
  assert.equal(r.run.steps, 20); assert.ok(e.calls.indexOf('save') < e.calls.indexOf('ack')); assert.equal(e.records.size, 1);
  await e.tracker.refresh(); assert.equal(e.tracker.snapshot().saved, true); assert.equal(await e.tracker.finish(), null);
});
test('ack failure retains native journal and retry preserves cloud-bound existing history', async () => {
  const e = fixture(); e.time(T + 1000); await e.tracker.init();
  const ack = e.plugin.acknowledgeTreadmill; e.plugin.acknowledgeTreadmill = async () => { throw new Error('Bridge'); };
  assert.equal(await e.tracker.finish(), null); assert.equal(e.durable.mode, 'finished');
  const record = e.records.get(ID); record.owner = 'existing-owner'; record.share = true; record.cloud_state = 'saved';
  e.plugin.acknowledgeTreadmill = ack; const result = await e.tracker.finish(); assert.equal(result.owner, 'existing-owner'); assert.equal(result.share, true);
});
test('reload reads authoritative native session without requesting motion or starting capture', async () => {
  const e = fixture(state({ steps: 600, distance_m: 450, updated_at: T + 300000 })); e.time(T + 300000);
  await e.tracker.init(); await e.tracker.init(); assert.deepEqual(e.calls, ['read']);
  assert.equal(e.tracker.snapshot().elapsed, 300000); assert.equal(e.tracker.snapshot().background, true);
});
test('out-of-order snapshots and denied native start never fabricate a treadmill run', async () => {
  const e = fixture(state({ revision: 5, steps: 40, distance_m: 30 })); await e.tracker.init();
  e.native(state({ revision: 2, steps: 10, distance_m: 7.5 })); await e.tracker.refresh(); assert.equal(e.tracker.snapshot().run.steps, 40);
  const denied = fixture(idle()); await denied.tracker.init(); denied.plugin.startTreadmill = async () => { throw new Error('Denied'); };
  assert.equal(await denied.tracker.start({ automatic: true, stride_m: .75 }), null); assert.equal(denied.tracker.snapshot().run, null);
});
test('manual native treadmill supports locked timer and manual distance without fabricated steps', async () => {
  const e = fixture(state({ distance_source: 'manual', stride_m: null })); await e.tracker.init(); e.hide(); e.time(T + 60000);
  await e.tracker.suspend(); await e.tracker.setDistance(1.2); const r = await e.tracker.finish();
  assert.equal(r.run.distance_m, 1200); assert.equal(r.run.steps, 0); assert.equal(r.run.elapsed_ms, 60000);
});
test('malformed treadmill chronology and step-distance consistency reject before display/save', () => {
  for (const value of [state({ distance_m: 100 }), state({ steps: -1 }), state({ stride_m: 0 }),
    state({ resumed_at: T - 1 }), state({ updated_at: T - 1 }), state({ mode: 'finished', resumed_at: null }),
    state({ revision: NaN }), state({ distance_source: 'gps' })]) assert.throws(() => restoreTreadmill(value));
});
