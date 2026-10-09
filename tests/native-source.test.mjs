import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'java-parser';

// Syntax parsing only. This does NOT typecheck Android APIs or compile an APK.
for (const file of ['RunJournal', 'RunningService', 'WestonRunningPlugin', 'TreadmillJournal', 'TreadmillService']) {
  test(`Android ${file}.java parses as a Java compilation unit (not an Android build)`, async () => {
    const source = await readFile(new URL(`../mobile/plugins/weston-running/android/src/main/java/com/weston/running/${file}.java`, import.meta.url), 'utf8');
    assert.equal(parse(source).name, 'compilationUnit');
  });
}
