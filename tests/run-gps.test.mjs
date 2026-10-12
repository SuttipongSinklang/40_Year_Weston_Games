import test from 'node:test';
import assert from 'node:assert/strict';
import { usableBrowserFix, locateBrowserPosition } from '../webgame/js/run-gps.js';
const now = 100000;
const fix = { latitude: 13.75, longitude: 100.5, accuracy: 8, timestamp: now };
test('browser acquisition rejects coarse, stale, future and invalid fixes', () => {
  assert.equal(usableBrowserFix(fix, now, 5000), true);
  for (const change of [{accuracy: 35}, {accuracy: -1}, {latitude: 91},
    {timestamp: now - 6000}, {timestamp: now + 2000}]) {
    assert.equal(usableBrowserFix({...fix, ...change}, now, 5000), false);
  }
});
test('locating waits through approximate fixes then resolves actual position and stops watching', async () => {
  let ok, options, cancelled = false; const cleared = [];
  const promise = locateBrowserPosition({ now: () => now,
    geo: {watchPosition(success, _, value) {ok=success;options=value;return 7;},clearWatch(id){cleared.push(id);}},
    schedule: () => 1, cancel: () => {cancelled=true;} });
  ok({coords:{...fix,accuracy:100},timestamp:now}); assert.deepEqual(cleared, []);
  ok({coords:fix,timestamp:now}); assert.deepEqual(await promise,fix);
  assert.deepEqual(cleared,[7]); assert.equal(cancelled,true);
  assert.deepEqual(options,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
});
test('location deadline cleans the watcher without returning a made-up position', async () => {
  let deadline, stopped;
  const promise = locateBrowserPosition({geo:{watchPosition(){return 9;},clearWatch(id){stopped=id;}},
    schedule: fn => {deadline=fn;return 1;}, cancel(){} });
  deadline(); await assert.rejects(promise,/GPS/); assert.equal(stopped,9);
});
test('approximate preview is reported immediately and returned at deadline with its real accuracy', async () => {
  let ok, deadline, stopped; const progress=[];
  const promise=locateBrowserPosition({now:()=>now,onProgress:p=>progress.push(p),
    geo:{watchPosition(fn){ok=fn;return 3;},clearWatch(id){stopped=id;}},
    schedule:fn=>{deadline=fn;return 1;},cancel(){} });
  ok({coords:{...fix,accuracy:65},timestamp:now});
  assert.equal(progress[0].accuracy,65);
  deadline(); const result=await promise;
  assert.equal(result.accuracy,65); assert.equal(usableBrowserFix(result,now),false);
  assert.equal(stopped,3);
});
test('permission, unavailable and timeout errors stop locating with a clear message', async () => {
  for(const code of [1,2,3]) {
    let failure,stopped;
    const promise=locateBrowserPosition({geo:{watchPosition(_,fn){failure=fn;return 4;},clearWatch(id){stopped=id;}},
      schedule:()=>1,cancel(){} });
    failure({code}); await assert.rejects(promise); assert.equal(stopped,4);
  }
});
test('hiding or leaving the screen cancels a pending location without suspended-timer dependence', async () => {
  const controller=new AbortController();let stopped;
  const promise=locateBrowserPosition({signal:controller.signal,
    geo:{watchPosition(){return 5;},clearWatch(id){stopped=id;}},schedule:()=>1,cancel(){} });
  controller.abort();await assert.rejects(promise,/ออกจากหน้าวิ่ง/);assert.equal(stopped,5);
});
