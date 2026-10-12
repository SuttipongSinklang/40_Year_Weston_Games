// Explicit integration test: synthetic anonymous players only. Prints no JWTs or keys.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from '../webgame/js/config.js';
assert.equal(SUPABASE_URL,'https://jlweqxpkqgnjcwcgisfj.supabase.co');
const players=[],checks=[];
async function request(path,{player,method='GET',body,contentType='application/json',prefer}={}){
  const headers={apikey:SUPABASE_ANON_KEY,'Content-Type':contentType};
  if(player)headers.Authorization=`Bearer ${player.token}`;
  if(prefer)headers.Prefer=prefer;
  return fetch(`${SUPABASE_URL}${path}`,{method,headers,body:body==null?undefined:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
}
async function signIn(){
  const response=await request('/auth/v1/signup',{method:'POST',body:{data:{weston_synthetic_profile_test:true}}});
  assert.equal(response.status,200,'Anonymous sign-in failed');const data=await response.json();
  const player={id:data.user.id,token:data.access_token};assert.equal(data.user.is_anonymous,true);players.push(player);return player;
}
let path=null;
try{
  const owner=await signIn(),other=await signIn();checks.push('anonymous sign-in');
  const revision=randomUUID(),photoRevision=randomUUID();path=`${owner.id}/${photoRevision}.jpg`;
  const photo=await readFile(new URL('./artifacts/profile-upload-fixture.jpg',import.meta.url));
  let result=await request(`/storage/v1/object/weston-private-avatars/${path}`,{player:owner,method:'POST',body:photo,contentType:'image/jpeg'});
  assert.ok(result.ok,'Private photo upload failed');checks.push('private JPEG upload');
  const row={user_id:owner.id,age:30,sex:'female',weight_kg:60,height_cm:165,bmi:60/1.65**2,input_bmi:22,body_fat_percent:25,muscle_mass_kg:25,muscle_definition:null,measured_at:new Date().toISOString(),revision,avatar_path:path,photo_revision:photoRevision};
  result=await request('/rest/v1/weston_health_profiles?on_conflict=user_id',{player:owner,method:'POST',body:row,prefer:'resolution=merge-duplicates,return=representation'});
  assert.ok(result.ok,'Profile upsert failed');const saved=await result.json();assert.equal(saved[0].revision,revision);checks.push('profile upsert and revision confirmation');
  result=await request(`/rest/v1/weston_health_profiles?user_id=eq.${owner.id}&select=*`,{player:owner});assert.ok(result.ok);assert.equal((await result.json())[0].avatar_path,path);checks.push('profile reload');
  result=await request(`/storage/v1/object/authenticated/weston-private-avatars/${path}`,{player:owner});assert.ok(result.ok,'Owner download failed');assert.deepEqual(new Uint8Array(await result.arrayBuffer()),new Uint8Array(photo));checks.push('owner photo download bytes match');
  result=await request(`/rest/v1/weston_health_profiles?user_id=eq.${owner.id}&select=*`,{player:other});assert.ok(result.ok);assert.deepEqual(await result.json(),[]);
  result=await request(`/storage/v1/object/authenticated/weston-private-avatars/${path}`,{player:other});assert.equal(result.ok,false);checks.push('other player cannot read profile or photo');
  result=await request(`/rest/v1/weston_health_profiles?user_id=eq.${owner.id}`,{player:other,method:'PATCH',body:{age:99},prefer:'return=representation'});assert.ok(result.ok);assert.deepEqual(await result.json(),[]);checks.push('other player cannot update profile');
  result=await request(`/storage/v1/object/public/weston-private-avatars/${path}`);assert.equal(result.ok,false);checks.push('public photo access blocked');
}finally{
  if(players[0]&&path){
    const response=await request('/storage/v1/object/weston-private-avatars',{player:players[0],method:'DELETE',body:{prefixes:[path]}});assert.ok(response.ok,'Fixture photo cleanup failed');
  }
  for(const player of players){
    const response=await request(`/rest/v1/weston_health_profiles?user_id=eq.${player.id}`,{player,method:'DELETE'});assert.ok(response.ok,'Fixture profile cleanup failed');
  }
  console.log(JSON.stringify({checks,cleanup_auth_user_ids:players.map(player=>player.id)}));
}
