import {loadPhoto} from './profile-photo.js?v=20261012-2';
const cache=new WeakMap();let detector;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function faceParameters(points,sample){
  if(!points||points.length<468||points.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))throw new Error('ตรวจไม่พบใบหน้า กรุณาถ่ายใบหน้าคนหน้าตรงให้ชัดเจน');
  const p=i=>points[i],dist=(a,b)=>Math.hypot(p(a).x-p(b).x,p(a).y-p(b).y);
  const height=dist(10,152),width=dist(234,454),eyeSpan=dist(33,263);
  if(height<.12||width<.1||eyeSpan<.04)throw new Error('ใบหน้าเล็กเกินไป กรุณาถ่ายให้ใบหน้าเต็มกรอบ');
  const eyeMid=(p(33).x+p(263).x)/2;
  if(Math.abs(p(1).x-eyeMid)/eyeSpan>.24||Math.abs(p(33).y-p(263).y)/eyeSpan>.25)throw new Error('กรุณามองกล้องหน้าตรงและไม่เอียงศีรษะ แล้วถ่ายใหม่');
  const rgb=(x,y)=>sample(clamp(x,0,1),clamp(y,0,1));
  return {version:1,width:clamp(width/height,.62,.9),jaw:clamp(dist(172,397)/width,.62,.95),
    eyeSpacing:clamp(dist(133,362)/width,.25,.45),eyeWidth:clamp((dist(33,133)+dist(362,263))/2/width,.14,.25),
    eyeHeight:clamp((dist(159,145)+dist(386,374))/2/height,.025,.065),
    noseWidth:clamp(dist(98,327)/width,.12,.25),noseLength:clamp(dist(168,2)/height,.14,.28),
    mouthWidth:clamp(dist(61,291)/width,.25,.5),
    skin:rgb((p(50).x+p(101).x)/2,(p(50).y+p(101).y)/2),
    hair:rgb(p(10).x,p(10).y-height*.12),iris:rgb(p(468)?.x??(p(33).x+p(133).x)/2,p(468)?.y??p(33).y)};
}
async function landmarker(){
  if(!detector)detector=(async()=>{
    const {FaceLandmarker,FilesetResolver}=await import('../assets/vendor/mediapipe/vision_bundle.mjs');
    const files=await FilesetResolver.forVisionTasks(new URL('../assets/vendor/mediapipe/wasm',import.meta.url).href);
    return FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('../assets/vendor/mediapipe/face_landmarker.task',import.meta.url).href,delegate:'CPU'},runningMode:'IMAGE',numFaces:2,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6});
  })().catch(error=>{detector=null;throw error;});
  return detector;
}
export async function analyzeFacePhoto(blob){
  if(cache.has(blob))return cache.get(blob);
  const pending=(async()=>{
    const image=await loadPhoto(blob),engine=await landmarker();
    const result=engine.detect(image);
    if(result.faceLandmarks.length!==1)throw new Error(result.faceLandmarks.length?'กรุณาถ่ายใบหน้าเพียงคนเดียว':'ตรวจไม่พบใบหน้าคน กรุณาถ่ายใบหน้าหน้าตรงใหม่');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,256,256);
    const pixels=ctx.getImageData(0,0,256,256).data;
    const sample=(x,y)=>{
      const channels=[[],[],[]];
      for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
        const offset=(clamp(Math.round(y*255)+dy,0,255)*256+clamp(Math.round(x*255)+dx,0,255))*4;
        for(let c=0;c<3;c++)channels[c].push(pixels[offset+c]);
      }
      return channels.map(values=>values.sort((a,b)=>a-b)[24]);
    };
    return faceParameters(result.faceLandmarks[0],sample);
  })();cache.set(blob,pending);
  try{return await pending;}catch(error){cache.delete(blob);throw error;}
}
