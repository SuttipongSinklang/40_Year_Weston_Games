import { METRICS, immutable } from './util.mjs';
export function milestone(plan,day,curve=fraction=>fraction) {
  if (!plan?.start || !Number.isFinite(day) || day<0 || day>150 || typeof curve!=='function') throw new Error('Invalid milestone');
  const value=curve(day/150);
  if (!Number.isFinite(value) || value<0 || value>1 || curve(0)!==0 || curve(1)!==1) throw new Error('Invalid curve');
  return immutable({day,target:Object.fromEntries(METRICS.map(key=>[`target_${key}`,plan.start[key]+(plan.target[`target_${key}`]-plan.start[key])*value]))});
}
export function milestones(plan,curve) {return [30,60,90,120,150].map(day=>milestone(plan,day,curve));}
