import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as model from '../webgame/js/journey-model.js';
import * as motionModule from '../webgame/js/journey-motion.js';
import * as revealsModule from '../webgame/js/journey-reveals.js';

test('only the next locked city or checkpoint shakes within its last 100 points', () => {
  for (const threshold of [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]) {
    for (const gap of [101, 100, 1, 0, -1]) {
      const state = model.journeyForScore(threshold - gap);
      const near = [...state.stops, ...state.checkpoints].filter(point => point.nearUnlock);
      assert.deepEqual(near.map(point => point.points), gap > 0 && gap <= 100 ? [threshold] : []);
      assert.ok(near.every(point => !point.unlocked));
    }
  }
});

test('travel milestones reveal exactly at each 1000-point boundary without spending points', () => {
  for (let stage = 1; stage <= 5; stage++) {
    assert.equal(model.journeyForScore(stage * 1000 - 1).reached, stage - 1);
    const reached = model.journeyForScore(stage * 1000);
    assert.equal(reached.reached, stage);
    assert.equal(reached.score, stage * 1000);
    assert.equal(reached.stops[stage - 1].unlocked, true);
    if (stage < 5) {
      assert.equal(reached.progress, 0);
      assert.equal(reached.remaining, 1000);
    }
  }
});

test('locked destinations have no name, description or art; known stops follow the requested order', () => {
  const initial = model.journeyForScore(0);
  assert.equal(initial.currentName, 'จุดเริ่มต้น');
  for (const stop of initial.stops) {
    assert.equal(stop.name, undefined);
    assert.equal(stop.art, undefined);
    assert.equal(stop.description, undefined);
  }
  const known = model.journeyForScore(4000);
  assert.deepEqual(known.stops.slice(0, 4).map(stop => stop.name), ['หัวหิน', 'เชียงใหม่', 'ไต้หวัน', 'ญี่ปุ่น']);
  assert.equal(known.stops[4].name, undefined);
});

test('travel score matches the leaderboard and handles invalid values and the final stop', () => {
  assert.equal(model.travelScore(300, 250), 3250);
  const middle = model.journeyForScore(3250);
  assert.equal(middle.currentName, 'ระหว่างทางจากไต้หวัน');
  assert.equal(middle.remaining, 750);
  assert.equal(middle.progress, 250);
  for (const score of [-10, NaN, Infinity, 'invalid']) assert.equal(model.journeyForScore(score).reached, 0);
  assert.equal(model.travelScore(-4, NaN), 0);
  assert.equal(model.journeyForScore(4999).complete, false);
  const final = model.journeyForScore(5000);
  assert.equal(final.reached, 5);
  assert.equal(final.currentName, 'เกาหลีใต้');
  assert.equal(final.stops.length, 5);
  assert.equal(model.journeyForScore(15000).reached, 5);
  assert.equal(final.complete, true);
  assert.equal(final.next, null);
  assert.equal(final.progress, 1000);
});

test('four half-way checkpoints begin after Hua Hin and never reveal the next destination early', () => {
  const initial = model.journeyForScore(0);
  assert.deepEqual(initial.checkpoints.map(point => point.points), [1500, 2500, 3500, 4500]);
  assert.equal(initial.position, 0);
  for (const points of [1500, 2500, 3500, 4500]) {
    const before = model.journeyForScore(points - 1);
    const after = model.journeyForScore(points);
    assert.equal(before.position, (points - 1) / 1000);
    assert.equal(after.position, Math.floor(points / 1000) + .5);
    assert.equal(after.reached, before.reached);
    assert.equal(after.progress, 500);
    assert.equal(after.remaining, 500);
    assert.equal(after.next.name, undefined);
    assert.ok(after.currentName.startsWith('เช็คพอยต์หลัง'));
    const next = model.journeyForScore(points + 500);
    assert.equal(next.position, after.reached + 1);
  }
  const layout = model.journeyLayout();
  for (const checkpoint of initial.checkpoints) {
    const location = model.journeyMapPoint(layout, checkpoint.position);
    const from = layout.points[checkpoint.stage], to = layout.points[checkpoint.stage + 1];
    assert.deepEqual(location, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    assert.ok(model.journeyPath(layout.points, checkpoint.position).endsWith(`${location.x} ${location.y}`));
  }
});

test('checkpoint benefit details stay hidden until its threshold and support different future benefit types', () => {
  const benefits = {
    1: { type: 'stay_duration', days: 5, title: 'เพิ่มวันพักหัวหิน', description: 'เพิ่มจาก 3 วัน เป็น 5 วัน' },
    2: { type: 'custom', title: 'สิทธิพิเศษอื่น', description: 'รายละเอียดที่กำหนดในอนาคต' },
  };
  const locked = model.journeyForScore(1499, benefits).checkpoints[0];
  assert.equal(locked.unlocked, false);
  assert.equal(Object.hasOwn(locked, 'benefit'), false);
  const opened = model.journeyForScore(1500, benefits);
  assert.deepEqual(opened.checkpoints[0].benefit, benefits[1]);
  assert.equal(opened.checkpoints[1].benefit, undefined);
  assert.deepEqual(model.journeyForScore(2500, benefits).checkpoints[1].benefit, benefits[2]);
  assert.equal(model.journeyForScore(1500).checkpoints[0].benefit, null, 'no real reward is selected by default');
});

const source = await readFile(new URL('../webgame/js/goals-home.js', import.meta.url), 'utf8');
test('crossing into proximity refreshes the lock even without reaching a stop', async () => {
  const screen = await load({ initial: { owner: 'a', total: 89, state: 'saved' } });
  for (const [total, expected] of [[89, null], [90, 'stage'], [99, 'stage'], [100, null], [139, null], [140, 'checkpoint'], [149, 'checkpoint'], [150, null]]) {
    screen.update({ owner: 'a', total, state: 'saved' });
    const near = screen.element('journeyNodes').innerHTML.match(/<button[^>]*is-near-unlock[^>]*>/g) || [];
    assert.equal(near.length, expected ? 1 : 0);
    if (expected) assert.ok(near[0].includes(`data-${expected}="1"`));
  }
});

test('first arrival opens the reveal, dismissing remembers it, and later destinations reveal separately', async () => {
  const screen = await load({ visible: true, initial: { owner: 'a', total: 99, state: 'saved' } });
  const dialog = screen.element('journeyRevealDialog');
  assert.ok(!dialog.open);
  screen.update({ owner: 'a', total: 100, state: 'saved' });
  assert.equal(dialog.open, true);
  assert.ok(dialog.innerHTML.includes('หัวหิน'));
  assert.ok(dialog.innerHTML.includes('journey-reveal-lock'));
  dialog.close();
  screen.update({ owner: 'a', total: 101, state: 'saved' });
  assert.equal(dialog.open, false);
  screen.update({ owner: 'a', total: 150, state: 'saved' });
  assert.equal(dialog.open, false, 'checkpoints do not announce a destination');
  screen.update({ owner: 'a', total: 200, state: 'saved' });
  assert.equal(dialog.open, true);
  assert.ok(dialog.innerHTML.includes('เชียงใหม่'));
});

test('reset starts the map at zero, keeps earned activity, counts new points and can be undone', async () => {
  const screen = await load({ initial: { owner: 'a', total: 410, state: 'saved' }, cached: { owner: 'a', points: 250 } });
  assert.equal(screen.element('journeyScore').textContent, '4,350');
  screen.element('journeyReset').click();
  assert.equal(screen.element('journeyScore').textContent, '0');
  assert.equal(screen.element('journeyCharacter').dataset.position, '0');
  assert.ok(!screen.element('journeyNodes').innerHTML.includes('หัวหิน'));
  screen.update({ owner: 'a', total: 411, state: 'saved' });
  assert.equal(screen.element('journeyScore').textContent, '10');
  screen.element('journeyUndoReset').click();
  assert.equal(screen.element('journeyScore').textContent, '4,360');
  screen.element('journeyReset').click();
  screen.update({ owner: 'b', total: 100, state: 'saved' });
  assert.equal(screen.element('journeyScore').textContent, '1,000', 'another player has no reset offset');
});
async function load({ initial = { owner: 'a', total: 0, state: 'saved' }, cached = null, visible = false } = {}) {
  const elements = new Map(), events = new Map(), storage = new Map();
  if (cached) storage.set('weston-journey-missions-v1', JSON.stringify(cached));
  function element(id) {
    if (!elements.has(id)) elements.set(id, { id, style: {}, innerHTML: '', textContent: '', dataset: {}, hidden: false,
      classList: { contains: () => visible && id === 'screen-goal' }, setAttribute(name, value) { this[name] = value; },
      addEventListener(name, callback) { this[name === 'close' ? 'onclose' : name] = callback; },
      querySelector(selector) { return element(id + selector); }, append(child) { elements.set(child.id, child); }, scrollTo() {},
      showModal() { this.open = true; }, close() { const wasOpen = this.open; this.open = false; if (wasOpen) this.onclose?.(); },
    });
    return elements.get(id);
  }
  let game = initial, notify;
  const data = { snapshot: () => game, subscribe: fn => { notify = fn; fn(game); },
    connect: () => new Promise(() => {}), playerSession: () => new Promise(() => {}) };
  const context = vm.createContext({
    document: { getElementById: element, createElement: name => element(name + elements.size), addEventListener() {} },
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    navigator: { onLine: false },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: fn => fn(), matchMedia: () => ({ matches: true }), console,
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(specifier => {
    const values = specifier.includes('journey-model') ? model : specifier.includes('journey-motion') ? motionModule : specifier.includes('journey-reveals') ? revealsModule : data;
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { element, events, api: module.namespace, update(next) { game = next; notify(next); } };
}

test('map reacts to live workout totals and reloads from score, including a jump over several stops', async () => {
  const screen = await load({ initial: { owner: 'a', total: 99, state: 'saved' } });
  assert.equal(screen.element('journeyScore').textContent, '990');
  assert.ok(!screen.element('journeyNodes').innerHTML.includes('หัวหิน'));
  screen.update({ owner: 'a', total: 100, state: 'saved' });
  assert.ok(screen.element('journeyNodes').innerHTML.includes('หัวหิน'));
  assert.ok(!screen.element('journeyNodes').innerHTML.includes('เชียงใหม่'));
  assert.equal(screen.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณที่หัวหิน');
  screen.update({ owner: 'a', total: 400, state: 'saved' });
  assert.equal(screen.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณที่ญี่ปุ่น');
  const reloaded = await load({ initial: { owner: 'a', total: 400, state: 'offline' } });
  assert.equal(reloaded.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณที่ญี่ปุ่น');
  assert.ok(reloaded.element('journeySync').textContent.includes('ในเครื่อง'));
});

test('offline mission cache stays bound to its owner and clears when the account changes', async () => {
  const screen = await load({ initial: { owner: 'a', total: 300, state: 'offline' }, cached: { owner: 'a', points: 250 } });
  assert.equal(screen.element('journeyScore').textContent, '3,250');
  assert.equal(screen.element('journeyNextScore').textContent, '4,000');
  screen.update({ owner: 'b', total: 0, state: 'offline' });
  assert.equal(screen.element('journeyScore').textContent, '0');
  assert.ok(!screen.element('journeyNodes').innerHTML.includes('ไต้หวัน'));
  const differentOwner = await load({ cached: { owner: 'b', points: 9000 } });
  assert.equal(differentOwner.element('journeyScore').textContent, '0');
});

test('character and completed route advance at a checkpoint, survive reload, then move to the next city', async () => {
  const screen = await load({ initial: { owner: 'a', total: 149, state: 'saved' } });
  assert.equal(screen.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณระหว่างทางจากหัวหิน');
  assert.equal((screen.element('journeyNodes').innerHTML.match(/data-checkpoint=/g) || []).length, 4);
  screen.update({ owner: 'a', total: 150, state: 'saved' });
  assert.equal(screen.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณที่เช็คพอยต์หลังหัวหิน');
  assert.ok(screen.element('journeyCharacter').className.includes('at-checkpoint'));
  assert.ok(!screen.element('journeyNodes').innerHTML.includes('เชียงใหม่'));
  const point = model.journeyMapPoint(model.journeyLayout(), 1.5);
  assert.equal(screen.element('journeyCharacter').style.top, `${point.y}px`);
  const reloaded = await load({ initial: { owner: 'a', total: 150, state: 'offline' } });
  assert.equal(reloaded.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณที่เช็คพอยต์หลังหัวหิน');
  screen.update({ owner: 'a', total: 200, state: 'saved' });
  assert.equal(screen.element('journeyCharacter')['aria-label'], 'ตัวละครของคุณที่เชียงใหม่');
  assert.ok(!screen.element('journeyCharacter').className.includes('at-checkpoint'));
});

test('checkpoint buttons and their detail dialog use locked question marks and do not promise an unconfigured benefit', async () => {
  const screen = await load({ initial: { owner: 'a', total: 100, state: 'saved' } });
  assert.equal((screen.element('journeyNodes').innerHTML.match(/journey-checkpoint-lock/g) || []).length, 4);
  const clickCheckpoint = () => screen.element('journeyNodes').click({ target: {
    closest: selector => selector === '[data-checkpoint]' ? { dataset: { checkpoint: '1' } } : null,
  } });
  clickCheckpoint();
  assert.equal(screen.element('journeyDestinationTitle').textContent, 'เช็คพอยต์ปริศนา');
  assert.ok(screen.element('journeyDestinationArt').innerHTML.includes('?</b>'));
  screen.update({ owner: 'a', total: 150, state: 'saved' });
  assert.equal((screen.element('journeyNodes').innerHTML.match(/journey-checkpoint-lock/g) || []).length, 3);
  clickCheckpoint();
  assert.equal(screen.element('journeyDestinationTitle').textContent, 'ปลดล็อกเช็คพอยต์แล้ว');
  assert.ok(screen.element('journeyDestinationDescription').textContent.includes('ภายหลัง'));
  assert.ok(!screen.element('journeyDestinationDescription').textContent.includes('5 วัน'));
});

test('mission totals page through every reward, filter the owner and propagate failed reads', async () => {
  const screen = await load();
  const rows = [...Array.from({ length: 500 }, () => ({ points_awarded: 10 })), { points_awarded: 250 }];
  const pages = [];
  const api = { userId: 'a', from(table) {
    assert.equal(table, 'weston_mission_completions');
    const query = { select() { return query; }, eq(column, owner) { assert.equal(column, 'user_id'); assert.equal(owner, 'a'); return query; },
      order() { return query; }, async range(start, end) { pages.push([start, end]); return { data: rows.slice(start, end + 1) }; } };
    return query;
  } };
  assert.equal(await screen.api.loadTravelMissionPoints(api), 5250);
  assert.deepEqual(pages, [[0, 499], [500, 999]]);
  const broken = { userId: 'a', from() { const query = { select() { return query; }, eq() { return query; }, order() { return query; }, range: async () => ({ error: new Error('offline') }) }; return query; } };
  await assert.rejects(screen.api.loadTravelMissionPoints(broken), /offline/);
});

test('every point moves the character and route while destinations and checkpoints keep their original thresholds', async () => {
  const layout = model.journeyLayout();
  const screen = await load({ initial: { owner: 'a', total: 100, state: 'saved' } });
  for (const score of [1010, 1250, 1490, 1500, 1750, 1990, 2000]) {
    screen.update({ owner: 'a', total: score / 10, state: 'saved' });
    const state = model.journeyForScore(score), point = model.journeyMapPoint(layout, score / 1000);
    assert.equal(state.position, score / 1000);
    assert.equal(screen.element('journeyCharacter').style.left, `${point.x / 4}%`);
    assert.equal(screen.element('journeyCharacter').style.top, `${point.y}px`);
    assert.equal(screen.element('journeyCompletedPath').d, model.journeyPath(layout.points, state.position));
    assert.equal(state.checkpoints[0].unlocked, score >= 1500);
    assert.equal(state.stops[1].unlocked, score >= 2000);
  }
  for (const score of [10, 250, 500, 990]) {
    const state = model.journeyForScore(score);
    assert.equal(state.position, score / 1000);
    assert.equal(state.reached, 0);
    assert.equal(state.stops[0].name, undefined);
  }
  const reloaded = await load({ initial: { owner: 'a', total: 125, state: 'offline' } });
  assert.equal(reloaded.element('journeyCharacter').dataset.position, '1.25');
  assert.equal(model.journeyForScore(10000).position, 5);
});
