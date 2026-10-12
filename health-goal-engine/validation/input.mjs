import { METRICS } from '../util.mjs';
export function validateInput(input) {
  const issues=[];
  if (!input || typeof input !== 'object') return {valid:false,issues:['input_required']};
  for (const key of ['age',...METRICS]) if (!Number.isFinite(input[key]) || input[key] <= 0) issues.push(`invalid_${key}`);
  if (!['male','female'].includes(input.sex)) issues.push('unsupported_sex_reference');
  if (input.body_fat_percent >= 100) issues.push('invalid_body_fat_percent');
  if (input.height_cm !== undefined && (!Number.isFinite(input.height_cm) || input.height_cm <= 0)) issues.push('invalid_height_cm');
  if (input.muscle_mass_kg > input.weight_kg*(1-input.body_fat_percent/100)+1e-9) issues.push('muscle_exceeds_lean_mass');
  return {valid:!issues.length,issues};
}
export function compositionIssues(weight, fat, muscle) {
  if (![weight,fat,muscle].every(Number.isFinite) || weight <= 0 || fat <= 0 || fat >= 100 || muscle <= 0) return ['invalid_composition'];
  return muscle > weight*(1-fat/100)+1e-9 ? ['muscle_exceeds_lean_mass'] : [];
}
