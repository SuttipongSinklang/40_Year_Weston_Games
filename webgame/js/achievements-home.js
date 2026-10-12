// Achievements (#6): badges unlocked from real data (workouts, streak, runs,
// missions, teams, championships). Newly earned badges are persisted with a
// toast, and the DB trigger announces them on the public activity feed.
import { playerSession, loadRunsFromCloud } from './data.js?v=20261012-2';
import { bangkokDay, streakFor } from './progress.js?v=20261012-2';

const el = id => document.getElementById(id);

const BADGES = [
  { code: 'first_tap', icon: '👣', label: 'ก้าวแรกสู่สุขภาพดี', description: 'ออกกำลังกายครั้งแรกกับตัวละคร', check: m => m.totalWorkouts >= 1 },
  { code: 'streak_3', icon: '🔥', label: 'ไฟไม่ดับ 3 วัน', description: 'ออกกำลังกายต่อเนื่อง 3 วัน', check: m => m.streak >= 3 },
  { code: 'streak_7', icon: '🌋', label: 'สาย 7 วันเต็ม', description: 'ออกกำลังกายต่อเนื่อง 7 วัน', check: m => m.streak >= 7 },
  { code: 'missions_10', icon: '🎯', label: 'นักทำภารกิจ', description: 'ทำภารกิจสำเร็จ 10 ครั้ง', check: m => m.completions >= 10 },
  { code: 'runner_5', icon: '🏃', label: 'นักวิ่งจิ๋ว', description: 'บันทึกการวิ่ง 5 รอบ', check: m => m.runs >= 5 },
  { code: 'marathon_42', icon: '🏅', label: 'สะสม 42 กม.', description: 'วิ่งสะสมระยะทาง 42 กม.', check: m => m.runKm >= 42 },
  { code: 'team_player', icon: '🤝', label: 'ทีมเพลย์เยอร์', description: 'เข้าร่วมทีม', check: m => m.hasTeam },
  { code: 'tournament_1', icon: '🎮', label: 'ลงสนามครั้งแรก', description: 'สมัครแข่งขันทัวร์นาเมนต์', check: m => m.tournaments >= 1 },
  { code: 'champion_1', icon: '🏆', label: 'แชมป์ครั้งแรก', description: 'ชนะเลิศทัวร์นาเมนต์', check: m => m.championships >= 1 },
  { code: 'cheer_50', icon: '📣', label: 'ก๊วนเชียร์', description: 'เชียร์ไป 50 ครั้ง', check: m => m.cheers >= 50 },
];

function toast(message) {
  const element = el('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3200);
}

async function loadMetrics() {
  const api = await playerSession();
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const [progress, days, completions, teams, entries, runsResult, cheers] = await Promise.all([
    api.from('weston_progress').select('total_workouts').eq('user_id', api.userId).maybeSingle(),
    api.from('weston_days').select('played_on').eq('user_id', api.userId).gte('played_on', since).limit(400),
    api.from('weston_mission_completions').select('mission_id').eq('user_id', api.userId).limit(2000),
    api.from('weston_team_members').select('team_id').eq('user_id', api.userId).limit(1),
    api.from('weston_participants').select('id,tournament_id').eq('user_id', api.userId).limit(100),
    loadRunsFromCloud().catch(() => ({ rows: [] })),
    api.from('weston_cheers').select('id').eq('user_id', api.userId).limit(1000),
  ]);
  if (progress.error) throw progress.error;
  if (days.error) throw days.error;
  if (completions.error) throw completions.error;
  if (teams.error) throw teams.error;
  if (entries.error) throw entries.error;
  if (cheers.error) throw cheers.error;
  let runKm = 0;
  for (const run of runsResult.rows) runKm += run.distance_m || 0;
  let championships = 0;
  const myIds = (entries.data || []).map(row => row.id);
  if (myIds.length) {
    const wins = await api.from('weston_matches').select('id')
      .in('winner_id', myIds).eq('status', 'completed').limit(1);
    if (!wins.error && wins.data?.length) championships = wins.data.length;
  }
  return {
    totalWorkouts: progress.data?.total_workouts || 0,
    streak: streakFor((days.data || []).map(row => row.played_on), bangkokDay()),
    completions: (completions.data || []).length,
    hasTeam: (teams.data || []).length > 0,
    tournaments: new Set((entries.data || []).map(row => row.tournament_id)).size,
    runs: runsResult.rows.length,
    runKm: Math.round(runKm / 100) / 10,
    championships,
    cheers: (cheers.data || []).length,
  };
}

function renderShelf(unlocked) {
  const list = el('goalList');
  if (!list) return;
  const earned = new Set(unlocked);
  list.insertAdjacentHTML('beforeend', `
    <div class="card summary-card badge-shelf">
      <h3>🏅 เหรียญตราของฉัน (${earned.size}/${BADGES.length})</h3>
      <div class="badge-row">
        ${BADGES.map(badge => `
          <span class="badge-chip ${earned.has(badge.code) ? 'earned' : ''}" title="${badge.label} — ${badge.description}">
            <i aria-hidden="true">${badge.icon}</i><small>${badge.label}</small>
          </span>`).join('')}
      </div>
      <p class="t-help" style="padding:0 4px">ปลดล็อกจากกิจกรรมจริง — ออกกำลังกาย วิ่ง ทำภารกิจ และลงแข่ง เพื่อเก็บให้ครบ!</p>
    </div>`);
}

async function load() {
  if (!navigator.onLine) return;
  try {
    const api = await playerSession();
    const [metrics, unlocked] = await Promise.all([
      loadMetrics(),
      api.from('weston_achievements').select('code').eq('user_id', api.userId).limit(100),
    ]);
    if (unlocked.error) throw unlocked.error;
    const earned = new Set((unlocked.data || []).map(row => row.code));
    for (const badge of BADGES) {
      if (earned.has(badge.code) || !badge.check(metrics)) continue;
      const insert = await api.from('weston_achievements')
        .insert({ user_id: api.userId, code: badge.code, label: badge.label });
      if (!insert.error) toast(`🏅 ปลดล็อกเหรียญตรา: ${badge.label}`);
      earned.add(badge.code);
    }
    // goals-home.js rewrites #goalList when real goals load — wait for it so
    // the shelf lands after (and survives) that render.
    const wait = setInterval(() => {
      if (!window.westonGoalsRendered) return;
      clearInterval(wait);
      el('goalList')?.querySelector('.badge-shelf')?.remove();
      renderShelf(earned);
    }, 300);
    setTimeout(() => clearInterval(wait), 10000);
  } catch { /* achievements are optional; shelf stays hidden on failure */ }
}

void load();
