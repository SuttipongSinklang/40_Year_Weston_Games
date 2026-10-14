import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyMotion } from '../webgame/js/journey-motion.js';

function clock() {
  let time = 0, id = 0;
  const frames = new Map(), draws = [];
  const motion = createJourneyMotion({
    draw: (position, state) => draws.push({ position, ...state }),
    now: () => time,
    requestFrame: fn => { frames.set(++id, fn); return id; },
    cancelFrame: id => frames.delete(id),
  });
  return { motion, frames, draws, advance(ms) {
    time += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  } };
}

test('first load restores the actual score immediately; later gains animate through intermediate route positions', () => {
  const { motion, draws, frames, advance } = clock();
  motion.moveTo(1.25);
  assert.equal(motion.position, 1.25);
  assert.equal(frames.size, 0);
  motion.moveTo(1.5);
  advance(225);
  assert.ok(motion.position > 1.25 && motion.position < 1.5);
  assert.equal(draws.at(-1).moving, true);
  advance(225);
  assert.equal(motion.position, 1.5);
  assert.equal(draws.at(-1).moving, false);
  assert.equal(frames.size, 0);
});

test('a large score increase traverses successive route segments and ends exactly at its destination', () => {
  const { motion, draws, advance } = clock();
  motion.moveTo(.25);
  motion.moveTo(4.75);
  for (let i = 0; i < 24; i++) advance(100);
  const moving = draws.filter(draw => draw.moving).map(draw => draw.position);
  assert.ok(moving.some(position => position > 1 && position < 2));
  assert.ok(moving.some(position => position > 2 && position < 3));
  assert.ok(moving.some(position => position > 3 && position < 4));
  assert.ok(moving.every((position, index) => !index || position >= moving[index - 1]));
  assert.equal(motion.position, 4.75);
});

test('new points retarget the current in-flight position; canceled frames cannot overwrite it', () => {
  const { motion, frames, advance } = clock();
  motion.moveTo(1);
  motion.moveTo(2);
  advance(400);
  const interrupted = motion.position;
  const staleTick = [...frames.values()][0];
  motion.moveTo(2.5);
  assert.equal(motion.position, interrupted);
  staleTick();
  assert.equal(motion.position, interrupted);
  advance(2400);
  assert.equal(motion.position, 2.5);
});

test('pausing keeps the visible position for return; reduced motion and account resets snap without queued frames', () => {
  const { motion, frames, advance } = clock();
  motion.moveTo(1);
  motion.moveTo(2);
  advance(200);
  const paused = motion.position;
  motion.stop();
  advance(1000);
  assert.equal(motion.position, paused);
  assert.equal(frames.size, 0);
  motion.moveTo(2);
  advance(2400);
  assert.equal(motion.position, 2);
  motion.moveTo(3.25, { animate: false });
  assert.equal(motion.position, 3.25);
  assert.equal(frames.size, 0);
  motion.moveTo(0, { animate: false });
  assert.equal(motion.position, 0);
  motion.moveTo(2);
  advance(100);
  motion.moveTo(2, { animate: false });
  assert.equal(motion.position, 2);
  assert.equal(frames.size, 0);
});
