import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../webgame/js/line-link.js', import.meta.url), 'utf8');

const LINKED_UID = 'U426352b3445a95db94af322434c28c8c';
const EMPLOYEE = { employee_code: '152022', first_name_th: 'อาจารี', last_name_th: 'นะมูลพันธุ์', first_name_en: 'AJAREE', last_name_en: 'NAMULPHAN' };
const LINKED_ROW = { line_user_id: LINKED_UID, display_name: 'P.', linked_at: '2026-09-25T07:33:01.633903+00:00', employees: EMPLOYEE };

function storage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
let lastDoc;
async function load({ store, fetch: fetchMock, search = '', hash = '', liffId = '2011737916-P2L6GQD6', liff = null, sdk = null, sdkFail = false, native = false, localhost = false }) {
  const windowStub = { addEventListener() {}, ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}) };
  const elements = new Map();
  const makeElement = tag => ({ tagName: tag, id: '', children: [], hidden: false, textContent: '', append(...kids) { this.children.push(...kids); }, addEventListener() {}, setAttribute() {} });
  const register = el => { for (const kid of el.children || []) { if (kid.id) elements.set(kid.id, kid); register(kid); } };
  const documentStub = {
    createElement: makeElement,
    getElementById: id => elements.get(id) ?? null,
    head: { append(el) {
      if (String(el.tagName).toUpperCase() !== 'SCRIPT') return;
      if (sdk) { sdk.count++; sdk.urls.push(String(el.src)); }
      if (sdkFail) { el.onerror?.(); return; }
      if (liff && String(el.src).includes('line-scdn.net')) { windowStub.liff = liff; el.onload?.(); }
    } },
    body: { append(el) { if (el.id) elements.set(el.id, el); register(el); } },
  };
  lastDoc = { elements };
  const context = vm.createContext({
    localStorage: store,
    location: localhost ? { protocol: 'http:', hostname: 'localhost', search, hash } : { protocol: 'https:', hostname: 'p.westonsupa.xyz', search, hash },
    navigator: { userAgent: 'Mozilla/5.0 Chrome/124.0' }, window: windowStub,
    history: { replaceState() {} }, URL,
    document: documentStub,
    fetch: fetchMock, AbortSignal: { timeout: () => undefined }, URLSearchParams, setTimeout, clearTimeout,
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async specifier => {
    assert.ok(specifier.startsWith('./config.js'), `unexpected import ${specifier}`);
    const values = { HR_SUPABASE_URL: 'https://hr.example.test', HR_SUPABASE_ANON_KEY: 'test-hr-key', LINE_LIFF_ID: liffId };
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context });
  });
  await module.evaluate();
  return module.namespace;
}
const gateEl = () => lastDoc.elements.get('lineLoginGate');
const gateMessage = () => lastDoc.elements.get('lineGateMessage')?.textContent ?? '';
function fetchReturning(rows) {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => rows };
  };
  fetchMock.calls = calls;
  return fetchMock;
}
const liffLoggedIn = userId => ({ init: async () => {}, isLoggedIn: () => true, getProfile: async () => ({ userId, displayName: 'P.', pictureUrl: 'https://profile.line-scdn.com/abcdef/main.png' }) });
const liffLoggedOut = () => { const mock = { init: async () => {}, isLoggedIn: () => false, loginCalled: false, login() { mock.loginCalled = true; } }; return mock; };

test('ล็อกอิน LINE แล้ว ลิงก์พนักงานสำเร็จ และประตูเปิดให้เล่นเกม', async () => {
  const store = storage(), fetchMock = fetchReturning([LINKED_ROW]), sdk = { count: 0, urls: [] };
  const link = await load({ store, fetch: fetchMock, liff: liffLoggedIn(LINKED_UID), sdk });
  await link.startLineLink();
  const state = link.lineLinkState();
  assert.equal(state.status, 'linked');
  assert.equal(state.lineUserId, LINKED_UID);
  assert.equal(state.employeeDisplayName, 'อาจารี นะมูลพันธุ์');
  assert.equal(state.employee.employee_code, '152022');
  assert.equal(state.linePictureUrl, 'https://profile.line-scdn.com/abcdef/main.png', 'ต้องส่งรูปโปรไฟล์ LINE ต่อให้ UI ใช้แสดง');
  assert.equal(sdk.count, 1, 'โหลด LIFF SDK หนึ่งครั้ง');
  assert.ok(sdk.urls[0].includes('/liff/edge/2/sdk.js'), `ต้องใช้ CDN ใหม่ /liff/edge/2/ (URL เก่า /x/liff/ ตายแล้ว): ${sdk.urls[0]}`);
  const { url, options } = fetchMock.calls[0];
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.startsWith('https://hr.example.test/rest/v1/employee_line_links?'), 'ต้องยิงที่ตาราง employee_line_links');
  assert.ok(decoded.includes(`line_user_id=eq.${LINKED_UID}`));
  assert.ok(decoded.includes('employees('), 'ต้อง join ข้อมูลพนักงานมาด้วย');
  assert.equal(options.headers.apikey, 'test-hr-key');
  assert.equal(gateEl().hidden, true, 'ประตูต้องซ่อนเมื่อยืนยันตัวตนผ่านแล้ว');
  const cached = JSON.parse(store.getItem('weston-line-link-v1'));
  assert.equal(cached.status, 'linked');
  assert.equal(cached.employee.employee_code, '152022');
});

test('ยังไม่ได้ล็อกอิน LINE ต้องถูกพาไปหน้าล็อกอิน (liff.login) และยังไม่ยิง HR', async () => {
  const store = storage(), fetchMock = fetchReturning([LINKED_ROW]), sdk = { count: 0, urls: [] }, out = liffLoggedOut();
  const link = await load({ store, fetch: fetchMock, liff: out, sdk });
  await link.startLineLink();
  assert.equal(out.loginCalled, true, 'ต้องเรียก liff.login()');
  assert.equal(link.lineLinkState().status, 'login-redirect');
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(gateEl().hidden, false, 'ประตูยังปิดอยู่');
});

test('ล็อกอินแล้วแต่ LINE ยังไม่ถูกลิงก์กับพนักงาน ประตูค้างพร้อมข้อความติดต่อ HR', async () => {
  const store = storage(), fetchMock = fetchReturning([]), sdk = { count: 0, urls: [] };
  const link = await load({ store, fetch: fetchMock, liff: liffLoggedIn(LINKED_UID), sdk });
  await link.startLineLink();
  const state = link.lineLinkState();
  assert.equal(state.status, 'unlinked');
  assert.equal(state.lineUserId, LINKED_UID);
  assert.equal(gateEl().hidden, false);
  assert.ok(gateMessage().includes('ติดต่อ HR'));
});

test('แอป APK (Capacitor) บล็อกไวเลย ไม่โหลด LIFF SDK', async () => {
  const store = storage(), fetchMock = fetchReturning([LINKED_ROW]), sdk = { count: 0, urls: [] };
  const link = await load({ store, fetch: fetchMock, liff: liffLoggedIn(LINKED_UID), sdk, native: true });
  await link.startLineLink();
  assert.equal(link.lineLinkState().status, 'native-blocked');
  assert.equal(sdk.count, 0);
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(gateEl().hidden, false);
});

test('LINE ส่ง error กลับมาตอน redirect ต้องไม่เด้งไปล็อกอินซ้ำ (กันวนลูป)', async () => {
  const store = storage(), fetchMock = fetchReturning([LINKED_ROW]), sdk = { count: 0, urls: [] }, out = liffLoggedOut();
  const link = await load({ store, fetch: fetchMock, liff: out, sdk, search: '?error=access_denied&error_description=User+denied' });
  await link.startLineLink();
  assert.equal(out.loginCalled, false, 'ห้ามเรียก liff.login() ซ้ำเมื่อ URL มี error');
  assert.equal(link.lineLinkState().status, 'offline');
  assert.ok(gateMessage().includes('User denied'));
});

test('โหลด LIFF SDK ไม่ได้ แจ้ง offline พร้อมปุ่มลองใหม่', async () => {
  const store = storage(), fetchMock = fetchReturning([LINKED_ROW]), sdk = { count: 0, urls: [] };
  const link = await load({ store, fetch: fetchMock, sdk, sdkFail: true }); // CDN ล้มเหลวทันที
  await link.startLineLink();
  assert.equal(link.lineLinkState().status, 'offline');
  assert.equal(gateEl().hidden, false);
  assert.ok(gateMessage().includes('ลองใหม่') || gateMessage().includes('LIFF'));
});

test('HR ล่มแต่เคยลิงก์แล้ว ประตูเปิดและแสดงข้อมูลจากในเครื่อง', async () => {
  const seed = { 'weston-line-link-v1': JSON.stringify({ status: 'linked', lineUserId: LINKED_UID, employee: EMPLOYEE, employeeDisplayName: 'อาจารี นะมูลพันธุ์' }) };
  const store = storage(seed), sdk = { count: 0, urls: [] };
  const fetchMock = async () => { throw new Error('network down'); };
  const link = await load({ store, fetch: fetchMock, liff: liffLoggedIn(LINKED_UID), sdk });
  await link.startLineLink();
  const state = link.lineLinkState();
  assert.equal(state.status, 'linked');
  assert.equal(state.offline, true);
  assert.equal(gateEl().hidden, true, 'เคยยืนยันผ่าน LINE แล้ว ประตูต้องเปิด');
});

test('โหมดพัฒนา localhost ข้ามประตู LINE โดยไม่โหลดอะไรเลย', async () => {
  const store = storage(), fetchMock = fetchReturning([LINKED_ROW]), sdk = { count: 0, urls: [] };
  const link = await load({ store, fetch: fetchMock, sdk, localhost: true });
  await link.startLineLink();
  const state = link.lineLinkState();
  assert.equal(state.status, 'linked');
  assert.equal(state.devBypass, true);
  assert.equal(sdk.count, 0);
  assert.equal(fetchMock.calls.length, 0);
  assert.equal(gateEl().hidden, true, 'ประตูต้องเปิดให้พัฒนาบน localhost');
});

test('HR ล่มและไม่มีข้อมูลในเครื่อง แจ้ง offline พร้อมลองใหม่เมื่อกด', async () => {
  const store = storage(), sdk = { count: 0, urls: [] };
  const fetchMock = async () => { throw new Error('network down'); };
  const link = await load({ store, fetch: fetchMock, liff: liffLoggedIn(LINKED_UID), sdk });
  await link.startLineLink();
  assert.equal(link.lineLinkState().status, 'offline');
  assert.equal(gateEl().hidden, false);
});
