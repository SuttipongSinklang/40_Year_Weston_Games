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
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3f2, 10, 34);  // หมอกบรรยากาศ: ของไกลจางแบบธรรมชาติ

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

/* ── แสงกลางแจ้งแบบธรรมชาติ: แสงจากท้องฟ้า + แดด + แสงเติมบาง ๆ ── */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// แสงกระจายจากท้องฟ้า/พื้นดิน — เงานุ่มเหมือนกลางแจ้งจริง
scene.add(new THREE.HemisphereLight(0xbfe5ff, 0x7cbf7a, 0.75));

// แสงหลัก (key) ขาวนุ่มจากบน-หน้า-ซ้าย ตามโทนรูปอ้างอิง
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(-3.5, 5.5, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -5; sun.shadow.camera.right = 5;
sun.shadow.camera.top = 5;  sun.shadow.camera.bottom = -5;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// แสงเติมจากท้องฟ้าฝั่งตรงข้าม (บางเบา)
const fill = new THREE.DirectionalLight(0xd6ecff, 0.5);
fill.position.set(4, 3.5, 2.5);
scene.add(fill);

// แสงขอบ (rim) เย็นบาง ๆ จากด้านหลัง ให้ตัวละครเด่นแยกจากพื้นหลัง
const rim = new THREE.DirectionalLight(0xbfe3f2, 0.6);
rim.position.set(-1.5, 4, -5);
scene.add(rim);

/* ── พื้นหญ้า + ทางเดิน (mockup สวน) ── */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 56),
  new THREE.MeshStandardMaterial({ color: 0x58c169, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const path = new THREE.Mesh(
  new THREE.PlaneGeometry(1.7, 9),
  new THREE.MeshStandardMaterial({ color: 0xecd9a8, roughness: 1 })
);
path.rotation.x = -Math.PI / 2;
path.position.set(0, 0.01, 3.4);
path.receiveShadow = true;
scene.add(path);

/* ── เนินเขาไกล ๆ (โดนหมอกเบลอจางแบบธรรมชาติ) ── */
[[-13, -17, 11, 3.4, 0x7fbf9a],
 [  0, -20, 14, 4.2, 0x8fcba8],
 [ 13, -18, 10, 3.0, 0x76b894],
 [-24, -21, 12, 3.8, 0x89c6a2]].forEach(([x, z, r, h, c]) => {
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(r, 24, 16),
    new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
  );
  hill.scale.y = h / r;
  hill.position.set(x, 0, z);
  scene.add(hill);
});

/* ── เงาสัมผัสใต้ตัวละคร (ให้ยืนแนบพื้น ไม่เหมือนลอย) ── */
const contactShadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(18,58,30,.38)');
  grad.addColorStop(1, 'rgba(18,58,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.95),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.015;
  mesh.renderOrder = 1;
  return mesh;
})();
scene.add(contactShadow);

/* หญ้าพุ่มเล็ก ๆ กระจาย (ให้เข้าในกรอบจอแนวตัั้ง) */
const tuftGeo = new THREE.ConeGeometry(0.09, 0.22, 5);
const tuftMat = new THREE.MeshStandardMaterial({ color: 0x3fae52, roughness: 1 });
[[-0.75, 0.4], [0.8, 0.2], [-0.5, -1.4], [0.55, -1.1], [-0.9, 2.2], [0.7, 2.6], [-0.35, 3.3]]
  .forEach(([x, z]) => {
    const t = new THREE.Mesh(tuftGeo, tuftMat);
    t.position.set(x, 0.1, z);
    t.rotation.y = Math.random() * Math.PI;
    t.castShadow = true;
    scene.add(t);
  });

/* ── ต้นไม้การ์ตูน ── */
function makeTree(x, z, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * s, 0.13 * s, 0.7 * s, 8),
    new THREE.MeshStandardMaterial({ color: 0x9a6b4f, roughness: 1 })
  );
  trunk.position.y = 0.35 * s;
  trunk.castShadow = true;
  g.add(trunk);
  [[0, 0.95, 0, 0.52], [0.3, 0.72, 0.12, 0.38], [-0.28, 0.78, -0.1, 0.34]].forEach(([ox, oy, oz, r]) => {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(r * s, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x4cc45f, roughness: .95 })
    );
    leaf.position.set(ox * s, oy * s, oz * s);
    leaf.castShadow = true;
    g.add(leaf);
  });
  g.position.set(x, 0, z);
  return g;
}
scene.add(makeTree(-0.95, -1.15, 1.2));
scene.add(makeTree(1.0, -1.9, 1.0));
scene.add(makeTree(-0.78, -2.7, 0.85));
scene.add(makeTree(1.18, -0.45, 0.95));

/* ── ม้านั่ง (mockup) ── */
const bench = new THREE.Group();
const woodMat = new THREE.MeshStandardMaterial({ color: 0xc98a5b, roughness: .9 });
const legMat = new THREE.MeshStandardMaterial({ color: 0x5b7191, roughness: .8 });
const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.42), woodMat);
seat.position.y = 0.42; seat.castShadow = true; bench.add(seat);
const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 0.07), woodMat);
back.position.set(0, 0.66, -0.19); back.castShadow = true; bench.add(back);
[[-0.55], [0.55]].forEach(([ox]) => {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.36), legMat);
  leg.position.set(ox, 0.21, 0); bench.add(leg);
});
bench.position.set(1.05, 0, 0.75);
bench.rotation.y = -0.55;
bench.scale.setScalar(0.9);
scene.add(bench);

// คุมความเข้ม environment ของของในฉาก ให้สีการ์ตูนยังสดอยู่
scene.traverse(o => {
  if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.2;
});

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
  camera.lookAt(0, 0.85, 0);
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
   3) GAME LOGIC — ภารกิจ / XP / Streak (mockup)
   ═══════════════════════════════════════════════ */
const missions = [
  'ออกกำลังกายกับตัวละคร 5 ครั้ง',
  'เผาผลาญแคลอรี 5 ครั้ง',
  'เล่นเกมยืดเหยียด 5 ครั้ง',
  'สะสมแตะตัวละคร 5 ครั้ง',
];
let mIdx = 0, mDone = 2, mTotal = 5;
let xp = 82;

const missionDone = document.getElementById('missionDone');
const missionTotal = document.getElementById('missionTotal');
const missionFill = document.getElementById('missionFill');
const missionName = document.getElementById('missionName');
const xpFill = document.getElementById('xpFill');

function updateMission() {
  missionDone.textContent = mDone;
  missionTotal.textContent = mTotal;
  missionFill.style.width = (mDone / mTotal * 100) + '%';
}
updateMission();
xpFill.style.width = xp + '%';

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

  // XP
  xp = Math.min(100, xp + 6);
  xpFill.style.width = xp + '%';
  if (xp >= 100) { setTimeout(() => { toast('เลเวลอัป! 🎉 Lv.6'); xp = 10; xpFill.style.width = xp + '%'; }, 600); }

  // ภารกิจ
  if (mDone < mTotal) {
    mDone++;
    updateMission();
    if (mDone === mTotal) {
      setTimeout(() => {
        toast('ภารกิจสำเร็จ! รับ +100 XP 🎉');
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

document.getElementById('lbPerson').insertAdjacentHTML('beforeend', players.map((p, i) => `
  <div class="lb-row ${p.you ? 'you' : ''}">
    <div class="lb-rank">
      <span class="rank-badge ${i < 3 ? 'rank-' + (i + 1) : ''}">
        ${i < 3 ? '<span class="crown">👑</span>' : ''}${i + 1}
      </span>
    </div>
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
    <div class="lb-rank">
      <span class="rank-badge ${i < 3 ? 'rank-' + (i + 1) : ''}">
        ${i < 3 ? '<span class="crown">👑</span>' : ''}${i + 1}
      </span>
    </div>
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
