import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ═══════════════════════════════════════════════
   1) NAV — สลับหน้าจอ
   ═══════════════════════════════════════════════ */
const navBtns = document.querySelectorAll('.nav-btn');
let activeScreen = 'home';

navBtns.forEach(btn => btn.addEventListener('click', () => {
  const target = btn.dataset.screen;
  if (target === activeScreen) return;
  activeScreen = target;
  navBtns.forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === `screen-${target}`));
  if (target === 'goal') setTimeout(() => animateGoalBars(), 120);
}));

/* ═══════════════════════════════════════════════
   2) THREE.JS — ฉากสวน + โมเดลตัวละครกลางจอ
   ═══════════════════════════════════════════════ */
const canvas = document.getElementById('scene3d');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3f2, 24, 60);  // หมอกบรรยากาศ: ตัวไกล (ตึก) ยังชัด ของไกลมากจาง

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

/* ── แสงกลางแจ้งแบบธรรมชาติ: แสงจากท้องฟ้า + แดด + แสงเติมบาง ๆ ── */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// แสงกระจายจากท้องฟ้า/พื้นดิน — ลดลงเล็กน้อยกันสีซีด
scene.add(new THREE.HemisphereLight(0xbfe5ff, 0x7cbf7a, 0.55));

// แสงหลัก (key) ขาวนุ่มจากบน-หน้า-ซ้าย
const sun = new THREE.DirectionalLight(0xffffff, 1.75);
sun.position.set(-3.5, 5.5, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -5; sun.shadow.camera.right = 5;
sun.shadow.camera.top = 5;  sun.shadow.camera.bottom = -5;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// แสงเติมจากท้องฟ้าฝั่งตรงข้าม (บางเบา)
const fill = new THREE.DirectionalLight(0xd6ecff, 0.4);
fill.position.set(4, 3.5, 2.5);
scene.add(fill);

// แสงขอบ (rim) เย็นบาง ๆ จากด้านหลัง ให้ตัวละครเด่นแยกจากพื้นหลัง
const rim = new THREE.DirectionalLight(0xbfe3f2, 0.6);
rim.position.set(-1.5, 4, -5);
scene.add(rim);

/* ── ฉากหลัง: ภาพ Weston Myer Campus (CSS) — 3D เหลือแค่ตัวละคร ── */

/* ── แผ่นรับเงาโปร่งใส (เงาตกบนพื้นภาพพื้นหลังโดยไม่เห็นพื้น 3D) ── */
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 16),
  new THREE.ShadowMaterial({ opacity: 0.28 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.01;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

/* ── โมเดลตัวละคร (GLB จาก folder, ยืนนิ่งไม่มี Animation) ── */
const MODEL_URL = 'assets/changrid_fat.glb';
let character = null;            // group ที่หมุนได้

const loaderEl = document.getElementById('loader');
const gltfLoader = new GLTFLoader();

/* ปรับขนาด + วางเท้าให้แตะพื้น */
function fitModel(model, targetH) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(targetH / size.y);
  box.setFromObject(model);
  model.position.y = -box.min.y + 0.02;
}

gltfLoader.load(
  MODEL_URL,
  (gltf) => {
    const model = gltf.scene;
    fitModel(model, 1.32);          // ขนาดพอดีจอมือถือ
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        if (o.material) o.material.envMapIntensity = 0.35;
      }
    });

    character = new THREE.Group();
    character.add(model);
    scene.add(character);

    loaderEl.classList.add('done');
    setTimeout(() => toast('ยินดีต้อนรับ! แตะตัวละครเพื่อออกกำลังกาย 👆'), 500);
  },
  undefined,
  () => { loaderEl.querySelector('p').textContent = 'โหลดโมเดลไม่สำเร็จ'; }
);

/* ── อินเทอร์แอ็กชัน: ลาก = หมุน, แตะ = +1 ── */
let dragging = false, moved = false, lastX = 0, lastInput = performance.now();

canvas.addEventListener('pointerdown', e => {
  dragging = true; moved = false; lastX = e.clientX;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging || !character) return;
  const dx = e.clientX - lastX;
  if (Math.abs(dx) > 3) moved = true;
  character.rotation.y += dx * 0.012;
  lastX = e.clientX;
  lastInput = performance.now();
});
canvas.addEventListener('pointerup', e => {
  dragging = false;
  lastInput = performance.now();
  if (!moved && character) workout(e);
});

/* ── Game loop ── */
const clock = new THREE.Clock();
let elapsed = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (character) {
    // หมุนช้า ๆ เมื่อไม่ได้แตะนาน 3 วิ
    if (performance.now() - lastInput > 3000) character.rotation.y += 0.004;
    // หายใจเบา ๆ ตอนยืน
    const breathe = 1 + Math.sin(elapsed * 2.2) * 0.008;
    character.scale.set(2 - breathe, breathe, 2 - breathe);
  }
  renderer.render(scene, camera);
}
tick();

/* ── Resize + จัดเฟรมกล้องตามสัดส่วนจอ (จอแคบ = ถอยออก กันตัวละครล้นจอ) ── */
function frameCamera() {
  const zoom = THREE.MathUtils.clamp(0.5 / camera.aspect, 0.85, 1.18);
  camera.position.set(0, 0.85 + 0.45 * zoom, 4.55 * zoom);
  camera.lookAt(0, 1.18, 0);   // เล็งสูงขึ้น → ตัวละคร + เงาถอยลงไปยืนบนถนนในภาพพื้นหลัง
}
function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  frameCamera();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

/* ═══════════════════════════════════════════════
   3) GAME LOGIC — ภารกิจ / เป้าหมาย / Streak (mockup)
   ═══════════════════════════════════════════════ */
const missions = [
  'ออกกำลังกายกับตัวละคร 5 ครั้ง',
  'เผาผลาญแคลอรี 5 ครั้ง',
  'เล่นเกมยืดเหยียด 5 ครั้ง',
  'สะสมแตะตัวละคร 5 ครั้ง',
];
let mIdx = 0, mDone = 2, mTotal = 5;
let goalPct = 62, goalHit = false;

const missionDone = document.getElementById('missionDone');
const missionTotal = document.getElementById('missionTotal');
const missionFill = document.getElementById('missionFill');
const missionName = document.getElementById('missionName');
const goalFill = document.getElementById('goalFill');
const goalPctEl = document.getElementById('goalPct');

function updateMission() {
  missionDone.textContent = mDone;
  missionTotal.textContent = mTotal;
  missionFill.style.width = (mDone / mTotal * 100) + '%';
}
function updateGoal() {
  goalFill.style.width = goalPct + '%';
  goalPctEl.textContent = goalPct;
}
updateMission();
updateGoal();

/* ── ปุ่มภารกิจ: กดเปิด/ปิดการ์ด ── */
const missionBtn = document.getElementById('missionBtn');
const missionCardEl = document.getElementById('missionCard');
missionBtn.addEventListener('click', e => {
  e.stopPropagation();
  missionCardEl.classList.toggle('open');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#missionCard') && !e.target.closest('#missionBtn')) {
    missionCardEl.classList.remove('open');
  }
});

function workout(e) {
  // +1 ลอยตรงจุดที่แตะ
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.textContent = '+1 💪';
  const rect = canvas.getBoundingClientRect();
  pop.style.left = (e.clientX - rect.left) + 'px';
  pop.style.top = (e.clientY - rect.top) + 'px';
  document.getElementById('popLayer').appendChild(pop);
  setTimeout(() => pop.remove(), 1000);

  // เป้าหมายวันนี้ (%)
  goalPct = Math.min(100, goalPct + 8);
  updateGoal();
  if (goalPct >= 100 && !goalHit) {
    goalHit = true;
    setBell(true, 'ยอดเยี่ยม! คุณครบเป้าหมายวันนี้แล้ว 🎉');
    setTimeout(() => toast('ครบเป้าหมายวันนี้แล้ว! 🎉'), 600);
  }

  // ภารกิจ
  if (mDone < mTotal) {
    mDone++;
    updateMission();
    if (mDone === mTotal) {
      setBell(true, 'ภารกิจสำเร็จ! รับรางวัลแล้ว 🎉');
      setTimeout(() => {
        toast('ภารกิจสำเร็จ! 🎉');
        setTimeout(() => {
          mIdx = (mIdx + 1) % missions.length;
          mDone = 0;
          missionName.textContent = missions[mIdx];
          updateMission();
        }, 1600);
      }, 700);
    }
  }
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ── Dropdown เปิด/ปิดช่องค่าสถิติ ── */
const statsToggle = document.getElementById('statsToggle');
const statsGrid = document.getElementById('statsGrid');
statsToggle.addEventListener('click', () => {
  const collapsed = statsGrid.classList.toggle('collapsed');
  statsToggle.classList.toggle('collapsed', collapsed);
  statsToggle.setAttribute('aria-expanded', String(!collapsed));
});

/* ── กระดิ่งแจ้งเตือน: สั่นเมื่อมี Notification, กดแล้วอ่านและหยุดสั่น ── */
const bellBtn = document.getElementById('bellBtn');
const bellImg = document.getElementById('bellImg');
let bellMsg = 'มีภารกิจประจำวันรอคุณอยู่! กดไอคอนภารกิจเพื่อดูรายละเอียด';
function setBell(on, msg) {
  bellBtn.classList.toggle('notify', on);
  bellImg.src = on ? 'assets/icons/bell_on.png' : 'assets/icons/bell_off.png';
  if (msg) bellMsg = msg;
}
bellBtn.addEventListener('click', () => {
  if (bellBtn.classList.contains('notify')) {
    toast(bellMsg);
    setBell(false);
  } else {
    toast('ไม่มีการแจ้งเตือนใหม่');
  }
});

/* ═══════════════════════════════════════════════
   4) LEADERBOARD (mockup ตาม Leader Board Person.png)
   ═══════════════════════════════════════════════ */
const players = [
  { name: 'Player 1', ava: '🦁', score: 3200 },
  { name: 'Player 2', ava: '😎', score: 2900 },
  { name: 'Player 3', ava: '🦊', score: 2700 },
  { name: 'Player 4', ava: '🐼', score: 2400 },
  { name: 'Player 5', ava: '🐯', score: 2200 },
  { name: 'Player 6', ava: '🐱', score: 2000 },
  { name: 'Player 1 (คุณ)', ava: '🧒', score: 1900, you: true },
  { name: 'Player 8', ava: '🚀', score: 1700 },
];
const maxScore = players[0].score;

const rankCell = i => i < 3
  ? `<img class="rank-img" src="assets/icons/rank${i + 1}.png" alt="อันดับ ${i + 1}">`
  : `<span class="rank-badge">${i + 1}</span>`;

document.getElementById('lbPerson').insertAdjacentHTML('beforeend', players.map((p, i) => `
  <div class="lb-row ${p.you ? 'you' : ''}">
    <div class="lb-rank">${rankCell(i)}</div>
    <div class="lb-player">
      <span class="lb-ava">${p.ava}</span>
      <span class="lb-name">${p.name}${p.you ? '<span class="you-chip">คุณ</span>' : ''}</span>
    </div>
    <div class="lb-score">
      <div class="lb-scorebar"><i style="width:${Math.round(p.score / maxScore * 100)}%"></i></div>
      <div class="lb-flame"><span>🔥</span>${p.score.toLocaleString()}</div>
    </div>
  </div>`).join(''));

const teams = [
  { name: 'ทีมสิงโตป่า', ava: '🦁', score: 4800 },
  { name: 'ทีมนกอินทรี', ava: '🦅', score: 4400 },
  { name: 'ทีมเสือโคร่ง', ava: '🐯', score: 4100 },
  { name: 'ทีมหมีขั้วโลก', ava: '🐻‍❄️', score: 3600 },
  { name: 'ทีมกบนักกระโดด', ava: '🐸', score: 3000 },
];
const maxTeam = teams[0].score;
document.getElementById('lbTeam').insertAdjacentHTML('beforeend', teams.map((t, i) => `
  <div class="lb-row">
    <div class="lb-rank">${rankCell(i)}</div>
    <div class="lb-player">
      <span class="lb-ava">${t.ava}</span>
      <span class="lb-name">${t.name}</span>
    </div>
    <div class="lb-score">
      <div class="lb-scorebar"><i style="width:${Math.round(t.score / maxTeam * 100)}%"></i></div>
      <div class="lb-flame"><span>🔥</span>${t.score.toLocaleString()}</div>
    </div>
  </div>`).join(''));

document.querySelectorAll('.pill').forEach(pill => pill.addEventListener('click', () => {
  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === pill));
  document.getElementById('lbPerson').classList.toggle('hidden', pill.dataset.lb !== 'person');
  document.getElementById('lbTeam').classList.toggle('hidden', pill.dataset.lb !== 'team');
}));

/* ═══════════════════════════════════════════════
   5) GOALS (mockup)
   ═══════════════════════════════════════════════ */
const goals = [
  { ico: '🚶', name: 'เดิน', done: 7420, total: 10000, unit: 'ก้าว', pct: 74 },
  { ico: '💧', name: 'ดื่มน้ำ', done: 5, total: 8, unit: 'แก้ว', pct: 62 },
  { ico: '🏃', name: 'วิ่ง', done: 1.2, total: 3, unit: 'กม.', pct: 40 },
  { ico: '😴', name: 'นอนหลับ', done: 7, total: 7, unit: 'ชม.', pct: 100 },
];
document.getElementById('goalList').innerHTML = goals.map(g => `
  <div class="goal-item card">
    <span class="goal-ico">${g.ico}</span>
    <div class="goal-mid">
      <h4><span>${g.name} ${g.unit}</span><b>${g.done.toLocaleString()}/${g.total.toLocaleString()}</b></h4>
      <div class="goal-track"><div class="goal-fill" data-w="${g.pct}"></div></div>
    </div>
    ${g.pct >= 100 ? '<span class="goal-done">✓</span>' : ''}
  </div>`).join('');

function animateGoalBars() {
  document.querySelectorAll('.goal-fill').forEach(f => {
    f.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => f.style.width = f.dataset.w + '%'));
  });
  const ring = document.getElementById('dayRing');
  ring.style.strokeDashoffset = '326.7';
  requestAnimationFrame(() => requestAnimationFrame(() => ring.style.strokeDashoffset = '124.1'));
}

/* ═══════════════════════════════════════════════
   6) CALENDAR — ตุลาคม 2026 (mockup)
   ═══════════════════════════════════════════════ */
const calHead = document.getElementById('calHead');
['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach(d =>
  calHead.insertAdjacentHTML('beforeend', `<span>${d}</span>`));

const calDays = document.getElementById('calDays');
// ตุลาคม 2026 เริ่มวันพฤหัส (อา->ส) = ช่องว่าง 4 ช่อง, 31 วัน, วันนี้ = 8
for (let i = 0; i < 4; i++) calDays.insertAdjacentHTML('beforeend', '<span class="cal-day dim"></span>');
const doneDays = new Set([1, 2, 3, 4, 6, 7]);           // วันที่ออกกำลังกายแล้ว (mockup)
for (let d = 1; d <= 31; d++) {
  const cls = ['cal-day', d === 8 ? 'today' : '', d < 8 && doneDays.has(d) ? 'done' : ''].join(' ');
  calDays.insertAdjacentHTML('beforeend', `<span class="${cls}">${d}</span>`);
}

/* ═══════════════════════════════════════════════
   7) SOCIAL (mockup)
   ═══════════════════════════════════════════════ */
const friends = [
  { ava: '😎', name: 'Player 2', on: true },
  { ava: '🦊', name: 'Player 3', on: true },
  { ava: '🐼', name: 'Player 4', on: false },
  { ava: '🦁', name: 'Player 1', on: true },
  { ava: '🐯', name: 'Player 5', on: false },
];
document.getElementById('friendsRow').insertAdjacentHTML('beforeend',
  `<div class="friend add"><span class="friend-ava">＋</span><small>เพิ่มเพื่อน</small></div>` +
  friends.map(f => `
    <div class="friend">
      <span class="friend-ava">${f.ava}<i class="${f.on ? 'on' : ''}"></i></span>
      <small>${f.name}</small>
    </div>`).join(''));

const feeds = [
  { ava: '😎', name: 'Player 2', text: 'ออกกำลังกายเสร็จแล้ว! <b>ได้รับ 120 XP</b> 💪', likes: 12, mins: 5 },
  { ava: '🦊', name: 'Player 3', text: 'ขึ้นอันดับเป็น <b>อันดับ 3</b> ของลีกแล้ว 🎉', likes: 8, mins: 24 },
  { ava: '🦁', name: 'Player 1', text: 'ต่อเนื่อง <b>56 วัน</b> ไฟไม่ดับ! 🔥', likes: 21, mins: 60 },
];
document.getElementById('feed').innerHTML = feeds.map(f => `
  <div class="feed-item card">
    <span class="lb-ava">${f.ava}</span>
    <div>
      <h4><b>${f.name}</b> ${f.text}</h4>
      <div class="feed-meta">
        <button class="like-btn">❤️ <span>${f.likes}</span></button>
        <span>🖱️ แสดงความยินดี</span>
        <span>${f.mins} นาทีที่แล้ว</span>
      </div>
    </div>
  </div>`).join('');

document.querySelectorAll('.like-btn').forEach(btn => btn.addEventListener('click', () => {
  const n = btn.querySelector('span');
  const liked = btn.classList.toggle('liked');
  n.textContent = +n.textContent + (liked ? 1 : -1);
  if (liked) n.previousSibling.textContent = '💖 ';
  else n.previousSibling.textContent = '❤️ ';
}));
