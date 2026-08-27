import * as THREE from 'three';
import { fbm, ridged, simplex2, hash2 } from './noise.js';

export const WORLD_SIZE = 2400;
export const HALF = WORLD_SIZE * 0.5;

const CRATER = { x: -240, z: -420, r: 210 };
const CANYON = { x0: 40, x1: 620, zMid: 80, width: 58 };
const STARSHIP = { x: 460, z: 140 };

export const LANDMARKS = { CRATER, CANYON, STARSHIP };

function smoothstep(e0, e1, x) {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function canyonCenter(x) {
  return CANYON.zMid + Math.sin(x * 0.012) * 70 + Math.sin(x * 0.031) * 22;
}

export function heightAt(x, z) {
  // Large Acidalia swells
  let h = fbm(x * 0.0018, z * 0.0018, 5) * 34;
  h += fbm(x * 0.0055 + 20, z * 0.0055, 4) * 11;

  // Wind-carved ridges
  h += (ridged(x * 0.0032, z * 0.0016 + 8, 4) - 0.45) * 16;

  // Transverse dunes (NE dune sea)
  const duneMask = smoothstep(-100, 380, x + z * 0.35);
  const dune = Math.sin(x * 0.038 + fbm(x * 0.01, z * 0.01, 3) * 2.4) *
    Math.sin(z * 0.011 + 1.3);
  h += dune * 5.8 * duneMask;

  // Primary crater bowl + raised rim
  const cdx = x - CRATER.x;
  const cdz = z - CRATER.z;
  const cr = Math.hypot(cdx, cdz);
  if (cr < CRATER.r * 1.25) {
    const t = cr / CRATER.r;
    const bowl = t < 1 ? (1 - t * t) * -38 : 0;
    const rim = Math.exp(-((cr - CRATER.r * 0.82) ** 2) / 520) * 16;
    const floorRipple = t < 0.72 ? simplex2(x * 0.04, z * 0.04) * 1.6 : 0;
    h += bowl + rim + floorRipple;
  }

  // Near crater — first ridge looks down into this bowl (left of the drive)
  const sdx = x - 180;
  const sdz = z + 90;
  const sr = Math.hypot(sdx, sdz);
  if (sr < 100) {
    const t = sr / 100;
    h += (1 - t * t) * -22 + Math.exp(-((sr - 82) ** 2) / 150) * 9;
  }

  // Outflow canyon — steeper walls so a crest actually reads as a drop
  if (x > CANYON.x0 && x < CANYON.x1) {
    const cz = canyonCenter(x);
    const d = Math.abs(z - cz);
    const along = smoothstep(CANYON.x0, CANYON.x0 + 90, x) *
      smoothstep(CANYON.x1, CANYON.x1 - 90, x);
    const wall = 1 - smoothstep(0, CANYON.width, d);
    h -= Math.pow(wall, 1.42) * 31 * along;
  }

  // Nearby drama: pad stays flat; first 200 m of driving hits swells + a ridge
  const dist0 = Math.hypot(x, z);
  const near = smoothstep(32, 88, dist0);
  h += fbm(x * 0.0076 + 40, z * 0.0076, 4) * 11 * near;

  // South-rim ridge — drive ENE, crest, look into the canyon
  if (x > 48 && x < 230) {
    const cz = canyonCenter(x);
    const rimZ = cz - CANYON.width - 6;
    const d = z - rimZ;
    const along = smoothstep(48, 78, x) * smoothstep(230, 175, x);
    h += Math.exp(-(d * d) / 720) * along * 19;
  }

  // Isolated swell left-ahead of the first heading
  {
    const sx = x - 30;
    const sz = z - 82;
    const sd = Math.hypot(sx, sz);
    if (sd < 78) {
      const w = 1 - sd / 78;
      h += w * w * (18 + ridged(x * 0.03, z * 0.03, 3) * 5);
    }
  }

  // Secondary swell past the ridge, right of the drive
  {
    const sx = x - 205;
    const sz = z - 28;
    const sd = Math.hypot(sx, sz);
    if (sd < 58) {
      const w = 1 - sd / 58;
      h += w * w * 11;
    }
  }

  // Landing pad terrace near Starship
  const ldx = x - STARSHIP.x;
  const ldz = z - STARSHIP.z;
  const lr = Math.hypot(ldx, ldz);
  if (lr < 70) {
    const pad = smoothstep(70, 28, lr);
    const target = 6;
    h = THREE.MathUtils.lerp(h, target, pad * 0.92);
  }

  // Fine regolith
  h += simplex2(x * 0.045, z * 0.045) * 1.25;
  h += simplex2(x * 0.14, z * 0.14) * 0.28;

  // Flatten a pad under spawn AFTER noise so the chassis can actually plant.
  // Distant dunes stay; only the first ~20 m is a terrace.
  const spawn = Math.hypot(x, z);
  if (spawn < 36) {
    const pad = smoothstep(36, 11, spawn);
    h = THREE.MathUtils.lerp(h, 5.5, pad * 0.95);
  }
  return h;
}

export function normalAt(x, z, eps = 0.7) {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  const n = new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
  return n;
}

function colorFor(x, z, y, ny) {
  const slope = 1 - THREE.MathUtils.clamp(ny, 0, 1);
  const dune = smoothstep(-80, 400, x + z * 0.35);
  const crater = Math.hypot(x - CRATER.x, z - CRATER.z);
  const inCrater = crater < CRATER.r * 0.75;

  // rust / ochre / sienna — a bit more mineral contrast
  let r = 0.56 + simplex2(x * 0.01, z * 0.01) * 0.10;
  let g = 0.27 + simplex2(x * 0.013 + 3, z * 0.013) * 0.055;
  let b = 0.15 + simplex2(x * 0.02, z * 0.02) * 0.03;

  // darker basalt on slopes
  r = THREE.MathUtils.lerp(r, 0.34, slope * 0.85);
  g = THREE.MathUtils.lerp(g, 0.18, slope * 0.85);
  b = THREE.MathUtils.lerp(b, 0.12, slope * 0.7);

  // paler dune sand
  r = THREE.MathUtils.lerp(r, 0.72, dune * 0.35 * (1 - slope));
  g = THREE.MathUtils.lerp(g, 0.42, dune * 0.3 * (1 - slope));
  b = THREE.MathUtils.lerp(b, 0.22, dune * 0.2 * (1 - slope));

  // crater floor slightly darker, oxidized
  if (inCrater) {
    r *= 0.82;
    g *= 0.78;
    b *= 0.74;
  }

  // height bleach on ridges / crests
  const bleach = smoothstep(14, 40, y);
  r = THREE.MathUtils.lerp(r, 0.74, bleach * 0.3);
  g = THREE.MathUtils.lerp(g, 0.48, bleach * 0.24);

  return [r, g, b];
}

export function createTerrain(texture) {
  const segs = 512;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const c = colorFor(x, z, y, nrm.getY(i));
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  if (texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4.2, 4.2);
    texture.anisotropy = 8;
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: texture || null,
    roughness: 0.94,
    metalness: 0.02,
    flatShading: false,
  });
  if (texture) {
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          sampledDiffuseColor.rgb = mix(vec3(0.70, 0.40, 0.22), sampledDiffuseColor.rgb, 0.14);
          diffuseColor.rgb *= sampledDiffuseColor.rgb;
        #endif
        `
      );
    };
  }

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'mars-terrain';
  return mesh;
}

export function makeGroundTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * 0.035, y * 0.035, 5);
      const p = hash2(x * 0.37, y * 0.19);
      const grit = hash2(x * 1.7, y * 2.1);
      const v = 0.55 + n * 0.22 + (p - 0.5) * 0.08 + (grit - 0.5) * 0.05;
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor((0.62 + v * 0.28) * 255);
      img.data[i + 1] = Math.floor((0.32 + v * 0.16) * 255);
      img.data[i + 2] = Math.floor((0.16 + v * 0.08) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function pickRockPoints(count) {
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard < count * 8) {
    guard++;
    const x = (hash2(guard, 11.2) - 0.5) * WORLD_SIZE * 0.94;
    const z = (hash2(guard, 71.8) - 0.5) * WORLD_SIZE * 0.94;
    if (Math.hypot(x, z) < 18) continue;
    if (Math.hypot(x - STARSHIP.x, z - STARSHIP.z) < 22) continue;
    const y = heightAt(x, z);
    const n = normalAt(x, z);
    if (n.y < 0.55) continue;
    pts.push({ x, y, z, s: 0.35 + hash2(guard, 3.3) * 2.4, r: hash2(guard, 9.1) * Math.PI * 2 });
  }
  return pts;
}
