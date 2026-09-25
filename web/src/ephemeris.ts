import { Body, GeoMoonState, HelioState, HelioVector, JupiterMoons, RotateState, RotateVector, Rotation_EQJ_ECL, type StateVector } from 'astronomy-engine';
import { AU_METRES, type BodyId, type PrimaryBodyId, type SatelliteId } from './bodies.ts';

export const DAY_MS = 86_400_000;
export const J2000_MS = Date.UTC(2000, 0, 1, 12);
const equatorToEcliptic = Rotation_EQJ_ECL();
const catalog: Record<PrimaryBodyId, Body> = {
  sun: Body.Sun, mercury: Body.Mercury, venus: Body.Venus, earth: Body.Earth,
  mars: Body.Mars, jupiter: Body.Jupiter, saturn: Body.Saturn,
  uranus: Body.Uranus, neptune: Body.Neptune
};
const satelliteParents: Record<SatelliteId, PrimaryBodyId> = {
  moon: 'earth', io: 'jupiter', europa: 'jupiter', ganymede: 'jupiter', callisto: 'jupiter'
};

function isSatelliteId(id: BodyId): id is SatelliteId {
  return id in satelliteParents;
}

function exactSatelliteState(id: SatelliteId, date: Date): StateVector {
  if (id === 'moon') return RotateState(equatorToEcliptic, GeoMoonState(date));
  return RotateState(equatorToEcliptic, JupiterMoons(date)[id]);
}

export type PositionMetres = readonly [number, number, number];

/** Geometric heliocentric J2000 ecliptic coordinates, in metres.
 * An ephemeris data adapter, not the mass-editable C dynamical simulation.
 */
export function directPosition(id: BodyId, utcMs: number): PositionMetres {
  const date = new Date(utcMs);
  if (isSatelliteId(id)) {
    const parent = RotateVector(equatorToEcliptic, HelioVector(catalog[satelliteParents[id]], date));
    const relative = exactSatelliteState(id, date);
    return [(parent.x + relative.x) * AU_METRES, (parent.y + relative.y) * AU_METRES, (parent.z + relative.z) * AU_METRES];
  }
  const vector = RotateVector(equatorToEcliptic, HelioVector(catalog[id], date));
  return [vector.x * AU_METRES, vector.y * AU_METRES, vector.z * AU_METRES];
}

type Cache = { day: number; start: StateVector; end: StateVector };
type SatelliteCache = { interval: number; start: StateVector; end: StateVector };
export class Ephemeris {
  private readonly cache = new Map<BodyId, Cache>();
  private readonly satelliteCache = new Map<SatelliteId, SatelliteCache>();

  position(id: BodyId, utcMs: number): PositionMetres {
    if (id === 'sun') return [0, 0, 0];
    if (isSatelliteId(id)) {
      const parent = this.position(satelliteParents[id], utcMs);
      const intervalMs = 15 * 60 * 1000;
      const interval = Math.floor(utcMs / intervalMs);
      let cached = this.satelliteCache.get(id);
      if (!cached || cached.interval !== interval) {
        cached = {
          interval,
          start: exactSatelliteState(id, new Date(interval * intervalMs)),
          end: exactSatelliteState(id, new Date((interval + 1) * intervalMs))
        };
        this.satelliteCache.set(id, cached);
      }
      const t = utcMs / intervalMs - interval;
      const stepDays = intervalMs / DAY_MS;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const interpolate = (position: 'x' | 'y' | 'z', velocity: 'vx' | 'vy' | 'vz') =>
        (h00 * cached.start[position] + h10 * stepDays * cached.start[velocity]
          + h01 * cached.end[position] + h11 * stepDays * cached.end[velocity]) * AU_METRES;
      return [parent[0] + interpolate('x', 'vx'), parent[1] + interpolate('y', 'vy'), parent[2] + interpolate('z', 'vz')];
    }
    const day = Math.floor(utcMs / DAY_MS);
    let cached = this.cache.get(id);
    if (!cached || cached.day !== day) {
      cached = {
        day,
        start: RotateState(equatorToEcliptic, HelioState(catalog[id], new Date(day * DAY_MS))),
        end: RotateState(equatorToEcliptic, HelioState(catalog[id], new Date((day + 1) * DAY_MS)))
      };
      this.cache.set(id, cached);
    }
    // Hermite interpolation uses AU and AU/day over one day. Cached endpoints
    // keep UTC motion continuous without evaluating VSOP series every frame.
    const t = utcMs / DAY_MS - day;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    const h11 = t ** 3 - t ** 2;
    const interpolate = (position: 'x' | 'y' | 'z', velocity: 'vx' | 'vy' | 'vz') =>
      (h00 * cached.start[position] + h10 * cached.start[velocity] + h01 * cached.end[position] + h11 * cached.end[velocity]) * AU_METRES;
    return [interpolate('x', 'vx'), interpolate('y', 'vy'), interpolate('z', 'vz')];
  }
}

/** Right-handed scene mapping: +Y north; +X vernal equinox; -Z ecliptic east. */
export function sceneAxes(position: PositionMetres): PositionMetres {
  return [position[0], position[2], -position[1]];
}

export class SimulationClock {
  utcMs: number;
  speed = 0;
  playing = true;
  constructor(nowMs = Date.now()) { this.utcMs = nowMs; }
  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 0) return;
    this.speed = speed;
  }
  /** Jumps straight to nowMs (defaults to the real current time). The UI does
   * not call this for user-facing "回到现在" actions — it animates there
   * instead (see main.ts's time-flight helpers) and only calls reset() to
   * land exactly on the target once that animation finishes. */
  reset(nowMs = Date.now()): void { this.utcMs = nowMs; }
  /** Advances by realSeconds of wall-clock time at the current speed
   * (simulated days per real second). Speed 0 holds the displayed date still:
   * dragging the speed slider back to 0 does not resync to the real current
   * time, so the last-shown date and body positions simply stay put until the
   * user speeds back up or explicitly asks to jump to now. */
  advance(realSeconds: number): void {
    if (!this.playing || this.speed === 0) return;
    if (Number.isFinite(realSeconds) && realSeconds > 0) this.utcMs += realSeconds * this.speed * DAY_MS;
  }
}
