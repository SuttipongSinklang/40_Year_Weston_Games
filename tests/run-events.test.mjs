import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, addPosition, pauseRun, resumeRun, finishRun, restoreRun } from '../webgame/js/run-core.js';
import { replayNativeRun } from '../webgame/js/run-native-replay.js';
const T = Date.parse('2026-10-09T01:00:00Z');
const fix = (s,m) => ({ latitude:13+m/111195, longitude:100, accuracy:5, timestamp:T+s*1000 });
test('pause after missing GPS does not pretend an old fix is the pause location', () => {
  const r=createRun({id:'stale-pause',now:T}); addPosition(r,fix(0,0),T);
  pauseRun(r,T+60000);
  assert.equal(r.events[0].lat,null); assert.equal(r.events[0].lng,null); assert.equal(r.events[0].fix_at,null);
});
test('numbered pauses and resumes use last and first accepted GPS fixes respectively', () => {
  const r=createRun({id:'events',now:T}); addPosition(r,fix(0,0),T); addPosition(r,fix(10,50),T+10000);
  pauseRun(r,T+12000); pauseRun(r,T+13000); resumeRun(r,T+60000);
  assert.equal(r.events.length,2); assert.equal(r.events[1].lat,null);
  assert.equal(addPosition(r,{...fix(60,700),accuracy:90},T+60000).accepted,false);
  assert.equal(r.events[1].lat,null); addPosition(r,fix(61,700),T+61000);
  assert.equal(r.events[0].lat,fix(10,50).latitude); assert.equal(r.events[1].lat,fix(61,700).latitude);
  pauseRun(r,T+70000); resumeRun(r,T+80000); addPosition(r,fix(80,900),T+80000);
  assert.deepEqual(r.events.map(e=>[e.type,e.index]),[['pause',1],['resume',1],['pause',2],['resume',2]]);
  finishRun(r,T+81000); assert.deepEqual(restoreRun(r,T+90000).events,r.events);
});
test('GPS gaps do not fabricate pause markers and legacy history still restores', () => {
  const r=createRun({id:'old',now:T}); addPosition(r,fix(0,0),T); addPosition(r,fix(60,500),T+60000);
  assert.equal(r.events.length,0); finishRun(r,T+61000); delete r.events; assert.deepEqual(restoreRun(r).events,[]);
  r.events=[{type:'pause',index:1,at:T,lat:91,lng:100,fix_at:T}]; assert.equal(restoreRun(r),null);
});
test('native journal reconstructs pause and resume markers after screen lock', () => {
  const events=[{...fix(0,0),type:'fix',at:T},{...fix(10,50),type:'fix',at:T+10000},
    {type:'pause',at:T+11000},{...fix(70,600),type:'fix',at:T+70000},{type:'finish',at:T+80000}];
  const {run}=replayNativeRun({version:1,id:'10000000-0000-4000-8000-000000000001',mode:'finished',revision:5,events});
  assert.deepEqual(run.events.map(e=>[e.type,e.index]),[['pause',1],['resume',1]]);
  assert.equal(run.events[1].lat,fix(70,600).latitude); assert.ok(run.distance_m<51);
});
