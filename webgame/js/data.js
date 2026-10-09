import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { bangkokDay } from './progress.js';

const STORAGE_KEY = 'weston-progress-v1';
let client, clientLoading, connecting, flushing, storageAvailable = true;
let cache;
try { cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { storageAvailable = false; }
if (!cache || !Array.isArray(cache.pending) || !Array.isArray(cache.days)) {
  cache = { owner: null, total: 0, days: [], daily: {}, pending: [] };
}
cache.total = Math.max(0, Number(cache.total) || 0);
cache.daily ||= {};
const listeners = new Set();
let status = { state: 'connecting', detail: 'กำลังตรวจการเชื่อมต่อ' };
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); }
  catch { storageAvailable = false; }
}
function readLatest() {
  try {
    const latest = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (latest && latest.owner === cache.owner && Array.isArray(latest.pending)) cache = latest;
  } catch { storageAvailable = false; }
}
function emit() { for (const listener of listeners) listener(snapshot()); }
function setStatus(state, detail) { status = { state, detail }; emit(); }
export function snapshot() {
  return { total: cache.total + cache.pending.length,
    days: [...new Set([...cache.days, ...cache.pending.map(e => e.played_on)])],
    daily: { ...cache.daily }, pending: cache.pending.slice(), storageAvailable, ...status };
}
export function subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); }
function workoutId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // LAN http://192.168.x.x does not expose randomUUID on some mobile browsers.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function recordWorkout() {
  readLatest();
  cache.pending.push({ id: workoutId(), played_on: bangkokDay() });
  persist(); emit();
  if (client?.userId) void sync();
  else if (!navigator.onLine) setStatus('offline', 'จะส่งความคืบหน้าเมื่อกลับมาออนไลน์');
}
function friendlyError(error) {
  const message = `${error.message || ''}`;
  if (!navigator.onLine || /fetch|network|timeout/i.test(message)) return ['offline', 'เล่นต่อได้ แล้วกดลองเชื่อมต่ออีกครั้งเมื่อมีอินเทอร์เน็ต'];
  if (/anonymous|disabled/i.test(message)) return ['setup', 'ต้องเปิด Anonymous Sign-Ins ใน Supabase ก่อนบันทึกออนไลน์'];
  if (/PGRST|does not exist|schema cache|permission denied/i.test(message) || error.code === '42501') return ['setup', 'ต้องติดตั้งตารางเกมและสิทธิ์ข้อมูลใน Supabase ก่อน'];
  return ['error', 'เชื่อมต่อไม่ได้ ความคืบหน้ายังเก็บในเครื่อง กดลองเชื่อมต่ออีกครั้ง'];
}
const timedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
async function getClient() {
  if (client) return client;
  if (clientLoading) return clientLoading;
  clientLoading = (async () => {
  // Exact dependency version; a failed CDN import never blocks local gameplay.
  let timer;
  const { createClient } = await Promise.race([
    import('https://esm.sh/@supabase/supabase-js@2.57.4'),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Network timeout')), 15000); }),
  ]).finally(() => clearTimeout(timer));
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
  return client;
  })();
  try { return await clientLoading; } finally { clientLoading = undefined; }
}
const serverLock = operation => navigator.locks
  ? navigator.locks.request('weston-cloud-sync-v1', operation)
  : operation();
let sessionLoading;
export function playerSession() {
  if (sessionLoading) return sessionLoading;
  sessionLoading = (async () => {
  const api = await getClient();
  let { data: { session }, error } = await api.auth.getSession();
  if (error) throw error;
  if (!session) {
    const result = await api.auth.signInAnonymously();
    if (result.error) throw result.error;
    session = result.data.session;
  }
  if (!session) throw new Error('No player session');
  api.userId = session.user.id;
  return api;
  })().finally(() => { sessionLoading = null; });
  return sessionLoading;
}

async function loadRemote() {
  const [progress, days] = await Promise.all([
    client.from('weston_progress').select('total_workouts').eq('user_id', client.userId).maybeSingle(),
    client.from('weston_days').select('played_on,workouts').eq('user_id', client.userId).order('played_on', { ascending: false }).limit(366),
  ]);
  if (progress.error) throw progress.error;
  if (days.error) throw days.error;
  readLatest();
  // An earlier request may have committed before losing its response.
  // Reconcile pending IDs to avoid showing that workout twice after a reload.
  const acknowledged = new Set();
  for (let offset = 0; offset < cache.pending.length; offset += 100) {
    const { data, error } = await client.from('weston_workouts').select('id')
      .eq('user_id', client.userId).in('id', cache.pending.slice(offset, offset + 100).map(e => e.id));
    if (error) throw error;
    for (const row of data) acknowledged.add(row.id);
  }
  readLatest();
  cache.pending = cache.pending.filter(e => !acknowledged.has(e.id));
  cache.total = progress.data?.total_workouts || 0;
  cache.days = days.data.map(d => d.played_on);
  cache.daily = Object.fromEntries(days.data.map(d => [d.played_on, d.workouts]));
  persist();
}
export async function connect() {
  if (connecting) return connecting;
  connecting = (async () => {
    setStatus('connecting', 'กำลังเชื่อมต่อบัญชีผู้เล่น');
    try {
      const api = await playerSession();
      if (cache.owner && cache.owner !== api.userId) {
        // Never submit another account's pending activity into a new account.
        localStorage.setItem(`${STORAGE_KEY}-archive-${cache.owner}`, JSON.stringify(cache));
        cache = { owner: api.userId, total: 0, days: [], daily: {}, pending: [] };
      }
      cache.owner = api.userId;
      persist();
      // Check schema before sending any pending activity.
      await serverLock(loadRemote);
      await sync();
    } catch (error) { setStatus(...friendlyError(error)); }
    finally { connecting = undefined; }
  })();
  return connecting;
}
export async function sync() {
  if (flushing) return flushing;
  if (!client?.userId) return;
  flushing = (async () => {
    try {
      await serverLock(async () => {
      readLatest();
      while (cache.pending.length) {
        setStatus('syncing', 'กำลังส่งความคืบหน้าขึ้นบัญชีผู้เล่น');
        const batch = cache.pending.slice(0, 100);
        const { error } = await client.from('weston_workouts').upsert(
          batch.map(e => ({ ...e, user_id: client.userId })),
          { onConflict: 'id', ignoreDuplicates: true },
        );
        if (error) throw error;
        // Re-read summary before acknowledging queue, so uncertain completion is retried safely.
        const [progress, days] = await Promise.all([
          client.from('weston_progress').select('total_workouts').eq('user_id', client.userId).single(),
          client.from('weston_days').select('played_on,workouts').eq('user_id', client.userId).order('played_on', { ascending: false }).limit(366),
        ]);
        if (progress.error) throw progress.error;
        if (days.error) throw days.error;
        const sent = new Set(batch.map(e => e.id));
        readLatest();
        cache.pending = cache.pending.filter(e => !sent.has(e.id));
        cache.total = progress.data.total_workouts;
        cache.days = days.data.map(d => d.played_on);
        cache.daily = Object.fromEntries(days.data.map(d => [d.played_on, d.workouts]));
        persist(); emit();
      }
      setStatus('saved', 'บันทึกบน Supabase แล้ว · บัญชีผู้เล่นของเบราว์เซอร์นี้');
      });
    } catch (error) { setStatus(...friendlyError(error)); }
    finally { flushing = undefined; }
  })();
  return flushing;
}
export async function leaderboard() {
  const api = await getClient();
  const { data, error } = await api.from('weston_scores').select('user_id,display_name,total_workouts').order('total_workouts', { ascending: false }).limit(50);
  if (error) throw error;
  return { rows: data, userId: api.userId };
}
// Finished runs are queued for automatic private online saving.
export async function saveRunToCloud(record) {
  if (!record.share || record.run.status !== 'finished') throw new Error('Online saving requires a completed queued run');
  const api = await playerSession();
  if (record.owner && record.owner !== api.userId) throw new Error('Run belongs to another account');
  const run = record.run;
  const row = { id: run.id, user_id: api.userId, activity: run.activity || 'outdoor', started_at: run.started_at, ended_at: run.ended_at,
    distance_source: run.distance_source || (run.activity === 'treadmill' ? 'manual' : 'gps'),
    steps: run.steps || 0, stride_m: run.stride_m ?? null,
    distance_m: Math.round(run.distance_m * 1000) / 1000, duration_s: run.elapsed_ms / 1000,
    route: run.points, splits: run.splits, events: run.events || [] };
  const { error } = await api.from('weston_runs').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  const verified = await api.from('weston_runs').select('id').eq('user_id', api.userId).eq('id', run.id).single();
  if (verified.error) throw verified.error;
  if (verified.data?.id !== run.id) throw new Error('Online save not confirmed');
  return api.userId;
}
export async function loadRunsFromCloud() {
  const api = await playerSession();
  const result = await api.from('weston_runs').select('id,activity,distance_source,steps,stride_m,started_at,ended_at,distance_m,duration_s,route,splits,events')
    .eq('user_id', api.userId).order('started_at', { ascending: false }).limit(50);
  if (result.error) throw result.error;
  return { rows: result.data, owner: api.userId };
}
window.addEventListener('online', () => void connect());
window.addEventListener('offline', () => setStatus('offline', 'จะส่งความคืบหน้าเมื่อกลับมาออนไลน์'));
document.addEventListener('visibilitychange', () => { if (!document.hidden && client?.userId) void connect(); });
// Synchronize shared browser drafts before the next local action.
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try { const other = JSON.parse(event.newValue); if (other?.owner === cache.owner) { cache = other; emit(); } } catch { /* keep current state */ }
});
