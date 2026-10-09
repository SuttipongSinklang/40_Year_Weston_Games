import { subscribe, recordWorkout, connect, leaderboard } from './data.js?v=20261009-6';
import { bangkokDay, progressFor, streakFor } from './progress.js';
import './demo.js';
const $ = id => document.getElementById(id);
const format = number => new Intl.NumberFormat('th-TH').format(number);
const missions = ['เล่นเกมยืดเหยียด 5 ครั้ง', 'กระโดดเพื่อยืดขา 5 ครั้ง', 'ออกกำลังกายกับตัวละคร 5 ครั้ง', 'ขยับตัวกับเกม 5 ครั้ง'];
let state, scene, toastTimer, rankRequest = 0, running;
const today = bangkokDay();
let calendarMonth = new Date(`${today.slice(0, 7)}-01T12:00:00+07:00`);
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2500);
}
function navigate(target) {
  if (!['home', 'run', 'trophy', 'goal', 'calendar', 'social'].includes(target)) target = 'home';
  if (target !== 'run' && $('screen-run').classList.contains('active')) running?.leave();
  document.querySelectorAll('.nav-btn').forEach(button => {
    const selected = button.dataset.screen === target;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.screen').forEach(screen => {
    const selected = screen.id === `screen-${target}`;
    screen.classList.toggle('active', selected); screen.inert = !selected;
    screen.setAttribute('aria-hidden', String(!selected));
  });
  const heading = document.querySelector(`#screen-${target} h1, #screen-${target} h2`);
  heading?.setAttribute('tabindex', '-1');
  document.title = `${document.querySelector(`.nav-btn[data-screen="${target}"] label`)?.textContent || 'หน้าหลัก'} · Weston Fit Quest`;
  if (location.hash !== `#${target}`) history.replaceState(null, '', `#${target}`);
  if (target === 'trophy') void renderLeaderboard();
  if (target === 'run') running?.enter();
  $('fullscreenToggle').hidden = target !== 'home' || !document.fullscreenEnabled;
}
document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => navigate(button.dataset.screen)));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
function workout(event) {
  const before = progressFor(state.total); recordWorkout(); scene?.jump();
  const after = progressFor(state.total);
  if (after.level > before.level) toast(`เลเวลอัป! Lv.${after.level} 🎉`);
  else if (after.missionDone === 0) toast('ภารกิจสำเร็จ! ได้รับ 100 XP และ 25 เหรียญ 🎉');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const pop = document.createElement('div'); pop.className = 'pop'; pop.textContent = '+1 💪';
    const rect = $('app').getBoundingClientRect();
    pop.style.left = `${event?.clientX ? event.clientX - rect.left : rect.width / 2}px`;
    pop.style.top = `${event?.clientY ? event.clientY - rect.top : rect.height / 2}px`;
    $('popLayer').appendChild(pop); setTimeout(() => pop.remove(), 1000);
  }
}
$('missionCard').addEventListener('click', () => navigate('goal'));
$('playerInfo').addEventListener('click', () => $('playerDialog').showModal());
$('playerDialog').addEventListener('close', () => $('playerInfo').focus());
$('syncRetry')?.addEventListener('click', () => void connect());
function dailyCounts() {
  const counts = { ...state.daily };
  for (const pending of state.pending) counts[pending.played_on] = (counts[pending.played_on] || 0) + 1;
  return counts;
}
function renderGoals() {
  const count = dailyCounts()[bangkokDay()] || 0, pct = Math.min(100, count / 5 * 100);
  $('dayPercent').textContent = `${pct}%`; $('dayRing').style.strokeDashoffset = String(326.7 * (1 - pct / 100));
  $('goalHeadline').textContent = count >= 5 ? 'ครบเป้าการเล่นวันนี้แล้ว!' : 'วันนี้ขยับตัวกับเกม 5 ครั้ง';
  $('goalDescription').textContent = count >= 5 ? 'เล่นต่อเพื่อสะสม XP และทำภารกิจถัดไป' : `ทำแล้ว ${format(count)} ครั้ง อีก ${format(5 - count)} ครั้งถึงเป้า`;
  $('goalList').replaceChildren();
  for (const goal of [{ icon: '💪', name: 'การเล่นวันนี้', done: count, total: 5 }, { icon: '🎯', name: 'ภารกิจปัจจุบัน', done: progressFor(state.total).missionDone, total: 5 }]) {
    const card = document.createElement('div'); card.className = 'goal-item card';
    card.innerHTML = `<span class="goal-ico" aria-hidden="true">${goal.icon}</span><div class="goal-mid"><h4><span>${goal.name}</span><b>${format(goal.done)}/${goal.total} ครั้ง</b></h4><div class="goal-track" role="progressbar" aria-label="${goal.name}" aria-valuemin="0" aria-valuemax="${goal.total}" aria-valuenow="${Math.min(goal.done, goal.total)}"><div class="goal-fill" style="width:${Math.min(100, goal.done / goal.total * 100)}%"></div></div></div>`;
    $('goalList').appendChild(card);
  }
}
function renderCalendar() {
  const year = calendarMonth.getUTCFullYear(), month = calendarMonth.getUTCMonth(), monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  $('calTitle').textContent = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(calendarMonth);
  $('calHead').innerHTML = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => `<span>${d}</span>`).join('');
  $('calDays').replaceChildren(); const counts = dailyCounts();
  for (let i = 0; i < new Date(Date.UTC(year, month, 1)).getUTCDay(); i++) {
    const blank = document.createElement('span'); blank.className = 'cal-day dim'; blank.setAttribute('aria-hidden', 'true'); $('calDays').appendChild(blank);
  }
  for (let day = 1; day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); day++) {
    const date = `${monthKey}-${String(day).padStart(2, '0')}`, cell = document.createElement('span');
    cell.className = `cal-day${counts[date] ? ' done' : ''}${date === bangkokDay() ? ' today' : ''}`;
    cell.textContent = day;
    cell.setAttribute('aria-label', `${day} ${$('calTitle').textContent}${counts[date] ? ` เล่น ${counts[date]} ครั้ง` : ' ยังไม่มีการเล่น'}${date === bangkokDay() ? ' วันนี้' : ''}`);
    $('calDays').appendChild(cell);
  }
  const played = Object.entries(counts).filter(([date]) => date.startsWith(monthKey)), total = played.reduce((sum, [, count]) => sum + count, 0);
  $('summaryDays').textContent = format(played.length); $('summaryWorkouts').textContent = format(total); $('summaryXP').textContent = format(total * 6);
}
$('calPrev')?.addEventListener('click', () => { calendarMonth.setUTCMonth(calendarMonth.getUTCMonth() - 1); renderCalendar(); });
$('calNext')?.addEventListener('click', () => { calendarMonth.setUTCMonth(calendarMonth.getUTCMonth() + 1); renderCalendar(); });
async function renderLeaderboard() {
  const request = ++rankRequest, list = $('lbPerson');
  list.innerHTML = '<p class="card data-message" role="status">กำลังโหลดอันดับผู้เล่น…</p>';
  try {
    const { rows, userId } = await leaderboard(); if (request !== rankRequest) return;
    list.replaceChildren(); const note = document.createElement('p'); note.className = 'data-note'; note.textContent = '50 อันดับแรก · คะแนนจากการเล่นเกม'; list.appendChild(note);
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'card data-message'; empty.textContent = 'ยังไม่มีคะแนน เริ่มเล่นและบันทึกออนไลน์เพื่อขึ้นอันดับ'; list.appendChild(empty); }
    const maximum = progressFor(rows[0]?.total_workouts || 0).score || 1;
    rows.forEach((player, index) => {
      const score = progressFor(player.total_workouts).score, row = document.createElement('div'); row.className = `lb-row${player.user_id === userId ? ' you' : ''}`;
      row.innerHTML = `<div class="lb-rank"><span class="rank-badge ${index < 3 ? `rank-${index + 1}` : ''}">${index + 1}</span></div><div class="lb-player"><span class="lb-ava" aria-hidden="true">🧒</span><span class="lb-name"></span></div><div class="lb-score"><div class="lb-scorebar"><i style="width:${Math.round(score / maximum * 100)}%"></i></div><div class="lb-flame">${format(score)} XP</div></div>`;
      row.querySelector('.lb-name').textContent = `${player.display_name}${player.user_id === userId ? ' (คุณ)' : ''}`; list.appendChild(row);
    });
  } catch {
    if (request !== rankRequest) return;
    list.innerHTML = '<p class="card data-message">ยังโหลดอันดับออนไลน์ไม่ได้ กรุณาตรวจการเชื่อมต่อและตั้งค่าตารางเกม</p>';
    const retry = document.createElement('button'); retry.className = 'data-retry'; retry.textContent = 'ลองโหลดอันดับอีกครั้ง'; retry.addEventListener('click', renderLeaderboard); list.appendChild(retry);
  }
}
subscribe(value => {
  state = value; const progress = progressFor(value.total);
  $('playerName').textContent = 'ผู้เล่นของคุณ'; $('playerLevel').textContent = `Lv.${progress.level}`; $('playerCoins').textContent = format(progress.coins);
  $('xpFill').style.width = `${progress.xp}%`; $('xpFill').parentElement.setAttribute('aria-label', `XP ${progress.xp} จาก 100 ในเลเวล ${progress.level}`);
  $('xpFill').parentElement.setAttribute('aria-valuenow', String(progress.xp));
  $('missionDone').textContent = progress.missionDone; $('missionTotal').textContent = '5'; $('missionName').textContent = missions[progress.missionIndex]; $('missionFill').style.width = `${progress.missionDone * 20}%`;
  $('streakDay').textContent = streakFor(value.days);
  const labels = { connecting: 'กำลังเชื่อมต่อ', syncing: 'กำลังบันทึก', saved: 'บันทึกออนไลน์แล้ว', offline: 'เก็บในเครื่อง · ออฟไลน์', setup: 'เก็บในเครื่อง · รอเชื่อมบัญชี', error: 'เก็บในเครื่อง · เชื่อมต่อไม่ได้' };
  $('syncStatus').textContent = value.storageAvailable ? labels[value.state] : 'ยังบันทึกในเครื่องไม่ได้';
  $('saveBadge').textContent = value.storageAvailable ? ({ connecting: 'กำลังเชื่อมต่อ', syncing: 'กำลังบันทึก', saved: 'บันทึกออนไลน์แล้ว', offline: 'ออฟไลน์', setup: 'เก็บในเครื่อง', error: 'เก็บในเครื่อง' }[value.state]) : 'ยังบันทึกไม่ได้';
  $('playerInfo').dataset.state = value.state;
  $('syncDetail').textContent = value.storageAvailable ? `${value.detail}${value.pending.length ? ` · รอส่ง ${value.pending.length} ครั้ง` : ''}` : 'พื้นที่จัดเก็บเบราว์เซอร์ไม่พร้อม ความคืบหน้าจะหายเมื่อปิดหน้านี้';
  $('syncRetry').disabled = ['connecting', 'syncing'].includes(value.state); $('syncRetry').setAttribute('aria-busy', String($('syncRetry').disabled));
  document.querySelector('.sync-bar').dataset.state = value.state;
  renderGoals(); renderCalendar();
});
function sceneFailure() { $('loader').classList.add('done'); $('loader').setAttribute('aria-hidden', 'true'); $('scene3d').setAttribute('aria-disabled', 'true'); $('playHint').textContent = 'โหลดตัวละครไม่ได้ ลองรีเฟรชหน้าเพื่อเล่นอีกครั้ง'; toast('โหลดตัวละครไม่ได้ ความคืบหน้าเดิมยังเก็บอยู่'); }
import('./scene.js?v=20261008-6').then(module => { scene = module.initializeScene({ onWorkout: workout, onReady: () => $('scene3d').setAttribute('aria-disabled', 'false'), onError: sceneFailure }); }).catch(sceneFailure);
import('./running.js?v=20261009-11').then(async module => {
  running = await module.initializeRunning({ toast });
  if ($('screen-run').classList.contains('active')) running.enter();
}).catch(() => { $('runMessage').textContent = 'โหลดโหมดวิ่งไม่ได้ กรุณารีเฟรชหน้า'; });
navigate(location.hash.slice(1) || 'home'); void connect();
// Enable static controls only after installing their handlers.
document.querySelectorAll('.nav-btn, .pill, #playerInfo, #missionCard, #calPrev, #calNext').forEach(button => { button.disabled = false; });
document.querySelectorAll('.pill').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
const fullscreenButton = $('fullscreenToggle');
if (fullscreenButton) {
  fullscreenButton.hidden = !document.fullscreenEnabled || !$('screen-home').classList.contains('active');
  fullscreenButton.disabled = !document.fullscreenEnabled;
  fullscreenButton.addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('app').requestFullscreen(); }
    catch { toast('เบราว์เซอร์นี้ยังเปิดเต็มจอไม่ได้'); }
  });
  document.addEventListener('fullscreenchange', () => {
    const enabled = Boolean(document.fullscreenElement);
    fullscreenButton.classList.toggle('active', enabled);
    fullscreenButton.setAttribute('aria-label', enabled ? 'ออกจากโหมดเต็มจอ' : 'เข้าโหมดเต็มจอ');
  });
}
