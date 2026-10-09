import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID, webcrypto } from 'node:crypto';
import { bangkokDay } from '../webgame/js/progress.js';
const source = await readFile(new URL('../webgame/js/data.js', import.meta.url), 'utf8');
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function database() {
  const db = { rows: new Map(), runRows: new Map(), loseResponse: false, loseRunResponse: false, disabledAuth: false, clients: 0 };
  db.createClient = () => {
    db.clients++;
    return {
      auth: {
        getSession: async () => ({ data: { session: db.disabledAuth ? null : { user: { id: 'player-a' } } } }),
        signInAnonymously: async () => ({ error: { message: 'Anonymous sign-ins are disabled' } }),
      },
      from(table) {
        let ids, single = false, rowId, owner;
        const query = {
          select() { return query; }, eq(column, value) { if (column === 'id') rowId = value; if (column === 'user_id') owner = value; return query; }, order() { return query; }, limit() { return query; },
          in(_, value) { ids = value; return query; },
          maybeSingle() { single = true; return query; }, single() { single = true; return query; },
          async upsert(batch) {
            if (table === 'weston_runs') {
              if (!db.runRows.has(batch.id)) db.runRows.set(batch.id, batch);
              if (db.loseRunResponse) { db.loseRunResponse = false; return { error: { message: 'Network timeout after commit' } }; }
              return { error: null };
            }
            for (const row of batch) db.rows.set(row.id, row);
            if (db.loseResponse) { db.loseResponse = false; return { error: { message: 'Network timeout after commit' } }; }
            return { error: null };
          },
          then(resolve, reject) {
            let data;
            if (table === 'weston_progress') data = db.rows.size ? { total_workouts: db.rows.size } : null;
            else if (table === 'weston_days') {
              const counts = {};
              for (const row of db.rows.values()) counts[row.played_on] = (counts[row.played_on] || 0) + 1;
              data = Object.entries(counts).map(([played_on, workouts]) => ({ played_on, workouts }));
            } else if (table === 'weston_workouts') data = [...db.rows.keys()].filter(id => ids?.includes(id)).map(id => ({ id }));
            else if (table === 'weston_runs') {
              const rows = [...db.runRows.values()].filter(r => !owner || r.user_id === owner).filter(r => !rowId || r.id === rowId);
              data = single ? rows[0] : rows;
            } else data = [];
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
  };
  return db;
}
async function load(store, db, secure = true) {
  const context = vm.createContext({ localStorage: store, Intl, Date, Math, Number, Set, Map, JSON, Promise,
    setTimeout, clearTimeout, AbortSignal, fetch: () => {}, crypto: { randomUUID: secure ? randomUUID : undefined, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, Uint8Array,
    navigator: { onLine: true }, window: { addEventListener() {} }, document: { hidden: false, addEventListener() {} },
  });
  const module = new vm.SourceTextModule(source, { context,
    importModuleDynamically: async () => {
      const sdk = new vm.SyntheticModule(['createClient'], function () { this.setExport('createClient', db.createClient); }, { context });
      await sdk.link(() => {}); await sdk.evaluate(); return sdk;
    },
  });
  await module.link(async specifier => {
    const values = specifier === './config.js' ? { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-public-key' } : { bangkokDay };
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context });
  });
  await module.evaluate(); return module.namespace;
}
test('local queue survives reload while anonymous sign-in is disabled', async () => {
  const store = storage(), db = database(); db.disabledAuth = true;
  const game = await load(store, db); await game.connect(); game.recordWorkout(); game.recordWorkout();
  const restored = await load(store, db); await restored.connect();
  assert.equal(restored.snapshot().total, 2); assert.equal(restored.snapshot().pending.length, 2);
  assert.equal(restored.snapshot().state, 'setup'); assert.equal(db.rows.size, 0);
});
test('uncertain committed write reconciles UUID on reload without double counting', async () => {
  const store = storage(), db = database(), game = await load(store, db);
  await game.connect(); db.loseResponse = true; game.recordWorkout(); await game.sync();
  assert.equal(db.rows.size, 1); assert.equal(game.snapshot().pending.length, 1);
  const restored = await load(store, db); await restored.connect();
  assert.equal(db.rows.size, 1); assert.equal(restored.snapshot().total, 1);
  assert.equal(restored.snapshot().pending.length, 0); assert.equal(restored.snapshot().state, 'saved');
});
test('two local tabs merge activity before writing shared storage', async () => {
  const store = storage(), db = database(), first = await load(store, db), second = await load(store, db);
  first.recordWorkout(); second.recordWorkout(); first.recordWorkout();
  const persisted = JSON.parse(store.getItem('weston-progress-v1'));
  assert.equal(persisted.pending.length, 3); assert.equal(new Set(persisted.pending.map(row => row.id)).size, 3);
});
test('leaderboard and session connection share one Supabase client', async () => {
  const db = database(), game = await load(storage(), db);
  await Promise.all([game.connect(), game.leaderboard()]);
  assert.equal(db.clients, 1);
});
test('mobile LAN HTTP creates valid event IDs without crypto.randomUUID', async () => {
  const game = await load(storage(), database(), false); game.recordWorkout();
  assert.match(game.snapshot().pending[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

const privateRun = () => ({ id: 'run-id', owner: null, share: true, run: { id: 'run-id', status: 'finished',
  started_at: '2026-10-08T01:00:00Z', ended_at: '2026-10-08T01:01:00Z', elapsed_ms: 60000,
  distance_m: 120, points: [{ lat: 0, lng: 0 }], splits: [] } });
test('GPS backup requires explicit consent and completion before even opening a network client', async () => {
  const db = database(), game = await load(storage(), db), record = privateRun();
  record.share = false; await assert.rejects(game.saveRunToCloud(record));
  record.share = true; record.run.status = 'running'; await assert.rejects(game.saveRunToCloud(record));
  assert.equal(db.clients, 0); assert.equal(db.runRows.size, 0);
});
test('private GPS backup is idempotent after an uncertain commit and does not alter game totals', async () => {
  const db = database(), game = await load(storage(), db), record = privateRun();
  record.owner = 'player-a'; db.loseRunResponse = true;
  await assert.rejects(game.saveRunToCloud(record)); assert.equal(db.runRows.size, 1);
  assert.equal(await game.saveRunToCloud(record), 'player-a'); assert.equal(db.runRows.size, 1);
  assert.equal(db.rows.size, 0); assert.equal(game.snapshot().total, 0);
  const history = await game.loadRunsFromCloud(); assert.equal(history.rows.length, 1); assert.equal(history.owner, 'player-a');
});
test('GPS routes bound to a different account are never written under a new session', async () => {
  const db = database(), game = await load(storage(), db), record = privateRun(); record.owner = 'player-b';
  await assert.rejects(game.saveRunToCloud(record), /another account/); assert.equal(db.runRows.size, 0);
});

test('game connection and running queue share one initial anonymous sign-in', async () => {
  const db = database(), original = db.createClient; let signins = 0;
  db.createClient = () => {
    const client = original();
    client.auth.getSession = async () => ({ data: { session: null } });
    client.auth.signInAnonymously = async () => { signins++; return { data: { session: { user: { id: 'player-a' } } } }; };
    return client;
  };
  const game = await load(storage(), db);
  const sessions = await Promise.all([game.playerSession(), game.playerSession(), game.playerSession()]);
  assert.equal(signins, 1); assert.equal(db.clients, 1);
  assert.ok(sessions.every(session => session === sessions[0] && session.userId === 'player-a'));
});
