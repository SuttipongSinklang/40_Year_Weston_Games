// Pure GPS running engine: vanilla ESM, no DOM, no network, no game rewards.
const EARTH_RADIUS_M = 6371000;
const MAX_POINTS = 10000;
const MAX_ACCURACY_M = 40;
const FUTURE_TOLERANCE_MS = 10000;
const PAST_TOLERANCE_MS = 15000;
const SEGMENT_GAP_MS = 30000;
const MAX_SPEED_MPS = 12;
const STATUSES = ['running', 'paused', 'finished'];

const toRad = deg => (deg * Math.PI) / 180;
const haversineM = (a, b) => {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  // Rounding can push antipodal h a few ulps past 1; asin(NaN) would then slip past the numeric filters.
  const h = Math.min(1, Math.max(0, Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
};
const jitterThresholdM = accuracy => Math.max(3, Math.min(8, accuracy / 2));
const isFiniteNonNegative = n => Number.isFinite(n) && n >= 0;

export function createRun({ id, now = Date.now() } = {}) {
  return { id, status: 'running', started_at: new Date(now).toISOString(), ended_at: null,
    elapsed_ms: 0, resumed_at: now, updated_at: now, segment: 0, distance_m: 0, points: [], splits: [], events: [] };
}

export function activeMs(run, now = Date.now()) {
  const live = run.status === 'running' && run.resumed_at != null ? Math.max(0, now - run.resumed_at) : 0;
  return Math.max(0, run.elapsed_ms + live);
}

export function pauseRun(run, now) {
  if (run.status !== 'running') return run;
  const events = run.events ||= [];
  const candidate = run.points.at(-1);
  const last = candidate && now - candidate.timestamp <= PAST_TOLERANCE_MS ? candidate : null;
  events.push({ type: 'pause', index: events.filter(e => e.type === 'pause').length + 1, at: now,
    lat: last?.lat ?? null, lng: last?.lng ?? null, fix_at: last?.timestamp ?? null });
  run.elapsed_ms = activeMs(run, now);
  run.status = 'paused';
  run.resumed_at = null;
  run.segment += 1;
  run.updated_at = now;
  return run;
}

export function resumeRun(run, now) {
  if (run.status !== 'paused') return run;
  const events = run.events ||= [];
  const pause = events.findLast(e => e.type === 'pause');
  if (pause) events.push({ type: 'resume', index: pause.index, at: now, lat: null, lng: null, fix_at: null });
  run.status = 'running';
  run.resumed_at = now;
  run.updated_at = now;
  return run;
}

export function finishRun(run, now) {
  if (run.status === 'finished') return run;
  if (run.status === 'running') run.elapsed_ms = activeMs(run, now);
  run.status = 'finished';
  run.ended_at = new Date(now).toISOString();
  run.resumed_at = null;
  run.updated_at = now;
  return run;
}

function addSplits(run, prev, point) {
  if (!prev || point.distance_m === prev.distance_m) return;
  let prevCrossing = run.splits.reduce((sum, split) => sum + split.duration_ms, 0);
  let boundary = (run.splits.length + 1) * 1000;
  while (point.distance_m >= boundary) {
    const fraction = (boundary - prev.distance_m) / (point.distance_m - prev.distance_m);
    const crossing = prev.active_ms + fraction * (point.active_ms - prev.active_ms);
    const duration = Math.max(0, crossing - prevCrossing);
    run.splits.push({ km: run.splits.length + 1, duration_ms: duration, pace_sec: duration / 1000 });
    prevCrossing = crossing;
    boundary += 1000;
  }
}

export function addPosition(run, fix, now = Date.now()) {
  if (run.status !== 'running') return { accepted: false, reason: 'status' };
  if (!fix || typeof fix !== 'object') return { accepted: false, reason: 'invalid' };
  const { latitude, longitude, accuracy, timestamp } = fix;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy < 0 || !Number.isFinite(timestamp))
    return { accepted: false, reason: 'invalid' };
  if (run.points.length >= MAX_POINTS) return { accepted: false, reason: 'full' };
  if (accuracy > MAX_ACCURACY_M) return { accepted: false, reason: 'accuracy' };
  if (timestamp > now + FUTURE_TOLERANCE_MS || timestamp < now - PAST_TOLERANCE_MS)
    return { accepted: false, reason: 'stale' };
  const last = run.points[run.points.length - 1];
  if (last && timestamp <= last.timestamp) return { accepted: false, reason: 'out-of-order' };

  let added = 0;
  if (last) {
    if (last.segment === run.segment && timestamp - last.timestamp > SEGMENT_GAP_MS) run.segment += 1;
    if (last.segment === run.segment) {
      added = haversineM(last, { lat: latitude, lng: longitude });
      if (added < jitterThresholdM(accuracy)) return { accepted: false, reason: 'jitter' };
      if (added / ((timestamp - last.timestamp) / 1000) > MAX_SPEED_MPS) return { accepted: false, reason: 'jump' };
    } else {
      added = 0;
    }
  }
  run.distance_m += added;
  const point = { lat: latitude, lng: longitude, accuracy, timestamp, segment: run.segment,
    active_ms: activeMs(run, now), distance_m: run.distance_m };
  run.points.push(point);
  const pending = run.events?.at(-1);
  if (pending?.type === 'resume' && pending.lat === null) {
    pending.lat = point.lat; pending.lng = point.lng; pending.fix_at = timestamp;
  }
  addSplits(run, last, point);
  run.updated_at = now;
  return { accepted: true, reason: 'ok' };
}

function validSavedRun(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
  if (typeof saved.id !== 'string' || saved.id.length === 0) return false;
  if (!STATUSES.includes(saved.status)) return false;
  if (typeof saved.started_at !== 'string' || Number.isNaN(Date.parse(saved.started_at))) return false;
  if (saved.ended_at !== null
    && (typeof saved.ended_at !== 'string' || Number.isNaN(Date.parse(saved.ended_at)))) return false;
  if (saved.status === 'finished' && saved.ended_at === null) return false;
  if (saved.status === 'running' ? !Number.isFinite(saved.resumed_at) : saved.resumed_at !== null) return false;
  if (!isFiniteNonNegative(saved.elapsed_ms) || !Number.isFinite(saved.updated_at)) return false;
  if (!Number.isInteger(saved.segment) || saved.segment < 0) return false;
  if (!isFiniteNonNegative(saved.distance_m)) return false;
  if (saved.distance_source === 'phone_steps' && (saved.activity !== 'treadmill'
    || !Number.isInteger(saved.steps) || saved.steps < 0 || saved.steps > 1000000
    || !Number.isFinite(saved.stride_m) || saved.stride_m < 0.3 || saved.stride_m > 2
    || Math.abs(saved.distance_m - saved.steps * saved.stride_m) > 0.001)) return false;
  if (!Array.isArray(saved.points) || saved.points.length > MAX_POINTS) return false;
  if (saved.distance_source === 'phone_steps' && saved.points.length) return false;
  for (const point of saved.points) {
    if (!point || typeof point !== 'object') return false;
    if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90) return false;
    if (!Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) return false;
    if (!isFiniteNonNegative(point.accuracy) || !Number.isFinite(point.timestamp)) return false;
    if (!Number.isInteger(point.segment) || point.segment < 0) return false;
    if (!isFiniteNonNegative(point.active_ms) || !isFiniteNonNegative(point.distance_m)) return false;
  }
  if (saved.events !== undefined) {
    if (!Array.isArray(saved.events) || saved.events.length > 20000) return false;
    for (const e of saved.events) {
      if (!e || !['pause', 'resume'].includes(e.type) || !Number.isInteger(e.index) || e.index < 1
        || !Number.isFinite(e.at)) return false;
      if (e.lat === null && e.lng === null && e.fix_at === null) continue;
      if (!Number.isFinite(e.lat) || Math.abs(e.lat) > 90 || !Number.isFinite(e.lng)
        || Math.abs(e.lng) > 180 || !Number.isFinite(e.fix_at)) return false;
    }
  }
  if (!Array.isArray(saved.splits)) return false;
  if (saved.distance_source === 'phone_steps' && saved.splits.length) return false;
  for (const split of saved.splits) {
    if (!split || typeof split !== 'object' || !Number.isInteger(split.km) || split.km < 1) return false;
    if (!isFiniteNonNegative(split.duration_ms) || !isFiniteNonNegative(split.pace_sec)) return false;
  }
  return true;
}

export function restoreRun(saved, now = Date.now()) {
  if (!validSavedRun(saved)) return null;
  const run = JSON.parse(JSON.stringify(saved));
  run.events ||= [];
  if (run.status === 'running') {
    const offlineUntil = Math.min(run.updated_at, now);
    run.elapsed_ms = Math.max(0, run.elapsed_ms + Math.max(0, offlineUntil - run.resumed_at));
    run.status = 'paused';
    run.resumed_at = null;
    run.segment += 1; // movement while the page was inactive must not bridge into the old baseline
  }
  run.updated_at = now;
  return run;
}

const escapeXml = value => String(value).replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));

export function toGPX(run) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="40 Year Weston Games" xmlns="http://www.topografix.com/GPX/1/1"'
      + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
      + ' xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <trk>',
    `    <name>${escapeXml(run.id)}</name>`,
  ];
  let segment = null;
  for (const point of run.points) {
    if (segment !== point.segment) {
      if (segment !== null) lines.push('    </trkseg>');
      lines.push('    <trkseg>');
      segment = point.segment;
    }
    lines.push(`      <trkpt lat="${point.lat}" lon="${point.lng}">`
      + `<time>${new Date(point.timestamp).toISOString()}</time></trkpt>`);
  }
  if (segment !== null) lines.push('    </trkseg>');
  lines.push('  </trk>', '</gpx>', '');
  return lines.join('\n');
}
