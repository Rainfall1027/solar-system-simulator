import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AU_METRES, BODIES, isSatellite, type BodyDefinition, type BodyId } from './bodies';
import { distanceToAnnulus, easeInOut, enhancedOrbitRadii, enhancedOverviewRadius, enhancedSatelliteOrbit, facingAngle, formatBeijingTime, fitDistance, focusLimits, overviewRadius, dwellAtApex, flightDurationSeconds, layerLabels, proportionalSatelliteRadius, proximityOpacity, rotationAngle, shortestAngleBlend, smoothZoomPath, subpixelDiscScale } from './view-math';
import { DAY_MS, J2000_MS, Ephemeris, SimulationClock, directPosition, sceneAxes } from './ephemeris';
import { applyMoonShadow, createMoonShadowUniforms, earthClouds, earthNightLights, gasFlow, planetAtmosphere, ringParticles, solarSurface, venusClouds, type EarthCloudEffect, type SurfaceEffect } from './surface-effects';
import { earthFixedBasis, earthLocalDirection, localEclipseTimeline, lunarEclipseTimeline, type GroundSite, type GroundTarget, type LocalEclipseTimeline } from './eclipse-sky';
import { createGroundSky, type GroundSky, type GroundSkyOptions, type GroundSkyReadout } from './ground-sky';
import { createAsteroidBelt, createKuiperBelt, createOortCloud, createSolarGlow, createStarBackdrop, type SolarGlow } from './space-effects';
import './styles.css';

const viewport = document.querySelector<HTMLElement>('#viewport');
const detailPanel = document.querySelector<HTMLElement>('#detail-panel');
const simulationTime = document.querySelector<HTMLElement>('#simulation-time');
const scaleMode = document.querySelector<HTMLElement>('#scale-mode');
const viewMode = document.querySelector<HTMLElement>('#view-mode');
const playToggle = document.querySelector<HTMLButtonElement>('#play-toggle');
const resetSimulation = document.querySelector<HTMLButtonElement>('#reset-simulation');
const cleanView = document.querySelector<HTMLButtonElement>('#clean-view');
const speedControl = document.querySelector<HTMLInputElement>('#speed-control');
const speedValue = document.querySelector<HTMLOutputElement>('#speed-value');
const enhancedModel = document.querySelector<HTMLButtonElement>('#enhanced-model');
const realModel = document.querySelector<HTMLButtonElement>('#real-model');
const modelMode = document.querySelector<HTMLElement>('#model-mode');
const lockCenter = document.querySelector<HTMLButtonElement>('#lock-center');
const lockCenterValue = document.querySelector<HTMLElement>('#lock-center-value');
const lockCenterMenu = document.querySelector<HTMLElement>('#lock-center-menu');

if (!viewport || !detailPanel || !simulationTime || !scaleMode || !viewMode || !playToggle || !resetSimulation || !cleanView || !speedControl || !speedValue || !enhancedModel || !realModel || !modelMode || !lockCenter || !lockCenterValue || !lockCenterMenu) {
  throw new Error('Solar-system application containers are missing.');
}

const appViewport: HTMLElement = viewport;
const appDetailPanel: HTMLElement = detailPanel;
const appSimulationTime: HTMLElement = simulationTime;
const appScaleMode: HTMLElement = scaleMode;
const appViewMode: HTMLElement = viewMode;
const appPlayToggle: HTMLButtonElement = playToggle;
const appResetSimulation: HTMLButtonElement = resetSimulation;
const appCleanView: HTMLButtonElement = cleanView;
const appSpeedControl: HTMLInputElement = speedControl;
const appSpeedValue: HTMLOutputElement = speedValue;
const appEnhancedModel: HTMLButtonElement = enhancedModel;
const appRealModel: HTMLButtonElement = realModel;
const appModelMode: HTMLElement = modelMode;
const appLockCenter: HTMLButtonElement = lockCenter;
const appLockCenterValue: HTMLElement = lockCenterValue;
const appLockCenterMenu: HTMLElement = lockCenterMenu;
const clockReadout = document.querySelector<HTMLOutputElement>('#clock-readout')!;
const sceneEyebrow = document.querySelector<HTMLElement>('#scene-eyebrow')!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 1200);
camera.position.set(155, 110, 250);

function createRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    appViewport.innerHTML = '<p class="graphics-error" role="alert">无法启动 3D 视图。请确认浏览器支持 WebGL 2，并开启硬件加速后刷新页面。</p>';
    throw error;
  }
}
const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appViewport.append(renderer.domElement);

const starBackdrop = createStarBackdrop();
scene.add(starBackdrop.object);
const oortCloud = createOortCloud();
scene.add(oortCloud.object);
let solarGlow: SolarGlow | null = null;

const labelLayer = document.createElement('div');
labelLayer.className = 'label-layer';
appViewport.append(labelLayer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.zoomSpeed = 0.72;
controls.zoomToCursor = false;
controls.minDistance = 8;
controls.maxDistance = 900;
controls.target.set(0, 0, 0);
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

// Space contributes essentially no useful camera-facing fill. Keep only a
// tiny floor for colour stability on the unlit hemisphere; the Sun remains
// the sole visible key light in a planetary close-up.
const ambient = new THREE.AmbientLight(0xffffff, 0.008);
scene.add(ambient);
// The Sun is the single key light for both the overview and close-up layers.
// Distance decay stays disabled because overview orbits are deliberately
// compressed; inverse-square falloff in those visual coordinates would not
// represent the physical astronomical distances used by the simulation.
const sunLight = new THREE.PointLight(0xfff4dc, 3.15, 0, 0);
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.bias = -0.00015;
scene.add(sunLight);

const WORLD_PER_METRE = 180 / (30.06896348 * AU_METRES);
const OVERVIEW_CAMERA_POSITION = new THREE.Vector3(155, 110, 250);
const ENHANCED_SUN_SCALE = 200;
const ENHANCED_EARTH_RADIUS = 1.8;
const ENHANCED_RADIUS_POWER = 0.33;
const ENHANCED_SIZE_MULTIPLIER = 6;
// Enhanced layout, recomputed from the displayed sizes (updateScaleMode):
// planet orbit radii, satellite orbit radii, and the camera framing radius.
// Framing ~72% of Neptune's orbit keeps the widened spacing visible on screen
// instead of cancelling it by zooming out to fit every orbit.
const ENHANCED_FRAME_FRACTION = 0.72;
let enhancedPlanetOrbits: number[] = [];
const enhancedSatelliteOrbits = new Map<BodyId, number>();
let enhancedFrameRadius = 360;
// Satellite names appear in the enhanced view once the parent's disc is at
// least this many pixels in radius, i.e. after zooming toward that system.
const ENHANCED_MOON_LABEL_PARENT_PX = 36;
const EARTH_RADIUS_WORLD = BODIES.find((body) => body.id === 'earth')!.radiusMetres * WORLD_PER_METRE;
const EARTH_RADIUS_METRES = BODIES.find((body) => body.id === 'earth')!.radiusMetres;
// Shared by Earth's surface and cloud shells; refreshed from the ephemeris each frame.
const moonShadowUniforms = createMoonShadowUniforms(BODIES.find((body) => body.id === 'moon')!.radiusMetres / EARTH_RADIUS_METRES);
const SUN_RADIUS_METRES = BODIES.find((body) => body.id === 'sun')!.radiusMetres;
// Earth's true orientation is split into a pole tilt on the model group and a
// spin about local +y on the surface group. Everything attached to the model
// (clouds, wind layers) keeps following `surface.rotation.y` unchanged.
const earthPole = new THREE.Vector3();
const earthTiltAxisA = new THREE.Vector3();
const earthTiltAxisB = new THREE.Vector3();
const earthGreenwichLocal = new THREE.Vector3();
const earthTiltMatrix = new THREE.Matrix4();
const earthTiltInverse = new THREE.Quaternion();
let earthOrientationUtc = Number.NaN;
let earthSpinAngle = 0;
const earthTiltScratch = new THREE.Quaternion();

/** Writes Earth's pole tilt at utcMs into `tilt` and returns its spin about local +y. */
function earthOrientationAt(utcMs: number, tilt: THREE.Quaternion): number {
  const basis = earthFixedBasis(utcMs);
  earthPole.fromArray(basis.north).normalize();
  earthTiltAxisA.set(1, 0, 0).addScaledVector(earthPole, -earthPole.x).normalize();
  earthTiltAxisB.crossVectors(earthTiltAxisA, earthPole);
  earthTiltMatrix.makeBasis(earthTiltAxisA, earthPole, earthTiltAxisB);
  tilt.setFromRotationMatrix(earthTiltMatrix);
  earthTiltInverse.copy(tilt).invert();
  earthGreenwichLocal.fromArray(basis.greenwich).applyQuaternion(earthTiltInverse);
  // Ry(angle) carries local +x (longitude 0) to (cos, 0, -sin).
  return Math.atan2(-earthGreenwichLocal.z, earthGreenwichLocal.x);
}

function orientEarth(rendered: RenderedBody, utcMs: number): void {
  if (utcMs !== earthOrientationUtc) {
    earthOrientationUtc = utcMs;
    earthSpinAngle = earthOrientationAt(utcMs, rendered.model.quaternion);
  }
  rendered.surface.rotation.y = earthSpinAngle;
}

function updateMoonShadow(): void {
  const earth = physicalPositions.get('earth');
  const moon = physicalPositions.get('moon');
  if (!earth || !moon) return;
  moonShadowUniforms.uMoonShadowMoon.value.copy(moon).sub(earth).divideScalar(EARTH_RADIUS_METRES);
  const sunDistance = earth.length();
  moonShadowUniforms.uMoonShadowSun.value.copy(earth).negate().divideScalar(sunDistance);
  moonShadowUniforms.uMoonShadowSunRadius.value = Math.asin(Math.min(SUN_RADIUS_METRES / sunDistance, 1));
}
const asteroidBelt = createAsteroidBelt(au => overviewRadius(au * AU_METRES * WORLD_PER_METRE));
const asteroidBeltInnerRadius = overviewRadius(2.06 * AU_METRES * WORLD_PER_METRE);
const asteroidBeltOuterRadius = overviewRadius(3.27 * AU_METRES * WORLD_PER_METRE);
scene.add(asteroidBelt.object);
const kuiperBelt = createKuiperBelt();
scene.add(kuiperBelt.object);
const textureLoader = new THREE.TextureLoader();
const loadedTextures = new Set<THREE.Texture>();
const sphereGeometry = new THREE.SphereGeometry(1, 64, 48);
const pickableMeshes: THREE.Mesh[] = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function loadTexture(path: string, onLoad?: (texture: THREE.Texture) => void): THREE.Texture {
  const texture = textureLoader.load(path, loaded => {
    // Upload to the GPU as soon as the image arrives. Otherwise large maps
    // (clouds, night lights) upload on the first frame they are visible,
    // which lands in the middle of a zoom-in and drops frames.
    renderer.initTexture(loaded);
    onLoad?.(loaded);
  }, undefined, () => {
    statusMessage.hidden = false;
    statusMessage.textContent = '部分表面纹理加载失败，可刷新重试。';
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  loadedTextures.add(texture);
  return texture;
}

function applyEarthRoughness(material: THREE.MeshStandardMaterial, source: THREE.Texture): void {
  const image = source.image as HTMLImageElement | undefined;
  const sourceWidth = image?.naturalWidth || image?.width || 0;
  const sourceHeight = image?.naturalHeight || image?.height || 0;
  if (!image || sourceWidth === 0 || sourceHeight === 0) return;

  // The colour photograph is not itself a valid roughness map. Derive a
  // conservative dielectric map instead: water is smoother, while land, ice
  // and cloud-coloured pixels stay rough. A non-zero ocean floor prevents the
  // pin-point glints produced by the previous colour-map shortcut.
  const width = Math.min(sourceWidth, 1024);
  const height = Math.max(1, Math.round(sourceHeight * width / sourceWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = pixels.data[offset] / 255;
    const green = pixels.data[offset + 1] / 255;
    const blue = pixels.data[offset + 2] / 255;
    const blueDominance = blue - Math.max(red, green * 0.92);
    const water = THREE.MathUtils.clamp((blueDominance - 0.025) * 5.5, 0, 1);
    const oceanRoughness = THREE.MathUtils.lerp(0.48, 0.58, THREE.MathUtils.clamp((red + green + blue) / 1.2, 0, 1));
    const roughness = THREE.MathUtils.lerp(0.88, oceanRoughness, water);
    const encoded = Math.round(roughness * 255);
    pixels.data[offset] = encoded;
    pixels.data[offset + 1] = encoded;
    pixels.data[offset + 2] = encoded;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(canvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  loadedTextures.add(roughnessMap);
  material.roughnessMap = roughnessMap;
  material.roughness = 1;
  material.needsUpdate = true;
}
const bodyById = new Map(BODIES.map(body => [body.id, body]));
const satelliteBodiesByParent = new Map<BodyId, BodyDefinition[]>();
for (const body of BODIES) {
  if (!body.parentId) continue;
  const siblings = satelliteBodiesByParent.get(body.parentId) ?? [];
  siblings.push(body);
  satelliteBodiesByParent.set(body.parentId, siblings);
}
const abortEvents = new AbortController();
const eventOptions = { signal: abortEvents.signal };
const uiElements = [...document.querySelectorAll<HTMLElement>('.observatory-header, .scope-switch-row, .system-panel, .scene-heading, .sidebar, .bottom-stage'), labelLayer];
const detailShell = document.querySelector<HTMLDetailsElement>('#detail-shell')!;
const selectedName = document.querySelector<HTMLElement>('#selected-name')!;
const interactionHint = document.querySelector<HTMLElement>('#interaction-hint')!;
const sceneHeadingTitle = document.querySelector<HTMLElement>('#scene-heading-title')!;
const sceneHeadingSubtitle = document.querySelector<HTMLElement>('#scene-heading-subtitle')!;
const catalogButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-catalog-body]')];
const catalogToggles = [...document.querySelectorAll<HTMLButtonElement>('[data-catalog-toggle]')];
const catalogSearch = document.querySelector<HTMLInputElement>('#catalog-search')!;
const experienceSwitch = document.querySelector<HTMLElement>('#experience-mode')!;
const observationModeButton = document.querySelector<HTMLButtonElement>('#observation-mode')!;
const experimentModeButton = document.querySelector<HTMLButtonElement>('#experiment-mode')!;
const wondersModeButton = document.querySelector<HTMLButtonElement>('#wonders-mode')!;
const scopeSwitch = document.querySelector<HTMLElement>('#scope-switch')!;
const scopeOverviewButton = document.querySelector<HTMLButtonElement>('#scope-overview')!;
const scopeFocusButton = document.querySelector<HTMLButtonElement>('#scope-focus')!;
const displayLayersToggle = document.querySelector<HTMLButtonElement>('#display-layers-toggle')!;
const displayLayersMenu = document.querySelector<HTMLElement>('#display-layers-menu')!;
const toggleLabelsInput = document.querySelector<HTMLInputElement>('#toggle-labels')!;
const toggleOrbitsInput = document.querySelector<HTMLInputElement>('#toggle-orbits')!;
const toggleKuiperBeltInput = document.querySelector<HTMLInputElement>('#toggle-kuiper-belt')!;
const toggleInnerOortInput = document.querySelector<HTMLInputElement>('#toggle-inner-oort')!;
const toggleOuterOortInput = document.querySelector<HTMLInputElement>('#toggle-outer-oort')!;
const workspacePanel = document.querySelector<HTMLElement>('#workspace-panel')!;
const workspaceStage = document.querySelector<HTMLElement>('#workspace-stage')!;
const simulationControls = document.querySelector<HTMLElement>('#simulation-controls')!;
const systemPanel = document.querySelector<HTMLElement>('.system-panel')!;
const catalogPanelToggle = document.querySelector<HTMLButtonElement>('#catalog-panel-toggle')!;
const sidebarPanel = document.querySelector<HTMLElement>('.sidebar')!;
const statusMessage = document.querySelector<HTMLElement>('#status-message')!;
// Cards stack above the dock only when a narrow window also has the height for it;
// short landscape windows keep the right rail (see the matching block in styles.css).
const compactLayout = window.matchMedia('(max-width: 900px) and (min-height: 561px), (max-width: 900px) and (orientation: portrait)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const diagnosticOutput = document.querySelector<HTMLOutputElement>('#performance-stats')!;
let diagnosticsEnabled = new URLSearchParams(location.search).has('diagnostics');
diagnosticOutput.hidden = !diagnosticsEnabled;

interface RenderedBody {
  readonly anchor: THREE.Group;
  readonly model: THREE.Group;
  readonly surface: THREE.Group;
  readonly effects: readonly SurfaceEffect[];
  readonly label: HTMLButtonElement;
  displayedRadius: number;
}

// One continuous camera flight: label focus, planet-to-planet switches,
// returning to the overview and the real/enhanced reframing all use it. The
// view centre and distance follow a smooth zoom-and-pan path in overview
// coordinates, on eased time, so every move starts and ends at rest with no
// intermediate stops.
interface FocusTransition {
  readonly layer: ViewLayer;                          // destination layer
  readonly bodyId: BodyDefinition['id'] | null;       // close-up destination
  readonly sourceId: BodyDefinition['id'] | null;     // body the flight leaves
  readonly startPoint: THREE.Vector3;                 // overview coordinates
  readonly startDistance: number;
  readonly startDirection: THREE.Vector3;             // unit, target to camera
  readonly endDirection: THREE.Vector3;
  readonly presenceStart: number;                     // other bodies' scale factor at start
  readonly frameOrigin: THREE.Vector3;                // overview position of the close-up origin
  duration: number;
  elapsedSeconds: number;
  switched: boolean;
}

// Real <-> enhanced morph length. Sizes, positions, orbit lines and framing
// all blend together on the same eased curve.
const MODE_MORPH_SECONDS = 1.2;

// "现在" animates the simulation clock itself from its current (possibly
// sped-up or paused-and-stale) date back to the real UTC "now", instead of
// snapping. Since every body's position is already a function of the clock,
// easing the clock brings every planet and moon smoothly back along its own
// orbit to its present-day position, with no per-body path of its own.
interface TimeFlight {
  readonly startUtcMs: number;
  readonly endUtcMs: number;
  readonly duration: number;
  readonly onLanded?: () => void;
  elapsedSeconds: number;
  // Eased 0..1 progress of the latest frame.
  eased: number;
  // Displayed spin at take-off and the true spin at the target date, per
  // body. Following the real clock through a jump of months would spin each
  // globe hundreds of times in under two seconds; instead the spin blends the
  // short way (at most half a turn) and lands exactly on the true value.
  readonly spins: Map<BodyId, { readonly start: number; readonly end: number }>;
}
type ViewLayer = 'overview' | 'focus';
const EXPERIENCE_MODES = ['observation', 'experiment', 'wonders'] as const;
type ExperienceMode = typeof EXPERIENCE_MODES[number];
type NavigationTransitionState = 'idle' | 'preparing' | 'exiting' | 'swapping' | 'entering' | 'settled';

const MOTION = {
  duration: { fast: 160, normal: 260, page: 520, enter: 420, reduced: 120 },
  delay: { enter: 70, stagger: 30 },
  distance: { micro: 2, small: 6, page: 10 },
  easing: {
    standard: 'cubic-bezier(0.22, 1, 0.36, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    micro: 'cubic-bezier(0.2, 0, 1, 1)',
  },
} as const;

const renderedBodies = new Map<BodyDefinition['id'], RenderedBody>();
let earthCloudEffect: EarthCloudEffect | null = null;
let earthLayer = 0;
let earthOverlayOpacity = 0.8;
let earthFlowAnimating = true;
const EARTH_LAYERS = ['无叠加', '云量', '风场', '洋流'] as const;
const EARTH_LAYER_DESCRIPTIONS = [
  '自然地表与常驻云层，不叠加分析流迹。',
  '突出云层覆盖；云图纹理按合成风场缓慢移动。',
  '云层与近地面风场同向流动；流线颜色表示相对强度。',
  '海表洋流示意；流迹以地表纹理遮罩陆地。'
] as const;
const renderedOrbits = new Map<BodyDefinition['id'], THREE.LineLoop>();
const orbitEpochs = new Map<BodyDefinition['id'], number>();
const physicalPositions = new Map(BODIES.map(body => [body.id, new THREE.Vector3()]));
const ephemeris = new Ephemeris();
const simulationClock = new SimulationClock();
let simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
let enhancedModelsEnabled = false;
let realOverviewCameraSnapshot: THREE.Vector3 | null = null;
let realOverviewTargetSnapshot: THREE.Vector3 | null = null;
let realOverviewLockSnapshot: BodyId | 'free' = 'sun';
let viewLayer: ViewLayer = 'overview';
let focusedBodyId: BodyDefinition['id'] | null = null;
let focusTransition: FocusTransition | null = null;
let timeFlight: TimeFlight | null = null;
// Scale factor for bodies not involved in the current flight. They shrink away
// before a close-up hides them and grow back after leaving one.
let othersPresence = 1;
// 0 = real scale, 1 = enhanced; eased with easeInOut when applied.
let modeProgress = 0;
// Detail panels are rebuilt once a flight has come to rest, not mid-motion.
let detailDirty = false;
// Physical orbit samples (scene axes, metres; satellites relative to parent),
// so switching display modes only remaps vertices instead of re-sampling.
const orbitSamples = new Map<BodyDefinition['id'], Float64Array>();
const overviewCamera = OVERVIEW_CAMERA_POSITION.clone();
const overviewTarget = new THREE.Vector3();
let overviewHomeDistance = overviewCamera.length();
const labelWorldPosition = new THREE.Vector3();
const labelViewPosition = new THREE.Vector3();
const cameraToSun = new THREE.Vector3();
let cleanMode = false;
let orbitsVisible = true;
let labelsVisible = true;
let activeExperience: ExperienceMode = 'observation';
// The scope switch's second side ("太阳系 | <body>") targets whichever body
// was last visited, so it stays useful once the overview lock is off Sun/free.
let lastViewedBodyId: BodyId = 'earth';
let activeWonderId: string | null = null;
let bodySearchQuery = '';
let kuiperBeltVisible = true;
let innerOortVisible = true;
let outerOortVisible = true;
let lastFrameTime: number | null = null;
let animationId = 0;
let lastUiUpdate = -Infinity;
let focusHomeDistance = 1;
let outwardZoomRequested = false;
let renderFailed = false;
const frameTimes: number[] = [];
const frameWork: number[] = [];
let visualSeconds = 0;
let overviewLockBodyId: BodyId | 'free' = 'sun';
const effectWorldPosition = new THREE.Vector3();
const effectViewPosition = new THREE.Vector3();
const effectSunDirection = new THREE.Vector3();

function availableSceneWidth(width: number, cleanScale: number): number {
  if (cleanMode || compactLayout.matches) return width * cleanScale;
  const occupied = systemPanel.offsetWidth + sidebarPanel.offsetWidth;
  return Math.max(200, width - occupied - 50);
}

function setCatalogGroupExpanded(group: HTMLElement, expanded: boolean): void {
  group.classList.toggle('expanded', expanded);
  const toggle = group.querySelector<HTMLButtonElement>('[data-catalog-toggle]');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(expanded));
  const groupName = group.querySelector<HTMLElement>('[data-catalog-body] span')?.textContent ?? '行星';
  toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${groupName}的卫星`);
}

function revealCatalogBody(id: BodyId): void {
  const button = catalogButtons.find(candidate => candidate.dataset.catalogBody === id);
  const group = button?.closest<HTMLElement>('.catalog-group');
  if (group) setCatalogGroupExpanded(group, true);
}

function lockCenterLabel(id: BodyId | 'free'): string {
  if (id === 'free') return '自由浏览';
  return id === 'sun' ? '太阳（默认）' : bodyById.get(id)!.name;
}

function closeLockCenterMenu(): void {
  appLockCenterMenu.hidden = true;
  appLockCenter.setAttribute('aria-expanded', 'false');
}

function selectOverviewLock(id: BodyId | 'free'): void {
  if (viewLayer !== 'overview') return;
  overviewLockBodyId = id;
  if (id === 'free') {
    overviewTarget.copy(controls.target);
  } else {
    syncLockedOverviewCenter(true);
    camera.lookAt(controls.target);
  }
  closeLockCenterMenu();
  configureCamera();
  updateNavigationMode();
}

function makeLockTarget(body: BodyDefinition | null): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'center-tree-item';
  item.setAttribute('role', 'menuitemradio');
  item.dataset.lockTarget = body?.id ?? 'free';
  item.textContent = body ? body.name : '自由浏览';
  item.addEventListener('click', () => selectOverviewLock((body?.id ?? 'free') as BodyId | 'free'), eventOptions);
  return item;
}

function buildLockCenterTree(): void {
  const satellitesByParent = new Map<BodyId, BodyDefinition[]>();
  for (const body of BODIES) {
    if (!body.parentId) continue;
    const children = satellitesByParent.get(body.parentId) ?? [];
    children.push(body);
    satellitesByParent.set(body.parentId, children);
  }
  appLockCenterMenu.replaceChildren();
  for (const body of BODIES.filter(candidate => !isSatellite(candidate))) {
    const satellites = satellitesByParent.get(body.id) ?? [];
    if (satellites.length === 0) {
      appLockCenterMenu.append(makeLockTarget(body));
      continue;
    }
    const row = document.createElement('div');
    row.className = 'center-tree-row';
    row.append(makeLockTarget(body));
    const children = document.createElement('div');
    children.className = 'center-tree-children';
    children.id = `lock-children-${body.id}`;
    children.hidden = true;
    for (const satellite of satellites) children.append(makeLockTarget(satellite));
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'center-tree-toggle';
    expand.setAttribute('aria-label', `展开${body.name}的卫星`);
    expand.setAttribute('aria-controls', children.id);
    expand.setAttribute('aria-expanded', 'false');
    // The chevron points right and rotates down when expanded (CSS).
    expand.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>';
    expand.addEventListener('click', () => {
      const opened = !children.hidden;
      children.hidden = opened;
      expand.setAttribute('aria-expanded', String(!opened));
      expand.setAttribute('aria-label', `${opened ? '展开' : '收起'}${body.name}的卫星`);
    }, eventOptions);
    row.append(expand);
    appLockCenterMenu.append(row, children);
  }
  const free = makeLockTarget(null);
  free.classList.add('center-tree-free');
  appLockCenterMenu.append(free);
}

function formatScientific(value: number, suffix: string): string {
  const [coefficient, exponent] = value.toExponential(3).split('e');
  return `${coefficient} × 10<sup>${Number(exponent)}</sup> ${suffix}`;
}

function formatDistance(value: number): string {
  if (value === 0) return '太阳中心';
  return `${(value / AU_METRES).toFixed(3)} AU`;
}

function physicalOrbitRadius(body: BodyDefinition): number {
  return body.semimajorAxisMetres * WORLD_PER_METRE;
}

function displayedOrbitRadius(body: BodyDefinition): number {
  const physicalRadius = physicalOrbitRadius(body);
  return overviewRadius(physicalRadius);
}

function focusDistanceFor(body: BodyDefinition): number {
  const height = Math.max(1, appViewport.clientHeight);
  const availableWidth = availableSceneWidth(appViewport.clientWidth, 0.88);
  const availableHeight = !cleanMode && compactLayout.matches ? height * 0.43 : height * 0.72;
  return fitDistance(extent(body), camera.fov, Math.min(availableWidth, availableHeight) / height, 0.85);
}

function beginCameraTransition(layer: ViewLayer, bodyId: BodyDefinition['id'] | null, durationSeconds?: number): void {
  const previous = focusTransition;
  const fromFocus = viewLayer === 'focus' && focusedBodyId !== null;
  const sourceId = fromFocus ? focusedBodyId : previous ? previous.bodyId ?? previous.sourceId : null;
  if (fromFocus && focusedBodyId) {
    // Continue from the close-up in overview coordinates. Other bodies start
    // at zero scale and grow in, so nothing pops into view on this frame.
    const localCamera = camera.position.clone();
    const localTarget = controls.target.clone();
    const previousId = focusedBodyId;
    othersPresence = 0;
    setViewLayer('overview', null, true);
    const origin = renderedBodies.get(previousId)!.anchor.position;
    camera.position.copy(localCamera).add(origin);
    controls.target.copy(localTarget).add(origin);
  }
  // Only a genuine overview departure records the overview framing. When one
  // close-up hands over to another, the camera is still at close-up range and
  // must not replace the saved overview angle.
  if (!previous && !fromFocus && viewLayer === 'overview' && layer === 'focus') {
    overviewCamera.copy(camera.position);
    overviewTarget.copy(controls.target);
  }
  // Flush input inertia once, before taking the animation snapshot. Never let
  // OrbitControls clamp or damp the programmatic flight on later frames.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  controls.enabled = false;
  outwardZoomRequested = false;
  const startPoint = controls.target.clone();
  const startOffset = camera.position.clone().sub(startPoint);
  const startDistance = Math.max(startOffset.length(), 1e-9);
  const startDirection = startOffset.lengthSq() > 0 ? startOffset.normalize() : OVERVIEW_CAMERA_POSITION.clone().normalize();
  const overviewOffset = overviewCamera.clone().sub(overviewTarget);
  const endDirection = layer === 'focus' || overviewOffset.lengthSq() === 0
    ? startDirection.clone()
    : overviewOffset.normalize();
  const transition: FocusTransition = {
    layer, bodyId, sourceId,
    startPoint, startDistance, startDirection, endDirection,
    presenceStart: othersPresence,
    frameOrigin: new THREE.Vector3(),
    duration: 1,
    elapsedSeconds: 0,
    switched: false,
  };
  const { path } = flightPath(transition);
  transition.duration = reducedMotion.matches ? 0.12 : durationSeconds ?? flightDurationSeconds(path.length);
  focusTransition = transition;
  if (layer === 'focus' && bodyId) {
    const name = bodyById.get(bodyId)!.name;
    sceneHeadingTitle.textContent = name;
    sceneHeadingSubtitle.textContent = `正在接近${name}`;
    appViewMode.textContent = `正在接近${name} · 连续放大`;
  }
  labelLayer.inert = true;
  labelLayer.style.opacity = '0';
}

// Destination of a flight in overview coordinates (fixed once the close-up
// layer has taken over), with the zoom-and-pan path from the start view.
function flightPath(transition: FocusTransition) {
  let point: THREE.Vector3;
  let distance: number;
  if (transition.layer === 'focus' && transition.bodyId) {
    point = transition.switched ? transition.frameOrigin : renderedBodies.get(transition.bodyId)!.anchor.position;
    distance = focusDistanceFor(bodyById.get(transition.bodyId)!);
  } else {
    const locked = overviewLockBodyId === 'free' ? null : renderedBodies.get(overviewLockBodyId);
    point = locked ? locked.anchor.position : overviewTarget;
    distance = overviewCamera.distanceTo(overviewTarget);
  }
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const path = smoothZoomPath(transition.startDistance * height, Math.max(distance, 1e-9) * height, transition.startPoint.distanceTo(point));
  return { point, path, height };
}

function extent(body: BodyDefinition): number {
  return renderedBodies.get(body.id)!.displayedRadius * (body.id === 'saturn' ? 2.25 : 1);
}

function configureOverviewCameraLimits(): void {
  const locked = overviewLockBodyId === 'free' ? null : renderedBodies.get(overviewLockBodyId);
  const bounds = locked && overviewLockBodyId !== 'free' ? extent(bodyById.get(overviewLockBodyId)!) : 0;
  const width = Math.max(1, appViewport.clientWidth);
  const height = Math.max(1, appViewport.clientHeight);
  const availableWidth = availableSceneWidth(width, 0.9);
  const availableHeight = !cleanMode && compactLayout.matches ? height * 0.44 : height * 0.9;
  // Even while zooming from the overview, stop at a full-disc composition.
  // This avoids clipping through low-altitude texture and atmosphere shells.
  controls.minDistance = bounds ? fitDistance(bounds, camera.fov, Math.min(availableWidth, availableHeight) / height, 0.92) : 1e-6;
  controls.maxDistance = Math.max(2500, overviewHomeDistance * 3);
  camera.near = overviewNearPlane();
  camera.far = Math.max(1600, overviewHomeDistance * 5);
}

// The overview spans both AU-scale orbits and sub-millimetre true radii. A
// fixed near plane small enough for a close planet (the old 1e-8 against a
// 1600 far plane) leaves the depth buffer no precision for everything else.
// Push the near plane out to half the distance of the closest visible surface.
function overviewNearPlane(): number {
  let nearestSurface = Infinity;
  for (const [id, rendered] of renderedBodies) {
    if (!rendered.model.visible) continue;
    // model.scale includes the temporary screen-size floor used during a
    // focus transition, so an inflated sphere is never clipped.
    const radius = rendered.model.scale.x * (id === 'saturn' ? 2.25 : 1);
    nearestSurface = Math.min(nearestSurface, camera.position.distanceTo(rendered.anchor.position) - radius);
  }
  const targetDistance = camera.position.distanceTo(controls.target);
  return THREE.MathUtils.clamp(Math.min(nearestSurface * 0.5, targetDistance * 0.1), 1e-9, 10);
}

function updateOverviewClipPlanes(): void {
  if (viewLayer !== 'overview') return;
  const near = overviewNearPlane();
  if (Math.abs(near - camera.near) <= camera.near * 0.02) return;
  camera.near = near;
  camera.updateProjectionMatrix();
}

function viewModeText(): string {
  if (viewLayer === 'focus') return '行星近景层 · 向外滚轮可返回概览';
  if (enhancedModelsEnabled) return orbitsVisible ? '视觉增强 · 星历方位 / 扩展间距' : '视觉增强 · 轨道已隐藏';
  return orbitsVisible ? '概览层 · 轨道距离压缩展示' : '概览层 · 轨道已隐藏';
}

function configureCamera(): void {
  if (viewLayer === 'overview' || !focusedBodyId) {
    configureOverviewCameraLimits();
  } else {
    const body = bodyById.get(focusedBodyId)!;
    const bounds = extent(body);
    focusHomeDistance = focusDistanceFor(body);
    const limits = focusLimits(renderedBodies.get(body.id)!.displayedRadius, focusHomeDistance);
    controls.minDistance = limits.min;
    controls.maxDistance = limits.max;
    camera.near = limits.near;
    camera.far = Math.max(limits.max * 2, bounds * 50);
    const shadow = sunLight.shadow.camera;
    shadow.near = bounds * 0.1;
    shadow.far = bounds * 1100;
    shadow.updateProjectionMatrix();
    sunLight.shadow.normalBias = bounds * 0.002;
  }
  camera.updateProjectionMatrix();
}

function setViewLayer(layer: ViewLayer, bodyId: BodyDefinition['id'] | null = null, deferDetail = Boolean(focusTransition)): void {
  // Each detail visit starts from the natural Earth view. Clear analysis
  // overlays before the camera leaves, including planet-to-planet flights.
  resetEarthAnalysis();
  viewLayer = layer;
  focusedBodyId = bodyId;
  labelLayer.inert = cleanMode || !labelsVisible || Boolean(focusTransition) || layer === 'focus';
  if (layer === 'focus') controls.target.set(0, 0, 0);
  for (const body of BODIES) {
    const rendered = renderedBodies.get(body.id);
    if (!rendered) continue;
    rendered.model.visible = layer === 'overview' || body.id === bodyId;
    // Expensive surface detail is reset while layers switch. Continuous
    // shells such as atmospheres remain attached so their thickness cannot
    // pop when the camera crosses a screen-size threshold.
    for (const effect of rendered.effects) {
      if (!effect.continuous) effect.setVisible(false);
    }
    const orbit = renderedOrbits.get(body.id);
    if (orbit) orbit.visible = orbitsVisible && layer === 'overview';
  }
  appViewMode.textContent = viewModeText();
  sunLight.visible = layer === 'overview' || bodyId !== 'sun';
  asteroidBelt.object.visible = layer === 'overview' && !enhancedModelsEnabled;
  kuiperBelt.object.visible = layer === 'overview' && kuiperBeltVisible;
  oortCloud.object.visible = layer === 'overview';
  sunLight.castShadow = layer === 'focus' && bodyId === 'saturn';
  renderer.shadowMap.enabled = sunLight.castShadow;
  document.body.dataset.view = layer;
  updateScaleMode();
  configureCamera();
  updateOrbitalPositions();
  if (layer === 'overview' && overviewLockBodyId !== 'free') syncLockedOverviewCenter(false);
  else if (layer === 'overview') controls.target.copy(overviewTarget);
  updateNavigationMode();
  // Rebuilding the detail card relayouts the translucent sidebar. During a
  // flight that is deferred until the camera has come to rest.
  if (deferDetail) detailDirty = true;
  else refreshDetailPanel();
}

function refreshDetailPanel(): void {
  detailDirty = false;
  if (viewLayer === 'focus' && focusedBodyId) showBodyDetail(bodyById.get(focusedBodyId)!);
  else showOverviewDetail();
}

function syncLockedOverviewCenter(moveCamera: boolean): void {
  if (viewLayer !== 'overview' || overviewLockBodyId === 'free') return;
  const rendered = renderedBodies.get(overviewLockBodyId);
  if (!rendered) return;
  const cameraDelta = rendered.anchor.position.clone().sub(controls.target);
  const savedDelta = rendered.anchor.position.clone().sub(overviewTarget);
  controls.target.copy(rendered.anchor.position);
  overviewTarget.copy(rendered.anchor.position);
  overviewCamera.add(savedDelta);
  if (moveCamera && cameraDelta.lengthSq() > 0) {
    camera.position.add(cameraDelta);
  }
}

function updateNavigationMode(): void {
  const freeOverview = viewLayer === 'overview' && overviewLockBodyId === 'free';
  controls.enablePan = viewLayer === 'overview';
  controls.screenSpacePanning = true;
  controls.zoomToCursor = freeOverview;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  appLockCenter.disabled = viewLayer !== 'overview';
  appLockCenterValue.textContent = lockCenterLabel(overviewLockBodyId);
  if (viewLayer !== 'overview') closeLockCenterMenu();
  for (const element of appLockCenterMenu.querySelectorAll<HTMLElement>('[data-lock-target]')) {
    element.setAttribute('aria-current', String(element.dataset.lockTarget === overviewLockBodyId));
  }
  const catalogTarget = viewLayer === 'focus' ? focusedBodyId : overviewLockBodyId === 'free' ? null : overviewLockBodyId;
  for (const button of catalogButtons) {
    button.setAttribute('aria-current', String(button.dataset.catalogBody === catalogTarget));
  }
  const lockedName = overviewLockBodyId === 'free' ? '' : bodyById.get(overviewLockBodyId)!.name;
  interactionHint.textContent = viewLayer === 'focus'
    ? '近景已锁定中心 · 右键旋转 · 滚轮缩放 · Esc 返回'
    : overviewLockBodyId !== 'free'
      ? `已锁定${lockedName} · 滚轮以其为中心缩放 · 左键平移可解除锁定 · 右键旋转`
      : '自由浏览 · 左键平移 · 右键旋转 · 滚轮无级缩放';
  updateScopeSwitch();
}

// The body the scope switch's second side names and would focus: the
// close-up target when already in one, else the overview lock (skipping the
// Sun/free defaults, which the "太阳系" side already covers), else the last
// body actually visited.
function scopeFocusTargetId(): BodyId {
  if (viewLayer === 'focus' && focusedBodyId) return focusedBodyId;
  if (overviewLockBodyId !== 'free' && overviewLockBodyId !== 'sun') return overviewLockBodyId;
  return lastViewedBodyId;
}

function updateScopeSwitch(): void {
  if (activeExperience === 'wonders') {
    const showingWonder = activeWonderId !== null;
    scopeFocusButton.textContent = activeOrDefaultWonder().name;
    scopeOverviewButton.setAttribute('aria-pressed', String(!showingWonder));
    scopeFocusButton.setAttribute('aria-pressed', String(showingWonder));
    scopeSwitch.dataset.mode = showingWonder ? 'focus' : 'overview';
    return;
  }
  const inFocus = viewLayer === 'focus';
  scopeFocusButton.textContent = bodyById.get(scopeFocusTargetId())!.name;
  scopeOverviewButton.setAttribute('aria-pressed', String(!inFocus));
  scopeFocusButton.setAttribute('aria-pressed', String(inFocus));
  scopeSwitch.dataset.mode = inFocus ? 'focus' : 'overview';
}

function returnToOverview(): void {
  groundRequest = null;
  if (leaveGround(returnToOverview)) return;
  if (viewLayer === 'overview' && focusTransition?.layer !== 'focus') return;
  beginCameraTransition('overview', null);
}

function showOverviewDetail(): void {
  detailShell.open = false;
  selectedName.textContent = '天体数据笔记';
  sceneHeadingTitle.textContent = '太阳系';
  sceneHeadingSubtitle.textContent = enhancedModelsEnabled
    ? '太阳与八大行星 · 星历方位，增强大小与间距'
    : '太阳与八大行星 · UTC 实时星历';
  appDetailPanel.innerHTML = `
    <p class="eyebrow">SOLAR SYSTEM · OVERVIEW</p>
    <h2>太阳系概览</h2>
    <p>${enhancedModelsEnabled
      ? '视觉增强模式保留当前星历方位，只拉开显示距离并放大天体；距离与半径不再同比例。点击名称进入近景，切回真实比例模型可查看星历轨道。'
      : '点击名称或天体进入近景。概览压缩距离，白线是附近一公转周期的星历轨道采样；速度滑块最左侧静止、保持当前时刻，向右加速，点击"现在"可平滑回到当前 UTC。天体大小开关不改变星历数据。'}</p>
    <dl class="body-facts">
      <div><dt>当前目标</dt><dd id="coord-body"></dd></div>
      <div><dt>UTC 时刻</dt><dd id="coord-time"></dd></div>
      <div><dt>黄道 X</dt><dd id="coord-x"></dd></div>
      <div><dt>黄道 Y</dt><dd id="coord-y"></dd></div>
      <div><dt>黄道 Z</dt><dd id="coord-z"></dd></div>
    </dl>
    <p class="detail-note">坐标来自 Astronomy Engine 星历估算，单位为天文单位（AU）。</p>
    <p class="detail-note">海王星外的柯伊伯带约 30–50 AU。内奥尔特云（希尔斯云）与外奥尔特云仍属推测；稀疏标记仅示意分布，不是发光星云，外围距离和小天体尺寸都非同比例。行星位置来自 Astronomy Engine 星历估算；尚未接入可修改质量的 C 动力学。</p>`;
  updateDataCoords();
}

function setCleanView(enabled: boolean): void {
  cleanMode = enabled;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.body.classList.toggle('clean-view', enabled);
  appCleanView.setAttribute('aria-pressed', String(enabled));
  for (const element of uiElements) element.inert = enabled;
  labelLayer.inert = enabled || !labelsVisible || Boolean(focusTransition) || viewLayer === 'focus';
  resize();
}

function earthLayerMarkup(): string {
  return `<section class="earth-weather-layers" aria-label="地球分析图层">
    <div class="earth-weather-heading"><span>地球图层</span><small>合成示意 · 非实时天气</small></div>
    <div class="earth-layer-switch segmented" role="group" aria-label="覆盖图层" style="--layer-index:${earthLayer}">
      <span class="earth-layer-thumb segmented-thumb" aria-hidden="true"></span>
      ${EARTH_LAYERS.map((name, index) => `<button type="button" data-earth-layer="${index}" aria-pressed="${earthLayer === index}">${name}</button>`).join('')}
    </div>
    <p class="earth-layer-description" id="earth-layer-description" aria-live="polite">${EARTH_LAYER_DESCRIPTIONS[earthLayer]}</p>
    <div class="earth-layer-legend" id="earth-layer-legend" data-layer="${earthLayer}" ${earthLayer === 0 ? 'hidden' : ''}>
      <div class="earth-legend-heading"><span>${earthLayer === 1 ? '相对云量' : '相对流速'}</span><span>仅视觉示意 · 无物理单位</span></div>
      <div class="earth-legend-gradient" aria-hidden="true"></div>
      <div class="earth-legend-range"><span>低</span><span>高</span></div>
    </div>
    <div class="earth-layer-tools">
      <button type="button" id="earth-flow-animation" aria-pressed="${earthFlowAnimating}">${earthFlowAnimating ? 'Ⅱ 暂停流动' : '▶ 播放流动'}</button>
      <label for="earth-overlay-opacity">强度 <span id="earth-opacity-value">${Math.round(earthOverlayOpacity * 100)}%</span></label>
      <input id="earth-overlay-opacity" type="range" min="20" max="100" step="5" value="${Math.round(earthOverlayOpacity * 100)}" style="--progress:${(earthOverlayOpacity - 0.2) / 0.8 * 100}%" aria-label="分析图层强度" />
    </div>
  </section>`;
}

function refreshEarthLayerControls(): void {
  const switcher = appDetailPanel.querySelector<HTMLElement>('.earth-layer-switch');
  if (switcher) switcher.style.setProperty('--layer-index', String(earthLayer));
  appDetailPanel.querySelectorAll<HTMLButtonElement>('[data-earth-layer]').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.earthLayer) === earthLayer));
  });
  const description = appDetailPanel.querySelector<HTMLElement>('#earth-layer-description');
  if (description) description.textContent = EARTH_LAYER_DESCRIPTIONS[earthLayer];
  const legend = appDetailPanel.querySelector<HTMLElement>('#earth-layer-legend');
  if (legend) {
    legend.hidden = earthLayer === 0;
    legend.dataset.layer = String(earthLayer);
    const heading = legend.querySelector<HTMLElement>('.earth-legend-heading span');
    if (heading) heading.textContent = earthLayer === 1 ? '相对云量' : '相对流速';
  }
  earthCloudEffect?.setLayer(earthLayer);
}

function resetEarthAnalysis(): void {
  earthLayer = 0;
  refreshEarthLayerControls();
  // Do not let the usual 0.7 s layer crossfade leave flow traces visible
  // after the detail view is gone.
  earthCloudEffect?.setLayer(0, true);
}

function showBodyDetail(body: BodyDefinition): void {
  detailShell.open = true;
  const parent = body.parentId ? bodyById.get(body.parentId) : null;
  selectedName.textContent = `${body.name} · 数据笔记`;
  sceneHeadingTitle.textContent = body.name;
  sceneHeadingSubtitle.textContent = parent
    ? `${parent.name}卫星系统 · 星历跟踪`
    : `${body.periodDays === 0 ? '太阳系中心恒星' : '太阳系主要天体'} · 星历跟踪`;
  appDetailPanel.innerHTML = `
    <p class="eyebrow">${body.id.toUpperCase()} · 星历位置</p>
    <h2>${body.name}</h2>
    ${body.id === 'earth' ? earthLayerMarkup() : ''}
    <dl class="body-facts">
      <div><dt>质量</dt><dd>${formatScientific(body.massKg, 'kg')}</dd></div>
      <div><dt>平均半径</dt><dd>${(body.radiusMetres / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} km</dd></div>
      <div><dt>${parent ? `距${parent.name}轨道半径` : '平均轨道半径'}</dt><dd>${parent ? `${(body.semimajorAxisMetres / 1000).toLocaleString('zh-CN')} km` : formatDistance(body.semimajorAxisMetres)}</dd></div>
      ${parent ? `<div><dt>所属系统</dt><dd>${parent.name}卫星系统</dd></div>` : ''}
      <div><dt>当前日距</dt><dd id="current-sun-distance">${formatDistance(physicalPositions.get(body.id)!.length())}</dd></div>
      <div><dt>公转周期</dt><dd>${body.periodDays === 0 ? '—' : `${body.periodDays.toLocaleString('zh-CN')} 天`}</dd></div>
      <div><dt>自转周期</dt><dd>${Math.abs(body.rotationPeriodDays).toLocaleString('zh-CN', { maximumFractionDigits: 5 })} 天${body.rotationPeriodDays < 0 ? '（逆行）' : ''}</dd></div>
      <div><dt>UTC 时刻</dt><dd id="coord-time"></dd></div>
      <div><dt>黄道 X</dt><dd id="coord-x"></dd></div>
      <div><dt>黄道 Y</dt><dd id="coord-y"></dd></div>
      <div><dt>黄道 Z</dt><dd id="coord-z"></dd></div>
    </dl>
    <p class="detail-note">近景居中跟随。云层、等离子体、气流与星环粒子为视觉示意，不代表实时气象或粒子观测。</p>
    <p class="detail-note">纹理与数据：NASA SVS / Earth Observatory、NASA/JPL/USGS、Celestia Content；星历：Astronomy Engine。</p>`;
  appDetailPanel.querySelectorAll<HTMLButtonElement>('[data-earth-layer]').forEach(button => button.addEventListener('click', () => {
    earthLayer = Number(button.dataset.earthLayer);
    refreshEarthLayerControls();
  }));
  appDetailPanel.querySelector<HTMLButtonElement>('#earth-flow-animation')?.addEventListener('click', event => {
    earthFlowAnimating = !earthFlowAnimating;
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute('aria-pressed', String(earthFlowAnimating));
    button.textContent = earthFlowAnimating ? 'Ⅱ 暂停流动' : '▶ 播放流动';
    earthCloudEffect?.setAnimationPlaying(earthFlowAnimating);
  });
  appDetailPanel.querySelector<HTMLInputElement>('#earth-overlay-opacity')?.addEventListener('input', event => {
    const slider = event.currentTarget as HTMLInputElement;
    earthOverlayOpacity = Number(slider.value) / 100;
    slider.style.setProperty('--progress', `${(earthOverlayOpacity - 0.2) / 0.8 * 100}%`);
    const value = appDetailPanel.querySelector<HTMLElement>('#earth-opacity-value');
    if (value) value.textContent = `${Math.round(earthOverlayOpacity * 100)}%`;
    earthCloudEffect?.setOverlayOpacity(earthOverlayOpacity);
  });
  updateDataCoords();
}

function focusBody(body: BodyDefinition): void {
  groundRequest = null;
  if (leaveGround(() => focusBody(body))) return;
  if (focusTransition?.layer === 'focus' && focusTransition.bodyId === body.id) return;
  if (viewLayer === 'focus' && focusedBodyId === body.id && !focusTransition) return;
  revealCatalogBody(body.id);
  // One flight covers every case: from the overview, from another close-up
  // (it rises until both bodies fit, pans, then descends) or re-targeted
  // mid-flight (it continues from the current view). The lock follows every
  // label focus, so leaving the close-up returns centred on this body.
  beginCameraTransition('focus', body.id);
  if (!enhancedModelsEnabled) overviewLockBodyId = body.id;
  lastViewedBodyId = body.id;
  updateNavigationMode();
}

// Displayed radius in the visual-enhancement mode. Planets are enlarged on a
// compressed power law; satellites keep their true ratio to their planet.
function enhancedDisplayRadius(body: BodyDefinition): number {
  const realRadius = body.radiusMetres * WORLD_PER_METRE;
  const parent = body.parentId ? bodyById.get(body.parentId)! : null;
  const primaryRadius = (parent?.radiusMetres ?? body.radiusMetres) * WORLD_PER_METRE;
  const enhancedPrimaryRadius = ENHANCED_EARTH_RADIUS
    * Math.pow(primaryRadius / EARTH_RADIUS_WORLD, ENHANCED_RADIUS_POWER);
  const radius = body.id === 'sun'
    ? realRadius * ENHANCED_SUN_SCALE
    : parent
      ? proportionalSatelliteRadius(enhancedPrimaryRadius, parent.radiusMetres, body.radiusMetres)
      : enhancedPrimaryRadius;
  return radius * ENHANCED_SIZE_MULTIPLIER;
}

function updateScaleMode(): void {
  for (const body of BODIES) {
    const rendered = renderedBodies.get(body.id);
    if (!rendered) continue;
    const realRadius = body.radiusMetres * WORLD_PER_METRE;
    // Blend radii linearly: real-scale planets start below one pixel, so the
    // enhanced discs visibly grow from the first frames of the morph. (A
    // logarithmic blend keeps them invisible until late, then balloons them.)
    const blend = easeInOut(modeProgress);
    const displayedRadius = blend === 0 ? realRadius
      : realRadius + (enhancedDisplayRadius(body) - realRadius) * blend;
    rendered.model.scale.setScalar(displayedRadius);
    rendered.displayedRadius = displayedRadius;
  }
  updateEnhancedLayout();
  appScaleMode.innerHTML = enhancedModelsEnabled
    ? '<i class="dot enhanced"></i>视觉增强 · 非同比例'
    : viewLayer === 'overview'
      ? '<i class="dot strict"></i>真实半径 · 概览距离压缩'
      : '<i class="dot strict"></i>真实半径 · 行星近景';
}

function setEnhancedModels(enabled: boolean): void {
  if (enabled === enhancedModelsEnabled) return;
  if (viewLayer === 'overview' && !focusTransition) {
    // The saved overview framing is only refreshed on leaving the overview;
    // start from what is on screen now so the view direction is kept.
    overviewCamera.copy(camera.position);
    overviewTarget.copy(controls.target);
  }
  if (enabled) {
    realOverviewCameraSnapshot = overviewCamera.clone();
    realOverviewTargetSnapshot = overviewTarget.clone();
    realOverviewLockSnapshot = overviewLockBodyId;
    overviewLockBodyId = 'free';
    // Retain the viewer's current direction. Enhanced coordinates still orbit
    // the real Sun, rather than forming a camera-facing editorial lineup.
    overviewCamera.sub(overviewTarget).normalize()
      .multiplyScalar(overviewHomeDistance * enhancedFrameRadius / 180 * 1.04);
    overviewTarget.set(0, 0, 0);
  } else {
    overviewLockBodyId = realOverviewLockSnapshot;
    if (realOverviewCameraSnapshot) overviewCamera.copy(realOverviewCameraSnapshot);
    if (realOverviewTargetSnapshot) overviewTarget.copy(realOverviewTargetSnapshot);
    realOverviewCameraSnapshot = null;
    realOverviewTargetSnapshot = null;
  }
  enhancedModelsEnabled = enabled;
  appModelMode.dataset.mode = enabled ? 'enhanced' : 'real';
  appEnhancedModel.setAttribute('aria-pressed', String(enabled));
  appRealModel.setAttribute('aria-pressed', String(!enabled));
  if (viewLayer === 'overview') appViewMode.textContent = viewModeText();
  if (viewLayer === 'overview') sceneHeadingSubtitle.textContent = enabled
    ? '太阳与八大行星 · 星历方位，增强大小与间距'
    : '太阳与八大行星 · UTC 实时星历';
  // Sizes, positions and orbit lines morph in updateModeMorph. In the
  // overview the camera glides to the new framing over the same time; a
  // flight already heading into a close-up keeps going and adapts to the
  // changing sizes on its own.
  if (viewLayer === 'overview' && focusTransition?.layer !== 'focus') {
    beginCameraTransition('overview', null, MODE_MORPH_SECONDS);
  }
  updateNavigationMode();
  for (const orbit of renderedOrbits.values()) {
    orbit.visible = orbitsVisible && viewLayer === 'overview';
  }
}

// Advances the real <-> enhanced morph. Returns whether anything changed.
function updateModeMorph(elapsedSeconds: number): boolean {
  const target = enhancedModelsEnabled ? 1 : 0;
  if (modeProgress === target) return false;
  const focused = viewLayer === 'focus' && focusedBodyId ? bodyById.get(focusedBodyId)! : null;
  const previousExtent = focused ? extent(focused) : 0;
  const step = reducedMotion.matches ? 1 : elapsedSeconds / MODE_MORPH_SECONDS;
  modeProgress = target > modeProgress ? Math.min(target, modeProgress + step) : Math.max(target, modeProgress - step);
  updateScaleMode();
  updateOrbitalPositions();
  for (const body of BODIES) if (orbitSamples.has(body.id)) writeOrbitVertices(body);
  if (focused && !focusTransition) {
    // The close-up is centred on the body: scale the whole local framing,
    // including any pan of the target, with the body's changing size.
    const ratio = extent(focused) / previousExtent;
    camera.position.multiplyScalar(ratio);
    controls.target.multiplyScalar(ratio);
  }
  configureCamera();
  return true;
}

function updateLabelPositions(): void {
  if (cleanMode || focusTransition || !labelsVisible || viewLayer === 'focus') return;
  const width = appViewport.clientWidth;
  const height = appViewport.clientHeight;
  const labelHomeDistance = enhancedModelsEnabled
    ? overviewHomeDistance * enhancedFrameRadius / 180 * 1.04
    : overviewHomeDistance;
  const overviewDistanceRatio = camera.position.distanceTo(controls.target) / Math.max(labelHomeDistance, 1e-8);
  const fadeProgress = viewLayer === 'overview'
    ? THREE.MathUtils.clamp((overviewDistanceRatio - 1.12) / 0.3, 0, 1)
    : 0;
  const labelOpacity = 1 - easeInOut(fadeProgress);
  const labelsReadable = labelOpacity > 0.02;
  labelLayer.style.setProperty('--distance-opacity', labelOpacity.toFixed(3));
  labelLayer.inert = !labelsReadable;
  const labels: { label: HTMLButtonElement; x: number; y: number; width: number; height: number; depth: number }[] = [];
  for (const [id, rendered] of renderedBodies) {
    const body = bodyById.get(id)!;
    if (!labelsReadable) {
      rendered.label.hidden = true;
      continue;
    }
    if (viewLayer === 'overview' && body.parentId) {
      // Moon names are revealed only when the viewer moves closer to a
      // planetary system, keeping the nine-body composition legible. The
      // enhanced view packs satellites tightly, so it waits until the parent's
      // disc itself is large on screen; the real-scale view waits until the
      // satellite's orbit is resolvable.
      const parent = renderedBodies.get(body.parentId)!;
      parent.anchor.getWorldPosition(labelWorldPosition);
      labelViewPosition.copy(labelWorldPosition).applyMatrix4(camera.matrixWorldInverse);
      const parentDepth = -labelViewPosition.z;
      const pixelsPerUnit = parentDepth > 0
        ? height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * parentDepth)
        : 0;
      const resolved = enhancedModelsEnabled
        ? parent.displayedRadius * pixelsPerUnit >= ENHANCED_MOON_LABEL_PARENT_PX
        : rendered.anchor.position.distanceTo(parent.anchor.position) * pixelsPerUnit >= 28;
      if (!resolved) {
        rendered.label.hidden = true;
        continue;
      }
    }
    rendered.anchor.getWorldPosition(labelWorldPosition);
    labelViewPosition.copy(labelWorldPosition).applyMatrix4(camera.matrixWorldInverse);
    const depth = -labelViewPosition.z;
    labelWorldPosition.project(camera);
    const isVisible = depth > camera.near && labelWorldPosition.z >= -1 && labelWorldPosition.z <= 1
      && labelWorldPosition.x >= -1.12 && labelWorldPosition.x <= 1.12
      && labelWorldPosition.y >= -1.12 && labelWorldPosition.y <= 1.12;
    rendered.label.hidden = !isVisible;
    if (isVisible) {
      const x = (labelWorldPosition.x * 0.5 + 0.5) * width;
      const projectedRadius = rendered.displayedRadius * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth);
      const subpixel = id !== 'sun' && projectedRadius < 1.5;
      rendered.label.dataset.subpixel = String(subpixel);
      const y = (-labelWorldPosition.y * 0.5 + 0.5) * height - (subpixel ? 2 : projectedRadius + 14);
      labels.push({ label: rendered.label, x, y, width: rendered.label.offsetWidth, height: rendered.label.offsetHeight, depth });
    }
  }
  for (const item of layerLabels(labels)) {
    item.label.style.transform = `translate(-50%, -100%) translate(${item.x}px, ${item.y}px)`;
    item.label.style.zIndex = String(item.layer);
    item.label.dataset.occluded = String(item.occluded);
  }
}

function updateOrbitAppearance(): void {
  if (viewLayer !== 'overview') return;
  const distanceRatio = camera.position.distanceTo(controls.target) / Math.max(overviewHomeDistance, 1e-8);
  const closeViewFade = THREE.MathUtils.smoothstep(distanceRatio, 0.18, 0.72);
  for (const [id, orbit] of renderedOrbits) {
    const body = bodyById.get(id)!;
    const material = orbit.material as THREE.LineBasicMaterial;
    const blend = easeInOut(modeProgress);
    const baseOpacity = body.parentId ? 0.045 + (0.08 - 0.045) * blend : 0.14 + (0.19 - 0.14) * blend;
    material.opacity = baseOpacity * closeViewFade * othersPresence;
  }
}

// Derives the enhanced layout from the enhanced display radii: satellite
// systems are packed near their planet, then each planet's footprint (disc,
// rings or satellite system) decides how much room it needs in the lineup.
function updateEnhancedLayout(): void {
  const enhancedRadius = enhancedDisplayRadius;
  enhancedSatelliteOrbits.clear();
  const footprints: number[] = [];
  for (const planet of BODIES.filter(body => !body.parentId && body.id !== 'sun')) {
    const planetRadius = enhancedRadius(planet);
    let footprint = planetRadius * (planet.id === 'saturn' ? 2.25 : 1);
    const satellites = satelliteBodiesByParent.get(planet.id) ?? [];
    const innermost = Math.min(...satellites.map(satellite => satellite.semimajorAxisMetres));
    for (const satellite of satellites) {
      const satelliteRadius = enhancedRadius(satellite);
      const orbit = enhancedSatelliteOrbit(planetRadius, satelliteRadius, satellite.semimajorAxisMetres / innermost);
      enhancedSatelliteOrbits.set(satellite.id, orbit);
      footprint = Math.max(footprint, orbit + satelliteRadius);
    }
    footprints.push(footprint);
  }
  const sunFootprint = enhancedRadius(bodyById.get('sun')!) * 1.12;
  enhancedPlanetOrbits = enhancedOrbitRadii(sunFootprint, footprints);
  enhancedFrameRadius = enhancedPlanetOrbits.at(-1)! * ENHANCED_FRAME_FRACTION;
}

function enhancedSatelliteOrbitRadius(body: BodyDefinition): number {
  return enhancedSatelliteOrbits.get(body.id)!;
}

function updateOrbitalPositions(): void {
  for (const body of BODIES) {
    const rendered = renderedBodies.get(body.id);
    if (!rendered) continue;
    const coordinates = sceneAxes(ephemeris.position(body.id, simulationClock.utcMs));
    const physical = physicalPositions.get(body.id)!.set(...coordinates);
    if (viewLayer === 'focus' || body.id === 'sun') {
      rendered.anchor.position.set(0, 0, 0);
      continue;
    }
    // Real-scale and enhanced placements are both computed and blended, so the
    // mode switch morphs every body along a straight, continuous path.
    const blend = easeInOut(modeProgress);
    if (body.parentId) {
      const parentPhysical = physicalPositions.get(body.parentId)!;
      const parentRendered = renderedBodies.get(body.parentId)!;
      const relative = physical.clone().sub(parentPhysical);
      const realScale = WORLD_PER_METRE;
      const enhancedScale = blend === 0 ? realScale : enhancedSatelliteOrbitRadius(body) / Math.max(relative.length(), 1e-9);
      rendered.anchor.position.copy(parentRendered.anchor.position)
        .addScaledVector(relative, realScale + (enhancedScale - realScale) * blend);
      continue;
    }
    const physicalRadius = physical.length();
    const realScale = overviewRadius(physicalRadius * WORLD_PER_METRE) / physicalRadius;
    const enhancedScale = blend === 0 ? realScale
      : enhancedOverviewRadius(physicalRadius / AU_METRES, enhancedPlanetOrbits) / physicalRadius;
    rendered.anchor.position.copy(physical).multiplyScalar(realScale + (enhancedScale - realScale) * blend);
  }
  if (viewLayer === 'overview' || !focusedBodyId || focusedBodyId === 'sun') {
    // The Sun's rendered anchor is the physical origin in the overview.
    sunLight.position.set(0, 0, 0);
  } else {
    const body = bodyById.get(focusedBodyId)!;
    // The local layer recentres the selected body at the origin. Put the same
    // point light far along the real body-to-Sun direction so its illumination
    // remains consistent with the overview without keeping AU-scale geometry.
    sunLight.position.copy(physicalPositions.get(focusedBodyId)!).normalize().multiplyScalar(-extent(body) * 500);
  }
}

function updateTimeReadout(): void {
  const beijingText = formatBeijingTime(simulationClock.utcMs);
  appSimulationTime.textContent = `北京时间 ${beijingText}`;
  appSimulationTime.setAttribute('datetime', new Date(simulationClock.utcMs).toISOString());
  clockReadout.textContent = `北京时间 ${beijingText}`;
  const currentDistance = appDetailPanel.querySelector<HTMLElement>('#current-sun-distance');
  if (currentDistance && focusedBodyId) currentDistance.textContent = formatDistance(physicalPositions.get(focusedBodyId)!.length());
  appSpeedValue.textContent = simulationClock.speed === 0 ? '静止' : `${simulationClock.speed} 天/秒`;
  document.body.dataset.timeMode = !simulationClock.playing || simulationClock.speed === 0 ? 'paused' : 'accelerated';
  sceneEyebrow.textContent = !simulationClock.playing ? '星历已暂停' : simulationClock.speed === 0 ? '星历静止' : '加速星历';
  updateDataCoords();
}

function updateFocusTransition(elapsedSeconds: number): void {
  if (!focusTransition) return;
  const transition = focusTransition;
  transition.elapsedSeconds += elapsedSeconds;
  const progress = THREE.MathUtils.clamp(transition.elapsedSeconds / transition.duration, 0, 1);
  const eased = easeInOut(progress);

  // Enter the close-up layer once the body is essentially at its final size
  // and the other bodies have shrunk away; the local frame is then fixed.
  if (transition.layer === 'focus' && transition.bodyId && !transition.switched && progress >= 0.92) {
    transition.frameOrigin.copy(renderedBodies.get(transition.bodyId)!.anchor.position);
    setViewLayer('focus', transition.bodyId);
    transition.switched = true;
  }
  const { point, path, height } = flightPath(transition);
  const { u, w } = path.at(dwellAtApex(eased, path));
  const distance = w / height;
  const direction = transition.startDirection.clone().lerp(transition.endDirection, eased);
  if (direction.lengthSq() < 1e-12) direction.copy(transition.endDirection);
  direction.normalize();
  const target = transition.startPoint.clone().lerp(point, u);
  if (transition.switched) target.sub(transition.frameOrigin);
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(controls.target);

  if (progress === 1) {
    focusTransition = null;
    othersPresence = 1;
    controls.enabled = true;
    labelLayer.inert = cleanMode || !labelsVisible || viewLayer === 'focus';
    labelLayer.style.opacity = '';
    if (detailDirty) refreshDetailPanel();
    appViewMode.textContent = viewModeText();
  }
}

// Per-frame model scales. Flight bodies keep a small on-screen floor so a
// sub-pixel real-scale planet stays visible as a point while the camera is far
// away; the floor fades out on arrival. Other bodies scale by othersPresence.
function applyTransientScales(): void {
  const transition = focusTransition;
  const progress = transition ? THREE.MathUtils.clamp(transition.elapsedSeconds / transition.duration, 0, 1) : 1;
  if (transition) {
    let presence = transition.presenceStart + (1 - transition.presenceStart) * THREE.MathUtils.smoothstep(progress, 0.02, 0.3);
    if (transition.layer === 'focus') presence *= 1 - THREE.MathUtils.smoothstep(progress, 0.72, 0.9);
    othersPresence = presence;
  }
  const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(appViewport.clientHeight, 1);
  const floorPixels = 3 * (1 - THREE.MathUtils.smoothstep(progress, 0.8, 1));
  for (const [id, rendered] of renderedBodies) {
    if (!rendered.model.visible) continue;
    let scale = rendered.displayedRadius;
    if (transition && viewLayer === 'overview') {
      if (id === transition.bodyId || id === transition.sourceId) {
        const depth = camera.position.distanceTo(rendered.anchor.position);
        scale = Math.max(scale, floorPixels * worldPerPixel * depth);
      } else {
        scale *= othersPresence;
      }
    }
    rendered.model.scale.setScalar(scale);
  }
}

// A short rewind reads as a single deliberate motion; a long one (days of
// accelerated drift) gets a little longer so the orbital motion is legible,
// but is capped well short of feeling sluggish.
function timeFlightDurationSeconds(spanMs: number): number {
  const days = Math.abs(spanMs) / DAY_MS;
  return THREE.MathUtils.clamp(0.9 + 0.12 * Math.log2(1 + days), 0.9, 1.8);
}

// Starts (or redirects) the flight back to targetUtcMs. Below one second of
// span there is nothing to see, so it resolves immediately instead. onLanded
// (if given) fires once the clock has arrived, real or animated.
function beginTimeFlight(targetUtcMs: number, onLanded?: () => void): void {
  const startUtcMs = simulationClock.utcMs;
  const span = targetUtcMs - startUtcMs;
  if (Math.abs(span) < 1000 || reducedMotion.matches) {
    timeFlight = null;
    simulationClock.reset(targetUtcMs);
    simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
    updateOrbitalPositions();
    updateTimeReadout();
    onLanded?.();
    return;
  }
  // A jump this size can swing a locked body far along its own orbit in well
  // under two seconds; the camera chasing it (the overview's normal per-frame
  // lock-follow) would spin the whole scene around disorientingly. Recentre
  // on the Sun — fixed at the origin — for the jump instead, so the planets
  // sweep around a still point; onLanded can fly on from there once the date
  // has settled.
  if (viewLayer === 'overview' && overviewLockBodyId !== 'sun' && overviewLockBodyId !== 'free') {
    overviewLockBodyId = 'sun';
    beginCameraTransition('overview', null);
    updateNavigationMode();
  }
  const targetDays = (targetUtcMs - J2000_MS) / DAY_MS;
  const spins = new Map<BodyId, { start: number; end: number }>();
  for (const body of BODIES) {
    // Synchronous satellites face their parent, so their spin already follows
    // their (smooth) orbital motion.
    if (body.parentId && body.rotationPeriodDays === body.periodDays) continue;
    const rendered = renderedBodies.get(body.id);
    if (!rendered) continue;
    const end = body.id === 'earth'
      ? earthOrientationAt(targetUtcMs, earthTiltScratch)
      : rotationAngle(targetDays, body.rotationPeriodDays);
    spins.set(body.id, { start: rendered.surface.rotation.y, end });
  }
  timeFlight = { startUtcMs, endUtcMs: targetUtcMs, duration: timeFlightDurationSeconds(span), onLanded, elapsedSeconds: 0, eased: 0, spins };
}

function updateTimeFlight(elapsedSeconds: number): void {
  if (!timeFlight) return;
  const flight = timeFlight;
  flight.elapsedSeconds += elapsedSeconds;
  const progress = THREE.MathUtils.clamp(flight.elapsedSeconds / flight.duration, 0, 1);
  flight.eased = easeInOut(progress);
  simulationClock.utcMs = flight.startUtcMs + (flight.endUtcMs - flight.startUtcMs) * flight.eased;
  simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
  updateOrbitalPositions();
  // The UTC/coordinate readout follows the render loop's usual 250ms-throttled
  // refresh (below); no need to write that text every one of these frames.
  if (progress === 1) {
    // Land on the authoritative target (not the eased sample) and hand the
    // clock back to its normal live/accelerated per-frame advance.
    timeFlight = null;
    simulationClock.reset(flight.endUtcMs);
    simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
    updateOrbitalPositions();
    updateTimeReadout();
    flight.onLanded?.();
  }
}

function addOrbit(body: BodyDefinition): void {
  if (body.semimajorAxisMetres === 0) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(384 * 3), 3));
  const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: body.parentId ? 0.055 : 0.16, depthWrite: false });
  const orbit = new THREE.LineLoop(geometry, material);
  renderedOrbits.set(body.id, orbit);
  refreshOrbit(body);
  if (body.parentId) renderedBodies.get(body.parentId)!.anchor.add(orbit);
  else scene.add(orbit);
}

function refreshOrbit(body: BodyDefinition): void {
  const count = (renderedOrbits.get(body.id)!.geometry.getAttribute('position') as THREE.BufferAttribute).count;
  const samples = orbitSamples.get(body.id) ?? new Float64Array(count * 3);
  for (let segment = 0; segment < count; segment++) {
    const date = simulationClock.utcMs + segment / count * body.periodDays * DAY_MS;
    const coordinates = sceneAxes(directPosition(body.id, date));
    if (body.parentId) {
      const parent = sceneAxes(directPosition(body.parentId, date));
      samples[segment * 3] = coordinates[0] - parent[0];
      samples[segment * 3 + 1] = coordinates[1] - parent[1];
      samples[segment * 3 + 2] = coordinates[2] - parent[2];
    } else {
      samples[segment * 3] = coordinates[0];
      samples[segment * 3 + 1] = coordinates[1];
      samples[segment * 3 + 2] = coordinates[2];
    }
  }
  orbitSamples.set(body.id, samples);
  orbitEpochs.set(body.id, simulationClock.utcMs);
  writeOrbitVertices(body);
}

// Maps cached physical samples to display space for the current mode blend.
function writeOrbitVertices(body: BodyDefinition): void {
  const samples = orbitSamples.get(body.id)!;
  const geometry = renderedOrbits.get(body.id)!.geometry;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const blend = easeInOut(modeProgress);
  for (let segment = 0; segment < positions.count; segment++) {
    const x = samples[segment * 3];
    const y = samples[segment * 3 + 1];
    const z = samples[segment * 3 + 2];
    const radius = Math.max(Math.hypot(x, y, z), 1e-9);
    let realScale: number;
    let enhancedScale: number;
    if (body.parentId) {
      realScale = WORLD_PER_METRE;
      enhancedScale = blend === 0 ? realScale : enhancedSatelliteOrbitRadius(body) / radius;
    } else {
      realScale = overviewRadius(radius * WORLD_PER_METRE) / radius;
      enhancedScale = blend === 0 ? realScale : enhancedOverviewRadius(radius / AU_METRES, enhancedPlanetOrbits) / radius;
    }
    const scale = realScale + (enhancedScale - realScale) * blend;
    positions.setXYZ(segment, x * scale, y * scale, z * scale);
  }
  positions.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function addBody(body: BodyDefinition): void {
  const anchor = new THREE.Group();
  const model = new THREE.Group();
  const surface = new THREE.Group();
  model.add(surface);
  if (body.id === 'sun') {
    solarGlow = createSolarGlow();
    anchor.add(solarGlow.object);
  }
  const radius = body.radiusMetres * WORLD_PER_METRE;
  const geometry = sphereGeometry;
  let earthMaterial: THREE.MeshStandardMaterial | undefined;
  const texture = body.texturePath ? loadTexture(body.texturePath, loaded => {
    if (earthMaterial) applyEarthRoughness(earthMaterial, loaded);
  }) : undefined;
  const heightTexture = body.heightMapPath ? loadTexture(body.heightMapPath) : undefined;
  if (heightTexture) heightTexture.colorSpace = THREE.NoColorSpace;
  const normalTexture = body.normalMapPath ? loadTexture(body.normalMapPath) : undefined;
  if (normalTexture) normalTexture.colorSpace = THREE.NoColorSpace;
  const effects: SurfaceEffect[] = [];
  const solar = body.id === 'sun' && texture ? solarSurface(texture) : null;
  const rockyRelief = body.id === 'mercury' ? 0.008 : body.id === 'mars' ? 0.006 : 0;
  const bumpStrength = ['jupiter', 'saturn', 'uranus', 'neptune'].includes(body.id) ? 0.018
    : isSatellite(body) ? 0.027 : rockyRelief ? 0.032 : 0;
  const material = solar ? solar.material : new THREE.MeshStandardMaterial({
      // Io's source mosaic is deliberately pale; a restrained sulphur tint
      // restores the visible-colour appearance without painting new features.
      color: texture ? (body.id === 'io' ? 0xffe0a0 : 0xffffff) : body.color,
      map: texture ?? null,
      bumpMap: heightTexture ?? texture ?? null,
      bumpScale: bumpStrength,
      normalMap: normalTexture ?? null,
      normalScale: body.id === 'earth' ? new THREE.Vector2(0.72, 0.72) : new THREE.Vector2(1, 1),
      displacementMap: rockyRelief ? texture : null,
      displacementScale: rockyRelief,
      displacementBias: -rockyRelief * 0.5,
      roughness: body.id === 'earth' ? 0.78 : isSatellite(body) ? 0.92 : 0.76,
      metalness: 0
    });
  if (body.id === 'earth' && material instanceof THREE.MeshStandardMaterial) {
    earthMaterial = material;
    applyMoonShadow(material, moonShadowUniforms);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = body.id !== 'sun';
  mesh.receiveShadow = body.id !== 'sun';
  mesh.userData.bodyId = body.id;
  pickableMeshes.push(mesh);
  surface.add(mesh);
  if (solar) effects.push(solar.effect);
  if (body.id === 'venus') effects.push(venusClouds(model, geometry));
  if (body.id === 'earth') {
    effects.push(earthNightLights(surface, geometry, loadTexture('/textures/earth-night.jpg')));
    earthCloudEffect = earthClouds(model, geometry, loadTexture('/textures/earth-clouds.png'), texture!, moonShadowUniforms);
    earthCloudEffect.setLayer(earthLayer);
    earthCloudEffect.setOverlayOpacity(earthOverlayOpacity);
    earthCloudEffect.setAnimationPlaying(earthFlowAnimating);
    effects.push(earthCloudEffect);
  }
  if (['jupiter', 'saturn', 'uranus', 'neptune'].includes(body.id) && material instanceof THREE.MeshStandardMaterial) {
    effects.push(gasFlow(material, body.id));
  }
  if (['venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(body.id)) {
    effects.push(planetAtmosphere(model, geometry, body.id));
  }

  if (body.id === 'saturn') {
    const ringGeometry = new THREE.RingGeometry(1.45, 2.25, 128);
    const positions = ringGeometry.getAttribute('position');
    const uvs = ringGeometry.getAttribute('uv');
    for (let index = 0; index < positions.count; index++) {
      uvs.setXY(index, (Math.hypot(positions.getX(index), positions.getY(index)) - 1.45) / 0.8, 0.5);
    }
    const ringTexture = loadTexture('/textures/saturn-ring.png');
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshStandardMaterial({ map: ringTexture, color: 0xffffff, transparent: true, alphaTest: 0.08, roughness: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2 + 0.45;
    ring.castShadow = true;
    ring.receiveShadow = true;
    model.add(ring);
    effects.push(ringParticles(model, ring));
  }

  anchor.add(model);

  if (body.semimajorAxisMetres > 0 && !body.parentId) {
    const distance = displayedOrbitRadius(body);
    anchor.position.set(distance * Math.cos(body.phaseRadians), 0, distance * Math.sin(body.phaseRadians));
  }

  const labelElement = document.createElement('button');
  labelElement.type = 'button';
  labelElement.className = 'planet-label';
  labelElement.textContent = body.name;
  labelElement.setAttribute('aria-label', `查看${body.name}信息并聚焦`);
  labelElement.addEventListener('click', () => focusBody(body), eventOptions);
  labelLayer.append(labelElement);

  renderedBodies.set(body.id, {
    anchor,
    model, surface, effects,
    label: labelElement,
    displayedRadius: radius
  });
  scene.add(anchor);
  addOrbit(body);
}

// Compiles every shader variant once at startup, including detail layers that
// are hidden in the overview (clouds, night lights, ring particles)
// and the shadowed variant used in Saturn's close-up, so the first flight into
// a body never stalls on shader compilation.
function warmUpRenderer(): void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse(object => {
    if (!object.visible) {
      hidden.push(object);
      object.visible = true;
    }
  });
  const castShadow = sunLight.castShadow;
  // compile() does not build the shadow-map depth shaders; only a shadowed
  // render does. Render once into a tiny offscreen target so none of this
  // warm-up frame reaches the screen.
  const warmTarget = new THREE.WebGLRenderTarget(4, 4);
  try {
    renderer.compile(scene, camera);
    sunLight.castShadow = true;
    renderer.shadowMap.enabled = true;
    renderer.compile(scene, camera);
    renderer.setRenderTarget(warmTarget);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(null);
    warmTarget.dispose();
    sunLight.castShadow = castShadow;
    renderer.shadowMap.enabled = castShadow;
    for (const object of hidden) object.visible = false;
  }
}

function resize(): void {
  const { clientWidth, clientHeight } = appViewport;
  if (clientWidth === 0 || clientHeight === 0) return;
  groundView?.sky?.resize(clientWidth / clientHeight);
  const previousHome = focusHomeDistance;
  const availableWidth = availableSceneWidth(clientWidth, 0.88);
  const availableHeight = !cleanMode && compactLayout.matches ? clientHeight * 0.43 : clientHeight * 0.78;
  const nextOverviewDistance = fitDistance(180, camera.fov, Math.min(availableWidth, availableHeight) / clientHeight, 1);
  const overviewRatio = nextOverviewDistance / overviewHomeDistance;
  overviewCamera.sub(overviewTarget).multiplyScalar(overviewRatio).add(overviewTarget);
  overviewHomeDistance = nextOverviewDistance;
  if (viewLayer === 'overview') {
    camera.position.sub(controls.target).multiplyScalar(overviewRatio).add(controls.target);
  }
  camera.aspect = clientWidth / clientHeight;
  camera.setViewOffset(clientWidth, clientHeight, 0, !cleanMode && compactLayout.matches ? clientHeight * 0.18 : 0, clientWidth, clientHeight);
  configureCamera();
  if (viewLayer === 'focus') {
    const ratio = focusHomeDistance / previousHome;
    // Keep any close-up pan: scale the camera's distance about its target.
    camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // CSS keeps the canvas at 100% of #viewport; only the drawing buffer follows here.
  renderer.setSize(clientWidth, clientHeight, false);
}

// The window 'resize' event misses container-driven changes (split view, emulated
// viewports, panels, moving to a screen with another DPR). Observe the viewport
// element itself and coalesce bursts into one resize per frame.
let resizeFrame = 0;
function scheduleResize(): void {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resize();
  });
}
function watchDevicePixelRatio(): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener('change', () => {
    scheduleResize();
    watchDevicePixelRatio();
  }, { once: true, signal: abortEvents.signal });
}

function setOrbitVisibility(enabled: boolean): void {
  orbitsVisible = enabled;
  for (const orbit of renderedOrbits.values()) {
    orbit.visible = enabled && viewLayer === 'overview';
  }
  if (!focusTransition) appViewMode.textContent = viewModeText();
}

function setLabelVisibility(enabled: boolean): void {
  labelsVisible = enabled;
  document.body.classList.toggle('labels-hidden', !enabled);
  labelLayer.inert = !enabled || cleanMode || Boolean(focusTransition) || viewLayer === 'focus';
}

function currentDataBody(): BodyDefinition {
  const id = focusedBodyId ?? (overviewLockBodyId === 'free' ? 'sun' : overviewLockBodyId);
  return bodyById.get(id)!;
}

// Keeps the detail card's inline coordinate rows current. Both showOverviewDetail
// and showBodyDetail's markup include these ids; querySelector simply misses
// whichever one isn't in the DOM right now, so this is safe to call unconditionally.
function updateDataCoords(): void {
  const body = currentDataBody();
  const position = physicalPositions.get(body.id)!;
  const set = (id: string, value: string) => {
    const target = appDetailPanel.querySelector<HTMLElement>(`#${id}`);
    if (target) target.textContent = value;
  };
  set('coord-body', body.name);
  set('coord-time', new Date(simulationClock.utcMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
  set('coord-x', `${(position.x / AU_METRES).toFixed(6)} AU`);
  set('coord-y', `${(position.y / AU_METRES).toFixed(6)} AU`);
  set('coord-z', `${(position.z / AU_METRES).toFixed(6)} AU`);
}

function filterCatalog(query: string): void {
  bodySearchQuery = query.trim().toLocaleLowerCase('zh-CN');
  for (const button of catalogButtons) {
    if (button.closest('.catalog-group')) continue;
    button.hidden = bodySearchQuery.length > 0 && !button.textContent?.toLocaleLowerCase('zh-CN').includes(bodySearchQuery);
  }
  for (const group of document.querySelectorAll<HTMLElement>('.catalog-group')) {
    const parent = group.querySelector<HTMLButtonElement>(':scope > .catalog-row [data-catalog-body]')!;
    const children = [...group.querySelectorAll<HTMLButtonElement>('.catalog-children [data-catalog-body]')];
    const parentMatches = !bodySearchQuery || parent.textContent?.toLocaleLowerCase('zh-CN').includes(bodySearchQuery);
    let childMatches = false;
    for (const child of children) {
      const matches = !bodySearchQuery || Boolean(child.textContent?.toLocaleLowerCase('zh-CN').includes(bodySearchQuery));
      child.hidden = !matches && !parentMatches;
      childMatches ||= matches;
    }
    group.hidden = !parentMatches && !childMatches;
    if (bodySearchQuery && childMatches && !parentMatches) setCatalogGroupExpanded(group, true);
  }
}

// Celestial-wonder catalog. "event" wonders jump the clock to a precomputed
// real moment (Astronomy Engine, UTC) and fly the overview to the body whose
// neighbourhood best shows the alignment; "visual" wonders with no utcMs just
// fly a close-up to the body whose existing surface effect is the wonder.
// "dynamical" wonders need the C
// kernel (see docs/interaction-proposals.md) and are listed but disabled.
interface WonderDefinition {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly kind: 'event' | 'visual' | 'dynamical';
  readonly summary: string;
  readonly utcMs?: number;
  readonly focusBodyId: BodyId;
  readonly layer: ViewLayer;
  readonly available: boolean;
  /** Solar eclipses: after the flight to Earth, descend to this observer. */
  readonly groundSite?: GroundSite;
  readonly groundEvent?: GroundSkyOptions['event'];
  readonly groundTarget?: GroundTarget;
}

const WONDERS: readonly WonderDefinition[] = [
  {
    id: 'solar-eclipse-2027-02', name: '日环食', tag: '真实天象 · 日食', kind: 'event',
    summary: '月球运行到日地之间，但视直径略小于太阳，边缘露出一圈亮环。',
    utcMs: Date.parse('2027-02-06T15:59:33Z'), focusBodyId: 'earth', layer: 'overview', available: true,
    groundSite: { name: '南大西洋', latitude: -31.22, longitude: -48.47, heightMetres: 0 },
    groundEvent: 'solar-eclipse', groundTarget: 'sun',
  },
  {
    id: 'solar-eclipse-2027-08', name: '日全食', tag: '真实天象 · 日食', kind: 'event',
    summary: '本世纪陆地可见时间最长的日全食之一，埃及卢克索一带全食阶段超过 6 分钟。',
    utcMs: Date.parse('2027-08-02T10:06:35Z'), focusBodyId: 'earth', layer: 'overview', available: true,
    groundSite: { name: '埃及 卢克索', latitude: 25.69, longitude: 32.64, heightMetres: 80 },
    groundEvent: 'solar-eclipse', groundTarget: 'sun',
  },
  {
    id: 'lunar-eclipse-2028-12', name: '月全食', tag: '真实天象 · 月食', kind: 'event',
    summary: '月球完全进入地球本影，常被称为“血月”。',
    utcMs: Date.parse('2028-12-31T16:51:55Z'), focusBodyId: 'earth', layer: 'overview', available: true,
    groundSite: { name: '北京', latitude: 39.90, longitude: 116.40, heightMetres: 45 },
    groundEvent: 'lunar-eclipse', groundTarget: 'moon',
  },
  {
    id: 'mercury-transit-2032', name: '水星凌日', tag: '真实天象 · 凌日', kind: 'event',
    summary: '水星运行到日地之间，是下一次可见的水星凌日。',
    utcMs: Date.parse('2032-11-13T08:54:15Z'), focusBodyId: 'mercury', layer: 'overview', available: false,
  },
  {
    id: 'jupiter-opposition-2027', name: '木星冲日', tag: '真实天象 · 冲日', kind: 'event',
    summary: '木星、地球、太阳几乎连成一线，是观测木星的最佳时期。',
    utcMs: Date.parse('2027-02-11T00:17:05Z'), focusBodyId: 'jupiter', layer: 'overview', available: false,
  },
  {
    id: 'mars-opposition-2028', name: '火星冲日', tag: '真实天象 · 冲日', kind: 'event',
    summary: '火星距地球最近、视直径最大的时期。',
    utcMs: Date.parse('2027-02-19T15:44:18Z'), focusBodyId: 'mars', layer: 'overview', available: false,
  },
  {
    id: 'solar-prominence', name: '太阳日珥', tag: '视觉奇观 · 太阳', kind: 'visual',
    summary: '贴近太阳表面时可见的红橙色等离子体弧。视觉效果尚在制作。',
    focusBodyId: 'sun', layer: 'focus', available: false,
  },
  {
    id: 'jupiter-grs', name: '木星大红斑', tag: '视觉奇观 · 木星', kind: 'visual',
    summary: '太阳系最大的风暴系统，纹理取自真实探测影像，局部流动效果尚在制作。',
    focusBodyId: 'jupiter', layer: 'focus', available: false,
  },
  {
    id: 'aurora', name: '极光', tag: '视觉奇观 · 地球', kind: 'visual',
    summary: '太阳风与地球磁场相互作用，在高纬度形成的光带。视觉效果尚未制作。',
    focusBodyId: 'earth', layer: 'focus', available: false,
  },
  {
    id: 'saturn-hexagon', name: '土星北极六边形', tag: '视觉奇观 · 土星', kind: 'visual',
    summary: '土星北极持续存在的六边形急流，成因至今没有完全定论。视觉效果尚未制作。',
    focusBodyId: 'saturn', layer: 'focus', available: false,
  },
  {
    id: 'comet', name: '彗星', tag: '视觉奇观 · 彗星', kind: 'visual',
    summary: '掠过近日点时，彗尾持续被太阳风推向背离太阳的方向。尚无彗星轨道数据与视觉效果。',
    focusBodyId: 'sun', layer: 'overview', available: false,
  },
  {
    id: 'meteor-shower', name: '流星雨', tag: '视觉奇观 · 地球', kind: 'visual',
    summary: '地球穿过彗星遗留的碎屑带时，大气层中出现的密集流星。尚无辐射点数据与视觉效果。',
    focusBodyId: 'earth', layer: 'focus', available: false,
  },
  {
    id: 'lagrange-trojans', name: '拉格朗日点与特洛伊群', tag: '动力学奇观 · 木星', kind: 'dynamical',
    summary: '与木星共转的参照系中，小行星群在 L4、L5 附近缓慢摆动。需要 C 内核接入后才能演算。',
    focusBodyId: 'jupiter', layer: 'overview', available: false,
  },
  {
    id: 'gravity-assist', name: '引力弹弓', tag: '动力学奇观 · 轨道力学', kind: 'dynamical',
    summary: '探测器借助行星引力加速变轨。需要 C 内核接入后才能演算。',
    focusBodyId: 'jupiter', layer: 'overview', available: false,
  },
  {
    id: 'tidal-disruption', name: '洛希极限与潮汐瓦解', tag: '动力学奇观 · 轨道力学', kind: 'dynamical',
    summary: '天体过于接近大质量星体时被潮汐力撕裂。需要 C 内核接入后才能演算。',
    focusBodyId: 'saturn', layer: 'overview', available: false,
  },
];

// The scope switch's wonder-mode side names and (re)triggers whichever wonder
// is active, or the first available one before anything has been clicked.
function activeOrDefaultWonder(): WonderDefinition {
  return WONDERS.find(wonder => wonder.id === activeWonderId && wonder.available)
    ?? WONDERS.find(wonder => wonder.available)!;
}

function refreshWonderCards(): void {
  for (const button of workspacePanel.querySelectorAll<HTMLButtonElement>('.wonder-card[data-wonder-id]')) {
    button.setAttribute('aria-current', String(button.dataset.wonderId === activeWonderId));
  }
}

// ---------- Ground view (eclipse wonders) ----------
// After the time flight lands on Earth the camera sinks onto the observer's
// site (slerping round the globe while the distance falls geometrically), the
// frame cross-fades through the local sky colour, and ground-sky.ts takes over
// rendering. Leaving reverses the fade and hands the camera back just above
// the site, so the globe reappears where the observer stood.
type GroundPhase = 'approach' | 'descend' | 'ground' | 'leaving';
interface GroundView {
  readonly site: GroundSite;
  readonly timeline: LocalEclipseTimeline;
  readonly wonderName: string;
  readonly event: NonNullable<GroundSkyOptions['event']>;
  readonly target: GroundTarget;
  readonly startMs: number;
  phase: GroundPhase;
  elapsed: number;
  sky: GroundSky | null;
  readonly startDirection: THREE.Vector3;
  readonly endDirection: THREE.Vector3;
  readonly rotation: THREE.Quaternion;
  startDistance: number;
  endDistance: number;
  rate: number;
  then?: () => void;
  readout?: GroundSkyReadout;
}

const GROUND_RATES = [0, 1, 10, 30, 120] as const;
const GROUND_DEFAULT_RATE = 30;
const GROUND_LEAD_MS = 150_000;
let groundView: GroundView | null = null;
let groundRequest: object | null = null;
let groundFade = 0;
let groundFadeTarget = 0;
let groundFadeRate = 1;
let lastGroundHudUpdate = -Infinity;
let groundFields: Record<'time' | 'coverage' | 'altitude' | 'stage' | 'countdown' | 'cursor', HTMLElement> | null = null;
const groundSlerp = new THREE.Quaternion();
const groundIdentity = new THREE.Quaternion();
const groundNormal = new THREE.Vector3();

const groundFadeElement = document.createElement('div');
groundFadeElement.className = 'ground-fade';
groundFadeElement.setAttribute('aria-hidden', 'true');
appViewport.append(groundFadeElement);
const groundHud = document.createElement('section');
groundHud.className = 'ground-hud';
groundHud.hidden = true;
groundHud.setAttribute('aria-label', '地面观测');
appViewport.append(groundHud);

function fadeTo(target: number, seconds: number): void {
  groundFadeTarget = target;
  groundFadeRate = 1 / Math.max(seconds, 0.001);
}

function applyGroundFade(elapsedSeconds: number): void {
  const step = groundFadeRate * elapsedSeconds;
  groundFade = groundFade < groundFadeTarget
    ? Math.min(groundFadeTarget, groundFade + step)
    : Math.max(groundFadeTarget, groundFade - step);
  groundFadeElement.style.opacity = String(easeInOut(groundFade));
}

function groundSiteNormal(site: GroundSite, target: THREE.Vector3): THREE.Vector3 {
  const surface = renderedBodies.get('earth')!.surface;
  surface.updateWorldMatrix(true, false);
  const [x, y, z] = earthLocalDirection(site.latitude, site.longitude);
  return target.set(x, y, z).transformDirection(surface.matrixWorld);
}

function formatSiteCoordinates(site: GroundSite): string {
  const lat = `${Math.abs(site.latitude).toFixed(2)}°${site.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(site.longitude).toFixed(2)}°${site.longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} · ${lon}`;
}

function centralName(timeline: LocalEclipseTimeline): string {
  return timeline.kind === 'annular' ? '环食' : timeline.kind === 'total' ? '全食' : '食甚';
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function buildGroundHud(view: GroundView): void {
  const { timeline, site } = view;
  const span = timeline.partialEndMs - view.startMs;
  const centralStart = ((timeline.centralBeginMs ?? timeline.peakMs) - view.startMs) / span * 100;
  const centralEnd = ((timeline.centralEndMs ?? timeline.peakMs) - view.startMs) / span * 100;
  groundHud.innerHTML = `
    <p class="eyebrow">地面视角 · ${view.wonderName}</p>
    <h2>${site.name}</h2>
    <p class="ground-hud-coords">${formatSiteCoordinates(site)}</p>
    <dl class="ground-hud-readouts">
      <div class="ground-hud-time"><dt>北京时间</dt><dd data-ground="time"></dd></div>
      <div><dt>${view.event === 'solar-eclipse' ? '遮挡' : '目标高度'}</dt><dd data-ground="coverage"></dd></div>
      <div><dt>太阳高度</dt><dd data-ground="altitude"></dd></div>
      <div><dt>阶段</dt><dd data-ground="stage"></dd></div>
    </dl>
    <p class="ground-hud-countdown" data-ground="countdown"></p>
    <div class="ground-hud-track">
      <span aria-hidden="true" class="ground-hud-central" style="left:${centralStart}%;width:${Math.max(centralEnd - centralStart, 0.6)}%"></span>
      <input class="ground-hud-seek" data-ground="cursor" type="range" min="0" max="10000" step="1" value="0" aria-label="日月食时间进度" />
    </div>
    <div class="ground-hud-rates" role="group" aria-label="时间流速">
      ${GROUND_RATES.map(rate => `<button type="button" data-ground-rate="${rate}">${rate === 0 ? '暂停' : `${rate}×`}</button>`).join('')}
    </div>
    <div class="ground-hud-actions">
      <button type="button" data-ground-action="replay">重播</button>
      <button type="button" data-ground-action="recentre">回正</button>
        <button type="button" data-ground-action="leave">离开</button>
    </div>
    <p class="ground-hud-hint">拖动微调视角 · 滚轮缩放 · Esc 离开</p>`;
  const field = (name: string) => groundHud.querySelector<HTMLElement>(`[data-ground="${name}"]`)!;
  groundFields = {
    time: field('time'), coverage: field('coverage'), altitude: field('altitude'),
    stage: field('stage'), countdown: field('countdown'), cursor: field('cursor'),
  };
  const seek = groundFields.cursor as HTMLInputElement;
  seek.addEventListener('pointerdown', event => {
    event.stopPropagation();
    setGroundRate(0);
  });
  seek.addEventListener('input', () => {
    if (groundView !== view || view.phase !== 'ground') return;
    setGroundRate(0);
    simulationClock.utcMs = view.startMs + Number(seek.value) / 10000 * span;
    simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
    view.readout = view.sky!.update(simulationClock.utcMs, 0, appViewport.clientHeight);
    updateGroundHud(view);
  });
  refreshGroundRates();
}

function refreshGroundRates(): void {
  const rate = groundView?.rate ?? 0;
  for (const button of groundHud.querySelectorAll<HTMLButtonElement>('[data-ground-rate]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.groundRate) === rate));
  }
}

function updateGroundHud(view: GroundView): void {
  const { timeline } = view;
  const utcMs = simulationClock.utcMs;
  const fields = groundFields;
  if (!fields) return;
  // Writing an unchanged value still dirties layout, so only touch changes.
  const write = (element: HTMLElement, text: string) => {
    if (element.textContent !== text) element.textContent = text;
  };
  const centralBegin = timeline.centralBeginMs ?? timeline.peakMs;
  const centralEnd = timeline.centralEndMs ?? timeline.peakMs;
  const inCentral = timeline.centralBeginMs !== undefined && utcMs >= centralBegin && utcMs <= centralEnd;
  const stage = utcMs < timeline.partialBeginMs ? '未开始'
    : utcMs >= timeline.partialEndMs ? '已结束'
      : view.event === 'solar-eclipse' ? (inCentral ? centralName(timeline) : '偏食')
        : inCentral ? '全食' : '偏食';
  write(fields.time, formatBeijingTime(utcMs));
  write(fields.coverage, view.readout
    ? view.event === 'solar-eclipse' ? `${(view.readout.sky.coverage * 100).toFixed(1)}%` : `${view.readout.targetAltitude.toFixed(1)}°`
    : '—');
  write(fields.altitude, view.readout ? `${view.readout.sky.sun.altitude.toFixed(1)}°` : '—');
  write(fields.stage, stage);
  const name = view.event === 'solar-eclipse' ? centralName(timeline) : '全食';
  write(fields.countdown, utcMs < centralBegin ? `距${name}开始 ${formatDuration(centralBegin - utcMs)}`
    : inCentral ? `${name}剩余 ${formatDuration(centralEnd - utcMs)}`
      : utcMs < timeline.partialEndMs ? `距${view.event === 'solar-eclipse' ? '日食' : '月食'}结束 ${formatDuration(timeline.partialEndMs - utcMs)}`
        : `${view.wonderName}已结束`);
  const progress = THREE.MathUtils.clamp((utcMs - view.startMs) / (timeline.partialEndMs - view.startMs), 0, 1);
  const seek = fields.cursor as HTMLInputElement;
  const value = String(Math.round(progress * 10000));
  if (seek.value !== value) seek.value = value;
  seek.setAttribute('aria-valuetext', `${formatBeijingTime(utcMs)}，${stage}`);
}

function setGroundRate(rate: number): void {
  if (!groundView) return;
  groundView.rate = rate;
  refreshGroundRates();
}

function advanceGroundClock(view: GroundView, elapsedSeconds: number): void {
  if (view.rate === 0) return;
  const next = Math.min(simulationClock.utcMs + elapsedSeconds * 1000 * view.rate, view.timeline.partialEndMs);
  simulationClock.utcMs = next;
  simulationDays = (next - J2000_MS) / DAY_MS;
  // The space scene is not drawn from the ground; its bodies catch up once,
  // when the observer starts leaving (see leaveGround).
  if (next >= view.timeline.partialEndMs) setGroundRate(0);
}

function beginGroundDescent(view: GroundView): void {
  controls.enabled = false;
  const centre = controls.target;
  const offset = camera.position.clone().sub(centre);
  view.startDistance = offset.length();
  view.startDirection.copy(offset).normalize();
  groundSiteNormal(view.site, view.endDirection);
  view.endDistance = renderedBodies.get('earth')!.model.scale.x * 1.12;
  view.rotation.setFromUnitVectors(view.startDirection, view.endDirection);
  const { clientWidth, clientHeight } = appViewport;
  const sky = createGroundSky(view.site, renderer.getPixelRatio(), { event: view.event, target: view.target, peakMs: view.timeline.peakMs });
  sky.resize(clientWidth / clientHeight);
  view.readout = sky.update(simulationClock.utcMs, 0, clientHeight);
  // Compile now, while the globe is still on screen, so the first ground
  // frame does not stall on shader linking at the end of the descent.
  renderer.compile(sky.scene, sky.camera);
  view.sky = sky;
  groundFadeElement.style.background = sky.horizonColour();
  view.phase = 'descend';
  view.elapsed = 0;
}

function enterGround(view: GroundView): void {
  view.phase = 'ground';
  view.elapsed = 0;
  view.sky!.beginIntro();
  groundFade = 1;
  fadeTo(0, 1.2);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.body.classList.add('ground-view');
  for (const element of uiElements) element.inert = true;
  buildGroundHud(view);
  updateGroundHud(view);
  groundHud.hidden = false;
  requestAnimationFrame(() => groundHud.classList.add('visible'));
}

function restoreInterfaceAfterGround(): void {
  document.body.classList.remove('ground-view');
  groundHud.classList.remove('visible');
  groundHud.hidden = true;
  groundFields = null;
  for (const element of uiElements) element.inert = cleanMode;
  labelLayer.inert = cleanMode || !labelsVisible || Boolean(focusTransition) || viewLayer === 'focus';
}

function finishLeavingGround(view: GroundView): void {
  view.sky?.dispose();
  groundView = null;
  restoreInterfaceAfterGround();
  const centre = controls.target;
  groundSiteNormal(view.site, groundNormal);
  camera.position.copy(centre).addScaledVector(groundNormal, focusHomeDistance);
  camera.lookAt(centre);
  controls.enabled = true;
  configureCamera();
  fadeTo(0, 0.8);
  updateTimeReadout();
  view.then?.();
}

/** Starts leaving the ground view; returns false when there is none. */
function leaveGround(then?: () => void): boolean {
  const view = groundView;
  if (!view) return false;
  if (view.phase === 'leaving') {
    view.then = then;
    return true;
  }
  if (view.phase === 'ground') {
    view.phase = 'leaving';
    view.then = then;
    updateOrbitalPositions();
    groundFadeElement.style.background = view.sky!.horizonColour();
    fadeTo(1, 0.45);
    groundHud.classList.remove('visible');
    return true;
  }
  // Still in space (approach or mid-descent): abandon it on the spot.
  view.sky?.dispose();
  groundView = null;
  controls.enabled = true;
  configureCamera();
  fadeTo(0, 0.3);
  then?.();
  return true;
}

/** Advances the ground view; returns true when the ground scene should render. */
function stepGround(elapsedSeconds: number): boolean {
  applyGroundFade(elapsedSeconds);
  const view = groundView;
  if (!view) return false;
  const { clientHeight } = appViewport;
  switch (view.phase) {
    case 'approach':
      if (focusTransition || viewLayer !== 'focus' || focusedBodyId !== 'earth') {
        view.elapsed = 0;
        return false;
      }
      view.elapsed += elapsedSeconds;
      if (view.elapsed >= (reducedMotion.matches ? 0.2 : 0.9)) beginGroundDescent(view);
      return false;
    case 'descend': {
      view.elapsed += elapsedSeconds;
      const t = Math.min(view.elapsed / (reducedMotion.matches ? 0.8 : 3.2), 1);
      const eased = easeInOut(t);
      groundSlerp.copy(groundIdentity).slerp(view.rotation, eased);
      const distance = view.startDistance * Math.pow(view.endDistance / view.startDistance, eased);
      camera.position.copy(view.startDirection).applyQuaternion(groundSlerp).multiplyScalar(distance).add(controls.target);
      camera.lookAt(controls.target);
      const veil = THREE.MathUtils.clamp((t - 0.6) / 0.4, 0, 1);
      groundFade = groundFadeTarget = veil * veil * (3 - 2 * veil);
      groundFadeElement.style.opacity = String(groundFade);
      if (t >= 1) {
        enterGround(view);
        view.readout = view.sky!.update(simulationClock.utcMs, 0, clientHeight);
        return true;
      }
      return false;
    }
    case 'ground':
      view.readout = view.sky!.update(simulationClock.utcMs, elapsedSeconds, clientHeight);
      return true;
    case 'leaving':
      view.readout = view.sky!.update(simulationClock.utcMs, elapsedSeconds, clientHeight);
      if (groundFade >= 1) {
        finishLeavingGround(view);
        return false;
      }
      return true;
  }
}

groundHud.addEventListener('click', event => {
  const view = groundView;
  if (!view || !(event.target instanceof Element)) return;
  const rateButton = event.target.closest<HTMLButtonElement>('[data-ground-rate]');
  if (rateButton) {
    setGroundRate(Number(rateButton.dataset.groundRate));
    return;
  }
  const action = event.target.closest<HTMLButtonElement>('[data-ground-action]')?.dataset.groundAction;
  if (action === 'replay') {
    simulationClock.utcMs = view.startMs;
    simulationDays = (view.startMs - J2000_MS) / DAY_MS;
    setGroundRate(GROUND_DEFAULT_RATE);
    view.sky?.recentre();
    // Refresh the readout for the rewound clock first, or the HUD shows the
    // pre-replay coverage until the next frame.
    if (view.sky) view.readout = view.sky.update(simulationClock.utcMs, 0, appViewport.clientHeight);
    updateGroundHud(view);
  } else if (action === 'recentre') {
    view.sky?.recentre();
  } else if (action === 'leave') {
    leaveGround();
  }
}, eventOptions);

// Jumps the clock to the wonder's real moment (if any) and flies to its shot,
// reusing the same continuous flight (beginCameraTransition) and time-flight
// (beginTimeFlight) machinery as every other transition in the app — the
// planets slide along their real orbits to the target date exactly as they do
// when returning to "now". When there is a date to jump to, the camera settles
// on the wonder's body only once beginTimeFlight has recentred on the Sun and
// the jump has landed, instead of chasing a body that is itself swinging
// through its orbit during the jump.
function activateWonder(wonder: WonderDefinition): void {
  if (!wonder.available) return;
  if (leaveGround(() => activateWonder(wonder))) return;
  activeWonderId = wonder.id;
  const body = bodyById.get(wonder.focusBodyId)!;
  const site = wonder.groundSite;
  if (site && wonder.utcMs !== undefined && wonder.groundEvent && wonder.groundTarget) {
    // Solar eclipses use the site's local contact times; a lunar eclipse
    // looks the same from everywhere on the night side.
    const event = wonder.groundEvent;
    const timeline: LocalEclipseTimeline = event === 'solar-eclipse'
      ? localEclipseTimeline(site, wonder.utcMs - DAY_MS)
      : lunarEclipseTimeline(wonder.utcMs - DAY_MS);
    const startMs = event === 'solar-eclipse'
      ? (timeline.centralBeginMs ?? timeline.peakMs) - GROUND_LEAD_MS
      : timeline.partialBeginMs;
    const request = {};
    groundRequest = request;
    beginTimeFlight(startMs, () => {
      if (groundRequest !== request) return;
      groundRequest = null;
      // Already settled on Earth (e.g. switching between eclipses): the camera
      // turned with the globe through the jump, so descend straight away in
      // one great-circle move instead of pausing first.
      const settled = viewLayer === 'focus' && focusedBodyId === 'earth' && !focusTransition;
      focusBody(bodyById.get('earth')!);
      groundView = {
        site, timeline, wonderName: wonder.name, event, target: wonder.groundTarget!, startMs,
        phase: 'approach', elapsed: settled ? Number.POSITIVE_INFINITY : 0, sky: null,
        startDirection: new THREE.Vector3(), endDirection: new THREE.Vector3(), rotation: new THREE.Quaternion(),
        startDistance: 1, endDistance: 1, rate: event === 'solar-eclipse' ? GROUND_DEFAULT_RATE : 120,
      };
      updateNavigationMode();
    });
    refreshWonderCards();
    updateScopeSwitch();
    return;
  }
  const settleOnWonder = () => {
    if (wonder.layer === 'focus') {
      focusBody(body);
    } else {
      overviewLockBodyId = wonder.focusBodyId;
      beginCameraTransition('overview', null);
    }
    updateNavigationMode();
  };
  if (wonder.utcMs !== undefined) beginTimeFlight(wonder.utcMs, settleOnWonder);
  else settleOnWonder();
  refreshWonderCards();
  updateScopeSwitch();
}

function wonderCardMarkup(wonder: WonderDefinition): string {
  const dateText = wonder.utcMs !== undefined ? `<span class="wonder-card-date">${formatBeijingTime(wonder.utcMs)} 北京时间</span>` : '';
  const badge = wonder.available ? '' : '<span class="wonder-card-badge">开发中</span>';
  return `
    <button type="button" class="wonder-card" data-wonder-id="${wonder.id}" ${wonder.available ? '' : 'disabled'} aria-current="${wonder.id === activeWonderId}">
      <span class="wonder-card-tag">${wonder.tag}</span>
      <span class="wonder-card-name">${wonder.name}</span>
      ${dateText}
      <span class="wonder-card-summary">${wonder.summary}</span>
      ${badge}
    </button>`;
}

function wonderSectionMarkup(title: string, kind: WonderDefinition['kind']): string {
  const items = WONDERS.filter(wonder => wonder.kind === kind);
  if (items.length === 0) return '';
  return `<h3 class="wonder-section-title">${title}</h3><div class="wonder-list">${items.map(wonderCardMarkup).join('')}</div>`;
}

// The "视角中心" and detail cards are always visible while observing; the
// workspace panel instead carries whatever the current experience mode needs
// (the gravity-lab placeholder, or the wonders placeholder).
function renderExperiencePanel(mode: ExperienceMode): void {
  workspacePanel.hidden = mode === 'observation';
  detailShell.hidden = mode !== 'observation';
  simulationControls.hidden = mode !== 'observation';
  if (mode === 'observation') {
    workspacePanel.replaceChildren();
    return;
  }
  if (mode === 'experiment') {
    workspacePanel.innerHTML = `
      <p class="eyebrow">GRAVITY LAB</p>
      <h2>引力实验</h2>
      <div class="workspace-placeholder"><strong>动力学实验台正在开发中</strong><span>质量倍率实验、引力场可视化与轨道对比将在后续阶段接入。当前画面仍使用星历，不受实验参数影响。</span></div>
      <label class="workspace-setting"><input id="workspace-diagnostics" type="checkbox" ${diagnosticsEnabled ? 'checked' : ''} /><span>显示性能诊断</span></label>`;
    workspacePanel.querySelector<HTMLInputElement>('#workspace-diagnostics')!.addEventListener('change', event => {
      diagnosticsEnabled = (event.currentTarget as HTMLInputElement).checked;
      diagnosticOutput.hidden = !diagnosticsEnabled;
      if (!diagnosticsEnabled) diagnosticOutput.textContent = '';
      else { frameTimes.length = 0; frameWork.length = 0; }
    }, eventOptions);
  } else {
    workspacePanel.innerHTML = `
      <p class="eyebrow">CELESTIAL WONDERS</p>
      <h2>天文奇观</h2>
      <p>日食与月食会带你到真实观测点，镜头始终对准太阳或月亮；时间与方位由星历驱动，天空与光晕是视觉示意。标注“开发中”的项目尚待制作。</p>
      ${wonderSectionMarkup('真实天象', 'event')}
      ${wonderSectionMarkup('视觉奇观', 'visual')}
      ${wonderSectionMarkup('动力学奇观', 'dynamical')}`;
    for (const button of workspacePanel.querySelectorAll<HTMLButtonElement>('.wonder-card[data-wonder-id]')) {
      if (button.disabled) continue;
      const wonder = WONDERS.find(candidate => candidate.id === button.dataset.wonderId)!;
      button.addEventListener('click', () => activateWonder(wonder), eventOptions);
    }
  }
}

function applyExperiencePanel(mode: ExperienceMode): void {
  renderExperiencePanel(mode);
  sidebarPanel.scrollTop = 0;
}

class NavigationTransitionController {
  private currentMode: ExperienceMode;
  private targetMode: ExperienceMode;
  private state: NavigationTransitionState = 'idle';
  private transitionId = 0;
  private direction: -1 | 0 | 1 = 0;
  private animations: Animation[] = [];
  private ghost: HTMLElement | null = null;
  private speed = 1;
  private debugPanel: HTMLElement | null = null;
  private debugFrame = 0;

  constructor(
    private readonly stage: HTMLElement,
    private readonly sidebar: HTMLElement,
    initialMode: ExperienceMode,
  ) {
    this.currentMode = initialMode;
    this.targetMode = initialMode;
    this.createDebugPanel();
    this.publishState();
  }

  navigate(targetMode: ExperienceMode): void {
    if (targetMode === this.targetMode && this.state !== 'idle') return;
    if (targetMode === this.currentMode && this.state === 'idle') return;

    const sourceIndex = EXPERIENCE_MODES.indexOf(this.currentMode);
    const targetIndex = EXPERIENCE_MODES.indexOf(targetMode);
    this.direction = targetIndex === sourceIndex ? 0 : targetIndex > sourceIndex ? 1 : -1;
    this.targetMode = targetMode;
    const transitionId = ++this.transitionId;
    this.cancelVisuals();
    this.setState('preparing');

    if (document.visibilityState !== 'visible') {
      applyExperiencePanel(targetMode);
      this.currentMode = targetMode;
      this.setState('settled');
      this.setState('idle');
      return;
    }

    const oldScrollTop = this.sidebar.scrollTop;
    const ghost = this.stage.cloneNode(true) as HTMLElement;
    ghost.className = 'workspace-stage workspace-transition-ghost';
    ghost.style.top = `${-oldScrollTop}px`;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    for (const element of ghost.querySelectorAll<HTMLElement>('[id], [aria-live]')) {
      element.removeAttribute('id');
      element.removeAttribute('aria-live');
    }
    this.ghost = ghost;
    this.sidebar.append(ghost);
    this.sidebar.classList.add('workspace-transitioning');
    this.stage.style.willChange = 'transform, opacity';
    ghost.style.willChange = 'transform, opacity';

    this.setState('exiting');
    this.setState('swapping');
    applyExperiencePanel(targetMode);
    this.currentMode = targetMode;
    this.setState('entering');

    const reduced = reducedMotion.matches;
    const exitDuration = (reduced ? MOTION.duration.reduced : MOTION.duration.normal) / this.speed;
    const enterDuration = (reduced ? MOTION.duration.reduced : MOTION.duration.enter) / this.speed;
    const enterDelay = (reduced ? 0 : MOTION.delay.enter) / this.speed;
    const exitX = reduced ? 0 : -MOTION.distance.small * this.direction;
    const enterX = reduced ? 0 : MOTION.distance.page * this.direction;

    const exitAnimation = ghost.animate([
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      {
        opacity: 0,
        transform: reduced
          ? 'translate3d(0, 0, 0) scale(1)'
          : `translate3d(${exitX}px, -${MOTION.distance.micro}px, 0) scale(0.992)`,
      },
    ], {
      duration: exitDuration,
      easing: reduced ? 'linear' : MOTION.easing.exit,
      fill: 'both',
    });

    const enterAnimation = this.stage.animate([
      {
        opacity: 0,
        transform: reduced
          ? 'translate3d(0, 0, 0) scale(1)'
          : `translate3d(${enterX}px, 4px, 0) scale(1.006)`,
      },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
    ], {
      duration: enterDuration,
      delay: enterDelay,
      easing: reduced ? 'linear' : MOTION.easing.standard,
      fill: 'both',
    });

    this.animations.push(exitAnimation, enterAnimation);
    if (!reduced) this.animateInnerContent(enterDelay);
    this.startDebugLoop();

    Promise.allSettled(this.animations.map(animation => animation.finished)).then(() => {
      if (transitionId !== this.transitionId) return;
      this.setState('settled');
      this.cancelVisuals();
      this.setState('idle');
    });
  }

  private animateInnerContent(baseDelay: number): void {
    const selectors = [
      '.workspace-panel:not([hidden]) > .eyebrow',
      '.workspace-panel:not([hidden]) > h2',
      '.workspace-panel:not([hidden]) > p:not(.eyebrow)',
      '.workspace-panel:not([hidden]) > :is(label, dl, button, input, div)',
      '.detail-panel:not([hidden]) > summary',
      '.detail-panel:not([hidden]) #detail-panel > *',
      '.controls:not([hidden]) > *',
    ].join(', ');
    const candidates = [...this.stage.querySelectorAll<HTMLElement>(selectors)]
      .filter(element => element.getClientRects().length > 0)
      .slice(0, 8);
    candidates.forEach((element, index) => {
      element.style.willChange = 'transform, opacity';
      const animation = element.animate([
        { opacity: 0.25, transform: 'translate3d(0, 6px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ], {
        duration: MOTION.duration.normal / this.speed,
        delay: baseDelay + Math.min(index, 3) * MOTION.delay.stagger / this.speed,
        easing: MOTION.easing.standard,
        fill: 'both',
      });
      animation.finished.finally(() => element.style.removeProperty('will-change')).catch(() => undefined);
      this.animations.push(animation);
    });
  }

  private cancelVisuals(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.ghost?.remove();
    this.ghost = null;
    this.stage.style.removeProperty('will-change');
    for (const element of this.stage.querySelectorAll<HTMLElement>('[style*="will-change"]')) {
      element.style.removeProperty('will-change');
    }
    this.sidebar.classList.remove('workspace-transitioning');
  }

  private setState(state: NavigationTransitionState): void {
    this.state = state;
    this.publishState();
  }

  private publishState(): void {
    document.body.dataset.transitionState = this.state;
    document.body.dataset.transitionDirection = String(this.direction);
    document.body.dataset.transitionId = String(this.transitionId);
    this.updateDebugPanel();
  }

  private createDebugPanel(): void {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('motionDebug')) return;
    const panel = document.createElement('aside');
    panel.className = 'motion-debug';
    panel.setAttribute('aria-label', 'Motion Debug');
    panel.innerHTML = `
      <output></output>
      <div>
        <button type="button" data-motion-speed="0.25">0.25×</button>
        <button type="button" data-motion-speed="0.5">0.5×</button>
        <button type="button" data-motion-speed="1" aria-pressed="true">1×</button>
      </div>`;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-motion-speed]')) {
      button.addEventListener('click', () => {
        this.speed = Number(button.dataset.motionSpeed);
        for (const candidate of panel.querySelectorAll<HTMLButtonElement>('[data-motion-speed]')) {
          candidate.setAttribute('aria-pressed', String(candidate === button));
        }
        this.updateDebugPanel();
      }, eventOptions);
    }
    document.body.append(panel);
    this.debugPanel = panel;
  }

  private startDebugLoop(): void {
    if (!this.debugPanel) return;
    cancelAnimationFrame(this.debugFrame);
    const update = () => {
      this.updateDebugPanel();
      if (this.state !== 'idle') this.debugFrame = requestAnimationFrame(update);
    };
    this.debugFrame = requestAnimationFrame(update);
  }

  private updateDebugPanel(): void {
    const output = this.debugPanel?.querySelector('output');
    if (!output) return;
    const enter = this.animations[1];
    const duration = Number(enter?.effect?.getTiming().duration ?? 0);
    const currentTime = typeof enter?.currentTime === 'number' ? enter.currentTime : 0;
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : this.state === 'idle' ? 1 : 0;
    output.textContent = `active ${activeExperience} · target ${this.targetMode}\nstate ${this.state} · direction ${this.direction}\nduration ${Math.round(duration)}ms · progress ${progress.toFixed(2)}\nid ${this.transitionId} · speed ${this.speed}×`;
  }
}

const navigationTransitions = new NavigationTransitionController(workspaceStage, sidebarPanel, activeExperience);

function setExperienceMode(mode: ExperienceMode): void {
  if (mode === activeExperience) return;
  leaveGround();
  resetEarthAnalysis();
  activeExperience = mode;
  document.body.dataset.experience = mode;
  experienceSwitch.dataset.mode = mode;
  observationModeButton.setAttribute('aria-pressed', String(mode === 'observation'));
  experimentModeButton.setAttribute('aria-pressed', String(mode === 'experiment'));
  wondersModeButton.setAttribute('aria-pressed', String(mode === 'wonders'));
  navigationTransitions.navigate(mode);
  updateScopeSwitch();
}

BODIES.forEach(addBody);
buildLockCenterTree();
for (const button of catalogButtons) {
  button.addEventListener('click', () => {
    const body = bodyById.get(button.dataset.catalogBody as BodyId);
    if (body) {
      const group = button.closest<HTMLElement>('.catalog-group');
      if (group) setCatalogGroupExpanded(group, true);
      focusBody(body);
    }
  }, eventOptions);
}
for (const toggle of catalogToggles) {
  toggle.addEventListener('click', () => {
    const group = toggle.closest<HTMLElement>('.catalog-group');
    if (group) setCatalogGroupExpanded(group, !group.classList.contains('expanded'));
  }, eventOptions);
}
catalogSearch.addEventListener('input', () => filterCatalog(catalogSearch.value), eventOptions);
catalogPanelToggle.addEventListener('click', () => {
  const expanded = systemPanel.classList.toggle('collapsed') === false;
  catalogPanelToggle.setAttribute('aria-expanded', String(expanded));
}, eventOptions);
observationModeButton.addEventListener('click', () => setExperienceMode('observation'), eventOptions);
experimentModeButton.addEventListener('click', () => setExperienceMode('experiment'), eventOptions);
wondersModeButton.addEventListener('click', () => setExperienceMode('wonders'), eventOptions);

scopeOverviewButton.addEventListener('click', () => {
  if (activeExperience === 'wonders') {
    activeWonderId = null;
    refreshWonderCards();
    updateScopeSwitch();
  }
  returnToOverview();
}, eventOptions);
scopeFocusButton.addEventListener('click', () => {
  if (activeExperience === 'wonders') {
    activateWonder(activeOrDefaultWonder());
    return;
  }
  const body = bodyById.get(scopeFocusTargetId());
  if (body) focusBody(body);
}, eventOptions);

function closeDisplayLayersMenu(): void {
  displayLayersMenu.hidden = true;
  displayLayersToggle.setAttribute('aria-expanded', 'false');
}
displayLayersToggle.addEventListener('click', () => {
  const willOpen = displayLayersMenu.hidden;
  displayLayersMenu.hidden = !willOpen;
  displayLayersToggle.setAttribute('aria-expanded', String(willOpen));
}, eventOptions);
toggleLabelsInput.addEventListener('change', () => setLabelVisibility(toggleLabelsInput.checked), eventOptions);
toggleOrbitsInput.addEventListener('change', () => setOrbitVisibility(toggleOrbitsInput.checked), eventOptions);
toggleKuiperBeltInput.addEventListener('change', () => {
  kuiperBeltVisible = toggleKuiperBeltInput.checked;
  kuiperBelt.object.visible = kuiperBeltVisible && viewLayer === 'overview';
}, eventOptions);
toggleInnerOortInput.addEventListener('change', () => {
  innerOortVisible = toggleInnerOortInput.checked;
  oortCloud.setVisibility(innerOortVisible, outerOortVisible);
}, eventOptions);
toggleOuterOortInput.addEventListener('change', () => {
  outerOortVisible = toggleOuterOortInput.checked;
  oortCloud.setVisibility(innerOortVisible, outerOortVisible);
}, eventOptions);

setViewLayer('overview');
applyExperiencePanel(activeExperience);
warmUpRenderer();
detailShell.open = false;
resize();
const viewportObserver = new ResizeObserver(scheduleResize);
viewportObserver.observe(appViewport);
abortEvents.signal.addEventListener('abort', () => viewportObserver.disconnect(), { once: true });
window.addEventListener('resize', scheduleResize, eventOptions);
window.visualViewport?.addEventListener('resize', scheduleResize, eventOptions);
watchDevicePixelRatio();
compactLayout.addEventListener('change', () => { detailShell.open = viewLayer === 'focus'; }, eventOptions);
detailShell.addEventListener('toggle', () => {
  if (!detailShell.open) resetEarthAnalysis();
}, eventOptions);

function updatePlayToggle(): void {
  const action = simulationClock.playing ? '暂停' : '继续';
  appPlayToggle.setAttribute('aria-pressed', String(simulationClock.playing));
  appPlayToggle.setAttribute('aria-label', `${action}星历时间`);
  appPlayToggle.title = action;
}
updatePlayToggle();

appPlayToggle.addEventListener('click', () => {
  simulationClock.playing = !simulationClock.playing;
  updatePlayToggle();
  updateTimeReadout();
}, eventOptions);

appResetSimulation.addEventListener('click', () => {
  groundRequest = null;
  if (leaveGround(() => beginTimeFlight(Date.now()))) return;
  beginTimeFlight(Date.now());
}, eventOptions);

appCleanView.addEventListener('click', () => {
  setCleanView(!cleanMode);
}, eventOptions);

renderer.domElement.addEventListener('wheel', (event) => {
  if (groundView) {
    if (groundView.phase === 'ground') groundView.sky!.zoom(event.deltaY);
    return;
  }
  if (viewLayer === 'focus' && !focusTransition) outwardZoomRequested = event.deltaY > 0;
}, { passive: true, capture: true, ...eventOptions });

appLockCenter.addEventListener('click', () => {
  if (appLockCenter.disabled) return;
  const willOpen = appLockCenterMenu.hidden;
  appLockCenterMenu.hidden = !willOpen;
  appLockCenter.setAttribute('aria-expanded', String(willOpen));
}, eventOptions);

document.addEventListener('pointerdown', event => {
  const target = event.target;
  if (!(target instanceof Node) || !(appLockCenter.contains(target) || appLockCenterMenu.contains(target))) closeLockCenterMenu();
  if (!(target instanceof Node) || !(displayLayersToggle.contains(target) || displayLayersMenu.contains(target))) closeDisplayLayersMenu();
}, eventOptions);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeLockCenterMenu(); closeDisplayLayersMenu(); }
}, eventOptions);

renderer.domElement.addEventListener('dblclick', () => {
  if (groundView) return;
  if (cleanMode) setCleanView(false);
}, eventOptions);

let pointerStart: { x: number; y: number; time: number } | null = null;
let lastTapTime = 0;
let groundDragPointer: { id: number; x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', event => {
  if (event.button === 0 && event.isPrimary) pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  if (groundView?.phase === 'ground' && event.button === 0 && event.isPrimary) {
    groundDragPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    renderer.domElement.setPointerCapture(event.pointerId);
  }
}, eventOptions);
renderer.domElement.addEventListener('pointermove', event => {
  if (groundView) {
    const drag = groundDragPointer;
    if (!drag || drag.id !== event.pointerId || groundView.phase !== 'ground') return;
    groundView.sky!.drag(event.clientX - drag.x, event.clientY - drag.y, appViewport.clientHeight);
    drag.x = event.clientX;
    drag.y = event.clientY;
    return;
  }
  // Only a mouse/pen left-drag is the pan gesture that releases the lock. A
  // one-finger touch drag is OrbitControls' rotate gesture and keeps it.
  if (event.pointerType === 'touch') return;
  if (!pointerStart || !(event.buttons & 1) || viewLayer !== 'overview' || focusTransition || overviewLockBodyId === 'free') return;
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) <= 3) return;
  overviewLockBodyId = 'free';
  overviewTarget.copy(controls.target);
  configureCamera();
  updateNavigationMode();
}, eventOptions);
renderer.domElement.addEventListener('pointercancel', () => {
  pointerStart = null;
  groundDragPointer = null;
}, eventOptions);
renderer.domElement.addEventListener('pointerup', event => {
  const start = pointerStart;
  pointerStart = null;
  groundDragPointer = null;
  if (groundView) return;
  if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 || performance.now() - start.time > 400) return;
  if (cleanMode) {
    if (event.pointerType === 'touch' && performance.now() - lastTapTime < 350) setCleanView(false);
    lastTapTime = performance.now();
    return;
  }
  if (focusTransition || viewLayer !== 'overview') return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickableMeshes, false)[0];
  if (hit) focusBody(bodyById.get(hit.object.userData.bodyId)!);
}, eventOptions);

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
  if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input:not([type="range"]):not([type="checkbox"]), textarea, select'))) return;
  if (groundView) {
    if (event.key === 'Escape') leaveGround();
    return;
  }
  if ((event.key === 'Escape' || event.key.toLowerCase() === 'u') && document.body.classList.contains('clean-view')) {
    setCleanView(false);
    return;
  }
  if (event.key.toLowerCase() === 'u') {
    setCleanView(true);
    return;
  }
  if (event.key === 'Escape') returnToOverview();
}, eventOptions);

function updateSpeed(): void {
  const speedValue = Number(appSpeedControl.value);
  simulationClock.setSpeed(speedValue);
  simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
  updateOrbitalPositions();
  updateTimeReadout();
  appSpeedControl.setAttribute('aria-valuetext', appSpeedValue.textContent);
  const maximum = Number(appSpeedControl.max) || 1;
  appSpeedControl.style.setProperty('--progress', `${speedValue / maximum * 100}%`);
}
appSpeedControl.addEventListener('input', updateSpeed, eventOptions);
updateSpeed();

// The mode switch is a live morph (updateModeMorph) rather than a slide of
// two captured frames: nothing freezes, and toggling back mid-way reverses
// smoothly from wherever the scene is.
function switchModelMode(enabled: boolean): void {
  setEnhancedModels(enabled);
}

appEnhancedModel.addEventListener('click', () => switchModelMode(true), eventOptions);
appRealModel.addEventListener('click', () => switchModelMode(false), eventOptions);

// During a time jump while looking at Earth, the camera turns with the globe,
// so the ground under it holds still and only the day/night terminator sweeps
// across, rather than the planet spinning away beneath a fixed camera and
// leaving it over the night side.
const earthFrame = new THREE.Quaternion();
const earthFramePrevious = new THREE.Quaternion();
const earthFrameDelta = new THREE.Quaternion();
const earthSpinQuaternion = new THREE.Quaternion();
const earthCameraOffset = new THREE.Vector3();
const EARTH_SPIN_AXIS = new THREE.Vector3(0, 1, 0);
let earthFrameTracked = false;

function followEarthSpin(): void {
  const earth = renderedBodies.get('earth');
  const following = Boolean(timeFlight) && viewLayer === 'focus' && focusedBodyId === 'earth'
    && !focusTransition && !(groundView && groundView.phase !== 'approach') && Boolean(earth?.model.visible);
  if (!following || !earth) {
    earthFrameTracked = false;
    return;
  }
  earthSpinQuaternion.setFromAxisAngle(EARTH_SPIN_AXIS, earth.surface.rotation.y);
  earthFrame.copy(earth.model.quaternion).multiply(earthSpinQuaternion);
  if (earthFrameTracked) {
    earthFrameDelta.copy(earthFramePrevious).invert().premultiply(earthFrame);
    earthCameraOffset.copy(camera.position).sub(controls.target).applyQuaternion(earthFrameDelta);
    camera.position.copy(controls.target).add(earthCameraOffset);
  }
  earthFramePrevious.copy(earthFrame);
  earthFrameTracked = true;
}

function render(now: number): void {
  const started = performance.now();
  const elapsedSeconds = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (!reducedMotion.matches) visualSeconds += elapsedSeconds;
  if (timeFlight) {
    updateTimeFlight(elapsedSeconds);
  } else if (groundView) {
    // The ground view owns the clock: it runs at its own rate and holds
    // still until the observer is standing on the site.
    if (groundView.phase === 'ground') advanceGroundClock(groundView, elapsedSeconds);
  } else if (simulationClock.playing) {
    simulationClock.advance(elapsedSeconds);
    simulationDays = (simulationClock.utcMs - J2000_MS) / DAY_MS;
    updateOrbitalPositions();
  }
  if (orbitsVisible && viewLayer === 'overview' && !focusTransition) {
    // Spread orbit refresh work across frames; hidden orbit lines do no work.
    const stale = BODIES.find(body => body.id !== 'sun' && Math.abs(simulationClock.utcMs - orbitEpochs.get(body.id)!) > DAY_MS * 90);
    if (stale) refreshOrbit(stale);
  }
  updateModeMorph(elapsedSeconds);
  updateFocusTransition(elapsedSeconds);
  applyTransientScales();
  // Standing on the ground only the sky scene is drawn, so the space scene's
  // per-body work waits until leaving begins.
  const onGround = groundView?.phase === 'ground';
  if (!onGround) updateMoonShadow();
  for (const body of onGround ? [] : BODIES) {
    const rendered = renderedBodies.get(body.id);
    if (!rendered?.model.visible) continue;
    if (body.id === 'earth') {
      orientEarth(rendered, simulationClock.utcMs);
    } else if (body.parentId && body.rotationPeriodDays === body.periodDays) {
      // Synchronous satellites keep longitude 0 (the mean sub-planet point)
      // facing the parent, so the Moon always shows Earth its near side.
      const toParent = physicalPositions.get(body.parentId)!.clone().sub(physicalPositions.get(body.id)!);
      rendered.surface.rotation.y = facingAngle(toParent.x, toParent.z);
    } else {
      rendered.surface.rotation.y = rotationAngle(simulationDays, body.rotationPeriodDays);
    }
    const spin = timeFlight?.spins.get(body.id);
    if (spin) rendered.surface.rotation.y = shortestAngleBlend(spin.start, spin.end, timeFlight!.eased);
  }
  if (!onGround) followEarthSpin();
  const groundScene = stepGround(elapsedSeconds);
  const groundSky = groundView?.sky;
  if (groundScene && groundView && groundSky) {
    renderer.render(groundSky.scene, groundSky.camera);
    if (now - lastGroundHudUpdate > 100) {
      updateGroundHud(groundView);
      lastGroundHudUpdate = now;
    }
    if (diagnosticsEnabled) {
      if (elapsedSeconds > 0) frameTimes.push(elapsedSeconds * 1000);
      frameWork.push(performance.now() - started);
    }
    animationId = requestAnimationFrame(render);
    return;
  }
  // While descending the ground view drives the camera, and OrbitControls
  // would clamp it back out to minDistance.
  if (!focusTransition && !(groundView && groundView.phase !== 'approach')) controls.update();
  if (viewLayer === 'overview' && !focusTransition) {
    if (overviewLockBodyId === 'free') overviewTarget.copy(controls.target);
    else syncLockedOverviewCenter(true);
  }
  updateOverviewClipPlanes();
  updateOrbitAppearance();
  camera.updateMatrixWorld();
  for (const body of BODIES) {
    const rendered = renderedBodies.get(body.id);
    if (!rendered?.model.visible) continue;
    rendered.anchor.getWorldPosition(effectWorldPosition);
    effectViewPosition.copy(effectWorldPosition).applyMatrix4(camera.matrixWorldInverse);
    const depth = -effectViewPosition.z;
    // Use the scale actually drawn, which includes flight floors and fades.
    const drawnRadius = rendered.model.scale.x;
    const apparentRadius = depth > 0
      ? drawnRadius * appViewport.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth)
      : 0;
    if (viewLayer === 'overview' && !focusTransition && body.id !== 'sun') {
      // The physical sphere is subpixel here; suppress its stray rasterized
      // fragment without touching catalog radii or the clickable name label.
      rendered.model.scale.multiplyScalar(subpixelDiscScale(apparentRadius));
    }
    const cameraRadiusDistance = camera.position.distanceTo(effectWorldPosition) / Math.max(drawnRadius, 1e-9);
    // Detail belongs to what the user can see, not to a particular navigation
    // layer. It fades in while zooming the overview and is fully active in a
    // label-focus view. This keeps the wide solar-system view inexpensive.
    const overviewThreshold = body.id === 'sun' ? 12 : body.id === 'earth' ? 28 : 34;
    // Effects fade in and out on their own (surface-effects createFader), so
    // they may follow apparent size during flights without popping.
    const showEffects = viewLayer === 'focus'
      ? body.id === focusedBodyId
      : apparentRadius >= overviewThreshold;
    if (body.id === 'sun') effectSunDirection.set(1, 0, 0);
    else effectSunDirection.copy(physicalPositions.get(body.id)!).normalize().negate();
    for (const effect of rendered.effects) {
      effect.setVisible(effect.continuous ? true : showEffects);
      effect.update(visualSeconds, rendered.surface.rotation.y, appViewport.clientHeight, effectSunDirection, cameraRadiusDistance, apparentRadius);
    }
  }
  starBackdrop.update(visualSeconds, camera, renderer.getPixelRatio());
  const modeBlend = easeInOut(modeProgress);
  const outerPlanetRadius = 180 + ((enhancedPlanetOrbits.at(-1) ?? 180) - 180) * modeBlend;
  kuiperBelt.setOuterPlanetRadius(outerPlanetRadius);
  oortCloud.setEnhancedMode(modeBlend > 0, outerPlanetRadius);
  oortCloud.update(renderer.getPixelRatio(), viewLayer === 'overview' ? othersPresence : 0);
  // Small icy/rocky bodies are not luminous rings at solar-system distances.
  // Reveal their models only as the camera actually approaches each belt.
  const kuiperDistance = distanceToAnnulus(camera.position.x, camera.position.y, camera.position.z,
    outerPlanetRadius, outerPlanetRadius * 1.32);
  const kuiperOpacity = proximityOpacity(kuiperDistance, 18, 75) * othersPresence;
  kuiperBelt.update(simulationDays, viewLayer === 'overview' && kuiperBeltVisible, renderer.getPixelRatio(), kuiperOpacity);
  const asteroidDistance = distanceToAnnulus(camera.position.x, camera.position.y, camera.position.z,
    asteroidBeltInnerRadius, asteroidBeltOuterRadius);
  const asteroidOpacity = proximityOpacity(asteroidDistance, 10, 55) * (1 - modeBlend) * othersPresence;
  asteroidBelt.update(simulationDays, viewLayer === 'overview' && modeBlend < 0.999, renderer.getPixelRatio(), asteroidOpacity);
  const renderedSun = renderedBodies.get('sun');
  if (renderedSun && solarGlow) {
    renderedSun.anchor.getWorldPosition(labelWorldPosition);
    labelViewPosition.copy(labelWorldPosition).applyMatrix4(camera.matrixWorldInverse);
    const sunDepth = -labelViewPosition.z;
    const apparentRadius = sunDepth > 0
      ? renderedSun.displayedRadius * appViewport.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * sunDepth)
      : 0;
    // Apparent disc size drives the glare. A small angular floor mimics a
    // bright sensor bloom at long range without leaving a fixed-size starburst.
    const angularBloom = 20 + Math.sqrt(Math.max(apparentRadius, 0)) * 15 + apparentRadius * 1.55;
    const sunInFlight = focusTransition && (focusTransition.bodyId === 'sun' || focusTransition.sourceId === 'sun');
    const glowSize = THREE.MathUtils.clamp(angularBloom, 20, 240) * (sunInFlight ? 1 : othersPresence);
    cameraToSun.copy(camera.position).sub(labelWorldPosition);
    const viewPhase = Math.atan2(cameraToSun.z, cameraToSun.x)
      + Math.asin(THREE.MathUtils.clamp(cameraToSun.y / Math.max(cameraToSun.length(), 0.000001), -1, 1)) * 0.72;
    solarGlow.update(visualSeconds, glowSize, viewPhase, renderedSun.model.visible && sunDepth > 0 && apparentRadius < 82, renderer.getPixelRatio());
  }
  if (outwardZoomRequested && viewLayer === 'focus' && !focusTransition && focusedBodyId) {
    const focused = renderedBodies.get(focusedBodyId)!;
    const limits = focusLimits(focused.displayedRadius, focusHomeDistance);
    if (camera.position.distanceTo(controls.target) >= limits.exit) returnToOverview();
    outwardZoomRequested = false;
  }
  updateLabelPositions();
  renderer.render(scene, camera);
  if (diagnosticsEnabled) {
    if (elapsedSeconds > 0) frameTimes.push(elapsedSeconds * 1000);
    frameWork.push(performance.now() - started);
  }
  if (now - lastUiUpdate > 250) {
    if (!cleanMode) updateTimeReadout();
    lastUiUpdate = now;
    if (diagnosticsEnabled && frameTimes.length >= 60) {
      const sorted = frameTimes.splice(0).sort((a, b) => a - b);
      const cpu = frameWork.splice(0).sort((a, b) => a - b);
      diagnosticOutput.textContent = `帧间隔 p50 ${sorted[Math.floor(sorted.length * 0.5)].toFixed(1)} / p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms · 主线程 p50 ${cpu[Math.floor(cpu.length * 0.5)].toFixed(1)} ms · ${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles} triangles`;
    }
  }
  animationId = requestAnimationFrame(render);
}

document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(animationId);
  lastFrameTime = null;
  if (!document.hidden && !renderFailed) animationId = requestAnimationFrame(render);
}, eventOptions);
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  renderFailed = true;
  cancelAnimationFrame(animationId);
  statusMessage.hidden = false;
  statusMessage.textContent = '图形上下文已中断，恢复后将继续显示。';
}, eventOptions);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  renderFailed = false;
  statusMessage.hidden = true;
  lastFrameTime = null;
  if (!document.hidden) animationId = requestAnimationFrame(render);
}, eventOptions);

function dispose(): void {
  cancelAnimationFrame(animationId);
  abortEvents.abort();
  groundView?.sky?.dispose();
  controls.dispose();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const texture of loadedTextures) if (!textures.has(texture)) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  sunLight.shadow.dispose();
  renderer.dispose();
  appViewport.replaceChildren();
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
animationId = requestAnimationFrame(render);
