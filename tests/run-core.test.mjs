import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, activeMs, pauseRun, resumeRun, finishRun, addPosition, restoreRun, toGPX }
  from '../webgame/js/run-core.js';

const T0 = Date.parse('2026-10-08T10:00:00Z');
const LAT = 13.7563, LNG = 100.5018;
const M_PER_DEG = (Math.PI * 6371000) / 180;
// Fixes move due north, so Haversine distance collapses to exactly the planned meters.
const fixAt = (meters, timestamp, accuracy = 5) =>
  ({ latitude: LAT + meters / M_PER_DEG, longitude: LNG, accuracy, timestamp });
// Realistic cadence: legs of [meters, ms] must stay under 12 m/s and 30s apart.
function runLegs(run, legs, startT, startM = 0) {
  let meters = startM, t = startT;
  for (const [dm, dt] of legs) {
    meters += dm; t += dt;
    assert.equal(addPosition(run, fixAt(meters, t), t).accepted, true, `point at ${meters}m/${t - T0}ms`);
  }
  return { meters, t };
}
function referenceHaversine(aLat, aLng, bLat, bLng) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

test('accumulates Haversine distance; first point anchors the segment and adds zero', () => {
  const run = createRun({ id: 'run-1', now: T0 });
  assert.deepEqual(addPosition(run, fixAt(0, T0), T0), { accepted: true, reason: 'ok' });
  assert.equal(run.distance_m, 0);
  assert.equal(run.points[0].segment, 0);
  assert.equal(run.points[0].active_ms, 0);
  runLegs(run, [[100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000]], T0);
  const expected = referenceHaversine(LAT, LNG, fixAt(600, 0).latitude, LNG);
  assert.ok(Math.abs(run.distance_m - expected) < 0.001);
  assert.ok(Math.abs(run.distance_m - 600) < 0.5);
  assert.equal(run.points.length, 7);
  assert.equal(run.points[6].distance_m, run.distance_m);
  assert.equal(run.points[6].active_ms, 60000);
  assert.ok(run.points.every(p => p.segment === 0));
  assert.equal(run.updated_at, T0 + 60000);
});

test('pause/resume excludes paused time and never bridges distance across the pause', () => {
  const run = createRun({ id: 'run-2', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  runLegs(run, [[120, 20000]], T0);
  pauseRun(run, T0 + 60000);
  assert.equal(run.status, 'paused');
  assert.equal(activeMs(run, T0 + 3600000), 60000);
  resumeRun(run, T0 + 3600000);
  const away = addPosition(run, fixAt(520, T0 + 3605000), T0 + 3605000);
  assert.equal(away.accepted, true);
  assert.ok(Math.abs(run.distance_m - 120) < 0.5);
  assert.equal(run.points[2].segment, 1);
  runLegs(run, [[100, 10000]], T0 + 3605000, 520);
  assert.ok(Math.abs(run.distance_m - 220) < 0.5);
  assert.equal(activeMs(run, T0 + 3620000), 80000);
});

test('pause/resume/finish are idempotent and finish freezes active time', () => {
  const run = createRun({ id: 'run-3', now: T0 });
  resumeRun(run, T0 + 1000);
  assert.equal(run.resumed_at, T0);
  pauseRun(run, T0 + 40000);
  pauseRun(run, T0 + 50000);
  assert.equal(run.elapsed_ms, 40000);
  assert.equal(run.segment, 1);
  assert.equal(run.resumed_at, null);
  resumeRun(run, T0 + 100000);
  resumeRun(run, T0 + 101000);
  assert.equal(run.resumed_at, T0 + 100000);
  assert.equal(activeMs(run, T0 + 110000), 50000);
  finishRun(run, T0 + 120000);
  finishRun(run, T0 + 130000);
  assert.equal(run.status, 'finished');
  assert.equal(run.elapsed_ms, 60000);
  assert.equal(activeMs(run, T0 + 999999), 60000);
  assert.equal(run.ended_at, new Date(T0 + 120000).toISOString());
  assert.equal(run.resumed_at, null);
  assert.equal(addPosition(run, fixAt(50, T0 + 120500), T0 + 120500).reason, 'status');
  pauseRun(run, T0 + 140000);
  resumeRun(run, T0 + 150000);
  assert.equal(run.status, 'finished');
  assert.equal(run.resumed_at, null);
});

test('activeMs clamps a clock-skewed running interval to nonnegative', () => {
  const run = createRun({ id: 'run-4', now: T0 });
  run.resumed_at = T0 + 50000;
  assert.equal(activeMs(run, T0 + 10000), 0);
});

test('rejects malformed fixes, bad accuracy, stale and out-of-order timestamps', () => {
  const run = createRun({ id: 'run-5', now: T0 });
  assert.equal(addPosition(run, null, T0).reason, 'invalid');
  assert.equal(addPosition(run, { latitude: 91, longitude: LNG, accuracy: 5, timestamp: T0 }, T0).reason, 'invalid');
  assert.equal(addPosition(run, { latitude: LAT, longitude: NaN, accuracy: 5, timestamp: T0 }, T0).reason, 'invalid');
  assert.equal(addPosition(run, { latitude: LAT, longitude: LNG, accuracy: -1, timestamp: T0 }, T0).reason, 'invalid');
  assert.equal(addPosition(run, { latitude: LAT, longitude: LNG, accuracy: 41, timestamp: T0 }, T0).reason, 'accuracy');
  assert.equal(addPosition(run, { latitude: LAT, longitude: LNG, accuracy: 5, timestamp: T0 - 20000 }, T0).reason, 'stale');
  assert.equal(addPosition(run, { latitude: LAT, longitude: LNG, accuracy: 5, timestamp: T0 + 11000 }, T0).reason, 'stale');
  assert.equal(run.points.length, 0);
  assert.equal(addPosition(run, fixAt(0, T0), T0).accepted, true);
  assert.equal(addPosition(run, fixAt(30, T0), T0 + 1000).reason, 'out-of-order');
  assert.equal(addPosition(run, fixAt(30, T0 - 1), T0 + 1000).reason, 'out-of-order');
  assert.equal(addPosition(run, fixAt(30, T0 - 500), T0 + 1000).reason, 'out-of-order');
  assert.equal(addPosition(run, fixAt(10, T0 + 1000), T0 + 1000).accepted, true);
  assert.equal(run.points.length, 2);
});

test('rejects impossible speed as jump and keeps the last accepted point as baseline', () => {
  const run = createRun({ id: 'run-6', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  assert.deepEqual(addPosition(run, fixAt(200, T0 + 5000), T0 + 5000), { accepted: false, reason: 'jump' });
  assert.equal(addPosition(run, fixAt(50, T0 + 10000), T0 + 10000).accepted, true);
  assert.ok(Math.abs(run.distance_m - 50) < 0.5);
});

test('ignores stationary jitter below the accuracy-scaled threshold without moving the baseline', () => {
  const run = createRun({ id: 'run-7', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  assert.deepEqual(addPosition(run, fixAt(1.5, T0 + 1000), T0 + 1000), { accepted: false, reason: 'jitter' });
  assert.equal(addPosition(run, fixAt(-2, T0 + 2000, 30), T0 + 2000).reason, 'jitter');
  assert.equal(addPosition(run, fixAt(6, T0 + 3000, 30), T0 + 3000).reason, 'jitter');
  assert.equal(addPosition(run, fixAt(40, T0 + 10000), T0 + 10000).accepted, true);
  assert.ok(Math.abs(run.distance_m - 40) < 0.5);
  assert.equal(run.points.length, 2);
});

test('a timestamp gap over 30s starts a new segment with zero bridge distance', () => {
  const run = createRun({ id: 'run-8', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  runLegs(run, [[100, 10000]], T0);
  assert.equal(run.points[1].segment, 0);
  const after = addPosition(run, fixAt(900, T0 + 60000), T0 + 60000);
  assert.equal(after.accepted, true);
  assert.equal(run.points[2].segment, 1);
  assert.ok(Math.abs(run.distance_m - 100) < 0.5);
  runLegs(run, [[100, 10000]], T0 + 60000, 900);
  assert.ok(Math.abs(run.distance_m - 200) < 0.5);
});

test('km splits interpolate active time at the crossing and derive pace', () => {
  const run = createRun({ id: 'run-9', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  // 100m per 10s to 800m, 300m per 30s to 1700m, 200m per 20s to 2100m — all 10 m/s.
  runLegs(run, [
    [100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000],
    [300, 30000], [300, 30000], [300, 30000], [200, 20000], [200, 20000],
  ], T0);
  assert.ok(Math.abs(run.distance_m - 2100) < 0.5);
  assert.equal(run.splits.length, 2);
  assert.equal(run.splits[0].km, 1);
  assert.ok(Math.abs(run.splits[0].duration_ms - 100000) < 100); // 1km crossed 2/3 into the 800m→1100m leg
  assert.ok(Math.abs(run.splits[0].pace_sec - 100) < 0.1);
  assert.equal(run.splits[1].km, 2);
  assert.ok(Math.abs(run.splits[1].duration_ms - 100000) < 100); // 2km crossed halfway into the 1900m→2100m leg
  assert.ok(Math.abs(run.splits[1].pace_sec - 100) < 0.1);
});

test('caps accepted points at 10000 and reports full', () => {
  const run = createRun({ id: 'run-10', now: T0 });
  run.points = Array.from({ length: 10000 }, (_, i) =>
    ({ lat: LAT, lng: LNG, accuracy: 5, timestamp: T0 + i, segment: 0, active_ms: i, distance_m: 0 }));
  assert.deepEqual(addPosition(run, fixAt(5, T0 + 20000), T0 + 20000), { accepted: false, reason: 'full' });
  assert.equal(run.points.length, 10000);
});

test('restoreRun returns a detached deep copy preserving id, points, splits and distance', () => {
  const run = createRun({ id: 'run-11', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  runLegs(run, [[100, 10000], [100, 10000], [100, 10000], [100, 10000], [100, 10000]], T0);
  pauseRun(run, T0 + 70000);
  const saved = JSON.parse(JSON.stringify(run));
  const restored = restoreRun(saved, T0 + 400000);
  assert.notEqual(restored, null);
  assert.equal(restored.id, 'run-11');
  assert.equal(restored.status, 'paused');
  assert.equal(restored.elapsed_ms, 70000);
  assert.equal(restored.points.length, 6);
  assert.ok(Math.abs(restored.distance_m - 500) < 0.5);
  assert.deepEqual(restored.splits, run.splits);
  assert.notEqual(restored.points, saved.points);
  assert.notEqual(restored.points[0], saved.points[0]);
  restored.points.pop();
  assert.equal(saved.points.length, 6);
  assert.equal(restoreRun(null), null);
  assert.equal(restoreRun({ id: 'x' }), null);
  assert.equal(restoreRun({ ...saved, status: 'walking' }), null);
  assert.equal(restoreRun({ ...saved, points: 'nope' }), null);
  assert.equal(restoreRun({ ...saved, points: [{ lat: 13 }] }), null);
  assert.equal(restoreRun({ ...saved, distance_m: 'far' }), null);
  assert.equal(restoreRun({ ...saved, started_at: 'yesterday' }), null);
});

test('a run persisted while running recovers as paused using its saved updated_at', () => {
  const run = createRun({ id: 'run-12', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  run.updated_at = T0 + 60000;
  const restored = restoreRun(run, T0 + 3600000);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.resumed_at, null);
  assert.equal(restored.segment, run.segment + 1);
  assert.equal(restored.elapsed_ms, 60000);
  assert.equal(activeMs(restored, T0 + 7200000), 60000);
  const skewed = createRun({ id: 'run-13', now: T0 });
  skewed.updated_at = T0 + 999999;
  assert.equal(restoreRun(skewed, T0 + 10000).elapsed_ms, 10000);
});

test('quick resume after recovery never bridges movement made while the page was inactive', () => {
  const run = createRun({ id: 'run-14', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  addPosition(run, fixAt(50, T0 + 5000), T0 + 5000);
  const saved = JSON.parse(JSON.stringify(run)); // persisted running at T0+5s
  const restored = restoreRun(saved, T0 + 8000);
  resumeRun(restored, T0 + 10000);
  const moved = addPosition(restored, fixAt(80, T0 + 11000), T0 + 11000);
  assert.equal(moved.accepted, true);
  assert.equal(restored.points[2].segment, 1);
  assert.ok(Math.abs(restored.distance_m - 50) < 0.5); // 30m at 5 m/s would pass the speed filter if bridged
  assert.equal(addPosition(restored, fixAt(130, T0 + 16000), T0 + 16000).accepted, true);
  assert.ok(Math.abs(restored.distance_m - 100) < 0.5);
});

test('paused and finished recoveries preserve the segment counter and end state', () => {
  const paused = createRun({ id: 'run-15a', now: T0 });
  addPosition(paused, fixAt(0, T0), T0);
  pauseRun(paused, T0 + 30000);
  const pausedRestored = restoreRun(JSON.parse(JSON.stringify(paused)), T0 + 120000);
  assert.equal(pausedRestored.status, 'paused');
  assert.equal(pausedRestored.segment, paused.segment);
  const finished = createRun({ id: 'run-15b', now: T0 });
  addPosition(finished, fixAt(0, T0), T0);
  finishRun(finished, T0 + 45000);
  const finishedRestored = restoreRun(JSON.parse(JSON.stringify(finished)), T0 + 120000);
  assert.equal(finishedRestored.status, 'finished');
  assert.equal(finishedRestored.segment, finished.segment);
  assert.equal(finishedRestored.ended_at, finished.ended_at);
});

test('a near-antipodal fix is rejected as jump instead of poisoning distance with NaN', () => {
  const run = createRun({ id: 'run-16', now: T0 });
  addPosition(run, { latitude: 57.14042912889093, longitude: -157.09780126658583, accuracy: 5, timestamp: T0 }, T0);
  // These coordinates round Haversine h to 1.0000000000000004; unclamped asin yields NaN,
  // and NaN comparisons are false, so it would bypass both the jitter and speed filters.
  const result = addPosition(run, { latitude: -57.140429137762474, longitude: 22.90219874086395,
    accuracy: 5, timestamp: T0 + 6000 }, T0 + 6000);
  assert.deepEqual(result, { accepted: false, reason: 'jump' });
  assert.equal(run.distance_m, 0);
  assert.ok(Number.isFinite(run.distance_m));
});

test('toGPX emits GPX 1.1 with one trkseg per segment, escaped name and ISO times', () => {
  const run = createRun({ id: 'track<&>"1"', now: T0 });
  addPosition(run, fixAt(0, T0), T0);
  runLegs(run, [[40, 5000]], T0);
  addPosition(run, fixAt(120, T0 + 60000), T0 + 60000); // 55s silence opens segment 1
  runLegs(run, [[80, 10000]], T0 + 60000, 120);
  const xml = toGPX(run);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns="http://www.topografix.com/GPX/1/1"'));
  assert.ok(xml.includes('<name>track&lt;&amp;&gt;&quot;1&quot;</name>'));
  assert.equal((xml.match(/<trkseg>/g) || []).length, 2);
  assert.equal((xml.match(/<\/trkseg>/g) || []).length, 2);
  assert.equal((xml.match(/<trkpt /g) || []).length, 4);
  const segs = xml.split('<trkseg>').slice(1).map(chunk => chunk.split('</trkseg>')[0]);
  assert.ok(segs[0].includes(`lat="${run.points[1].lat}"`) && !segs[0].includes(`lat="${run.points[2].lat}"`));
  assert.ok(segs[1].includes(`lat="${run.points[2].lat}"`) && segs[1].includes(`lat="${run.points[3].lat}"`));
  for (const match of xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"><time>([^<]+)<\/time>/g)) {
    assert.ok(Number.isFinite(Number(match[1])) && Number.isFinite(Number(match[2])));
    assert.equal(match[3], new Date(match[3]).toISOString());
  }
  assert.equal((toGPX(createRun({ id: 'empty', now: T0 })).match(/<trkpt /g) || []).length, 0);
});
