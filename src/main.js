import * as THREE from 'three';
import { createTerrain, makeGroundTexture, LANDMARKS } from './terrain.js';
import { createCybertruck, createVehicle } from './truck.js';
import {
  createSky,
  createLights,
  createPhobos,
  createStarship,
  createHabitatPad,
  loadHabitats,
  createRocks,
  createDustDevils,
  updateDustDevils,
  createWheelDust,
  emitDust,
  stepDust,
  createHorizon,
  createMarsEnvMap,
} from './world.js';
import { createChaseCamera } from './camera.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc2744c);
scene.fog = new THREE.FogExp2(0xd4a070, 0.00096);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.15, 3200);
camera.position.set(0, 6, 14);

const { mesh: sky, sunDir } = createSky();
scene.add(sky);
const { sun } = createLights(scene, sunDir);

const groundTex = makeGroundTexture();
const terrain = createTerrain(groundTex);
scene.add(terrain);
scene.add(createHorizon());

new THREE.TextureLoader().load(
  '/textures/mars_dunes.jpg',
  (duneTex) => {
    duneTex.colorSpace = THREE.SRGBColorSpace;
    duneTex.wrapS = duneTex.wrapT = THREE.RepeatWrapping;
    duneTex.repeat.set(3.6, 3.6);
    duneTex.anisotropy = 8;
    // Soft overlay — vertex colors stay in charge, no 28x stamps
    terrain.material.map = duneTex;
    terrain.material.needsUpdate = true;
  }
);

scene.add(createPhobos());
const starship = createStarship();
scene.add(starship);
scene.add(createHabitatPad());
for (const r of createRocks()) scene.add(r);
const devils = createDustDevils();
for (const d of devils) scene.add(d);
const dust = createWheelDust();
scene.add(dust.pts);

let truck, vehicle, chase;
const keys = new Set();
const env = createMarsEnvMap(renderer, sunDir);
scene.environment = env;

loadHabitats(scene);

async function bootTruck() {
  truck = await createCybertruck();
  scene.add(truck.root);
  vehicle = createVehicle(truck);
  chase = createChaseCamera(camera);
  for (const mat of Object.values(truck.materials)) {
    mat.envMap = env;
    mat.needsUpdate = true;
  }
  truck.root.traverse((c) => {
    if (c.isMesh && c.material && 'envMap' in c.material) {
      c.material.envMap = env;
      c.material.needsUpdate = true;
    }
  });
  const idle = { forward: 0, back: 0, left: 0, right: 0, brake: 0, boost: 0 };
  for (let i = 0; i < 10; i++) vehicle.update(1 / 60, idle);
  // Beauty plant: keep the chassis level so stills don't launch the nose.
  vehicle.state.pitch = 0;
  vehicle.state.roll = 0;
  vehicle.vel.set(0, 0, 0);
  truck.root.rotation.z = 0;
  truck.root.rotation.x = 0;
  truck.root.updateMatrixWorld(true);
  chase.update(1, truck.root, 0);
  window.__sim = { vehicle, chase, truck, keys, renderer, camera, scene };
  if (truck.fit) {
    const s = truck.fit.size;
    console.info('[cybertruck] fitted', JSON.stringify(truck.fit));
    const el = document.getElementById('cam-label');
    if (el) el.dataset.fit = `${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`;
  }
}

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'KeyC') {
    document.getElementById('cam-label').textContent = chase.cycle();
  }
  if (e.code === 'KeyR') vehicle.reset();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    chase.onMouse(e.movementX, e.movementY);
  }
});
let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  if (document.pointerLockElement === canvas) return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging && document.pointerLockElement !== canvas) {
    chase.onMouse(e.movementX, e.movementY);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function input() {
  return {
    forward: keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0,
    back: keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0,
    left: keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0,
    right: keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0,
    brake: keys.has('Space') ? 1 : 0,
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0,
  };
}

const speedEl = document.getElementById('speed');
const modeEl = document.getElementById('mode');
const boostEl = document.getElementById('boost-pip');
const clockEl = document.getElementById('clock');
const destEl = document.querySelector('#hud-bottom span:last-child');
const tmp = new THREE.Vector3();

let last = performance.now();
let t = 0;
let hudAcc = 0;

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  t += dt;
  hudAcc += dt;

  const inp = input();
  if (!demo) {
    vehicle.update(dt, inp);
    chase.update(dt, truck.root, vehicle.state.speed);
  }

  sun.target.position.copy(vehicle.pos);
  sun.position.copy(vehicle.pos).add(sunDir.clone().multiplyScalar(420));
  sky.position.copy(vehicle.pos);

  updateDustDevils(devils, t);
  if (vehicle.state.grounded > 0 && vehicle.state.speed > 0.7) {
    const amount = 0.35 + vehicle.state.speed * 0.1;
    for (const w of truck.wheels) {
      w.mesh.getWorldPosition(tmp);
      emitDust(dust, tmp, vehicle.vel, amount);
    }
  }
  stepDust(dust, dt);

  if (hudAcc > 0.08) {
    hudAcc = 0;
    const kmh = vehicle.state.speed * 3.6;
    speedEl.textContent = Math.round(kmh).toString();
    modeEl.textContent = inp.boost ? 'BOOST' : vehicle.state.grounded ? 'PLANT' : 'AIR';
    boostEl.classList.toggle('on', !!inp.boost);
    const hours = 14 + Math.floor((t / 60) % 6);
    const mins = Math.floor((t * 0.8) % 60);
    clockEl.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} LMST`;
    const dx = LANDMARKS.STARSHIP.x - vehicle.pos.x;
    const dz = LANDMARKS.STARSHIP.z - vehicle.pos.z;
    const dist = Math.hypot(dx, dz) / 1000;
    destEl.textContent = `STARSHIP ${dist.toFixed(2)} km`;
  }

  renderer.render(scene, camera);
  if (demo && captureLeft > 0) {
    captureLeft -= 1;
    if (captureLeft === 0) {
      postShot();
    }
  }
  requestAnimationFrame(tick);
}

const demo = new URLSearchParams(location.search).get('demo');
function setupDemo() {
if (demo) {
  const boot = document.getElementById('boot');
  if (boot) boot.remove();
  const p = vehicle.pos;
  const yaw = vehicle.state.yaw;
  if (demo === 'chase') {
    chase.look.yaw = 0.58;
    chase.look.pitch = 0.16;
    {
      const back = 3.3;
      const side = 6.9;
      camera.position.set(
        p.x - Math.cos(yaw) * back + Math.sin(yaw) * side,
        p.y + 1.72,
        p.z - Math.sin(yaw) * back - Math.cos(yaw) * side
      );
      camera.lookAt(p.x + Math.cos(yaw) * 0.5, p.y + 0.62, p.z + Math.sin(yaw) * 0.5);
    }
  } else if (demo === 'hood') {
    document.getElementById('cam-label').textContent = chase.cycle();
    camera.position.set(p.x - Math.cos(yaw) * 0.2, p.y + 1.48, p.z - Math.sin(yaw) * 0.2);
    camera.lookAt(p.x + Math.cos(yaw) * 3.6, p.y + 0.22, p.z + Math.sin(yaw) * 3.6);
  } else if (demo === 'orbit') {
    chase.look.mode = 2;
    chase.look.yaw = 0.85;
    chase.look.pitch = 0.2;
    document.getElementById('cam-label').textContent = 'ORBIT';
    camera.position.set(p.x - 3.2, p.y + 3.2, p.z + 7.6);
    camera.lookAt(p.x + 0.2, p.y + 0.7, p.z);
  } else if (demo === 'drive') {
    const inp = { forward: 1, back: 0, left: 0, right: 0, brake: 0, boost: 1 };
    keys.add('KeyW');
    keys.add('ShiftLeft');
    chase.look.yaw = 0.62;
    chase.look.pitch = 0.12;
    for (let i = 0; i < 200; i++) {
      vehicle.update(1 / 60, inp);
      if (i % 3 === 0) {
        for (const w of truck.wheels) {
          w.mesh.getWorldPosition(tmp);
          emitDust(dust, tmp, vehicle.vel, 1.4);
        }
      }
      stepDust(dust, 1 / 60);
    }
    const q = vehicle.pos;
    camera.position.set(q.x - 6.2, q.y + 3.0, q.z + 5.4);
    camera.lookAt(q.x + 0.5, q.y + 0.7, q.z);
  } else if (demo === 'wide') {
    chase.look.mode = 2;
    chase.look.yaw = 0.18;
    chase.look.pitch = 0.22;
    document.getElementById('cam-label').textContent = 'ORBIT';
    camera.position.set(p.x - 16.2, p.y + 7.4, p.z + 11.5);
    camera.lookAt(p.x + 5.0, p.y + 0.4, p.z + 2.0);
  } else if (demo === 'side') {
    const rightX = Math.sin(yaw);
    const rightZ = -Math.cos(yaw);
    camera.position.set(p.x + rightX * 8.6, p.y + 1.28, p.z + rightZ * 8.6);
    camera.lookAt(p.x, p.y + 0.72, p.z);
  } else if (demo === 'hills') {
    vehicle.pos.set(178, 20, 58);
    vehicle.state.yaw = 1.15;
    vehicle.plantNow();
    const q = vehicle.pos;
    camera.position.set(q.x - 5.8, q.y + 4.4, q.z - 8.4);
    camera.lookAt(q.x + 6.5, q.y - 0.4, q.z + 11.0);
  }
}
}

let captureLeft = demo ? 12 : 0;
function postShot() {
  try {
    renderer.render(scene, camera);
    const data = canvas.toDataURL('image/png');
    fetch('http://127.0.0.1:8899', { method: 'POST', body: 'v5_' + demo + '.png|' + data, mode: 'cors' })
      .then((r) => console.log('shot posted', r.status))
      .catch((e) => console.error('shot post fail', e));
  } catch (e) {
    console.error('shot capture fail', e);
  }
}

async function start() {
  await bootTruck();
  if (demo) {
    renderer.setPixelRatio(1);
    renderer.setSize(1280, 720);
    camera.aspect = 1280 / 720;
    camera.updateProjectionMatrix();
  }
  setupDemo();
  renderer.render(scene, camera);
  if (demo) postShot();
  document.getElementById('boot')?.classList.add('hide');
  setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
  }, demo ? 0 : 1100);
  requestAnimationFrame(tick);
}
start().catch((e) => {
  console.error('[cybertruck] boot failed', e);
  fetch('http://127.0.0.1:8899', { method: 'POST', body: 'v5_error.txt|' + String(e && e.stack || e) }).catch(() => {});
});
