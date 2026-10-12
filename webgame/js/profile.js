import {validateProfile} from './profile-model.js';
import {readProfile,writeProfile} from './profile-store.js';
import {profileSession,fetchCloudProfile,saveCloudProfile} from './profile-cloud.js';
import {loadPhoto,drawPhoto,photoBlob} from './profile-photo.js';
import {createCamera} from './profile-camera.js';
import {analyzeFacePhoto} from './profile-face.js';

const dialog=document.getElementById('profileDialog'),form=document.getElementById('profileForm');
const status=document.getElementById('profileStatus'),message=document.getElementById('profileMessage');
const preview=document.getElementById('profilePhotoPreview'),crop=document.getElementById('profileCrop');
const keys=['age','sex','weight_kg','height_cm','bmi','body_fat_percent','muscle_mass_kg'];
let api=null,record=null,photo=null,photoRevision=null,source=null,previewUrl=null,starting=null,syncing=null,dirty=false;
let photoLoading=false,saving=false;
const canvas=document.createElement('canvas');
function uuid(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function say(text,error=false){message.textContent=text;message.dataset.kind=error?'error':'info';}
function savedNotice(){
  const notice=document.getElementById('profileSavedNotice');
  notice.textContent='บันทึกข้อมูลและตัวละครออนไลน์แล้ว';notice.hidden=false;
}
function showPhoto(blob){
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=blob?URL.createObjectURL(blob):null;
  if(previewUrl){preview.src=previewUrl;preview.hidden=false;}else{preview.removeAttribute('src');preview.hidden=true;}
  document.getElementById('profileRemovePhoto').hidden=!blob;
}
function applyRecord(){
  window.westonProfile=record;
  window.dispatchEvent(new CustomEvent('profilechange',{detail:record}));
  const profile=record?.profile;
  const values=profile?[`${profile.body_fat_percent.toFixed(1)}%`,`${profile.muscle_mass_kg.toFixed(1)} กก.`,profile.bmi.toFixed(1),`${profile.weight_kg.toFixed(1)} กก.`]:['—','—','—','—'];
  document.querySelectorAll('#statsGrid .stat-card').forEach((card,i)=>{card.querySelector('b').textContent=values[i];card.querySelector('em')?.remove();});
  document.querySelector('#statsGrid h3').textContent='Fat';
  const avatar=document.getElementById('profileButton');
  avatar.replaceChildren();if(record?.photo){const img=document.createElement('img');img.src=URL.createObjectURL(record.photo);img.alt='หัวตัวละครของคุณ';img.onload=()=>URL.revokeObjectURL(img.src);avatar.append(img);}else{avatar.textContent='😎';}
}
function fill(){
  source=null;crop.hidden=true;dirty=false;photo=record?.photo??null;photoRevision=record?.photo_revision??null;showPhoto(photo);
  for(const key of keys){form.elements[key].value=key==='bmi'&&record?record.profile.bmi.toFixed(2):record?.profile[key]??'';form.elements[key].removeAttribute('aria-invalid');document.getElementById(`error-${key}`).textContent='';}
  say('');status.textContent=record?.cloud_state==='saved'?'บันทึกข้อมูลส่วนตัวออนไลน์แล้ว':record?'ข้อมูลในเครื่องยังรอยืนยันการบันทึกออนไลน์':'ข้อมูลและรูปจะเป็นส่วนตัวของผู้เล่น';
}
function open(){fill();if(!dialog.open)dialog.showModal();}
document.getElementById('profileButton').addEventListener('click',open);
document.getElementById('profileOpen').addEventListener('click',open);
document.getElementById('profileClose').addEventListener('click',()=>dialog.close());
form.addEventListener('input',event=>{dirty=true;const key=event.target.name;if(keys.includes(key)){event.target.removeAttribute('aria-invalid');document.getElementById(`error-${key}`).textContent='';}});
for(const key of ['height_cm','weight_kg'])form.elements[key].addEventListener('input',()=>{
  const height=Number(form.elements.height_cm.value),weight=Number(form.elements.weight_kg.value);
  if(height>0&&weight>0)form.elements.bmi.value=(weight/(height/100)**2).toFixed(2);
});
function repaint(){
  drawPhoto(source,canvas,{zoom:Number(form.elements.photo_zoom.value),x:Number(form.elements.photo_x.value),y:Number(form.elements.photo_y.value)});
  preview.src=canvas.toDataURL('image/jpeg',.88);preview.hidden=false;
}
for(const name of ['photo_zoom','photo_x','photo_y'])form.elements[name].addEventListener('input',repaint);
const cameraPanel=document.getElementById('profileCamera'),video=document.getElementById('profileCameraVideo');
const shutter=document.getElementById('profileCameraCapture'),takePhoto=document.getElementById('profileTakePhoto');
const camera=createCamera(video,navigator.mediaDevices);
function closeCamera(){camera.stop();cameraPanel.hidden=true;takePhoto.disabled=false;shutter.disabled=true;}
takePhoto.addEventListener('click',async()=>{
  cameraPanel.hidden=false;takePhoto.disabled=true;shutter.disabled=true;say('กำลังเปิดกล้อง กรุณาอนุญาตใช้กล้อง');
  try{if(await camera.start()){shutter.disabled=!(video.videoWidth&&video.videoHeight);say('มองกล้อง แล้วกดถ่ายรูป');video.focus();}}
  catch(error){closeCamera();say(error.name==='NotAllowedError'?'กรุณาอนุญาตกล้องในการตั้งค่าเว็บไซต์ แล้วกดถ่ายรูปอีกครั้ง':error.name==='NotFoundError'?'ไม่พบกล้องบนอุปกรณ์นี้':error.name==='NotReadableError'?'กล้องถูกใช้งานอยู่ กรุณาปิดแอปที่ใช้กล้องแล้วลองใหม่':error.message,true);}
});
video.addEventListener('loadeddata',()=>{shutter.disabled=!(video.videoWidth&&video.videoHeight);});
document.getElementById('profileCameraCancel').addEventListener('click',closeCamera);
dialog.addEventListener('close',closeCamera);
window.addEventListener('pagehide',closeCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden)closeCamera();});
window.addEventListener('screenchange',closeCamera);
async function usePhoto(file){
  photoLoading=true;document.getElementById('profileSave').disabled=true;
  try{source=await loadPhoto(file);form.elements.photo_zoom.value=1;form.elements.photo_x.value=form.elements.photo_y.value=.5;crop.hidden=false;repaint();document.getElementById('profileRemovePhoto').hidden=false;dirty=true;say('จัดใบหน้าคนหน้าตรงให้เต็มกรอบ แล้วบันทึกเพื่อสร้างหัว 3D ชุดและลำตัวจะเหมือนเดิม');}catch(error){say(error.message,true);}finally{photoLoading=false;document.getElementById('profileSave').disabled=false;}
}
shutter.addEventListener('click',async()=>{
  if(!video.videoWidth||!video.videoHeight)return;
  shutter.disabled=true;
  try{
    const shot=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));
    shot.width=Math.round(video.videoWidth*scale);shot.height=Math.round(video.videoHeight*scale);
    shot.getContext('2d').drawImage(video,0,0,shot.width,shot.height);
    const blob=await photoBlob(shot);closeCamera();await usePhoto(blob);
  }catch(error){closeCamera();say(error.message,true);}
});
document.getElementById('profileRemovePhoto').addEventListener('click',()=>{source=null;photo=null;photoRevision=null;crop.hidden=true;showPhoto(null);dirty=true;});

async function sync(){
  if(syncing)return syncing;
  if(!api||!record||record.cloud_state==='saved')return;
  const snapshot=record;
  syncing=(async()=>{
    status.textContent='กำลังบันทึกข้อมูลส่วนตัวออนไลน์…';
    try{
      await saveCloudProfile(api,snapshot);
      if(record.revision!==snapshot.revision)return;
      record={...snapshot,cloud_state:'saved'};await writeProfile(record);applyRecord();status.textContent='บันทึกข้อมูลส่วนตัวออนไลน์แล้ว';
    }catch{status.textContent='ยังบันทึกออนไลน์ไม่ได้ ข้อมูลในเครื่องรอส่งใหม่เมื่อเชื่อมต่อพร้อม';}
  })().finally(()=>{syncing=null;});return syncing;
}
async function start(){
  if(starting)return starting;
  starting=(async()=>{
    status.textContent='กำลังเข้าสู่ระบบผู้เล่น…';
    try{
      api=await profileSession();record=await readProfile(api.userId);applyRecord();
      if(record?.cloud_state==='pending'){await sync();}
      else{
        try{const online=await fetchCloudProfile(api);if(online){record=online;await writeProfile(record);applyRecord();}}catch{status.textContent='ยังโหลดข้อมูลออนไลน์ไม่ได้ กดเชื่อมต่ออีกครั้งเพื่อลองใหม่';}
      }
      if(!record){if(!dirty)open();}else if(dialog.open&&!dirty)fill();
    }catch{say('ยังเข้าสู่ระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วกดเชื่อมต่ออีกครั้ง ข้อมูลจะบันทึกหลังยืนยันผู้เล่นแล้ว',true);}
  })().finally(()=>{starting=null;});return starting;
}
document.getElementById('profileRetry').addEventListener('click',()=>api&&record?sync():start());
window.addEventListener('online',()=>api&&record?sync():start());
form.addEventListener('submit',async event=>{
  event.preventDefault();
  closeCamera();
  if(photoLoading)return;
  const result=validateProfile(Object.fromEntries(keys.map(key=>[key,form.elements[key].value])));
  for(const key of keys){document.getElementById(`error-${key}`).textContent=result.errors[key]??'';form.elements[key].setAttribute('aria-invalid',String(Boolean(result.errors[key])));}
    if(!result.valid){form.elements[Object.keys(result.errors)[0]].focus();say('ยังไม่ได้บันทึก กรุณากรอกข้อมูลให้ครบและตรวจช่องสีแดง',true);return;}
  if(saving)return;
  saving=true;
  const button=document.getElementById('profileSave');button.disabled=true;button.textContent='กำลังบันทึก…';say('กำลังบันทึกข้อมูลและตัวละคร…');
  const controls=[...form.querySelectorAll('input,select,button')].filter(control=>control!==button&&control.id!=='profileClose');
  controls.forEach(control=>control.disabled=true);
  let stage='local';
  try{
    if(!api){await start();if(!api)return;}
    if(source){
      stage='face';say('กำลังวิเคราะห์ใบหน้าและสร้างหัว 3D… ครั้งแรกต้องโหลดโมเดล');
      const nextPhoto=await photoBlob(canvas);await analyzeFacePhoto(nextPhoto);
      photo=nextPhoto;photoRevision=uuid();stage='local';
    }
    const next={owner:api.userId,profile:result.profile,photo,photo_revision:photo?photoRevision:null,revision:uuid(),cloud_state:'pending'};
    await writeProfile(next);record=next;dirty=false;applyRecord();say(['บันทึกข้อมูลในเครื่องแล้ว',...result.notices,'เป้าหมายองค์ประกอบร่างกายรอตารางอ้างอิงและนิยามกล้ามเนื้อ'].join('\n'));
    if(syncing)await syncing;await sync();
    source=null;crop.hidden=true;showPhoto(photo);
    if(record.cloud_state==='saved'){
      say('บันทึกข้อมูลและตัวละครออนไลน์แล้ว');savedNotice();dialog.close();
      document.querySelector('.nav-btn[data-screen="home"]').click();
      document.getElementById('profileButton').focus();
    }else{
      say('อัปเดตตัวละครในเครื่องแล้ว แต่ยังบันทึกออนไลน์ไม่สำเร็จ กดเชื่อมต่ออีกครั้งเพื่อลองใหม่',true);
      status.scrollIntoView({block:'nearest'});
    }
  }catch(error){say(stage==='face'?(error.message.startsWith('กรุณา')||error.message.startsWith('ตรวจไม่พบ')||error.message.startsWith('ใบหน้า')?error.message:'ยังสร้างหัว 3D ไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่'):'บันทึกข้อมูลในเครื่องไม่สำเร็จ กรุณาลองใหม่',true);message.scrollIntoView({block:'nearest'});}finally{saving=false;button.disabled=false;button.textContent=record?'บันทึกการเปลี่ยนแปลง':'บันทึกข้อมูลและตัวละคร';controls.forEach(control=>control.disabled=false);}
});
window.addEventListener('screenchange',event=>{document.getElementById('profileOpen').hidden=event.detail==='home';});
document.getElementById('profileOpen').hidden=!location.hash||location.hash==='#home';
applyRecord();start();
