import { immutable, METRICS, emptyTargets, calendarDay } from './util.mjs';
import { ageGroup, goalMode } from './classifiers/index.mjs';
import { getBodyFatReference, ADULT_BMI_REFERENCE } from './references/index.mjs';
import { weightGoal, bmiGoal, bodyFatGoal, muscleGoal } from './calculators/index.mjs';
import { validateInput, compositionIssues } from './validation/input.mjs';
export * from './classifiers/index.mjs';
export * from './calculators/index.mjs';
export * from './references/index.mjs';
export * from './validation/input.mjs';
export * from './validation/measurements.mjs';
export * from './scoring/progress.mjs';
export * from './scoring/final.mjs';
export * from './milestones.mjs';
export const RULE_VERSION='body150-original-1.0.0-experimental';
export function reviewGoalPlan(plan,review) {
  if (!plan?.start || !review || !review.reviewer_id?.trim() || !review.reason?.trim()
    || !Number.isFinite(Date.parse(review.reviewed_at)) || !Array.isArray(review.resolved_issues)) throw new Error('Documented plan review required');
  const allowed=['older_adult_individual_review_required','atypical_bmi_individual_review_required'];
  if (review.resolved_issues.some(key=>!allowed.includes(key))) throw new Error('Structural target issues cannot be waived');
  const issues=plan.issues.filter(key=>!review.resolved_issues.includes(key));
  return immutable({...plan,status:issues.length?'needs_review':'calculated',issues,
    audit:{...plan.audit,plan_reviews:[...(plan.audit.plan_reviews||[]),review]}});
}
export function calculateGoals(input, config={}) {
  const result = validateInput(input);
  const blocked = (status,issues) => immutable({status,issues,experimental:true,production_ready:false,
    duration_days:150,rule_version:RULE_VERSION,target:emptyTargets()});
  if (!result.valid) return blocked('invalid_input',result.issues);
  if (ageGroup(input.age)==='YOUTH') return blocked('needs_reference',['youth_growth_reference_and_goal_policy_required']);
  const reference=getBodyFatReference(config.bodyFatReference,input.age,input.sex);
  const missing=[];
  if (!reference) missing.push('body_fat_reference_required');
  if (typeof config.muscleDefinition !== 'string' || !config.muscleDefinition.trim()) missing.push('muscle_definition_required');
  if (missing.length) return blocked('needs_reference',missing);
  if (config.startDate!==undefined && calendarDay(config.startDate)===null) return blocked('invalid_input',['invalid_start_date']);
  const height=input.height_cm!==undefined ? input.height_cm/100 : Math.sqrt(input.weight_kg/input.bmi);
  if (!Number.isFinite(height) || height<=0 || !Number.isFinite(input.weight_kg/height**2) || input.weight_kg/height**2<=0)
    return blocked('invalid_input',['nonfinite_derived_height_bmi']);
  const bmi=bmiGoal(input.weight_kg,height), group=ageGroup(input.age), mode=goalMode(bmi,input.body_fat_percent,reference);
  const weight=weightGoal(input.weight_kg,bmi,input.body_fat_percent,reference.bf_high,mode);
  const fat=bodyFatGoal(input.body_fat_percent,reference), muscle=muscleGoal(input.muscle_mass_kg,mode,group);
  const target={target_weight_kg:weight.value,target_bmi:weight.value/height**2,target_body_fat_percent:fat.value,target_muscle_mass_kg:muscle.value};
  if (!Object.values(target).every(value=>Number.isFinite(value)&&value>0)) return blocked('invalid_input',['nonfinite_derived_targets']);
  const issues=compositionIssues(weight.value,fat.value,muscle.value).map(key=>`target_${key}`);
  if (input.age>=65) issues.push('older_adult_individual_review_required');
  // Review triggers are provisional screening rules, not diagnoses or alternate target formulas.
  if (bmi<16 || bmi>=35) issues.push('atypical_bmi_individual_review_required');
  const start=Object.fromEntries(METRICS.map(key=>[key,key==='bmi'?bmi:input[key]]));
  const zones={};
  if (weight.value===input.weight_kg) {
    zones.weight_kg={min:input.weight_kg*.985,max:input.weight_kg*1.015};
    zones.bmi={min:bmiGoal(zones.weight_kg.min,height),max:bmiGoal(zones.weight_kg.max,height)};
  }
  if (fat.value===input.body_fat_percent) zones.body_fat_percent={min:Math.max(reference.bf_low,fat.value-1),max:Math.min(reference.bf_high,fat.value+1)};
  if (muscle.percent===0) zones.muscle_mass_kg={min:input.muscle_mass_kg*.99,max:null};
  return immutable({status:issues.length?'needs_review':'calculated',issues,experimental:true,production_ready:false,
    duration_days:150,rule_version:RULE_VERSION,goal_mode:mode,age_group:group,start,target,zones,height_m:height,
    start_date:config.startDate??null,device_id:config.deviceId??null,muscle_definition:config.muscleDefinition,
    reference,simulation_only:reference.status==='simulation_only',
    audit:{original_input:input,height_source:input.height_cm!==undefined?'measured':'inferred_from_weight_bmi',
      input_bmi:input.bmi,effective_bmi:bmi,weight_rule:weight,body_fat_rule:fat,muscle_rule:muscle,
      bmi_reference:ADULT_BMI_REFERENCE,
      bmi_formula:'target_weight_kg / height_m ** 2',classification_policy:'BMI plus BF; no supplied muscle normality thresholds',
      scoring_policy:'maintenance taper v1: one zone halfwidth outside plateau; prototype only'}});
}
