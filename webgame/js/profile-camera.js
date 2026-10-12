// A cancellable camera session: late permission results must never leave a camera running.
export function createCamera(video,mediaDevices){
  let stream=null,generation=0;
  function stop(){generation++;stream?.getTracks().forEach(track=>track.stop());stream=null;video.pause();video.srcObject=null;}
  async function start(){
    stop();const request=generation;
    if(!mediaDevices?.getUserMedia)throw new Error('เปิดกล้องไม่ได้ กรุณาใช้เว็บผ่าน HTTPS และอนุญาตกล้อง');
    const next=await mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:1280},height:{ideal:1280}}});
    if(request!==generation){next.getTracks().forEach(track=>track.stop());return false;}
    stream=next;video.srcObject=next;
    try{await video.play();}catch(error){if(request===generation)stop();throw error;}
    return request===generation;
  }
  return {start,stop};
}
