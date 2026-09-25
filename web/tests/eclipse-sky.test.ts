import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directPosition, sceneAxes } from '../src/ephemeris.ts';
import { discCoverage, earthFixedBasis, eclipseSky, horizontalDirection, localEclipseTimeline, lunarEclipseTimeline, skyBackdrop, type GroundSite } from '../src/eclipse-sky.ts';

const LUXOR: GroundSite = { name: '卢克索', latitude: 25.6872, longitude: 32.6396, heightMetres: 80 };
const ANNULAR_PEAK: GroundSite = { name: '食甚点', latitude: -31.295, longitude: -48.465, heightMetres: 0 };

test('disc coverage handles separation, containment and partial overlap', () => {
  assert.equal(discCoverage(1, 1, 2.5), 0);
  assert.equal(discCoverage(1, 1.05, 0), 1, 'a larger Moon hides the Sun completely');
  assert.ok(Math.abs(discCoverage(1, 0.9, 0.05) - 0.81) < 1e-12, 'an annular Moon hides (r_moon / r_sun)^2');
  const half = discCoverage(1, 1, 0);
  assert.equal(half, 1);
  const grazing = discCoverage(1, 1, 1.999);
  assert.ok(grazing > 0 && grazing < 1e-3);
  // Monotonic as the Moon slides across.
  let previous = 0;
  for (let d = 2; d >= 0; d -= 0.05) {
    const coverage = discCoverage(1, 0.95, d);
    assert.ok(coverage >= previous - 1e-12);
    previous = coverage;
  }
});

test('ground sky at Luxor reaches totality on 2027-08-02 with the Sun high in the south', () => {
  const timeline = localEclipseTimeline(LUXOR, Date.parse('2027-07-01T00:00:00Z'));
  assert.equal(timeline.kind, 'total');
  assert.ok(timeline.centralBeginMs && timeline.centralEndMs);
  assert.ok(Math.abs((timeline.centralEndMs! - timeline.centralBeginMs!) / 1000 - 385) < 3, 'totality lasts about 6 min 25 s');
  const peak = eclipseSky(timeline.peakMs, LUXOR);
  assert.ok(peak.coverage > 0.999, `coverage ${peak.coverage}`);
  assert.ok(peak.moon.angularRadius > peak.sun.angularRadius);
  assert.ok(Math.abs(peak.sun.altitude - 81.8) < 0.3);
  const before = eclipseSky(timeline.partialBeginMs - 10 * 60_000, LUXOR);
  assert.equal(before.coverage, 0);
  const partial = eclipseSky((timeline.partialBeginMs + timeline.peakMs) / 2, LUXOR);
  assert.ok(partial.coverage > 0.2 && partial.coverage < 0.8);
});

test('the annular eclipse leaves a ring: the Moon sits inside a larger Sun', () => {
  const timeline = localEclipseTimeline(ANNULAR_PEAK, Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(timeline.kind, 'annular');
  const peak = eclipseSky(timeline.peakMs, ANNULAR_PEAK);
  assert.ok(peak.moon.angularRadius < peak.sun.angularRadius);
  assert.ok(Math.abs(peak.coverage - timeline.obscuration) < 0.01, `${peak.coverage} vs ${timeline.obscuration}`);
});

test('earth-fixed basis is orthonormal and puts the Sun at the site altitude', () => {
  const utcMs = Date.parse('2027-08-02T10:05:08Z');
  const { greenwich, east, north } = earthFixedBasis(utcMs);
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(greenwich, east)) < 1e-9 && Math.abs(dot(greenwich, north)) < 1e-9 && Math.abs(dot(east, north)) < 1e-9);
  const lat = LUXOR.latitude * Math.PI / 180;
  const lon = LUXOR.longitude * Math.PI / 180;
  const zenith = [0, 1, 2].map(i => greenwich[i] * Math.cos(lat) * Math.cos(lon) + east[i] * Math.cos(lat) * Math.sin(lon) + north[i] * Math.sin(lat));
  const earth = sceneAxes(directPosition('earth', utcMs));
  const length = Math.hypot(...earth);
  const toSun = earth.map(value => -value / length);
  // Geocentric zenith vs geodetic latitude differ by ~0.2 deg at 25 deg N.
  assert.ok(Math.abs(Math.asin(dot(zenith, toSun)) * 180 / Math.PI - 81.8) < 0.5);
});

test('horizontal directions and backdrop are well-formed', () => {
  const [x, y, z] = horizontalDirection(0, 90);
  assert.ok(Math.abs(x - 1) < 1e-12 && Math.abs(y) < 1e-12 && Math.abs(z) < 1e-12, 'azimuth 90 is east (+x)');
  assert.ok(horizontalDirection(0, 0)[2] < -0.999, 'azimuth 0 is north (-z)');
  const { stars, planets } = skyBackdrop(Date.parse('2027-08-02T10:05:08Z'), LUXOR);
  assert.equal(stars.length, 25);
  assert.equal(planets.length, 5);
  const venus = planets[1];
  assert.ok(venus.magnitude < -3.5);
});

test('the lunar eclipse wonder is observable from its site', () => {
  const beijing: GroundSite = { name: '北京', latitude: 39.90, longitude: 116.40, heightMetres: 45 };
  const lunarMs = Date.parse('2028-12-31T16:51:55Z');
  assert.ok(eclipseSky(lunarMs, beijing).moon.altitude > 60);
  const lunar = lunarEclipseTimeline(lunarMs - 86_400_000);
  assert.ok(Math.abs(lunar.peakMs - lunarMs) < 1000);
  assert.ok(lunar.centralBeginMs! < lunar.peakMs && lunar.centralEndMs! > lunar.peakMs);
});
