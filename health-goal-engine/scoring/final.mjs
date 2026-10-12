import { METRICS, median, immutable, calendarDay, bangkokDate, planIdentity } from '../util.mjs';
import { validateHistory, MEASUREMENT_POLICY } from '../validation/measurements.mjs';
import { compositionIssues } from '../validation/input.mjs';
export function aggregateFinal(plan, history, policy={}) {
  const rules={...MEASUREMENT_POLICY,...policy};
  const fail=(issues,extra={})=>immutable({valid:false,issues,actual:null,...extra});
  const startDay=calendarDay(plan?.start_date);
  if (startDay===null || !plan?.start) return fail(['plan_start_date_required']);
  if (!Number.isInteger(rules.minimumFinalDays) || rules.minimumFinalDays<2 || rules.minimumFinalDays>6) return fail(['minimum_final_days_must_be_2_to_6']);
  const validation=validateHistory(history,plan,rules);
  const accepted=validation.filter(row=>{
    const date=bangkokDate(row.measurement?.measured_at), day=calendarDay(date);
    return row.validation.accepted && day!==null && day-startDay+1>=145 && day-startDay+1<=150;
  });
  // Same-day repeated readings cannot dominate the final median or inflate the quorum.
  const grouped=new Map();
  for (const row of accepted) {
    const day=bangkokDate(row.measurement.measured_at);
    if (!grouped.has(day)) grouped.set(day,[]);
    grouped.get(day).push(row.measurement);
  }
  if (grouped.size<rules.minimumFinalDays) return fail(['insufficient_distinct_final_days'],{valid_days:grouped.size,validation});
  const perDay=[...grouped].map(([date,rows])=>({date,...Object.fromEntries(METRICS.filter(key=>key!=='bmi').map(key=>[key,median(rows.map(row=>row[key]))]))}));
  const actual=Object.fromEntries(METRICS.filter(key=>key!=='bmi').map(key=>[key,median(perDay.map(row=>row[key]))]));
  actual.bmi=actual.weight_kg/plan.height_m**2;
  const issues=compositionIssues(actual.weight_kg,actual.body_fat_percent,actual.muscle_mass_kg);
  if (issues.length) return fail(issues,{valid_days:grouped.size,validation});
  return immutable({valid:true,issues:[],actual,valid_days:grouped.size,
    included_ids:accepted.map(row=>row.measurement.measurement_id),per_day:perDay,validation,
    aggregation_policy:'median_per_day_then_median_days_v1',source:'final_window_145_150',plan_identity:planIdentity(plan)});
}
