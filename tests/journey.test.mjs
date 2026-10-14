import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as model from '../webgame/js/journey-model.js';

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
  assert.equal(middle.currentName, 'ไต้หวัน');
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

const source = await readFile(new URL('../webgame/js/goals-home.js', import.meta.url), 'utf8');
async function load({ initial = { owner: 'a', total: 0, state: 'saved' }, cached = null } = {}) {
  const elements = new Map(), events = new Map(), storage = new Map();
  if (cached) storage.set('weston-journey-missions-v1', JSON.stringify(cached));
  function element(id) {
    if (!elements.has(id)) elements.set(id, { id, style: {}, innerHTML: '', textContent: '', dataset: {}, hidden: false,
      classList: { contains: () => false }, setAttribute(name, value) { this[name] = value; },
      addEventListener(name, callback) { this[name] = callback; },
      querySelector(selector) { return element(id + selector); }, append() {}, scrollTo() {}, showModal() {}, close() {},
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
    const values = specifier.includes('journey-model') ? model : data;
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
