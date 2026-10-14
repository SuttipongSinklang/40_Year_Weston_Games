import { connect, playerSession, snapshot, subscribe } from './data.js?v=20261012-2';
import { journeyForScore, journeyLayout, journeyPath, travelScore, MILESTONE_POINTS } from './journey-model.js?v=20261014-2';

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
let journey = journeyForScore(travelScore(game.total, missionPoints));
let paintedStage = -1;
let centered = false;
let characterLoading;
let refreshing;
let refreshAgain = false;

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
  const completedPath = journeyPath(layout.points.slice(0, journey.reached + 1));
  el('journeyPath').setAttribute('viewBox', `0 0 400 ${layout.height}`);
  el('journeyPath').setAttribute('preserveAspectRatio', 'none');
  el('journeyPath').innerHTML = `<path class="journey-road-shadow" d="${path}"/><path class="journey-road-edge" d="${path}"/><path class="journey-road" d="${path}"/><path class="journey-road-dots" d="${path}"/>${journey.reached ? `<path class="journey-road-complete" d="${completedPath}"/>` : ''}`;
  el('journeyNodes').innerHTML = `<button type="button" class="journey-stop journey-start ${!journey.reached ? 'is-current' : 'is-reached'}" data-stage="0" style="left:50%;top:${layout.points[0].y}px" aria-label="จุดเริ่มต้น${!journey.reached ? ' คุณอยู่ที่นี่' : ''}" ${!journey.reached ? 'aria-current="step"' : ''}><span class="journey-platform"><span aria-hidden="true">${journey.reached ? '✓' : '✦'}</span></span><span class="journey-start-label">จุดเริ่มต้น</span></button>`
    + journey.stops.map(stop => {
      const point = layout.points[stop.stage];
      const current = stop.stage === journey.reached;
      const label = stop.unlocked ? `${stop.name} ${number(stop.points)} แต้ม ${current ? 'คุณอยู่ที่นี่' : 'เดินทางถึงแล้ว'}` : `จุดหมายลับที่ ${stop.stage} ต้องมี ${number(stop.points)} แต้ม ยังไม่เปิด`;
      return `<button type="button" class="journey-stop ${stop.stage % 2 ? 'is-left' : 'is-right'} ${stop.unlocked ? 'is-reached' : 'is-locked'} ${current ? 'is-current' : ''}" data-stage="${stop.stage}" style="left:${point.x / 4}%;top:${point.y}px" aria-label="${label}" ${current ? 'aria-current="step"' : ''}><span class="journey-platform">${stop.unlocked ? '<span class="journey-check" aria-hidden="true">✓</span>' : `<span class="journey-lock">${lock}<b aria-hidden="true">?</b></span>`}</span>${stop.unlocked ? postcard(stop) : `<span class="journey-mystery-label"><i aria-hidden="true">★</i> ${number(stop.points)} <small>แต้ม</small></span>`}<span class="journey-stage-number" aria-hidden="true">${String(stop.stage).padStart(2, '0')}</span></button>`;
    }).join('');
  const current = layout.points[journey.reached];
  marker.style.left = `${current.x / 4}%`;
  marker.style.top = `${current.y}px`;
  marker.setAttribute('aria-label', `ตัวละครของคุณที่${journey.currentName}`);
  el('journeyFog').style.height = `${journey.complete ? 0 : current.y - 95}px`;
  paintedStage = journey.reached;
}

function render() {
  const previous = journey;
  journey = journeyForScore(travelScore(game.total, missionPoints));
  el('journeyScore').textContent = number(journey.score);
  el('journeyNextLabel').textContent = journey.complete ? 'เดินทางครบแล้ว' : 'จุดหมายถัดไป';
  el('journeyNextScore').textContent = journey.next ? number(journey.next.points) : 'ครบทุกจุด';
  el('journeyProgressFill').style.width = `${journey.progress / MILESTONE_POINTS * 100}%`;
  el('journeyProgress').setAttribute('aria-valuenow', String(journey.progress));
  el('journeyProgress').setAttribute('aria-valuetext', journey.complete ? 'เดินทางถึงทุกจุดหมายแล้ว' : `${number(journey.remaining)} แต้มถึงจุดหมายถัดไป`);
  el('journeyProgressText').textContent = journey.complete ? 'เก่งมาก! คุณสำรวจครบทุกจุดหมายแล้ว' : `อีก ${number(journey.remaining)} แต้ม เปิดจุดหมายใหม่`;
  if (paintedStage !== journey.reached) {
    paintMap();
    centered = false;
    if (screen.classList.contains('active')) centerCurrent(previous.reached !== journey.reached);
  }
  if (!navigator.onLine || ['offline', 'error', 'setup'].includes(game.state)) {
    el('journeySync').textContent = 'แสดงคะแนนที่เก็บในเครื่อง · อัปเดตเมื่อเชื่อมต่อ';
  } else if (refreshing || ['connecting', 'syncing'].includes(game.state)) {
    el('journeySync').textContent = 'กำลังอัปเดตคะแนนสะสม…';
  } else {
    el('journeySync').textContent = 'เล่น + ทำภารกิจ · ทุก 1,000 แต้ม เปิดโลกใหม่';
  }
}

function centerCurrent(smooth = false) {
  requestAnimationFrame(() => {
    const point = layout.points[journey.reached];
    const visibleHeight = Math.max(1, viewport.clientHeight - 110);
    viewport.scrollTo({ top: Math.max(0, point.y - visibleHeight * 0.73), behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
    centered = true;
  });
}

async function activate() {
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
detail.innerHTML = '<button type="button" class="journey-dialog-close" aria-label="ปิดรายละเอียดจุดหมาย">×</button><div id="journeyDestinationArt"></div><p id="journeyDestinationKicker" class="journey-eyebrow"></p><h3 id="journeyDestinationTitle"></h3><p id="journeyDestinationDescription"></p><div id="journeyDestinationPoints" class="journey-detail-points"></div><button type="button" class="journey-dialog-action">เดินทางต่อ</button>';
detail.querySelector('.journey-dialog-close').addEventListener('click', () => detail.close());
detail.querySelector('.journey-dialog-action').addEventListener('click', () => detail.close());

el('journeyNodes').addEventListener('click', event => {
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  const stage = Number(button.dataset.stage);
  const stop = journey.stops[stage - 1];
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
  journal.showModal();
});

el('journeyRecenter').addEventListener('click', () => centerCurrent(true));
subscribe(next => {
  const ownerChanged = next.owner !== missionOwner;
  game = next;
  if (ownerChanged) {
    missionOwner = next.owner;
    missionPoints = readPoints(missionOwner);
  }
  render();
  if (ownerChanged && next.owner) void refreshMissions();
});
window.westonGoalsRendered = true;
window.addEventListener('screenchange', event => {
  if (event.detail === 'goal') { void activate(); void refreshMissions(); }
});
window.addEventListener('missioncompleted', () => void refreshMissions());
window.addEventListener('online', () => void refreshMissions());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && screen.classList.contains('active')) void refreshMissions();
});
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (screen.classList.contains('active')) centerCurrent();
  }).observe(viewport);
}
if (screen.classList.contains('active')) void activate();
void connect().then(refreshMissions);
