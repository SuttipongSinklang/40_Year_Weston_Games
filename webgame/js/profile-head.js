import * as THREE from 'three';
import {analyzeFacePhoto} from './profile-face.js';
import {buildAvatarHead,disposeAvatarHead} from './profile-avatar.js';
// The source GLB has one merged mesh. Clip only its head, retaining outfit geometry.
export function createPhotoHead(character,model){
  let head=null,token=0;const original=new Map();
  const originalDepth=new Map();
  model.traverse(mesh=>{if(mesh.isMesh){original.set(mesh,mesh.material);originalDepth.set(mesh,mesh.customDepthMaterial);}});
  function clipHead(material){
    material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float profileLocalY;').replace('#include <begin_vertex>','#include <begin_vertex>\nprofileLocalY=position.y;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float profileLocalY;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(profileLocalY > -0.10) discard;');
    };
    material.customProgramCacheKey=()=> 'weston-profile-head-cut-v2';return material;
  }
  function clear(){
    for(const [mesh,material]of original){if(mesh.material!==material){mesh.material.dispose();mesh.material=material;}}
    for(const [mesh,material]of originalDepth){if(mesh.customDepthMaterial!==material){mesh.customDepthMaterial?.dispose();mesh.customDepthMaterial=material;}}
    if(head){character.remove(head);disposeAvatarHead(head);head=null;}
  }
  return async blob=>{
    const current=++token;if(!blob){clear();return;}
    let parameters;
    try{parameters=await analyzeFacePhoto(blob);}catch(error){if(current===token)clear();throw error;}
    if(current!==token)return;
    const next=buildAvatarHead(parameters);
    clear();
    for(const [mesh,material]of original){
      mesh.material=clipHead(material.clone());
      mesh.customDepthMaterial=clipHead(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}));
    }
    head=next;head.position.set(0,.97,0);character.add(head);
  };
}
