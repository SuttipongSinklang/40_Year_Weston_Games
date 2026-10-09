import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export function initializeScene({ onWorkout, onReady, onError }) {
const canvas = document.getElementById('scene3d');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fdcf5, 14, 34);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 1.32, 4.25);
camera.lookAt(0, 0.9, 0);

/* แสง */
scene.add(new THREE.HemisphereLight(0xcdeeff, 0x6fbf73, 1.15));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.7);
sun.position.set(4, 7, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -7; sun.shadow.camera.right = 7;
sun.shadow.camera.top = 7;  sun.shadow.camera.bottom = -7;
scene.add(sun);

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

/* ── โมเดลตัวละคร (GLB จาก folder) ── */
let character = null;          // group ที่หมุน/เด้งได้
let baseY = 0;                 // ความสูงเท้าแช่พื้น
let vy = 0;                    // ความเร็วแกน Y ตอนกระโดด
const GRAV = 22;

const loaderEl = document.getElementById('loader');
function hideLoader() { loaderEl.classList.add('done'); loaderEl.setAttribute('aria-hidden', 'true'); }
const modelTimeout = setTimeout(() => { hideLoader(); onError(); }, 25000);
new GLTFLoader().load(
  'assets/character.glb',
  (gltf) => {
    clearTimeout(modelTimeout);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.58 / size.y;                      // ทำให้สูง ~1.58 หน่วย
    model.scale.setScalar(scale);
    box.setFromObject(model);
    baseY = -box.min.y;                               // ยกเท้าให้แตะพื้น
    model.position.y = baseY;
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

    character = new THREE.Group();
    character.add(model);
    scene.add(character);
    hideLoader();
    onReady();
  },
  undefined,
  () => { clearTimeout(modelTimeout); hideLoader(); onError(); }
);

/* ── อินเทอร์แอ็กชัน: ลาก = หมุน, แตะ = กระโดด +1 ── */
let dragging = false, moved = false, lastX = 0, startX = 0, startY = 0, lastInput = performance.now();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function hitCharacter(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return character && raycaster.intersectObject(character, true).length > 0;
}

canvas.addEventListener('pointerdown', e => {
  dragging = true; moved = false; lastX = e.clientX;
  startX = e.clientX; startY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging || !character) return;
  const dx = e.clientX - lastX;
  if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) moved = true;
  character.rotation.y += dx * 0.012;
  lastX = e.clientX;
  lastInput = performance.now();
});
canvas.addEventListener('pointercancel', () => { dragging = false; moved = true; });
canvas.addEventListener('pointerup', e => {
  dragging = false;
  lastInput = performance.now();
  if (!moved && hitCharacter(e)) onWorkout(e);
});
canvas.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
    e.preventDefault(); if (character) onWorkout();
  }
});

/* ── Game loop ── */
const clock = new THREE.Clock();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let previousTime = 0;
function tick() {
  requestAnimationFrame(tick);
  const t = clock.getElapsedTime();
  const dt = Math.min(t - previousTime, 0.05);
  previousTime = t;
  if (document.hidden || !canvas.closest('.screen').classList.contains('active')) return;

  if (character) {
    // หมุนช้า ๆ เมื่อไม่ได้แตะนาน 3 วิ
    if (!reducedMotion.matches && performance.now() - lastInput > 3000) character.rotation.y += 0.24 * dt;
    // ฟิสิกส์กระโดด
    vy -= GRAV * dt;
    character.position.y += vy * dt;
    if (character.position.y <= 0) {
      if (vy < -6) squash();
      character.position.y = 0; vy = 0;
    }
    // หายใจเบา ๆ ตอนยืน
    const breathe = 1 + (reducedMotion.matches ? 0 : Math.sin(t * 2.2) * 0.008);
    character.scale.set(2 - breathe, breathe, 2 - breathe);
  }
  renderer.render(scene, camera);
}
tick();

function squash() {
  character.scale.set(1.14, 0.84, 1.14);
}

/* ── Resize ── */
function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.position.z = camera.aspect < 0.6 ? 4.1 : 3.6;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();


return { jump() { if (!reducedMotion.matches) vy = 7.2; lastInput = performance.now(); } };
}
