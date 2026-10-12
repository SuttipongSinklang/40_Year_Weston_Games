// Pure tournament logic — no DOM, no Supabase. Covered by tests/tournament-bracket.test.mjs.
// Match objects use the camelCase shape that tournament-cloud.js maps to snake_case rows.

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // LAN http://192.168.x.x does not expose randomUUID on some mobile browsers.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function nextPowerOfTwo(n) {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// Seed numbers in slot order for a bracket of `size`, e.g. size 8 → [1,8,4,5,2,7,3,6]
// so seed 1 meets seed 8, seed 4 meets seed 5, and the strongest seeds cannot meet before the final.
export function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next = [];
    for (const seed of order) next.push(seed, sum - seed);
    order = next;
  }
  return order;
}

function roundLabel(playerCount) {
  if (playerCount === 2) return 'ชิงชนะเลิศ';
  if (playerCount === 4) return 'รอบรองชนะเลิศ';
  return `รอบ ${playerCount}`;
}

function blankMatch(bracketSide, round, matchNo, label) {
  return {
    id: newId(),
    bracketSide,
    round,
    matchNo,
    roundLabel: label,
    slotA: null,
    slotB: null,
    scoreA: null,
    scoreB: null,
    winnerId: null,
    nextMatchId: null,
    nextSlot: null,
    loserNextMatchId: null,
    loserNextSlot: null,
    scheduledAt: null,
    completedAt: null,
    status: 'pending',
  };
}

const side = match => match.bracketSide ?? 1;

// Total rounds of a winners bracket derived from persisted rows.
export function singleElimRounds(matches) {
  const firstRoundCount = matches.filter(m => m.round === 1 && side(m) === 1).length;
  if (firstRoundCount === 0) return 0;
  return Math.round(Math.log2(firstRoundCount)) + 1;
}

// The third-place play-off is stored one round after the final (round = rounds + 1).
export function findThirdPlaceMatch(matches) {
  const rounds = singleElimRounds(matches);
  if (!rounds) return null;
  return matches.find(m => m.round === rounds + 1 && side(m) === 1) || null;
}

export function findNextMatch(matches, match) {
  return match.nextMatchId ? matches.find(m => m.id === match.nextMatchId) || null : null;
}

function fillSlot(next, slotNo, participantId) {
  if (slotNo === 1) next.slotA = participantId;
  else if (slotNo === 2) next.slotB = participantId;
  if (next.slotA && next.slotB && next.status !== 'completed') next.status = 'ready';
}

function propagateWinner(matches, match) {
  const next = findNextMatch(matches, match);
  if (!next) return null;
  fillSlot(next, match.nextSlot, match.winnerId);
  return next;
}

function propagateLoser(matches, match, loserId) {
  if (!match.loserNextMatchId || !loserId) return null;
  const next = matches.find(m => m.id === match.loserNextMatchId) || null;
  if (!next) return null;
  fillSlot(next, match.loserNextSlot, loserId);
  return next;
}

// entries: participants in seed order, index 0 = seed 1.
export function buildSingleElimBracket(entries, { thirdPlace = false } = {}) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error('ต้องมีผู้เข้าแข่งอย่างน้อย 2 รายจึงจัดสายได้');
  }
  const size = nextPowerOfTwo(entries.length);
  const slots = seedOrder(size).map(seed => (seed <= entries.length ? entries[seed - 1].id : null));
  const rounds = Math.log2(size);
  const matches = [];
  const byRound = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const roundMatches = [];
    for (let m = 1; m <= count; m++) {
      const match = blankMatch(1, r, m, roundLabel(count * 2));
      roundMatches.push(match);
      matches.push(match);
    }
    byRound.push(roundMatches);
  }
  for (let r = 0; r < rounds; r++) {
    byRound[r].forEach((match, m) => {
      if (r + 1 < rounds) {
        const next = byRound[r + 1][Math.floor(m / 2)];
        match.nextMatchId = next.id;
        match.nextSlot = m % 2 === 0 ? 1 : 2;
      }
      if (r === 0) {
        match.slotA = slots[m * 2] || null;
        match.slotB = slots[m * 2 + 1] || null;
      }
    });
  }
  // One-sided first-round pairs are BYEs: the present entry advances automatically.
  for (const match of byRound[0]) {
    if (match.slotA && !match.slotB) {
      match.winnerId = match.slotA;
      match.status = 'bye';
      propagateWinner(matches, match);
    } else if (!match.slotA && match.slotB) {
      match.winnerId = match.slotB;
      match.status = 'bye';
      propagateWinner(matches, match);
    } else if (match.slotA && match.slotB) {
      match.status = 'ready';
    }
  }
  for (const match of matches) {
    if (match.status === 'pending' && match.slotA && match.slotB) match.status = 'ready';
  }
  if (thirdPlace) {
    matches.push(blankMatch(1, rounds + 1, 1, 'ชิงอันดับ 3'));
  }
  return { matches, size, rounds };
}

// Double elimination: a winners bracket (side 1), a losers bracket (side 2) and
// one grand final (side 3). Losers of winners-bracket matches drop into fixed
// losers-bracket slots: odd LB rounds pair LB survivors, even LB rounds ("major")
// merge LB survivors with fresh winners-bracket losers of WB round r/2+1. The
// last major round is the LB final fed by the WB final loser; its winner meets
// the WB winner in the grand final (single final, no bracket reset).
export function buildDoubleElimBracket(entries) {
  if (nextPowerOfTwo(entries.length) !== entries.length) {
    throw new Error(`สายแพ้คัดออกคู่ต้องมีจำนวนผู้เข้าแข่งเป็นกำลังสอง (4, 8, 16, 32 …) ปัจจุบันมี ${entries.length} ราย`);
  }
  const { matches: wb, size, rounds: wbRounds } = buildSingleElimBracket(entries, { thirdPlace: false });
  for (const match of wb) match.roundLabel = `สายผู้ชนะ ${match.roundLabel}`;
  const lbRounds = 2 * wbRounds - 2;
  const lb = [];
  const lbByRound = [];
  const wbByRound = [];
  for (let r = 1; r <= wbRounds; r++) wbByRound.push(wb.filter(m => m.round === r));
  for (let r = 1; r <= lbRounds; r++) {
    const isMajor = r % 2 === 0;
    let count;
    if (r === 1) count = wbByRound[0].length / 2;                       // WB R1 losers paired up
    else if (isMajor) count = lbByRound[r - 2].length;                  // LB winners merged with WB losers
    else count = lbByRound[r - 2].length / 2;                           // LB survivors paired up
    const roundMatches = [];
    for (let m = 1; m <= count; m++) {
      const match = blankMatch(2, r, m, `สายผู้แพ้ รอบ ${r}`);
      roundMatches.push(match);
      lb.push(match);
    }
    lbByRound.push(roundMatches);
  }
  // Wire LB round 1 from WB round 1 losers.
  wbByRound[0].forEach((match, i) => {
    const target = lbByRound[0][Math.floor(i / 2)];
    match.loserNextMatchId = target.id;
    match.loserNextSlot = i % 2 === 0 ? 1 : 2;
  });
  // Wire the remaining LB rounds.
  for (let r = 2; r <= lbRounds; r++) {
    const isMajor = r % 2 === 0;
    lbByRound[r - 1].forEach((match, i) => {
      const prev = lbByRound[r - 2];
      if (isMajor) {
        match.loserNextMatchId = null;
        const feeder = prev[i];
        feeder.nextMatchId = match.id;
        feeder.nextSlot = 1;
        const wbRound = r / 2 + 1;
        const wbFeeder = wbByRound[wbRound - 1][i];
        if (wbFeeder) {
          wbFeeder.loserNextMatchId = match.id;
          wbFeeder.loserNextSlot = 2;
        }
      } else {
        for (const offset of [0, 1]) {
          const feeder = prev[i * 2 + offset];
          if (!feeder) continue;
          feeder.nextMatchId = match.id;
          feeder.nextSlot = offset === 0 ? 1 : 2;
        }
      }
    });
  }
  // Grand final: WB final winner vs LB final winner.
  const grandFinal = blankMatch(3, 1, 1, 'ชิงชนะเลิศ');
  const wbFinal = wbByRound[wbRounds - 1][0];
  wbFinal.nextMatchId = grandFinal.id;
  wbFinal.nextSlot = 1;
  const lbFinal = lbByRound[lbRounds - 1][0];
  lbFinal.nextMatchId = grandFinal.id;
  lbFinal.nextSlot = 2;
  const matches = [...wb, ...lb, grandFinal];
  return { matches, size, rounds: wbRounds, lbRounds };
}

// Circle method: every pair meets once, odd counts rotate a BYE.
export function buildRoundRobinSchedule(entries) {
  if (!Array.isArray(entries) || entries.length < 3) {
    throw new Error('ลีกพบกันหมดต้องมีผู้เข้าแข่งอย่างน้อย 3 ราย');
  }
  const BYE = '__weston-bye__';
  const ids = entries.map(e => e.id);
  const arr = ids.length % 2 === 1 ? [...ids, BYE] : [...ids];
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home !== BYE && away !== BYE) pairs.push([home, away]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

export function buildRoundRobinMatches(entries) {
  const rounds = buildRoundRobinSchedule(entries);
  const matches = [];
  rounds.forEach((pairs, index) => {
    pairs.forEach(([home, away], i) => {
      const match = blankMatch(1, index + 1, i + 1, `สัปดาห์ ${index + 1}`);
      match.slotA = home;
      match.slotB = away;
      match.status = 'ready';
      matches.push(match);
    });
  });
  return matches;
}

export function normalizeScore(scoreA, scoreB) {
  const a = Number(scoreA);
  const b = Number(scoreB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 9999 || b > 9999) {
    throw new Error('คะแนนต้องเป็นตัวเลข 0–9999');
  }
  return { a, b };
}

function decideOutcome(match, a, b, tournament) {
  if (a === b) {
    if (tournament.format === 'round_robin' && tournament.allowDraw) return { winner: null, loser: null };
    throw new Error('ผลออกมาเสมอ ฟอร์แมตนี้ต้องตัดสินผู้ชนะ (เช่น นับแต้มต่อหรือต่อเวลา)');
  }
  return a > b
    ? { winner: match.slotA, loser: match.slotB }
    : { winner: match.slotB, loser: match.slotA };
}

function semifinalRoundOf(matches) {
  return Math.max(singleElimRounds(matches) - 1, 0);
}

// Records a score and returns the rows to persist: the scored match plus any
// bracket advancement (winner next slot, loser into the losers bracket or the
// third-place play-off). Mutates `matches` in place so callers can re-render.
export function applyScore(tournament, matches, matchId, scoreA, scoreB) {
  const match = matches.find(m => m.id === matchId);
  if (!match) throw new Error('ไม่พบแมตช์นี้');
  if (match.status === 'bye') throw new Error('แมตช์ BYE ผ่านเข้ารอบอัตโนมัติ ไม่ต้องกรอกผล');
  if (!match.slotA || !match.slotB) throw new Error('คู่แข่งในแมตช์นี้ยังไม่ครบ');
  const { a, b } = normalizeScore(scoreA, scoreB);
  const next = findNextMatch(matches, match);
  const loserNext = match.loserNextMatchId ? matches.find(m => m.id === match.loserNextMatchId) || null : null;
  const third = findThirdPlaceMatch(matches);
  const semiRound = semifinalRoundOf(matches);
  const feedsThird = Boolean(third) && tournament.format === 'single_elim' && match.round === semiRound;
  if (match.status === 'completed' || match.scoreA !== null) {
    if (next?.status === 'completed') throw new Error('รอบถัดไปบันทึกผลแล้ว ต้องล้างผลรอบถัดไปก่อนแก้ไข');
    if (loserNext?.status === 'completed') throw new Error('สายผู้แพ้บันทึกผลแล้ว ต้องล้างผลนั้นก่อนแก้ไข');
    if (third && feedsThird && third.status === 'completed') throw new Error('ชิงอันดับ 3 บันทึกผลแล้ว ต้องล้างผลนั้นก่อนแก้ไข');
  }
  const { winner, loser } = decideOutcome(match, a, b, tournament);
  const updates = [];
  const completedAt = new Date().toISOString();
  Object.assign(match, { scoreA: a, scoreB: b, winnerId: winner, status: 'completed', completedAt });
  updates.push({ id: match.id, patch: { scoreA: a, scoreB: b, winnerId: winner, status: 'completed', completedAt } });
  if (tournament.format === 'single_elim' || tournament.format === 'double_elim') {
    if (next) {
      propagateWinner(matches, match);
      updates.push({ id: next.id, patch: { slotA: next.slotA, slotB: next.slotB, status: next.status } });
    }
    if (loserNext && loser) {
      propagateLoser(matches, match, loser);
      updates.push({ id: loserNext.id, patch: { slotA: loserNext.slotA, slotB: loserNext.slotB, status: loserNext.status } });
    }
    if (feedsThird && loser) {
      if (match.matchNo === 1) third.slotA = loser;
      else third.slotB = loser;
      if (third.slotA && third.slotB && third.status !== 'completed') third.status = 'ready';
      updates.push({ id: third.id, patch: { slotA: third.slotA, slotB: third.slotB, status: third.status } });
    }
  }
  const finished = matches.every(m => m.status === 'completed' || m.status === 'bye');
  return { updates, finished };
}

export function isTournamentFinished(tournament, matches) {
  return matches.length > 0 && matches.every(m => m.status === 'completed' || m.status === 'bye');
}

// League table from completed matches. Ties break by head-to-head points,
// then score difference, then scored, then name.
export function computeStandings(participants, matches, tournament) {
  const { pointsWin = 3, pointsDraw = 1, pointsLoss = 0 } = tournament || {};
  const rows = new Map();
  for (const p of participants) {
    rows.set(p.id, {
      participantId: p.id, name: p.name,
      played: 0, win: 0, draw: 0, loss: 0,
      scored: 0, conceded: 0, diff: 0, points: 0,
    });
  }
  const pairResults = new Map();
  for (const m of matches) {
    if (m.status !== 'completed') continue;
    const a = rows.get(m.slotA);
    const b = rows.get(m.slotB);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.scored += m.scoreA; a.conceded += m.scoreB;
    b.scored += m.scoreB; b.conceded += m.scoreA;
    const key = m.slotA < m.slotB ? `${m.slotA}|${m.slotB}` : `${m.slotB}|${m.slotA}`;
    if (!pairResults.has(key)) pairResults.set(key, new Map([[m.slotA, 0], [m.slotB, 0]]));
    const h2h = pairResults.get(key);
    if (m.winnerId === m.slotA) { a.win++; b.loss++; a.points += pointsWin; b.points += pointsLoss; h2h.set(m.slotA, h2h.get(m.slotA) + 3); }
    else if (m.winnerId === m.slotB) { b.win++; a.loss++; b.points += pointsWin; a.points += pointsLoss; h2h.set(m.slotB, h2h.get(m.slotB) + 3); }
    else { a.draw++; b.draw++; a.points += pointsDraw; b.points += pointsDraw; h2h.set(m.slotA, h2h.get(m.slotA) + 1); h2h.set(m.slotB, h2h.get(m.slotB) + 1); }
  }
  const list = [...rows.values()];
  for (const row of list) row.diff = row.scored - row.conceded;
  const h2hPoints = (row, group) => {
    let points = 0;
    for (const other of group) {
      if (other === row) continue;
      const key = row.participantId < other.participantId ? `${row.participantId}|${other.participantId}` : `${other.participantId}|${row.participantId}`;
      const table = pairResults.get(key);
      if (table) points += table.get(row.participantId) || 0;
    }
    return points;
  };
  // Sort within equal-points groups so head-to-head only compares actual rivals.
  const sorted = [];
  const byPoints = new Map();
  for (const row of list) {
    if (!byPoints.has(row.points)) byPoints.set(row.points, []);
    byPoints.get(row.points).push(row);
  }
  for (const points of [...byPoints.keys()].sort((x, y) => y - x)) {
    const group = byPoints.get(points);
    group.sort((x, y) =>
      h2hPoints(y, group) - h2hPoints(x, group) ||
      y.diff - x.diff ||
      y.scored - x.scored ||
      x.name.localeCompare(y.name, 'th'));
    sorted.push(...group);
  }
  return sorted.map((row, index) => ({ rank: index + 1, ...row }));
}

// Winner of the grand final (double elim) or the final (single elimination only).
export function championOf(matches) {
  const grandFinal = matches.find(m => side(m) === 3);
  if (grandFinal) return grandFinal.status === 'completed' ? grandFinal.winnerId : null;
  const rounds = singleElimRounds(matches);
  const finalMatch = rounds ? matches.find(m => m.round === rounds && side(m) === 1) : null;
  return finalMatch?.status === 'completed' ? finalMatch.winnerId : null;
}

// Groups matches into display sections: winners bracket rounds, losers bracket
// rounds, then the grand final. Single-format tournaments return one section.
export function groupMatchSections(matches) {
  const sectionFor = value => ({ 1: { title: 'สายการแข่งขัน', rounds: [] }, 2: { title: 'สายผู้แพ้', rounds: [] }, 3: { title: 'ชิงชนะเลิศ', rounds: [] } }[value]);
  const sections = [sectionFor(1), sectionFor(2), sectionFor(3)];
  const byKey = new Map();
  for (const match of matches) {
    const key = `${side(match)}-${match.round}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(match);
  }
  for (const [key, list] of byKey) {
    const [s] = key.split('-');
    list.sort((x, y) => x.matchNo - y.matchNo);
    sections[Number(s) - 1].rounds.push({ label: list[0].roundLabel, matches: list });
  }
  return sections.filter(section => section.rounds.length);
}

export function shuffleEntries(entries) {
  const copy = [...entries];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
