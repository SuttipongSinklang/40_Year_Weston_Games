import { immutable } from '../util.mjs';
export const ADULT_BMI_REFERENCE = Object.freeze({ id:'user-adult-bmi', version:'1', low:18.5, high:25 });
export const MUSCLE_GROWTH = immutable({
  BUILD: { YOUNG_ADULT:.04, MIDDLE_ADULT:.03, OLDER_ADULT:.02 },
  RECOMP: { YOUNG_ADULT:.03, MIDDLE_ADULT:.02, OLDER_ADULT:.01 },
  CUT: { YOUNG_ADULT:.01, MIDDLE_ADULT:.005, OLDER_ADULT:0 },
  MAINTAIN_PLUS: { YOUNG_ADULT:.02, MIDDLE_ADULT:.015, OLDER_ADULT:.01 }
});
// Deliberately no default body-fat values. An external versioned table must cover the player.
export function getBodyFatReference(reference, age, sex) {
  if (!reference || !reference.id || !reference.version || !reference.source
    || !['simulation_only','approved_external'].includes(reference.status) || !Array.isArray(reference.ranges)) return null;
  const rows = reference.ranges.filter(row => row.sex === sex && age >= row.age_min && age <= row.age_max);
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (![row.age_min,row.age_max,row.bf_low,row.bf_high].every(Number.isFinite)
    || row.age_min > row.age_max || row.bf_low <= 0 || row.bf_high >= 100 || row.bf_low >= row.bf_high) return null;
  return immutable({ ...row, id:reference.id, version:reference.version, source:reference.source, status:reference.status });
}
