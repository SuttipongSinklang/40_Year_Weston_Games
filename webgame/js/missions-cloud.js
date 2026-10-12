// Mission data access shared by the player home card and the admin site.
// Admin writes rely on RLS weston_private.is_site_admin; completions are
// stamped server-side so the reward always matches the configured value.
import { playerSession } from './data.js';

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function friendlyMissionError(error) {
  const message = `${error?.message || error || ''}`;
  if (!navigator.onLine || /fetch|network|timeout/i.test(message)) {
    return 'ออฟไลน์อยู่ ภารกิจจะโหลดเมื่อกลับมาออนไลน์';
  }
  if (/duplicate key/i.test(message) || error?.code === '23505') return 'คุณทำภารกิจนี้สำเร็จไปแล้ว';
  if (/not active/i.test(message)) return 'ภารกิจนี้ถูกปิดไปแล้ว';
  if (/PGRST|does not exist|schema cache|permission denied|row-level security/i.test(message) || error?.code === '42501') {
    return 'ต้องติดตั้งตารางภารกิจก่อน (รัน supabase/missions-admin.sql ใน SQL Editor แล้วลองใหม่)';
  }
  return `เชื่อมต่อไม่สำเร็จ ลองอีกครั้ง (${message})`;
}

function mapMission(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    icon: row.icon || '🎯',
    rewardPoints: row.reward_points ?? 0,
    status: row.status,
    sortIndex: row.sort_index ?? 0,
    verifyType: row.verify_type || 'self',
    targetValue: row.target_value ?? null,
    resetDaily: !!row.reset_daily,
    createdAt: row.created_at,
  };
}

// ── Player side ──────────────────────────────────────────────

export async function listActiveMissions() {
  const api = await playerSession();
  const { data, error } = await api.from('weston_missions')
    .select('id,title,description,icon,reward_points,status,sort_index,verify_type,target_value,reset_daily,created_at')
    .eq('status', 'active')
    .order('sort_index').order('created_at').limit(100);
  if (error) throw error;
  return data.map(mapMission);
}

export async function listMyCompletions() {
  const api = await playerSession();
  const { data, error } = await api.from('weston_mission_completions')
    .select('mission_id,points_awarded,completed_at,day')
    .eq('user_id', api.userId).limit(500);
  if (error) throw error;
  return data.map(row => ({
    missionId: row.mission_id,
    pointsAwarded: row.points_awarded,
    completedAt: row.completed_at,
    day: row.day,
  }));
}

// Server-verified completion for run missions (distance/count from weston_runs).
export async function completeRunMission(missionId) {
  const api = await playerSession();
  const { data, error } = await api.rpc('complete_run_mission', { mission_id: missionId });
  if (error) throw error;
  return data === true;
}

// Records the completion; the trigger snapshots the configured reward and the
// response carries the real points_awarded.
export async function completeMission(missionId) {
  const api = await playerSession();
  const { data, error } = await api.from('weston_mission_completions')
    .insert({ mission_id: missionId, user_id: api.userId, points_awarded: 0 })
    .select('mission_id,points_awarded').single();
  if (error) throw error;
  return { missionId: data.mission_id, pointsAwarded: data.points_awarded };
}

// ── Admin side (admin site only; RLS requires site admin) ─────

export async function claimSiteAdmin(code) {
  const api = await playerSession();
  const { data, error } = await api.rpc('claim_site_admin', { code });
  if (error) throw error;
  return data === true;
}

export async function setSiteAdminCode(oldCode, newCode) {
  const api = await playerSession();
  const { data, error } = await api.rpc('set_site_admin_code', { old_code: oldCode, new_code: newCode });
  if (error) throw error;
  return data === true;
}

export async function listAllMissions() {
  const api = await playerSession();
  const { data, error } = await api.from('weston_missions')
    .select('*').order('sort_index').order('created_at').limit(200);
  if (error) throw error;
  return data.map(mapMission);
}

// Completion counts per mission (site admins see all rows via RLS).
export async function missionCompletionStats() {
  const api = await playerSession();
  const { data, error } = await api.from('weston_mission_completions')
    .select('mission_id').limit(10000);
  if (error) throw error;
  const counts = new Map();
  for (const row of data) counts.set(row.mission_id, (counts.get(row.mission_id) || 0) + 1);
  return counts;
}

export async function saveMission(mission) {
  const api = await playerSession();
  const row = {
    id: mission.id || uuid(),
    title: mission.title,
    description: mission.description || null,
    icon: mission.icon || '🎯',
    reward_points: mission.rewardPoints,
    status: mission.status || 'active',
    sort_index: mission.sortIndex || 0,
    verify_type: mission.verifyType || 'self',
    target_value: mission.verifyType === 'self' ? null : (mission.targetValue || 1),
    reset_daily: !!mission.resetDaily,
  };
  const { error } = await api.from('weston_missions').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return row.id;
}

export async function deleteMission(missionId) {
  const api = await playerSession();
  const { error } = await api.from('weston_missions').delete().eq('id', missionId);
  if (error) throw error;
}
