// Foreground phone motion estimate, not a treadmill-console measurement.
export function createStepDetector(onStep) {
  let previousTime, baseline, armed = true, lastStep = -Infinity;
  return (sample, time) => {
    if (!sample || ![sample.x, sample.y, sample.z, time].every(Number.isFinite)) return;
    if (previousTime != null && time <= previousTime) return;
    const magnitude = Math.hypot(sample.x, sample.y, sample.z);
    if (previousTime == null || time - previousTime > 1500) { baseline = magnitude; armed = true; previousTime = time; return; }
    const dt = time - previousTime; previousTime = time;
    baseline += (1 - Math.exp(-dt / 600)) * (magnitude - baseline);
    const impulse = magnitude - baseline;
    if (impulse < 0.4) armed = true;
    if (armed && impulse > 1.6 && impulse < 15 && time - lastStep >= 250) {
      armed = false; lastStep = time; onStep(1);
    }
  };
}

export function createPhoneSteps({ target = globalThis.window, Motion = globalThis.DeviceMotionEvent,
  secure = globalThis.isSecureContext, plugin, now = Date.now, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let listener, nativeListener, onStep, onError, detector, generation = 0, nativeTotal = 0, prepared = false, pendingError;
  let deadline, receivedMotion = false;
  return {
    async prepare() {
      const request = ++generation;
      pendingError = undefined;
      if (plugin) {
        nativeListener = await plugin.addListener('stepProgress', value => {
          if (request !== generation) return;
          if (value.error) { pendingError = new Error(value.error); onError?.(pendingError); return; }
          const total = Number(value.steps);
          if (!Number.isInteger(total) || total < 0 || total > 1000000) return;
          if (total < nativeTotal) { onError?.(new Error('Step counter reset')); return; }
          const delta = total - nativeTotal; nativeTotal = total;
          if (delta > 1000) { onError?.(new Error('Unexpected step count')); return; }
          for (let remaining = delta; remaining > 0; remaining -= 100) onStep?.(Math.min(100, remaining));
        });
        if (request !== generation) { await nativeListener?.remove(); nativeListener = undefined; throw new Error('Motion cancelled'); }
        try { await plugin.startSteps(); }
        catch (error) { await nativeListener?.remove(); nativeListener = undefined; throw error; }
      } else {
        if (!secure) throw new Error('HTTPS required');
        if (!Motion || !target?.addEventListener) throw new Error('Motion unavailable');
        // Invoke before any await: Safari requires the Start button's user activation.
        if (typeof Motion.requestPermission === 'function' && await Motion.requestPermission() !== 'granted') throw new Error('Motion permission denied');
      }
      if (request !== generation) throw new Error('Motion cancelled');
      if (pendingError) throw pendingError;
      prepared = true;
    },
    start(step, error) {
      if (!prepared) throw new Error('Motion not ready');
      if (pendingError) throw pendingError;
      onStep = step; onError = error;
      if (!plugin) {
        const request = generation;
        detector = createStepDetector(count => onStep?.(count));
        receivedMotion = false;
        listener = event => {
          if (request !== generation) return;
          const sample = event.accelerationIncludingGravity;
          if (sample && [sample.x, sample.y, sample.z].every(Number.isFinite)) receivedMotion = true;
          detector(sample, now());
        };
        target.addEventListener('devicemotion', listener);
        deadline = schedule(() => { if (request === generation && !receivedMotion) onError?.(new Error('No motion data')); }, 8000);
      }
    },
    async stop() {
      generation++; prepared = false; onStep = undefined; onError = undefined; nativeTotal = 0;
      if (deadline) unschedule(deadline); deadline = undefined;
      if (listener) target.removeEventListener('devicemotion', listener); listener = undefined;
      const old = nativeListener; nativeListener = undefined;
      if (old) await old.remove();
      if (plugin) await plugin.stopSteps();
    },
  };
}
