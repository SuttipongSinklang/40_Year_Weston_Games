import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateGoals,weightGoal,bmiGoal,bodyFatGoal,muscleGoal,ageGroup,goalMode,milestones,milestone,getBodyFatReference,reviewGoalPlan} from '../index.mjs';
import {config,input,TEST_REFERENCE} from './fixtures.mjs';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
test('original BUILD example and auditable immutable plan',()=>{
 const original=structuredClone(input),p=calculateGoals(input,config);
 close(p.target.target_weight_kg,58.85);close(p.target.target_bmi,19.26);close(p.target.target_muscle_mass_kg,41.6);
 assert.equal(p.goal_mode,'BUILD'); assert.deepEqual(input,original);
 assert.ok(Object.isFrozen(p.audit.original_input)); assert.throws(()=>{p.target.target_weight_kg=1;});
 assert.equal(p.production_ready,false);
});
test('original CUT example exact 7.5% and hard cap',()=>{
 const p=calculateGoals({...input,weight_kg:80,bmi:27,body_fat_percent:30},config);
 close(p.target.target_weight_kg,74);close(p.audit.weight_rule.percent,.075);
 close(weightGoal(100,40,50,25,'CUT').value,92);
});
test('measured height wins over inconsistent input BMI',()=>{
 const p=calculateGoals({...input,height_cm:170,bmi:35},config);
 close(p.start.bmi,55/1.7**2);assert.equal(p.goal_mode,'MAINTAIN_PLUS');
 assert.equal(p.audit.height_source,'measured');close(p.target.target_bmi,p.target.target_weight_kg/1.7**2);
});
test('missing reference or definition fails closed with all four null keys',()=>{
 for(const options of [{},{...config,bodyFatReference:null},{...config,muscleDefinition:''}]){
  const p=calculateGoals(input,options);assert.equal(p.status,'needs_reference');
  assert.equal(Object.keys(p.target).length,4);assert.ok(Object.values(p.target).every(v=>v===null));
 }
});
test('youth has no adult fallback even when an adult reference is passed',()=>{
 const p=calculateGoals({...input,age:18},config);assert.equal(p.status,'needs_reference');
 assert.match(p.issues[0],/youth/);assert.ok(Object.values(p.target).every(v=>v===null));
});
test('bad input is rejected before any formula evaluation',()=>{
 for(const change of [{weight_kg:NaN},{age:0},{height_cm:0},{sex:'unknown'},{body_fat_percent:100},{muscle_mass_kg:60},{bmi:Infinity}])
  assert.equal(calculateGoals({...input,...change},config).status,'invalid_input');
});
test('reference coverage, provenance and overlap are mandatory',()=>{
 assert.equal(getBodyFatReference({...TEST_REFERENCE,source:''},25,'male'),null);
 assert.equal(getBodyFatReference({...TEST_REFERENCE,ranges:[...TEST_REFERENCE.ranges,TEST_REFERENCE.ranges[0]]},25,'male'),null);
 assert.equal(getBodyFatReference(TEST_REFERENCE,130,'male'),null);
});
test('high BMI without high fat is not CUT; low fat moves upward',()=>{
 assert.equal(goalMode(30,20,{bf_low:10,bf_high:25}),'MAINTAIN_PLUS');
 assert.equal(goalMode(23,30,{bf_low:10,bf_high:25}),'RECOMP');
 close(bodyFatGoal(5,{bf_low:10,bf_high:25}).value,8);
 close(bodyFatGoal(35,{bf_low:10,bf_high:25}).value,31.5);
 close(bodyFatGoal(20,{bf_low:10,bf_high:25}).value,20);
});
test('all exact muscle age/mode percentages and elderly CUT preservation',()=>{
 const table={BUILD:[.04,.03,.02],RECOMP:[.03,.02,.01],CUT:[.01,.005,0],MAINTAIN_PLUS:[.02,.015,.01]};
 for(const [mode,values]of Object.entries(table))for(const [i,age]of [25,45,65].entries())close(muscleGoal(40,mode,ageGroup(age)).value,40*(1+values[i]));
 const p=calculateGoals({...input,age:75,weight_kg:80,bmi:27,body_fat_percent:30},config);
 close(p.target.target_muscle_mass_kg,40);assert.equal(p.status,'needs_review');
});
test('original discontinuities preserved rather than silently smoothed',()=>{
 close(weightGoal(55,18.5-1e-6,20,25,'BUILD').value-55,3.3000011);
 close(weightGoal(80,25,25.000001,25,'CUT').value,76);
 assert.equal(goalMode(25,25,{bf_low:10,bf_high:25}),'MAINTAIN_PLUS');
});
test('physically inconsistent targets require review without changing the formula',()=>{
 const p=calculateGoals({...input,weight_kg:60,bmi:23,body_fat_percent:20,muscle_mass_kg:48},config);
 assert.equal(p.status,'needs_review');assert.ok(p.issues.includes('target_muscle_exceeds_lean_mass'));
 close(p.target.target_muscle_mass_kg,48*1.02);
});
test('documented review resolves individual-review flags but never rewrites targets',()=>{
 const p=calculateGoals({...input,age:65},config);
 const reviewed=reviewGoalPlan(p,{reviewer_id:'test-reviewer',reason:'verified individually in this fixture',reviewed_at:'2026-01-01T00:00:00Z',resolved_issues:['older_adult_individual_review_required']});
 assert.equal(reviewed.status,'calculated');assert.deepEqual(reviewed.target,p.target);
 assert.equal(p.status,'needs_review');assert.equal(reviewed.audit.plan_reviews.length,1);
 assert.throws(()=>reviewGoalPlan(p,{reviewer_id:'test',reason:'x',reviewed_at:'2026-01-01',resolved_issues:['target_muscle_exceeds_lean_mass']}));
});
test('derived arithmetic overflows and unknown classifiers fail explicitly',()=>{
 assert.equal(calculateGoals({...input,height_cm:1e-200},config).status,'invalid_input');
 assert.throws(()=>goalMode(NaN,20,{bf_low:10,bf_high:25}));
 assert.throws(()=>bmiGoal(1,1e-200));
});
test('milestones keep original endpoint and BMI relation, permit bounded nonlinear curves',()=>{
 const p=calculateGoals(input,config),rows=milestones(p);
 assert.deepEqual(rows.map(r=>r.day),[30,60,90,120,150]);assert.deepEqual(rows.at(-1).target,p.target);
 for(const row of rows)close(row.target.target_bmi,row.target.target_weight_kg/p.height_m**2);
 close(milestone(p,30,x=>x*x).target.target_weight_kg,55+(58.85-55)*.04);
 assert.throws(()=>milestone(p,30,()=>2));assert.throws(()=>bmiGoal(0,1));
});
for(const bmi of [15,17,18,18.5,20,23,24.9,25,27,30,35,40])for(const age of [18,25,45,65,75])for(const sex of ['male','female'])
 test(`required grid BMI${bmi}/age${age}/${sex}`,()=>{
  const p=calculateGoals({...input,bmi,age,sex,body_fat_percent:sex==='male'?30:40,muscle_mass_kg:20},config);
  if(age<20){assert.equal(p.status,'needs_reference');return;}
  assert.ok(Object.values(p.target).every(Number.isFinite));close(p.target.target_bmi,p.target.target_weight_kg/p.height_m**2);
  assert.ok(p.target.target_weight_kg>=55*.92-1e-9&&p.target.target_weight_kg<=55*1.08+1e-9);
 });
