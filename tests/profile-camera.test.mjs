import test from 'node:test';
import assert from 'node:assert/strict';
import {createCamera} from '../webgame/js/profile-camera.js';
function fixture(getUserMedia){const video={srcObject:null,pause(){},async play(){}};return {video,camera:createCamera(video,{getUserMedia})};}
function stream(){const track={stops:0,stop(){this.stops++;}};return {track,getTracks:()=>[track]};}
test('camera requests front video without microphone and releases it on close',async()=>{
  const media=stream();let requested;const {video,camera}=fixture(async options=>{requested=options;return media;});
  assert.equal(await camera.start(),true);assert.equal(video.srcObject,media);
  assert.equal(requested.audio,false);assert.equal(requested.video.facingMode.ideal,'user');
  camera.stop();assert.equal(media.track.stops,1);assert.equal(video.srcObject,null);
});
test('cancel while permission is pending stops the late camera stream',async()=>{
  let resolve;const {video,camera}=fixture(()=>new Promise(r=>resolve=r));
  const pending=camera.start();camera.stop();const media=stream();resolve(media);
  assert.equal(await pending,false);assert.equal(media.track.stops,1);assert.equal(video.srcObject,null);
});
test('playback failure releases the camera',async()=>{
  const media=stream();const {video,camera}=fixture(async()=>media);video.play=async()=>{throw new Error('play failed');};
  await assert.rejects(camera.start(),/play failed/);assert.equal(media.track.stops,1);assert.equal(video.srcObject,null);
});
test('missing browser camera support reports actionable error',async()=>{
  const video={pause(){}};await assert.rejects(createCamera(video,null).start(),/HTTPS/);
});
