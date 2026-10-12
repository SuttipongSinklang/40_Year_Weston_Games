// Goal screen with real data (#15) and health trend charts (#16).
import { playerSession, loadRunsFromCloud } from './data.js?v=20261012-2';

const el = id => document.getElementById(id);

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function startOfWeek() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return monday.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function dayKey(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

async function loadWeekStats() {
  const api = await playerSession();
  const since = startOfWeek();
  const [runs, workouts, completions] = await Promise.all([
    loadRunsFromCloud().catch(() => ({ rows: [] })),
    api.from('weston_days').select('played_on,workouts').gte('played_on', since).limit(30),
    api.from('weston_mission_completions').select('mission_id').gte('completed_at', new Date(Date.now() - 7 * 864e5).toISOString()).eq('user_id', api.userId).limit(500),
  ]);
  let meters = 0;
  for (const run of runs.rows) {
    if (dayKey(run.started_at) >= since) meters += run.distance_m || 0;
  }
  return {
    km: Math.round((meters / 1000) * 10) / 10,
    workouts: (workouts.data || []).reduce((sum, day) => sum + day.workouts, 0),
    missions: (completions.data || []).length,
  };
}

function goalItem({ ico, name, done, total, unit, pct }) {
  return `
  <div class="goal-item card">
    <span class="goal-ico">${ico}</span>
    <div class="goal-mid">
      <h4><span>${name} (${unit})</span><b>${done.toLocaleString('th-TH')}/${total.toLocaleString('th-TH')}</b></h4>
      <div class="goal-track"><div class="goal-fill" data-w="${Math.min(100, pct)}"></div></div>
    </div>
    ${pct >= 100 ? '<span class="goal-done">✓</span>' : ''}
  </div>`;
}

async function renderGoals() {
  try {
    const stats = await loadWeekStats();
    const goals = [
      { ico: '🏃', name: 'วิ่งสัปดาห์นี้', done: stats.km, total: 10, unit: 'กม.', pct: stats.km / 10 * 100 },
      { ico: '💪', name: 'ออกกำลังกายสัปดาห์นี้', done: stats.workouts, total: 5, unit: 'ครั้ง', pct: stats.workouts / 5 * 100 },
      { ico: '🎯', name: 'ภารกิจสำเร็จ 7 วัน', done: stats.missions, total: 3, unit: 'ภารกิจ', pct: stats.missions / 3 * 100 },
    ];
    el('goalList').innerHTML = goals.map(goalItem).join('')
      + '<p class="t-help" style="padding:0 4px">เป้าหมายอัตโนมัติจากข้อมูลจริงของสัปดาห์นี้ (จันทร์–อาทิตย์ ตามเวลาไทย)</p>';
  } catch { /* keep the mock goals on failure */ }
  window.westonGoalsRendered = true; // achievements-home.js adds its shelf after this
}

// ── Health trends (#16): tiny inline SVG line charts, no libraries ──
function lineChart(points, { width = 300, height = 90, decimals = 1 } = {}) {
  if (points.length < 2) return '<p class="t-help">ยังไม่มีข้อมูลพอสำหรับกราฟ (บันทึกสุขภาพอย่างน้อย 2 วัน)</p>';
  const values = points.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => `${(i * stepX).toFixed(1)},${(height - 8 - ((p.value - min) / span) * (height - 20)).toFixed(1)}`);
  return `<svg viewBox="0 0 ${width} ${height + 14}" style="width:100%;height:auto" role="img" aria-label="กราฟแนวโน้ม">
    <polyline points="${coords.join(' ')}" fill="none" stroke="#3DBE5B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="0,${height} ${coords.join(' ')} ${width},${height}" fill="#3DBE5B" opacity="0.12" stroke="none"/>
    <text x="2" y="${height + 12}" font-size="9" fill="#5B7191">${points[0].label}</text>
    <text x="${width - 2}" y="${height + 12}" font-size="9" fill="#5B7191" text-anchor="end">${points[points.length - 1].label} · ${max.toFixed(decimals)}</text>
  </svg>`;
}

async function renderTrends() {
  try {
    const api = await playerSession();
    const { data, error } = await api.from('weston_health_history')
      .select('recorded_on,weight_kg,bmi,body_fat_percent')
      .eq('user_id', api.userId).order('recorded_on', { ascending: true }).limit(90);
    if (error) throw error;
    if (!data || data.length < 2) return;
    const toPoints = key => data.filter(row => row[key] != null).map(row => ({
      value: Number(row[key]),
      label: new Date(row.recorded_on).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
    }));
    const weight = toPoints('weight_kg');
    const fat = toPoints('body_fat_percent');
    if (weight.length < 2 && fat.length < 2) return;
    el('goalList').insertAdjacentHTML('beforeend', `
      <div class="card summary-card">
        <h3>📈 แนวโน้มสุขภาพของคุณ</h3>
        ${weight.length >= 2 ? `<p class="t-help" style="margin:6px 0 2px">น้ำหนัก (กก.)</p>${lineChart(weight)}` : ''}
        ${fat.length >= 2 ? `<p class="t-help" style="margin:10px 0 2px">ไขมัน (%)</p>${lineChart(fat)}` : ''}
      </div>`);
  } catch { /* trends are optional */ }
}

void (async () => {
  await renderGoals();
  await renderTrends();
})();
