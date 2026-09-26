import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const offset = new THREE.Vector3();
const shift = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const upRotation = new THREE.Quaternion();
const spherical = new THREE.Spherical();

/** 滚动方向沿用系统设置；正向滚动使场景向左／向上移动。 */
export function rotateTrackpadCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, dx: number, dy: number, height: number): void {
  upRotation.setFromUnitVectors(camera.up, upAxis);
  offset.copy(camera.position).sub(controls.target).applyQuaternion(upRotation);
  spherical.setFromVector3(offset);
  const radiansPerPixel = 2 * Math.PI * controls.rotateSpeed / Math.max(height, 1);
  spherical.theta += dx * radiansPerPixel;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi + dy * radiansPerPixel, controls.minPolarAngle, controls.maxPolarAngle);
  spherical.makeSafe();
  offset.setFromSpherical(spherical).applyQuaternion(upRotation.invert());
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

/** 同时移动相机和目标，保持朝向与距离；速度随当前视野缩放。 */
export function panTrackpadCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, dx: number, dy: number, height: number): void {
  camera.updateMatrix();
  const unitsPerPixel = 2 * camera.position.distanceTo(controls.target)
    * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(height, 1);
  shift.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(dx * unitsPerPixel * controls.panSpeed);
  offset.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-dy * unitsPerPixel * controls.panSpeed);
  shift.add(offset);
  camera.position.add(shift);
  controls.target.add(shift);
  controls.update();
}
