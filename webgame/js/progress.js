export const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});
export function bangkokDay(date = new Date()) { return DAY_FORMAT.format(date); }
export function progressFor(total) {
  const taps = Math.max(0, Math.trunc(Number(total) || 0));
  const score = taps * 6 + Math.floor(taps / 5) * 100;
  return { taps, score, level: Math.floor(score / 100) + 1, xp: score % 100,
    missionDone: taps % 5, missionIndex: Math.floor(taps / 5) % 4,
    coins: Math.floor(taps / 5) * 25 };
}
export function streakFor(days, today = bangkokDay()) {
  const active = new Set(days);
  const cursor = new Date(`${today}T12:00:00+07:00`);
  if (!active.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let count = 0;
  while (active.has(bangkokDay(cursor))) { count++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return count;
}
