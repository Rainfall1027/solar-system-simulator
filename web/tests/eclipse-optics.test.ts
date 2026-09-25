import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactGlowSource, coronaVisibility, ECLIPSE_GLOW_SAMPLES, fillEclipseGlowSources, lunarLimbRadius } from '../src/eclipse-optics.ts';

test('coronal glow persists in both eclipse types and changes continuously', () => {
  let previous = coronaVisibility(0, 1.04);
  for (let i = 1; i <= 10000; i++) {
    const next = coronaVisibility(i / 10000, 1.04);
    assert.ok(next >= previous && next - previous < 0.005);
    assert.ok(coronaVisibility(i / 10000, 0.93) > 0);
    previous = next;
  }
  assert.equal(previous, 1);
});

test('lunar relief is periodic, stable, and below 0.13 percent of the radius', () => {
  for (let a = -Math.PI; a < Math.PI; a += 0.007) {
    assert.ok(Math.abs(lunarLimbRadius(a) - 1) <= 0.00126);
    assert.ok(Math.abs(lunarLimbRadius(a) - lunarLimbRadius(a + 2 * Math.PI)) < 1e-12);
  }
});

test('glare sources follow exposed sunlight rather than the screen or hidden lunar face', () => {
  const sources = new Float32Array(ECLIPSE_GLOW_SAMPLES * 3);
  fillEclipseGlowSources(sources, 0, 0, 1.05);
  assert.ok(sources.every((v, i) => i % 3 !== 2 || v === 0), 'no direct solar bloom in totality');
  fillEclipseGlowSources(sources, 0, 0, 0.93);
  assert.ok(sources.every((v, i) => i % 3 !== 2 || v > 0), 'annularity has a complete luminous ring');
  fillEclipseGlowSources(sources, 0.3, 0, 1.05);
  let left = 0, right = 0;
  for (let i = 0; i < sources.length; i += 3) {
    if (sources[i] < 0) left += sources[i + 2]; else right += sources[i + 2];
  }
  assert.ok(left > right * 4, 'moving Moon right leaves stronger light on the left');
});

test('diamond-ring light only exists near contact and follows the exposed arc', () => {
  const sources = new Float32Array(ECLIPSE_GLOW_SAMPLES * 3);
  fillEclipseGlowSources(sources, 0.06, 0, 1.05);
  const [x, y, strength] = contactGlowSource(sources, 0.999);
  assert.ok(x < -0.99 && Math.abs(y) < 0.03 && strength > 0);
  assert.equal(contactGlowSource(sources, 1)[2], 0);
  assert.equal(contactGlowSource(sources, 0.863)[2], 0);
  assert.equal(contactGlowSource(sources, 0.7)[2], 0);
});
