import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {calculateGoals,scoreProgress,progressScore,aggregateFinal,rewardEligibility} from '../index.mjs';
import {config,input,measurement} from '../tests/fixtures.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
let seed=1502026;
const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};
const counts={cases:10000,calculated:0,needs_review:0,youth_blocked:0,modes:{},composition_review:0};
const baseline={};let endpointScored=0;
for(let i=0;i<counts.cases;i++) {
 const age=15+random()*75,sex=i%2?'male':'female',height=1.4+random()*.65,bmi=14+random()*32;
 const weight=bmi*height**2,fat=5+random()*50,muscle=weight*(1-fat/100)*(.4+random()*.59);
 const p=calculateGoals({age,sex,weight_kg:weight,bmi,body_fat_percent:fat,muscle_mass_kg:muscle,height_cm:height*100},config);
 if(age<20){assert.equal(p.status,'needs_reference');assert.ok(Object.values(p.target).every(v=>v===null));counts.youth_blocked++;continue;}
 assert.ok(['calculated','needs_review'].includes(p.status));counts[p.status]++;
 counts.modes[p.goal_mode]=(counts.modes[p.goal_mode]||0)+1;
 assert.ok(Object.values(p.target).every(v=>Number.isFinite(v)&&v>0));
 close(p.target.target_bmi,p.target.target_weight_kg/p.height_m**2);
 assert.ok(p.target.target_weight_kg>=weight*.92-1e-7&&p.target.target_weight_kg<=weight*1.08+1e-7);
 const effective=p.start.bmi,high=p.reference.bf_high,low=p.reference.bf_low;
 const expectedWeight=effective<18.5 ? weight*(1+clamp(.06+.02*(18.5-effective),.06,.08))
  : effective>=25&&fat>high ? weight*(1-clamp(.04+.01*(effective-25)+.003*(fat-high),.05,.08)) : weight;
 close(p.target.target_weight_kg,expectedWeight);
 const expectedFat=fat>high?Math.max(high,fat-clamp(fat*.10,2,5)):fat<low?fat+Math.min(low-fat,3):fat;
 close(p.target.target_body_fat_percent,expectedFat);
 assert.ok(p.target.target_muscle_mass_kg>=muscle);
 const impossible=p.target.target_muscle_mass_kg>p.target.target_weight_kg*(1-p.target.target_body_fat_percent/100)+1e-9;
 assert.equal(p.issues.includes('target_muscle_exceeds_lean_mass'),impossible);
 if(impossible) counts.composition_review++;
 const score=scoreProgress(p,p.start);assert.equal(score.status,'scored');assert.ok(score.total>=0&&score.total<=100);
 const groupKey=`${p.goal_mode}/${p.age_group}/${sex}`;
 baseline[groupKey]||={count:0,total:0};baseline[groupKey].count++;baseline[groupKey].total+=score.total;
 if(!impossible){const s=scoreProgress(p,{weight_kg:p.target.target_weight_kg,bmi:p.target.target_bmi,body_fat_percent:p.target.target_body_fat_percent,muscle_mass_kg:p.target.target_muscle_mass_kg});close(s.total,100);endpointScored++;}
}
const personas=[
 ['ผอม อายุ25',{weight_kg:55,bmi:18,muscle_mass_kg:40}],
 ['ปกติ อายุ25',{weight_kg:65,bmi:23,muscle_mass_kg:35}],
 ['กล้ามเยอะ BMIสูง',{weight_kg:90,bmi:28,body_fat_percent:14,muscle_mass_kg:60}],
 ['น้ำหนักเกิน',{weight_kg:80,bmi:27,body_fat_percent:30,muscle_mass_kg:40}],
 ['อ้วน',{weight_kg:100,bmi:32,body_fat_percent:35,muscle_mass_kg:45}],
 ['อ้วนมาก',{weight_kg:125,bmi:40,body_fat_percent:45,muscle_mass_kg:45}],
 ['อายุ45',{age:45,weight_kg:80,bmi:27,body_fat_percent:30,muscle_mass_kg:40}],
 ['อายุ65',{age:65,weight_kg:80,bmi:27,body_fat_percent:30,muscle_mass_kg:40}],
 ['อายุ75',{age:75,weight_kg:80,bmi:27,body_fat_percent:30,muscle_mass_kg:40}],
 ['วัยรุ่น อายุ18',{age:18}]
].map(([name,changes])=>{
 const p=calculateGoals({...input,...changes},config);const score=p.start?scoreProgress(p,p.start):null;
 return {name,status:p.status,mode:p.goal_mode??null,start:p.start??null,target:p.target,issues:p.issues,baseline_score:score?.total??null};
});
const boundaries=[];
for(const [label,below,at]of [
 ['BMI18.5',{bmi:18.5-1e-6},{bmi:18.5}],
 ['BMI25/highfat',{weight_kg:80,bmi:25-1e-6,body_fat_percent:30},{weight_kg:80,bmi:25,body_fat_percent:30}],
 ['Age40/BUILD',{age:40-1e-6},{age:40}],
 ['Age65/BUILD',{age:65-1e-6},{age:65}],
 ['BFupper25/BMI27',{weight_kg:80,bmi:27,body_fat_percent:25},{weight_kg:80,bmi:27,body_fat_percent:25+1e-6}],
 ['BFlower10/BMI23',{bmi:23,body_fat_percent:10-1e-6},{bmi:23,body_fat_percent:10}]
]) {
 const a=calculateGoals({...input,...below},config),b=calculateGoals({...input,...at},config);
 boundaries.push({label,below:a.target,at:b.target,mode_before:a.goal_mode,mode_after:b.goal_mode,
  difference:Object.fromEntries(Object.keys(a.target).map(key=>[key,b.target[key]-a.target[key]]))});
}
// Narrow-target score sensitivity is mathematical, not a real-person measurement claim.
const sensitivity={target_distance_kg:.01,actual_noise_kg:.01,score_without_noise:progressScore(65,65,64.99),score_with_noise:progressScore(64.99,65,64.99)};
const finalPlan=calculateGoals(input,config),final=aggregateFinal(finalPlan,[145,146,150].map(day=>measurement(finalPlan,day)));
const finalCheck=rewardEligibility(finalPlan,scoreProgress(finalPlan,final.actual),final);
const report={seed:1502026,counts,endpoint_scored_cases:endpointScored,
 reference_notice:'All BF intervals are arbitrary synthetic test fixtures; NO real clinical reference table is installed.',
 user_policy:'Original formulas preserved exactly; discontinuities reported, not smoothed.',
 baseline_scores:Object.fromEntries(Object.entries(baseline).map(([key,v])=>[key,{count:v.count,mean:v.total/v.count}])),
 personas,boundaries,sensitivity,final_fixture_eligibility:finalCheck,
 limitations:['Arithmetic consistency only; not a physiological/clinical fairness study','Maintain zones yield baseline points','No real BF reference or muscle definition','Youth policy absent','Older adult and atypical BMI review required','No UI/database/reward integration']};
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/simulation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'PASS',...counts,endpoint_scored_cases:endpointScored,artifact:'artifacts/simulation.json'},null,2));
