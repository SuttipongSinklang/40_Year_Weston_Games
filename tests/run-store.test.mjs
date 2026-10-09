import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLease, saveDraft, loadDraft, finishDraft, saveRecord, getRecord, listRecords } from '../webgame/js/run-store.js';

test('concurrent tabs can acquire only one recording lease; non-owner cannot overwrite the draft', async () => {
  const results = await Promise.all([runLease('tab-a'), runLease('tab-b')]);
  assert.deepEqual(results, [true, false]);
  await saveDraft({ id: 'draft-a', status: 'paused' }, 'tab-a');
  await assert.rejects(saveDraft({ id: 'draft-b' }, 'tab-b'));
  assert.equal((await loadDraft()).id, 'draft-a');
  await runLease('tab-a', 'release');
});
test('finishing stores history and removes the draft atomically; wrong-owner finish changes neither', async () => {
  await runLease('tab-finish');
  await saveDraft({ id: 'run-finish', status: 'paused' }, 'tab-finish');
  const record = { id: 'run-finish', run: { id: 'run-finish', started_at: '2026-10-08T01:00:00Z' }, cloud_state: 'local' };
  await assert.rejects(finishDraft(record, 'other-tab'));
  assert.equal((await loadDraft()).id, 'run-finish'); assert.equal(await getRecord(record.id), undefined);
  await finishDraft(record, 'tab-finish');
  assert.equal(await loadDraft(), undefined); assert.equal((await getRecord(record.id)).cloud_state, 'local');
  record.cloud_state = 'saved'; await saveRecord(record);
  assert.equal((await listRecords()).filter(r => r.id === record.id).length, 1);
});
test('an expired lease can be recovered, but the old tab cannot write after takeover', async () => {
  const realNow = Date.now; let clock = 100000; Date.now = () => clock;
  try {
    assert.equal(await runLease('old-tab'), true); clock += 16000;
    assert.equal(await runLease('new-tab'), true);
    await assert.rejects(saveDraft({ id: 'stale' }, 'old-tab'));
    assert.equal(await runLease('old-tab', 'renew'), false);
    await runLease('new-tab', 'release');
  } finally { Date.now = realNow; }
});
test('history reads the 50 newest runs in descending date order', async () => {
  await Promise.all(Array.from({ length: 51 }, (_, i) => saveRecord({ id: `ordered-${i}`,
    run: { started_at: new Date(Date.UTC(2030, 0, 1, 0, i)).toISOString() }, cloud_state: 'local' })));
  const records = await listRecords(); assert.equal(records.length, 50);
  assert.equal(records[0].id, 'ordered-50'); assert.equal(records.at(-1).id, 'ordered-1');
});
