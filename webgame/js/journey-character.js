import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// One still render reuses the game's character; CSS supplies its idle motion.
export async function createJourneyCharacter(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(110, 150, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 110 / 150, .1, 30);
  camera.position.set(0, 1, 3.8);
  camera.lookAt(0, .8, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7c9170, 2.8));
  const sunlight = new THREE.DirectionalLight(0xffedcf, 3.2);
  sunlight.position.set(-3, 5, 4);
  scene.add(sunlight);
  try {
    const { scene: model } = await new GLTFLoader().loadAsync('assets/changrid_fat.glb');
    const box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(1.65 / box.getSize(new THREE.Vector3()).y);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    const group = new THREE.Group();
    group.add(model);
    group.rotation.y = -.25;
    scene.add(group);
    renderer.render(scene, camera);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}
