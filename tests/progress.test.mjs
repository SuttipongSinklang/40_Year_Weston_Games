import test from 'node:test';
import assert from 'node:assert/strict';
import { bangkokDay, progressFor, streakFor } from '../webgame/js/progress.js';
test('mission completion actually awards bonus and derives subsequent level', () => {
  assert.deepEqual(progressFor(0), { taps: 0, score: 0, level: 1, xp: 0, missionDone: 0, missionIndex: 0, coins: 0 });
  assert.equal(progressFor(4).score, 24);
  assert.deepEqual(progressFor(5), { taps: 5, score: 130, level: 2, xp: 30, missionDone: 0, missionIndex: 1, coins: 25 });
  assert.equal(progressFor(10).score, 260);
});
test('Bangkok date changes at 17:00 UTC rather than host timezone midnight', () => {
  assert.equal(bangkokDay(new Date('2026-10-08T16:59:59Z')), '2026-10-08');
  assert.equal(bangkokDay(new Date('2026-10-08T17:00:00Z')), '2026-10-09');
});
test('streak preserves yesterday and crosses month/year boundaries', () => {
  assert.equal(streakFor(['2025-12-30', '2025-12-31'], '2026-01-01'), 2);
  assert.equal(streakFor(['2026-01-01', '2025-12-31', '2025-12-29'], '2026-01-01'), 2);
  assert.equal(streakFor(['2025-12-29'], '2026-01-01'), 0);
});
