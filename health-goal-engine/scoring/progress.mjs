import { METRICS, clamp, immutable, planIdentity } from '../util.mjs';
import { compositionIssues } from '../validation/input.mjs';
import { ADULT_BMI_REFERENCE } from '../references/index.mjs';
export const SCORE_WEIGHTS=Object.freeze({weight_kg:.15,bmi:.10,body_fat_percent:.35,muscle_mass_kg:.40});
export function progressScore(actual,start,target,zone=null,{maintenanceTaper=1}={}) {
  if (![actual,start,target,maintenanceTaper].every(Number.isFinite) || maintenanceTaper<=0) throw new Error('Invalid score input');
  if (zone) {
    if (!Number.isFinite(zone.min) || (zone.max!==null && (!Number.isFinite(zone.max)||zone.max<zone.min))) throw new Error('Invalid target zone');
    if (actual>=zone.min && (zone.max===null || actual<=zone.max)) return 100;
    const width=zone.max===null ? start*.01 : (zone.max-zone.min)/2;
    if (width<=0) throw new Error('Zone taper width must be positive');
    const distance=actual<zone.min ? zone.min-actual : actual-zone.max;
    return clamp(100*(1-distance/(width*maintenanceTaper)),0,100);
  }
  if (target===start) throw new Error('Maintenance target requires a zone');
  return clamp((actual-start)/(target-start)*100,0,100);
}
export function scoreProgress(plan, actual, policy={}) {
  const invalid=issues=>immutable({status:'invalid',issues,scores:null,total:null,flags:[]});
  if (!plan?.start || !plan?.target || !actual) return invalid(['calculated_plan_and_measurements_required']);
  if (METRICS.some(key=>!Number.isFinite(actual[key])||actual[key]<=0)) return invalid(['all_four_measurements_required']);
  const errors=compositionIssues(actual.weight_kg,actual.body_fat_percent,actual.muscle_mass_kg);
  const bmi=actual.weight_kg/plan.height_m**2;
  if (Math.abs(actual.bmi-bmi)>.2) errors.push('inconsistent_bmi');
  if (errors.length) return invalid(errors);
  const scores={},flags=[];
  try {
    for(const key of METRICS) {
      const target=plan.target[`target_${key}`], start=plan.start[key];
      scores[key]=progressScore(key==='bmi'?bmi:actual[key],start,target,plan.zones[key],policy);
      if (target!==start && (actual[key]-target)*(target-start)>1e-9) flags.push(`overshoot_${key}`);
    }
  } catch(error) { return invalid([error.message]); }
  if (actual.body_fat_percent<plan.reference.bf_low && actual.body_fat_percent<plan.start.body_fat_percent) flags.push('fat_below_reference_and_decreasing');
  if (bmi<ADULT_BMI_REFERENCE.low && actual.weight_kg<plan.start.weight_kg) flags.push('low_bmi_weight_decreasing');
  if (['CUT','BUILD'].includes(plan.goal_mode) && actual.muscle_mass_kg<plan.start.muscle_mass_kg*.99) flags.push('muscle_preservation_failed');
  const total=METRICS.reduce((sum,key)=>sum+scores[key]*SCORE_WEIGHTS[key],0);
  return immutable({status:'scored',issues:[],scores,total:clamp(total,0,100),flags});
}
export function rewardEligibility(plan, score, finalResult) {
  const reasons=[];
  const qualified=score?.status==='scored' && Number.isFinite(score.total) && score.total>=85
    && METRICS.every(key=>Number.isFinite(score.scores?.[key])&&score.scores[key]>=70);
  if (!qualified) reasons.push('score_thresholds_not_met');
  if (plan?.status!=='calculated' || plan?.issues?.length) reasons.push('plan_requires_review');
  if (!finalResult?.valid) reasons.push('valid_final_measurements_required');
  else if (finalResult.source!=='final_window_145_150' || !plan?.start || finalResult.plan_identity!==planIdentity(plan)) reasons.push('final_plan_mismatch');
  else {
    const verified=scoreProgress(plan,finalResult.actual);
    if (verified.status!=='scored' || verified.flags.length || !METRICS.every(key=>Math.abs((score?.scores?.[key]??NaN)-verified.scores[key])<1e-8)
      || Math.abs((score?.total??NaN)-verified.total)>=1e-8) reasons.push('final_score_mismatch');
  }
  if (score?.flags?.length) reasons.push('progress_requires_review');
  if (plan?.simulation_only) reasons.push('simulation_reference_not_for_rewards');
  // This is only an auditable eligibility calculation; there is no prize-awarding action.
  return immutable({eligible:!reasons.length,numerically_qualified:Boolean(qualified),reasons,
    production_ready:false,award_issued:false});
}
