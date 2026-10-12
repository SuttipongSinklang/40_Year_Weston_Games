import { ADULT_BMI_REFERENCE } from '../references/index.mjs';
export function ageGroup(age) {
  if (!Number.isFinite(age) || age <= 0) throw new Error('Invalid age');
  return age < 20 ? 'YOUTH' : age < 40 ? 'YOUNG_ADULT' : age < 65 ? 'MIDDLE_ADULT' : 'OLDER_ADULT';
}
// No muscle-normality table is supplied: low/high absolute kg are NOT inferred.
export function goalMode(bmi, bodyFat, { bf_low, bf_high }) {
  if (![bmi,bodyFat,bf_low,bf_high].every(Number.isFinite) || bmi<=0 || bodyFat<=0 || bodyFat>=100
    || bf_low<=0 || bf_high>=100 || bf_low>=bf_high) throw new Error('Invalid classification inputs');
  if (bmi < ADULT_BMI_REFERENCE.low) return 'BUILD';
  if (bmi >= ADULT_BMI_REFERENCE.high && bodyFat > bf_high) return 'CUT';
  if (bodyFat < bf_low || bodyFat > bf_high) return 'RECOMP';
  return 'MAINTAIN_PLUS';
}
