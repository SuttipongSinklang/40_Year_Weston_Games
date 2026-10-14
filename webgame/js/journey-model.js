// Cosmetic travel milestones. These do not issue real trips or rewards.
export const MILESTONE_POINTS = 1000;
export const NEAR_UNLOCK_POINTS = 100;
// Display configuration for future checkpoint benefits; no rewards are issued.
// For example: { 1: { type: 'stay_duration', days: 5,
//   title: 'เพิ่มวันพักหัวหิน', description: 'เพิ่มจาก 3 วัน เป็น 5 วัน' } }.
// Leave unconfigured until the benefit and its actual award rules are approved.
export const CHECKPOINT_BENEFITS = {};
const PLACES = [
  ['หัวหิน', 'ลมทะเล แสงแดด และก้าวแรกแห่งความสำเร็จ'],
  ['เชียงใหม่', 'ขึ้นเหนือไปสัมผัสขุนเขาและแสงทองของดอยสุเทพ'],
  ['ไต้หวัน', 'ออกเดินทางข้ามทะเล สู่เมืองแห่งโคมไฟและตึกไทเป 101'],
  ['ญี่ปุ่น', 'พบฟูจิและซากุระ ในการเดินทางที่คุณสร้างด้วยตัวเอง'],
  ['เกาหลีใต้', 'เดินเล่นท่ามกลางพระราชวังและใบไม้เปลี่ยนสี'],
];

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number))) : 0;
}

// Matches leaderboard-home.js: ten points per workout plus awarded missions.
export function travelScore(workouts, missionPoints = 0) {
  return Math.min(Number.MAX_SAFE_INTEGER, whole(workouts) * 10 + whole(missionPoints));
}

export function journeyForScore(value, checkpointBenefits = CHECKPOINT_BENEFITS) {
  const score = whole(value);
  const reached = Math.min(PLACES.length, Math.floor(score / MILESTONE_POINTS));
  const stops = PLACES.map(([name, description], index) => {
    const stage = index + 1;
    const points = stage * MILESTONE_POINTS;
    // Locked UI data deliberately contains no destination name or image.
    return stage <= reached
      ? { stage, points, unlocked: true, name, description, art: index }
      : { stage, points, unlocked: false, nearUnlock: points - score <= NEAR_UNLOCK_POINTS };
  });
  const next = stops[reached] || null;
  const checkpoints = stops.slice(0, -1).map(stop => {
    const point = {
      stage: stop.stage,
      position: stop.stage + .5,
      points: stop.points + MILESTONE_POINTS / 2,
      unlocked: score >= stop.points + MILESTONE_POINTS / 2,
      nearUnlock: score < stop.points + MILESTONE_POINTS / 2 && stop.points + MILESTONE_POINTS / 2 - score <= NEAR_UNLOCK_POINTS,
    };
    // Like destinations, locked checkpoints do not expose their contents.
    return point.unlocked ? { ...point, benefit: checkpointBenefits[stop.stage] || null } : point;
  });
  const checkpoint = checkpoints.find(point => point.stage === reached && point.unlocked) || null;
  const anchorPosition = checkpoint ? checkpoint.position : reached;
  const position = Math.min(PLACES.length, score / MILESTONE_POINTS);
  const anchorName = checkpoint ? `เช็คพอยต์หลัง${stops[reached - 1].name}` : reached ? stops[reached - 1].name : 'จุดเริ่มต้น';
  return {
    score, reached, stops, next, checkpoints,
    position, anchorPosition, isTravelling: position !== anchorPosition,
    currentName: position === anchorPosition ? anchorName : `ระหว่างทางจาก${anchorName}`,
    remaining: next ? next.points - score : 0,
    progress: next ? score - reached * MILESTONE_POINTS : MILESTONE_POINTS,
    complete: next === null,
  };
}

export function journeyLayout(count = PLACES.length) {
  const gap = 300;
  // Leave space below the starting pad for the transparent navigation overlay.
  const height = count * gap + 460;
  const start = { x: 200, y: height - 250 };
  const points = [start, ...Array.from({ length: count }, (_, index) => ({
    x: index % 2 === 0 ? 112 : 282,
    y: start.y - (index + 1) * gap,
  }))];
  return { height, points };
}

function partialSegment(from, to, t) {
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const middle = (from.y + to.y) / 2;
  const a = mix(from, { x: from.x, y: middle });
  const b = mix({ x: from.x, y: middle }, { x: to.x, y: middle });
  const c = mix({ x: to.x, y: middle }, to);
  const control = mix(a, b);
  return { first: a, control, point: mix(control, mix(b, c)) };
}

export function journeyMapPoint(layout, position) {
  const index = Math.max(0, Math.min(layout.points.length - 1, Math.floor(position)));
  const from = layout.points[index];
  return position % 1 && index + 1 < layout.points.length
    ? partialSegment(from, layout.points[index + 1], position % 1).point
    : from;
}

export function journeyPath(points, position = points.length - 1) {
  const index = Math.max(0, Math.min(points.length - 1, Math.floor(position)));
  let path = points.slice(0, index + 1).map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const middle = (previous.y + point.y) / 2;
    return `C ${previous.x} ${middle} ${point.x} ${middle} ${point.x} ${point.y}`;
  }).join(' ');
  if (position % 1 && index + 1 < points.length) {
    const { first, control, point } = partialSegment(points[index], points[index + 1], position % 1);
    path += ` C ${first.x} ${first.y} ${control.x} ${control.y} ${point.x} ${point.y}`;
  }
  return path;
}
