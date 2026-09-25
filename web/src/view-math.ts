// Presentation math only. This is not an N-body integrator.
export const SECONDS_PER_DAY = 86_400;
export const TAU = Math.PI * 2;

// A sphere smaller than one screen pixel is not a resolvable disc. Fade its
// rendered scale through this narrow range so the GPU cannot leave a lone
// sparkling fragment behind when the user zooms out.
export function subpixelDiscScale(apparentRadiusPixels: number): number {
  const t = Math.min(1, Math.max(0, (apparentRadiusPixels - 0.6) / 0.9));
  return t * t * (3 - 2 * t);
}

// Labels stay attached to their projected bodies. When two labels overlap,
// the nearer one is drawn on top; no screen-space stacking can make a label
// jump while the camera rotates.
export function layerLabels<T extends { x: number; y: number; width: number; height: number; depth: number }>(labels: T[]) {
  const ordered = labels.map((label, index) => ({ label, index }))
    .sort((a, b) => a.label.depth - b.label.depth || a.index - b.index);
  const foreground: T[] = [];
  const result: (T & { layer: number; occluded: boolean })[] = new Array(labels.length);
  for (const [rank, { label, index }] of ordered.entries()) {
    const occluded = foreground.some(other => Math.abs(label.x - other.x) < (label.width + other.width) / 2
      && label.y > other.y - other.height && label.y - label.height < other.y);
    result[index] = { ...label, layer: labels.length - rank, occluded };
    foreground.push(label);
  }
  return result;
}

// Distance to a compressed, flat belt. Presentation geometry is not a claim
// that its individual small bodies are resolvable from the overview camera.
export function distanceToAnnulus(x: number, y: number, z: number, innerRadius: number, outerRadius: number): number {
  const radial = Math.hypot(x, z);
  return Math.hypot(radial - Math.min(outerRadius, Math.max(innerRadius, radial)), y);
}

export function proximityOpacity(distance: number, near: number, far: number): number {
  return 1 - easeInOut((distance - near) / (far - near));
}

export function rotationAngle(days: number, periodDays: number): number {
  return ((days % periodDays) / periodDays * TAU + TAU) % TAU;
}

export function overviewRadius(physicalRadius: number, maxRadius = 180): number {
  return physicalRadius === 0 ? 0 : 18 + 162 * Math.pow(physicalRadius / maxRadius, 0.65);
}

// Visual-enhancement mode keeps the ephemeris bearing of every planet and
// remaps only its displayed Sun distance. Each planet occupies a "footprint"
// (its enlarged disc, rings or satellite system). Planets are placed outward so
// that neighbouring footprints never touch and the empty space between them
// grows geometrically, echoing the real solar system's widening gaps.
export const ENHANCED_PLANET_AU = [0.38709893, 0.72333199, 1.00000011, 1.52366231, 5.20336301, 9.53707032, 19.19126393, 30.06896348] as const;

export function enhancedOrbitRadii(sunFootprint: number, footprints: readonly number[], baseClearance = 8, growth = 1.25): number[] {
  const radii: number[] = [];
  let previousEdge = sunFootprint;
  footprints.forEach((footprint, index) => {
    const radius = previousEdge + baseClearance * growth ** index + footprint;
    radii.push(radius);
    previousEdge = radius + footprint;
  });
  return radii;
}

// Piecewise-linear map from true Sun distance (AU) through the planet knots,
// so eccentric orbit samples stay continuous and radially ordered.
export function enhancedOverviewRadius(distanceAu: number, orbitRadii: readonly number[]): number {
  if (distanceAu <= 0) return 0;
  const au = [0, ...ENHANCED_PLANET_AU];
  const world = [0, ...orbitRadii];
  for (let index = 1; index < au.length; index++) {
    if (distanceAu <= au[index]) {
      const fraction = (distanceAu - au[index - 1]) / (au[index] - au[index - 1]);
      return world[index - 1] + fraction * (world[index] - world[index - 1]);
    }
  }
  const last = au.length - 1;
  const slope = (world[last] - world[last - 1]) / (au[last] - au[last - 1]);
  return world[last] + (distanceAu - au[last]) * slope;
}

// Satellite orbit radius in enhanced mode. orbitRatio is the satellite's true
// semimajor axis over its system's innermost one; the square root keeps the
// real ordering while packing a whole satellite system close to its planet.
export function enhancedSatelliteOrbit(parentRadius: number, satelliteRadius: number, orbitRatio: number): number {
  return parentRadius * (1.35 + 0.5 * Math.sqrt(orbitRatio)) + satelliteRadius;
}

// China Standard Time (UTC+8, no daylight saving), "YYYY-MM-DD HH:MM:SS".
export function formatBeijingTime(utcMs: number): string {
  return new Date(utcMs + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

export function proportionalSatelliteRadius(parentDisplayRadius: number, parentPhysicalRadius: number, satellitePhysicalRadius: number): number {
  return parentDisplayRadius * satellitePhysicalRadius / parentPhysicalRadius;
}

// SphereGeometry puts texture longitude 0 (u = 0.5) on local +X. Returns the
// Y rotation that turns it toward a direction in the scene's XZ plane.
export function facingAngle(directionX: number, directionZ: number): number {
  return Math.atan2(-directionZ, directionX);
}

export function fitDistance(radius: number, fovDegrees: number, aspect: number, fill = 0.6): number {
  const verticalHalfAngle = fovDegrees * Math.PI / 360;
  const halfAngle = Math.atan(Math.tan(verticalHalfAngle) * Math.min(1, aspect) * fill);
  return radius / Math.sin(halfAngle);
}

export function focusLimits(radius: number, homeDistance: number) {
  // Stop before the camera can intersect the surface. The closest framing
  // leaves the limb just inside the usable viewport instead of permitting a
  // ground-skimming view that the current texture resolution cannot support.
  return { near: radius * 0.01, min: homeDistance * 0.92, exit: homeDistance * 2.2, max: homeDistance * 4 };
}

export function easeInOut(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Smooth zoom-and-pan path (van Wijk & Nuij 2003, as d3.interpolateZoom).
// w is the visible height at the target (proportional to camera distance) and
// distance is how far the view centre travels. at(t) returns the fraction u of
// the centre's travel and the width w for path parameter t in [0, 1]. The path
// pans mostly while zoomed out, so the centre is settled before the deep zoom.
// asinh replaces d3's log(sqrt(b^2 + 1) - b), which cancels catastrophically
// for the 1e5-1e6 zoom ratios of a planet close-up.
export interface ZoomPath {
  readonly length: number;
  // Path parameter of the highest (widest) point, or NaN for a pure zoom.
  readonly apex: number;
  at(t: number): { u: number; w: number };
}

export function smoothZoomPath(w0: number, w1: number, distance: number, rho = Math.SQRT2): ZoomPath {
  const rho2 = rho * rho;
  if (!(distance > 1e-6 * Math.max(w0, w1))) {
    const length = Math.log(w1 / w0) / rho;
    return { length: Math.abs(length), apex: Number.NaN, at: t => ({ u: t, w: w0 * Math.exp(rho * t * length) }) };
  }
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * distance * distance) / (2 * w0 * rho2 * distance);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * distance * distance) / (2 * w1 * rho2 * distance);
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  const length = (r1 - r0) / rho;
  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);
  return {
    length,
    apex: -r0 / (r1 - r0),
    at(t) {
      const r = rho * t * length + r0;
      return {
        u: Math.min(1, Math.max(0, w0 / (rho2 * distance) * (coshR0 * Math.tanh(r) - sinhR0))),
        w: w0 * coshR0 / Math.cosh(r),
      };
    },
  };
}

// Abramowitz & Stegun 7.1.26, |error| < 1.5e-7.
function erf(x: number): number {
  const sign = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

// Time spent along a zoom path. A planet-to-planet flight climbs and descends
// through five orders of magnitude, and the optimal path turns around at its
// apex within a few percent of its length - which is also where it pans across
// the system. Spending extra time around the apex turns that snap into a
// glide. Maps eased time tau in [0, 1] to the path parameter; the time density
// is 1 + strength * gauss((t - apex) / width), so the ends are unchanged.
export function dwellAtApex(tau: number, path: ZoomPath, strength = 2.5): number {
  const apex = path.apex;
  if (!(apex > 0.03 && apex < 0.97) || tau <= 0 || tau >= 1) return Math.min(1, Math.max(0, tau));
  const width = Math.min(0.2, Math.max(0.04, 1.5 / (Math.SQRT2 * Math.abs(path.length))));
  const area = strength * width * Math.sqrt(Math.PI) / 2;
  const timeAt = (t: number) => t + area * (erf((t - apex) / width) - erf(-apex / width));
  const goal = tau * timeAt(1);
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 40; iteration++) {
    const middle = (low + high) / 2;
    if (timeAt(middle) < goal) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// Flight duration grows gently with the perceived path length and stays in a
// range that reads as one deliberate camera move.
export function flightDurationSeconds(pathLength: number): number {
  return Math.min(3, Math.max(1.4, 1.1 + 0.1 * pathLength));
}
