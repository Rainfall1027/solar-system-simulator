import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOortCloud } from '../src/space-effects.ts';

test('inner and outer Oort regions are sparse independent point fields, not a sphere mesh', () => {
  const cloud = createOortCloud(64, 64);
  const [inner, outer] = cloud.object.children;
  assert.equal(inner.name, 'inner-oort-cloud');
  assert.equal(outer.name, 'outer-oort-cloud');
  assert.ok(inner instanceof THREE.Points);
  assert.ok(outer instanceof THREE.Points);
  assert.equal(cloud.object.children.some(child => child instanceof THREE.Mesh), false);

  const positions = (points: THREE.Points) => points.geometry.getAttribute('position') as THREE.BufferAttribute;
  const innerPosition = positions(inner as THREE.Points);
  const outerPosition = positions(outer as THREE.Points);
  for (let index = 0; index < 64; index++) {
    const innerRadius = Math.hypot(innerPosition.getX(index), innerPosition.getY(index), innerPosition.getZ(index));
    const outerRadius = Math.hypot(outerPosition.getX(index), outerPosition.getY(index), outerPosition.getZ(index));
    assert.ok(innerRadius >= 279 && innerRadius <= 357);
    assert.ok(outerRadius >= 384 && outerRadius <= 551);
  }
  cloud.setVisibility(false, true);
  assert.equal(inner.visible, false);
  assert.equal(outer.visible, true);
  cloud.setEnhancedMode(true, 450);
  assert.equal(cloud.object.scale.x, 2.5);
});
