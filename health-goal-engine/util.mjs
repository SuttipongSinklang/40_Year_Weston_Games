export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const METRICS = Object.freeze(['weight_kg', 'bmi', 'body_fat_percent', 'muscle_mass_kg']);
export const emptyTargets = () => Object.fromEntries(METRICS.map(key => [`target_${key}`, null]));
export function immutable(value) {
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}
export function median(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('Invalid median data');
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}
// Semantic binding, not a security signature. Production callers must authenticate their inputs.
export function planIdentity(plan) {
  return JSON.stringify({rule_version:plan.rule_version,start:plan.start,target:plan.target,zones:plan.zones,
    height:plan.height_m,start_date:plan.start_date,device:plan.device_id,muscle:plan.muscle_definition,reference:plan.reference});
}
export function bangkokDate(instant) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function calendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === value ? stamp / 86400000 : null;
}
