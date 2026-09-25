import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { earthClouds, earthNightLights, planetAtmosphere } from '../src/surface-effects.ts';

test('thin Earth overlays project from camera-relative coordinates', () => {
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const atmosphereModel = new THREE.Group();
  const surface = new THREE.Group();
  planetAtmosphere(atmosphereModel, geometry, 'earth');
  earthNightLights(surface, geometry, new THREE.Texture());

  for (const overlay of [atmosphereModel.children[0], surface.children[0]]) {
    const shader = (overlay as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
    assert.match(shader.vertexShader, /modelViewMatrix\s*\*\s*vec4\(position,\s*1\.0\)/);
    assert.doesNotMatch(shader.vertexShader, /projectionMatrix\s*\*\s*viewMatrix\s*\*/);
    assert.match(shader.fragmentShader, /mat3\(viewMatrix\)\s*\*\s*uSunDirection/);
  }

  geometry.dispose();
});

test('Earth atmosphere fades with apparent size and does not leave a distant additive point', () => {
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const model = new THREE.Group();
  const effect = planetAtmosphere(model, geometry, 'earth');
  const atmosphere = model.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const tick = (radiusPixels: number) => effect.update(1, 0, 768, new THREE.Vector3(1, 0, 0), 10, radiusPixels);
  effect.setVisible(true);
  tick(2);
  assert.equal(atmosphere.visible, false);
  assert.equal(atmosphere.material.uniforms.uOpacity.value, 0);
  tick(40);
  assert.equal(atmosphere.visible, true);
  assert.ok(atmosphere.material.uniforms.uOpacity.value > 0);
  assert.ok(atmosphere.material.uniforms.uOpacity.value < 0.48);
  tick(80);
  assert.equal(atmosphere.material.uniforms.uOpacity.value, 0.48);
  tick(2);
  assert.equal(atmosphere.visible, false);
  effect.setVisible(false);
  tick(80);
  assert.equal(atmosphere.visible, false);
  geometry.dispose();
});

test('Earth layer slider selects one flow overlay while keeping clouds present', () => {
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const model = new THREE.Group();
  const effect = earthClouds(model, geometry, new THREE.Texture(), new THREE.Texture());
  const [cloud, wind, windLines, ocean, oceanLines, analysisMap] = model.children;
  effect.setVisible(true);
  effect.setLayer(2);
  const tick = (time: number) => effect.update(time, 0, 768, new THREE.Vector3(1, 0, 0), 3);
  tick(0);
  assert.equal(cloud.visible, true);
  assert.equal(wind.visible, true);
  assert.equal(windLines.visible, true);
  assert.equal(ocean.visible, false);
  assert.equal(oceanLines.visible, false);
  tick(1);
  assert.equal(analysisMap.visible, true);
  effect.setLayer(0, true);
  tick(1.1);
  assert.equal(cloud.visible, true);
  assert.equal(wind.visible, false);
  assert.equal(windLines.visible, false);
  assert.equal(analysisMap.visible, false);
  effect.setLayer(3);
  tick(2);
  assert.equal(cloud.visible, true);
  assert.equal(ocean.visible, true);
  assert.equal(oceanLines.visible, true);
  tick(3);
  assert.equal(wind.visible, false);
  assert.equal(windLines.visible, false);
  effect.setLayer(0);
  tick(5);
  assert.equal(wind.visible, false);
  assert.equal(ocean.visible, false);
  assert.equal(oceanLines.visible, false);
  assert.equal(analysisMap.visible, false);
  const windMaterial = (wind as THREE.Points).material as THREE.ShaderMaterial;
  effect.setLayer(2);
  effect.setAnimationPlaying(true);
  tick(6);
  const movingTime = windMaterial.uniforms.uTime.value as number;
  effect.setAnimationPlaying(false);
  tick(7);
  assert.equal(windMaterial.uniforms.uTime.value, movingTime);
  effect.setOverlayOpacity(0.25);
  tick(8);
  assert.equal(windMaterial.uniforms.uLevel.value, 0.25);
  geometry.dispose();
});
