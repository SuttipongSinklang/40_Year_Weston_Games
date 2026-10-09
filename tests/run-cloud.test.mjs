import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// data.js (the default session/upload wiring) touches window/document at module scope; keep it inert, never live.
globalThis.window = { addEventListener() {} };
globalThis.document = { hidden: false, addEventListener() {} };
const { createRunSync } = await import('../webgame/js/run-cloud.js');
const runStore = await import('../webgame/js/run-store.js');

async function clearRuns() {
  await runStore.listPendingRecords(); // Create the production schema before opening a raw cleanup connection.
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('weston-running-v1', 1);
    open.onupgradeneeded = () => { // same schema as run-store.js, in case this opens the database first
      const db = open.result;
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' }).createIndex('started', 'run.started_at');
      if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft');
    };
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('runs', 'readwrite');
      tx.objectStore('runs').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
}

const finishedRun = (id, extra = {}) => ({ id, owner: null, share: false, cloud_state: 'local',
  run: { id, status: 'finished', activity: 'outdoor', started_at: '2026-10-09T01:00:00Z', ended_at: '2026-10-09T01:10:00Z',
    elapsed_ms: 600000, distance_m: 1200, points: [{ lat: 13.7, lng: 100.5, accuracy: 5, timestamp: 1, segment: 0, active_ms: 0, distance_m: 0 }],
    splits: [{ km: 1, duration_ms: 300000, pace_sec: 300 }],
    events: [{ type: 'pause', index: 1, at: 1, lat: 13.7, lng: 100.5, fix_at: 1 }] }, ...extra });

const session = userId => async () => ({ userId });
function remote() {
  const state = { rows: new Map(), calls: [], failAll: false, failNext: 0 };
  state.saveRemote = async record => {
    state.calls.push(record);
    if (state.failAll) throw new Error('Network unreachable');
    state.rows.set(record.run.id, { id: record.run.id, user_id: record.owner });
    if (state.failNext > 0) { state.failNext -= 1; throw new Error('Network timeout after commit'); }
    return record.owner;
  };
  return state;
}

test('enqueue marks a new finished run shared and pending, retaining its owner, without uploading', async () => {
  await clearRuns();
  const cloud = remote(), events = [];
  const sync = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote, onChange: e => events.push(e) });
  const record = finishedRun('cloud-enqueue', { owner: 'player-a' });
  await sync.enqueue(record);
  assert.equal(record.share, true); assert.equal(record.cloud_state, 'pending');
  const stored = await runStore.getRecord('cloud-enqueue');
  assert.equal(stored.share, true); assert.equal(stored.cloud_state, 'pending'); assert.equal(stored.owner, 'player-a');
  assert.equal(stored.run.points.length, 1); assert.equal(stored.run.splits.length, 1);
  assert.equal(cloud.calls.length, 0);
  assert.deepEqual(Object.keys(events[0]).sort(), ['cloud_state', 'id', 'message']);
  assert.equal(events[0].id, 'cloud-enqueue'); assert.equal(events[0].cloud_state, 'pending');
});

test('pre-existing local private history is never queued or uploaded', async () => {
  await clearRuns();
  await runStore.saveRecord(finishedRun('cloud-legacy'));
  const cloud = remote();
  const sync = createRunSync({ getSession: () => { throw new Error('should not sign in'); }, saveRemote: cloud.saveRemote });
  const outcome = await sync.flush();
  assert.deepEqual(outcome, { pending: 0, saved: 0, skipped: 0, failed: 0 });
  assert.equal(cloud.calls.length, 0);
  const stored = await runStore.getRecord('cloud-legacy');
  assert.equal(stored.cloud_state, 'local'); assert.equal(stored.share, false);
});

test('offline failure keeps the run pending with owner bound and route bytes intact', async () => {
  await clearRuns();
  const cloud = remote(); cloud.failAll = true;
  const events = [];
  const sync = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote, onChange: e => events.push(e) });
  await sync.enqueue(finishedRun('cloud-offline'));
  const outcome = await sync.flush();
  assert.deepEqual(outcome, { pending: 1, saved: 0, skipped: 0, failed: 1 });
  const stored = await runStore.getRecord('cloud-offline');
  assert.equal(stored.cloud_state, 'pending'); assert.equal(stored.owner, 'player-a');
  assert.equal(stored.run.points.length, 1); assert.equal(stored.run.splits.length, 1);
  assert.equal(events.at(-1).id, 'cloud-offline'); assert.equal(events.at(-1).cloud_state, 'pending');
  assert.deepEqual(stored.run.events, finishedRun('cloud-offline').run.events);
  assert.match(events.at(-1).message, /Network unreachable/);
});

test('sign-in failure reaches no network boundary and the queue stays durable', async () => {
  await clearRuns();
  const cloud = remote();
  const sync = createRunSync({ getSession: async () => { throw new Error('Anonymous sign-ins are disabled'); }, saveRemote: cloud.saveRemote });
  await sync.enqueue(finishedRun('cloud-auth'));
  const outcome = await sync.flush();
  assert.deepEqual(outcome, { pending: 1, saved: 0, skipped: 0, failed: 1 });
  assert.equal(cloud.calls.length, 0);
  assert.equal((await runStore.getRecord('cloud-auth')).cloud_state, 'pending');
});

test('concurrent flushes on one instance join the same upload attempt', async () => {
  await clearRuns();
  const cloud = remote();
  const sync = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote });
  await sync.enqueue(finishedRun('cloud-dup'));
  const [first, second] = await Promise.all([sync.flush(), sync.flush()]);
  assert.deepEqual(first, second);
  assert.equal(cloud.calls.length, 1);
  assert.equal((await runStore.getRecord('cloud-dup')).cloud_state, 'saved');
});

test('an uncertain commit is retried with the same run id and stays idempotent', async () => {
  await clearRuns();
  const cloud = remote(); cloud.failNext = 1;
  const sync = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote });
  await sync.enqueue(finishedRun('cloud-uncertain'));
  const failed = await sync.flush();
  assert.equal(failed.failed, 1);
  assert.equal(cloud.rows.size, 1); // the row committed even though its response was lost
  assert.equal((await runStore.getRecord('cloud-uncertain')).cloud_state, 'pending');
  const retried = await sync.flush();
  assert.deepEqual(retried, { pending: 1, saved: 1, skipped: 0, failed: 0 });
  assert.deepEqual(cloud.calls.map(record => record.run.id), ['cloud-uncertain', 'cloud-uncertain']);
  assert.equal(cloud.rows.size, 1); // same UUID upserted, never duplicated
  assert.equal(cloud.rows.get('cloud-uncertain').user_id, 'player-a');
  assert.equal((await runStore.getRecord('cloud-uncertain')).cloud_state, 'saved');
});

test('a reload finishes uploading runs that stayed pending', async () => {
  await clearRuns();
  const cloud = remote(); cloud.failAll = true;
  const before = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote });
  await before.enqueue(finishedRun('cloud-reload'));
  await before.flush(); // offline when the page closed
  cloud.failAll = false;
  const reloaded = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote });
  const outcome = await reloaded.flush();
  assert.deepEqual(outcome, { pending: 1, saved: 1, skipped: 0, failed: 0 });
  assert.equal((await runStore.getRecord('cloud-reload')).cloud_state, 'saved');
  assert.equal(cloud.rows.get('cloud-reload').user_id, 'player-a');
});

test('a run owned by another account is never submitted, rebound, or marked saved', async () => {
  await clearRuns();
  const cloud = remote();
  const sync = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote });
  await sync.enqueue(finishedRun('cloud-foreign', { owner: 'player-b' }));
  const outcome = await sync.flush();
  assert.deepEqual(outcome, { pending: 1, saved: 0, skipped: 1, failed: 0 });
  assert.equal(cloud.calls.length, 0); assert.equal(cloud.rows.size, 0);
  const stored = await runStore.getRecord('cloud-foreign');
  assert.equal(stored.owner, 'player-b'); assert.equal(stored.cloud_state, 'pending');
});

test('every pending run beyond the 50-newest history window is still found and uploaded', async () => {
  await clearRuns();
  const cloud = remote();
  const sync = createRunSync({ getSession: session('player-a'), saveRemote: cloud.saveRemote });
  for (let index = 0; index < 55; index += 1) await sync.enqueue(finishedRun(`cloud-bulk-${index}`));
  assert.equal((await runStore.listRecords()).length, 50); // history view stays capped
  const outcome = await sync.flush();
  assert.deepEqual(outcome, { pending: 55, saved: 55, skipped: 0, failed: 0 });
  assert.equal(cloud.rows.size, 55);
  assert.equal((await runStore.listPendingRecords()).length, 0);
});

test('the atomic claim binds the first account and never rebinds a later one', async () => {
  await clearRuns();
  await runStore.saveRecord(finishedRun('cloud-claim'));
  assert.equal((await runStore.claimRunForSync('cloud-claim', 'player-a')).owner, 'player-a');
  assert.equal((await runStore.claimRunForSync('cloud-claim', 'player-b')).owner, 'player-a');
  assert.equal((await runStore.getRecord('cloud-claim')).owner, 'player-a');
  await runStore.saveRecord(finishedRun('cloud-claim-race'));
  const raced = await Promise.all([
    runStore.claimRunForSync('cloud-claim-race', 'player-a'),
    runStore.claimRunForSync('cloud-claim-race', 'player-b'),
  ]);
  assert.equal(raced[0].owner, raced[1].owner); // concurrent tabs see one winner, not a rebind
  assert.equal((await runStore.getRecord('cloud-claim-race')).owner, raced[0].owner);
});
