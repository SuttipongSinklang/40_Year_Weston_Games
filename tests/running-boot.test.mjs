import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('native GPS recovery can stay pending while the running map opens', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, value: '', textContent: '', dataset: {},
      addEventListener() {}, setAttribute() {}, querySelector() { return node(`${id}-child`); } });
    return nodes.get(id);
  };
  const never = new Promise(() => {}), calls = [];
  const tracker = { init: () => never, refresh: () => never,
    snapshot: () => ({ run: null, ready: false, mode: 'idle', busy: false, elapsed: 0, message: 'loading' }) };
  const maps = [];
  const exports = {
    createNativeTreadmillTracker: () => tracker, createRunTracker: () => tracker,
    createPhoneSteps: () => ({}), createNativeRunTracker: () => tracker,
    isNativeApp: () => true, nativeRunningPlugin: async () => ({ plugin: {} }), restoreRun: () => null,
    createRunSync: () => ({ flush: async () => {} }),
    createRunMap: () => { const index = maps.length; const map = {
      render() {}, resize() {}, setBasemap: async value => calls.push([index, value]), center() {} };
      maps.push(map); return map; },
    listRecords: async () => [], getRecord: async () => null, saveRecord: async () => {}, loadDraft: async () => null,
    playerSession: async () => ({}), saveRunToCloud: async () => {}, loadRunsFromCloud: async () => [],
  };
  const context = vm.createContext({ document: { hidden: false, getElementById: node,
    querySelectorAll: () => [], querySelector: () => node('query'), addEventListener() {} },
    window: { addEventListener() {} }, navigator: {}, setInterval() {}, setTimeout, clearTimeout, Date,
    requestAnimationFrame: fn => fn() });
  const source = await readFile(new URL('../webgame/js/running.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const deadline = {};
  let timer;
  const screen = await Promise.race([module.namespace.initializeRunning({ toast() {} }),
    new Promise(resolve => { timer = setTimeout(() => resolve(deadline), 1000); })]);
  clearTimeout(timer);
  assert.notEqual(screen, deadline, 'map lifecycle must be available before the native bridge responds');
  assert.equal(node('runStart').disabled, true, 'GPS controls still wait for authoritative native state');
  screen.enter();
  assert.deepEqual(calls, [[0, true]]);
});

test('async native plugin loading does not assimilate the actual Capacitor Proxy', async () => {
  const { registerPlugin } = await import('../mobile/node_modules/@capacitor/core/dist/index.js');
  let thenCalls = 0;
  const actualProxy = registerPlugin('WestonBootRegression', { web: () => ({
    getState: async () => ({ mode: 'idle' }),
  }) });
  const proxy = new Proxy(actualProxy, { get(target, key) {
    if (key === 'then') thenCalls++;
    return Reflect.get(target, key);
  } });
  // This is the real Capacitor Proxy, which creates a native-method wrapper for `then`.
  assert.equal(typeof actualProxy.then, 'function');
  const context = vm.createContext({ setTimeout, clearTimeout, Date });
  const bridge = new vm.SyntheticModule(['registerPlugin'], function () {
    this.setExport('registerPlugin', () => proxy);
  }, { context });
  await bridge.link(() => {}); await bridge.evaluate();
  const source = await readFile(new URL('../webgame/js/run-native-tracker.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context,
    importModuleDynamically: async () => bridge });
  await module.link(() => new vm.SyntheticModule(['activeMs', 'replayNativeRun'], function () {
    this.setExport('activeMs', () => 0); this.setExport('replayNativeRun', () => ({}));
  }, { context }));
  await module.evaluate();
  const deadline = {}; let timer;
  const result = await Promise.race([module.namespace.nativeRunningPlugin(),
    new Promise(resolve => { timer = setTimeout(() => resolve(deadline), 1000); })]);
  clearTimeout(timer);
  assert.notEqual(result, deadline, 'the native loader must resolve without invoking plugin.then');
  assert.equal(thenCalls, 0);
  assert.equal(result.plugin, proxy);
  assert.equal((await result.plugin.getState()).mode, 'idle');
});
