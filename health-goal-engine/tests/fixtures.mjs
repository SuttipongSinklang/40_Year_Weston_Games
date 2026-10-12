// Arbitrary synthetic intervals for arithmetic testing. NOT a healthy reference table.
export const TEST_REFERENCE={id:'synthetic-fixture-not-medical',version:'test-1',source:'test fixture only',status:'simulation_only',
  ranges:[{sex:'male',age_min:20,age_max:120,bf_low:10,bf_high:25},{sex:'female',age_min:20,age_max:120,bf_low:20,bf_high:35}]};
export const config={bodyFatReference:TEST_REFERENCE,muscleDefinition:'synthetic-test-muscle-kg',deviceId:'test-device',startDate:'2026-01-01'};
export const input={age:25,sex:'male',weight_kg:55,bmi:18,body_fat_percent:20,muscle_mass_kg:40};
export function measurement(plan, day=145, changes={}) {
  const stamp=new Date(Date.parse(`${plan.start_date}T12:00:00+07:00`)+(day-1)*86400000);
  const value={measurement_id:`day-${day}`,measured_at:stamp.toISOString(),device_id:plan.device_id,
    muscle_definition:plan.muscle_definition,weight_kg:plan.target.target_weight_kg,
    body_fat_percent:plan.target.target_body_fat_percent,muscle_mass_kg:plan.target.target_muscle_mass_kg,...changes};
  value.bmi=value.weight_kg/plan.height_m**2;
  return value;
}
