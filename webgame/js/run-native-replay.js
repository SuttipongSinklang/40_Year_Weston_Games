import { createRun, activeMs, addPosition, pauseRun, resumeRun, finishRun } from './run-core.js';

// Replay durable native events at capture time, even if JS slept for hours.
// Using Date.now() here would incorrectly reject buffered fixes as stale.
export function replayNativeRun(state) {
  if (state?.version !== 1 || !['idle', 'acquiring', 'running', 'paused', 'finished'].includes(state.mode)
    || !Number.isInteger(state.revision) || state.revision < 0 || !Array.isArray(state.events)
    || state.events.length > 40010 || (state.id !== null && typeof state.id !== 'string')) {
    throw new Error('Invalid native recording');
  }
  if (state.id === null && (state.events.length || state.mode !== 'idle')) throw new Error('Missing run ID');
  if (state.id !== null && (!state.id || state.mode === 'idle')) throw new Error('Invalid run ID or mode');
  let run = null, lastAt = -Infinity, full = false;
  for (const event of state.events) {
    if (!event || !Number.isFinite(event.at) || event.at < lastAt
      || !['fix', 'pause', 'finish'].includes(event.type)) throw new Error('Invalid native event');
    lastAt = event.at;
    if (event.type === 'fix') {
      if (run?.status === 'finished') throw new Error('Location after finish');
      const fix = { latitude: event.latitude, longitude: event.longitude, accuracy: event.accuracy, timestamp: event.timestamp };
      // Validate before starting the clock; malformed native data must never create a run.
      if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180
        || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 40 || !Number.isFinite(fix.timestamp)
        || event.at - fix.timestamp > 15000 || fix.timestamp > event.at + 10000) throw new Error('Invalid native fix');
      if (!run) run = createRun({ id: state.id, now: event.at });
      else if (run.status === 'paused') resumeRun(run, event.at);
      const result = addPosition(run, fix, event.at);
      if (result.reason === 'full') full = true;
    } else if (event.type === 'pause') {
      if (run?.status === 'finished') throw new Error('Pause after finish');
      if (run) pauseRun(run, event.at);
    } else if (run) finishRun(run, event.at);
  }
  if ((state.mode === 'finished' && run?.status !== 'finished')
    || (state.mode === 'running' && run?.status !== 'running')
    || (state.mode === 'paused' && run?.status !== 'paused')) throw new Error('Native state mismatch');
  return { run, full, elapsed: run ? activeMs(run, lastAt) : 0 };
}
