// Projector mode: full-screen live bracket/standings for event displays.
// Auto-updates through the same realtime channel the player app uses.
import {
  getTournamentDetail, subscribeTournament, addCheer, countCheers, friendlyTournamentError,
} from './tournament-cloud.js?v=20261012-1';
import { computeStandings, groupMatchSections, championOf } from './tournament-bracket.js';

const el = id => document.getElementById(id);
const tournamentId = new URLSearchParams(location.search).get('id');
const CHEER_EMOJIS = ['👏', '🔥', '💪', '🎉'];
let detail = null;
let cheerCounts = new Map();
let lastCheerAt = 0;
let refreshTimer = 0;

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function toast(message) {
  let node = el('liveToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'liveToast';
    node.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#fff;color:#12263f;border-radius:12px;padding:10px 20px;font-size:15px;opacity:0;transition:opacity .3s;z-index:9;pointer-events:none';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.opacity = '1';
  setTimeout(() => { node.style.opacity = '0'; }, 2400);
}

function participantName(id) {
  return id ? detail.participants.find(p => p.id === id)?.name || '—' : '—';
}

function render() {
  const { tournament, participants, matches } = detail;
  document.title = `${tournament.title} — สายการแข่งขันสด`;
  el('liveSport').textContent = tournament.sportIcon;
  el('liveTitle').textContent = tournament.title;
  const finished = tournament.status === 'completed';
  el('liveStatus').textContent = finished ? 'จบแล้ว' : 'LIVE';
  el('liveStatus').style.background = finished ? '#3f5570' : '#c0262a';
  el('liveStatus').style.animation = finished ? 'none' : '';
  el('liveSub').textContent = `${tournament.sport} · ${participants.length} ราย${finished && championOf(matches) ? ` · ผู้ชนะเลิศ: ${participantName(championOf(matches))}` : ''}`;
  if (tournament.format === 'round_robin') {
    el('liveBracketSection').hidden = true;
    el('liveStandingsSection').hidden = false;
    const table = computeStandings(participants, matches, tournament);
    el('liveStandings').innerHTML = `
      <thead><tr><th>#</th><th>ชื่อ</th><th>แข่ง</th><th>ชนะ</th><th>เสมอ</th><th>แพ้</th><th>ได้-เสีย</th><th>แต้ม</th></tr></thead>
      <tbody>${table.map(row => `
        <tr>
          <td>${row.rank}</td>
          <td class="name">${escapeHtml(row.name)}</td>
          <td>${row.played}</td><td>${row.win}</td><td>${row.draw}</td><td>${row.loss}</td>
          <td>${row.scored}-${row.conceded}</td>
          <td class="pts">${row.points}</td>
        </tr>`).join('')}</tbody>`;
  } else {
    el('liveBracketSection').hidden = false;
    el('liveStandingsSection').hidden = true;
    const sections = matches.length ? groupMatchSections(matches) : [];
    el('liveBracket').innerHTML = sections.length
      ? sections.map(section => section.rounds.map(round => `
        <div class="live-round">
          <div class="live-round-title">${escapeHtml(round.label)}</div>
          ${round.matches.map(match => {
            const completed = match.status === 'completed';
            const bye = match.status === 'bye';
            const row = (name, score, isWinner) => `
              <div class="live-match-row">
                <span class="side ${name !== '—' && completed ? (isWinner ? 'winner' : 'loser') : ''}">${escapeHtml(name)}</span>
                ${completed && name !== '—' ? `<span class="live-match-score">${score ?? '–'}</span>` : ''}
              </div>`;
            return `<div class="live-match${bye ? ' bye' : ''}">
              ${row(participantName(match.slotA), match.scoreA, match.winnerId === match.slotA)}
              ${row(participantName(match.slotB), match.scoreB, match.winnerId === match.slotB)}
              <div class="live-match-footer">#${match.matchNo}${match.scheduledAt ? ' · ' + new Date(match.scheduledAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} · ${bye ? 'BYE' : completed ? 'จบแล้ว' : 'รอลงสนาม'}</div>
            </div>`;
          }).join('')}
        </div>`).join('')).join('')
      : '<p style="color:#9FB6CE;font-size:20px">ยังไม่ได้จัดสาย — รอผู้ดูแลเริ่มรายการ</p>';
  }
  el('liveCheers').innerHTML = CHEER_EMOJIS.map(emoji => `
    <button type="button" class="live-cheer" data-cheer="${escapeHtml(emoji)}">
      <span>${escapeHtml(emoji)}</span><b>${cheerCounts.get(emoji) || 0}</b>
    </button>`).join('');
}

async function refresh() {
  try {
    detail = await getTournamentDetail(tournamentId);
    cheerCounts = await countCheers(tournamentId).catch(() => new Map());
    render();
  } catch (error) {
    el('liveTitle').textContent = friendlyTournamentError(error);
  }
}

el('liveCheers').addEventListener('click', async event => {
  const button = event.target.closest('[data-cheer]');
  if (!button) return;
  const now = Date.now();
  if (now - lastCheerAt < 1500) { toast('เชียร์ได้ปกติ พักแป๊บนึง~'); return; }
  lastCheerAt = now;
  const emoji = button.dataset.cheer;
  try {
    await addCheer(tournamentId, emoji);
    cheerCounts.set(emoji, (cheerCounts.get(emoji) || 0) + 1);
    render();
  } catch (error) {
    toast(friendlyTournamentError(error));
  }
});

if (!tournamentId) {
  el('liveTitle').textContent = 'ไม่ได้ระบุรายการ — เปิดจากหน้าเว็บแอดมิน (ปุ่ม 📺 โหมดจอโปรเจกเตอร์)';
} else {
  void refresh();
  subscribeTournament(tournamentId, () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refresh(); }, 700);
  }).catch(() => { /* realtime optional; manual refresh still works */ });
  setInterval(() => { void refresh(); }, 60000);
}
