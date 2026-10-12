// Weston Admin site controller: dashboard, missions CRUD (with auto-verified
// run missions), full tournament management (double elim, scheduling, export,
// QR and projector links), teams, announcements and admin management.
// Site-admin rights come from the weston_site_admins table (global admin code).
import {
  listTournaments, getTournamentDetail, createTournament,
  addWalkInParticipant, removeParticipant, setTournamentStatus,
  startTournament, resetBracket, saveMatchScore, setMatchSchedule,
  friendlyTournamentError,
} from './tournament-cloud.js?v=20261012-2';
import { computeStandings, groupMatchSections } from './tournament-bracket.js?v=20261012-2';
import {
  claimSiteAdmin, setSiteAdminCode, listAllMissions, saveMission,
  deleteMission, missionCompletionStats, friendlyMissionError,
} from './missions-cloud.js?v=20261012-2';
import { saveAdminCode, getAdminCode } from './tournament-store.js?v=20261012-2';
import { playerSession } from './data.js?v=20261012-2';

const el = id => document.getElementById(id);
const TABS = ['dashboard', 'missions', 'tournaments', 'teams', 'announcements', 'settings'];
const CATEGORY_LABEL = { single: 'เดี่ยว', team: 'ทีม' };
const GENDER_LABEL = { male: 'ชาย', female: 'หญิง', mixed: 'ผสม' };
const FORMAT_LABEL = { single_elim: 'แพ้คัดออก', double_elim: 'แพ้คัดออกคู่', round_robin: 'ลีกพบกันหมด' };
const STATUS_LABEL = { registering: 'เปิดรับสมัคร', ongoing: 'กำลังแข่ง', completed: 'จบแล้ว', cancelled: 'ยกเลิก' };
const VERIFY_LABEL = { self: 'ยืนยันเอง', run_distance: 'ตรวจระยะวิ่ง', run_count: 'ตรวจจำนวนวิ่ง' };

let adminOk = false;
let missions = [];
let completionCounts = new Map();
let tournamentSummaries = [];
const detailCache = new Map();

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function setMessage(id, text, kind) {
  const node = el(id);
  if (!node) return;
  node.textContent = text || '';
  if (kind) node.dataset.kind = kind;
  else delete node.dataset.kind;
}

function thaiDate(value) {
  try { return new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

function toLocalInputValue(iso) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  } catch { return ''; }
}

// ───────────────────────── Session / login ─────────────────────────

async function checkSession() {
  el('admLoginMsg').textContent = 'กำลังเชื่อมต่อบัญชี…';
  try {
    const api = await playerSession();
    const { data } = await api.from('weston_site_admins').select('user_id').eq('user_id', api.userId).maybeSingle();
    adminOk = Boolean(data);
    if (adminOk) enterAdmin();
    else el('admLoginMsg').textContent = '';
  } catch (error) {
    setMessage('admLoginMsg', friendlyMissionError(error), 'error');
  }
}

function enterAdmin() {
  el('admLogin').classList.add('hidden');
  TABS.forEach(name => el(`admPanel-${name}`).classList.add('hidden'));
  el('admPanel-dashboard').classList.remove('hidden');
  document.querySelector('.adm-tabs').hidden = false;
  document.querySelectorAll('.adm-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.admTab === 'dashboard'));
  el('admSession').textContent = 'ผู้ดูแล · เข้าระบบแล้ว';
  void loadDashboard();
  void loadMissions();
  void loadTournamentList();
  void loadTeamsAdmin();
  void loadAnnouncementsAdmin();
  void loadAdminList();
}

async function submitLogin(event) {
  event.preventDefault();
  const form = el('admLoginForm');
  const code = (form.elements.code.value || '').trim();
  if (!/^\d{6}$/.test(code)) {
    setMessage('admLoginMsg', 'รหัสต้องเป็นตัวเลข 6 หลัก', 'error');
    return;
  }
  setMessage('admLoginMsg', 'กำลังตรวจสอบ…');
  try {
    const ok = await claimSiteAdmin(code);
    if (!ok) {
      setMessage('admLoginMsg', 'รหัสไม่ถูกต้อง', 'error');
      return;
    }
    enterAdmin();
  } catch (error) {
    setMessage('admLoginMsg', friendlyMissionError(error), 'error');
  }
}

async function submitCodeChange(event) {
  event.preventDefault();
  const form = el('admCodeForm');
  const oldCode = (form.elements.oldCode.value || '').trim();
  const newCode = (form.elements.newCode.value || '').trim();
  if (!/^\d{6}$/.test(oldCode) || !/^\d{6}$/.test(newCode)) {
    setMessage('admCodeMsg', 'รหัสต้องเป็นตัวเลข 6 หลักทั้งคู่', 'error');
    return;
  }
  try {
    const ok = await setSiteAdminCode(oldCode, newCode);
    if (!ok) {
      setMessage('admCodeMsg', 'รหัสปัจจุบันไม่ถูกต้อง', 'error');
      return;
    }
    form.reset();
    setMessage('admCodeMsg', 'เปลี่ยนรหัสแอดมินแล้ว ✓ แจ้งทีมงานด้วย', 'ok');
    void loadAdminList();
  } catch (error) {
    setMessage('admCodeMsg', friendlyMissionError(error), 'error');
  }
}

// ───────────────────────── Dashboard (#18) ─────────────────────────

async function loadDashboard() {
  el('admDashState').textContent = 'กำลังโหลดข้อมูล…';
  try {
    const api = await playerSession();
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const [scores, tournaments, missionsAll, completions, events] = await Promise.all([
      api.from('weston_scores').select('user_id').limit(10000),
      api.from('weston_tournaments').select('id,status').limit(500),
      api.from('weston_missions').select('id,status').limit(500),
      api.from('weston_mission_completions').select('mission_id,points_awarded,completed_at').limit(10000),
      api.from('weston_events').select('kind,text,created_at').order('created_at', { ascending: false }).limit(8),
    ]);
    if (scores.error) throw scores.error;
    if (tournaments.error) throw tournaments.error;
    if (missionsAll.error) throw missionsAll.error;
    if (completions.error) throw completions.error;
    if (events.error) throw events.error;
    const cards = [
      ['👥', 'ผู้เล่นทั้งหมด', (scores.data || []).length.toLocaleString('th-TH')],
      ['🏆', 'ทัวร์นาเมนต์', `${(tournaments.data || []).filter(t => t.status === 'ongoing').length} กำลังแข่ง / ${(tournaments.data || []).length} รายการ`],
      ['🎯', 'ภารกิจที่ใช้งาน', `${(missionsAll.data || []).filter(m => m.status === 'active').length} จาก ${(missionsAll.data || []).length}`],
      ['✅', 'ทำภารกิจสำเร็จ', `${(completions.data || []).length.toLocaleString('th-TH')} ครั้ง`],
      ['🔥', 'สำเร็จใน 7 วัน', (completions.data || []).filter(c => c.completed_at >= weekAgo).length.toLocaleString('th-TH')],
      ['⭐', 'แต้มที่แจกไป', (completions.data || []).reduce((sum, c) => sum + (c.points_awarded || 0), 0).toLocaleString('th-TH')],
    ];
    el('admDashCards').innerHTML = cards.map(([icon, label, value]) => `
      <div class="adm-dash-card">
        <span class="ico" aria-hidden="true">${icon}</span>
        <div><small>${label}</small><b>${escapeHtml(value)}</b></div>
      </div>`).join('');
    el('admDashLatest').innerHTML = (events.data || []).length
      ? '<h3 style="font-size:14px">กิจกรรมล่าสุด</h3>' + (events.data || []).map(event => `
          <div class="adm-dash-event"><span>${event.kind === 'match' ? '🏆' : '🎯'}</span>${escapeHtml(event.text)}
          <small>${new Date(event.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
      : '';
    el('admDashState').textContent = '';
  } catch (error) {
    el('admDashState').textContent = friendlyMissionError(error);
  }
}

// ───────────────────────── Missions ─────────────────────────

async function loadMissions() {
  el('missionListState').textContent = 'กำลังโหลด…';
  try {
    [missions, completionCounts] = await Promise.all([listAllMissions(), missionCompletionStats()]);
    renderMissionTable();
  } catch (error) {
    el('missionListState').textContent = friendlyMissionError(error);
  }
}

function renderMissionTable() {
  const tbody = el('missionTable').querySelector('tbody');
  el('missionListState').textContent = missions.length ? '' : 'ยังไม่มีภารกิจ — สร้างภารกิจแรกจากแบบฟอร์มด้านซ้าย';
  tbody.innerHTML = missions.map(m => `
    <tr>
      <td><b>${escapeHtml(m.icon)} ${escapeHtml(m.title)}</b>${m.description ? `<br><small style="color:#5B7191">${escapeHtml(m.description)}</small>` : ''}
        <br><small style="color:#1E6E96">${VERIFY_LABEL[m.verifyType] || m.verifyType}${m.verifyType !== 'self' ? ` · เป้า ${m.targetValue}` : ''}${m.resetDaily ? ' · รายวัน' : ''}</small></td>
      <td class="num">${m.rewardPoints}</td>
      <td><span class="adm-pill status-${m.status}">${m.status === 'active' ? 'ใช้งาน' : 'ซ่อนอยู่'}</span></td>
      <td class="num">${completionCounts.get(m.id) || 0}</td>
      <td>
        <div class="adm-btn-row">
          <button type="button" class="adm-btn ghost small" data-m-edit="${m.id}">แก้ไข</button>
          <button type="button" class="adm-btn danger small" data-m-del="${m.id}">ลบ</button>
        </div>
      </td>
    </tr>`).join('');
}

function editMission(missionId) {
  const mission = missions.find(m => m.id === missionId);
  if (!mission) return;
  const form = el('missionForm');
  form.elements.id.value = mission.id;
  form.elements.icon.value = mission.icon;
  form.elements.title.value = mission.title;
  form.elements.description.value = mission.description;
  form.elements.rewardPoints.value = mission.rewardPoints;
  form.elements.sortIndex.value = mission.sortIndex;
  form.elements.verifyType.value = mission.verifyType;
  form.elements.targetValue.value = mission.targetValue || 1;
  form.elements.resetDaily.checked = mission.resetDaily;
  form.elements.hidden.checked = mission.status === 'hidden';
  el('missionSaveBtn').textContent = 'บันทึกการแก้ไข';
  el('missionCancelEdit').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetMissionForm() {
  const form = el('missionForm');
  form.reset();
  form.elements.id.value = '';
  form.elements.icon.value = '🎯';
  form.elements.rewardPoints.value = 10;
  form.elements.sortIndex.value = 0;
  form.elements.verifyType.value = 'self';
  form.elements.targetValue.value = 1;
  el('missionSaveBtn').textContent = 'บันทึกภารกิจ';
  el('missionCancelEdit').classList.add('hidden');
  setMessage('missionFormMsg', '');
}

async function submitMission(event) {
  event.preventDefault();
  const form = el('missionForm');
  const title = (form.elements.title.value || '').trim();
  if (!title) {
    setMessage('missionFormMsg', 'กรุณาใส่ชื่อภารกิจ', 'error');
    form.elements.title.setAttribute('aria-invalid', 'true');
    return;
  }
  form.elements.title.setAttribute('aria-invalid', 'false');
  const reward = Number(form.elements.rewardPoints.value);
  if (!Number.isInteger(reward) || reward < 1 || reward > 10000) {
    setMessage('missionFormMsg', 'คะแนนต้องเป็น 1–10000', 'error');
    return;
  }
  const verifyType = form.elements.verifyType.value;
  const target = Number(form.elements.targetValue.value || 1);
  if (verifyType !== 'self' && (!Number.isInteger(target) || target < 1)) {
    setMessage('missionFormMsg', 'เป้าหมายต้องเป็นตัวเลข ≥ 1', 'error');
    return;
  }
  try {
    await saveMission({
      id: form.elements.id.value || null,
      title,
      description: form.elements.description.value.trim(),
      icon: (form.elements.icon.value || '🎯').trim(),
      rewardPoints: reward,
      status: form.elements.hidden.checked ? 'hidden' : 'active',
      sortIndex: Number(form.elements.sortIndex.value || 0),
      verifyType,
      targetValue: verifyType === 'self' ? null : target,
      resetDaily: form.elements.resetDaily.checked,
    });
    resetMissionForm();
    await loadMissions();
  } catch (error) {
    setMessage('missionFormMsg', friendlyMissionError(error), 'error');
  }
}

async function removeMission(missionId) {
  if (!confirm('ลบภารกิจนี้? ประวัติการทำสำเร็จจะถูกลบด้วย')) return;
  try {
    await deleteMission(missionId);
    await loadMissions();
  } catch (error) {
    alert(friendlyMissionError(error));
  }
}

// ───────────────────────── Tournaments: create ─────────────────────────

let selectedSportChip = 'ปิงปอง';

function bindTournamentForm() {
  const form = el('admTournamentForm');
  const chips = [...el('admSportChips').querySelectorAll('.adm-chip')];
  chips.forEach(chip => chip.addEventListener('click', () => {
    chips.forEach(other => other.classList.toggle('active', other === chip));
    selectedSportChip = chip.dataset.sport;
    form.elements.sportCustom.value = '';
    form.elements.allowDraw.checked = chip.dataset.draw === '1';
  }));
  form.elements.sportCustom.addEventListener('input', () => {
    if (form.elements.sportCustom.value.trim()) {
      chips.forEach(chip => chip.classList.remove('active'));
      selectedSportChip = '';
    } else {
      chips[0].classList.add('active');
      selectedSportChip = chips[0].dataset.sport;
    }
  });
  const syncFormatUi = () => {
    const format = form.elements.format.value;
    form.querySelectorAll('.adm-league-only').forEach(node => { node.hidden = format !== 'round_robin'; });
    el('admThirdPlaceCheck').hidden = format !== 'single_elim';
  };
  form.elements.format.addEventListener('change', syncFormatUi);
  syncFormatUi();
}

async function submitTournamentCreate(event) {
  event.preventDefault();
  const form = el('admTournamentForm');
  const title = (form.elements.title.value || '').trim();
  const sport = form.elements.sportCustom.value.trim() || selectedSportChip;
  if (!title) { setMessage('admTournamentMsg', 'กรุณาใส่ชื่อรายการ', 'error'); return; }
  if (!sport) { setMessage('admTournamentMsg', 'เลือกกีฬาจากปุ่มหรือพิมพ์เอง', 'error'); return; }
  const maxRaw = form.elements.maxParticipants.value;
  const max = maxRaw === '' ? null : Number(maxRaw);
  const format = form.elements.format.value;
  const payload = {
    title,
    sport,
    sport_icon: el('admSportChips').querySelector('.adm-chip.active')?.dataset.icon || '🏆',
    category: form.elements.category.value,
    gender: form.elements.gender.value,
    format,
    description: form.elements.description.value.trim(),
    max_participants: max,
    third_place: format === 'single_elim' && form.elements.thirdPlace.checked,
    allow_draw: format === 'round_robin' && form.elements.allowDraw.checked,
    score_label: (form.elements.scoreLabel.value || 'แต้ม').trim().slice(0, 20),
    points_win: Number(form.elements.pointsWin.value || 3),
    points_draw: Number(form.elements.pointsDraw.value || 1),
    points_loss: Number(form.elements.pointsLoss.value || 0),
  };
  const adminCode = String(Math.floor(100000 + Math.random() * 900000));
  setMessage('admTournamentMsg', 'กำลังสร้างรายการ…');
  try {
    const id = await createTournament(payload, adminCode);
    saveAdminCode(id, adminCode);
    form.reset();
    selectedSportChip = 'ปิงปอง';
    setMessage('admTournamentMsg', `สร้าง "${title}" แล้ว ✓ รหัสผู้ดูแลรายการนี้ (ให้ผู้จัดคนอื่น): ${adminCode}`, 'ok');
    await loadTournamentList();
  } catch (error) {
    setMessage('admTournamentMsg', friendlyTournamentError(error), 'error');
  }
}

// ───────────────────────── Tournaments: list + manage ─────────────────────────

async function loadTournamentList() {
  el('admTournamentState').textContent = 'กำลังโหลด…';
  try {
    const result = await listTournaments();
    tournamentSummaries = result.tournaments;
    renderTournamentList();
  } catch (error) {
    el('admTournamentState').textContent = friendlyTournamentError(error);
  }
}

function renderTournamentList() {
  const wrap = el('admTournamentList');
  if (!tournamentSummaries.length) {
    el('admTournamentState').textContent = 'ยังไม่มีทัวร์นาเมนต์ — สร้างจากแบบฟอร์มด้านซ้าย';
    wrap.innerHTML = '';
    return;
  }
  el('admTournamentState').textContent = '';
  wrap.innerHTML = tournamentSummaries.map(t => `
    <div class="adm-t-item" data-t-item="${t.id}">
      <div class="adm-t-head">
        <span class="t-ico" aria-hidden="true">${escapeHtml(t.sportIcon)}</span>
        <span class="mid">
          <b>${escapeHtml(t.title)}</b>
          <small>${escapeHtml(t.sport)} · ${CATEGORY_LABEL[t.category]} · ${GENDER_LABEL[t.gender]} · ${FORMAT_LABEL[t.format] || t.format} · ${t.participantCount}${t.maxParticipants ? `/${t.maxParticipants}` : ''} ราย</small>
        </span>
        <span class="adm-pill status-${t.status}">${STATUS_LABEL[t.status]}</span>
        <button type="button" class="adm-btn ghost small" data-t-manage="${t.id}">${detailCache.has(t.id) ? 'ปิด' : 'จัดการ'}</button>
      </div>
      <div class="adm-t-manage hidden" data-t-managebox="${t.id}"></div>
    </div>`).join('');
  for (const [id] of detailCache) {
    const box = wrap.querySelector(`[data-t-managebox="${id}"]`);
    if (box) {
      box.classList.remove('hidden');
      renderManage(id);
    }
  }
}

async function toggleManage(tournamentId) {
  if (detailCache.has(tournamentId)) {
    detailCache.delete(tournamentId);
    renderTournamentList();
    return;
  }
  const box = document.querySelector(`[data-t-managebox="${tournamentId}"]`);
  if (box) box.innerHTML = '<p class="adm-msg">กำลังโหลดข้อมูลรายการ…</p>';
  try {
    const detail = await getTournamentDetail(tournamentId);
    detailCache.set(tournamentId, detail);
    renderTournamentList();
  } catch (error) {
    if (box) box.innerHTML = `<p class="adm-msg" data-kind="error">${escapeHtml(friendlyTournamentError(error))}</p>`;
  }
}

function buildCsv(rows) {
  return '\uFEFF' + rows.map(row => row.map(cell => {
    const text = String(cell ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n');
}

function downloadCsv(filename, rows) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showJoinQr(tournamentId) {
  const detail = detailCache.get(tournamentId);
  const joinUrl = `${location.origin}/#tournament-${tournamentId}`;
  el('admQrTitle').textContent = `ให้ผู้เข้าแข่งสแกนเพื่อเปิดรายการ${detail ? ` “${detail.tournament.title}”` : ''} แล้วกดสมัคร`;
  el('admQrLink').textContent = joinUrl;
  const imgBox = el('admQrImg');
  imgBox.innerHTML = '';
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    imgBox.innerHTML = qr.createImgTag(6, 16);
  } catch {
    imgBox.innerHTML = '<p class="adm-msg">สร้าง QR ไม่ได้ — ใช้ลิงก์ด้านล่างแทน</p>';
  }
  el('admQrOverlay').hidden = false;
}

function exportTournament(tournamentId) {
  const detail = detailCache.get(tournamentId);
  if (!detail) return;
  const { tournament, participants, matches } = detail;
  const rows = [['รายการ', tournament.title], ['กีฬา', tournament.sport], ['รูปแบบ', FORMAT_LABEL[tournament.format]], ['สถานะ', STATUS_LABEL[tournament.status]], [], ['ผู้เข้าแข่ง'], ['ลำดับสาย', 'ชื่อ']];
  for (const p of participants) rows.push([p.seed || '', p.name]);
  rows.push([], ['แมตช์'], ['สาย', 'รอบ', 'แมตช์', 'ฝั่ง A', 'คะแนน A', 'คะแนน B', 'ฝั่ง B', 'ผู้ชนะ', 'เวลาที่แข่ง']);
  const nameOf = id => participants.find(p => p.id === id)?.name || '';
  for (const m of matches) {
    rows.push([
      m.bracketSide === 2 ? 'สายผู้แพ้' : m.bracketSide === 3 ? 'ชิงชนะเลิศ' : 'สายผู้ชนะ',
      m.roundLabel, `#${m.matchNo}`, nameOf(m.slotA), m.scoreA ?? '', m.scoreB ?? '', nameOf(m.slotB),
      nameOf(m.winnerId), m.scheduledAt ? new Date(m.scheduledAt).toLocaleString('th-TH') : '',
    ]);
  }
  if (tournament.format === 'round_robin') {
    rows.push([], ['ตารางคะแนน'], ['อันดับ', 'ชื่อ', 'แข่ง', 'ชนะ', 'เสมอ', 'แพ้', 'ได้', 'เสีย', 'แต้ม']);
    for (const row of computeStandings(participants, matches, tournament)) {
      rows.push([row.rank, row.name, row.played, row.win, row.draw, row.loss, row.scored, row.conceded, row.points]);
    }
  }
  downloadCsv(`${tournament.title}-ผลการแข่งขัน.csv`, rows);
}

function renderManage(tournamentId) {
  const box = document.querySelector(`[data-t-managebox="${tournamentId}"]`);
  const detail = detailCache.get(tournamentId);
  if (!box || !detail) return;
  const { tournament, participants, matches } = detail;
  const need = tournament.format === 'round_robin' ? 3 : 2;
  const actions = [];
  if (tournament.status === 'registering') {
    actions.push(`<button type="button" class="adm-btn primary small" data-t-start="${tournament.id}">🚀 เริ่มแข่งขัน (จัดสายอัตโนมัติ)</button>`);
  }
  if (tournament.status === 'ongoing') {
    actions.push(`<button type="button" class="adm-btn ghost small" data-t-finish="${tournament.id}">🏁 ปิดรายการ</button>`);
  }
  if (tournament.status === 'ongoing' || tournament.status === 'completed') {
    actions.push(`<button type="button" class="adm-btn ghost small" data-t-reset="${tournament.id}">↩ รีเซ็ตสาย</button>`);
  }
  if (tournament.status === 'registering' || tournament.status === 'ongoing') {
    actions.push(`<button type="button" class="adm-btn danger small" data-t-cancel="${tournament.id}">ยกเลิกรายการ</button>`);
  }
  if (matches.length) {
    actions.push(`<button type="button" class="adm-btn ghost small" data-t-export="${tournament.id}">📥 ส่งออกผล (CSV/Excel)</button>`);
    actions.push(`<a class="adm-btn ghost small" href="live.html?id=${tournament.id}" target="_blank" rel="noopener">📺 โหมดจอโปรเจกเตอร์</a>`);
    actions.push(`<a class="adm-btn ghost small" href="cert.html?id=${tournament.id}" target="_blank" rel="noopener">🏅 เกียรติบัตร</a>`);
  }
  if (tournament.status === 'registering') {
    actions.push(`<button type="button" class="adm-btn ghost small" data-t-qr="${tournament.id}">📱 QR สมัครรายการ</button>`);
  }
  if (getAdminCode(tournament.id)) {
    actions.push(`<button type="button" class="adm-btn ghost small" data-t-code="${tournament.id}">🔑 ดูรหัสผู้ดูแล</button>`);
  }
  const playerRows = participants.map(p => `
    <div class="adm-t-prow">
      ${p.seed ? `<span class="seed">#${p.seed}</span>` : ''}
      <span class="nm">${escapeHtml(p.name)}${p.members?.length ? ` <small style="color:#5B7191">(${escapeHtml(p.members.join(', '))})</small>` : ''}</span>
      <button type="button" data-t-rmp="${p.id}" aria-label="ลบ ${escapeHtml(p.name)}">✕</button>
    </div>`).join('');
  const nameOf = id => participants.find(p => p.id === id)?.name || '—';
  const sections = matches.length ? groupMatchSections(matches) : [];
  const matchBlocks = sections.map(section => `
    <div style="display:flex;flex-direction:column;gap:6px">
      <b style="font-size:12.5px;color:#1E6E96">${escapeHtml(section.title)}</b>
      ${section.rounds.map(round => `
        <div style="display:flex;flex-direction:column;gap:6px">
          <span class="adm-round-head">${escapeHtml(round.label)}</span>
          ${round.matches.map(match => {
            const completed = match.status === 'completed';
            if (match.status === 'bye') return `<div class="adm-match-row"><span class="vs"><b>${escapeHtml(nameOf(match.slotA) || '—')}</b> ผ่าน BYE อัตโนมัติ</span></div>`;
            return `<div class="adm-match-row">
              <span class="vs"><b class="${completed && match.winnerId === match.slotA ? 'done' : ''}">${escapeHtml(nameOf(match.slotA))}</b> vs <b class="${completed && match.winnerId === match.slotB ? 'done' : ''}">${escapeHtml(nameOf(match.slotB))}</b></span>
              <input inputmode="numeric" type="number" min="0" max="9999" value="${match.scoreA ?? ''}" placeholder="—" aria-label="คะแนนฝั่งซ้าย" data-ms-a="${match.id}">
              <span aria-hidden="true">–</span>
              <input inputmode="numeric" type="number" min="0" max="9999" value="${match.scoreB ?? ''}" placeholder="—" aria-label="คะแนนฝั่งขวา" data-ms-b="${match.id}">
              <button type="button" class="adm-btn ghost small" data-ms-save="${match.id}" ${match.slotA && match.slotB ? '' : 'disabled'}>${completed ? 'แก้ผล' : 'บันทึก'}</button>
              <input type="datetime-local" class="adm-schedule" value="${toLocalInputValue(match.scheduledAt)}" title="กำหนดเวลาแข่ง" aria-label="เวลาแข่งของแมตช์นี้" data-ms-time="${match.id}">
              <button type="button" class="adm-btn ghost small" data-ms-saveschedule="${match.id}" title="บันทึกเวลา">⏰</button>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>`).join('') || '<p class="adm-msg">ยังไม่ได้จัดสาย — กด "เริ่มแข่งขัน" เมื่อพร้อม</p>';
  const standings = tournament.format === 'round_robin' && matches.length ? `
    <div>
      <span class="adm-round-head">ตารางคะแนน</span>
      <div class="adm-table-wrap"><table class="adm-standings">
        <thead><tr><th style="text-align:left">ชื่อ</th><th>แข่ง</th><th>ชนะ</th><th>เสมอ</th><th>แพ้</th><th>+/−</th><th>แต้ม</th></tr></thead>
        <tbody>${computeStandings(participants, matches, tournament).map(row => `
          <tr><td class="name">${row.rank}. ${escapeHtml(row.name)}</td><td>${row.played}</td><td>${row.win}</td><td>${row.draw}</td><td>${row.loss}</td><td>${row.scored}-${row.conceded}</td><td><b>${row.points}</b></td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : '';
  box.innerHTML = `
    ${actions.length ? `<div class="adm-t-actions">${actions.join('')}</div>` : ''}
    ${tournament.status === 'registering' && participants.length < need ? `<p class="adm-msg">ต้องมีผู้เข้าแข่งอย่างน้อย ${need} รายจึงเริ่มได้ (ตอนนี้ ${participants.length} ราย)</p>` : ''}
    ${tournament.format === 'double_elim' && tournament.status === 'registering' && (participants.length & (participants.length - 1)) !== 0 ? '<p class="adm-msg" data-kind="error">สายแพ้คัดออกคู่ต้องมีจำนวนผู้เข้าแข่งเป็นกำลังสอง (4, 8, 16 …) เติมหรือลบให้ครบก่อนเริ่ม</p>' : ''}
    <div class="adm-t-participants">
      <b style="font-size:13px">ผู้เข้าแข่ง (${participants.length} ราย)</b>
      ${playerRows || '<p class="adm-msg">ยังไม่มีผู้สมัคร</p>'}
      ${tournament.status === 'registering' ? `
      <div class="adm-t-addrow">
        <input maxlength="60" placeholder="เพิ่มชื่อผู้เข้าแข่ง/ทีม…" data-t-addname="${tournament.id}" aria-label="เพิ่มรายชื่อ">
        <button type="button" class="adm-btn ghost small" data-t-add="${tournament.id}">เพิ่ม</button>
      </div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <b style="font-size:13px">แมตช์ ผลการแข่งขัน (${tournament.scoreLabel}) และเวลาแข่ง</b>
      ${matchBlocks}
      ${standings}
    </div>`;
}

async function refreshManaged(tournamentId, keepOpen = true) {
  try {
    const detail = await getTournamentDetail(tournamentId);
    detailCache.set(tournamentId, detail);
    if (keepOpen) renderManage(tournamentId);
    await loadTournamentList();
  } catch (error) {
    alert(friendlyTournamentError(error));
  }
}

async function manageAction(action, tournamentId, extra) {
  const detail = detailCache.get(tournamentId);
  try {
    if (action === 'start') {
      if (!detail) return;
      const count = await startTournament(detail.tournament, detail.participants, { shuffle: true });
      alert(`จัดสายแล้ว ${count} แมตช์`);
    } else if (action === 'finish') {
      await setTournamentStatus(tournamentId, 'completed');
    } else if (action === 'reset') {
      await resetBracket(tournamentId);
    } else if (action === 'cancel') {
      await setTournamentStatus(tournamentId, 'cancelled');
    } else if (action === 'add') {
      const name = (extra || '').trim();
      if (name) await addWalkInParticipant(tournamentId, { name });
    } else if (action === 'removeParticipant') {
      await removeParticipant(extra);
    } else if (action === 'score') {
      if (!detail) return;
      await saveMatchScore(detail.tournament, detail.matches, extra.id, extra.a, extra.b);
    } else if (action === 'schedule') {
      await setMatchSchedule(extra.id, extra.value ? new Date(extra.value).toISOString() : null);
    }
    await refreshManaged(tournamentId);
  } catch (error) {
    alert(error?.message || friendlyTournamentError(error));
    await refreshManaged(tournamentId);
  }
}

// ───────────────────────── Teams (#3) ─────────────────────────

async function loadTeamsAdmin() {
  try {
    const api = await playerSession();
    const [teams, members] = await Promise.all([
      api.from('weston_teams').select('id,name,emoji,created_at').order('created_at').limit(100),
      api.from('weston_team_members').select('team_id').limit(5000),
    ]);
    if (teams.error) throw teams.error;
    if (members.error) throw members.error;
    const counts = new Map();
    for (const row of members.data || []) counts.set(row.team_id, (counts.get(row.team_id) || 0) + 1);
    el('admTeamState').textContent = (teams.data || []).length ? '' : 'ยังไม่มีทีม — สร้างทีมแรกจากแบบฟอร์มด้านซ้าย';
    el('admTeamTable').querySelector('tbody').innerHTML = (teams.data || []).map(team => `
      <tr>
        <td><b>${escapeHtml(team.emoji)} ${escapeHtml(team.name)}</b></td>
        <td class="num">${counts.get(team.id) || 0}</td>
        <td><button type="button" class="adm-btn danger small" data-team-del="${team.id}">ลบทีม</button></td>
      </tr>`).join('');
  } catch (error) {
    el('admTeamState').textContent = friendlyMissionError(error);
  }
}

async function submitTeam(event) {
  event.preventDefault();
  const form = el('admTeamForm');
  const name = (form.elements.name.value || '').trim();
  if (!name) { setMessage('admTeamMsg', 'กรุณาใส่ชื่อทีม', 'error'); return; }
  try {
    const api = await playerSession();
    const { error } = await api.from('weston_teams')
      .insert({ id: crypto.randomUUID(), name, emoji: (form.elements.emoji.value || '🦁').trim() });
    if (error) throw error;
    form.reset();
    form.elements.emoji.value = '🦁';
    setMessage('admTeamMsg', `เพิ่มทีม "${name}" แล้ว ✓`, 'ok');
    await loadTeamsAdmin();
  } catch (error) {
    setMessage('admTeamMsg', friendlyMissionError(error), 'error');
  }
}

async function removeTeam(teamId) {
  if (!confirm('ลบทีมนี้? สมาชิกทุกคนจะไม่มีทีม (คะแนนส่วนตัวไม่กระทบ)')) return;
  try {
    const api = await playerSession();
    const { error } = await api.from('weston_teams').delete().eq('id', teamId);
    if (error) throw error;
    await loadTeamsAdmin();
  } catch (error) {
    alert(friendlyMissionError(error));
  }
}

// ───────────────────────── Announcements (#20) ─────────────────────────

async function loadAnnouncementsAdmin() {
  try {
    const api = await playerSession();
    const { data, error } = await api.from('weston_announcements')
      .select('id,message,created_at').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    el('admAnnounceState').textContent = (data || []).length ? '' : 'ยังไม่มีประกาศ';
    el('admAnnounceList').innerHTML = (data || []).map(row => `
      <div class="adm-t-prow">
        <span class="nm">${escapeHtml(row.message)}</span>
        <small style="color:#5B7191;flex:none">${new Date(row.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
        <button type="button" data-ann-del="${row.id}" aria-label="ลบประกาศ">✕</button>
      </div>`).join('');
  } catch (error) {
    el('admAnnounceState').textContent = friendlyMissionError(error);
  }
}

async function submitAnnouncement(event) {
  event.preventDefault();
  const form = el('admAnnounceForm');
  const message = (form.elements.message.value || '').trim();
  if (!message) { setMessage('admAnnounceMsg', 'กรุณาใส่ข้อความ', 'error'); return; }
  try {
    const api = await playerSession();
    const { error } = await api.from('weston_announcements')
      .insert({ id: crypto.randomUUID(), message, created_by: api.userId });
    if (error) throw error;
    form.reset();
    setMessage('admAnnounceMsg', 'ส่งประกาศแล้ว ✓ ผู้เล่นจะเห็นบนหน้าแรก', 'ok');
    await loadAnnouncementsAdmin();
  } catch (error) {
    setMessage('admAnnounceMsg', friendlyMissionError(error), 'error');
  }
}

async function removeAnnouncement(id) {
  try {
    const api = await playerSession();
    const { error } = await api.from('weston_announcements').delete().eq('id', id);
    if (error) throw error;
    await loadAnnouncementsAdmin();
  } catch (error) {
    alert(friendlyMissionError(error));
  }
}

// ───────────────────────── Admin team (#19) ─────────────────────────

async function loadAdminList() {
  try {
    const api = await playerSession();
    const { data, error } = await api.from('weston_site_admins')
      .select('user_id,added_at').order('added_at').limit(100);
    if (error) throw error;
    el('admAdminListState').textContent = (data || []).length ? '' : 'มีแอดมิน 0 คน?';
    el('admAdminTable').querySelector('tbody').innerHTML = (data || []).map(row => `
      <tr>
        <td class="num">${row.user_id === api.userId ? `${row.user_id.slice(0, 8)}… (คุณ)` : `${row.user_id.slice(0, 8)}…`}</td>
        <td>${thaiDate(row.added_at)}</td>
        <td>${row.user_id === api.userId ? '<small style="color:#5B7191">—</small>' : `<button type="button" class="adm-btn danger small" data-admin-del="${row.user_id}">ถอนสิทธิ์</button>`}</td>
      </tr>`).join('');
  } catch (error) {
    el('admAdminListState').textContent = friendlyMissionError(error);
  }
}

async function removeAdminRow(userId) {
  if (!confirm(`ถอนสิทธิ์แอดมิน ${userId.slice(0, 8)}… ?`)) return;
  try {
    const api = await playerSession();
    const { error } = await api.from('weston_site_admins').delete().eq('user_id', userId);
    if (error) throw error;
    await loadAdminList();
  } catch (error) {
    alert(friendlyMissionError(error));
  }
}

// ───────────────────────── Wiring ─────────────────────────

function wire() {
  el('admLoginForm').addEventListener('submit', submitLogin);
  el('admCodeForm').addEventListener('submit', submitCodeChange);
  el('missionForm').addEventListener('submit', submitMission);
  el('missionCancelEdit').addEventListener('click', resetMissionForm);
  el('missionTable').addEventListener('click', event => {
    const editBtn = event.target.closest('[data-m-edit]');
    if (editBtn) return editMission(editBtn.dataset.mEdit);
    const delBtn = event.target.closest('[data-m-del]');
    if (delBtn) return void removeMission(delBtn.dataset.mDel);
  });
  el('admTournamentForm').addEventListener('submit', submitTournamentCreate);
  bindTournamentForm();
  el('admTeamForm').addEventListener('submit', submitTeam);
  el('admTeamTable').addEventListener('click', event => {
    const del = event.target.closest('[data-team-del]');
    if (del) void removeTeam(del.dataset.teamDel);
  });
  el('admAnnounceForm').addEventListener('submit', submitAnnouncement);
  el('admAnnounceList').addEventListener('click', event => {
    const del = event.target.closest('[data-ann-del]');
    if (del) void removeAnnouncement(del.dataset.annDel);
  });
  el('admAdminTable').addEventListener('click', event => {
    const del = event.target.closest('[data-admin-del]');
    if (del) void removeAdminRow(del.dataset.adminDel);
  });
  document.querySelectorAll('.adm-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.adm-tab').forEach(other => other.classList.toggle('active', other === tab));
    TABS.forEach(name => el(`admPanel-${name}`).classList.toggle('hidden', name !== tab.dataset.admTab));
    if (tab.dataset.admTab === 'dashboard') void loadDashboard();
    if (tab.dataset.admTab === 'tournaments') void loadTournamentList();
    if (tab.dataset.admTab === 'missions') void loadMissions();
    if (tab.dataset.admTab === 'teams') void loadTeamsAdmin();
    if (tab.dataset.admTab === 'announcements') void loadAnnouncementsAdmin();
    if (tab.dataset.admTab === 'settings') void loadAdminList();
  }));
  el('admTournamentList').addEventListener('click', event => {
    const manage = event.target.closest('[data-t-manage]');
    if (manage) return void toggleManage(manage.dataset.tManage);
    const start = event.target.closest('[data-t-start]');
    if (start) return void manageAction('start', start.dataset.tStart);
    const finish = event.target.closest('[data-t-finish]');
    if (finish) return void manageAction('finish', finish.dataset.tFinish);
    const reset = event.target.closest('[data-t-reset]');
    if (reset) return void manageAction('reset', reset.dataset.tReset);
    const cancel = event.target.closest('[data-t-cancel]');
    if (cancel) return void manageAction('cancel', cancel.dataset.tCancel);
    const exportBtn = event.target.closest('[data-t-export]');
    if (exportBtn) return exportTournament(exportBtn.dataset.tExport);
    const add = event.target.closest('[data-t-add]');
    if (add) {
      const input = document.querySelector(`[data-t-addname="${add.dataset.tAdd}"]`);
      return void manageAction('add', add.dataset.tAdd, input?.value || '');
    }
    const rmp = event.target.closest('[data-t-rmp]');
    if (rmp) {
      const item = rmp.closest('[data-t-item]');
      return void manageAction('removeParticipant', item.dataset.tItem, rmp.dataset.tRmp);
    }
    const save = event.target.closest('[data-ms-save]');
    if (save) {
      const item = save.closest('[data-t-item]');
      const a = document.querySelector(`[data-ms-a="${save.dataset.msSave}"]`)?.value;
      const b = document.querySelector(`[data-ms-b="${save.dataset.msSave}"]`)?.value;
      if (a === '' || b === '') { alert('กรอกคะแนนทั้งสองฝั่งก่อนบันทึก'); return; }
      return void manageAction('score', item.dataset.tItem, { id: save.dataset.msSave, a: Number(a), b: Number(b) });
    }
    const saveSchedule = event.target.closest('[data-ms-saveschedule]');
    if (saveSchedule) {
      const item = saveSchedule.closest('[data-t-item]');
      const value = document.querySelector(`[data-ms-time="${saveSchedule.dataset.msSaveschedule}"]`)?.value;
      return void manageAction('schedule', item.dataset.tItem, { id: saveSchedule.dataset.msSaveschedule, value });
    }
    const code = event.target.closest('[data-t-code]');
    if (code) {
      const value = getAdminCode(code.dataset.tCode);
      if (value) alert(`รหัสผู้ดูแลรายการนี้: ${value}`);
    }
    const qrBtn = event.target.closest('[data-t-qr]');
    if (qrBtn) return showJoinQr(qrBtn.dataset.tQr);
  });
  el('admQrClose').addEventListener('click', () => { el('admQrOverlay').hidden = true; });
  el('admQrOverlay').addEventListener('click', event => {
    if (event.target === el('admQrOverlay')) el('admQrOverlay').hidden = true;
  });
  el('admTournamentList').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('[data-t-addname]');
    if (input) {
      event.preventDefault();
      void manageAction('add', input.dataset.tAddname, input.value);
    }
  });
}

wire();
void checkSession();
