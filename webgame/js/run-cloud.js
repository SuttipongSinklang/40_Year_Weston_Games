// Durable online backup queue for finished runs: local-first, owner-bound before any network call, retried safely across reloads and tabs.
import { saveRecord, listPendingRecords, claimRunForSync } from './run-store.js';
import { playerSession, saveRunToCloud } from './data.js?v=20261009-6';

const defaultStore = { save: saveRecord, listPending: listPendingRecords, claim: claimRunForSync };

export function createRunSync({ store = defaultStore, getSession = playerSession, saveRemote = saveRunToCloud, onChange = () => {} } = {}) {
  let flushing = null;

  // Only newly finished runs pass through here; pre-existing local history stays private until enqueued.
  async function enqueue(record) {
    if (!record?.run || record.run.status !== 'finished' || record.id !== record.run.id)
      throw new Error('Only finished runs can be saved online');
    record.share = true;
    record.cloud_state = 'pending';
    await store.save(record);
    onChange({ id: record.id, cloud_state: 'pending', message: 'Run queued for online backup' });
    return record;
  }

  async function upload(record, user) {
    // Bind the owner durably before the remote call: a commit whose response is lost must never be re-attributed.
    const bound = await store.claim(record.id, user);
    if (!bound || bound.cloud_state !== 'pending' || !bound.share || bound.run?.status !== 'finished') return { skipped: 1 };
    if (bound.owner !== user) {
      onChange({ id: bound.id, cloud_state: 'pending', message: 'Run belongs to another account; left untouched' });
      return { skipped: 1 };
    }
    await saveRemote(bound);
    await store.save({ ...bound, cloud_state: 'saved' });
    onChange({ id: bound.id, cloud_state: 'saved', message: 'Run backed up online' });
    return { saved: 1 };
  }

  async function runFlush() {
    const pending = await store.listPending();
    if (!pending.length) return { pending: 0, saved: 0, skipped: 0, failed: 0 };
    let user = null;
    try {
      user = (await getSession())?.userId ?? null;
    } catch (error) {
      onChange({ id: null, cloud_state: 'pending', message: `Sign-in unavailable; ${pending.length} run(s) stay queued: ${error.message}` });
      return { pending: pending.length, saved: 0, skipped: 0, failed: pending.length };
    }
    if (!user) {
      onChange({ id: null, cloud_state: 'pending', message: `No account session; ${pending.length} run(s) stay queued` });
      return { pending: pending.length, saved: 0, skipped: 0, failed: pending.length };
    }
    const totals = { pending: pending.length, saved: 0, skipped: 0, failed: 0 };
    for (const record of pending) {
      try {
        const outcome = await upload(record, user);
        totals.saved += outcome.saved || 0;
        totals.skipped += outcome.skipped || 0;
      } catch (error) {
        // Keep the run pending with its route and events; the next flush retries with the same id.
        totals.failed += 1;
        onChange({ id: record.id, cloud_state: 'pending', message: `Upload failed; retry kept: ${error.message}` });
      }
    }
    return totals;
  }

  function flush() {
    if (flushing) return flushing;
    flushing = runFlush().finally(() => { flushing = null; });
    return flushing;
  }

  return { enqueue, flush };
}
