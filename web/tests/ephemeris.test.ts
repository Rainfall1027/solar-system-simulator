import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BODIES, type BodyId } from '../src/bodies.ts';
import { directPosition, Ephemeris, SimulationClock, DAY_MS, sceneAxes } from '../src/ephemeris.ts';

test('speed 0 holds the clock still; only reset jumps it, and resuming speed continues from wherever it is', () => {
  const now = Date.parse('2026-09-21T00:00:00Z');
  const clock = new SimulationClock(now);
  clock.setSpeed(0);
  clock.advance(1);
  assert.equal(clock.utcMs, now, 'speed 0 never advances, even while playing');

  clock.setSpeed(90);
  clock.advance(1);
  assert.equal(clock.utcMs, now + DAY_MS * 90, 'accelerated mode advances from wherever the clock already is');

  clock.setSpeed(0);
  assert.equal(clock.utcMs, now + DAY_MS * 90, 'dragging the speed back to 0 does not resync to the real current time');
  clock.advance(1);
  assert.equal(clock.utcMs, now + DAY_MS * 90, 'and stays frozen there while playing');

  clock.playing = false;
  clock.setSpeed(90);
  clock.advance(1);
  assert.equal(clock.utcMs, now + DAY_MS * 90, 'pausing freezes regardless of speed');

  clock.playing = true;
  clock.advance(1);
  assert.equal(clock.utcMs, now + DAY_MS * 180, 'resuming continues forward at the current speed');

  clock.reset(now);
  assert.equal(clock.utcMs, now, 'reset jumps straight to the given time');
});

test('daily interpolation stays within 20 km of direct ephemeris, including a day boundary', () => {
  const ephemeris = new Ephemeris();
  const start = Date.parse('2026-09-21T00:00:00Z');
  for (const body of BODIES) for (const fraction of [0, 0.25, 0.5, 0.75, 0.999999, 1, 1.5]) {
    const at = start + fraction * DAY_MS;
    const actual = ephemeris.position(body.id, at);
    const reference = directPosition(body.id, at);
    const error = Math.hypot(...actual.map((value, index) => value - reference[index]));
    assert.ok(error < 20_000, `${body.id} interpolation error ${error} m`);
    assert.ok(actual.every(Number.isFinite));
  }
});

test('ecliptic scene mapping preserves distances and handedness', () => {
  assert.deepEqual(sceneAxes([1, 2, 3]), [1, 3, -2]);
  assert.equal(Math.hypot(...sceneAxes([1, 2, 3])), Math.hypot(1, 2, 3));
  assert.deepEqual(directPosition('sun', Date.now()), [0, 0, 0]);
});

test('four heliocentric states agree with recorded JPL Horizons within a 3e-4 relative-vector budget', () => {
  const fixture = JSON.parse(readFileSync(new URL('./horizons-reference.json', import.meta.url), 'utf8')) as {
    utc: string; vectorsMetres: Array<{ id: BodyId; position: number[] }>;
  };
  for (const row of fixture.vectorsMetres) {
    const actual = directPosition(row.id, Date.parse(fixture.utc));
    const relativeError = Math.hypot(...actual.map((value, index) => value - row.position[index])) / Math.hypot(...row.position);
    assert.ok(relativeError < 0.0003, `${row.id}: relative error ${relativeError}`);
  }
});
