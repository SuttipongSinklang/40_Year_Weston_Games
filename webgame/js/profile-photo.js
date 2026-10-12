// All image processing happens on-device. Only the cropped result is persisted.
export function cropRectangle(width,height,zoom=1,x=.5,y=.5){
  const size=Math.min(width,height)/Math.max(1,Math.min(3,zoom));
  return {sx:(width-size)*Math.max(0,Math.min(1,x)),sy:(height-size)*Math.max(0,Math.min(1,y)),size};
}
export async function loadPhoto(file){
  if(!file.type.startsWith('image/'))throw new Error('เลือกรูปภาพ JPEG, PNG หรือรูปที่เบราว์เซอร์เปิดได้');
  if(file.size>20*1024*1024)throw new Error('รูปต้องมีขนาดไม่เกิน 20 MB');
  const url=URL.createObjectURL(file),image=new Image();
  try{image.src=url;await image.decode();return image;}catch{throw new Error('เปิดรูปไม่ได้ ลองเลือกรูป JPEG หรือ PNG');}finally{URL.revokeObjectURL(url);}
}
export function drawPhoto(image,canvas,{zoom=1,x=.5,y=.5}={}){
  const {sx,sy,size}=cropRectangle(image.naturalWidth,image.naturalHeight,zoom,x,y);
  canvas.width=canvas.height=512;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#ffe8bc';ctx.fillRect(0,0,512,512);ctx.drawImage(image,sx,sy,size,size,0,0,512,512);
  return canvas;
}
export function photoBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('จัดเตรียมรูปไม่สำเร็จ')),'image/jpeg',.88));}
