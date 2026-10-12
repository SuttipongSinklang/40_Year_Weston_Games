// Supabase access for tournaments. All reads go through the public RLS policies,
// writes for management go through admin-gated policies; creation and admin-code
// claiming use the security-definer RPCs from supabase/tournaments.sql.
import { playerSession } from './data.js';
import {
  buildSingleElimBracket,
  buildDoubleElimBracket,
  buildRoundRobinMatches,
  applyScore,
  shuffleEntries,
} from './tournament-bracket.js';

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // LAN http://192.168.x.x does not expose randomUUID on some mobile browsers.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function friendlyTournamentError(error) {
  const message = `${error?.message || error || ''}`;
  if (!navigator.onLine || /fetch|network|timeout/i.test(message)) {
    return 'ออฟไลน์อยู่ ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อใช้งานทัวร์นาเมนต์';
  }
  if (/duplicate key/i.test(message) || error?.code === '23505') return 'คุณสมัครรายการนี้อยู่แล้ว';
  if (/row-level security/i.test(message) && /weston_participants/.test(message)) {
    return 'ไม่มีสิทธิ์บันทึกรายชื่อ — รายการอาจเริ่มแข่งแล้วหรือปิดรับสมัครแล้ว';
  }
  if (/PGRST|does not exist|schema cache|permission denied|row-level security/i.test(message) || error?.code === '42501') {
    return 'ต้องติดตั้งตารางทัวร์นาเมนต์ก่อน (รัน supabase/tournaments.sql ใน SQL Editor แล้วลองใหม่)';
  }
  return `เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง (${message})`;
}

export function mapTournament(row) {
  return row && {
    id: row.id,
    title: row.title,
    sport: row.sport,
    sportIcon: row.sport_icon || '🏆',
    category: row.category,
    gender: row.gender,
    format: row.format,
    description: row.description || '',
    maxParticipants: row.max_participants ?? null,
    thirdPlace: !!row.third_place,
    allowDraw: !!row.allow_draw,
    scoreLabel: row.score_label || 'คะแนน',
    pointsWin: row.points_win ?? 3,
    pointsDraw: row.points_draw ?? 1,
    pointsLoss: row.points_loss ?? 0,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapParticipant(row) {
  return row && {
    id: row.id,
    tournamentId: row.tournament_id,
    userId: row.user_id || null,
    name: row.name,
    members: Array.isArray(row.members) ? row.members : null,
    seed: row.seed ?? null,
    createdAt: row.created_at,
  };
}

export function mapMatch(row) {
  return row && {
    id: row.id,
    tournamentId: row.tournament_id,
    round: row.round,
    matchNo: row.match_no,
    roundLabel: row.round_label,
    bracketSide: row.bracket_side ?? 1,
    slotA: row.slot_a || null,
    slotB: row.slot_b || null,
    scoreA: row.score_a ?? null,
    scoreB: row.score_b ?? null,
    winnerId: row.winner_id || null,
    nextMatchId: row.next_match_id || null,
    nextSlot: row.next_slot ?? null,
    loserNextMatchId: row.loser_next_match_id || null,
    loserNextSlot: row.loser_next_slot ?? null,
    scheduledAt: row.scheduled_at || null,
    completedAt: row.completed_at || null,
    status: row.status,
  };
}

function matchRow(match, tournamentId) {
  return {
    id: match.id,
    tournament_id: tournamentId,
    round: match.round,
    match_no: match.matchNo,
    round_label: match.roundLabel,
    bracket_side: match.bracketSide ?? 1,
    slot_a: match.slotA,
    slot_b: match.slotB,
    score_a: match.scoreA,
    score_b: match.scoreB,
    winner_id: match.winnerId,
    next_match_id: match.nextMatchId,
    next_slot: match.nextSlot,
    loser_next_match_id: match.loserNextMatchId,
    loser_next_slot: match.loserNextSlot,
    status: match.status,
    scheduled_at: match.scheduledAt,
    completed_at: match.completedAt,
  };
}

function scorePatch(patch) {
  const row = {};
  if ('slotA' in patch) row.slot_a = patch.slotA;
  if ('slotB' in patch) row.slot_b = patch.slotB;
  if ('scoreA' in patch) row.score_a = patch.scoreA;
  if ('scoreB' in patch) row.score_b = patch.scoreB;
  if ('winnerId' in patch) row.winner_id = patch.winnerId;
  if ('status' in patch) row.status = patch.status;
  if ('completedAt' in patch) row.completed_at = patch.completedAt;
  return row;
}

// ── Scheduling (#8) ──
export async function setMatchSchedule(matchId, isoDateTime) {
  const api = await playerSession();
  const { error } = await api.from('weston_matches')
    .update({ scheduled_at: isoDateTime || null }).eq('id', matchId);
  if (error) throw error;
}

// Matches of tournaments the player is in, ordered by schedule (#8 notifications).
export async function myUpcomingMatches(userId) {
  const api = await playerSession();
  const mine = await api.from('weston_participants').select('tournament_id').eq('user_id', userId);
  if (mine.error) throw mine.error;
  const ids = [...new Set((mine.data || []).map(row => row.tournament_id))];
  if (!ids.length) return { rows: [] };
  const matches = await api.from('weston_matches')
    .select('id,tournament_id,round_label,scheduled_at,status,slot_a,slot_b')
    .in('tournament_id', ids.slice(0, 20))
    .not('scheduled_at', 'is', null)
    .eq('status', 'ready')
    .order('scheduled_at', { ascending: true }).limit(20);
  if (matches.error) throw matches.error;
  return { rows: matches.data };
}

// ── Cheers (#11) ──
export async function addCheer(tournamentId, emoji) {
  const api = await playerSession();
  const { error } = await api.from('weston_cheers')
    .insert({ id: uuid(), tournament_id: tournamentId, user_id: api.userId, emoji });
  if (error) throw error;
}

export async function countCheers(tournamentId) {
  const api = await playerSession();
  const { data, error } = await api.from('weston_cheers')
    .select('emoji').eq('tournament_id', tournamentId).limit(5000);
  if (error) throw error;
  const counts = new Map();
  for (const row of data) counts.set(row.emoji, (counts.get(row.emoji) || 0) + 1);
  return counts;
}

export async function listTournaments() {
  const api = await playerSession();
  const [tournaments, participants, adminRows, myRows] = await Promise.all([
    api.from('weston_tournaments')
      .select('id,title,sport,sport_icon,category,gender,format,status,max_participants,created_at')
      .order('created_at', { ascending: false }).limit(50),
    api.from('weston_participants').select('tournament_id,user_id').limit(2000),
    api.from('weston_tournament_admins').select('tournament_id').eq('user_id', api.userId),
    api.from('weston_participants').select('tournament_id').eq('user_id', api.userId),
  ]);
  if (tournaments.error) throw tournaments.error;
  if (participants.error) throw participants.error;
  if (adminRows.error) throw adminRows.error;
  if (myRows.error) throw myRows.error;
  const counts = new Map();
  for (const row of participants.data || []) counts.set(row.tournament_id, (counts.get(row.tournament_id) || 0) + 1);
  const adminOf = new Set((adminRows.data || []).map(row => row.tournament_id));
  const joined = new Set((myRows.data || []).map(row => row.tournament_id));
  return {
    tournaments: (tournaments.data || []).map(row => {
      const mapped = mapTournament(row);
      mapped.participantCount = counts.get(row.id) || 0;
      return mapped;
    }),
    adminOf,
    joinedOf: joined,
    userId: api.userId,
  };
}

export async function getTournamentDetail(tournamentId) {
  const api = await playerSession();
  const [tournament, participants, matches, myAdmin] = await Promise.all([
    api.from('weston_tournaments').select('*').eq('id', tournamentId).maybeSingle(),
    api.from('weston_participants').select('*').eq('tournament_id', tournamentId).order('created_at'),
    api.from('weston_matches').select('*').eq('tournament_id', tournamentId).order('round').order('match_no'),
    api.from('weston_tournament_admins').select('user_id')
      .eq('tournament_id', tournamentId).eq('user_id', api.userId).maybeSingle(),
  ]);
  if (tournament.error) throw tournament.error;
  if (!tournament.data) throw new Error('ไม่พบทัวร์นาเมนต์นี้');
  if (participants.error) throw participants.error;
  if (matches.error) throw matches.error;
  if (myAdmin.error) throw myAdmin.error;
  return {
    tournament: mapTournament(tournament.data),
    participants: (participants.data || []).map(mapParticipant),
    matches: (matches.data || []).map(mapMatch),
    isAdmin: Boolean(myAdmin.data),
    userId: api.userId,
  };
}

// Returns the new tournament id; the caller must show the admin code once.
export async function createTournament(payload, adminCode) {
  const api = await playerSession();
  const { data, error } = await api.rpc('create_tournament', { payload, admin_code: adminCode });
  if (error) throw error;
  return data;
}

export async function claimTournamentAdmin(tournamentId, adminCode) {
  const api = await playerSession();
  const { data, error } = await api.rpc('claim_tournament_admin', { tid: tournamentId, admin_code: adminCode });
  if (error) throw error;
  return data === true;
}

export async function joinTournament(tournamentId, { name, members }) {
  const api = await playerSession();
  const row = {
    id: uuid(),
    tournament_id: tournamentId,
    user_id: api.userId,
    name,
    members: members?.length ? members : null,
  };
  const { error } = await api.from('weston_participants').insert(row);
  if (error) throw error;
  return row.id;
}

export async function addWalkInParticipant(tournamentId, { name, members }) {
  const api = await playerSession();
  const row = { id: uuid(), tournament_id: tournamentId, name, members: members?.length ? members : null };
  const { error } = await api.from('weston_participants').insert(row);
  if (error) throw error;
  return row.id;
}

export async function removeParticipant(participantId) {
  const api = await playerSession();
  const { error } = await api.from('weston_participants').delete().eq('id', participantId);
  if (error) throw error;
}

export async function setTournamentStatus(tournamentId, status) {
  const api = await playerSession();
  const { error } = await api.from('weston_tournaments').update({ status }).eq('id', tournamentId);
  if (error) throw error;
}

// Rebuilds the whole bracket/schedule from current participants. Sides are
// inserted highest-first and later rounds before earlier ones so next_match_id
// and loser_next_match_id foreign keys always point at existing rows.
export async function startTournament(tournament, participants, { shuffle = true } = {}) {
  const api = await playerSession();
  const ordered = shuffle ? shuffleEntries(participants) : participants;
  let built;
  if (tournament.format === 'double_elim') {
    built = buildDoubleElimBracket(ordered);
  } else if (tournament.format === 'single_elim') {
    built = buildSingleElimBracket(ordered, { thirdPlace: tournament.thirdPlace });
  } else {
    built = { matches: buildRoundRobinMatches(ordered) };
  }
  const removal = await api.from('weston_matches').delete().eq('tournament_id', tournament.id);
  if (removal.error) throw removal.error;
  const rows = built.matches.map(match => matchRow(match, tournament.id))
    .sort((a, b) => (b.bracket_side - a.bracket_side) || (b.round - a.round));
  const insertion = await api.from('weston_matches').insert(rows);
  if (insertion.error) throw insertion.error;
  // Seeds go through per-row UPDATEs: a sparse upsert ({id, seed}) lacks
  // tournament_id/user_id, so the insert WITH CHECK policy would reject it.
  for (let index = 0; index < ordered.length; index++) {
    const { error } = await api.from('weston_participants')
      .update({ seed: index + 1 }).eq('id', ordered[index].id);
    if (error) throw error;
  }
  const statusChange = await api.from('weston_tournaments').update({ status: 'ongoing' }).eq('id', tournament.id);
  if (statusChange.error) throw statusChange.error;
  return rows.length;
}

export async function resetBracket(tournamentId) {
  const api = await playerSession();
  const removal = await api.from('weston_matches').delete().eq('tournament_id', tournamentId);
  if (removal.error) throw removal.error;
  const statusChange = await api.from('weston_tournaments').update({ status: 'registering' }).eq('id', tournamentId);
  if (statusChange.error) throw statusChange.error;
}

// Records a score using the pure bracket logic and persists every affected row
// (the scored match plus bracket advancement). Marks the tournament completed
// when nothing is left to play.
export async function saveMatchScore(tournament, matches, matchId, scoreA, scoreB) {
  const api = await playerSession();
  const { updates, finished } = applyScore(tournament, matches, matchId, scoreA, scoreB);
  for (const { id, patch } of updates) {
    const { error } = await api.from('weston_matches').update(scorePatch(patch)).eq('id', id);
    if (error) throw error;
  }
  if (finished && tournament.status !== 'completed') {
    const { error } = await api.from('weston_tournaments').update({ status: 'completed' }).eq('id', tournament.id);
    if (error) throw error;
    tournament.status = 'completed';
  }
  return { finished };
}

// Live refresh while a tournament dialog is open.
export async function subscribeTournament(tournamentId, onChange) {
  const api = await playerSession();
  const channel = api.channel(`weston-tournament-${tournamentId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'weston_matches', filter: `tournament_id=eq.${tournamentId}` }, onChange)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'weston_participants', filter: `tournament_id=eq.${tournamentId}` }, onChange)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'weston_tournaments', filter: `id=eq.${tournamentId}` }, onChange)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'weston_cheers', filter: `tournament_id=eq.${tournamentId}` }, onChange)
    .subscribe();
  return () => { void api.removeChannel(channel); };
}
