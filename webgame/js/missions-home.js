// Renders admin-created missions inside the home mission card and records
// completions. Run missions verify against the player's real saved runs
// server-side; daily missions reset every Bangkok day. Keeps the built-in mock
// mission when the missions tables are missing, offline, or empty.
import { loadRunsFromCloud } from './data.js';
import {
  listActiveMissions, listMyCompletions, completeMission, completeRunMission,
  friendlyMissionError,
} from './missions-cloud.js?v=20261012-1';

const el = id => document.getElementById(id);
let missions = [];
let doneTodayIds = new Set();
let doneEverIds = new Set();
let claiming = false;
let runStats = { meters: 0, count: 0, todayMeters: 0, todayCount: 0 };

function toast(message) {
  const element = el('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2600);
}

function bangkokToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function currentMission() {
  return missions.find(mission => !isDone(mission)) || null;
}

function isDone(mission) {
  return mission.resetDaily ? doneTodayIds.has(mission.id) : doneEverIds.has(mission.id);
}

function progressOf(mission) {
  if (mission.verifyType === 'run_distance') {
    const target = mission.targetValue * 1000; // target stored in km
    const value = mission.resetDaily ? runStats.todayMeters : runStats.meters;
    return Math.min(1, target ? value / target : 0);
  }
  if (mission.verifyType === 'run_count') {
    const value = mission.resetDaily ? runStats.todayCount : runStats.count;
    return Math.min(1, mission.targetValue ? value / mission.targetValue : 0);
  }
  return isDone(mission) ? 1 : 0;
}

function render() {
  if (!missions.length) return;
  const done = missions.filter(isDone).length;
  const current = currentMission();
  el('missionDone').textContent = done;
  el('missionTotal').textContent = missions.length;
  el('missionFill').style.width = `${Math.round((done / missions.length) * 100)}%`;
  const hint = document.querySelector('#missionCard .tap-hint');
  const claim = el('missionClaim');
  if (current) {
    const kindLabel = current.resetDaily ? 'รายวัน · ' : '';
    el('missionName').textContent = `${current.icon} ${current.title}`;
    const progress = progressOf(current);
    if (current.verifyType === 'self') {
      if (hint) hint.textContent = `สำเร็จแล้วรับ ${current.rewardPoints} คะแนน`;
    } else {
      const unit = current.verifyType === 'run_distance' ? 'กม.' : 'ครั้ง';
      const value = current.verifyType === 'run_distance'
        ? Math.round(((current.resetDaily ? runStats.todayMeters : runStats.meters) / 1000) * 10) / 10
        : (current.resetDaily ? runStats.todayCount : runStats.count);
      if (hint) hint.textContent = `ความคืบหน้า ${value}/${current.targetValue} ${unit} · รับ ${current.rewardPoints} คะแนน`;
    }
    claim.hidden = false;
    claim.disabled = false;
    claim.dataset.missionId = current.id;
    claim.dataset.kind = current.resetDaily ? 'daily' : current.verifyType;
    claim.textContent = current.verifyType === 'self' ? '✓ ทำสำเร็จแล้ว'
      : progress >= 1 ? '✓ รับรางวัล' : 'ยังไม่ถึงเป้า';
    claim.disabled = current.verifyType !== 'self' && progress < 1;
    claim.title = kindLabel + (current.verifyType === 'self' ? 'ภารกิจแบบยืนยันเอง' : 'ตรวจจากการวิ่งจริงของคุณ');
  } else {
    el('missionName').textContent = 'ทำภารกิจทั้งหมดสำเร็จแล้ว 🎉';
    if (hint) hint.textContent = missions.some(m => m.resetDaily) ? 'ภารกิจรายวันจะกลับมาพรุ่งนี้' : 'รอภารกิจชุดใหม่จากผู้ดูแล';
    claim.hidden = true;
  }
}

async function claim(event) {
  const button = event.currentTarget;
  const missionId = button.dataset.missionId;
  if (!missionId || claiming) return;
  claiming = true;
  button.disabled = true;
  button.textContent = 'กำลังบันทึก…';
  try {
    const mission = missions.find(m => m.id === missionId);
    let points = mission?.rewardPoints ?? 0;
    if (mission?.verifyType === 'self') {
      const result = await completeMission(missionId);
      points = result.pointsAwarded;
    } else {
      await completeRunMission(missionId);
    }
    if (mission?.resetDaily) doneTodayIds.add(missionId);
    else doneEverIds.add(missionId);
    toast(`ภารกิจสำเร็จ! รับ ${points} คะแนน 🎉`);
    render();
  } catch (error) {
    toast(friendlyMissionError(error));
    render();
  } finally {
    claiming = false;
    button.textContent = '✓ ทำสำเร็จแล้ว';
  }
}

async function loadRunStats() {
  try {
    const { rows } = await loadRunsFromCloud();
    const today = bangkokToday();
    let meters = 0, count = 0, todayMeters = 0, todayCount = 0;
    for (const run of rows) {
      meters += run.distance_m || 0;
      count += 1;
      const day = new Date(run.started_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      if (day === today) {
        todayMeters += run.distance_m || 0;
        todayCount += 1;
      }
    }
    runStats = { meters, count, todayMeters, todayCount };
  } catch { /* runs are optional context for progress display */ }
}

async function load() {
  if (!navigator.onLine) return;
  try {
    const [active, mine] = await Promise.all([listActiveMissions(), listMyCompletions()]);
    if (!active.length) return; // no admin missions yet — keep the built-in mission
    // main.js stops updating its mock mission once admin missions take over.
    window.westonAdminMissions = true;
    missions = active;
    const today = bangkokToday();
    doneTodayIds = new Set(mine.filter(entry => entry.day === today).map(entry => entry.missionId));
    doneEverIds = new Set(mine.map(entry => entry.missionId));
    if (missions.some(m => m.verifyType !== 'self')) await loadRunStats();
    render();
  } catch { /* table missing or offline — mock stays */ }
}

el('missionClaim')?.addEventListener('click', event => void claim(event));
void load();
