// Printable certificate page: pick any participant (or the champion) of a
// tournament and print/save as PDF via the browser dialog.
import { getTournamentDetail, friendlyTournamentError } from './tournament-cloud.js?v=20261012-2';
import { computeStandings, championOf } from './tournament-bracket.js?v=20261012-2';

const el = id => document.getElementById(id);
const tournamentId = new URLSearchParams(location.search).get('id');
let detail = null;

function thaiDate(value) {
  try { return new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}

function renderPickers() {
  const { tournament, participants, matches } = detail;
  const standings = tournament.format === 'round_robin' && matches.length
    ? computeStandings(participants, matches, tournament)
    : [];
  const options = [];
  const champ = championOf(matches);
  if (champ) {
    const name = participants.find(p => p.id === champ)?.name;
    if (name) options.push({ id: champ, name, label: `🥇 ผู้ชนะเลิศ — ${name}` });
  }
  for (const row of standings.slice(1, 3)) {
    options.push({ id: row.participantId, name: row.name, label: `${row.rank === 2 ? '🥈 รองชนะเลิศ' : '🥉 อันดับ 3'} — ${row.name}` });
  }
  for (const p of participants) {
    if (!options.some(option => option.id === p.id)) options.push({ id: p.id, name: p.name, label: `เข้าร่วม — ${p.name}` });
  }
  el('certPicker').innerHTML = options.map(option =>
    `<option value="${option.id}">${option.label}</option>`).join('');
}

function renderCertificate() {
  const { tournament, participants, matches } = detail;
  const selectedId = el('certPicker').value;
  const participant = participants.find(p => p.id === selectedId);
  if (!participant) return;
  const champ = championOf(matches);
  const standings = tournament.format === 'round_robin' && matches.length
    ? computeStandings(participants, matches, tournament) : [];
  let rankText = 'เข้าร่วมการแข่งขัน';
  if (champ === participant.id) rankText = 'ความสามารถเป็นที่ประจักษ์ ได้รับรางวัลชนะเลิศ';
  else {
    const row = standings.find(r => r.participantId === participant.id);
    if (row) rankText = `ได้อันดับที่ ${row.rank} ของรายการ`;
  }
  el('certTitle').textContent = `เกียรติบัตร${tournament.sportIcon} ${tournament.sport}`;
  el('certEvent').textContent = `งานแข่งขัน ${tournament.title}`;
  el('certWinner').textContent = participant.name;
  el('certRank').textContent = rankText;
  el('certMeta').textContent = `จัดโดย Weston Fit Quest · ออกใบเมื่อ ${thaiDate(Date.now())}`;
  document.title = `เกียรติบัตร — ${participant.name}`;
}

el('certPicker').addEventListener('change', renderCertificate);
el('certPrint').addEventListener('click', () => window.print());

if (!tournamentId) {
  el('certWinner').textContent = 'ไม่ได้ระบุรายการ';
} else {
  try {
    detail = await getTournamentDetail(tournamentId);
    renderPickers();
    renderCertificate();
  } catch (error) {
    el('certWinner').textContent = friendlyTournamentError(error);
  }
}
