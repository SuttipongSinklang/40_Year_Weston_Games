import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunTracker } from '../webgame/js/run-tracker.js';
const T0 = Date.parse('2026-10-08T01:00:00Z');
test('automatic treadmill estimates from steps, excludes paused steps and finishes without manual distance', async () => {
  let step, active = false;
  const motion = { async prepare() {}, start(fn) { step = fn; active = true; }, async stop() { active = false; } };
  const e = setup({ secure: false, motion }); await e.tracker.init();
  await e.tracker.start({ activity: 'treadmill', automatic: true, stride_m: 0.8 });
  assert.equal(e.geo.starts, 0); step(20); assert.equal(e.tracker.snapshot().run.distance_m, 16);
  assert.equal(e.tracker.setDistance(5), false);
  e.setTime(T0 + 10000); await e.tracker.pause(); assert.equal(active, false); step(10);
  assert.equal(e.tracker.snapshot().run.steps, 20);
  e.setTime(T0 + 60000); await e.tracker.start(); step(10); e.setTime(T0 + 70000);
  const record = await e.tracker.finish(); assert.equal(record.run.steps, 30); assert.equal(record.run.distance_m, 24);
  assert.equal(record.run.elapsed_ms, 20000); assert.equal(record.run.distance_source, 'phone_steps');
  assert.deepEqual(record.run.points, []); e.tracker.destroy();
});
test('motion denial creates no run or GPS watcher and never silently switches to manual', async () => {
  const motion = { async prepare() { throw new Error('denied'); }, async stop() {} };
  const e = setup({ motion }); await e.tracker.init(); await e.tracker.start({ activity: 'treadmill', automatic: true });
  assert.equal(e.geo.starts, 0); assert.equal(e.tracker.snapshot().run, null);
  assert.equal(e.tracker.snapshot().mode, 'idle'); assert.match(e.tracker.snapshot().message, /เซ็นเซอร์/); e.tracker.destroy();
});
test('hiding while motion permission is pending cancels start and stops sensor', async () => {
  let resolve, stops = 0;
  const motion = { prepare: () => new Promise(r => { resolve = r; }), async stop() { stops++; } };
  const e = setup({ motion }); await e.tracker.init();
  const starting = e.tracker.start({ activity: 'treadmill', automatic: true });
  await e.tracker.suspend(); resolve(); await starting;
  assert.equal(e.tracker.snapshot().run, null); assert.equal(e.geo.starts, 0); assert.ok(stops > 0); e.tracker.destroy();
});
test('treadmill runs on insecure LAN without GPS, excludes pauses and saves manual distance once', async () => {
  const e = setup({ secure: false }); await e.tracker.init(); await e.tracker.start({ activity: 'treadmill' });
  assert.equal(e.geo.starts, 0); assert.equal(e.tracker.snapshot().mode, 'running');
  e.setTime(T0 + 600000); await e.tracker.pause(); e.setTime(T0 + 900000);
  assert.equal(e.tracker.snapshot().elapsed, 600000);
  await e.tracker.start(); e.setTime(T0 + 1500000);
  assert.equal(e.tracker.setDistance(3.5), true);
  const record = await e.tracker.finish();
  assert.equal(record.run.activity, 'treadmill'); assert.equal(record.run.distance_m, 3500);
  assert.equal(record.run.elapsed_ms, 1200000); assert.deepEqual(record.run.points, []); assert.deepEqual(record.run.splits, []);
  assert.equal(await e.tracker.finish(), null); assert.equal(e.tracker.setDistance(5), false);
  assert.equal(e.db.records.length, 1); e.tracker.destroy();
});
test('treadmill validates distances and restores a draft without starting GPS or counting hidden time', async () => {
  const e = setup(); await e.tracker.init(); await e.tracker.start({ activity: 'treadmill' });
  for (const value of [NaN, Infinity, -1, 201]) assert.equal(e.tracker.setDistance(value), false);
  e.tracker.setDistance(2.25); e.setTime(T0 + 5000); await e.tracker.suspend();
  const next = setup({ draft: structuredClone(e.db.draft), secure: false }); next.setTime(T0 + 60000);
  await next.tracker.init(); assert.equal(next.tracker.snapshot().run.activity, 'treadmill');
  assert.equal(next.tracker.snapshot().elapsed, 5000); assert.equal(next.tracker.snapshot().run.distance_m, 2250);
  await next.tracker.start({ activity: 'outdoor' }); assert.equal(next.geo.starts, 0);
  e.tracker.destroy(); next.tracker.destroy();
});
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup({ secure = true, draft = null, motion } = {}) {
  let clock = T0, id = 0, timer, success, failure;
  const db = { draft, lease: null, records: [], writes: 0 };
  const store = {
    newRunId: () => `test-${++id}`,
    loadDraft: async () => structuredClone(db.draft),
    runLease: async (token, action = 'acquire') => {
      if (action === 'release') { if (db.lease === token) db.lease = null; return true; }
      if (!db.lease && action === 'acquire') db.lease = token;
      return db.lease === token;
    },
    saveDraft: async (run, token) => { assert.equal(token, db.lease); db.draft = structuredClone(run); db.writes++; },
    finishDraft: async (record, token) => { assert.equal(token, db.lease); db.records.push(record); db.draft = null; db.lease = null; },
  };
  const geo = { starts: 0, clears: [], watchPosition(ok, error) { this.starts++; success = ok; failure = error; return this.starts; }, clearWatch(id) { this.clears.push(id); } };
  const tracker = createRunTracker({ store, geo, secure, motion, now: () => clock,
    schedule: callback => { timer = callback; return 1; }, unschedule() {} });
  return { tracker, db, geo, store, setTime: time => { clock = time; }, tick: () => timer(),
    fix(meters, accuracy = 5) { success({ coords: { latitude: 13 + meters / 111194.9266, longitude: 100, accuracy }, timestamp: clock }); },
    error(code) { failure({ code }); }, oldCallback: () => success };
}
test('GPS acquisition starts the clock only on an accurate fix; pause freezes it and finish stores one history record', async () => {
  const e = setup(); await e.tracker.init(); await e.tracker.start();
  assert.equal(e.tracker.snapshot().mode, 'acquiring');
  e.setTime(T0 + 10000); e.fix(0, 100); assert.equal(e.tracker.snapshot().run, null);
  e.fix(0); await settle(); assert.equal(e.tracker.snapshot().elapsed, 0);
  e.setTime(T0 + 20000); e.fix(50); await settle();
  assert.ok(Math.abs(e.tracker.snapshot().run.distance_m - 50) < 0.1);
  await e.tracker.pause(); e.setTime(T0 + 100000); assert.equal(e.tracker.snapshot().elapsed, 10000);
  await e.tracker.start(); e.fix(500); await settle();
  assert.ok(Math.abs(e.tracker.snapshot().run.distance_m - 50) < 0.1);
  e.setTime(T0 + 110000); e.fix(550); await settle();
  const record = await e.tracker.finish();
  assert.equal(record.run.elapsed_ms, 20000); assert.equal(e.db.records.length, 1); assert.equal(e.db.draft, null);
  assert.equal(record.share, true); assert.equal(record.cloud_state, 'pending'); e.tracker.destroy();
});
test('insecure LAN origin never calls geolocation', async () => {
  const e = setup({ secure: false }); await e.tracker.init(); await e.tracker.start();
  assert.equal(e.geo.starts, 0); assert.match(e.tracker.snapshot().message, /HTTPS/); e.tracker.destroy();
});
test('permission denial leaves no active timer/draft or GPS watcher; late callbacks cannot resume', async () => {
  const e = setup(); await e.tracker.init(); await e.tracker.start(); const old = e.oldCallback();
  e.error(1); await settle();
  assert.equal(e.tracker.snapshot().mode, 'idle'); assert.equal(e.db.draft, null); assert.deepEqual(e.geo.clears, [1]);
  old({ coords: { latitude: 13, longitude: 100, accuracy: 5 }, timestamp: T0 });
  assert.equal(e.tracker.snapshot().run, null); e.tracker.destroy();
});
test('background suspension persists a paused draft, stops GPS and releases the recording lease', async () => {
  const e = setup(); await e.tracker.init(); await e.tracker.start(); e.fix(0); await settle();
  e.setTime(T0 + 5000); await Promise.all([e.tracker.suspend(), e.tracker.suspend()]);
  assert.equal(e.db.draft.status, 'paused'); assert.equal(e.db.draft.elapsed_ms, 5000); assert.equal(e.db.lease, null);
  e.setTime(T0 + 60000); assert.equal(e.tracker.snapshot().elapsed, 5000); e.tracker.destroy();
});
test('another tab owning the draft blocks a second GPS watcher', async () => {
  const e = setup(); await e.tracker.init(); e.db.lease = 'other-tab'; await e.tracker.start();
  assert.equal(e.geo.starts, 0); assert.match(e.tracker.snapshot().message, /อีกแท็บ/); e.tracker.destroy();
});
test('reload recovers a checkpoint as paused and never requests location automatically', async () => {
  const first = setup(); await first.tracker.init(); await first.tracker.start(); first.fix(0); await settle();
  first.setTime(T0 + 5000); await first.tick(); await settle();
  const saved = structuredClone(first.db.draft); first.tracker.destroy();
  const second = setup({ draft: saved }); second.setTime(T0 + 60000); await second.tracker.init();
  assert.equal(second.geo.starts, 0); assert.equal(second.tracker.snapshot().mode, 'paused'); assert.equal(second.tracker.snapshot().elapsed, 5000);
  second.tracker.destroy();
});

test('web background keeps the GPS watch and clock, gaps do not invent distance, foreground resumes delivery', async () => {
 const e=setup(); await e.tracker.init(); await e.tracker.start(); e.fix(0); await settle();
 e.setTime(T0+10000); e.fix(50); await settle(); await e.tracker.background();
 assert.equal(e.tracker.snapshot().mode,'running'); assert.deepEqual(e.geo.clears,[]); assert.notEqual(e.db.lease,null);
 e.setTime(T0+600000); assert.equal(e.tracker.snapshot().elapsed,600000);
 await e.tracker.foreground(); e.fix(2000); await settle();
 assert.ok(Math.abs(e.tracker.snapshot().run.distance_m-50)<.1);
 assert.notEqual(e.tracker.snapshot().run.points.at(-1).segment,e.tracker.snapshot().run.points[0].segment);
 assert.deepEqual(e.tracker.snapshot().run.events,[]); e.tracker.destroy();
});
test('temporary GPS timeout keeps watching; later fresh delivery recovers without a user resume', async () => {
 const e=setup(); await e.tracker.init(); await e.tracker.start();e.fix(0);await settle();
 e.error(3);await settle();assert.equal(e.tracker.snapshot().mode,'running');assert.deepEqual(e.geo.clears,[]);
 e.setTime(T0+10000);e.fix(50);await settle();assert.ok(e.tracker.snapshot().run.distance_m>49);e.tracker.destroy();
});
test('web treadmill background does not stop motion or fabricate missing steps',async()=>{
 let step,error,stops=0;
 const motion={async prepare(){},start(fn,fail){step=fn;error=fail;},async stop(){stops++;}};
 const e=setup({motion});await e.tracker.init();await e.tracker.start({activity:'treadmill',automatic:true});
 step(10);await settle();await e.tracker.background();assert.equal(stops,0);
 e.setTime(T0+600000);error();assert.equal(e.tracker.snapshot().mode,'running');assert.equal(e.tracker.snapshot().run.steps,10);
 await e.tracker.foreground();step(5);await settle();const record=await e.tracker.finish();
 assert.equal(record.run.steps,15);assert.equal(record.run.elapsed_ms,600000);e.tracker.destroy();
});
