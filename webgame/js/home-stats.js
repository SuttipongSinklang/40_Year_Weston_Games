// Real home-screen HUD data (#2 stats strip, #3 day streak, #4 goal ring).
// Reads the player's own profile/history/days/daily-missions; keeps the mockup
// numbers untouched whenever real data is missing.
import { playerSession, loadRunsFromCloud } from './data.js';
import { bangkokDay, streakFor } from './progress.js';

const el = id => document.getElementById(id);
const TARGET_TAPS_PER_DAY = 3;
let todayTaps = 0;
let dailyMissionDone = 0;
let dailyMissionTotal = 0;
let ringParts = 1;

function bangkokToday() { return bangkokDay(); }

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
    api.from('weston_health_profiles').select('weight_kg,bmi,body_fat_percent,muscle_mass_kg,updated_at')
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
  if (!profile) return; // no profile yet — the onboarding dialog handles that
  const cards = [
    { id: 'statFat', value: profile.body_fat_percent, decimals: 1 },
    { id: 'statMuscle', value: profile.muscle_mass_kg, decimals: 1 },
    { id: 'statBmi', value: profile.bmi, decimals: 1 },
    { id: 'statWeight', value: profile.weight_kg, decimals: 1 },
  ];
  // Compare against the earliest record of the last ~30 days for a real trend.
  const older = history.length > 1 ? history[Math.max(0, history.length - 2)] : null;
  const fields = ['body_fat_percent', 'muscle_mass_kg', 'bmi', 'weight_kg'];
  cards.forEach((card, index) => {
    const node = document.getElementById(card.id);
    if (!node || card.value == null) return;
    const b = node.querySelector('b');
    const em = node.querySelector('em');
    b.textContent = Number(card.value).toFixed(card.decimals);
    if (older && older[fields[index]] != null) {
      const delta = Number(card.value) - Number(older[fields[index]]);
      em.hidden = false;
      em.textContent = `${delta >= 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(1)}`;
    } else {
      em.hidden = true;
    }
  });
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
  todayTaps += 1;
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
  if (days.length) {
    renderStreak(days);
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
