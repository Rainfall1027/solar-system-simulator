// Photographic display model, separate from astronomical contact/coverage data.
// Lunar relief is deterministic and illustrative, NOT a measured LRO limb profile.
export const ECLIPSE_GLOW_SAMPLES = 96;

export function lunarLimbRadius(angle: number): number {
  return 1 + 0.00065 * Math.sin(angle * 37 + 0.7)
    + 0.0004 * Math.sin(angle * 73 + 2.1) + 0.0002 * Math.sin(angle * 131 - 0.4);
}

export function smoothOptics(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

export function coronaVisibility(coverage: number, moonRadius: number): number {
  // The corona exists continuously. Its visibility rises as the photosphere
  // is hidden; annularity retains only a faint background beneath solar bloom.
  return 0.025 + (moonRadius >= 1 ? 0.975 * smoothOptics(0.97, 1, coverage) : 0);
}

/** Visible photospheric arcs in solar-radius coordinates, reused by both eclipses. */
export function fillEclipseGlowSources(out: Float32Array, moonX: number, moonY: number, moonRadius: number): void {
  for (let i = 0; i < ECLIPSE_GLOW_SAMPLES; i++) {
    const angle = (i + 0.5) * Math.PI * 2 / ECLIPSE_GLOW_SAMPLES;
    const x = Math.cos(angle) * 0.998;
    const y = Math.sin(angle) * 0.998;
    const dx = x - moonX, dy = y - moonY;
    const gap = Math.hypot(dx, dy) - moonRadius * lunarLimbRadius(Math.atan2(dy, dx));
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = smoothOptics(-0.001, 0.003, gap) * (0.14 + 0.86 * smoothOptics(0, 0.18, gap));
  }
}

/** Last/first sliver of direct sunlight; never a permanent light on the Moon. */
export function contactGlowSource(sources: Float32Array, coverage: number): readonly [number, number, number] {
  let x = 0, y = 0, weight = 0;
  for (let i = 0; i < sources.length; i += 3) {
    x += sources[i] * sources[i + 2]; y += sources[i + 1] * sources[i + 2];
    weight += sources[i + 2];
  }
  const length = Math.hypot(x, y);
  const visible = 1 - coverage;
  const strength = smoothOptics(0.000002, 0.0002, visible)
    * (1 - smoothOptics(0.002, 0.015, visible)) * smoothOptics(0, 0.3, weight);
  return length > 1e-8 ? [x / length, y / length, strength] : [0, 0, 0];
}
