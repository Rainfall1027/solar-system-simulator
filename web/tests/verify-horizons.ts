// Optional online cross-check. Normal tests run offline against the recorded fixture.
import { directPosition } from '../src/ephemeris.ts';
import type { BodyId } from '../src/bodies.ts';

const utc = '2026-09-21T00:00:00Z';
const bodies: Array<[BodyId, string]> = [['mercury', '199'], ['earth', '399'], ['jupiter', '5'], ['neptune', '8']];
for (const [id, command] of bodies) {
  const query = new URLSearchParams({
    format: 'json', COMMAND: `'${command}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS', CENTER: '500@10', REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'ICRF',
    TIME_TYPE: 'UT', START_TIME: "'2026-09-21 00:00'", STOP_TIME: "'2026-09-21 00:01'",
    STEP_SIZE: "'1 m'", OUT_UNITS: 'KM-S', VEC_TABLE: '2', VEC_CORR: 'NONE', CSV_FORMAT: 'YES'
  });
  // Horizons allows one request at a time. This deliberately stays sequential.
  const response = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${query}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Horizons HTTP ${response.status}`);
  const result = await response.json() as { result?: string; error?: string; signature?: { version: string } };
  if (result.error || !result.result?.includes('$$SOE')) throw new Error(result.error ?? 'Missing Horizons vectors');
  const row = result.result.split('$$SOE')[1].trim().split('\n')[0].split(',');
  const metres = row.slice(2, 5).map(value => Number(value) * 1000);
  const ours = directPosition(id, Date.parse(utc));
  const relativeError = Math.hypot(...ours.map((value, i) => value - metres[i])) / Math.hypot(...metres);
  console.log(JSON.stringify({ id, command, utc, metres, relativeError, apiVersion: result.signature?.version }));
  if (!Number.isFinite(relativeError) || relativeError > 0.0003) throw new Error(`Ephemeris mismatch: ${id}`);
}
