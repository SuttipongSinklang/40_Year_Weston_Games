// Cosmetic travel milestones. These do not issue real trips or rewards.
export const MILESTONE_POINTS = 1000;
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

export function journeyForScore(value) {
  const score = whole(value);
  const reached = Math.min(PLACES.length, Math.floor(score / MILESTONE_POINTS));
  const stops = PLACES.map(([name, description], index) => {
    const stage = index + 1;
    const points = stage * MILESTONE_POINTS;
    // Locked UI data deliberately contains no destination name or image.
    return stage <= reached
      ? { stage, points, unlocked: true, name, description, art: index }
      : { stage, points, unlocked: false };
  });
  const next = stops[reached] || null;
  return {
    score, reached, stops, next,
    currentName: reached ? stops[reached - 1].name : 'จุดเริ่มต้น',
    remaining: next ? next.points - score : 0,
    progress: next ? score - reached * MILESTONE_POINTS : MILESTONE_POINTS,
    complete: next === null,
  };
}

export function journeyLayout(count = PLACES.length) {
  const gap = 205;
  // Leave space below the starting pad for the transparent navigation overlay.
  const height = count * gap + 460;
  const start = { x: 200, y: height - 250 };
  const points = [start, ...Array.from({ length: count }, (_, index) => ({
    x: index % 2 === 0 ? 112 : 282,
    y: start.y - (index + 1) * gap,
  }))];
  return { height, points };
}

export function journeyPath(points) {
  return points.map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const middle = (previous.y + point.y) / 2;
    return `C ${previous.x} ${middle} ${point.x} ${middle} ${point.x} ${point.y}`;
  }).join(' ');
}
