import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {faceParameters} from '../webgame/js/profile-face.js';
const three=new vm.SyntheticModule(Object.keys(THREE),function(){for(const key of Object.keys(THREE))this.setExport(key,THREE[key]);});
const avatar=new vm.SourceTextModule(await readFile(new URL('../webgame/js/profile-avatar.js',import.meta.url),'utf8'));
await avatar.link(name=>{assert.equal(name,'three');return three;});await avatar.evaluate();
const {buildAvatarHead,disposeAvatarHead}=avatar.namespace;
const parameters={width:.75,jaw:.8,eyeSpacing:.3,eyeWidth:.2,eyeHeight:.05,noseWidth:.18,noseLength:.2,mouthWidth:.4,skin:[180,130,100],hair:[50,35,20],iris:[80,45,20]};
test('head has solid face, eyes, nose, ears, lips and hair with no photo plane or texture',()=>{
  const head=buildAvatarHead(parameters);const names=head.children.map(o=>o.name);
  for(const name of ['face-volume','eye-white','nose-tip','ear','mouth','hair-cap'])assert.ok(names.includes(name));
  head.traverse(o=>{if(o.isMesh){assert.notEqual(o.geometry.type,'PlaneGeometry');assert.equal(o.material.map,null);assert.ok(o.castShadow);}});
  const box=new THREE.Box3().setFromObject(head),size=box.getSize(new THREE.Vector3());assert.ok(size.z>.5);
  disposeAvatarHead(head);
});
test('different facial proportions change geometry instead of reusing a photo billboard',()=>{
  const a=buildAvatarHead(parameters),b=buildAvatarHead({...parameters,width:.9,noseWidth:.25});
  assert.notEqual(a.getObjectByName('face-volume').scale.x,b.getObjectByName('face-volume').scale.x);
  assert.notEqual(a.getObjectByName('nose-tip').scale.x,b.getObjectByName('nose-tip').scale.x);
  disposeAvatarHead(a);disposeAvatarHead(b);
});
test('invalid, missing, or tiny landmarks cannot create a personal face',()=>{
  assert.throws(()=>faceParameters([],()=>[0,0,0]),/ตรวจไม่พบ/);
  assert.throws(()=>faceParameters(Array.from({length:478},()=>({x:.5,y:.5,z:0})),()=>[0,0,0]),/เล็กเกิน/);
});
test('disposing a head releases shared materials only once',()=>{
  const head=buildAvatarHead(parameters),counts=new Map();head.traverse(o=>{if(o.material&&!counts.has(o.material)){counts.set(o.material,0);o.material.addEventListener('dispose',()=>counts.set(o.material,counts.get(o.material)+1));}});
  disposeAvatarHead(head);assert.ok([...counts.values()].every(n=>n===1));
});
test('head replacement preserves original body geometry and restores original materials',async()=>{
  const context=vm.createContext({});
  const threeModule=new vm.SyntheticModule(Object.keys(THREE),function(){for(const key of Object.keys(THREE))this.setExport(key,THREE[key]);},{context});
  const avatarModule=new vm.SourceTextModule(await readFile(new URL('../webgame/js/profile-avatar.js',import.meta.url),'utf8'),{context});
  let resolve;
  const analyze=new vm.SyntheticModule(['analyzeFacePhoto'],function(){this.setExport('analyzeFacePhoto',async blob=>blob==='slow'?new Promise(r=>resolve=r):parameters);},{context});
  const controller=new vm.SourceTextModule(await readFile(new URL('../webgame/js/profile-head.js',import.meta.url),'utf8'),{context});
  const linker=name=>name==='three'?threeModule:name==='./profile-face.js'?analyze:avatarModule;
  await controller.link(linker);await controller.evaluate();
  const character=new THREE.Group(),model=new THREE.Group(),geometry=new THREE.BoxGeometry(.5,.5,.5),material=new THREE.MeshStandardMaterial();
  const body=new THREE.Mesh(geometry,material);model.add(body);character.add(model);
  const before=geometry.attributes.position.array.slice();
  const update=controller.namespace.createPhotoHead(character,model);
  await update('face');assert.equal(character.children.length,2);assert.equal(body.geometry,geometry);assert.deepEqual(geometry.attributes.position.array,before);
  assert.notEqual(body.material,material);assert.ok(body.customDepthMaterial);
  await update(null);assert.equal(character.children.length,1);assert.equal(body.material,material);assert.equal(body.customDepthMaterial,undefined);
  const pending=update('slow');await update(null);resolve(parameters);await pending;
  assert.equal(character.children.length,1);assert.equal(body.material,material);
  geometry.dispose();material.dispose();
});
