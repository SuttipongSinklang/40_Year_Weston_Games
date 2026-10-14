import { connect, playerSession, snapshot, subscribe } from './data.js?v=20261012-2';
import { journeyForScore, journeyLayout, journeyPath, journeyMapPoint, travelScore, MILESTONE_POINTS } from './journey-model.js?v=20261014-6';
import { createJourneyMotion } from './journey-motion.js?v=20261014-5';
import { createJourneyReveals } from './journey-reveals.js?v=20261014-7';

const el = id => document.getElementById(id);
const screen = el('screen-goal');
const viewport = el('journeyViewport');
const world = el('journeyWorld');
const marker = el('journeyCharacter');
const layout = journeyLayout();
const number = value => value.toLocaleString('en-US');
const CACHE_KEY = 'weston-journey-missions-v1';
const lock = '<svg viewBox="0 0 24 28" fill="none" aria-hidden="true"><path d="M6 12V8a6 6 0 0 1 12 0v4" stroke="currentColor" stroke-width="3.5"/><rect x="2" y="11" width="20" height="16" rx="5" fill="currentColor"/></svg>';
let game = snapshot();
let missionOwner = game.owner;
let missionPoints = readPoints(missionOwner);
function scoreBaseline() {
  try { return Math.max(0, Number(localStorage.getItem(`weston-journey-baseline-v1:${game.owner}`)) || 0); } catch { return 0; }
}
function currentJourneyScore() { return Math.max(0, travelScore(game.total, missionPoints) - scoreBaseline()); }
let journey = journeyForScore(currentJourneyScore());
let paintedStage = '';
let centered = false;
let characterLoading;
let refreshing;
let refreshAgain = false;
let following = false;
let manualExplore = false;
let lastSeenPosition = journey.position;
const discoveries = createJourneyReveals(localStorage);
let activeReveal = null;
let replayStage = null;
const isVisible = () => screen.classList.contains('active') && !document.hidden;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = createJourneyMotion({
  draw: drawPosition,
  requestFrame: fn => requestAnimationFrame(fn),
  cancelFrame: id => cancelAnimationFrame(id),
  now: () => performance.now(),
});

function mapSignature() {
  const near = [...journey.stops, ...journey.checkpoints].find(point => point.nearUnlock);
  return `${journey.anchorPosition}:${journey.isTravelling}:${near?.points || ''}`;
}

function panTo(position, smooth = false) {
  const point = journeyMapPoint(layout, position);
  const visibleHeight = Math.max(1, viewport.clientHeight - 110);
  viewport.scrollTo({ top: Math.max(0, point.y - visibleHeight * .73), behavior: smooth && !reducedMotion() ? 'smooth' : 'instant' });
  centered = true;
}

function drawPosition(position, { moving }) {
  const point = journeyMapPoint(layout, position);
  marker.style.left = `${point.x / 4}%`;
  marker.style.top = `${point.y}px`;
  marker.dataset.position = String(position);
  marker.className = `journey-character${!journey.isTravelling && journey.position % 1 === .5 ? ' at-checkpoint' : ''}${journey.isTravelling ? ' is-travelling' : ''}${moving ? ' is-walking' : ''}`;
  el('journeyCompletedPath').setAttribute('d', journeyPath(layout.points, position));
  el('journeyFog').style.height = `${position >= journey.stops.length ? 0 : point.y - 95}px`;
  if (isVisible()) {
    lastSeenPosition = position;
    if (following) panTo(position);
    if (!moving) maybeReveal();
  }
}

function readPoints(owner) {
  if (!owner) return 0;
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
    return cache?.owner === owner && Number.isFinite(cache.points) && cache.points >= 0 ? cache.points : 0;
  } catch { return 0; }
}

function artStyle(index) {
  return `--art-x:${(index % 3) * 50}%;--art-y:${Math.floor(index / 3) * (100 / 3)}%`;
}

function postcard(stop) {
  return `<span class="journey-postcard"><span class="journey-place-art" style="${artStyle(stop.art)}"></span><b>${stop.name}</b><small><i aria-hidden="true">★</i> ${number(stop.points)} แต้ม</small></span>`;
}

function paintMap() {
  world.style.height = `${layout.height}px`;
  const path = journeyPath(layout.points);
  const completedPath = journeyPath(layout.points, motion.position ?? journey.position);
  el('journeyPath').setAttribute('viewBox', `0 0 400 ${layout.height}`);
  el('journeyPath').setAttribute('preserveAspectRatio', 'none');
  el('journeyPath').innerHTML = `<path class="journey-road-shadow" d="${path}"/><path class="journey-road-edge" d="${path}"/><path class="journey-road" d="${path}"/><path class="journey-road-dots" d="${path}"/><path id="journeyCompletedPath" class="journey-road-complete" d="${completedPath}"/>`;
  el('journeyNodes').innerHTML = `<button type="button" class="journey-stop journey-start ${journey.position === 0 ? 'is-current' : 'is-reached'}" data-stage="0" style="left:50%;top:${layout.points[0].y}px" aria-label="จุดเริ่มต้น${journey.position === 0 ? ' คุณอยู่ที่นี่' : ''}" ${journey.position === 0 ? 'aria-current="step"' : ''}><span class="journey-platform"><span aria-hidden="true">${journey.reached ? '✓' : '✦'}</span></span><span class="journey-start-label">จุดเริ่มต้น</span></button>`
    + journey.stops.map(stop => {
      const point = layout.points[stop.stage];
      const current = stop.stage === journey.position;
      const label = stop.unlocked ? `${stop.name} ${number(stop.points)} แต้ม ${current ? 'คุณอยู่ที่นี่' : 'เดินทางถึงแล้ว'}` : `จุดหมายลับที่ ${stop.stage} ต้องมี ${number(stop.points)} แต้ม ยังไม่เปิด`;
      return `<button type="button" class="journey-stop ${stop.stage % 2 ? 'is-left' : 'is-right'} ${stop.unlocked ? 'is-reached' : 'is-locked'} ${stop.nearUnlock ? 'is-near-unlock' : ''} ${current ? 'is-current' : ''}" data-stage="${stop.stage}" style="left:${point.x / 4}%;top:${point.y}px" aria-label="${label}" ${current ? 'aria-current="step"' : ''}><span class="journey-platform">${stop.unlocked ? '<span class="journey-check" aria-hidden="true">✓</span>' : `<span class="journey-lock">${lock}<b aria-hidden="true">?</b></span>`}</span>${stop.unlocked ? postcard(stop) : `<span class="journey-mystery-label"><i aria-hidden="true">★</i> ${number(stop.points)} <small>แต้ม</small></span>`}<span class="journey-stage-number" aria-hidden="true">${String(stop.stage).padStart(2, '0')}</span></button>`;
    }).join('') + journey.checkpoints.map(checkpoint => {
      const point = journeyMapPoint(layout, checkpoint.position);
      const current = checkpoint.position === journey.position;
      return `<button type="button" class="journey-checkpoint ${checkpoint.stage % 2 ? 'label-right' : 'label-left'} ${checkpoint.unlocked ? 'is-reached' : 'is-locked'} ${checkpoint.nearUnlock ? 'is-near-unlock' : ''} ${current ? 'is-current' : ''}" data-checkpoint="${checkpoint.stage}" style="left:${point.x / 4}%;top:${point.y}px" aria-label="เช็คพอยต์ ${number(checkpoint.points)} แต้ม ${current ? 'คุณอยู่ที่นี่' : checkpoint.unlocked ? 'ปลดล็อกแล้ว' : 'ยังล็อก'}" ${current ? 'aria-current="step"' : ''}><span class="journey-checkpoint-pad" aria-hidden="true">${checkpoint.unlocked ? '✓' : `<span class="journey-checkpoint-lock">${lock}<b>?</b></span>`}</span><span class="journey-checkpoint-label">${number(checkpoint.points)} <small>แต้ม</small></span></button>`;
    }).join('');
  marker.setAttribute('aria-label', `ตัวละครของคุณ${journey.isTravelling ? '' : 'ที่'}${journey.currentName}`);
  marker.querySelector('.journey-you').textContent = journey.isTravelling ? 'กำลังเดินทาง' : 'คุณอยู่ที่นี่';
  paintedStage = mapSignature();
}

function render({ resetPosition = false } = {}) {
  if (resetPosition) { activeReveal = null; reveal.close(); }
  journey = journeyForScore(currentJourneyScore());
  discoveries.observe(game.owner, journey.reached);
  el('journeyScore').textContent = number(journey.score);
  el('journeyNextLabel').textContent = journey.complete ? 'เดินทางครบแล้ว' : 'จุดหมายถัดไป';
  el('journeyNextScore').textContent = journey.next ? number(journey.next.points) : 'ครบทุกจุด';
  el('journeyProgressFill').style.width = `${journey.progress / MILESTONE_POINTS * 100}%`;
  el('journeyProgress').setAttribute('aria-valuenow', String(journey.progress));
  el('journeyProgress').setAttribute('aria-valuetext', journey.complete ? 'เดินทางถึงทุกจุดหมายแล้ว' : `${number(journey.remaining)} แต้มถึงจุดหมายถัดไป`);
  el('journeyProgressText').textContent = journey.complete ? 'เก่งมาก! คุณสำรวจครบทุกจุดหมายแล้ว' : `อีก ${number(journey.remaining)} แต้ม เปิดจุดหมายใหม่`;
  if (paintedStage !== mapSignature()) {
    paintMap();
  }
  if (motion.target !== journey.position || resetPosition) {
    following = isVisible() && !manualExplore;
    motion.moveTo(journey.position, { animate: !resetPosition && isVisible() && !reducedMotion() });
  }
  maybeReveal();
  if (!navigator.onLine || ['offline', 'error', 'setup'].includes(game.state)) {
    el('journeySync').textContent = 'แสดงคะแนนที่เก็บในเครื่อง · อัปเดตเมื่อเชื่อมต่อ';
  } else if (refreshing || ['connecting', 'syncing'].includes(game.state)) {
    el('journeySync').textContent = 'กำลังอัปเดตคะแนนสะสม…';
  } else {
    el('journeySync').textContent = 'เล่น + ทำภารกิจ · ทุก 1,000 แต้ม เปิดโลกใหม่';
  }
}

function centerCurrent(smooth = false) {
  requestAnimationFrame(() => panTo(motion.position ?? journey.position, smooth));
}

async function activate() {
  manualExplore = false;
  following = true;
  if (lastSeenPosition !== journey.position && !reducedMotion()) {
    const from = lastSeenPosition;
    motion.moveTo(from, { animate: false });
    motion.moveTo(journey.position);
  } else {
    motion.moveTo(journey.position, { animate: false });
  }
  if (!centered) centerCurrent();
  if (!characterLoading) {
    characterLoading = import('./journey-character.js?v=20261014-1')
      .then(module => module.createJourneyCharacter(el('journeyCharacterCanvas')))
      .then(() => { el('journeyCharacterFallback').hidden = true; })
      .catch(() => { el('journeyCharacterCanvas').hidden = true; });
  }
}

// Paging includes older mission rewards; only the signed-in owner's rows count.
export async function loadTravelMissionPoints(api) {
  let points = 0;
  const owner = api.userId;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await api.from('weston_mission_completions')
      .select('points_awarded').eq('user_id', owner)
      .order('completed_at').order('mission_id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const value = Number(row.points_awarded);
      if (Number.isFinite(value) && value > 0) points += value;
    }
    if (rows.length < pageSize) return points;
  }
}

function refreshMissions() {
  if (!navigator.onLine) return;
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const api = await playerSession();
      const owner = api.userId;
      const points = await loadTravelMissionPoints(api);
      // An account switch during a request cannot reveal another player's map.
      if (owner !== snapshot().owner) return;
      missionOwner = owner;
      missionPoints = points;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ owner: missionOwner, points })); } catch { /* map also works without storage */ }
    } catch {
      el('journeySync').textContent = 'ยังอัปเดตแต้มภารกิจไม่ได้ · ใช้ข้อมูลล่าสุดในเครื่อง';
      return;
    } finally {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        void Promise.resolve().then(refreshMissions);
      }
    }
    render();
  })();
  return refreshing;
}

function createDialog(id, label) {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = 'journey-dialog';
  dialog.setAttribute('aria-labelledby', label);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.getElementById('app').append(dialog);
  return dialog;
}

const detail = createDialog('journeyDestinationDialog', 'journeyDestinationTitle');
detail.innerHTML = '<button type="button" class="journey-dialog-close" aria-label="ปิดรายละเอียดจุดหมาย">×</button><div id="journeyDestinationArt"></div><p id="journeyDestinationKicker" class="journey-eyebrow"></p><h3 id="journeyDestinationTitle"></h3><p id="journeyDestinationDescription"></p><div id="journeyDestinationPoints" class="journey-detail-points"></div><button type="button" class="journey-dialog-action">เดินทางต่อ</button><button type="button" id="journeyReplay" class="journey-replay" hidden>ดูฉากค้นพบอีกครั้ง</button>';
detail.querySelector('.journey-dialog-close').addEventListener('click', () => detail.close());
detail.querySelector('.journey-dialog-action').addEventListener('click', () => detail.close());

el('journeyNodes').addEventListener('click', event => {
  const checkpointButton = event.target.closest('[data-checkpoint]');
  if (checkpointButton) {
    el('journeyReplay').hidden = true;
    const checkpoint = journey.checkpoints.find(point => point.stage === Number(checkpointButton.dataset.checkpoint));
    if (!checkpoint) return;
    const art = el('journeyDestinationArt');
    art.className = 'journey-detail-mystery';
    art.style.cssText = '';
    art.innerHTML = checkpoint.unlocked ? '<span aria-hidden="true">✓</span>' : `${lock}<b aria-hidden="true">?</b>`;
    el('journeyDestinationKicker').textContent = 'CHECKPOINT';
    el('journeyDestinationTitle').textContent = checkpoint.unlocked ? checkpoint.benefit?.title || 'ปลดล็อกเช็คพอยต์แล้ว' : 'เช็คพอยต์ปริศนา';
    el('journeyDestinationDescription').textContent = checkpoint.unlocked ? checkpoint.benefit?.description || 'รายละเอียดสิทธิพิเศษของจุดนี้จะแจ้งให้ทราบภายหลัง' : 'สะสมคะแนนให้ถึงเกณฑ์เพื่อปลดล็อกจุดนี้ รายละเอียดภายในยังถูกซ่อนไว้ในสายหมอก';
    el('journeyDestinationPoints').textContent = `★ ${number(checkpoint.points)} แต้ม · ${checkpoint.unlocked ? 'ปลดล็อกแล้ว' : `อีก ${number(checkpoint.points - journey.score)} แต้ม`}`;
    detail.showModal();
    return;
  }
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  const stage = Number(button.dataset.stage);
  const stop = journey.stops[stage - 1];
  replayStage = stop?.unlocked ? stop.stage : null;
  el('journeyReplay').hidden = !replayStage;
  const art = el('journeyDestinationArt');
  art.className = stop?.unlocked ? 'journey-detail-art journey-place-art' : 'journey-detail-mystery';
  art.style.cssText = stop?.unlocked ? artStyle(stop.art) : '';
  art.innerHTML = stop?.unlocked ? '' : stage ? `${lock}<b>?</b>` : '<span aria-hidden="true">✦</span>';
  el('journeyDestinationKicker').textContent = stage ? `DESTINATION ${String(stage).padStart(2, '0')}` : 'LET THE ADVENTURE BEGIN';
  el('journeyDestinationTitle').textContent = stop?.unlocked ? stop.name : stage ? 'จุดหมายลับในสายหมอก' : 'ทุกการเดินทาง เริ่มได้วันนี้';
  el('journeyDestinationDescription').textContent = stop?.unlocked ? stop.description : stage ? 'เก็บแต้มจากการเล่นและทำภารกิจให้ถึงเป้าหมาย แล้วหมอกจะเปิดให้เห็นสถานที่ใหม่' : 'ออกกำลังกายกับตัวละครและทำภารกิจ เก็บครบทุก 1,000 แต้มเพื่อเดินทางไปยังสถานที่ถัดไป';
  el('journeyDestinationPoints').textContent = stop ? stop.unlocked ? `★ ${number(stop.points)} แต้ม · เดินทางถึงแล้ว` : `★ ${number(stop.points)} แต้ม · อีก ${number(Math.max(0, stop.points - journey.score))} แต้ม` : 'เล่นกับตัวละคร 1 ครั้ง = 10 แต้ม + คะแนนภารกิจ';
  detail.showModal();
});

const journal = createDialog('journeyJournalDialog', 'journeyJournalTitle');
journal.innerHTML = '<button type="button" class="journey-dialog-close" aria-label="ปิดสมุดการเดินทาง">×</button><p class="journey-eyebrow">MY TRAVEL JOURNAL</p><h3 id="journeyJournalTitle">สมุดการเดินทาง</h3><p>ทุกความพยายาม พาคุณเข้าใกล้โลกใบใหม่</p><div class="journey-journal-rule"><strong>★ ทุก 1,000 แต้ม = 1 จุดหมาย</strong><span>เล่นกับตัวละคร 1 ครั้ง ได้ 10 แต้ม<br>ทำภารกิจสำเร็จ ได้แต้มตามที่ภารกิจกำหนด<br>คะแนนสะสมไม่ถูกหักเมื่อปลดล็อก</span></div><p id="journeyJournalSummary"></p><div id="goalList" class="goal-list"><p class="journey-badges-loading">เหรียญตราจะปรากฏเมื่อเชื่อมต่อข้อมูลสำเร็จ</p></div><p class="journey-journal-footnote">สถานที่บนแผนที่คือหมุดความสำเร็จในเกม</p>';
journal.querySelector('.journey-dialog-close').addEventListener('click', () => journal.close());
el('journeyJournal').addEventListener('click', () => {
  el('journeyJournalSummary').textContent = `ค้นพบแล้ว ${journey.reached} / ${journey.stops.length} จุดหมาย · ${journey.currentName}`;
  el('journeyUndoReset').hidden = scoreBaseline() === 0;
  journal.showModal();
});

const resetControls = document.createElement('div');
resetControls.className = 'journey-journal-rule';
resetControls.innerHTML = '<strong>เริ่มการเดินทางรอบใหม่</strong><span>เริ่มนับคะแนนแผนที่จาก 0 บนเครื่องนี้ ประวัติออกกำลังกายและแต้มภารกิจเดิมยังอยู่ครบ</span><button type="button" id="journeyReset" class="journey-dialog-action">รีเซ็ตคะแนนการเดินทางเป็น 0</button><button type="button" id="journeyUndoReset" class="journey-replay" hidden>คืนคะแนนก่อนรีเซ็ต</button>';
journal.append(resetControls);
function restartJourney(restore = false) {
  try {
    localStorage.setItem(`weston-journey-baseline-v1:${game.owner}`, String(restore ? 0 : travelScore(game.total, missionPoints)));
  } catch {
    el('journeyJournalSummary').textContent = 'ยังรีเซ็ตไม่ได้ เพราะบันทึกข้อมูลในเครื่องไม่สำเร็จ';
    return;
  }
  discoveries.reset(journeyForScore(currentJourneyScore()).reached);
  render({ resetPosition: true });
  lastSeenPosition = journey.position;
  manualExplore = false;
  following = true;
  centerCurrent();
  journal.close();
}
el('journeyReset').addEventListener('click', () => restartJourney());
el('journeyUndoReset').addEventListener('click', () => restartJourney(true));

const reveal = createDialog('journeyRevealDialog', 'journeyRevealTitle');
reveal.className = 'journey-reveal';
function showReveal(stop, replay = false) {
  activeReveal = { stage: stop.stage, replay };
  reveal.innerHTML = `<div class="journey-reveal-scene">
    <svg class="journey-reveal-art" viewBox="${stop.art % 3 * 100} ${Math.floor(stop.art / 3) * 100} 100 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${stop.name}"><image href="assets/journey/destinations.png" width="300" height="400"/></svg>
    <div class="journey-reveal-rays" aria-hidden="true"></div>
    <div class="journey-reveal-lock" aria-hidden="true"><span>${lock}<b>?</b></span><span>${lock}<b>?</b></span></div>
    <div class="journey-reveal-particles" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--angle:${i * 20}deg;--distance:${115 + i % 4 * 24}px;--delay:${i % 3 * .06}s">${i % 3 ? '✦' : '★'}</i>`).join('')}</div>
    <div class="journey-reveal-copy"><p class="journey-reveal-kicker">NEW DESTINATION UNLOCKED</p><p class="journey-reveal-welcome">การเดินทางพาคุณมาถึง</p><h2 id="journeyRevealTitle">${stop.name}</h2><p>${stop.description}</p><span class="journey-reveal-score">★ ${number(stop.points)} แต้มแห่งความพยายาม</span><button type="button" class="journey-dialog-action">ออกเดินทางต่อ ✦</button></div>
    <button type="button" class="journey-reveal-skip" aria-label="ปิดฉากค้นพบจุดหมาย">ข้าม / ปิด ×</button>
  </div>`;
  reveal.querySelector('.journey-dialog-action').addEventListener('click', () => reveal.close());
  reveal.querySelector('.journey-reveal-skip').addEventListener('click', () => reveal.close());
  reveal.showModal();
}
function maybeReveal() {
  if (!isVisible() || activeReveal || detail.open || journal.open || motion.position !== journey.position) return;
  const stage = discoveries.next(journey.reached);
  if (stage) showReveal(journey.stops[stage - 1]);
}
reveal.addEventListener('close', () => {
  if (reveal.open) return;
  if (activeReveal && !activeReveal.replay) discoveries.acknowledge(activeReveal.stage);
  activeReveal = null;
  maybeReveal();
});
detail.addEventListener('close', maybeReveal);
journal.addEventListener('close', maybeReveal);
el('journeyReplay').addEventListener('click', () => {
  const stop = journey.stops[replayStage - 1];
  if (!stop?.unlocked) return;
  showReveal(stop, true);
  detail.close();
});

el('journeyRecenter').addEventListener('click', () => { manualExplore = false; following = true; centerCurrent(true); });
for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
  viewport.addEventListener(event, () => { manualExplore = true; following = false; }, { passive: true });
}
subscribe(next => {
  const ownerChanged = next.owner !== missionOwner;
  game = next;
  if (ownerChanged) {
    missionOwner = next.owner;
    missionPoints = readPoints(missionOwner);
  }
  render({ resetPosition: ownerChanged });
  if (ownerChanged && next.owner) void refreshMissions();
});
window.westonGoalsRendered = true;
window.addEventListener('screenchange', event => {
  if (event.detail === 'goal') { void activate(); void refreshMissions(); }
  else { following = false; motion.stop(); activeReveal = null; reveal.close(); }
});
window.addEventListener('missioncompleted', () => void refreshMissions());
window.addEventListener('online', () => void refreshMissions());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { following = false; motion.stop(); }
  else if (screen.classList.contains('active')) { void activate(); void refreshMissions(); }
});
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (screen.classList.contains('active')) centerCurrent();
  }).observe(viewport);
}
if (screen.classList.contains('active')) void activate();
void connect().then(refreshMissions);
