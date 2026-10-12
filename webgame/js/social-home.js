// Social screen: real team membership (#3) and the live activity feed (#12).
// Teams are created on the admin site; players pick their team here.
import { playerSession } from './data.js?v=20261012-2';

const el = id => document.getElementById(id);

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function toast(message) {
  const element = el('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2600);
}

async function loadTeamsAndMembership() {
  const api = await playerSession();
  const [teams, members] = await Promise.all([
    api.from('weston_teams').select('id,name,emoji').order('name').limit(50),
    api.from('weston_team_members').select('team_id,user_id').eq('user_id', api.userId).limit(200),
  ]);
  if (teams.error) throw teams.error;
  if (members.error) throw members.error;
  return { teams: teams.data || [], myTeamId: members.data[0]?.team_id || null, userId: api.userId };
}

async function joinTeam(teamId, previousTeamId) {
  const api = await playerSession();
  if (previousTeamId) {
    const removal = await api.from('weston_team_members')
      .delete().eq('team_id', previousTeamId).eq('user_id', api.userId);
    if (removal.error) throw removal.error;
  }
  if (teamId) {
    const insertion = await api.from('weston_team_members')
      .insert({ team_id: teamId, user_id: api.userId });
    if (insertion.error) throw insertion.error;
  }
}

function renderTeams(teams, myTeamId) {
  const row = el('friendsRow');
  if (!teams.length) {
    row.innerHTML = '<p class="t-intro" style="color:#fff;text-shadow:0 2px 4px rgba(30,58,95,.4)">ยังไม่มีทีม — ผู้ดูแลสร้างทีมได้ในหน้าเว็บแอดมิน</p>';
    return;
  }
  row.innerHTML = teams.map(team => `
    <button type="button" class="friend" data-team-join="${team.id}" style="border:none;background:none;cursor:pointer;font-family:var(--font-th)">
      <span class="friend-ava" ${team.id === myTeamId ? 'style="border-color:var(--green-lt)"' : ''}>${escapeHtml(team.emoji)}</span>
      <small>${escapeHtml(team.name)}${team.id === myTeamId ? ' ✓' : ''}</small>
    </button>`).join('');
}

async function loadFeed() {
  const api = await playerSession();
  const { data, error } = await api.from('weston_events')
    .select('kind,text,created_at').order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  const feed = el('feed');
  if (!data.length) {
    feed.innerHTML = '<p class="t-intro" style="color:#fff;text-shadow:0 2px 4px rgba(30,58,95,.4)">ยังไม่มีกิจกรรม — ภารกิจ ผลการแข่งขัน จะโผล่ที่นี่</p>';
    return;
  }
  const iconFor = { mission: '🎯', match: '🏆', achievement: '🏅' };
  feed.innerHTML = data.map(event => `
    <div class="feed-item card">
      <span class="lb-ava">${iconFor[event.kind] || '✨'}</span>
      <div>
        <h4>${escapeHtml(event.text)}</h4>
        <div class="feed-meta"><span>${new Date(event.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} น.</span></div>
      </div>
    </div>`).join('');
}

async function refresh() {
  try {
    const { teams, myTeamId } = await loadTeamsAndMembership();
    renderTeams(teams, myTeamId);
  } catch { renderTeams([], null); }
  try { await loadFeed(); } catch { /* feed is optional */ }
}

el('friendsRow')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-team-join]');
  if (!button) return;
  try {
    const { myTeamId } = await loadTeamsAndMembership();
    await joinTeam(button.dataset.teamJoin, myTeamId);
    toast('เข้าทีมเรียบร้อย!');
    const { teams, myTeamId: updated } = await loadTeamsAndMembership();
    renderTeams(teams, updated);
  } catch (error) {
    toast(error?.message?.includes('duplicate') ? 'คุณอยู่ทีมนี้แล้ว' : 'เข้าทีมไม่สำเร็จ ลองใหม่');
  }
});

void refresh();
