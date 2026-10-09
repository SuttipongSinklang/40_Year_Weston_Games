const DB_NAME = 'weston-running-v1';
let opening;
function database() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('runs', { keyPath: 'id' }).createIndex('started', 'run.started_at');
      db.createObjectStore('draft');
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; resolve(request.result); };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error('Run storage is blocked by another tab')); };
  });
  return opening;
}
async function transaction(store, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Run storage failed'));
  });
}
export const loadDraft = () => transaction('draft', 'readonly', store => store.get('active'));
export async function saveDraft(run, token) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('draft', 'readwrite'), store = tx.objectStore('draft');
    const request = store.get('lease');
    request.onsuccess = () => {
      if (request.result?.token !== token || request.result.expires < Date.now()) { tx.abort(); return; }
      store.put(run, 'active');
    };
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Run draft is owned by another tab'));
  });
}
export const saveRecord = record => transaction('runs', 'readwrite', store => store.put(record));
export async function listRecords() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('runs'), result = [];
    const request = tx.objectStore('runs').index('started').openCursor(null, 'prev');
    request.onsuccess = () => { const cursor = request.result; if (cursor && result.length < 50) { result.push(cursor.value); cursor.continue(); } };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export const getRecord = id => transaction('runs', 'readonly', store => store.get(id));
// Cloud sync must see the whole queue, unlike the 50-newest history view.
export async function listPendingRecords() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('runs'), result = [];
    const request = tx.objectStore('runs').openCursor();
    request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value?.cloud_state === 'pending') result.push(cursor.value); cursor.continue(); } };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
// First account to claim a pending run owns it forever; a concurrent tab with another account must never rebind it.
export async function claimRunForSync(id, owner) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('runs', 'readwrite');
    const request = tx.objectStore('runs').get(id);
    let record;
    request.onsuccess = () => {
      record = request.result;
      if (record && record.owner == null) { record.owner = owner; tx.objectStore('runs').put(record); }
    };
    tx.oncomplete = () => resolve(record);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Run claim failed'));
  });
}
export async function finishDraft(record, token) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['runs', 'draft'], 'readwrite');
    const store = tx.objectStore('draft'), request = store.get('lease');
    request.onsuccess = () => {
      if (request.result?.token !== token || request.result.expires < Date.now()) { tx.abort(); return; }
      tx.objectStore('runs').put(record); store.delete('active'); store.delete('lease');
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Run save failed'));
  });
}
export async function runLease(token, action = 'acquire') {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('draft', 'readwrite'), store = tx.objectStore('draft');
    const request = store.get('lease'); let allowed = false;
    request.onsuccess = () => {
      const lease = request.result;
      if (action === 'release') { if (lease?.token === token) store.delete('lease'); allowed = true; }
      else if (lease?.token === token || (action === 'acquire' && (!lease || lease.expires < Date.now()))) {
        store.put({ token, expires: Date.now() + 15000 }, 'lease'); allowed = true;
      }
    };
    tx.oncomplete = () => resolve(allowed);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
export function newRunId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
