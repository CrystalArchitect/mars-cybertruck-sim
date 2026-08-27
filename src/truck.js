import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt, normalAt, HALF } from './terrain.js';

const MARS_G = 3.71;
const MASS = 3100;
const WHEELBASE = 3.72;
const TRACK = 1.86;
const WHEEL_R = 0.46;
const REST = 0.5;
const SUSP_MAX = 0.95;
const SPRING = 86000;
const DAMPER = 11200;
const PRELOAD = (MASS * MARS_G) / 4;
const ENGINE = 17200;
const BOOST = 14800;
const BRAKE = 22000;
const DRAG = 0.028;
const ROLL = 1.45;
const STEER_MAX = 0.54;
const CRUISE = 25;
const BOOST_V = 36.2;

const TARGET_LEN = 5.7;
const TARGET_WID = 2.2;
const TARGET_HGT = 1.8;

export async function createCybertruck() {
  const root = new THREE.Group();
  root.name = 'cybertruck';

  const mats = makeMaterials();

  const loader = new GLTFLoader();
  const res = await fetch('/models/cybertruck.glb');
  if (!res.ok) throw new Error(`cybertruck.glb HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1000) throw new Error(`cybertruck.glb too small: ${buf.byteLength}`);
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(buf, '/models/', resolve, reject);
  });
  const model = gltf.scene;
  model.name = 'cybertruck-glb';

  const tireMeshes = [];
  const rimMeshes = [];
  let frontHintZ = 0;

  model.updateMatrixWorld(true);
  model.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = true;
    c.receiveShadow = true;
    const n = `${c.name || ''} ${c.parent?.name || ''} ${c.material?.name || ''}`.toLowerCase();
    if (n.includes('window')) {
      c.material = mats.glass;
    } else if (n.includes('tire') || n.includes('protector')) {
      c.material = mats.rubber;
      tireMeshes.push(c);
    } else if (n.includes('rims')) {
      c.material = mats.rim;
      rimMeshes.push(c);
    } else if (n.includes('frontlight')) {
      c.material = mats.light;
      const b = new THREE.Box3().setFromObject(c);
      frontHintZ = (b.min.z + b.max.z) * 0.5;
    } else if (n.includes('rearlight')) {
      c.material = mats.rearLight;
    } else if (n.includes('sideligt') || n.includes('sidelight')) {
      c.material = mats.sideLight;
    } else if (
      n.includes('arch') ||
      n.includes('bumper') ||
      n.includes('grid') ||
      n.includes('border')
    ) {
      c.material = mats.well;
    } else {
      c.material = mats.steel;
    }
  });

  // Hide fused L+R wheel meshes — they cannot steer independently.
  // Procedural aero wheels drop into the same wells. No double wheels.
  for (const m of [...tireMeshes, ...rimMeshes]) m.visible = false;

  model.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(model);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawLen = Math.max(rawSize.x, rawSize.z);
  const scale = TARGET_LEN / rawLen;

  const wrap = new THREE.Group();
  wrap.name = 'glb-fit';
  wrap.add(model);
  wrap.scale.setScalar(scale);
  // Sketchfab Y-up: +Z is the nose (front light). Drive math wants +X forward.
  wrap.rotation.y = frontHintZ >= 0 ? Math.PI / 2 : -Math.PI / 2;
  wrap.updateMatrixWorld(true);

  const fitBox = new THREE.Box3().setFromObject(wrap);
  const fitCenter = fitBox.getCenter(new THREE.Vector3());
  wrap.position.x -= fitCenter.x;
  wrap.position.z -= fitCenter.z;
  wrap.position.y -= fitBox.min.y + WHEEL_R;
  wrap.updateMatrixWorld(true);
  root.add(wrap);

  const offsets = measureWheelOffsets(tireMeshes, root);
  const wheels = [];
  for (const o of offsets) {
    const built = buildWheel(mats.rubber, mats.rim, mats.spoke);
    built.steer.position.set(o.x, 0, o.z);
    root.add(built.steer);
    wheels.push({
      mesh: built.steer,
      spinG: built.spin,
      offset: o,
      spin: 0,
      steer: 0,
      compression: 0,
      lastLen: REST,
    });
  }

  root.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = finalBox.getSize(new THREE.Vector3());
  const fit = {
    scale,
    rawSize: { x: rawSize.x, y: rawSize.y, z: rawSize.z },
    size: { x: finalSize.x, y: finalSize.y, z: finalSize.z },
    min: { x: finalBox.min.x, y: finalBox.min.y, z: finalBox.min.z },
    max: { x: finalBox.max.x, y: finalBox.max.y, z: finalBox.max.z },
    yaw: wrap.rotation.y,
    offsets,
  };
  console.info('[cybertruck] GLB fitted', fit);

  return { root, wheels, materials: mats, fit };
}

function measureWheelOffsets(tireMeshes, root) {
  const tmp = new THREE.Vector3();
  const axles = [];
  for (const m of tireMeshes) {
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(tmp);
    root.worldToLocal(c);
    const size = box.getSize(new THREE.Vector3());
    // After +90° Y, width is along Z. Each fused mesh is both L and R.
    const halfW = size.z * 0.5;
    const tireHalf = Math.min(0.18, halfW * 0.22);
    const trackHalf = THREE.MathUtils.clamp(halfW - tireHalf, 0.78, 1.05);
    axles.push({ x: c.x, track: trackHalf });
  }
  if (axles.length < 2) {
    return [
      { x: WHEELBASE * 0.5, z: TRACK * 0.5 },
      { x: WHEELBASE * 0.5, z: -TRACK * 0.5 },
      { x: -WHEELBASE * 0.5, z: TRACK * 0.5 },
      { x: -WHEELBASE * 0.5, z: -TRACK * 0.5 },
    ];
  }
  axles.sort((a, b) => b.x - a.x);
  const front = axles[0];
  const rear = axles[axles.length - 1];
  // Same order as the old procedural truck: FL, FR, RL, RR (+X fwd, +Z left)
  return [
    { x: front.x, z: front.track },
    { x: front.x, z: -front.track },
    { x: rear.x, z: rear.track },
    { x: rear.x, z: -rear.track },
  ];
}

function makeMaterials() {
  // No canvas maps on the GLB — its UVs turn a brush texture into tailgate static.
  const steel = new THREE.MeshPhysicalMaterial({
    color: 0xd4d8e0,
    metalness: 0.95,
    roughness: 0.2,
    envMapIntensity: 2.05,
    clearcoat: 0.1,
    clearcoatRoughness: 0.38,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a0c10,
    metalness: 0.35,
    roughness: 0.06,
    envMapIntensity: 1.9,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.04,
    roughness: 0.9,
  });
  const rim = new THREE.MeshPhysicalMaterial({
    color: 0xc9ced4,
    metalness: 0.88,
    roughness: 0.26,
    envMapIntensity: 1.35,
  });
  const spoke = new THREE.MeshPhysicalMaterial({
    color: 0xb7bcc2,
    metalness: 0.9,
    roughness: 0.22,
    envMapIntensity: 1.3,
  });
  const well = new THREE.MeshStandardMaterial({
    color: 0x14161a,
    metalness: 0.18,
    roughness: 0.82,
  });
  const light = new THREE.MeshStandardMaterial({
    color: 0xfff6de,
    emissive: 0xffe4b0,
    emissiveIntensity: 3.2,
    roughness: 0.22,
    metalness: 0.12,
  });
  const rearLight = new THREE.MeshStandardMaterial({
    color: 0x2a0404,
    emissive: 0xff2418,
    emissiveIntensity: 2.4,
    roughness: 0.3,
  });
  const sideLight = new THREE.MeshStandardMaterial({
    color: 0x2a1400,
    emissive: 0xff7a10,
    emissiveIntensity: 2.2,
    roughness: 0.35,
  });
  return { steel, glass, rubber, rim, spoke, well, light, rearLight, sideLight };
}

function buildWheel(tireMat, rimMat, spokeMat) {
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);

  const aligned = new THREE.Group();
  aligned.rotation.x = Math.PI / 2;
  spin.add(aligned);

  const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.33, 32), tireMat);
  tire.castShadow = true;
  aligned.add(tire);

  const sidewall = new THREE.Mesh(new THREE.CylinderGeometry(0.41, WHEEL_R, 0.1, 32), tireMat);
  sidewall.position.y = 0.12;
  aligned.add(sidewall);
  const sidewall2 = sidewall.clone();
  sidewall2.position.y = -0.12;
  aligned.add(sidewall2);

  // Stainless aero cover — closer to factory Cybersteel than a 6-spoke toy
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.385, 0.385, 0.055, 32), rimMat);
  cover.position.y = 0.13;
  cover.castShadow = true;
  aligned.add(cover);
  const coverIn = cover.clone();
  coverIn.position.y = -0.13;
  aligned.add(coverIn);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 16), spokeMat);
  aligned.add(hub);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.03, 0.16), spokeMat);
    slot.position.set(Math.cos(a) * 0.22, 0.145, Math.sin(a) * 0.22);
    slot.rotation.y = -a;
    aligned.add(slot);
  }

  return { steer, spin };
}

export function createVehicle(truck) {
  const pos = new THREE.Vector3(0, 8, 0);
  const vel = new THREE.Vector3();
  const state = {
    pos,
    vel,
    yaw: 0.15,
    yawRate: 0,
    pitch: 0,
    roll: 0,
    grounded: 0,
    speed: 0,
    boosting: false,
    wheels: truck.wheels,
    longAcc: 0,
  };

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const force = new THREE.Vector3();
  const avgN = new THREE.Vector3();
  const worldWheel = new THREE.Vector3();

  function plantWheels() {
    fwd.set(Math.cos(state.yaw), 0, Math.sin(state.yaw));
    right.set(fwd.z, 0, -fwd.x);
    for (const w of state.wheels) {
      const wx = pos.x + fwd.x * w.offset.x + right.x * w.offset.z;
      const wz = pos.z + fwd.z * w.offset.x + right.z * w.offset.z;
      worldWheel.set(wx, heightAt(wx, wz) + WHEEL_R, wz);
      w.mesh.parent.worldToLocal(worldWheel);
      w.mesh.position.set(w.offset.x, THREE.MathUtils.clamp(worldWheel.y, -0.3, 0.2), w.offset.z);
      w.mesh.rotation.y = 0;
    }
  }

  function reset() {
    state.yaw = 0.35;
    state.yawRate = 0;
    vel.set(0, 0, 0);
    fwd.set(Math.cos(state.yaw), 0, Math.sin(state.yaw));
    right.set(fwd.z, 0, -fwd.x);
    let gy = -Infinity;
    for (const w of state.wheels) {
      const wx = fwd.x * w.offset.x + right.x * w.offset.z;
      const wz = 8 + fwd.z * w.offset.x + right.z * w.offset.z;
      gy = Math.max(gy, heightAt(wx, wz));
      w.lastLen = REST;
      w.spin = 0;
      w.compression = 0;
    }
    pos.set(0, gy + REST, 8);
    // Plant flat — seeding pitch from a 4-sample normal launched the chassis.
    state.pitch = 0;
    state.roll = 0;
    state.speed = 0;
    state.grounded = 4;
    state.longAcc = 0;
    truck.root.position.copy(pos);
    truck.root.rotation.order = 'YZX';
    truck.root.rotation.y = state.yaw;
    truck.root.rotation.z = 0;
    truck.root.rotation.x = 0;
    truck.root.updateMatrixWorld(true);
    plantWheels();
  }

  function update(dt, input) {
    dt = Math.min(dt, 1 / 30);
    fwd.set(Math.cos(state.yaw), 0, Math.sin(state.yaw));
    right.set(fwd.z, 0, -fwd.x);

    const speed01 = Math.min(state.speed / CRUISE, 1);
    const steerTarget = (input.left - input.right) * STEER_MAX * (1 - speed01 * 0.42);
    const steer = steerTarget;

    force.set(0, -MARS_G * MASS, 0);

    let grounded = 0;
    avgN.set(0, 0, 0);

    const contacts = [];
    for (let i = 0; i < state.wheels.length; i++) {
      const w = state.wheels[i];
      const front = i < 2;
      const wx = pos.x + fwd.x * w.offset.x + right.x * w.offset.z;
      const wz = pos.z + fwd.z * w.offset.x + right.z * w.offset.z;
      const groundY = heightAt(wx, wz);
      const n = normalAt(wx, wz);
      const hubY = pos.y + w.offset.x * Math.sin(state.pitch) - w.offset.z * Math.sin(state.roll);
      const length = hubY - groundY;
      const compressed = length < SUSP_MAX;
      let comp = 0;
      if (compressed) {
        const travel = THREE.MathUtils.clamp(REST - length, -0.22, 0.26);
        const vRel = (w.lastLen - length) / Math.max(dt, 1e-4);
        const springF = travel * SPRING + PRELOAD;
        const dampF = THREE.MathUtils.clamp(vRel * DAMPER, -24000, 24000);
        const susp = springF + dampF;
        force.y += susp;
        force.addScaledVector(n, Math.max(susp, 0) * 0.1);
        grounded++;
        avgN.add(n);
        comp = THREE.MathUtils.clamp(travel / 0.18, -0.25, 1.15);
      }
      w.lastLen = length;
      w.compression = comp;
      w.steer = front ? steer : 0;
      contacts.push({ w, wx, wz, groundY, compressed, front });
    }

    state.grounded = grounded;
    const longVel = vel.dot(fwd);
    let driveF = 0;
    let brakeF = 0;

    if (grounded > 0) {
      avgN.multiplyScalar(1 / grounded).normalize();

      const throttle = (input.forward - input.back) * (input.boost ? ENGINE + BOOST : ENGINE);
      brakeF = input.brake ? BRAKE : 0;

      if (input.brake) {
        driveF = -Math.sign(longVel || 1) * brakeF;
        force.addScaledVector(fwd, driveF);
      } else {
        driveF = throttle;
        force.addScaledVector(fwd, driveF);
      }

      const latVel = vel.dot(right);
      const grip = 6400 * (0.78 + 0.22 * avgN.y) * (input.boost ? 0.8 : 1);
      force.addScaledVector(right, -latVel * grip);

      // Light Mars rolling resistance — coasts, does not glue to wet sand
      force.addScaledVector(fwd, -longVel * ROLL * MASS * 0.01);

      const steerForce = steer * (1.2 + Math.min(Math.abs(longVel), 18)) * 1550;
      state.yawRate += (steerForce / (MASS * 1.65) - state.yawRate * 3.1) * dt;
    } else {
      state.yawRate *= 1 - 0.2 * dt;
    }

    // Thin CO2 aero — almost nothing at road speeds
    force.addScaledVector(vel, -DRAG * vel.length());

    const acc = force.multiplyScalar(1 / MASS);
    vel.addScaledVector(acc, dt);

    const cap = input.boost ? BOOST_V : CRUISE;
    const hVel = Math.hypot(vel.x, vel.z);
    if (hVel > cap) {
      const s = cap / hVel;
      vel.x *= s;
      vel.z *= s;
    }

    pos.addScaledVector(vel, dt);
    state.yaw += state.yawRate * dt;
    state.speed = Math.hypot(vel.x, vel.z);
    state.boosting = !!input.boost && input.forward > 0;
    state.longAcc = acc.x * fwd.x + acc.z * fwd.z;

    if (grounded >= 2) {
      const terrainPitch = Math.atan2(-avgN.dot(fwd), avgN.y);
      const terrainRoll = Math.atan2(avgN.dot(right), avgN.y);
      const squat = THREE.MathUtils.clamp(state.longAcc * 0.02, -0.12, 0.1);
      const lean = THREE.MathUtils.clamp(
        -state.yawRate * Math.min(state.speed, 28) * 0.014,
        -0.16,
        0.16
      );
      const k = 1 - Math.pow(0.0015, dt);
      const settle = THREE.MathUtils.clamp(0.18 + state.speed / 8, 0.18, 1);
      state.pitch = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(state.pitch, terrainPitch + squat, k * settle),
        -0.42,
        0.42
      );
      state.roll = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(state.roll, terrainRoll + lean, k * settle),
        -0.32,
        0.32
      );
    } else {
      state.pitch = THREE.MathUtils.lerp(state.pitch, 0, dt * 0.55);
      state.roll = THREE.MathUtils.lerp(state.roll, 0, dt * 0.55);
    }

    if (Math.abs(pos.x) > HALF - 30 || Math.abs(pos.z) > HALF - 30) {
      pos.x = THREE.MathUtils.clamp(pos.x, -HALF + 30, HALF - 30);
      pos.z = THREE.MathUtils.clamp(pos.z, -HALF + 30, HALF - 30);
      vel.x *= -0.2;
      vel.z *= -0.2;
    }
    if (pos.y < -80) reset();

    truck.root.position.copy(pos);
    truck.root.rotation.order = 'YZX';
    truck.root.rotation.y = state.yaw;
    truck.root.rotation.z = state.pitch;
    truck.root.rotation.x = state.roll;
    truck.root.updateMatrixWorld(true);

    for (const c of contacts) {
      const { w, wx, wz, groundY, compressed } = c;
      if (compressed) {
        worldWheel.set(wx, groundY + WHEEL_R, wz);
        w.mesh.parent.worldToLocal(worldWheel);
        // Lock X/Z to the design track — worldToLocal was flinging wheels outboard.
        w.mesh.position.set(w.offset.x, THREE.MathUtils.clamp(worldWheel.y, -0.3, 0.2), w.offset.z);
      } else {
        w.mesh.position.set(w.offset.x, -0.28, w.offset.z);
      }
      w.mesh.rotation.y = w.steer;
      const wheelDir = w.steer;
      const long =
        vel.x * Math.cos(state.yaw + wheelDir) + vel.z * Math.sin(state.yaw + wheelDir);
      w.spin += (long / WHEEL_R) * dt;
      w.spinG.rotation.z = -w.spin;
    }
  }

  function plantNow() {
    fwd.set(Math.cos(state.yaw), 0, Math.sin(state.yaw));
    right.set(fwd.z, 0, -fwd.x);
    let gy = -Infinity;
    avgN.set(0, 0, 0);
    for (const w of state.wheels) {
      const wx = pos.x + fwd.x * w.offset.x + right.x * w.offset.z;
      const wz = pos.z + fwd.z * w.offset.x + right.z * w.offset.z;
      gy = Math.max(gy, heightAt(wx, wz));
      avgN.add(normalAt(wx, wz));
      w.lastLen = REST;
      w.compression = 0;
    }
    avgN.normalize();
    pos.y = gy + REST;
    vel.set(0, 0, 0);
    state.pitch = THREE.MathUtils.clamp(Math.atan2(-avgN.dot(fwd), avgN.y), -0.22, 0.22);
    state.roll = THREE.MathUtils.clamp(Math.atan2(avgN.dot(right), avgN.y), -0.16, 0.16);
    state.speed = 0;
    state.yawRate = 0;
    state.grounded = 4;
    state.longAcc = 0;
    truck.root.position.copy(pos);
    truck.root.rotation.order = 'YZX';
    truck.root.rotation.y = state.yaw;
    truck.root.rotation.z = state.pitch;
    truck.root.rotation.x = state.roll;
    truck.root.updateMatrixWorld(true);
    plantWheels();
  }

  reset();
  return { state, update, reset, plantNow, pos, vel };
}
