import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, AU_METRES } from '../src/bodies.ts';
import { rotationAngle, facingAngle, overviewRadius, enhancedOverviewRadius, enhancedOrbitRadii, enhancedSatelliteOrbit, formatBeijingTime, ENHANCED_PLANET_AU, proportionalSatelliteRadius, fitDistance, focusLimits, smoothZoomPath, dwellAtApex, flightDurationSeconds, easeInOut, layerLabels, distanceToAnnulus, proximityOpacity, subpixelDiscScale, TAU } from '../src/view-math.ts';

test('subpixel real-scale discs fade away instead of leaving a bright point', () => {
  assert.equal(subpixelDiscScale(0.1), 0);
  assert.equal(subpixelDiscScale(0.6), 0);
  assert.ok(subpixelDiscScale(1.05) > 0 && subpixelDiscScale(1.05) < 1);
  assert.equal(subpixelDiscScale(1.5), 1);
  assert.equal(subpixelDiscScale(10), 1);
});

test('crowded labels keep fixed anchors and nearer labels take the foreground', () => {
  const labels = [
    { x: 700, y: 440, width: 60, height: 26, depth: 90 },
    { x: 704, y: 436, width: 60, height: 26, depth: 40 },
    { x: 900, y: 440, width: 60, height: 26, depth: 120 },
  ];
  const placed = layerLabels(labels);
  placed.forEach((item, i) => {
    assert.equal(item.x, labels[i].x);
    assert.equal(item.y, labels[i].y);
  });
  assert.equal(placed[0].occluded, true);
  assert.equal(placed[1].occluded, false);
  assert.equal(placed[2].occluded, false);
  assert.ok(placed[1].layer > placed[0].layer);
  assert.deepEqual(layerLabels(labels), placed);
});

test('distant small-body belts fade out instead of forming luminous rings', () => {
  assert.equal(distanceToAnnulus(0, 0, 45, 40, 50), 0);
  assert.equal(distanceToAnnulus(0, 30, 60, 40, 50), Math.hypot(10, 30));
  assert.equal(proximityOpacity(100, 10, 55), 0);
  assert.equal(proximityOpacity(0, 10, 55), 1);
  assert.ok(proximityOpacity(30, 10, 55) > proximityOpacity(40, 10, 55));
});

test('Earth turns once per sidereal day; retrograde periods turn backwards', () => {
  const earth = BODIES.find(body => body.id === 'earth')!;
  assert.ok(Math.abs(rotationAngle(earth.rotationPeriodDays / 4, earth.rotationPeriodDays) - TAU / 4) < 1e-12);
  assert.ok(Math.abs(rotationAngle(earth.rotationPeriodDays, earth.rotationPeriodDays)) < 1e-12);
  assert.ok(Math.abs(rotationAngle(1, earth.rotationPeriodDays) - 0.01720218) < 1e-6);
  assert.ok(rotationAngle(0.1, -1) > Math.PI); // Retrograde rotation.
});

test('compressed orbits remain ordered; Sun remains fixed at the origin', () => {
  assert.equal(overviewRadius(0), 0);
  const radii = BODIES.filter(body => !body.parentId).map(body => overviewRadius(body.semimajorAxisMetres * 180 / (30.06896348 * AU_METRES)));
  assert.ok(radii.every((radius, index) => index === 0 || radius > radii[index - 1]));
  assert.ok(Math.abs(radii.at(-1)! - 180) < 1e-9);
});

test('enhanced layout keeps planet systems apart with widening gaps', () => {
  const sun = 37;
  const footprints = [8, 11, 26, 9, 59, 50, 17, 17];
  const radii = enhancedOrbitRadii(sun, footprints);
  assert.equal(radii.length, ENHANCED_PLANET_AU.length);
  let previousEdge = sun;
  let previousGap = 0;
  radii.forEach((radius, index) => {
    const gap = radius - footprints[index] - previousEdge;
    assert.ok(gap > 0, 'neighbouring footprints never touch');
    assert.ok(gap > previousGap, 'empty space widens outward');
    previousEdge = radius + footprints[index];
    previousGap = gap;
  });
});

test('enhanced distance map passes through the planet knots and stays ordered', () => {
  const radii = enhancedOrbitRadii(37, [8, 11, 26, 9, 59, 50, 17, 17]);
  assert.equal(enhancedOverviewRadius(0, radii), 0);
  ENHANCED_PLANET_AU.forEach((au, index) => assert.ok(Math.abs(enhancedOverviewRadius(au, radii) - radii[index]) < 1e-9));
  for (let au = 0.05; au < 40; au += 0.05) {
    assert.ok(enhancedOverviewRadius(au + 0.05, radii) > enhancedOverviewRadius(au, radii));
  }
});

test('enhanced satellite orbits keep their order and clear the parent', () => {
  const parentRadius = 24;
  const orbits = [1, 1.59, 2.54, 4.46].map(ratio => enhancedSatelliteOrbit(parentRadius, 0.8, ratio));
  assert.ok(orbits[0] > parentRadius * 1.3);
  assert.ok(orbits.every((orbit, index) => index === 0 || orbit > orbits[index - 1]));
});

test('clock reads China Standard Time (UTC+8), across midnight', () => {
  assert.equal(formatBeijingTime(Date.UTC(2026, 8, 23, 16, 40, 2)), '2026-09-24 00:40:02');
  assert.equal(formatBeijingTime(Date.UTC(2026, 11, 31, 16, 0, 0)), '2027-01-01 00:00:00');
});

test('enhanced satellite sizes retain their true radius ratio to their parent', () => {
  for (const satellite of BODIES.filter(body => body.parentId)) {
    const parent = BODIES.find(body => body.id === satellite.parentId)!;
    const parentDisplayRadius = 12;
    const satelliteDisplayRadius = proportionalSatelliteRadius(parentDisplayRadius, parent.radiusMetres, satellite.radiusMetres);
    assert.ok(Math.abs(satelliteDisplayRadius / parentDisplayRadius - satellite.radiusMetres / parent.radiusMetres) < 1e-12);
    assert.ok(satelliteDisplayRadius < parentDisplayRadius * 0.3);
  }
});

test('synchronous satellites turn texture longitude 0 toward the parent', () => {
  // Rotating local +X by Y angle θ gives (cos θ, 0, -sin θ).
  for (const [x, z] of [[1, 0], [0, 1], [-1, 0], [0.6, -0.8]]) {
    const angle = facingAngle(x, z);
    assert.ok(Math.abs(Math.cos(angle) - x) < 1e-12);
    assert.ok(Math.abs(-Math.sin(angle) - z) < 1e-12);
  }
});

test('every planet fits the camera in portrait and landscape; zoom-out exit is reachable', () => {
  for (const body of BODIES) for (const aspect of [0.45, 1, 16 / 9]) {
    const radius = body.radiusMetres * 180 / (30.06896348 * AU_METRES);
    const home = fitDistance(radius, 45, aspect);
    const limits = focusLimits(radius, home);
    assert.ok(home > limits.min && home < limits.exit && limits.exit < limits.max);
    assert.ok(home - radius > limits.near);
    const halfFov = Math.atan(Math.tan(Math.PI / 8) * Math.min(1, aspect));
    assert.ok(Math.asin(radius / home) < halfFov);
    assert.ok(limits.exit / home < 3); // No hundreds of scrolls for tiny planets.
  }
});

test('smooth zoom path meets both endpoints for close-up-scale zoom ratios', () => {
  // Overview (w ~ 400) to a real-scale planet close-up (w ~ 1e-3), with and
  // without a pan, and a planet-to-planet switch across the system.
  for (const [w0, w1, distance] of [[400, 8e-4, 150], [8e-4, 400, 0], [8e-4, 2e-4, 170], [8e-4, 1.7e-4, 0.015]]) {
    const path = smoothZoomPath(w0, w1, distance);
    const start = path.at(0);
    const end = path.at(1);
    assert.ok(Math.abs(start.u) < 1e-9 && Math.abs(start.w / w0 - 1) < 1e-9, 'starts at the current view');
    assert.ok(Math.abs(end.u - 1) < 1e-6 && Math.abs(end.w / w1 - 1) < 1e-6, 'ends at the destination view');
    let previousU = -1;
    for (let t = 0; t <= 1.000001; t += 0.01) {
      const { u, w } = path.at(t);
      assert.ok(Number.isFinite(u) && Number.isFinite(w) && w > 0);
      assert.ok(u >= previousU - 1e-12, 'the view centre never backtracks');
      previousU = u;
    }
    assert.ok(flightDurationSeconds(path.length) >= 1.4 && flightDurationSeconds(path.length) <= 3);
  }
});

test('a planet-to-planet flight rises above both bodies and pans while zoomed out', () => {
  const path = smoothZoomPath(8e-4, 8e-4, 170);
  const middle = path.at(0.5);
  assert.ok(middle.w > 50, 'mid-flight shows the solar system, not empty space');
  assert.ok(Math.abs(middle.u - 0.5) < 1e-6, 'symmetric flight is half-way at its midpoint');
  assert.ok(path.at(0.25).u < 0.02, 'little pan happens before the camera has pulled back');
});

test('long flights slow down around the apex instead of snapping through it', () => {
  const path = smoothZoomPath(8e-4, 8e-4, 170);
  assert.equal(dwellAtApex(0, path), 0);
  assert.ok(Math.abs(dwellAtApex(1, path) - 1) < 1e-9);
  // Share of flight time spent while the view centre is between 10% and 90% of its pan.
  const panShare = (warp: (tau: number) => number) => {
    let inside = 0;
    for (let i = 0; i <= 1000; i++) {
      const u = path.at(warp(easeInOut(i / 1000))).u;
      if (u > 0.1 && u < 0.9) inside++;
    }
    return inside / 1001;
  };
  const plain = panShare(t => t);
  const dwelling = panShare(t => dwellAtApex(t, path));
  assert.ok(dwelling > plain * 2.5, `pan share ${plain.toFixed(3)} -> ${dwelling.toFixed(3)}`);
  let previous = 0;
  for (let tau = 0; tau <= 1; tau += 0.01) {
    const t = dwellAtApex(tau, path);
    assert.ok(t >= previous - 1e-12, 'the warp is monotonic');
    previous = t;
  }
  // A pure zoom (no apex) is left untouched.
  const zoom = smoothZoomPath(400, 1e-3, 0);
  assert.equal(dwellAtApex(0.37, zoom), 0.37);
});

test('eased flight time starts and ends at rest', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(easeInOut(0.01) < 1e-4 && 1 - easeInOut(0.99) < 1e-4);
});
