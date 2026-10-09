import test from 'node:test';
import assert from 'node:assert/strict';
import { replayNativeRun } from '../webgame/js/run-native-replay.js';
import { createNativeRunTracker } from '../webgame/js/run-native-tracker.js';
import { shareNativeGPX } from '../webgame/js/run-export.js';
const T = Date.parse('2026-10-08T01:00:00Z');
const ID = '10000000-0000-4000-8000-000000000001';
const fix = (seconds, meters) => ({ type: 'fix', at: T + seconds * 1000, timestamp: T + seconds * 1000,
  latitude: 13 + meters / 111194.9266, longitude: 100, accuracy: 5 });
const state = (events = [], mode = 'running', extra = {}) => ({ version: 1, id: ID, mode, events, revision: events.length + 1, message: '', ...extra });

test('buffered native fixes replay at capture time after a long screen lock', () => {
  const events = Array.from({ length: 721 }, (_, i) => fix(i * 10, i * 25));
  const { run } = replayNativeRun(state(events));
  assert.equal(run.points.length, 721);
  assert.ok(Math.abs(run.distance_m - 18000) < 1);
  assert.equal(run.splits.length, 18);
  assert.equal(run.points.at(-1).active_ms, 7200000);
});
test('native pause excludes locked paused time and resume cannot bridge movement', () => {
  const events = [fix(0, 0), fix(10, 50), { type: 'pause', at: T + 10000 }, fix(110, 800), fix(120, 850),
    { type: 'finish', at: T + 120000 }];
  const { run } = replayNativeRun(state(events, 'finished'));
  assert.equal(run.status, 'finished'); assert.equal(run.elapsed_ms, 20000);
  assert.ok(Math.abs(run.distance_m - 100) < .1);
  assert.notEqual(run.points[1].segment, run.points[2].segment);
});
test('native GPS gaps never invent distance while the screen was off', () => {
  const { run } = replayNativeRun(state([fix(0, 0), fix(10, 50), fix(100, 1000), fix(110, 1050)]));
  assert.ok(Math.abs(run.distance_m - 100) < .1);
  assert.notEqual(run.points[1].segment, run.points[2].segment);
});
test('native acquiring before the first fix has no run or elapsed clock', () => {
  assert.equal(replayNativeRun(state([], 'acquiring')).run, null);
  const paused = state([fix(0, 0), { type: 'pause', at: T + 10000 }], 'acquiring');
  assert.equal(replayNativeRun(paused).run.status, 'paused');
});
test('malformed native coordinates, chronology and inconsistent terminal state fail closed', () => {
  for (const value of [state([{ ...fix(0, 0), latitude: NaN }]), state([{ ...fix(0, 0), accuracy: 80 }]),
    state([fix(10, 0), fix(0, 5)]), state([fix(0, 0)], 'finished'),
    state([fix(0, 0), { type: 'finish', at: T + 10000 }, fix(20, 50)])]) {
    assert.throws(() => replayNativeRun(value));
  }
});

function setup(initial = { version: 1, id: null, mode: 'idle', events: [], revision: 0, message: '' }) {
  let durable = structuredClone(initial), clock = T, visible = true, handler, tick;
  const calls = [], records = new Map();
  const plugin = {
    async getState() { calls.push('read'); return structuredClone(durable); },
    async addListener(name, callback) { assert.equal(name, 'stateChanged'); handler = callback; return { remove() {} }; },
    async start() { calls.push('start'); if (!durable.id) durable.id = ID; durable.mode = 'acquiring'; durable.revision++; return structuredClone(durable); },
    async pause() { calls.push('pause'); durable.events.push({ type: 'pause', at: clock }); durable.mode = 'paused'; durable.revision++; return structuredClone(durable); },
    async finish() { calls.push('finish'); if (durable.mode !== 'finished') durable.events.push({ type: 'finish', at: clock }); durable.mode = 'finished'; durable.revision++; return structuredClone(durable); },
    async acknowledge({ id }) { calls.push('ack'); assert.ok(records.has(id), 'history must commit before clearing native storage');
      durable = { version: 1, id: null, mode: 'idle', events: [], revision: durable.revision + 1, message: '' }; return structuredClone(durable); },
  };
  const store = {
    async getRecord(id) { return structuredClone(records.get(id)); },
    async saveRecord(record) { calls.push('save'); records.set(record.id, structuredClone(record)); },
  };
  const tracker = createNativeRunTracker({ plugin, store, now: () => clock, visible: () => visible,
    schedule: callback => { tick = callback; return 1; }, unschedule() {} });
  return { tracker, plugin, store, calls, records, get durable() { return durable; },
    setTime(t) { clock = t; }, hide() { visible = false; }, show() { visible = true; }, tick: () => tick(),
    nativeFix(seconds, meters) { durable.events.push(fix(seconds, meters)); durable.mode = 'running'; durable.revision++; },
    notify: () => handler() };
}
test('initialization recovers native state without starting GPS; hidden JS does not pause capture', async () => {
  const e = setup(state([fix(0, 0)])); await e.tracker.init();
  assert.equal(e.tracker.snapshot().background, true); assert.ok(!e.calls.includes('start'));
  e.hide(); await e.tracker.suspend(); e.tick();
  e.nativeFix(10, 50); e.nativeFix(20, 100); e.setTime(T + 20000);
  assert.ok(!e.calls.includes('pause'));
  e.show(); await e.tracker.refresh();
  assert.equal(e.tracker.snapshot().mode, 'running');
  assert.ok(Math.abs(e.tracker.snapshot().run.distance_m - 100) < .1);
  assert.equal(e.tracker.snapshot().elapsed, 20000);
});
test('finish commits history then acknowledges native journal; repeated finish cannot duplicate', async () => {
  const e = setup(state([fix(0, 0), fix(10, 50)])); e.setTime(T + 20000); await e.tracker.init();
  const record = await e.tracker.finish(); assert.equal(record.share, true); assert.equal(record.owner, null);
  assert.ok(e.calls.indexOf('save') < e.calls.indexOf('ack'));
  assert.equal(e.records.size, 1); assert.equal(e.durable.id, null);
  assert.equal(e.tracker.snapshot().saved, true); await e.tracker.refresh();
  assert.equal(e.tracker.snapshot().mode, 'finished'); assert.equal(e.tracker.snapshot().run.id, ID);
  assert.equal(await e.tracker.finish(), null);
});
test('history write failure retains complete native route for an explicit retry', async () => {
  const e = setup(state([fix(0, 0), fix(10, 50)])); e.setTime(T + 20000); await e.tracker.init();
  const save = e.store.saveRecord; e.store.saveRecord = async () => { throw new Error('Disk full'); };
  assert.equal(await e.tracker.finish(), null); assert.ok(!e.calls.includes('ack'));
  assert.equal(e.durable.mode, 'finished'); assert.equal(e.tracker.snapshot().saved, false);
  e.store.saveRecord = save; const record = await e.tracker.finish(); assert.equal(record.run.points.length, 2);
});
test('interrupted acknowledgement preserves cloud consent/owner on retry', async () => {
  const e = setup(state([fix(0, 0), fix(10, 50), { type: 'finish', at: T + 20000 }], 'finished'));
  const record = { id: ID, run: replayNativeRun(e.durable).run, owner: 'owner-a', share: true, cloud_state: 'saved' };
  e.records.set(ID, structuredClone(record)); await e.tracker.init();
  const saved = await e.tracker.finish(); assert.deepEqual(saved, record); assert.equal(e.records.size, 1);
});
test('concurrent button presses invoke a single native start', async () => {
  const e = setup(); await e.tracker.init(); await Promise.all([e.tracker.start(), e.tracker.start()]);
  assert.equal(e.calls.filter(x => x === 'start').length, 1); assert.equal(e.tracker.snapshot().mode, 'acquiring');
});
test('missing native plugin fails closed without falling back to browser GPS', async () => {
  const e = setup(); e.plugin.getState = async () => { throw new Error('not implemented'); };
  await e.tracker.init(); assert.equal(e.tracker.snapshot().ready, false);
  await e.tracker.start(); assert.ok(!e.calls.includes('start'));
});
test('failed native acknowledgement retries without duplicate history or losing coordinates', async () => {
  const e = setup(state([fix(0, 0), fix(10, 50)])); e.setTime(T + 20000); await e.tracker.init();
  const acknowledge = e.plugin.acknowledge;
  e.plugin.acknowledge = async () => { throw new Error('Bridge interrupted'); };
  assert.equal(await e.tracker.finish(), null); assert.equal(e.records.size, 1);
  assert.equal(e.durable.mode, 'finished'); assert.equal(e.durable.events.filter(x => x.type === 'fix').length, 2);
  e.plugin.acknowledge = acknowledge;
  assert.ok(await e.tracker.finish()); assert.equal(e.records.size, 1); assert.equal(e.durable.id, null);
});
test('GPX export writes only cache and then opens a user-controlled native share sheet', async () => {
  const run = replayNativeRun(state([fix(0, 0), fix(10, 50), { type: 'finish', at: T + 10000 }], 'finished')).run;
  const calls = [];
  await shareNativeGPX(run, { Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
    Filesystem: { async writeFile(options) { calls.push(['write', options]); return { uri: 'file:///private/cache/run.gpx' }; } },
    Share: { async share(options) { calls.push(['share', options]); } } });
  assert.equal(calls[0][0], 'write'); assert.equal(calls[0][1].directory, 'CACHE');
  assert.match(calls[0][1].data, /<trkpt lat="13"/);
  assert.deepEqual(calls[1][1].files, ['file:///private/cache/run.gpx']);
});
test('GPX disk failure never opens sharing; canceled sharing preserves the original run', async () => {
  const run = replayNativeRun(state([fix(0, 0), fix(10, 50)])).run, before = structuredClone(run);
  let shares = 0;
  const bridge = { Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
    Filesystem: { async writeFile() { throw new Error('Disk full'); } },
    Share: { async share() { shares++; throw new Error('Share canceled'); } } };
  await assert.rejects(shareNativeGPX(run, bridge), /Disk full/); assert.equal(shares, 0);
  bridge.Filesystem.writeFile = async () => ({ uri: 'file:///cache/run.gpx' });
  await shareNativeGPX(run, bridge); assert.equal(shares, 1); assert.deepEqual(run, before);
});
