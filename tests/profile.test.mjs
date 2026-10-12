import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile} from '../webgame/js/profile-model.js';
import {cropRectangle} from '../webgame/js/profile-photo.js';
import {readProfile,writeProfile} from '../webgame/js/profile-store.js';
globalThis.window={addEventListener(){}};
globalThis.document={hidden:false,addEventListener(){}};
const {saveCloudProfile,fetchCloudProfile}=await import('../webgame/js/profile-cloud.js');
const values={age:30,sex:'female',weight_kg:60,height_cm:165,bmi:22,body_fat_percent:25,muscle_mass_kg:25};
test('all seven fields are required; empty inputs cannot become zero',()=>{
  for(const key of Object.keys(values)){const result=validateProfile({...values,[key]:''});assert.equal(result.valid,false,key);assert.ok(result.errors[key]);}
});
test('numeric consistency retains entered BMI and uses calculated BMI; missing references stay unknown',()=>{
  const result=validateProfile({...values,bmi:99});assert.equal(result.valid,true);
  assert.equal(result.profile.input_bmi,99);assert.equal(result.profile.bmi,60/1.65**2);
  assert.equal(result.profile.muscle_definition,null);assert.ok(result.notices.length);
});
test('impossible fat and muscle, fractional age, infinities and zero height are rejected',()=>{
  for(const change of [{body_fat_percent:100},{muscle_mass_kg:61},{age:30.5},{height_cm:0},{weight_kg:Infinity},{sex:'unknown'}])assert.equal(validateProfile({...values,...change}).valid,false);
});
test('cropping respects image edges for portrait and landscape photos',()=>{
  assert.deepEqual(cropRectangle(800,1200),{sx:0,sy:200,size:800});
  assert.deepEqual(cropRectangle(1200,800,2,1,0),{sx:800,sy:0,size:400});
  assert.deepEqual(cropRectangle(800,800,3,-5,10),{sx:0,sy:800-800/3,size:800/3});
});
test('pending profile and photo survive storage round-trip and are isolated by player',async()=>{
  const photo=new Blob(['fixture'],{type:'image/jpeg'});
  await writeProfile({owner:'profile-player-a',profile:values,photo,cloud_state:'pending'});
  assert.equal(await readProfile('profile-player-b'),null);
  const loaded=await readProfile('profile-player-a');assert.equal(loaded.cloud_state,'pending');assert.equal(await loaded.photo.text(),'fixture');
});
function remote({uploadError=null,writeError=null,revision='r1'}={}){
  const calls=[];
  const query={select(){return query;},eq(){return query;},single:async()=>({data:{revision},error:null}),maybeSingle:async()=>({data:null,error:null}),upsert:async row=>{calls.push(row);return {error:writeError};}};
  return {userId:'a',calls,from:()=>query,storage:{from:()=>({upload:async()=>{calls.push('photo');return {error:uploadError};}})}};
}
const record={owner:'a',profile:values,photo:new Blob(['fixture'],{type:'image/jpeg'}),photo_revision:'p1',revision:'r1'};
test('cloud rejects another player before accessing database or storage',async()=>{
  const api=remote();await assert.rejects(saveCloudProfile(api,{...record,owner:'b'}));assert.equal(api.calls.length,0);
});
test('upload failure prevents saving a broken avatar link',async()=>{
  const api=remote({uploadError:new Error('upload failed')});await assert.rejects(saveCloudProfile(api,record),/upload failed/);assert.deepEqual(api.calls,['photo']);
});
test('database or read-back revision failures never confirm online save',async()=>{
  await assert.rejects(saveCloudProfile(remote({writeError:new Error('RLS')}),record),/RLS/);
  await assert.rejects(saveCloudProfile(remote({revision:'other'}),record),/not been confirmed/);
});
test('successful upload stores only processed private path; no-photo save restores default head',async()=>{
  const api=remote();await saveCloudProfile(api,record);assert.equal(api.calls[1].avatar_path,'a/p1.jpg');
  const without=remote();await saveCloudProfile(without,{...record,photo:null});assert.equal(without.calls.length,1);assert.equal(without.calls[0].avatar_path,null);assert.equal(without.calls[0].photo_revision,null);
  assert.equal(await fetchCloudProfile(api),null);
});
