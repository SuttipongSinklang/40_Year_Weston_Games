// Real calendar (#1): workout days from weston_days, mission points per day,
// match days from scheduled matches, and a real monthly summary. The mockup
// grid is replaced on first successful load.
import { playerSession, loadRunsFromCloud } from './data.js?v=20261012-2';
import { bangkokDay } from './progress.js?v=20261012-2';

const el = id => document.getElementById(id);
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const now = new Date(Date.now() + 7 * 3600e3); // Bangkok wall clock anchor
let viewYear = now.getUTCFullYear();
let viewMonth = now.getUTCMonth(); // 0-based
const todayKey = bangkokDay();

function monthKey(year, month) { return `${year}-${String(month + 1).padStart(2, '0')}`; }

async function fetchMonthData(year, month) {
  const api = await playerSession();
  const first = `${monthKey(year, month)}-01`;
  const endDate = new Date(Date.UTC(year, month + 1, 1));
  const last = endDate.toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(year, month, 1, -7)).toISOString();
  const monthEnd = new Date(Date.UTC(year, month + 1, 1, -7)).toISOString();
  const [days, completions, matches, runsResult] = await Promise.all([
    api.from('weston_days').select('played_on,workouts').gte('played_on', first).lte('played_on', last).limit(62),
    api.from('weston_mission_completions').select('day,points_awarded')
      .eq('user_id', api.userId).gte('completed_at', monthStart).lte('completed_at', monthEnd).limit(500),
    api.from('weston_matches').select('scheduled_at').not('scheduled_at', 'is', null)
      .gte('scheduled_at', monthStart).lte('scheduled_at', monthEnd).limit(500),
    loadRunsFromCloud().catch(() => ({ rows: [] })),
  ]);
  if (days.error) throw days.error;
  if (completions.error) throw completions.error;
  if (matches.error) throw matches.error;
  const pointsByDay = new Map();
  for (const row of completions.data || []) {
    pointsByDay.set(row.day, (pointsByDay.get(row.day) || 0) + (row.points_awarded || 0));
  }
  const matchesByDay = new Set((matches.data || []).map(row =>
    new Date(row.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })));
  let monthKm = 0;
  for (const run of runsResult.rows) {
    const day = new Date(run.started_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (day.startsWith(monthKey(year, month))) monthKm += run.distance_m || 0;
  }
  return {
    days: days.data || [],
    pointsByDay,
    matchesByDay,
    monthKm: Math.round((monthKm / 1000) * 10) / 10,
  };
}

function render(year, month, data) {
  el('calTitle').textContent = `${THAI_MONTHS[month]} ${year + 543}`;
  const grid = el('calDays');
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const workoutsByDay = new Map(data.days.map(row => [row.played_on, row.workouts]));
  let html = '';
  for (let i = 0; i < firstWeekday; i++) html += '<span class="cal-day dim"></span>';
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${monthKey(year, month)}-${String(day).padStart(2, '0')}`;
    const classes = ['cal-day'];
    if (key === todayKey) classes.push('today');
    if (workoutsByDay.has(key)) classes.push('done');
    if (data.matchesByDay.has(key)) classes.push('matchday');
    const points = data.pointsByDay.get(key);
    html += `<span class="${classes.join(' ')}" ${points ? `title="ได้ ${points} แต้มภารกิจวันนี้"` : ''}>${day}</span>`;
  }
  grid.innerHTML = html;
  const monthDays = data.days.length;
  const monthTaps = data.days.reduce((sum, row) => sum + row.workouts, 0);
  const monthPoints = [...data.pointsByDay.values()].reduce((sum, value) => sum + value, 0);
  const summary = el('calSummary');
  if (summary) {
    summary.innerHTML = `
      <div><b>${monthDays}</b><small>วันที่ออกกำลังกาย</small></div>
      <div><b>${monthTaps}</b><small>จำนวนครั้งรวม</small></div>
      <div><b>${monthPoints}</b><small>แต้มภารกิจของเดือน</small></div>
      <div><b>${data.monthKm}</b><small>กม. วิ่งของเดือน</small></div>`;
  }
}

async function show(year, month) {
  el('calTitle').textContent = `${THAI_MONTHS[month]} ${year + 543} …`;
  try {
    const data = await fetchMonthData(year, month);
    render(year, month, data);
  } catch { /* keep previous view when a month fails to load */ }
}

function wire() {
  const [prev, next] = document.querySelectorAll('.cal-nav button');
  prev?.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    void show(viewYear, viewMonth);
  });
  next?.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    void show(viewYear, viewMonth);
  });
  const legend = document.querySelector('.cal-legend');
  if (legend && !legend.querySelector('.dot.match')) {
    legend.insertAdjacentHTML('beforeend', '<span><i class="dot match"></i> มีการแข่งขัน</span>');
  }
}

wire();
void show(viewYear, viewMonth);
