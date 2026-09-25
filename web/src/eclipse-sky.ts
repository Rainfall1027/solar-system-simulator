import { Body, Equator, Horizon, Illumination, Observer, ObserverVector, RotateVector, Rotation_EQJ_ECL, SearchLocalSolarEclipse, SearchLunarEclipse, Vector, type FlexibleDateTime } from 'astronomy-engine';

// Topocentric sky geometry for the ground-observer eclipse view, plus the
// Earth-fixed orientation the close-up globe needs so a shadow and a ground
// site land on the right continent. Everything here is ephemeris-derived and
// independent of three.js so it can be regression-tested in node.

const SUN_RADIUS_KM = 695_700;
const MOON_RADIUS_KM = 1_737.4;
const AU_KM = 149_597_870.7;
const DEG = Math.PI / 180;
const equatorToEcliptic = Rotation_EQJ_ECL();

export type Vec3 = readonly [number, number, number];
export type GroundTarget = 'sun' | 'moon';

export interface GroundSite {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly heightMetres: number;
}

export interface SkyDisc {
  /** Degrees above the (unrefracted) horizon. */
  readonly altitude: number;
  /** Degrees clockwise from north. */
  readonly azimuth: number;
  /** Apparent angular radius in radians. */
  readonly angularRadius: number;
}

function observerFor(site: GroundSite): Observer {
  return new Observer(site.latitude, site.longitude, site.heightMetres);
}

function horizontal(date: FlexibleDateTime, observer: Observer, raHours: number, decDegrees: number) {
  return Horizon(date, observer, raHours, decDegrees);
}

/** Apparent topocentric position and size of the Sun or Moon (lunar parallax included). */
export function skyDisc(body: Body.Sun | Body.Moon, utcMs: number, site: GroundSite): SkyDisc {
  const date = new Date(utcMs);
  const observer = observerFor(site);
  const equatorial = Equator(body, date, observer, true, true);
  const sky = horizontal(date, observer, equatorial.ra, equatorial.dec);
  const radiusKm = body === Body.Sun ? SUN_RADIUS_KM : MOON_RADIUS_KM;
  return { altitude: sky.altitude, azimuth: sky.azimuth, angularRadius: Math.asin(radiusKm / (equatorial.dist * AU_KM)) };
}

/** Unit vector in the ground scene: east +x, up +y, north -z. */
export function horizontalDirection(altitudeDeg: number, azimuthDeg: number): Vec3 {
  const altitude = altitudeDeg * DEG;
  const azimuth = azimuthDeg * DEG;
  return [Math.cos(altitude) * Math.sin(azimuth), Math.sin(altitude), -Math.cos(altitude) * Math.cos(azimuth)];
}

/** Numerically stable angle between two horizontal positions, in radians. */
export function angularSeparation(a: SkyDisc, b: SkyDisc): number {
  const [ax, ay, az] = horizontalDirection(a.altitude, a.azimuth);
  const [bx, by, bz] = horizontalDirection(b.altitude, b.azimuth);
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz);
}

/**
 * Fraction of the solar disc's area hidden by the lunar disc (0 = none,
 * 1 = total). Small-angle flat geometry, valid for the ~0.5 degree discs.
 * The same formula runs per-fragment in the globe's shadow shader.
 */
export function discCoverage(sunRadius: number, moonRadius: number, separation: number): number {
  if (sunRadius <= 0) return 0;
  const d = Math.max(separation, 0);
  if (d >= sunRadius + moonRadius) return 0;
  if (d <= Math.abs(sunRadius - moonRadius)) return Math.min(1, (Math.min(sunRadius, moonRadius) / sunRadius) ** 2);
  const r1 = sunRadius;
  const r2 = moonRadius;
  const a1 = Math.acos(Math.min(1, Math.max(-1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const a2 = Math.acos(Math.min(1, Math.max(-1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  const kite = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return Math.min(1, (r1 * r1 * a1 + r2 * r2 * a2 - kite) / (Math.PI * r1 * r1));
}

export interface EclipseSky {
  readonly sun: SkyDisc;
  readonly moon: SkyDisc;
  readonly coverage: number;
}

export function eclipseSky(utcMs: number, site: GroundSite): EclipseSky {
  const sun = skyDisc(Body.Sun, utcMs, site);
  const moon = skyDisc(Body.Moon, utcMs, site);
  return { sun, moon, coverage: discCoverage(sun.angularRadius, moon.angularRadius, angularSeparation(sun, moon)) };
}

export interface LocalEclipseTimeline {
  readonly kind: string;
  readonly partialBeginMs: number;
  readonly peakMs: number;
  readonly partialEndMs: number;
  /** Second and third contact for a total or annular eclipse at this site. */
  readonly centralBeginMs?: number;
  readonly centralEndMs?: number;
  readonly obscuration: number;
}

/** The first solar eclipse visible from the site after searchFromMs. */
export function localEclipseTimeline(site: GroundSite, searchFromMs: number): LocalEclipseTimeline {
  const eclipse = SearchLocalSolarEclipse(new Date(searchFromMs), observerFor(site));
  return {
    kind: eclipse.kind,
    partialBeginMs: eclipse.partial_begin.time.date.getTime(),
    peakMs: eclipse.peak.time.date.getTime(),
    partialEndMs: eclipse.partial_end.time.date.getTime(),
    centralBeginMs: eclipse.total_begin?.time.date.getTime(),
    centralEndMs: eclipse.total_end?.time.date.getTime(),
    obscuration: eclipse.obscuration,
  };
}

export function lunarEclipseTimeline(searchFromMs: number): LocalEclipseTimeline {
  const eclipse = SearchLunarEclipse(new Date(searchFromMs));
  const peakMs = eclipse.peak.date.getTime();
  return {
    kind: eclipse.kind,
    partialBeginMs: peakMs - eclipse.sd_partial * 60_000,
    peakMs,
    partialEndMs: peakMs + eclipse.sd_partial * 60_000,
    centralBeginMs: peakMs - eclipse.sd_total * 60_000,
    centralEndMs: peakMs + eclipse.sd_total * 60_000,
    obscuration: eclipse.obscuration,
  };
}

export interface SkyPoint {
  readonly altitude: number;
  readonly azimuth: number;
  readonly magnitude: number;
}

// Brightest stars, J2000 (RA hours, Dec degrees, V magnitude). Precession
// since J2000 (~0.4 deg) is below what this naked-eye backdrop resolves.
const BRIGHT_STARS: readonly (readonly [number, number, number])[] = [
  [6.7525, -16.716, -1.46], [6.3992, -52.696, -0.74], [14.2610, 19.182, -0.05], [14.6600, -60.834, -0.27],
  [18.6156, 38.784, 0.03], [5.2782, 45.998, 0.08], [5.2423, -8.202, 0.13], [7.6550, 5.225, 0.34],
  [1.6286, -57.237, 0.46], [5.9195, 7.407, 0.5], [14.0637, -60.373, 0.61], [19.8464, 8.868, 0.76],
  [12.4433, -63.099, 0.77], [4.5987, 16.509, 0.85], [16.4901, -26.432, 0.96], [13.4199, -11.161, 0.97],
  [7.7553, 28.026, 1.14], [22.9608, -29.622, 1.16], [20.6905, 45.280, 1.25], [12.7953, -59.689, 1.25],
  [10.1395, 11.967, 1.35], [6.9771, -28.972, 1.5], [7.5767, 31.888, 1.58], [17.5601, -37.104, 1.62],
  [5.4189, 6.350, 1.64],
];
const PLANETS = [Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn] as const;

/** Bright stars and naked-eye planets above or near the site's horizon. */
export function skyBackdrop(utcMs: number, site: GroundSite): { stars: SkyPoint[]; planets: SkyPoint[] } {
  const date = new Date(utcMs);
  const observer = observerFor(site);
  const stars = BRIGHT_STARS.map(([ra, dec, magnitude]) => ({ ...pick(horizontal(date, observer, ra, dec)), magnitude }));
  const planets = PLANETS.map(body => {
    const equatorial = Equator(body, date, observer, true, true);
    return { ...pick(horizontal(date, observer, equatorial.ra, equatorial.dec)), magnitude: Illumination(body, date).mag };
  });
  return { stars, planets };
}

function pick(sky: { altitude: number; azimuth: number }) {
  return { altitude: sky.altitude, azimuth: sky.azimuth };
}

function unitEclipticScene(vector: Vector): Vec3 {
  const ecliptic = RotateVector(equatorToEcliptic, vector);
  const length = Math.hypot(ecliptic.x, ecliptic.y, ecliptic.z);
  // Same axis convention as ephemeris.sceneAxes: ecliptic (x, y, z) -> (x, z, -y).
  return [ecliptic.x / length, ecliptic.z / length, -ecliptic.y / length];
}

/**
 * Earth-fixed basis in scene axes at utcMs: the directions of (lat 0, lon 0),
 * (lat 0, lon 90E) and the north pole. Built from Astronomy Engine's own
 * observer vectors, so sidereal rotation, precession and nutation all match
 * the eclipse search that picked the ground site.
 */
export function earthFixedBasis(utcMs: number): { greenwich: Vec3; east: Vec3; north: Vec3 } {
  const date = new Date(utcMs);
  return {
    greenwich: unitEclipticScene(ObserverVector(date, new Observer(0, 0, 0), false)),
    east: unitEclipticScene(ObserverVector(date, new Observer(0, 90, 0), false)),
    north: unitEclipticScene(ObserverVector(date, new Observer(90, 0, 0), false)),
  };
}

/** Geographic point as a direction in the globe mesh's local frame (equirectangular UV convention). */
export function earthLocalDirection(latitude: number, longitude: number): Vec3 {
  const lat = latitude * DEG;
  const lon = longitude * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
}
