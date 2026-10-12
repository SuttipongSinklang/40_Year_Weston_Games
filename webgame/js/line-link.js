// บังคับยืนยันตัวตนผ่าน LINE ทุกครั้งที่เปิดเกม (LIFF) แล้วจับคู่กับพนักงาน HR
// อ่านอย่างเดียว: ไม่เขียนอะไรกลับไปที่ HR server
import { HR_SUPABASE_URL, HR_SUPABASE_ANON_KEY, LINE_LIFF_ID } from './config.js?v=20261012-2';

const CACHE_KEY = 'weston-line-link-v1';
const LINE_UID_RE = /^U[0-9a-f]{32}$/;

// status: resolving | login-redirect | linked | unlinked | native-blocked | offline | error
let state = { status: 'idle', detail: '' };
const listeners = new Set();
function emit() { renderGate(state); try { window.westonLineLink = state; } catch { /* บางสภาพแวดล้อมไม่มี window */ } for (const listener of listeners) listener(state); }
function setState(next) { state = next; emit(); }
export function lineLinkState() { return state; }
export function subscribeLine(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); }

// เก็บผลลิงก์ไว้ใช้แสดงผลเมื่อออฟไลน์เท่านั้น ไม่ใช่หลักฐานยืนยันตัวตน
function readCache() {
  try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return cached?.lineUserId && cached.employee ? cached : null; }
  catch { return null; }
}
function writeCache(next) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* พื้นที่เครื่องเต็มก็ข้ามได้ */ } }

function isNativeApp() { return Boolean(window.Capacitor?.isNativePlatform?.()); }

// ถ้า LINE ส่ง error กลับมาตอน redirect กลับ ห้ามเด้งไปหน้าล็อกอินซ้ำ (กันวนลูป)
function loginErrorFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    return params.get('error') ? (params.get('error_description') || params.get('error')) : null;
  } catch { return null; }
}

let liffLoading;
function loadLiffSdk() {
  if (liffLoading) return liffLoading;
  liffLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    const timer = setTimeout(() => reject(new Error('โหลด LIFF หมดเวลา')), 15000);
    script.onload = () => { clearTimeout(timer); resolve(window.liff); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('โหลด LIFF ไม่สำเร็จ')); };
    document.head.append(script);
  });
  liffLoading = liffLoading.catch(error => { liffLoading = undefined; throw error; });
  return liffLoading;
}

// ได้ LINE user id จาก LIFF — ทุกเบราว์เซอร์ต้องผ่าน LIFF ถ้ายังไม่ได้ล็อกอินจะถูกพาไปหน้าล็อกอิน LINE
async function liffSession() {
  const liff = await loadLiffSdk();
  await liff.init({ liffId: LINE_LIFF_ID });
  const loginError = loginErrorFromUrl();
  if (loginError) throw new Error(`LINE ตอบกลับ: ${loginError}`);
  if (!liff.isLoggedIn()) {
    setState({ status: 'login-redirect', detail: 'กำลังพาไปเข้าสู่ระบบ LINE แล้วจะกลับมาที่เกมเอง' });
    liff.login();
    return null; // หน้าเว็บกำลังจะถูกพาออกไปหน้าล็อกอินของ LINE
  }
  const profile = await liff.getProfile();
  if (!LINE_UID_RE.test(profile.userId || '')) throw new Error('LINE ไม่ได้ส่งรหัสผู้ใช้กลับมา');
  return { userId: profile.userId, displayName: profile.displayName ?? null, pictureUrl: profile.pictureUrl ?? null };
}

// ลบพารามิเตอร์ของ LINE ที่ค้างใน URL หลังล็อกอินสำเร็จ กันการเด้งไปหน้าล็อกอินซ้ำเวลา reload
function cleanLoginParams() {
  try {
    const url = new URL(location.href);
    if (!['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description'].some(key => url.searchParams.has(key))) return;
    for (const key of ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description']) url.searchParams.delete(key);
    const query = url.searchParams.toString();
    history.replaceState(null, '', url.pathname + (query ? `?${query}` : '') + url.hash);
  } catch { /* แก้ URL ไม่ได้ก็ไม่เป็นไร */ }
}

async function fetchLink(lineUserId) {
  const params = new URLSearchParams({
    select: 'line_user_id,display_name,linked_at,employees(employee_code,first_name_th,last_name_th,first_name_en,last_name_en)',
    line_user_id: `eq.${lineUserId}`,
    limit: '1',
  });
  const response = await fetch(`${HR_SUPABASE_URL}/rest/v1/employee_line_links?${params}`, {
    headers: { apikey: HR_SUPABASE_ANON_KEY, Authorization: `Bearer ${HR_SUPABASE_ANON_KEY}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HR server ตอบ ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

function employeeName(employee) {
  if (!employee) return null;
  const th = `${employee.first_name_th || ''} ${employee.last_name_th || ''}`.trim();
  const en = `${employee.first_name_en || ''} ${employee.last_name_en || ''}`.trim();
  return th || en || null;
}

// โหมดพัฒนาบนเครื่องตัวเอง: ข้ามประตู LINE เพื่อทดสอบเกมใน localhost (ไม่มีผลกับ production)
function isLocalDev() {
  try { return location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname); }
  catch { return false; }
}

let running;
export function startLineLink() {
  if (running) return running;
  running = (async () => {
    if (isLocalDev()) { setState({ status: 'linked', devBypass: true, detail: 'โหมดพัฒนา (localhost): ข้ามการล็อกอิน LINE' }); return; }
    if (!LINE_LIFF_ID) { setState({ status: 'error', detail: 'ระบบยังไม่ได้ตั้งค่า LINE_LIFF_ID' }); return; }
    if (isNativeApp()) { setState({ status: 'native-blocked', detail: 'แอปบนมือถือ (APK) ยังไม่รองรับการล็อกอินผ่าน LINE\nกรุณาเปิดเกมจากลิงก์ใน LINE หรือเข้าเว็บ p.westonsupa.xyz ผ่านเบราว์เซอร์' }); return; }
    const cached = readCache();
    setState({ status: 'resolving', detail: 'กำลังตรวจสอบการเข้าสู่ระบบผ่าน LINE…' });

    let session;
    try { session = await liffSession(); }
    catch (error) {
      if (state.status === 'login-redirect') return; // กำลังถูกพาไปหน้าล็อกอิน LINE อยู่
      if (cached) { setState({ ...cached, status: 'linked', offline: true }); return; }
      setState({ status: 'offline', detail: `${error.message || 'ยังเชื่อมต่อ LINE ไม่ได้'} ตรวจอินเทอร์เน็ตแล้วกดลองใหม่` });
      return;
    }
    if (!session) return; // liff.login() กำลังพาไปหน้าล็อกอิน
    cleanLoginParams();

    try {
      const row = await fetchLink(session.userId);
      if (!row) {
        setState({ status: 'unlinked', lineUserId: session.userId, lineDisplayName: session.displayName, detail: 'บัญชี LINE นี้ยังไม่ได้ลงทะเบียนกับข้อมูลพนักงาน กรุณาติดต่อ HR ก่อนเข้าเล่นเกม' });
        return;
      }
      const next = {
        status: 'linked',
        lineUserId: session.userId,
        lineDisplayName: row.display_name ?? session.displayName,
        linePictureUrl: session.pictureUrl,
        linkedAt: row.linked_at ?? null,
        employee: row.employees || null,
        employeeDisplayName: employeeName(row.employees),
      };
      writeCache(next);
      setState(next);
    } catch {
      if (cached) setState({ ...cached, status: 'linked', offline: true });
      else setState({ status: 'offline', lineUserId: session.userId, detail: 'ยังตรวจข้อมูลพนักงานไม่ได้ ตรวจอินเทอร์เน็ตแล้วกดลองใหม่' });
    }
  })();
  const pending = running;
  running = pending.finally(() => { running = null; });
  return running;
}

// ---- ประตูบังคับล็อกอิน LINE: ครอบทั้งเกมไว้จนกว่าจะยืนยันตัวตนผ่าน ----
const GATE_STYLE = `
#lineLoginGate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#0d2f23f2;backdrop-filter:blur(4px);padding:24px;box-sizing:border-box}
#lineLoginGate[hidden]{display:none}
.line-gate-card{max-width:340px;width:100%;text-align:center;background:#fffdf7;color:#203c45;border-radius:22px;padding:28px 22px;box-shadow:0 24px 80px #00000080;font-family:Mitr,system-ui,sans-serif}
.line-gate-logo{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:18px;background:#06c755;color:#fff;font-weight:800;font-size:15px;letter-spacing:.5px;margin-bottom:12px}
.line-gate-card h2{margin:0 0 8px;font-size:21px}
.line-gate-card p{font-size:13px;line-height:1.8;color:#657678;margin:0 0 14px;white-space:pre-line}
.line-gate-retry{border:0;background:#078448;color:#fff;font:inherit;font-weight:600;padding:12px 20px;border-radius:12px;cursor:pointer;min-height:46px}
.line-gate-retry[hidden]{display:none}`;

function ensureGate() {
  let gate = document.getElementById('lineLoginGate');
  if (!gate) {
    document.head.append(Object.assign(document.createElement('style'), { textContent: GATE_STYLE }));
    gate = document.createElement('div');
    gate.id = 'lineLoginGate';
    const card = document.createElement('div');
    card.className = 'line-gate-card';
    const logo = document.createElement('div'); logo.className = 'line-gate-logo'; logo.textContent = 'LINE';
    const title = document.createElement('h2'); title.textContent = 'Weston Fit Quest';
    const message = document.createElement('p'); message.id = 'lineGateMessage'; message.setAttribute('role', 'status');
    const retry = document.createElement('button'); retry.id = 'lineGateRetry'; retry.type = 'button';
    retry.className = 'line-gate-retry'; retry.textContent = 'ลองใหม่'; retry.hidden = true;
    retry.addEventListener('click', () => { if (state.status !== 'linked') startLineLink(); });
    card.append(logo, title, message, retry);
    gate.append(card);
    document.body.append(gate);
  }
  return gate;
}
function renderGate(current) {
  const gate = ensureGate();
  const message = document.getElementById('lineGateMessage');
  const retry = document.getElementById('lineGateRetry');
  if (current.status === 'linked') { gate.hidden = true; return; }
  gate.hidden = false;
  if (current.status === 'resolving') { message.textContent = 'กำลังตรวจสอบการเข้าสู่ระบบผ่าน LINE…'; retry.hidden = true; }
  else if (current.status === 'login-redirect') { message.textContent = 'กำลังพาไปเข้าสู่ระบบ LINE แล้วจะกลับมาที่เกมเอง\nหากไม่ได้กลับมาเอง กดลองใหม่'; retry.hidden = false; }
  else if (current.status === 'unlinked') { message.textContent = `บัญชี LINE นี้${current.lineDisplayName ? ` (${current.lineDisplayName})` : ''} ยังไม่ได้ลงทะเบียนกับข้อมูลพนักงาน\nกรุณาติดต่อ HR เพื่อลิงก์บัญชีก่อนเข้าเล่นเกม`; retry.hidden = true; }
  else if (current.status === 'native-blocked') { message.textContent = current.detail; retry.hidden = true; }
  else { message.textContent = current.detail || 'เกิดข้อผิดพลาดในการเชื่อมต่อ LINE กดลองใหม่อีกครั้ง'; retry.hidden = false; }
}

startLineLink();
window.addEventListener('online', () => { if (state.status !== 'linked') startLineLink(); });
