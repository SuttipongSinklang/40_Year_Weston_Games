import { immutable } from '../util.mjs';
import { compositionIssues } from './input.mjs';
export const MEASUREMENT_POLICY=Object.freeze({bmiTolerance:.2,muscleJumpKg:4,fatDropPoints:6,minimumFinalDays:3});
export function validateMeasurement(measurement, plan, previous=null, policy={}) {
  const rules={...MEASUREMENT_POLICY,...policy}, errors=[], flags=[];
  if (![rules.bmiTolerance,rules.muscleJumpKg,rules.fatDropPoints].every(value=>Number.isFinite(value)&&value>0))
    return immutable({valid:false,accepted:false,errors:['invalid_measurement_policy'],flags:[]});
  if (!measurement || !plan?.start) return immutable({valid:false,accepted:false,errors:['measurement_plan_required'],flags:[]});
  if (typeof measurement.measurement_id!=='string' || !measurement.measurement_id.trim()) errors.push('measurement_id_required');
  if (typeof measurement.measured_at!=='string' || !/(Z|[+-]\d{2}:\d{2})$/.test(measurement.measured_at)
    || !Number.isFinite(Date.parse(measurement.measured_at))) errors.push('timestamp_with_timezone_required');
  if (typeof measurement.device_id!=='string' || !measurement.device_id.trim()) errors.push('device_id_required');
  if (!plan.device_id) errors.push('baseline_device_required');
  else if (measurement.device_id!==plan.device_id) flags.push('device_mismatch');
  if (measurement.muscle_definition!==plan.muscle_definition) errors.push('muscle_definition_mismatch');
  errors.push(...compositionIssues(measurement.weight_kg,measurement.body_fat_percent,measurement.muscle_mass_kg));
  const bmi=measurement.weight_kg/plan.height_m**2;
  if (!Number.isFinite(measurement.bmi) || measurement.bmi<=0 || Math.abs(measurement.bmi-bmi)>rules.bmiTolerance)
    errors.push('inconsistent_bmi');
  if (previous) {
    const gap=Date.parse(measurement.measured_at)-Date.parse(previous.measured_at);
    if (gap>0 && gap<=86400000) {
      if (measurement.muscle_mass_kg-previous.muscle_mass_kg>=rules.muscleJumpKg) flags.push('muscle_jump');
      if (previous.body_fat_percent-measurement.body_fat_percent>=rules.fatDropPoints) flags.push('fat_drop');
    }
  }
  if (measurement.suspicious_measurement===true) flags.push('reported_suspicious');
  if (measurement.status==='pending' || measurement.status==='rejected') flags.push('measurement_not_accepted');
  const review=measurement.review;
  const reviewed=review?.decision==='accepted' && typeof review.reviewer_id==='string' && review.reviewer_id.trim()
    && typeof review.reason==='string' && review.reason.trim() && Number.isFinite(Date.parse(review.reviewed_at))
    && Date.parse(review.reviewed_at)>=Date.parse(measurement.measured_at);
  // Device identity, explicit rejection and structural validation are never overridden.
  const unreviewable=flags.includes('device_mismatch') || measurement.status==='rejected';
  return immutable({valid:!errors.length,accepted:!errors.length && !unreviewable && (!flags.length || Boolean(reviewed)),
    errors,flags,reviewed:Boolean(reviewed)});
}
export function validateHistory(history, plan, policy={}) {
  if (!Array.isArray(history)) return immutable([{measurement:null,validation:{valid:false,accepted:false,errors:['history_required'],flags:[]}}]);
  const sorted=[...history].sort((a,b)=>Date.parse(a?.measured_at)-Date.parse(b?.measured_at));
  const ids=new Map(), timestamps=new Map();
  for (const measurement of sorted) {
    ids.set(measurement?.measurement_id,(ids.get(measurement?.measurement_id)||0)+1);
    timestamps.set(measurement?.measured_at,(timestamps.get(measurement?.measured_at)||0)+1);
  }
  let previous;
  return immutable(sorted.map(measurement=>{
    const validation=validateMeasurement(measurement,plan,previous,policy);
    const duplicate=ids.get(measurement?.measurement_id)>1 || timestamps.get(measurement?.measured_at)>1;
    const result=duplicate ? {...validation,valid:false,accepted:false,errors:[...validation.errors,'duplicate_measurement']} : validation;
    if (result.accepted) previous=measurement;
    return {measurement,validation:result};
  }));
}
