import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyReveals } from '../webgame/js/journey-reveals.js';

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test('existing destinations establish a baseline; new discoveries queue once and survive reload', () => {
  const storage = memory();
  let queue = createJourneyReveals(storage);
  queue.observe('a', 1);
  assert.equal(queue.next(1), null);
  queue.observe('a', 3);
  assert.equal(queue.next(3), 2);
  queue = createJourneyReveals(storage);
  queue.observe('a', 3);
  assert.equal(queue.next(3), 2);
  queue.acknowledge(3); // Cannot accidentally skip an unseen discovery.
  assert.equal(queue.next(3), 2);
  queue.acknowledge(2);
  assert.equal(queue.next(3), 3);
  queue.acknowledge(3);
  queue.observe('a', 3);
  assert.equal(queue.next(3), null);
});

test('player changes, score corrections and invalid storage do not expose another player’s discoveries', () => {
  const storage = memory(), queue = createJourneyReveals(storage);
  queue.observe('a', 0);
  queue.observe('a', 2);
  queue.observe('b', 0);
  assert.equal(queue.next(0), null);
  queue.observe('a', 0);
  assert.equal(queue.next(0), null);
  queue.observe('a', 2);
  assert.equal(queue.next(2), 1);
  queue.observe(null, 0);
  assert.equal(queue.next(5), null);
  storage.setItem('weston-journey-reveals-v1:c', '{broken');
  queue.observe('c', 2);
  assert.equal(queue.next(2), null);
  const unavailable = createJourneyReveals({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  unavailable.observe('a', 0);
  unavailable.observe('a', 1);
  assert.equal(unavailable.next(1), 1);
});
