// Interpolate route progress, then let the map evaluate its actual curved road.
// Keeping animation in one scalar avoids straight-line shortcuts between nodes.
export function createJourneyMotion({ draw, requestFrame, cancelFrame, now }) {
  let position = null, target = null, frame = null, generation = 0;
  function stop() {
    generation++;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (position !== null) draw(position, { moving: false });
  }
  function moveTo(next, { animate = true } = {}) {
    if (next === target && frame !== null && animate) return;
    stop();
    target = next;
    if (position === null || !animate || position === next) {
      position = next;
      draw(position, { moving: false });
      return;
    }
    const from = position;
    const duration = Math.min(2400, Math.max(450, Math.abs(next - from) * 1100));
    const start = now(), token = ++generation;
    function tick() {
      if (token !== generation) return;
      const fraction = Math.max(0, Math.min(1, (now() - start) / duration));
      const eased = fraction * fraction * (3 - 2 * fraction);
      position = from + (next - from) * eased;
      if (fraction === 1) {
        position = next;
        frame = null;
        draw(position, { moving: false });
      } else {
        draw(position, { moving: true });
        frame = requestFrame(tick);
      }
    }
    frame = requestFrame(tick);
  }
  return { moveTo, stop, get position() { return position; }, get target() { return target; } };
}
