import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { heightAt, pickRockPoints, LANDMARKS } from './terrain.js';
import { hash2, simplex2 } from './noise.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(wp.xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
uniform vec3 uSun;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uGround, uHorizon, smoothstep(0.0, 0.42, t));
  col = mix(col, uZenith, smoothstep(0.38, 0.95, t));

  // Dust haze brightening near the sun
  float sun = pow(max(dot(d, normalize(uSun)), 0.0), 28.0);
  col += vec3(1.0, 0.72, 0.38) * sun * 0.85;
  float glow = pow(max(dot(d, normalize(uSun)), 0.0), 4.0);
  col += vec3(0.95, 0.55, 0.28) * glow * 0.22;

  // Tiny hard solar disc
  float disc = smoothstep(0.9994, 0.99985, dot(d, normalize(uSun)));
  col += vec3(1.0, 0.92, 0.7) * disc * 3.5;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  const sunDir = new THREE.Vector3(0.62, 0.28, 0.38).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir },
      uZenith: { value: new THREE.Color(0xb85a3c) },
      uHorizon: { value: new THREE.Color(0xf3c490) },
      uGround: { value: new THREE.Color(0x7a3e24) },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 20), mat);
  mesh.frustumCulled = false;
  return { mesh, sunDir };
}

const ENV_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ENV_FRAG = `
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 ground = vec3(0.16, 0.07, 0.04);
  vec3 horizon = vec3(0.98, 0.70, 0.42);
  vec3 zenith = vec3(0.42, 0.20, 0.14);
  vec3 anti = vec3(0.10, 0.05, 0.04);
  vec3 col = mix(ground, horizon, smoothstep(-0.12, 0.22, h));
  col = mix(col, zenith, smoothstep(0.18, 0.92, h));
  float away = 0.5 - 0.5 * dot(normalize(d.xz + vec2(1e-4)), normalize(uSun.xz));
  col = mix(col, anti, away * 0.55 * (1.0 - smoothstep(0.0, 0.35, h)));
  float sun = pow(max(dot(d, normalize(uSun)), 0.0), 10.0);
  col += vec3(1.15, 0.82, 0.48) * sun * 2.4;
  float disc = smoothstep(0.996, 0.9994, dot(d, normalize(uSun)));
  col += vec3(1.4, 1.15, 0.8) * disc * 5.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createMarsEnvMap(renderer, sunDir) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const size = 128;
  const sx = sunDir.x, sy = sunDir.y, sz = sunDir.z;
  const images = [];
  for (let face = 0; face < 6; face++) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / (size - 1)) * 2 - 1;
        const v = (y / (size - 1)) * 2 - 1;
        let vx = 0, vy = 0, vz = 0;
        if (face === 0) { vx = 1; vy = -v; vz = -u; }
        else if (face === 1) { vx = -1; vy = -v; vz = u; }
        else if (face === 2) { vx = u; vy = 1; vz = v; }
        else if (face === 3) { vx = u; vy = -1; vz = -v; }
        else if (face === 4) { vx = u; vy = -v; vz = 1; }
        else { vx = -u; vy = -v; vz = -1; }
        const inv = 1 / Math.hypot(vx, vy, vz);
        vx *= inv; vy *= inv; vz *= inv;
        const nd = Math.max(0, vx * sx + vy * sy + vz * sz);
        const glow = nd ** 6;
        const disc = nd > 0.97 ? (nd - 0.97) / 0.03 : 0;
        const h = vy;
        // Neutral-cool zenith + peach horizon + rust floor.
        // Variation so 3/4 steel reads as metal, not flat grey or beige paint.
        const hz = Math.max(0, 1 - Math.abs(h) * 3.2);
        let r = 0.22 + Math.max(0, h) * 0.20 + hz * 0.42;
        let g = 0.22 + Math.max(0, h) * 0.16 + hz * 0.26;
        let b = 0.26 + Math.max(0, h) * 0.14 + hz * 0.12;
        if (h < 0) {
          r = 0.16 + (1 + h) * 0.06;
          g = 0.10 + (1 + h) * 0.04;
          b = 0.09 + (1 + h) * 0.04;
        }
        r += glow * 1.7 + disc * 3.6;
        g += glow * 1.2 + disc * 2.7;
        b += glow * 0.65 + disc * 1.7;
        const i = (y * size + x) * 4;
        img.data[i] = Math.min(255, r * 255);
        img.data[i + 1] = Math.min(255, g * 255);
        img.data[i + 2] = Math.min(255, b * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    images.push(c);
  }
  const cube = new THREE.CubeTexture(images);
  cube.needsUpdate = true;
  cube.colorSpace = THREE.SRGBColorSpace;
  const tex = pmrem.fromCubemap(cube).texture;
  pmrem.dispose();
  return tex;
}

export function createLights(scene, sunDir) {
  const hemi = new THREE.HemisphereLight(0xe8e4dc, 0x6a3a24, 0.62);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe0bc, 2.55);
  sun.position.copy(sunDir.clone().multiplyScalar(420));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.bias = -0.00025;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xd49262, 0.34);
  fill.position.set(-180, 55, -120);
  scene.add(fill);

  const cool = new THREE.DirectionalLight(0xd5dce6, 0.78);
  cool.position.set(-sunDir.x * 200, 120, -sunDir.z * 200);
  scene.add(cool);

  const rim = new THREE.DirectionalLight(0xf0e8dc, 0.55);
  rim.position.set(sunDir.z * 160, 70, -sunDir.x * 160);
  scene.add(rim);

  const bounce = new THREE.DirectionalLight(0xc87848, 0.28);
  bounce.position.set(30, 12, 110);
  scene.add(bounce);

  return { sun, hemi, cool };
}

export function createPhobos() {
  const geo = new THREE.IcosahedronGeometry(9, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 0.82 + simplex2(x * 0.4, z * 0.4) * 0.22;
    pos.setXYZ(i, x * n, y * n * 0.78, z * n);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a7a6a,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-420, 280, -380);
  return mesh;
}

export function createStarship() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x8e9298,
    metalness: 0.88,
    roughness: 0.38,
    envMapIntensity: 1.05,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1a1b1e,
    metalness: 0.45,
    roughness: 0.55,
  });
  const tile = new THREE.MeshStandardMaterial({
    color: 0x0c0c0e,
    metalness: 0.08,
    roughness: 0.82,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 38, 20), steel);
  body.position.y = 22;
  body.castShadow = true;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 10, 20), steel);
  nose.position.y = 46;
  nose.castShadow = true;
  g.add(nose);

  const windward = new THREE.Mesh(new THREE.CylinderGeometry(4.54, 4.54, 30, 20, 1, true, 0, Math.PI * 1.05), tile);
  windward.position.y = 16;
  windward.rotation.y = 0.85;
  g.add(windward);
  const windwardNose = new THREE.Mesh(new THREE.ConeGeometry(4.54, 10.1, 20, 1, true, 0, Math.PI * 1.05), tile);
  windwardNose.position.y = 46;
  windwardNose.rotation.y = 0.85;
  g.add(windwardNose);

  for (const side of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8, 3.2), steel);
    flap.position.set(side * 4.6, 34, 0.4);
    flap.rotation.z = side * 0.18;
    flap.castShadow = true;
    g.add(flap);
  }

  const aftFin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 5.5), steel);
  aftFin.position.set(0, 8, -3.6);
  aftFin.castShadow = true;
  g.add(aftFin);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 9.2, 7), dark);
    leg.position.set(cx * 4.6, 3.2, sz * 4.6);
    leg.rotation.z = cx * 0.42;
    leg.rotation.x = -sz * 0.42;
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.28, 8), dark);
    foot.position.set(cx * 6.2, 0.2, sz * 6.2);
    g.add(foot);
  }

  const raptor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 2.2, 10), dark);
  raptor.position.y = 1.8;
  g.add(raptor);

  const { x, z } = LANDMARKS.STARSHIP;
  const y = heightAt(x, z);
  g.position.set(x, y, z);
  g.name = 'starship';
  return g;
}

export function createHabitatPad() {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x6d5a48,
    roughness: 0.9,
    metalness: 0.05,
  });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(16, 16.5, 0.45, 24), concrete);
  pad.receiveShadow = true;
  pad.castShadow = true;
  g.add(pad);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(10, 10.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xc9a06a, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.24;
  g.add(ring);

  const { x, z } = LANDMARKS.STARSHIP;
  g.position.set(x - 28, heightAt(x - 28, z + 18) + 0.15, z + 18);
  return g;
}

export async function loadHabitats(scene) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(draco);
  const spots = [
    { url: '/models/habitat-a.glb', x: LANDMARKS.STARSHIP.x - 36, z: LANDMARKS.STARSHIP.z + 26, scale: 3.4 },
    { url: '/models/habitat-b.glb', x: LANDMARKS.STARSHIP.x - 48, z: LANDMARKS.STARSHIP.z + 8, scale: 3.2 },
  ];
  for (const s of spots) {
    try {
      const gltf = await loader.loadAsync(s.url);
      const obj = gltf.scene;
      obj.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material) {
            c.material = c.material.clone();
            if (c.material.color) c.material.color.lerp(new THREE.Color(0xb07a52), 0.62);
            c.material.roughness = 0.88;
            c.material.metalness = 0.06;
            c.material.envMapIntensity = 0.35;
          }
        }
      });
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const sc = s.scale / maxDim * 8;
      obj.scale.setScalar(sc);
      const box2 = new THREE.Box3().setFromObject(obj);
      obj.position.set(s.x, heightAt(s.x, s.z) - box2.min.y, s.z);
      obj.rotation.y = hash2(s.x, s.z) * Math.PI;
      scene.add(obj);
    } catch (err) {
      console.warn('Habitat GLB skipped', s.url, err);
    }
  }
}

export function createRocks() {
  const geos = [
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.OctahedronGeometry(1, 0),
  ];
  for (const g of geos) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 0.72 + hash2(x + i, z) * 0.5;
      pos.setXYZ(i, x * k, y * k * 0.7, z * k * 0.9);
    }
    g.computeVertexNormals();
  }
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x6b3a28, roughness: 0.95, metalness: 0.02, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x8a4e32, roughness: 0.92, metalness: 0.03, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x4a2a1c, roughness: 0.96, metalness: 0.02, flatShading: true }),
  ];

  const points = pickRockPoints(720);
  const groups = [];
  for (let k = 0; k < 3; k++) {
    const mesh = new THREE.InstancedMesh(geos[k], mats[k], Math.ceil(points.length / 3));
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = k; i < points.length; i += 3) {
      const p = points[i];
      dummy.position.set(p.x, p.y + p.s * 0.25, p.z);
      dummy.rotation.set(p.r, p.r * 1.7, p.r * 0.4);
      dummy.scale.set(p.s, p.s * (0.6 + hash2(i, 4) * 0.6), p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    groups.push(mesh);
  }
  return groups;
}

export function createDustDevils() {
  const devils = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const count = 280;
    const pos = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    for (let p = 0; p < count; p++) {
      const a = Math.random() * Math.PI * 2;
      const h = Math.random() * 28;
      const r = 0.6 + h * 0.09 + Math.random() * 0.4;
      pos[p * 3] = Math.cos(a) * r;
      pos[p * 3 + 1] = h;
      pos[p * 3 + 2] = Math.sin(a) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd2a070,
      size: 0.85,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    g.add(new THREE.Points(geo, mat));
    const x = i === 0 ? -180 : 320;
    const z = i === 0 ? 260 : -180;
    g.position.set(x, heightAt(x, z), z);
    g.userData = { phase: i * 2.1, wander: 18 + i * 10, ox: x, oz: z };
    devils.push(g);
  }
  return devils;
}

export function updateDustDevils(devils, t) {
  for (const d of devils) {
    d.rotation.y = t * 3.4 + d.userData.phase;
    const x = d.userData.ox + Math.sin(t * 0.07 + d.userData.phase) * d.userData.wander;
    const z = d.userData.oz + Math.cos(t * 0.055 + d.userData.phase) * d.userData.wander;
    d.position.set(x, heightAt(x, z), z);
  }
}

export function createWheelDust() {
  const count = 480;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const life = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dc = document.createElement('canvas');
  dc.width = dc.height = 64;
  const dctx = dc.getContext('2d');
  const grd = dctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(210,160,110,0.9)');
  grd.addColorStop(0.45, 'rgba(180,120,75,0.4)');
  grd.addColorStop(1, 'rgba(140,80,40,0)');
  dctx.fillStyle = grd;
  dctx.fillRect(0, 0, 64, 64);
  const dtex = new THREE.CanvasTexture(dc);
  const mat = new THREE.PointsMaterial({
    map: dtex,
    color: 0xe0b080,
    size: 0.95,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, pos, life, cursor: 0 };
}

export function emitDust(dust, origin, vel, amount) {
  if (amount < 0.12) return;
  const n = Math.min(10, 2 + Math.floor(amount * 3.5));
  for (let i = 0; i < n; i++) {
    const c = dust.cursor % (dust.life.length);
    dust.pos[c * 3] = origin.x + (Math.random() - 0.5) * 1.4;
    dust.pos[c * 3 + 1] = origin.y + 0.12 + Math.random() * 0.18;
    dust.pos[c * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.4;
    dust.life[c] = 0.85 + Math.random() * 0.4;
    dust.cursor++;
  }
  dust.pts.geometry.attributes.position.needsUpdate = true;
}

export function stepDust(dust, dt) {
  for (let i = 0; i < dust.life.length; i++) {
    if (dust.life[i] <= 0) continue;
    dust.life[i] -= dt * 0.7;
    dust.pos[i * 3 + 1] += dt * 0.9;
    if (dust.life[i] <= 0) {
      dust.pos[i * 3 + 1] = -999;
    }
  }
  dust.pts.geometry.attributes.position.needsUpdate = true;
}

export function createHorizon() {
  const g = new THREE.Group();
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x6e3520, roughness: 1, metalness: 0, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x5a2a18, roughness: 1, metalness: 0, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x8a4a2c, roughness: 0.98, metalness: 0, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x7a3d24, roughness: 1, metalness: 0, flatShading: true }),
  ];
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + hash2(i, 2.2) * 0.14;
    const r = 960 + hash2(i, 4.4) * 180;
    const kind = i % 7;
    const h = 9 + hash2(i, 8.2) * 82;
    const w = 38 + hash2(i, 3.3) * 95;
    let mesh;
    if (kind === 0) {
      // flattened worn massif, not a toy pyramid
      mesh = new THREE.Mesh(new THREE.ConeGeometry(w * 1.15, h * 0.55, 6 + (i % 2)), mats[i % 4]);
      mesh.scale.set(1.25, 0.32 + hash2(i, 1.1) * 0.28, 0.7 + hash2(i, 6) * 0.35);
    } else if (kind === 1 || kind === 5) {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(w * 0.46, 0), mats[i % 4]);
      mesh.scale.set(1.8, (h / Math.max(w, 1)) * 0.55, 0.55 + hash2(i, 2) * 0.45);
    } else if (kind === 2) {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(w * 0.48, 0), mats[i % 4]);
      mesh.scale.set(1.25, (h / Math.max(w, 1)) * 0.95, 0.55 + hash2(i, 9) * 0.4);
    } else if (kind === 3) {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(w * 0.4, 0), mats[i % 4]);
      mesh.scale.set(1.7, (h / Math.max(w, 1)) * 0.62, 0.95);
    } else {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(w * 0.38, 0), mats[i % 4]);
      mesh.scale.set(1.45, (h / Math.max(w, 1)) * 0.7, 0.8);
    }
    mesh.position.set(Math.cos(a) * r, Math.max(5, h * 0.16), Math.sin(a) * r);
    mesh.rotation.y = a + hash2(i, 7) * 1.5;
    mesh.rotation.z = (hash2(i, 5) - 0.5) * 0.2;
    g.add(mesh);
  }
  g.name = 'horizon-massifs';
  return g;
}
