import test from 'node:test';
import assert from 'node:assert/strict';
import { createStepDetector, createPhoneSteps } from '../webgame/js/run-steps.js';

test('motion detector rejects stationary noise, rotation, invalid and reversed samples', () => {
  let steps = 0; const detect = createStepDetector(count => { steps += count; });
  for (let t = 0; t < 4000; t += 50) detect({ x: 0, y: 0, z: 9.81 + Math.sin(t) * 0.05 }, t);
  for (let t = 4000; t < 6000; t += 50) detect({ x: 9.81, y: 0, z: 0 }, t);
  detect({ x: NaN, y: 0, z: 0 }, 6100); detect({ x: 0, y: 0, z: 14 }, 100);
  assert.equal(steps, 0);
});
test('motion detector counts separated gait impulses once each and rebases after delivery gaps', () => {
  let steps = 0; const detect = createStepDetector(count => { steps += count; });
  for (let t = 0; t < 4000; t += 50) detect({ x: 0, y: 0, z: t % 500 === 200 ? 14 : 9.81 }, t);
  assert.equal(steps, 8);
  detect({ x: 0, y: 0, z: 14 }, 10000); assert.equal(steps, 8);
});
test('browser permission is requested before prepare yields; denial never attaches a sensor', async () => {
  let asked = false, listeners = 0;
  const sensor = createPhoneSteps({ secure: true, Motion: { requestPermission() { asked = true; return Promise.resolve('denied'); } },
    target: { addEventListener() { listeners++; } } });
  const promise = sensor.prepare(); assert.equal(asked, true);
  await assert.rejects(promise, /permission denied/); assert.equal(listeners, 0);
});
test('insecure origin and missing motion support fail without estimating distance', async () => {
  await assert.rejects(createPhoneSteps({ secure: false }).prepare(), /HTTPS/);
  await assert.rejects(createPhoneSteps({ secure: true, Motion: null }).prepare(), /unavailable/);
});
test('no sensor data reports failure and stopping removes listeners and late callbacks', async () => {
  let listener, timeout, removed = 0, errors = 0, steps = 0;
  const sensor = createPhoneSteps({ secure: true, Motion: {}, target: {
    addEventListener(_, fn) { listener = fn; }, removeEventListener() { removed++; } },
    schedule(fn) { timeout = fn; return 1; }, unschedule() {} });
  await sensor.prepare(); sensor.start(n => { steps += n; }, () => { errors++; });
  timeout(); assert.equal(errors, 1); await sensor.stop(); assert.equal(removed, 1);
  listener({ accelerationIncludingGravity: { x: 0, y: 0, z: 14 } }); assert.equal(steps, 0);
});
test('native cumulative totals exclude pre-start steps, avoid duplicates, preserve batches and detect reset', async () => {
  let listener, steps = 0, errors = 0, stopped = 0;
  const plugin = { async addListener(_, fn) { listener = fn; return { async remove() {} }; },
    async startSteps() {}, async stopSteps() { stopped++; } };
  const sensor = createPhoneSteps({ plugin }); await sensor.prepare(); listener({ steps: 5 });
  sensor.start(n => { steps += n; }, () => { errors++; });
  listener({ steps: 7 }); listener({ steps: 7 }); listener({ steps: 207 });
  assert.equal(steps, 202); listener({ steps: 0 }); assert.equal(errors, 1);
  await sensor.stop(); listener({ steps: 208 }); assert.equal(steps, 202); assert.equal(stopped, 1);
});
test('old browser motion events cannot count steps after pause and a new sensor start', async () => {
  let listener, time = 0, steps = 0;
  const sensor = createPhoneSteps({ secure: true, Motion: {}, now: () => time, target: {
    addEventListener(_, fn) { listener = fn; }, removeEventListener() {} }, schedule: () => 1, unschedule() {} });
  await sensor.prepare(); sensor.start(n => { steps += n; }, () => {});
  const old = listener; await sensor.stop(); await sensor.prepare(); sensor.start(n => { steps += n; }, () => {});
  old({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } });
  time = 500; old({ accelerationIncludingGravity: { x: 0, y: 0, z: 14 } });
  assert.equal(steps, 0); await sensor.stop();
});
