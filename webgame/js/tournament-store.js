// Local storage for tournament admin codes and joined shortcuts.
// Codes live only on devices that created or claimed them; the server keeps hashes.

const STORAGE_KEY = 'weston-tournament-v1';

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object'
      && typeof parsed.adminCodes === 'object' && parsed.adminCodes !== null
      && Array.isArray(parsed.joined)) return parsed;
  } catch { /* corrupted or unavailable storage starts fresh */ }
  return { adminCodes: {}, joined: [] };
}

function write(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export function saveAdminCode(tournamentId, code) {
  if (!tournamentId || !/^\d{6}$/.test(String(code || ''))) return;
  const state = read();
  state.adminCodes[tournamentId] = String(code);
  write(state);
}

export function getAdminCode(tournamentId) {
  return read().adminCodes[tournamentId] || null;
}

export function rememberJoined(tournamentId) {
  const state = read();
  if (!state.joined.includes(tournamentId)) {
    state.joined.push(tournamentId);
    write(state);
  }
}

export function isJoined(tournamentId) {
  return read().joined.includes(tournamentId);
}
