export type Sex='male'|'female';
export type GoalMode='BUILD'|'RECOMP'|'MAINTAIN_PLUS'|'CUT';
export type AgeGroup='YOUTH'|'YOUNG_ADULT'|'MIDDLE_ADULT'|'OLDER_ADULT';
export interface Metrics {weight_kg:number;bmi:number;body_fat_percent:number;muscle_mass_kg:number}
export interface Input extends Metrics {age:number;sex:Sex;height_cm?:number}
export interface Targets {target_weight_kg:number|null;target_bmi:number|null;target_body_fat_percent:number|null;target_muscle_mass_kg:number|null}
export interface BodyFatRange {sex:Sex;age_min:number;age_max:number;bf_low:number;bf_high:number}
export interface BodyFatReference {id:string;version:string;source:string;status:'simulation_only'|'approved_external';ranges:BodyFatRange[]}
export interface YouthGrowthReference {
 id:string;version:string;source:string;
 lookup(input:{age_months:number;sex:Sex;bmi:number}):{z_score:number;percentile:number}|null;
 // A lookup does not authorize adult formulas: youth goal policy is still required.
}
export interface Config {bodyFatReference?:BodyFatReference;muscleDefinition?:string;deviceId?:string;startDate?:string}
export interface Zone {min:number;max:number|null}
export interface BasePlan {status:'invalid_input'|'needs_reference'|'needs_review'|'calculated';issues:readonly string[];experimental:true;production_ready:false;duration_days:150;rule_version:string;target:Readonly<Targets>}
export interface BlockedPlan extends BasePlan {status:'invalid_input'|'needs_reference'}
export type NumericTargets={ [Key in keyof Targets]:number };
export interface CalculatedPlan extends BasePlan {
 status:'needs_review'|'calculated';goal_mode:GoalMode;age_group:AgeGroup;start:Readonly<Metrics>;
 target:Readonly<NumericTargets>;
 zones:Readonly<Partial<Record<keyof Metrics,Zone>>>;height_m:number;start_date:string|null;device_id:string|null;
 muscle_definition:string;reference:BodyFatRange & {id:string;version:string;source:string;status:BodyFatReference['status']};simulation_only:boolean;
 audit:Readonly<Record<string,unknown>>;
}
export type Plan=BlockedPlan|CalculatedPlan;
export interface Measurement extends Metrics {measurement_id:string;measured_at:string;device_id:string;muscle_definition:string;
 suspicious_measurement?:boolean;status?:'pending'|'rejected'|'accepted';
 review?:{decision:'accepted';reviewer_id:string;reason:string;reviewed_at:string}}
export interface MeasurementPolicy {bmiTolerance?:number;muscleJumpKg?:number;fatDropPoints?:number;minimumFinalDays?:number}
export interface Validation {valid:boolean;accepted:boolean;errors:readonly string[];flags:readonly string[];reviewed?:boolean}
export interface Score {status:'invalid'|'scored';issues:readonly string[];scores:Readonly<Metrics>|null;total:number|null;flags:readonly string[]}
export interface FinalResult {valid:boolean;issues:readonly string[];actual:Readonly<Metrics>|null;valid_days?:number;included_ids?:readonly string[];per_day?:readonly unknown[];validation?:readonly unknown[];source?:string;plan_identity?:string}
export interface PlanReview {reviewer_id:string;reason:string;reviewed_at:string;resolved_issues:string[]}
export function reviewGoalPlan(plan:CalculatedPlan,review:PlanReview):CalculatedPlan;
export function calculateGoals(input:Input,config?:Config):Plan;
export function ageGroup(age:number):AgeGroup;
export function goalMode(bmi:number,bodyFat:number,reference:Pick<BodyFatRange,'bf_low'|'bf_high'>):GoalMode;
export function weightGoal(weight:number,bmi:number,bodyFat:number,upper:number,mode:GoalMode):{value:number;percent:number;excess_fat:number;formula:string};
export function bmiGoal(weight:number,heightM:number):number;
export function bodyFatGoal(current:number,reference:Pick<BodyFatRange,'bf_low'|'bf_high'>):{value:number;formula:string};
export function muscleGoal(current:number,mode:GoalMode,group:AgeGroup):{value:number;percent:number;formula:string};
export function getBodyFatReference(reference:BodyFatReference,age:number,sex:Sex):(BodyFatRange & {id:string;version:string;source:string;status:BodyFatReference['status']})|null;
export function validateInput(input:Input):{valid:boolean;issues:string[]};
export function compositionIssues(weight:number,fat:number,muscle:number):string[];
export function validateMeasurement(measurement:Measurement,plan:CalculatedPlan,previous?:Measurement|null,policy?:MeasurementPolicy):Validation;
export function validateHistory(history:Measurement[],plan:CalculatedPlan,policy?:MeasurementPolicy):readonly {measurement:Measurement;validation:Validation}[];
export function progressScore(actual:number,start:number,target:number,zone?:Zone|null,policy?:{maintenanceTaper?:number}):number;
export function scoreProgress(plan:CalculatedPlan,actual:Metrics,policy?:{maintenanceTaper?:number}):Score;
export function aggregateFinal(plan:CalculatedPlan,history:Measurement[],policy?:MeasurementPolicy):FinalResult;
export function rewardEligibility(plan:Plan,score:Score,finalResult:FinalResult):{eligible:boolean;numerically_qualified:boolean;reasons:readonly string[];production_ready:false;award_issued:false};
export function milestone(plan:CalculatedPlan,day:number,curve?:(fraction:number)=>number):{day:number;target:Readonly<Targets>};
export function milestones(plan:CalculatedPlan,curve?:(fraction:number)=>number):readonly {day:number;target:Readonly<Targets>}[];
export const RULE_VERSION:string;
export const SCORE_WEIGHTS:Readonly<Record<keyof Metrics,number>>;
export const MEASUREMENT_POLICY:Readonly<Required<MeasurementPolicy>>;
export const ADULT_BMI_REFERENCE:Readonly<{id:string;version:string;low:number;high:number}>;
export const MUSCLE_GROWTH:Readonly<Record<GoalMode,Record<Exclude<AgeGroup,'YOUTH'>,number>>>;
