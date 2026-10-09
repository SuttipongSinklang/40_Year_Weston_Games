import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createLiveRunning } from '../webgame/js/run-live.js';
const T = Date.parse('2026-10-08T13:00:00Z');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const point = timestamp => ({ lat: 13, lng: 100, accuracy: 5, timestamp });
const snapshot = (timestamp, mode = 'running') => ({ mode, run: { points: [point(timestamp)] } });
const row = (id = 'friend', expires = T + 60000) => ({ user_id: id, display_name: 'นักวิ่ง A',
  lat: 13, lng: 100, updated_at: new Date(T).toISOString(), expires_at: new Date(expires).toISOString() });
function fixture(overrides = {}) {
  let time = T, state, tick, event, status;
  const calls = [];
  const data = { async connect() { calls.push('connect'); return 'self'; },
    watch(e, s) { event = e; status = s; s('SUBSCRIBED'); },
    async list() { calls.push('list'); return []; },
    async put(p) { calls.push(['put', p]); }, async remove() { calls.push('remove'); },
    async close() { calls.push('close'); }, ...overrides };
  const live = createLiveRunning({ data, onChange: value => { state = value; }, now: () => time,
    setIntervalFn: fn => { tick = fn; return 1; }, clearIntervalFn() { tick = undefined; } });
  return { live, calls, get state() { return state; }, event: e => event(e), status: s => status(s),
    async advance(ms) { time += ms; tick?.(); await flush(); } };
}
test('no network without consent; viewing never publishes or starts GPS', async () => {
  const f = fixture(); f.live.update(snapshot(T)); await flush(); assert.deepEqual(f.calls, []);
  await f.live.setViewing(true); await flush(); assert.ok(f.calls.includes('list'));
  assert.equal(f.state.connected, true); assert.equal(f.calls.filter(Array.isArray).length, 0);
  await f.live.dispose();
});
test('publishes latest point only, throttles five seconds and rejects stale samples', async () => {
  const f = fixture(); f.live.update(snapshot(T)); await f.live.setSharing(true); await flush();
  assert.equal(f.calls.filter(Array.isArray).length, 1);
  await f.advance(1000); f.live.update(snapshot(T + 1000)); await flush();
  assert.equal(f.calls.filter(Array.isArray).length, 1);
  await f.advance(4000); await flush(); assert.equal(f.calls.filter(Array.isArray).length, 2);
  await f.advance(20000); f.live.update(snapshot(T)); await flush();
  assert.equal(f.calls.filter(Array.isArray).length, 2);
  await f.live.dispose();
});
test('pause and hidden app withdraw and never upload buffered old fixes on return', async () => {
  const f = fixture(); f.live.update(snapshot(T)); await f.live.setSharing(true); await flush();
  f.live.update(snapshot(T, 'paused')); await flush(); assert.ok(f.calls.includes('remove'));
  await f.advance(5000); f.live.update(snapshot(T + 5000)); await flush();
  f.live.setVisible(false); await flush(); assert.equal(f.calls.filter(x => x === 'remove').length, 2);
  await f.advance(60000); f.live.setVisible(true); await flush();
  assert.equal(f.calls.filter(Array.isArray).length, 2); await f.live.dispose();
});
test('switching sharing off deletes after an in-flight publish, preventing resurrection', async () => {
  const pending = deferred();
  const f = fixture({ async put() { f.calls.push('put-start'); await pending.promise; f.calls.push('put-end'); } });
  f.live.update(snapshot(T)); await f.live.setSharing(true); await flush();
  const stopping = f.live.setSharing(false); await flush(); assert.equal(f.calls.includes('remove'), false);
  pending.resolve(); await stopping; await flush();
  assert.ok(f.calls.indexOf('remove') > f.calls.indexOf('put-end')); assert.equal(f.state.sharing, false);
});
test('expired markers disappear and DELETE removes by owner primary key', async () => {
  const f = fixture(); await f.live.setViewing(true); await flush();
  f.event({ eventType: 'INSERT', new: row() }); assert.equal(f.state.people.length, 1);
  f.event({ eventType: 'DELETE', old: { user_id: 'friend' } }); assert.equal(f.state.people.length, 0);
  f.event({ eventType: 'INSERT', new: row('other', T + 5000) });
  await f.advance(5000); assert.equal(f.state.people.length, 0); await f.live.dispose();
});
test('late list responses cannot repopulate the map after viewing is disabled', async () => {
  const pending = deferred(); const f = fixture({ list: () => pending.promise });
  await f.live.setViewing(true); await flush(); await f.live.setViewing(false);
  pending.resolve([row()]); await flush(); assert.equal(f.state.people.length, 0); assert.equal(f.state.viewing, false);
});
test('snapshot cannot resurrect a position deleted while the request was in flight', async () => {
  const pending = deferred(); let reads = 0;
  const f = fixture({ list: () => ++reads === 1 ? pending.promise : Promise.resolve([]) });
  await f.live.setViewing(true); await flush();
  f.event({ eventType: 'DELETE', old: { user_id: 'friend' } }); pending.resolve([row()]); await flush();
  assert.equal(f.state.people.length, 0); await f.live.dispose();
});
test('connection error clears markers and both consents; no automatic retry', async () => {
  const f = fixture(); await f.live.setViewing(true); await f.live.setSharing(true); await flush();
  f.event({ eventType: 'INSERT', new: row() }); f.status('CHANNEL_ERROR'); await flush();
  assert.equal(f.state.viewing, false); assert.equal(f.state.sharing, false); assert.equal(f.state.connected, false);
  assert.equal(f.state.people.length, 0); await f.advance(30000);
  assert.equal(f.calls.filter(x => x === 'connect').length, 1);
});
test('failed withdrawal preserves an honest expiry warning after switching sharing off', async () => {
  const f = fixture({ remove: async () => { throw new Error('Offline'); } });
  f.live.update(snapshot(T)); await f.live.setSharing(true); await flush();
  await f.live.setSharing(false); await flush();
  assert.equal(f.state.sharing, false); assert.match(f.state.message, /ถอนจุดออนไลน์ไม่สำเร็จ/);
  assert.match(f.state.message, /60/);
});
test('anonymous auth failure is shown honestly and leaves local running independent', async () => {
  const f = fixture({ connect: async () => { throw new Error('Anonymous sign-ins disabled'); } });
  await f.live.setViewing(true); await flush(); assert.match(f.state.message, /Anonymous Sign-Ins/);
  assert.equal(f.state.viewing, false); assert.equal(f.state.connected, false);
});
test('disable then re-enable during pending auth closes old session before opening a new one', async () => {
  const pending = deferred(); let count = 0;
  const f = fixture({ async connect() { f.calls.push(`connect-${++count}`); if (count === 1) await pending.promise; } });
  const start = f.live.setViewing(true); await flush();
  const stop = f.live.setViewing(false); const restart = f.live.setViewing(true); await flush();
  assert.equal(count, 1); pending.resolve(); await Promise.all([start, stop, restart]); await flush();
  assert.equal(count, 2); assert.equal(f.state.viewing, true); assert.equal(f.state.connected, true);
  assert.ok(f.calls.indexOf('close') < f.calls.indexOf('connect-2')); await f.live.dispose();
});

test('data adapter writes bound owner/latest point only and rejects account changes', async () => {
  const source = await readFile(new URL('../webgame/js/run-live-data.js', import.meta.url), 'utf8');
  const context = vm.createContext({ Date, crypto: { randomUUID: () => 'channel-id' }, queueMicrotask });
  const module = new vm.SourceTextModule(source, { context });
  const stub = new vm.SyntheticModule(['playerSession'], function() { this.setExport('playerSession', () => { throw new Error('No default network'); }); }, { context });
  await module.link(() => stub); await module.evaluate();
  let uid = 'self', written;
  const api = { auth: { getSession: async () => ({ data: { session: { user: { id: uid } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from(table) { assert.equal(table, 'weston_live_runners'); return { async upsert(value) { written = value; return {}; } }; } };
  const data = module.namespace.createLiveData(async () => api);
  await data.connect(); await data.put({ ...point(T), route: ['private'], user_id: 'someone-else' });
  assert.equal(written.user_id, 'self'); assert.equal('route' in written, false); assert.equal('display_name' in written, false);
  uid = 'other'; await assert.rejects(data.put(point(T)), /Account changed/); await data.close();
});
