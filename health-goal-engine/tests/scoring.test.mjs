import test from 'node:test';import assert from 'node:assert/strict';
import {calculateGoals,scoreProgress,progressScore,rewardEligibility,aggregateFinal,validateMeasurement,validateHistory} from '../index.mjs';
import {config,input,measurement,TEST_REFERENCE} from './fixtures.mjs';
test('increase/decrease progress caps and maintain-zone taper handle zero denominator',()=>{
 assert.equal(progressScore(100,100,92),0);assert.equal(progressScore(92,100,92),100);assert.equal(progressScore(88,100,92),100);
 assert.equal(progressScore(10,10,12),0);assert.equal(progressScore(11,10,12),50);
 assert.equal(progressScore(65,65,65,{min:64.025,max:65.975}),100);
 assert.equal(progressScore(63,65,65,{min:64.025,max:65.975}),0);
 assert.throws(()=>progressScore(65,65,65));assert.throws(()=>progressScore(NaN,1,2));
});
test('missing actuals cannot receive fabricated points; baseline maintenance gets60',()=>{
 const p=calculateGoals({...input,bmi:23,muscle_mass_kg:30},config);
 assert.equal(scoreProgress(p,p.start).total,60);
 assert.equal(scoreProgress(p,{weight_kg:55}).status,'invalid');
});
test('overshoot no extra score and requires reward review',()=>{
 const p=calculateGoals(input,config),actual={weight_kg:60,bmi:60/p.height_m**2,body_fat_percent:20,muscle_mass_kg:42};
 const score=scoreProgress(p,actual);assert.equal(score.total,100);assert.ok(score.flags.includes('overshoot_weight_kg'));
 assert.equal(rewardEligibility(p,score,{valid:true}).eligible,false);
});
test('reward score85 plus all70; no reward on provisional references or absent final',()=>{
 const p=calculateGoals(input,config),r=aggregateFinal(p,[145,146,150].map(day=>measurement(p,day))),s=scoreProgress(p,r.actual);
 assert.equal(s.total,100);assert.equal(rewardEligibility(p,s,r).numerically_qualified,true);
 assert.equal(rewardEligibility(p,s,r).eligible,false);
 const approved=calculateGoals(input,{...config,bodyFatReference:{...TEST_REFERENCE,status:'approved_external'}});
 const approvedFinal=aggregateFinal(approved,[145,146,150].map(day=>measurement(approved,day)));
 assert.equal(rewardEligibility(approved,scoreProgress(approved,approvedFinal.actual),approvedFinal).eligible,true);
 assert.equal(rewardEligibility(approved,s,r).eligible,false,'final data must be bound to the same plan');
 assert.equal(rewardEligibility(approved,s,null).eligible,false);
 assert.equal(rewardEligibility(approved,{status:'scored',total:90,scores:{weight_kg:100,bmi:100,body_fat_percent:69,muscle_mass_kg:100},flags:[]},r).eligible,false);
});
test('final requires multiple distinct days and excludes outside145-150',()=>{
 const p=calculateGoals(input,config);
 assert.equal(aggregateFinal(p,[measurement(p,145)]).valid,false);
 assert.equal(aggregateFinal(p,[measurement(p,144),measurement(p,145),measurement(p,151)]).valid,false);
 assert.equal(aggregateFinal(p,[145,146,150].map(day=>measurement(p,day))).valid,true);
 assert.equal(aggregateFinal(p,[],{minimumFinalDays:1}).valid,false);
});
test('median final handles outlier and recomputes BMI, independent of input order',()=>{
 const p=calculateGoals(input,config),history=[measurement(p,145,{weight_kg:57}),measurement(p,146,{weight_kg:58}),measurement(p,150,{weight_kg:65})];
 const r=aggregateFinal(p,history);assert.equal(r.actual.weight_kg,58);assert.equal(r.actual.bmi,58/p.height_m**2);
 assert.deepEqual(r.actual,aggregateFinal(p,[...history].reverse()).actual);
});
test('Bangkok day boundary determines final window',()=>{
 const p=calculateGoals(input,config),m=measurement(p,145);const utc=new Date(m.measured_at);utc.setUTCHours(17,0,0,0);
 const result=aggregateFinal(p,[{...m,measured_at:utc.toISOString()},measurement(p,147),measurement(p,150)]);
 assert.equal(result.valid,true);assert.equal(result.per_day[0].date,'2026-05-26');
});
test('same-day repetitions do not dominate median or quorum; duplicates rejected',()=>{
 const p=calculateGoals(input,config),base=[145,146,150].map(day=>measurement(p,day));
 assert.equal(aggregateFinal(p,[base[0],base[0],base[1],base[2]]).valid,false);
 const many=[base[0],...Array.from({length:10},(_,i)=>measurement(p,145,{measurement_id:`repeat${i}`,measured_at:new Date(Date.parse(base[0].measured_at)+i+1).toISOString(),weight_kg:56})),base[1],base[2]];
 assert.equal(aggregateFinal(p,many).actual.weight_kg,58.85);
});
test('suspicious jumps require documented review; invalid values and devices cannot be cleared',()=>{
 const p=calculateGoals(input,config),previous=measurement(p,145,{muscle_mass_kg:30,body_fat_percent:30});
 const m=measurement(p,146,{muscle_mass_kg:34,body_fat_percent:24});
 assert.equal(validateMeasurement(m,p,previous).accepted,false);
 const reviewed={...m,review:{decision:'accepted',reviewer_id:'reviewer',reason:'repeat verified',reviewed_at:'2026-06-01T00:00:00Z'}};
 assert.equal(validateMeasurement(reviewed,p,previous).accepted,true);
 assert.equal(validateMeasurement({...reviewed,device_id:'other'},p,previous).accepted,false);
 assert.equal(validateMeasurement({...reviewed,muscle_mass_kg:99},p,previous).accepted,false);
 assert.equal(validateHistory([m,m],p).every(row=>!row.validation.accepted),true);
});
