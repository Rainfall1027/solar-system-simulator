import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BODIES } from '../src/bodies.ts';

const G = 6.6743e-11;

test('C catalog and frontend agree on ids, order, names, radii, parents and masses', () => {
  const source = readFileSync(new URL('../../core/src/solar_system.c', import.meta.url), 'utf8');
  const entries = [...source.matchAll(/\{"(\w+)",\s*"([^"]+)",\s*([\d.e+-]+),\s*([\d.e+-]+),\s*(-1|SOLAR_\w+),/g)];
  assert.deepEqual(entries.map(entry => entry[1]), BODIES.map(body => body.id));
  entries.forEach((entry, index) => {
    const body = BODIES[index];
    assert.equal(body.name, entry[2]);
    assert.equal(body.radiusMetres, Number(entry[4]));
    const parent = entry[5] === '-1' ? undefined : entry[5].replace('SOLAR_', '').toLowerCase();
    assert.equal(body.parentId, parent, `${body.id} parent`);
    // The core stores GM (km^3/s^2); the frontend keeps rounded display masses.
    const massKg = Number(entry[3]) * 1e9 / G;
    assert.ok(Math.abs(massKg / body.massKg - 1) < 1e-3, `${body.id} mass ${massKg} vs ${body.massKg}`);
  });
});

test('satellites declare a valid parent and positive physical orbit', () => {
  const ids = new Set(BODIES.map(body => body.id));
  const satellites = BODIES.filter(body => body.parentId);
  assert.deepEqual(satellites.map(body => body.id), ['moon', 'io', 'europa', 'ganymede', 'callisto']);
  for (const body of satellites) {
    assert.ok(ids.has(body.parentId!));
    assert.ok(body.semimajorAxisMetres > body.radiusMetres);
    assert.ok(body.periodDays > 0);
  }
});
