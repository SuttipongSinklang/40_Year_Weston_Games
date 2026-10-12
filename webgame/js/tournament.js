// Tournament screen controller (player view): browse, join, withdraw, watch
// brackets and scores live. All management lives on the admin site (admin.html);
// admins reaching this screen see the same spectator view as everyone else.
import {
  listTournaments, getTournamentDetail, joinTournament, removeParticipant,
  subscribeTournament, addCheer, countCheers, friendlyTournamentError,
} from './tournament-cloud.js?v=20261012-2';
import { computeStandings, championOf, groupMatchSections } from './tournament-bracket.js?v=20261012-2';
import { rememberJoined } from './tournament-store.js?v=20261012-2';

const CATEGORY_LABEL = { single: 'เดี่ยว', team: 'ทีม' };
const GENDER_LABEL = { male: 'ชาย', female: 'หญิง', mixed: 'ผสม' };
const FORMAT_LABEL = { single_elim: 'แพ้คัดออก', round_robin: 'ลีกพบกันหมด' };
const STATUS_LABEL = { registering: 'เปิดรับสมัคร', ongoing: 'กำลังแข่ง', completed: 'จบแล้ว', cancelled: 'ยกเลิก' };

const el = id => document.getElementById(id);
let wired = false;
let filter = 'all';
let listCache = null;
let detail = null;
let unsubscribeRealtime = null;
let realtimeTimer = 0;
let cheerCounts = new Map();
let lastCheerAt = 0;
const CHEER_EMOJIS = ['👏', '🔥', '💪', '🎉'];

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
  setTimeout(() => element.classList.remove('show'), 3000);
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

// ───────────────────────── List ─────────────────────────

async function loadList() {
  const state = el('tListState');
  if (!navigator.onLine) {
    state.textContent = 'ออฟไลน์อยู่ ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อดูรายการแข่งขัน';
    return;
  }
  state.textContent = 'กำลังโหลดรายการ…';
  el('tList').innerHTML = '';
  try {
    listCache = await listTournaments();
    renderList();
  } catch (error) {
    state.textContent = friendlyTournamentError(error);
  }
}

function renderList() {
  const list = el('tList');
  const state = el('tListState');
  const { tournaments, adminOf, joinedOf } = listCache;
  const visible = tournaments.filter(t => {
    if (filter === 'mine') return adminOf.has(t.id) || joinedOf.has(t.id);
    if (filter === 'all') return true;
    return t.status === filter;
  });
  if (!visible.length) {
    state.textContent = filter === 'mine' ? 'คุณยังไม่ได้สมัครรายการไหนเลย' : 'ยังไม่มีรายการในหมวดนี้';
    list.innerHTML = '';
    return;
  }
  state.textContent = '';
  list.innerHTML = visible.map(t => `
    <button type="button" class="t-card" data-t-open="${t.id}">
      <span class="t-sport-ico" aria-hidden="true">${escapeHtml(t.sportIcon)}</span>
      <span class="t-card-mid">
        <span class="t-card-title">${escapeHtml(t.title)}</span>
        <span class="t-card-sub">${escapeHtml(t.sport)} · ${FORMAT_LABEL[t.format] || t.format} · ${t.participantCount}${t.maxParticipants ? `/${t.maxParticipants}` : ''} ราย</span>
        <span class="t-badges">
          <span class="t-badge">${CATEGORY_LABEL[t.category] || t.category}</span>
          <span class="t-badge">${GENDER_LABEL[t.gender] || t.gender}</span>
          <span class="t-badge status-${t.status}">${STATUS_LABEL[t.status] || t.status}</span>
          ${joinedOf.has(t.id) ? '<span class="t-card-you">สมัครแล้ว</span>' : ''}
        </span>
      </span>
    </button>`).join('');
}

// ───────────────────────── Detail ─────────────────────────

async function openDetail(tournamentId) {
  try {
    detail = await getTournamentDetail(tournamentId);
    cheerCounts = await countCheers(tournamentId).catch(() => new Map());
    renderDetail();
    el('tournamentDetailDialog').showModal();
    subscribeToDetail(tournamentId);
  } catch (error) {
    toast(friendlyTournamentError(error));
  }
}

async function refreshDetail() {
  if (!detail) return;
  try {
    detail = await getTournamentDetail(detail.tournament.id);
    renderDetail();
  } catch { /* transient refresh failures keep the current view */ }
}

function subscribeToDetail(tournamentId) {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  subscribeTournament(tournamentId, () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { void refreshDetail(); }, 600);
  }).then(unsubscribe => {
    // The dialog may have closed while the channel was connecting.
    if (!detail || detail.tournament.id !== tournamentId) unsubscribe();
    else unsubscribeRealtime = unsubscribe;
  }).catch(() => { /* live updates are optional */ });
}

function participantName(id) {
  return id ? detail.participants.find(p => p.id === id)?.name || null : null;
}

function renderDetail() {
  const { tournament, participants } = detail;
  el('tDetailSport').textContent = `${tournament.sportIcon} ${tournament.sport}`;
  el('tournamentDetailTitle').textContent = tournament.title;
  el('tDetailBadges').innerHTML = `
    <span class="t-badge">${CATEGORY_LABEL[tournament.category]}</span>
    <span class="t-badge">${GENDER_LABEL[tournament.gender]}</span>
    <span class="t-badge">${FORMAT_LABEL[tournament.format]}</span>
    <span class="t-badge status-${tournament.status}">${STATUS_LABEL[tournament.status]}</span>`;
  el('tDetailDescription').textContent = tournament.description || '';
  el('tDetailDescription').hidden = !tournament.description;
  document.querySelector('[data-t-tab="bracket"]').textContent =
    tournament.format === 'round_robin' ? 'ตารางคะแนน' : 'สายแข่ง';

  const mine = participants.find(p => p.userId === detail.userId) || null;
  const full = Boolean(tournament.maxParticipants && participants.length >= tournament.maxParticipants);
  el('tDetailInfo').innerHTML = [
    ['ผู้เข้าแข่ง', `${participants.length}${tournament.maxParticipants ? ` / ${tournament.maxParticipants}` : ''} ราย`],
    ['หน่วยคะแนน', tournament.scoreLabel],
    tournament.format === 'round_robin'
      ? ['แต้ม ชนะ/เสมอ/แพ้', `${tournament.pointsWin}/${tournament.pointsDraw}/${tournament.pointsLoss}`]
      : ['ชิงอันดับ 3', tournament.thirdPlace ? 'มี' : 'ไม่มี'],
    ['สร้างเมื่อ', thaiDate(tournament.createdAt)],
  ].map(([label, value]) => `<div class="t-info"><small>${label}</small><b>${escapeHtml(value)}</b></div>`).join('');

  renderChampion();
  renderJoinBox(mine, full);
  renderBracketPanel();
  renderPlayersPanel(mine);
  setMessage('tDetailMessage', '');
}

function renderChampion() {
  const card = el('tChampionCard');
  const { tournament, participants, matches } = detail;
  let name = null;
  if (tournament.status === 'completed' && matches.length) {
    if (tournament.format === 'single_elim') name = participantName(championOf(matches));
    else name = computeStandings(participants, matches, tournament)[0]?.name || null;
  }
  card.hidden = !name;
  if (name) card.innerHTML = `<span class="ico" aria-hidden="true">🏆</span><div><small>ผู้ชนะเลิศ</small><b>${escapeHtml(name)}</b></div>`;
}

function renderJoinBox(mine, full) {
  const box = el('tJoinBox');
  const { tournament } = detail;
  if (mine) {
    const canWithdraw = tournament.status === 'registering';
    box.innerHTML = `<p class="t-intro">คุณสมัครรายการนี้แล้วในชื่อ “${escapeHtml(mine.name)}”${canWithdraw ? '' : ' และรายการเริ่มแข่งแล้ว'}</p>
      ${canWithdraw ? '<button type="button" class="t-btn-danger" id="tWithdrawBtn">ถอนตัวออกจากการแข่งขัน</button>' : ''}`;
  } else if (tournament.status === 'registering') {
    box.innerHTML = full
      ? '<p class="t-intro">รายการนี้รับสมัครเต็มแล้ว</p>'
      : '<button type="button" class="t-btn-primary" id="tJoinBtn">📝 สมัครแข่งขัน</button>';
  } else {
    box.innerHTML = '';
  }
  el('tJoinBtn')?.addEventListener('click', openJoinDialog);
  el('tWithdrawBtn')?.addEventListener('click', () => void withdrawSelf(mine.id));
}

async function withdrawSelf(participantId) {
  try {
    await removeParticipant(participantId);
    toast('ถอนตัวเรียบร้อย');
    await refreshDetail();
    void loadList();
  } catch (error) {
    setMessage('tDetailMessage', friendlyTournamentError(error), 'error');
  }
}

function renderBracketPanel() {
  const { tournament, participants, matches } = detail;
  const bracketWrap = el('tBracketWrap');
  const standingsWrap = el('tStandingsWrap');
  const matchListWrap = el('tMatchListWrap');
  bracketWrap.innerHTML = '';
  standingsWrap.innerHTML = '';
  matchListWrap.innerHTML = '';
  if (!matches.length) {
    bracketWrap.innerHTML = '<p class="t-state">ยังไม่ได้จัดสาย — รอผู้ดูแลเริ่มรายการ</p>';
    return;
  }
  if (tournament.format === 'round_robin') {
    const table = computeStandings(participants, matches, tournament);
    standingsWrap.innerHTML = `<div class="t-table-wrap"><table class="t-table">
      <caption class="visually-hidden">ตารางคะแนนลีก</caption>
      <thead><tr><th scope="col">#</th><th scope="col">ชื่อ</th><th scope="col">แข่ง</th><th scope="col">ชนะ</th><th scope="col">เสมอ</th><th scope="col">แพ้</th><th scope="col">ได้-เสีย</th><th scope="col">แต้ม</th></tr></thead>
      <tbody>${table.map(row => `
        <tr>
          <td class="num">${row.rank}</td>
          <td class="name">${escapeHtml(row.name)}</td>
          <td class="num">${row.played}</td>
          <td class="num">${row.win}</td>
          <td class="num">${row.draw}</td>
          <td class="num">${row.loss}</td>
          <td class="num">${row.scored}-${row.conceded}</td>
          <td class="pts">${row.points}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="t-help">เสมอกันเรียงด้วยผลเจอกัน ตามด้วยผลต่างคะแนน</p>`;
    matchListWrap.innerHTML = '<h3 class="t-intro" style="margin:2px 0 -2px">โปรแกรมการแข่งขัน</h3>'
      + groupMatchSections(matches)[0].rounds.map(round => `
        <div class="t-round-group">
          <div class="t-round-head">${escapeHtml(round.label)}</div>
          ${round.matches.map(listMatchHtml).join('')}
        </div>`).join('');
    return;
  }
  const sections = groupMatchSections(matches);
  bracketWrap.innerHTML = renderCheerBar() + '<div class="t-bracket">' + sections.map(section =>
    section.rounds.map(round => `
    <div class="t-round">
      <div class="t-round-title">${escapeHtml(round.label)}</div>
      ${round.matches.map(matchCardHtml).join('')}
    </div>`).join('')).join('') + '</div>';
}

function renderCheerBar() {
  if (!detail || detail.tournament.status === 'cancelled') return '';
  return `<div class="t-cheer-bar" style="display:flex;gap:8px;flex-wrap:wrap;padding:2px 2px 8px">
    ${CHEER_EMOJIS.map(emoji => `
      <button type="button" class="t-cheer" data-cheer="${emoji}"
        style="border:2px solid var(--cream-dk);background:#fff;border-radius:999px;padding:8px 16px;font-size:18px;cursor:pointer;min-height:44px;font-family:var(--font-th)">
        ${emoji} <b style="font-family:var(--font-num);font-weight:900;color:var(--orange-dk)">${cheerCounts.get(emoji) || 0}</b>
      </button>`).join('')}
  </div>`;
}

function refreshCheerBar() {
  const bar = el('tBracketWrap')?.querySelector('.t-cheer-bar');
  if (!bar) return;
  bar.outerHTML = renderCheerBar();
}

function matchCardHtml(match) {
  const bye = match.status === 'bye';
  const completed = match.status === 'completed';
  const nameA = participantName(match.slotA);
  const nameB = participantName(match.slotB);
  const scheduleText = match.scheduledAt
    ? ' · ' + new Date(match.scheduledAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.'
    : '';
  const sideRow = (name, score, isWinner) => `
    <div class="t-match-row">
      <span class="side ${name ? (completed && !isWinner ? 'loser' : isWinner && completed ? 'winner' : '') : 'empty'}">${name ? escapeHtml(name) : (bye ? '— ผ่าน BYE' : 'รอผู้ชนะ')}</span>
      ${completed && name ? `<span class="t-match-score">${score ?? '–'}</span>` : ''}
    </div>`;
  return `<div class="t-match${bye ? ' bye' : ''}" aria-label="${escapeHtml(match.roundLabel)} แมตช์ที่ ${match.matchNo}">
    ${sideRow(nameA, match.scoreA, match.winnerId === match.slotA)}
    ${sideRow(nameB, match.scoreB, match.winnerId === match.slotB)}
    <div class="t-match-footer">#${match.matchNo}${scheduleText} · ${bye ? 'BYE ผ่านอัตโนมัติ' : completed ? 'จบแล้ว' : 'รอลงสนาม'}</div>
  </div>`;
}

function listMatchHtml(match) {
  const nameA = participantName(match.slotA);
  const nameB = participantName(match.slotB);
  const completed = match.status === 'completed';
  return `<div class="t-list-match">
    <span class="vs"><b>${escapeHtml(nameA || '—')}</b> vs <b>${escapeHtml(nameB || '—')}</b></span>
    ${completed ? `<span class="sc">${match.scoreA}–${match.scoreB}</span>` : '<span class="sc" style="color:#B9C7D6">รอแข่ง</span>'}
  </div>`;
}

function renderPlayersPanel(mine) {
  const { tournament, participants } = detail;
  const wrap = el('tPlayersWrap');
  if (!participants.length) {
    wrap.innerHTML = '<p class="t-state">ยังไม่มีผู้สมัคร</p>';
    return;
  }
  const showSeeds = tournament.status !== 'registering' && participants.some(p => p.seed);
  wrap.innerHTML = '<div class="t-players">' + participants.map(p => {
    const canWithdraw = mine?.id === p.id && tournament.status === 'registering';
    return `<div class="t-player">
      ${showSeeds ? `<span class="t-player-seed" aria-label="ลำดับสาย">${p.seed || '-'}</span>` : ''}
      <span class="nm">${escapeHtml(p.name)}${p.userId === detail.userId ? '<span class="you-chip">คุณ</span>' : ''}
        ${p.members?.length ? `<span class="mem">สมาชิก: ${escapeHtml(p.members.join(', '))}</span>` : ''}</span>
      ${canWithdraw ? `<button type="button" class="t-x" data-t-remove="${p.id}" aria-label="ถอนตัวออกจากรายการ">✕</button>` : ''}
    </div>`;
  }).join('') + '</div>';
}

// ───────────────────────── Join flow ─────────────────────────

function openJoinDialog() {
  const { tournament } = detail;
  el('tJoinEyebrow').textContent = `สมัคร · ${tournament.title}`;
  el('tJoinNameLabel').firstChild.textContent = tournament.category === 'team' ? 'ชื่อทีม' : 'ชื่อที่แสดง';
  el('tJoinMembersField').hidden = tournament.category !== 'team';
  const form = el('tournamentJoinForm');
  form.reset();
  form.elements.name.removeAttribute('aria-invalid');
  setMessage('tJoinMessage', '');
  el('tournamentJoinDialog').showModal();
}

async function submitJoin(event) {
  event.preventDefault();
  const form = el('tournamentJoinForm');
  const name = (form.elements.name.value || '').trim();
  if (!name) {
    setMessage('tJoinMessage', 'กรุณากรอกชื่อ', 'error');
    form.elements.name.setAttribute('aria-invalid', 'true');
    return;
  }
  form.elements.name.removeAttribute('aria-invalid');
  const members = form.elements.members.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 20);
  setMessage('tJoinMessage', 'กำลังส่งใบสมัคร…');
  try {
    await joinTournament(detail.tournament.id, { name, members });
    rememberJoined(detail.tournament.id);
    el('tournamentJoinDialog').close();
    toast('สมัครเรียบร้อย!');
    await refreshDetail();
    void loadList();
  } catch (error) {
    setMessage('tJoinMessage', friendlyTournamentError(error), 'error');
  }
}

// ───────────────────────── Wiring ─────────────────────────

function wire() {
  document.querySelectorAll('.t-pill-tabs .pill').forEach(pill => pill.addEventListener('click', () => {
    document.querySelectorAll('.t-pill-tabs .pill').forEach(other => other.classList.toggle('active', other === pill));
    filter = pill.dataset.tFilter;
    if (listCache) renderList();
  }));
  el('tList').addEventListener('click', event => {
    const card = event.target.closest('[data-t-open]');
    if (card) void openDetail(card.dataset.tOpen);
  });
  document.querySelectorAll('[data-t-close]').forEach(button => button.addEventListener('click', () => {
    el(button.dataset.tClose)?.close();
  }));
  el('tournamentDetailDialog').addEventListener('close', () => {
    clearTimeout(realtimeTimer);
    unsubscribeRealtime?.();
    unsubscribeRealtime = null;
    detail = null;
  });
  document.querySelectorAll('.t-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.t-tab').forEach(other => {
      const selected = other === tab;
      other.classList.toggle('active', selected);
      other.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    ['overview', 'bracket', 'players'].forEach(name => {
      el(`tPanel-${name}`).hidden = name !== tab.dataset.tTab;
    });
  }));
  el('tournamentJoinForm').addEventListener('submit', event => void submitJoin(event));
  el('tPlayersWrap').addEventListener('click', event => {
    const button = event.target.closest('[data-t-remove]');
    if (button) void withdrawSelf(button.dataset.tRemove);
  });
  el('tBracketWrap').addEventListener('click', async event => {
    const cheer = event.target.closest('[data-cheer]');
    if (!cheer || !detail) return;
    const now = Date.now();
    if (now - lastCheerAt < 1500) return;
    lastCheerAt = now;
    const emoji = cheer.dataset.cheer;
    try {
      await addCheer(detail.tournament.id, emoji);
      cheerCounts.set(emoji, (cheerCounts.get(emoji) || 0) + 1);
      refreshCheerBar();
    } catch (error) {
      toast(friendlyTournamentError(error));
    }
  });
}

function activate() {
  if (wired) return;
  wired = true;
  wire();
  void loadList();
  handleJoinHash();
}
// QR join links use #tournament-<uuid>; navigation.js's hash router treats the
// unknown screen as home, so switch to this screen first, then open the detail.
function handleJoinHash() {
  const match = location.hash.match(/^#tournament-([0-9a-f-]{36})/i);
  if (!match || match[1] === detail?.tournament?.id) return;
  const tournamentId = match[1];
  document.querySelector('.nav-btn[data-screen="tournament"]')?.click();
  void openDetail(tournamentId);
}
window.addEventListener('hashchange', () => {
  if (location.hash.match(/^#tournament-/i)) handleJoinHash();
});
window.addEventListener('screenchange', event => {
  if (event.detail === 'tournament') activate();
});
// navigation.js fires the initial screenchange during its own module evaluation,
// before this module registers the listener — cover a direct #tournament load too
// (same late-arrival guard running.js uses for its lazy import).
if (document.getElementById('screen-tournament')?.classList.contains('active')) activate();
