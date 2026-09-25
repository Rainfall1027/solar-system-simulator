import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleEarthWind, sampleOceanCurrent } from '../src/earth-wind-demo.ts';

test('synthetic wind remains finite and bounded across the globe', () => {
  for (let latitude = 0; latitude <= 20; latitude++) {
    for (let longitude = 0; longitude <= 40; longitude++) {
      const [east, north] = sampleEarthWind(longitude / 40, latitude / 20);
      assert.ok(Number.isFinite(east) && Number.isFinite(north));
      assert.ok(Math.hypot(east, north) < 0.002);
    }
  }
});

test('wind field joins smoothly at the longitude seam', () => {
  for (const v of [0.16, 0.38, 0.5, 0.62, 0.84]) {
    const start = sampleEarthWind(0, v);
    const end = sampleEarthWind(1, v);
    assert.ok(Math.hypot(start[0] - end[0], start[1] - end[1]) < 1e-10);
  }
});

test('synthetic ocean currents stay bounded and join at the seam', () => {
  for (let latitude = 0; latitude <= 20; latitude++) {
    const v = latitude / 20;
    const start = sampleOceanCurrent(0, v);
    const end = sampleOceanCurrent(1, v);
    assert.ok(Math.hypot(start[0] - end[0], start[1] - end[1]) < 1e-10);
    for (let longitude = 0; longitude <= 40; longitude++) {
      const current = sampleOceanCurrent(longitude / 40, v);
      assert.ok(Number.isFinite(current[0]) && Number.isFinite(current[1]));
      assert.ok(Math.hypot(...current) < 0.002);
    }
  }
});
