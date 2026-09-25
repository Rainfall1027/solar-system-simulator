export const AU_METRES = 149_597_870_700;

export type PrimaryBodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

export type SatelliteId = 'moon' | 'io' | 'europa' | 'ganymede' | 'callisto';
export type BodyId = PrimaryBodyId | SatelliteId;

export interface BodyDefinition {
  readonly id: BodyId;
  readonly name: string;
  readonly massKg: number;
  readonly radiusMetres: number;
  readonly semimajorAxisMetres: number;
  readonly periodDays: number;
  readonly rotationPeriodDays: number;
  readonly color: number;
  readonly phaseRadians: number;
  readonly texturePath?: string;
  readonly heightMapPath?: string;
  readonly normalMapPath?: string;
  readonly parentId?: PrimaryBodyId;
}

export const BODIES: readonly BodyDefinition[] = [
  { id: 'sun', name: '太阳', massKg: 1.98847e30, radiusMetres: 696_340_000, semimajorAxisMetres: 0, periodDays: 0, rotationPeriodDays: 25.38, color: 0xffc66d, phaseRadians: 0, texturePath: '/textures/sun-surface.png' },
  { id: 'mercury', name: '水星', massKg: 3.30e23, radiusMetres: 2_439_500, semimajorAxisMetres: 0.38709893 * AU_METRES, periodDays: 87.969, rotationPeriodDays: 58.646, color: 0xb7a58e, phaseRadians: 0.2, texturePath: '/textures/mercury.jpg' },
  { id: 'venus', name: '金星', massKg: 4.87e24, radiusMetres: 6_051_800, semimajorAxisMetres: 0.72333199 * AU_METRES, periodDays: 224.701, rotationPeriodDays: -243.025, color: 0xe6bd83, phaseRadians: 1.4 },
  { id: 'earth', name: '地球', massKg: 5.9722e24, radiusMetres: 6_371_008.8, semimajorAxisMetres: 1.00000011 * AU_METRES, periodDays: 365.256, rotationPeriodDays: 0.99726968, color: 0x69a9ff, phaseRadians: 2.4, texturePath: '/textures/earth.jpg', normalMapPath: '/textures/earth-normal.png' },
  { id: 'mars', name: '火星', massKg: 6.42e23, radiusMetres: 3_389_500, semimajorAxisMetres: 1.52366231 * AU_METRES, periodDays: 686.98, rotationPeriodDays: 1.025957, color: 0xd77758, phaseRadians: 3.5, texturePath: '/textures/mars.jpg' },
  { id: 'jupiter', name: '木星', massKg: 1.898e27, radiusMetres: 69_911_000, semimajorAxisMetres: 5.20336301 * AU_METRES, periodDays: 4332.59, rotationPeriodDays: 0.41354, color: 0xd9ad83, phaseRadians: 4.3, texturePath: '/textures/jupiter.jpg' },
  { id: 'saturn', name: '土星', massKg: 5.683e26, radiusMetres: 58_232_000, semimajorAxisMetres: 9.53707032 * AU_METRES, periodDays: 10759.22, rotationPeriodDays: 0.44401, color: 0xe5d4a7, phaseRadians: 5.1, texturePath: '/textures/saturn.jpg' },
  { id: 'uranus', name: '天王星', massKg: 8.681e25, radiusMetres: 25_362_000, semimajorAxisMetres: 19.19126393 * AU_METRES, periodDays: 30688.5, rotationPeriodDays: -0.71833, color: 0x91dbe1, phaseRadians: 5.9, texturePath: '/textures/uranus.jpg' },
  { id: 'neptune', name: '海王星', massKg: 1.024e26, radiusMetres: 24_622_000, semimajorAxisMetres: 30.06896348 * AU_METRES, periodDays: 60182, rotationPeriodDays: 0.67125, color: 0x5d86ef, phaseRadians: 0.8, texturePath: '/textures/neptune.jpg' },
  { id: 'moon', name: '月球', massKg: 7.342e22, radiusMetres: 1_737_400, semimajorAxisMetres: 384_400_000, periodDays: 27.321661, rotationPeriodDays: 27.321661, color: 0xb8b5ae, phaseRadians: 0, texturePath: '/textures/moon.jpg', heightMapPath: '/textures/moon-height.jpg', parentId: 'earth' },
  { id: 'io', name: '木卫一', massKg: 8.9319e22, radiusMetres: 1_821_600, semimajorAxisMetres: 421_700_000, periodDays: 1.769137786, rotationPeriodDays: 1.769137786, color: 0xd8b25e, phaseRadians: 0, texturePath: '/textures/io.jpg', parentId: 'jupiter' },
  { id: 'europa', name: '木卫二', massKg: 4.7998e22, radiusMetres: 1_560_800, semimajorAxisMetres: 671_100_000, periodDays: 3.551181, rotationPeriodDays: 3.551181, color: 0xd9cbb4, phaseRadians: 0, texturePath: '/textures/europa.jpg', parentId: 'jupiter' },
  { id: 'ganymede', name: '木卫三', massKg: 1.4819e23, radiusMetres: 2_634_100, semimajorAxisMetres: 1_070_400_000, periodDays: 7.154553, rotationPeriodDays: 7.154553, color: 0x9a8a79, phaseRadians: 0, texturePath: '/textures/ganymede.jpg', parentId: 'jupiter' },
  { id: 'callisto', name: '木卫四', massKg: 1.0759e23, radiusMetres: 2_410_300, semimajorAxisMetres: 1_882_700_000, periodDays: 16.689018, rotationPeriodDays: 16.689018, color: 0x73685f, phaseRadians: 0, texturePath: '/textures/callisto.jpg', parentId: 'jupiter' }
];

export function isSatellite(body: BodyDefinition): boolean {
  return body.parentId !== undefined;
}
