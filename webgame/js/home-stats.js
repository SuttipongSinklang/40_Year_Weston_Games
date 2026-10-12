// Real home-screen HUD data (#2 stats strip, #3 day streak, #4 goal ring).
// Reads the player's own profile/history/days/daily-missions; keeps the mockup
// numbers untouched whenever real data is missing.
import { playerSession, loadRunsFromCloud } from './data.js?v=20261012-2';
import { bangkokDay, streakFor } from './progress.js?v=20261012-2';

const el = id => document.getElementById(id);
const TARGET_TAPS_PER_DAY = 3;
let todayTaps = 0;
let knownDays = [];
let dailyMissionDone = 0;
let dailyMissionTotal = 0;
let ringParts = 1;

function bangkokToday() { return bangkokDay(); }

// ค่าสถิติชุดที่เคยแสดงล่าสุด — ใช้เป็นตัวเทียบเมื่อยังไม่มีประวัติย้อนหลัง
const PREV_STATS_KEY = 'weston-prev-stats';
function readPrevStats() { try { return JSON.parse(localStorage.getItem(PREV_STATS_KEY) || 'null'); } catch { return null; } }
function writePrevStats(values) { try { localStorage.setItem(PREV_STATS_KEY, JSON.stringify(values)); } catch { /* ข้าม */ } }

async function loadOwnDayRows() {
  const api = await playerSession();
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const { data, error } = await api.from('weston_days')
    .select('played_on,workouts').gte('played_on', since).order('played_on', { ascending: false }).limit(400);
  if (error) throw error;
  return data || [];
}

async function loadProfileAndHistory() {
  const api = await playerSession();
  const [profile, history] = await Promise.all([
    api.from('weston_health_profiles').select('weight_kg,bmi,body_fat_percent,muscle_mass_kg,measured_at')
      .eq('user_id', api.userId).maybeSingle(),
    api.from('weston_health_history').select('recorded_on,weight_kg,bmi,body_fat_percent,muscle_mass_kg')
      .eq('user_id', api.userId).order('recorded_on', { ascending: true }).limit(120),
  ]);
  if (profile.error) throw profile.error;
  if (history.error) throw history.error;
  return { profile: profile.data, history: history.data || [] };
}

async function loadDailyMissions() {
  const api = await playerSession();
  const [missions, completions] = await Promise.all([
    api.from('weston_missions').select('id,reset_daily').eq('status', 'active').limit(100),
    api.from('weston_mission_completions').select('mission_id,day')
      .eq('user_id', api.userId).gte('completed_at', new Date(Date.now() - 2 * 864e5).toISOString()).limit(200),
  ]);
  if (missions.error || completions.error) return { done: 0, total: 0 };
  const today = bangkokToday();
  const daily = (missions.data || []).filter(mission => mission.reset_daily);
  const doneToday = new Set((completions.data || []).filter(row => row.day === today).map(row => row.mission_id));
  return { done: daily.filter(mission => doneToday.has(mission.id)).length, total: daily.length };
}

function renderStats({ profile, history }) {
  if (!profile) {
    // ยังไม่กรอกข้อมูลสุขภาพ: แสดงค่าว่างแทนตัวเลขตัวอย่าง (dialog onboarding จะเด้งเอง)
    for (const id of ['statFat', 'statMuscle', 'statBmi', 'statWeight']) {
      const node = document.getElementById(id);
      const b = node?.querySelector('b');
      if (b) b.textContent = '—';
      node?.querySelector('em')?.setAttribute('hidden', '');
    }
    return;
  }
  const units = ['%', ' กก.', '', ' กก.'];
  const cards = [
    { id: 'statFat', value: profile.body_fat_percent, decimals: 1 },
    { id: 'statMuscle', value: profile.muscle_mass_kg, decimals: 1 },
    { id: 'statBmi', value: profile.bmi, decimals: 1 },
    { id: 'statWeight', value: profile.weight_kg, decimals: 1 },
  ];
  // ตัวเทียบ: การวัดล่าสุดของ "วันก่อนหน้า" (แถวของวันนี้คือค่าปัจจุบันแล้ว)
  // ถ้ายังไม่มีประวัติวันก่อน ใช้ค่าที่เคยแสดงไว้ล่าสุด (ค่าที่กรอกก่อนหน้า) เพื่อให้แก้สถิติแล้วเห็นลูกศรทันที
  const today = bangkokToday();
  const previousDays = (history || []).filter(row => row.recorded_on !== today);
  const older = previousDays.length ? previousDays[previousDays.length - 1] : readPrevStats();
  const fields = ['body_fat_percent', 'muscle_mass_kg', 'bmi', 'weight_kg'];
  cards.forEach((card, index) => {
    const node = document.getElementById(card.id);
    if (!node || card.value == null) return;
    const b = node.querySelector('b');
    b.textContent = Number(card.value).toFixed(card.decimals) + units[index];
    if (older && older[fields[index]] != null && Number(older[fields[index]]) !== Number(card.value)) {
      const delta = Number(card.value) - Number(older[fields[index]]);
      // ถ้าช่องลูกศรหายไปจาก DOM ให้สร้างใหม่ กันจอดเงียบ
      let em = node.querySelector('em');
      if (!em) { em = document.createElement('em'); em.hidden = true; b.after(em); }
      em.hidden = false;
      em.textContent = `${delta >= 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(1)}`;
    } else {
      node.querySelector('em')?.setAttribute('hidden', '');
    }
  });
  writePrevStats({ body_fat_percent: profile.body_fat_percent, muscle_mass_kg: profile.muscle_mass_kg, bmi: profile.bmi, weight_kg: profile.weight_kg });
}

function renderStreak(days) {
  el('streakDay').textContent = streakFor(days.map(row => row.played_on));
}

function ringPercent() {
  const tapPart = Math.min(1, todayTaps / TARGET_TAPS_PER_DAY);
  if (dailyMissionTotal > 0) {
    ringParts = 2;
    return Math.round(((tapPart + (dailyMissionDone / dailyMissionTotal)) / 2) * 100);
  }
  ringParts = 1;
  return Math.round(tapPart * 100);
}

function renderRing() {
  const pct = Math.min(100, ringPercent());
  el('goalPct').textContent = pct;
  el('goalFill').style.width = `${pct}%`;
  window.westonGoalPct = pct;
}

// main.js calls this after every character tap: optimistic bump that matches
// the server truth closely enough until the next full reload.
window.westonNoteTap = function noteTap() {
  const firstOfDay = todayTaps === 0;
  todayTaps += 1;
  if (firstOfDay) renderStreak([...knownDays, { played_on: bangkokToday() }]); // streak +1 ทันทีเมื่อเล่นครั้งแรกของวัน
  const pct = Math.min(100, ringPercent());
  const step = Math.ceil(100 / (TARGET_TAPS_PER_DAY * ringParts));
  el('goalPct').textContent = pct;
  el('goalFill').style.width = `${Math.min(100, pct)}%`;
  window.westonGoalPct = pct;
  return { pct, step };
};

async function load() {
  if (!navigator.onLine) return;
  const days = await loadOwnDayRows().catch(() => []);
  knownDays = days;
  renderStreak(days); // ยังไม่มีข้อมูลก็โชว์ค่าจริง 0 แทนตัวเลขตัวอย่าง
  if (days.length) {
    const today = bangkokToday();
    todayTaps = days.find(row => row.played_on === today)?.workouts || 0;
  }
  const missions = await loadDailyMissions().catch(() => ({ done: 0, total: 0 }));
  dailyMissionDone = missions.done;
  dailyMissionTotal = missions.total;
  renderRing();
  loadProfileAndHistory().then(renderStats).catch(() => { /* mock numbers stay */ });
}

void load();

// แก้ข้อมูลสุขภาพในหน้าโปรไฟล์แล้ว ให้รีเฟรชสถิติบนหน้าแรกทันที (มี debounce กันยิงรัว ๆ)
let statsReloadTimer;
window.addEventListener('profilechange', () => {
  clearTimeout(statsReloadTimer);
  statsReloadTimer = setTimeout(() => { void load(); }, 800);
});
