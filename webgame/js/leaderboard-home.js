// Real leaderboard: game workouts + mission points (person) and team totals.
// Replaces the mockup rows; falls back to a friendly note when data is missing.
import { leaderboard } from './data.js';
import { playerSession } from './data.js';

const el = id => document.getElementById(id);

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const rankCell = i => i < 3
  ? `<img class="rank-img" src="assets/icons/rank${i + 1}.png" alt="อันดับ ${i + 1}">`
  : `<span class="rank-badge">${i + 1}</span>`;

async function loadMissionPoints() {
  const api = await playerSession();
  const { data, error } = await api.from('weston_mission_completions')
    .select('user_id,points_awarded').limit(10000);
  if (error) throw error;
  const points = new Map();
  for (const row of data) points.set(row.user_id, (points.get(row.user_id) || 0) + row.points_awarded);
  return points;
}

async function loadTeams() {
  const api = await playerSession();
  const [teams, members] = await Promise.all([
    api.from('weston_teams').select('id,name,emoji').order('name').limit(50),
    api.from('weston_team_members').select('team_id,user_id').limit(5000),
  ]);
  if (teams.error) throw teams.error;
  if (members.error) throw members.error;
  return { teams: teams.data || [], members: members.data || [] };
}

function rowHtml({ rank, name, emoji, score, you, maxScore }) {
  return `
  <div class="lb-row ${you ? 'you' : ''}">
    <div class="lb-rank">${rankCell(rank - 1)}</div>
    <div class="lb-player">
      <span class="lb-ava">${emoji}</span>
      <span class="lb-name">${escapeHtml(name)}${you ? '<span class="you-chip">คุณ</span>' : ''}</span>
    </div>
    <div class="lb-score">
      <div class="lb-scorebar"><i style="width:${Math.round((score / (maxScore || 1)) * 100)}%"></i></div>
      <div class="lb-flame"><span>🔥</span>${score.toLocaleString('th-TH')}</div>
    </div>
  </div>`;
}

export async function renderLeaderboard() {
  const personList = el('lbPerson');
  const teamList = el('lbTeam');
  try {
    const [{ rows, userId }, missionPoints, { teams, members }] = await Promise.all([
      leaderboard(), loadMissionPoints(), loadTeams(),
    ]);
    const people = rows
      .map(row => ({
        userId: row.user_id,
        name: row.display_name,
        emoji: '😎',
        workouts: row.total_workouts,
        score: row.total_workouts * 10 + (missionPoints.get(row.user_id) || 0),
        you: row.user_id === userId,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    if (!people.length) {
      personList.insertAdjacentHTML('beforeend',
        '<p style="grid-column:1/-1;text-align:center;color:#5B7191;font-size:13px;padding:10px">ยังไม่มีผู้เล่นบนกระดานอันดับ — เริ่มเล่นเกมเพื่อขึ้นอันดับ!</p>');
    } else {
      const maxScore = people[0].score;
      personList.insertAdjacentHTML('beforeend', people.map((p, i) =>
        rowHtml({ rank: i + 1, name: p.name, emoji: p.emoji, score: p.score, you: p.you, maxScore })).join(''));
    }
    const byTeam = new Map(teams.map(team => [team.id, { ...team, score: 0, members: 0 }]));
    for (const member of members) {
      const team = byTeam.get(member.team_id);
      if (!team) continue;
      team.members += 1;
      for (const person of people) {
        if (person.userId === member.user_id) team.score += person.score;
      }
    }
    const teamRows = [...byTeam.values()].sort((a, b) => b.score - a.score);
    if (!teamRows.length) {
      teamList.insertAdjacentHTML('beforeend',
        '<p style="grid-column:1/-1;text-align:center;color:#5B7191;font-size:13px;padding:10px">ยังไม่มีทีม — ผู้ดูแลสร้างทีมได้ในหน้าเว็บแอดมิน แล้วเลือกทีมได้ในแท็บ “ทีม”</p>');
    } else {
      const maxTeam = teamRows[0].score || 1;
      teamList.insertAdjacentHTML('beforeend', teamRows.map((team, i) =>
        rowHtml({ rank: i + 1, name: `${team.name} · ${team.members} คน`, emoji: team.emoji, score: team.score, you: false, maxScore: maxTeam })).join(''));
    }
  } catch (error) {
    personList.insertAdjacentHTML('beforeend',
      `<p style="grid-column:1/-1;text-align:center;color:#5B7191;font-size:12.5px;padding:10px">โหลดอันดับไม่ได้ (${escapeHtml(error?.message || 'offline')})</p>`);
  }
}

void renderLeaderboard();
