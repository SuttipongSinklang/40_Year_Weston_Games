import { clamp } from '../util.mjs';
import { MUSCLE_GROWTH, ADULT_BMI_REFERENCE } from '../references/index.mjs';
export function weightGoal(weight, bmi, bodyFat, upper, mode) {
  if (![weight,bmi,bodyFat,upper].every(Number.isFinite) || weight <= 0 || bmi <= 0 || bodyFat<=0 || bodyFat>=100
    || upper<=0 || upper>=100) throw new Error('Invalid weight goal input');
  if (mode === 'BUILD') {
    const percent = clamp(.06 + .02 * (ADULT_BMI_REFERENCE.low - bmi), .06, .08);
    return { value:weight * (1+percent), percent, excess_fat:0, formula:'weight * (1 + clamp(0.06 + 0.02 * (18.5 - bmi), 0.06, 0.08))' };
  }
  if (mode === 'CUT') {
    const excess = Math.max(0,bodyFat-upper);
    const percent = clamp(.04 + .01*(bmi-ADULT_BMI_REFERENCE.high) + .003*excess,.05,.08);
    return { value:weight*(1-percent), percent, excess_fat:excess, formula:'weight * (1 - clamp(0.04 + 0.01 * (bmi - 25) + 0.003 * excess_fat, 0.05, 0.08))' };
  }
  if (!['RECOMP','MAINTAIN_PLUS'].includes(mode)) throw new Error('Unknown mode');
  return { value:weight, percent:0, excess_fat:0, formula:'current_weight' };
}
export function bmiGoal(weight, heightM) {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(heightM) || heightM <= 0) throw new Error('Invalid BMI input');
  const value=weight / heightM ** 2;
  if (!Number.isFinite(value) || value<=0) throw new Error('Nonfinite BMI result');
  return value;
}
export function bodyFatGoal(current, { bf_low, bf_high }) {
  if (![current,bf_low,bf_high].every(Number.isFinite) || current <= 0 || current >= 100
    || bf_low <= 0 || bf_high >= 100 || bf_low >= bf_high) throw new Error('Invalid body fat input');
  if (current > bf_high) return { value:Math.max(bf_high,current-clamp(current*.10,2,5)), formula:'max(bf_high, current_bf - clamp(current_bf * 0.10, 2, 5))' };
  if (current < bf_low) return { value:current+Math.min(bf_low-current,3), formula:'current_bf + min(bf_low - current_bf, 3)' };
  return { value:current, formula:'current_bf' };
}
export function muscleGoal(current, mode, group) {
  const percent = MUSCLE_GROWTH[mode]?.[group];
  if (!Number.isFinite(current) || current <= 0 || percent === undefined) throw new Error('Unsupported muscle goal');
  return { value:current*(1+percent), percent, formula:'current_muscle * (1 + mode_age_growth_percent)' };
}
