import * as THREE from 'three';

export function createChaseCamera(camera) {
  const look = { yaw: 0, pitch: 0.12, mode: 0 };
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const local = new THREE.Vector3();

  function onMouse(dx, dy) {
    look.yaw -= dx * 0.0026;
    look.pitch = THREE.MathUtils.clamp(look.pitch + dy * 0.002, -0.35, 0.85);
  }

  function cycle() {
    look.mode = (look.mode + 1) % 3;
    look.yaw = 0;
    look.pitch = look.mode === 1 ? 0 : 0.12;
    return ['CHASE', 'HOOD', 'ORBIT'][look.mode];
  }

  function update(dt, truckRoot, speed) {
    const q = truckRoot.quaternion;
    fwd.set(1, 0, 0).applyQuaternion(q);
    const extra = THREE.MathUtils.clamp(speed * 0.08, 0, 5);

    if (look.mode === 1) {
      // Sit just behind the glass, look down the hood toward the light bar
      local.set(0.55, 1.28, 0).applyQuaternion(q);
      desired.copy(truckRoot.position).add(local);
      local.set(3.15, 0.32, 0).applyQuaternion(q);
      lookAt.copy(truckRoot.position).add(local);
      const snap = camera.position.distanceTo(desired) > 8;
      camera.position.lerp(desired, snap ? 1 : 1 - Math.pow(0.00004, dt));
      camera.lookAt(lookAt);
      camera.fov = THREE.MathUtils.lerp(camera.fov, 64, 0.12);
      camera.updateProjectionMatrix();
      return;
    }

    const back = look.mode === 2 ? 9.4 + extra : 6.9 + extra * 0.2;
    const height = look.mode === 2 ? 3.15 : 2.45;
    const yaw = truckRoot.rotation.y + look.yaw;
    desired.set(
      truckRoot.position.x - Math.cos(yaw) * back,
      truckRoot.position.y + height + look.pitch * 2.6,
      truckRoot.position.z - Math.sin(yaw) * back
    );

    const groundClear = 0.55;
    if (desired.y < truckRoot.position.y + groundClear) {
      desired.y = truckRoot.position.y + groundClear;
    }

    const snap = camera.position.distanceTo(desired) > 18;
    camera.position.lerp(desired, snap ? 1 : 1 - Math.pow(0.008, dt));
    lookAt.copy(truckRoot.position).add(fwd.multiplyScalar(0.55 + extra * 0.1));
    lookAt.y += 0.62 - look.pitch * 0.25;
    camera.lookAt(lookAt);
    camera.fov = THREE.MathUtils.lerp(camera.fov, 54 + extra * 0.45, 0.1);
    camera.updateProjectionMatrix();
  }

  return { onMouse, cycle, update, look };
}
