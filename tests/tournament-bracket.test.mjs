import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextPowerOfTwo,
  seedOrder,
  buildSingleElimBracket,
  buildDoubleElimBracket,
  buildRoundRobinSchedule,
  buildRoundRobinMatches,
  applyScore,
  isTournamentFinished,
  computeStandings,
  championOf,
  normalizeScore,
  singleElimRounds,
  findThirdPlaceMatch,
  groupMatchSections,
} from '../webgame/js/tournament-bracket.js';

const entry = (n) => ({ id: `p${n}`, name: `ทีม ${n}` });
const entries = (n) => Array.from({ length: n }, (_, i) => entry(i + 1));
const find = (matches, round, matchNo) => matches.find(m => m.round === round && m.matchNo === matchNo);

test('nextPowerOfTwo rounds up to a playable bracket', () => {
  assert.equal(nextPowerOfTwo(2), 2);
  assert.equal(nextPowerOfTwo(5), 8);
  assert.equal(nextPowerOfTwo(8), 8);
  assert.equal(nextPowerOfTwo(13), 16);
});

test('seedOrder keeps strong seeds apart until the final', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(seedOrder(16), [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
});

test('single elim: 8 entries build a 3-round bracket with wired advancement', () => {
  const { matches, size } = buildSingleElimBracket(entries(8));
  assert.equal(size, 8);
  assert.equal(matches.length, 7);
  assert.equal(singleElimRounds(matches), 3);
  assert.deepEqual(matches.filter(m => m.round === 1).map(m => m.roundLabel), ['รอบ 8', 'รอบ 8', 'รอบ 8', 'รอบ 8']);
  assert.equal(find(matches, 2, 1).roundLabel, 'รอบรองชนะเลิศ');
  assert.equal(find(matches, 3, 1).roundLabel, 'ชิงชนะเลิศ');
  // Round 1 slots follow seed order [1,8,4,5,2,7,3,6].
  assert.equal(find(matches, 1, 1).slotA, 'p1');
  assert.equal(find(matches, 1, 1).slotB, 'p8');
  assert.equal(find(matches, 1, 2).slotA, 'p4');
  assert.equal(find(matches, 1, 2).slotB, 'p5');
  // Winners of round-1 matches 1 and 2 feed round-2 match 1 slots A and B.
  assert.equal(find(matches, 1, 1).nextMatchId, find(matches, 2, 1).id);
  assert.equal(find(matches, 1, 1).nextSlot, 1);
  assert.equal(find(matches, 1, 2).nextSlot, 2);
  assert.equal(find(matches, 1, 3).nextMatchId, find(matches, 2, 2).id);
  assert.equal(find(matches, 2, 1).nextMatchId, find(matches, 3, 1).id);
  assert.ok(matches.filter(m => m.round === 1).every(m => m.status === 'ready'));
  assert.equal(findThirdPlaceMatch(matches), null);
});

test('single elim: 5 entries produce 3 BYEs and auto-advancement', () => {
  const { matches } = buildSingleElimBracket(entries(5));
  const m1 = find(matches, 1, 1);
  assert.equal(m1.slotA, 'p1');
  assert.equal(m1.slotB, null);
  assert.equal(m1.status, 'bye');
  assert.equal(m1.winnerId, 'p1');
  // p1 already advanced into round 2 slot A.
  assert.equal(find(matches, 2, 1).slotA, 'p1');
  assert.equal(find(matches, 1, 2).slotB, 'p5');
  assert.equal(find(matches, 1, 2).status, 'ready');
  assert.equal(find(matches, 2, 1).status, 'pending');
});

test('single elim: fewer than 2 entries is rejected', () => {
  assert.throws(() => buildSingleElimBracket(entries(1)), /อย่างน้อย 2/);
});

test('single elim: scoring walks the winner through to the champion', () => {
  const tournament = { format: 'single_elim', thirdPlace: false };
  const { matches } = buildSingleElimBracket(entries(4));
  applyScore(tournament, matches, find(matches, 1, 1).id, 11, 7);
  assert.equal(find(matches, 2, 1).slotA, 'p1');
  assert.equal(find(matches, 2, 1).status, 'pending');
  applyScore(tournament, matches, find(matches, 1, 2).id, 3, 9);
  assert.equal(find(matches, 2, 1).slotB, 'p3');
  assert.equal(find(matches, 2, 1).status, 'ready');
  assert.equal(isTournamentFinished(tournament, matches), false);
  const { finished } = applyScore(tournament, matches, find(matches, 2, 1).id, 6, 5);
  assert.equal(finished, true);
  assert.equal(championOf(matches), 'p1');
});

test('single elim: a draw is rejected', () => {
  const tournament = { format: 'single_elim' };
  const { matches } = buildSingleElimBracket(entries(4));
  assert.throws(() => applyScore(tournament, matches, find(matches, 1, 1).id, 5, 5), /ตัดสินผู้ชนะ/);
});

test('single elim: cannot rewrite history once the next round is scored', () => {
  const tournament = { format: 'single_elim' };
  const { matches } = buildSingleElimBracket(entries(4));
  applyScore(tournament, matches, find(matches, 1, 1).id, 11, 7);
  applyScore(tournament, matches, find(matches, 1, 2).id, 11, 7);
  applyScore(tournament, matches, find(matches, 2, 1).id, 11, 7);
  assert.throws(() => applyScore(tournament, matches, find(matches, 1, 1).id, 7, 11), /ล้างผลรอบถัดไป/);
});

test('single elim: third-place play-off collects the semifinal losers', () => {
  const tournament = { format: 'single_elim', thirdPlace: true };
  const { matches } = buildSingleElimBracket(entries(4), { thirdPlace: true });
  const third = findThirdPlaceMatch(matches);
  assert.ok(third);
  assert.equal(third.roundLabel, 'ชิงอันดับ 3');
  assert.equal(third.slotA, null);
  applyScore(tournament, matches, find(matches, 1, 1).id, 11, 7); // p1 beats p4
  assert.equal(third.slotA, 'p4');
  applyScore(tournament, matches, find(matches, 1, 2).id, 2, 9); // p3 beats p2
  assert.equal(third.slotB, 'p2');
  assert.equal(third.status, 'ready');
  applyScore(tournament, matches, find(matches, 2, 1).id, 9, 8);
  assert.equal(isTournamentFinished(tournament, matches), false, 'final done but third place pending');
  const { finished } = applyScore(tournament, matches, third.id, 4, 6);
  assert.equal(finished, true);
  assert.equal(third.winnerId, 'p2');
});

test('single elim: rescoring flips the propagated slot', () => {
  const tournament = { format: 'single_elim' };
  const { matches } = buildSingleElimBracket(entries(4));
  applyScore(tournament, matches, find(matches, 1, 1).id, 11, 7);
  assert.equal(find(matches, 2, 1).slotA, 'p1');
  applyScore(tournament, matches, find(matches, 1, 1).id, 7, 11);
  assert.equal(find(matches, 2, 1).slotA, 'p4');
});

test('round robin: every pair meets exactly once', () => {
  for (const count of [3, 4, 5, 6]) {
    const rounds = buildRoundRobinSchedule(entries(count));
    const pairs = rounds.flat().map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`));
    assert.equal(pairs.length, (count * (count - 1)) / 2);
    assert.equal(new Set(pairs).size, pairs.length);
    const perRound = rounds.map(r => r.length);
    assert.ok(perRound.every(n => n === Math.floor(count / 2)), 'rounds are balanced');
  }
  assert.equal(buildRoundRobinMatches(entries(4)).length, 6);
  assert.equal(buildRoundRobinMatches(entries(5)).length, 10);
  assert.throws(() => buildRoundRobinSchedule(entries(2)), /อย่างน้อย 3/);
});

test('round robin: matches are labelled by week and ready to play', () => {
  const matches = buildRoundRobinMatches(entries(4));
  assert.deepEqual(matches.map(m => m.roundLabel), ['สัปดาห์ 1', 'สัปดาห์ 1', 'สัปดาห์ 2', 'สัปดาห์ 2', 'สัปดาห์ 3', 'สัปดาห์ 3']);
  assert.ok(matches.every(m => m.status === 'ready'));
});

test('round robin: draws are allowed when configured', () => {
  const tournament = { format: 'round_robin', allowDraw: true };
  const matches = buildRoundRobinMatches(entries(4));
  const { updates } = applyScore(tournament, matches, matches[0].id, 1, 1);
  assert.equal(matches[0].winnerId, null);
  assert.equal(matches[0].status, 'completed');
  assert.deepEqual(updates.map(u => u.id), [matches[0].id], 'no bracket advancement in leagues');
  const noDraw = { format: 'round_robin', allowDraw: false };
  assert.throws(() => applyScore(noDraw, matches, matches[1].id, 2, 2), /ตัดสินผู้ชนะ/);
});

test('standings: wins, draws and custom point rules', () => {
  const tournament = { format: 'round_robin', allowDraw: true, pointsWin: 3, pointsDraw: 1, pointsLoss: 0 };
  const people = entries(3);
  // Schedule for 3: week 1 p2-p3, week 2 p1-p3, week 3 p1-p2.
  const matches = buildRoundRobinMatches(people);
  applyScore(tournament, matches, matches[0].id, 2, 0); // p2 wins
  applyScore(tournament, matches, matches[1].id, 1, 1); // draw
  applyScore(tournament, matches, matches[2].id, 0, 3); // p2 wins
  const table = computeStandings(people, matches, tournament);
  assert.equal(table.length, 3);
  assert.ok(table.every(row => row.played === 2));
  const total = table.reduce((sum, row) => sum + row.points, 0);
  assert.equal(total, 8, '2 wins (3 each) + 1 draw (1 each)');
  const winner = table.find(r => r.rank === 1);
  assert.equal(winner.participantId, 'p2');
  assert.equal(winner.points, 6);
});

test('standings: equal points resolve via head-to-head before goal difference', () => {
  const tournament = { format: 'round_robin', allowDraw: true, pointsWin: 3, pointsDraw: 1, pointsLoss: 0 };
  const people = entries(4);
  const matches = buildRoundRobinMatches(people);
  // Schedule for 4: w1 (p1-p4),(p2-p3); w2 (p1-p3),(p4-p2); w3 (p1-p2),(p3-p4).
  applyScore(tournament, matches, matches[0].id, 1, 0); // p1 beats p4
  applyScore(tournament, matches, matches[1].id, 1, 0); // p2 beats p3 (head-to-head winner)
  applyScore(tournament, matches, matches[2].id, 0, 1); // p3 beats p1
  applyScore(tournament, matches, matches[3].id, 2, 0); // p4 beats p2
  applyScore(tournament, matches, matches[4].id, 0, 1); // p2 beats p1
  applyScore(tournament, matches, matches[5].id, 9, 0); // p3 thrashes p4 (huge difference)
  const table = computeStandings(people, matches, tournament);
  const p2 = table.find(r => r.participantId === 'p2');
  const p3 = table.find(r => r.participantId === 'p3');
  assert.equal(p2.points, 6);
  assert.equal(p3.points, 6);
  assert.ok(p3.diff > p2.diff, 'sanity: p3 has the better difference');
  assert.ok(p2.rank < p3.rank, 'head-to-head outranks goal difference');
});

test('normalizeScore rejects junk input', () => {
  assert.throws(() => normalizeScore(-1, 0));
  assert.throws(() => normalizeScore(1.5, 0));
  assert.throws(() => normalizeScore('x', 0));
  assert.throws(() => normalizeScore(10000, 0));
  assert.deepEqual(normalizeScore('11', 7), { a: 11, b: 7 });
});

test('double elim: 4 entries build WB + LB + grand final', () => {
  const { matches } = buildDoubleElimBracket(entries(4));
  const wb = matches.filter(m => m.bracketSide === 1);
  const lb = matches.filter(m => m.bracketSide === 2);
  const gf = matches.filter(m => m.bracketSide === 3);
  assert.equal(wb.length, 3, 'WB = R1(2) + final(1)');
  assert.equal(lb.length, 2, 'LB = R1(1) + LB final(1)');
  assert.equal(gf.length, 1);
  assert.equal(gf[0].roundLabel, 'ชิงชนะเลิศ');
  // WB final winner → GF slot A, LB final winner → GF slot B.
  const wbFinal = wb.find(m => m.round === 2);
  const lbFinal = lb.find(m => m.round === 2);
  assert.equal(wbFinal.nextMatchId, gf[0].id);
  assert.equal(wbFinal.nextSlot, 1);
  assert.equal(lbFinal.nextMatchId, gf[0].id);
  assert.equal(lbFinal.nextSlot, 2);
  // WB R1 losers feed LB R1.
  assert.ok(wb.filter(m => m.round === 1).every(m => m.loserNextMatchId === lb[0].id));
  // WB final loser drops to LB final slot B.
  assert.equal(wbFinal.loserNextMatchId, lbFinal.id);
  assert.equal(wbFinal.loserNextSlot, 2);
});

test('double elim: 8 entries counts and structure', () => {
  const { matches, lbRounds } = buildDoubleElimBracket(entries(8));
  assert.equal(lbRounds, 4);
  const counts = side => matches.filter(m => m.bracketSide === side);
  assert.equal(counts(1).length, 7);
  assert.equal(counts(2).length, 6, 'LB: R1(2)+R2(2)+R3(1)+final(1)');
  assert.equal(counts(3).length, 1);
  // Every WB match except the final feeds a losers match; LB matches feed forward.
  const referencedIds = new Set(matches.flatMap(m => [m.nextMatchId, m.loserNextMatchId].filter(Boolean)));
  // Round-1 matches are fed by participants directly, so only rounds > 1 must be referenced.
  const dead = matches.filter(m => m.round > 1 && m.bracketSide !== 3 && !referencedIds.has(m.id));
  assert.equal(dead.length, 0, 'no dead matches');
});

test('double elim: non power-of-two is rejected', () => {
  assert.throws(() => buildDoubleElimBracket(entries(5)), /กำลังสอง/);
  assert.throws(() => buildDoubleElimBracket(entries(6)), /6 ราย/);
});

test('double elim: losers drop correctly and the bracket resolves', () => {
  const tournament = { format: 'double_elim' };
  const { matches } = buildDoubleElimBracket(entries(4));
  const find = (s, r, n) => matches.find(m => m.bracketSide === s && m.round === r && m.matchNo === n);
  // WB R1: p1 beats p4, p2 beats p3 → losers p4, p3 to LB R1.
  applyScore(tournament, matches, find(1, 1, 1).id, 3, 1);
  applyScore(tournament, matches, find(1, 1, 2).id, 3, 1);
  const lb1 = find(2, 1, 1);
  assert.equal(lb1.slotA, 'p4');
  assert.equal(lb1.slotB, 'p3');
  assert.equal(lb1.status, 'ready');
  // WB final: p1 beats p2 → p2 drops to LB final slot B.
  applyScore(tournament, matches, find(1, 2, 1).id, 5, 2);
  const lbFinal = find(2, 2, 1);
  assert.equal(lbFinal.slotB, 'p2');
  // LB R1: p3 survives → LB final vs p2.
  applyScore(tournament, matches, lb1.id, 0, 2);
  assert.equal(lbFinal.slotA, 'p3');
  assert.equal(lbFinal.status, 'ready');
  // LB final: p2 survives → grand final p1 vs p2.
  applyScore(tournament, matches, lbFinal.id, 1, 4);
  const gf = find(3, 1, 1);
  assert.equal(gf.slotA, 'p1');
  assert.equal(gf.slotB, 'p2');
  assert.equal(isTournamentFinished(tournament, matches), false);
  const { finished } = applyScore(tournament, matches, gf.id, 2, 6);
  assert.equal(finished, true);
  assert.equal(championOf(matches), 'p2', 'loser-bracket survivor takes the title');
});

test('groupMatchSections separates winners, losers and the final', () => {
  const { matches } = buildDoubleElimBracket(entries(4));
  const sections = groupMatchSections(matches);
  assert.deepEqual(sections.map(s => s.title), ['สายการแข่งขัน', 'สายผู้แพ้', 'ชิงชนะเลิศ']);
  const single = groupMatchSections(buildSingleElimBracket(entries(4)).matches);
  assert.equal(single.length, 1);
  assert.equal(single[0].rounds.length, 2);
});
