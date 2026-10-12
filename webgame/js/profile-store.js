const DATABASE='weston-private-profile-v1';
let pending;
function database() {
  pending ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('profiles',{keyPath:'owner'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{pending=null;reject(request.error);};
  });
  return pending;
}
export async function readProfile(owner) {
  const db=await database();return new Promise((resolve,reject)=>{
    const request=db.transaction('profiles').objectStore('profiles').get(owner);
    request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);
  });
}
export async function writeProfile(record) {
  const db=await database();return new Promise((resolve,reject)=>{
    const transaction=db.transaction('profiles','readwrite');transaction.objectStore('profiles').put(record);
    transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });
}
