import * as THREE from 'three';
import { eclipseSky, horizontalDirection, skyBackdrop, type EclipseSky, type GroundSite, type GroundTarget, type SkyPoint } from './eclipse-sky.ts';
import { contactGlowSource, coronaVisibility, ECLIPSE_GLOW_SAMPLES, fillEclipseGlowSources } from './eclipse-optics.ts';

// Eclipse sky view: the observer stands at a real site and looks at the real
// topocentric Sun and Moon. Disc sizes and the Moon's offset are the true
// apparent values, so the ring or totality appears exactly when the ephemeris
// says it does. The view is sky-only and stays centred on the target; sky
// brightness, corona and glare are illustrative shading driven by coverage.
//
// Frame: east +x, up +y, north -z. The camera stays at the origin.

const SKY_RADIUS = 4000;
const SUN_DISTANCE = 1000;
const MOON_DISTANCE = 800;
const GLARE_DISTANCE = 1200;
const STAR_DISTANCE = 3000;
const MIN_FOV = 0.8;
const MAX_FOV = 100;
const DEG = Math.PI / 180;

function vector(direction: readonly [number, number, number], distance = 1): THREE.Vector3 {
  return new THREE.Vector3(...direction).multiplyScalar(distance);
}

function easeInOut(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export interface GroundSkyReadout {
  readonly sky: EclipseSky;
  readonly targetAltitude: number;
  /** Perceived daylight level 0..1 (sky shading input). */
  readonly daylight: number;
}

export interface GroundSky {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Recomputes the sky for utcMs (cheap when the time has not changed). */
  update(utcMs: number, elapsedSeconds: number, viewportHeight: number): GroundSkyReadout;
  /** Starts the establishing shot: a wide view of the target that zooms in. */
  beginIntro(): void;
  /** Glides back onto the target. */
  recentre(): void;
  drag(dxPixels: number, dyPixels: number, viewportHeight: number): void;
  zoom(deltaY: number): void;
  /** Average sky colour (sRGB CSS) for cross-fades into and out of this view. */
  horizonColour(): string;
  resize(aspect: number): void;
  dispose(): void;
}

export interface GroundSkyOptions {
  readonly target?: GroundTarget;
  readonly event?: 'solar-eclipse' | 'lunar-eclipse';
  readonly peakMs?: number;
}

const SKY_VERTEX = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */`
  uniform vec3 uSunDirection;
  uniform float uDaylight;
  uniform float uSunUp;
  uniform float uTotality;
  uniform float uSolarView;
  uniform float uExposure;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float sunCos = dot(direction, uSunDirection);
    // Sky only: below the horizon the haze band continues as a mirror, so the
    // view never shows a rendered ground.
    float altitude = abs(direction.y);
    vec3 zenith = vec3(0.070, 0.20, 0.55);
    vec3 horizon = vec3(0.42, 0.56, 0.74);
    vec3 colour = mix(horizon, zenith, pow(altitude, 0.45));
    // Forward scattering around the Sun.
    float scattering = mix(1.0, 0.12, uSolarView);
    colour += vec3(0.55, 0.50, 0.42) * pow(max(sunCos, 0.0), 24.0) * 0.6 * scattering;
    colour += vec3(0.20, 0.18, 0.15) * pow(max(sunCos, 0.0), 180.0) * scattering;
    float haze = pow(1.0 - altitude, 7.0) * uSunUp;
    colour += vec3(0.26, 0.16, 0.11) * haze * pow(max(sunCos, 0.0), 3.0) * 0.22;
    colour *= uDaylight;
    // Totality: dark blue-violet overhead with a 360 degree twilight band.
    vec3 umbraSky = mix(vec3(0.020, 0.024, 0.055), vec3(0.004, 0.006, 0.018), pow(altitude, 0.5));
    vec3 twilight = vec3(0.85, 0.42, 0.16) * pow(1.0 - altitude, 9.0) * 0.55
      + vec3(0.30, 0.25, 0.42) * pow(1.0 - altitude, 3.0) * 0.12;
    colour += (umbraSky + twilight) * uTotality;
    colour *= uSunUp * uExposure;
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
  }
`;

const DISC_VERTEX = /* glsl */`
  varying vec2 vPoint;
  void main() {
    vPoint = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A single linear-light composite for BOTH solar eclipse types. Analytic
// spherical surfaces share one occultation boundary; optical bloom is applied
// AFTER occultation so light can softly spill across the silhouette, rather
// than being cut off by a foreground black circle. This is an illustrative HDR
// photographic view, not a simulation of unaided-eye exposure or measured terrain.
const SOLAR_ECLIPSE_FRAGMENT = /* glsl */`
  uniform vec2 uMoonOffset;
  uniform float uMoonRadius;
  uniform float uCorona;
  uniform float uCoverage;
  uniform float uSunUp;
  uniform sampler2D uMoonMap;
  uniform sampler2D uMoonHeight;
  uniform vec3 uGlowSources[${ECLIPSE_GLOW_SAMPLES}];
  uniform vec3 uContactGlow;
  varying vec2 vPoint;

  float limbRadius(float a) {
    return 1.0 + 0.00065 * sin(a * 37.0 + 0.7)
      + 0.0004 * sin(a * 73.0 + 2.1) + 0.0002 * sin(a * 131.0 - 0.4);
  }
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
      mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
      mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec2 p = vPoint * 8.0;
    float r = length(p);
    float taper = 1.0 - smoothstep(5.2, 7.7, r);
    if (taper <= 0.0) discard;
    float pixel = max(fwidth(r), 0.0001);
    float solarMask = 1.0 - smoothstep(1.0 - pixel, 1.0 + pixel, r);
    vec2 q = (p - uMoonOffset) / uMoonRadius;
    float lunarR = length(q);
    float lunarLimb = limbRadius(atan(q.y, q.x));
    float lunarPixel = max(fwidth(lunarR), 0.0001);
    float lunarMask = 1.0 - smoothstep(lunarLimb - lunarPixel, lunarLimb + lunarPixel, lunarR);
    float photosphere = solarMask * (1.0 - lunarMask);

    // Limb darkening and weak granulation on a spherical photosphere, not a
    // flat filled circle. Small features fade below pixel resolution.
    float mu = sqrt(max(0.0, 1.0 - r * r));
    vec3 solarNormal = vec3(p, mu);
    float detail = 1.0 - smoothstep(0.002, 0.018, pixel);
    float grain = mix(1.0, 0.97 + 0.06 * noise(solarNormal * 165.0), detail);
    vec3 radiance = vec3(3.4, 2.25, 0.72) * (0.42 + 0.58 * mu) * grain * photosphere;

    // Spherical projection of the existing lunar albedo/height maps. Earthshine
    // is very faint; do not invent a metallic Fresnel ring or a lit full Moon.
    if (lunarMask > 0.0) {
      vec3 n = normalize(vec3(q, sqrt(max(0.0, 1.0 - dot(q, q)))));
      vec2 uv = vec2(0.5 + atan(n.x, n.z) / 6.2831853, 0.5 + asin(n.y) / 3.14159265);
      vec3 albedo = texture2D(uMoonMap, uv).rgb;
      float h = texture2D(uMoonHeight, uv).r;
      float hx = texture2D(uMoonHeight, uv + vec2(0.0008, 0)).r - h;
      float hy = texture2D(uMoonHeight, uv + vec2(0, 0.0008)).r - h;
      float relief = clamp(1.0 + (hx - hy) * 3.0, 0.65, 1.35);
      float earthshine = mix(0.0012, 0.009, uCorona);
      radiance += albedo * vec3(0.88, 0.92, 1.0) * earthshine
        * (0.30 + 0.70 * pow(max(n.z, 0.0), 0.55)) * relief * lunarMask;
    }

    float angle = atan(p.y, p.x);
    float height = max(r - 1.0, 0.0);
    float streamer = 0.60 + 0.24 * cos(angle * 2.0 - 0.4)
      + 0.12 * cos(angle * 5.0 + 1.3) + 0.07 * cos(angle * 13.0 + 0.2);
    float filaments = 0.86 + 0.14 * sin(angle * 31.0 + sin(angle * 7.0) + log(max(r, 1.0)) * 2.0);
    float corona = (0.62 * exp(-height * 6.0)
      + 0.16 * exp(-height / (0.3 + streamer)) / max(r * r, 1.0) * filaments)
      * smoothstep(0.98, 1.01, r) * uCorona * (1.0 - lunarMask);
    vec3 optical = vec3(1.0, 0.86, 0.62) * corona;

    // A finite point-spread approximation integrates only exposed solar arcs.
    // It creates localized contact glare and wraps a little light over the
    // lunar edge. No fixed-position highlight and no bloom from occulted light.
    float insideMoon = max(uMoonRadius - length(p - uMoonOffset), 0.0);
    if (r < 3.7 && uCoverage < 1.0 && insideMoon < 0.35) {
      float bloom = 0.0;
      for (int i = 0; i < ${ECLIPSE_GLOW_SAMPLES}; i++) {
        vec2 d = p - uGlowSources[i].xy;
        float d2 = dot(d, d);
        bloom += uGlowSources[i].z * (3.5 * exp(-d2 / 0.017)
          + 0.38 * exp(-d2 / 0.20) + 0.035 * exp(-sqrt(d2) * 2.6));
      }
      bloom *= (1.0 + 2.2 * smoothstep(0.9, 1.0, uCoverage)) / float(${ECLIPSE_GLOW_SAMPLES});
      // Only the immediate silhouette receives a photographic light wrap;
      // broad PSF wings must not turn the dark lunar face into a glass lens.
      float lightWrap = exp(-insideMoon / 0.035);
      optical += vec3(1.0, 0.65, 0.22) * bloom * 3.2 * lightWrap;
      vec2 contactDelta = p - uContactGlow.xy;
      float contactD2 = dot(contactDelta, contactDelta);
      float contactCore = 5.0 * exp(-contactD2 / 0.0015);
      float contactHalo = 0.65 * exp(-contactD2 / 0.025) + 0.07 * exp(-contactD2 / 0.16);
      optical += (vec3(1.0, 0.91, 0.68) * contactCore
        + vec3(1.0, 0.55, 0.16) * contactHalo) * uContactGlow.z * lightWrap;
    }
    // The chromosphere belongs to the Sun, not to the Moon's surface.
    float chromosphere = exp(-pow((r - 1.006) / 0.008, 2.0))
      * pow(max(0.0, cos(angle * 7.0 + sin(angle * 3.0))), 12.0)
      * uCorona * (1.0 - lunarMask);
    optical += vec3(0.5, 0.025, 0.04) * chromosphere;
    radiance += optical;
    radiance *= taper * uSunUp;
    // Gentle highlight roll-off preserves a yellow glow and pale luminous core.
    vec3 mapped = 1.0 - exp(-radiance);
    float discAlpha = max(solarMask, lunarMask);
    float glowAlpha = clamp(max(mapped.r, max(mapped.g, mapped.b)), 0.0, 1.0);
    float alpha = max(discAlpha, glowAlpha) * taper;
    if (alpha < 0.00001) discard;
    gl_FragColor = vec4(mapped / max(alpha, 0.00001), alpha);
    #include <colorspace_fragment>
  }
`;

const SUN_FRAGMENT = /* glsl */`
  uniform float uSolarView;
  varying vec2 vPoint;
  void main() {
    float radius = length(vPoint);
    float mu = sqrt(max(0.0, 1.0 - radius * radius));
    // Visible-band limb darkening.
    float limb = 1.0 - 0.6 * (1.0 - mu);
    vec3 colour = mix(vec3(1.0, 0.97, 0.90) * mix(0.72, 1.0, limb),
      vec3(1.0, 0.91, 0.73) * limb, uSolarView);
    float width = mix(0.015, max(fwidth(radius), 0.0001), uSolarView);
    float edge = 1.0 - smoothstep(1.0 - width, 1.0, radius);
    gl_FragColor = vec4(colour, edge);
    #include <colorspace_fragment>
  }
`;

const MOON_FRAGMENT = /* glsl */`
  uniform float uEarthshine;
  uniform float uLunar;
  uniform float uRedness;
  uniform float uExposure;
  uniform sampler2D uMoonMap;
  varying vec2 vPoint;
  void main() {
    float radius = length(vPoint);
    float edgeWidth = mix(max(fwidth(radius), 0.0001), 0.008, uLunar);
    float edge = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, radius);
    vec2 uv = vPoint * 0.5 + 0.5;
    vec3 lunar = texture2D(uMoonMap, uv).rgb * mix(vec3(0.72), vec3(0.74, 0.22, 0.12), uRedness);
    lunar *= mix(0.8, 0.43, uRedness);
    vec3 colour = mix(vec3(0.001, 0.0012, 0.0018) * uEarthshine * uExposure, lunar, uLunar);
    gl_FragColor = vec4(colour, edge);
    #include <colorspace_fragment>
  }
`;

const GLARE_FRAGMENT = /* glsl */`
  uniform float uLevel;
  uniform float uCore;
  uniform float uSolarView;
  varying vec2 vPoint;
  void main() {
    float radius = length(vPoint);
    // A broad radial taper retains the lens halo but reaches exactly zero
    // inside the square plane's nearest edge (radius 1 along either axis).
    float edge = 1.0 - smoothstep(0.35, 0.95, radius);
    if (edge <= 0.0) discard;
    float halo = exp(-radius * 5.5) * 0.55 + exp(-radius * 18.0) * 0.8;
    float core = exp(-radius / max(uCore, 1e-4)) * 0.6;
    vec3 colour = vec3(1.0, 0.94, 0.82) * (halo + core) * uLevel;
    // Solar photographic bloom stays immediately outside the photosphere.
    // The solar glare plane spans four solar radii, not a fixed screen size.
    float solarRadius = radius * 4.0;
    float height = max(solarRadius - 1.0, 0.0);
    float solarBloom = (exp(-height * 22.0) * 0.05 + exp(-height * 5.0) * 0.004)
      * smoothstep(0.98, 1.0, solarRadius);
    colour = mix(colour, vec3(1.0, 0.91, 0.75) * solarBloom * uLevel, uSolarView);
    gl_FragColor = vec4(colour, edge);
    #include <colorspace_fragment>
  }
`;

const POINT_VERTEX = /* glsl */`
  attribute float aMagnitude;
  attribute vec3 aTint;
  uniform float uLimit;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = clamp((uLimit - aMagnitude) / 1.6, 0.0, 1.0) * step(0.0, position.y);
    vTint = aTint;
    gl_PointSize = clamp(3.4 - aMagnitude * 0.55, 1.4, 6.0) * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POINT_FRAGMENT = /* glsl */`
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.35, 1.0, radius)) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vTint, alpha);
    #include <colorspace_fragment>
  }
`;

export function createGroundSky(site: GroundSite, pixelRatio: number, options: GroundSkyOptions = {}): GroundSky {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 1, SKY_RADIUS * 1.5);
  const event = options.event ?? 'solar-eclipse';
  const target = options.target ?? (event === 'lunar-eclipse' ? 'moon' : 'sun');

  const skyUniforms = {
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uDaylight: { value: 1 },
    uSunUp: { value: 1 },
    uTotality: { value: 0 },
    uSolarView: { value: event === 'solar-eclipse' ? 1 : 0 },
    uExposure: { value: 1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 96, 64),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false }),
  );
  sky.renderOrder = 0;
  scene.add(sky);

  const starGeometry = new THREE.BufferGeometry();
  const pointCount = 30;
  starGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
  starGeometry.setAttribute('aMagnitude', new THREE.BufferAttribute(new Float32Array(pointCount), 1));
  const tints = new Float32Array(pointCount * 3);
  for (let index = 0; index < pointCount; index++) {
    const planet = index >= 25;
    tints.set(planet ? [1.0, 0.93, 0.78] : [0.86, 0.9, 1.0], index * 3);
  }
  starGeometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  const pointUniforms = { uLimit: { value: -10 }, uPixelRatio: { value: pixelRatio } };
  const points = new THREE.Points(starGeometry, new THREE.ShaderMaterial({
    uniforms: pointUniforms, vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = 1;
  scene.add(points);

  const discGeometry = new THREE.CircleGeometry(1, 128);
  const sun = new THREE.Mesh(discGeometry, new THREE.ShaderMaterial({
    uniforms: { uSolarView: skyUniforms.uSolarView },
    vertexShader: DISC_VERTEX, fragmentShader: SUN_FRAGMENT, transparent: true, depthTest: false, depthWrite: false,
  }));
  sun.renderOrder = 3;
  scene.add(sun);

  const moonTexture = new THREE.TextureLoader().load('/textures/moon.jpg');
  moonTexture.colorSpace = THREE.SRGBColorSpace;
  const moonUniforms = { uEarthshine: { value: 1 }, uLunar: { value: event === 'lunar-eclipse' ? 1 : 0 }, uRedness: { value: 0 }, uMoonMap: { value: moonTexture }, uExposure: { value: 1 } };
  const moon = new THREE.Mesh(discGeometry, new THREE.ShaderMaterial({
    uniforms: moonUniforms, vertexShader: DISC_VERTEX, fragmentShader: MOON_FRAGMENT, transparent: true, depthTest: false, depthWrite: false,
  }));
  moon.renderOrder = 4;
  scene.add(moon);

  const moonHeight = event === 'solar-eclipse' ? new THREE.TextureLoader().load('/textures/moon-height.jpg') : null;
  const glowSources = new Float32Array(ECLIPSE_GLOW_SAMPLES * 3);
  const eclipseUniforms = {
    uMoonOffset: { value: new THREE.Vector2() }, uMoonRadius: { value: 1 },
    uCorona: { value: 0.025 }, uCoverage: { value: 0 }, uSunUp: { value: 1 },
    uMoonMap: { value: moonTexture }, uMoonHeight: { value: moonHeight },
    uGlowSources: { value: glowSources },
    uContactGlow: { value: new THREE.Vector3() },
  };
  const solarComposite = event === 'solar-eclipse' ? new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: eclipseUniforms, vertexShader: DISC_VERTEX, fragmentShader: SOLAR_ECLIPSE_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false,
  })) : null;
  if (solarComposite) { solarComposite.renderOrder = 4; scene.add(solarComposite); }

  const glareUniforms = { uLevel: { value: 0 }, uCore: { value: 0.02 }, uSolarView: { value: event === 'solar-eclipse' ? 1 : 0 } };
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: glareUniforms, vertexShader: DISC_VERTEX, fragmentShader: GLARE_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  // Sensor glare belongs behind the resolved solar disc; otherwise it
  // bleaches out the lunar silhouette at close zoom.
  glare.renderOrder = 2;
  scene.add(glare);

  let lastUtcMs = Number.NaN;
  let lastBackdropMs = Number.NaN;
  let state: EclipseSky | null = null;
  let daylight = 1;
  let targetAltitude = 0;
  let targetAzimuth = 0;
  const sunDirection = new THREE.Vector3(0, 1, 0);
  const lookDirection = new THREE.Vector3();
  const glareLocalMoon = new THREE.Vector3();
  const glareInverseRotation = new THREE.Quaternion();

  // View: the camera always looks at the target plus a small user offset in
  // degrees. The offset is bounded by the field of view so the target never
  // leaves the frame, and it drifts back to zero shortly after a drag.
  const TARGET_FOV = 2.6;
  const DEFAULT_FOV = event === 'lunar-eclipse' ? 5 : TARGET_FOV;
  let offsetYaw = 0;
  let offsetPitch = 0;
  let idleSeconds = Infinity;
  let returning = false;
  let fov = DEFAULT_FOV;
  let fovGoal = DEFAULT_FOV;
  // Establishing shot: starts wide on the target and zooms in. The FOV is
  // interpolated in log space so the zoom reads as a constant rate.
  interface Intro { elapsed: number; duration: number; startFov: number; endFov: number }
  let intro: Intro | null = null;
  let coronaTarget = 0;
  let coronaBrightness = 0;

  function placeFacing(mesh: THREE.Object3D, direction: THREE.Vector3, distance: number, radius: number) {
    mesh.position.copy(direction).multiplyScalar(distance);
    mesh.scale.setScalar(radius);
    mesh.lookAt(0, 0, 0);
  }

  function refreshBackdrop(utcMs: number) {
    const { stars, planets } = skyBackdrop(utcMs, site);
    const positions = starGeometry.getAttribute('position') as THREE.BufferAttribute;
    const magnitudes = starGeometry.getAttribute('aMagnitude') as THREE.BufferAttribute;
    const write = (point: SkyPoint, index: number) => {
      const direction = vector(horizontalDirection(point.altitude, point.azimuth), STAR_DISTANCE);
      positions.setXYZ(index, direction.x, direction.y, direction.z);
      magnitudes.setX(index, point.magnitude);
    };
    stars.forEach(write);
    planets.forEach((planet, index) => write(planet, stars.length + index));
    positions.needsUpdate = true;
    magnitudes.needsUpdate = true;
  }

  function clampOffset() {
    // Keep the target inside the central part of the frame.
    const limit = Math.max(fov * 0.4, 0.6);
    const cosAltitude = Math.max(Math.cos(targetAltitude * DEG), 0.05);
    const length = Math.hypot(offsetYaw * cosAltitude, offsetPitch);
    if (length > limit) {
      const scale = limit / length;
      offsetYaw *= scale;
      offsetPitch *= scale;
    }
  }

  function applyView(elapsedSeconds: number) {
    if (!state) return;
    const dt = Math.min(elapsedSeconds, 0.1);
    if (intro) {
      intro.elapsed += dt;
      const progress = easeInOut(intro.elapsed / intro.duration);
      fov = fovGoal = Math.exp(Math.log(intro.startFov) + (Math.log(intro.endFov) - Math.log(intro.startFov)) * progress);
      if (intro.elapsed >= intro.duration) intro = null;
    } else {
      // Zoom eases towards the wheel's goal in log space.
      fov = Math.exp(Math.log(fov) + (Math.log(fovGoal) - Math.log(fov)) * (1 - Math.exp(-dt * 9)));
    }
    idleSeconds += dt;
    if (returning || idleSeconds > 1.8) {
      const decay = Math.exp(-dt * (returning ? 5 : 1.4));
      offsetYaw *= decay;
      offsetPitch *= decay;
      if (Math.hypot(offsetYaw, offsetPitch) < 1e-4) {
        offsetYaw = 0;
        offsetPitch = 0;
        returning = false;
      }
    }
    clampOffset();
    const pitch = THREE.MathUtils.clamp(targetAltitude + offsetPitch, -89.4, 89.4);
    lookDirection.set(...horizontalDirection(pitch, targetAzimuth + offsetYaw));
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(lookDirection);
    if (Math.abs(camera.fov - fov) > 1e-6) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  return {
    scene,
    camera,
    update(utcMs, elapsedSeconds, viewportHeight) {
      if (utcMs !== lastUtcMs) {
        lastUtcMs = utcMs;
        state = eclipseSky(utcMs, site);
        if (!(Math.abs(utcMs - lastBackdropMs) < 60_000)) {
          lastBackdropMs = utcMs;
          refreshBackdrop(utcMs);
        }
        sunDirection.set(...horizontalDirection(state.sun.altitude, state.sun.azimuth));
        const moonDirection = vector(horizontalDirection(state.moon.altitude, state.moon.azimuth));
        const targetDisc = target === 'moon' ? state.moon : state.sun;
        targetAltitude = targetDisc.altitude;
        targetAzimuth = targetDisc.azimuth;
        placeFacing(sun, sunDirection, SUN_DISTANCE, SUN_DISTANCE * Math.tan(state.sun.angularRadius));
        placeFacing(moon, moonDirection, MOON_DISTANCE, MOON_DISTANCE * Math.tan(state.moon.angularRadius));
        const visible = event === 'solar-eclipse' ? 1 - state.coverage : 1;
        const sunUp = THREE.MathUtils.smoothstep(state.sun.altitude, -8, 4);
        // Perceived brightness: roughly logarithmic in the remaining sunlight.
        daylight = Math.pow(Math.max(visible, 0.0008), 0.42) * THREE.MathUtils.smoothstep(state.sun.altitude, -12, 8);
        const totality = event === 'solar-eclipse' ? THREE.MathUtils.smoothstep(state.coverage, 0.9999, 1) : 0;
        // A short exposure transition around contact, not a binary totality
        // threshold. Keep the annular halo separate from the solar corona.
        coronaTarget = event === 'solar-eclipse'
          ? coronaVisibility(state.coverage, state.moon.angularRadius / state.sun.angularRadius) : 0;
        if (event === 'solar-eclipse') daylight = THREE.MathUtils.lerp(daylight, 0.001, totality);
        skyUniforms.uSunDirection.value.copy(sunDirection);
        skyUniforms.uDaylight.value = daylight;
        skyUniforms.uSunUp.value = 0.15 + 0.85 * sunUp;
        skyUniforms.uTotality.value = totality * sunUp;
        moonUniforms.uEarthshine.value = 0.3 + 0.7 * totality;
        if (event === 'lunar-eclipse') {
          const minutesFromPeak = Math.abs(utcMs - (options.peakMs ?? utcMs)) / 60_000;
          moonUniforms.uRedness.value = 1 - THREE.MathUtils.smoothstep(minutesFromPeak, 28, 110);
        }
        // Naked-eye limiting magnitude falls as the sky darkens.
        pointUniforms.uLimit.value = 6 - 12 * THREE.MathUtils.smoothstep(daylight, 0.03, 0.42);
        sun.visible = event === 'lunar-eclipse' && state.sun.altitude > -1;
        moon.visible = event === 'lunar-eclipse' && state.moon.altitude > -1;
        glare.visible = event === 'lunar-eclipse';
        if (solarComposite) {
          solarComposite.visible = state.sun.altitude > -1;
          placeFacing(solarComposite, sunDirection, SUN_DISTANCE, SUN_DISTANCE * Math.tan(state.sun.angularRadius) * 8);
          glareInverseRotation.copy(solarComposite.quaternion).invert();
          glareLocalMoon.copy(moonDirection).applyQuaternion(glareInverseRotation);
          const scale = Math.max(Math.abs(glareLocalMoon.z) * Math.tan(state.sun.angularRadius), 1e-8);
          const mx = glareLocalMoon.x / scale, my = glareLocalMoon.y / scale;
          const mr = Math.tan(state.moon.angularRadius) / Math.tan(state.sun.angularRadius);
          eclipseUniforms.uMoonOffset.value.set(mx, my);
          eclipseUniforms.uMoonRadius.value = mr;
          eclipseUniforms.uCoverage.value = state.coverage;
          eclipseUniforms.uSunUp.value = sunUp;
          fillEclipseGlowSources(glowSources, mx, my, mr);
          eclipseUniforms.uContactGlow.value.set(...contactGlowSource(glowSources, state.coverage));
        }
        glareUniforms.uLevel.value = Math.pow(visible, 0.7) * sunUp * 0.65;
      }
      // Smooth in wall-clock time as well so accelerated playback cannot skip
      // the fade. Explicit timeline seeks (dt = 0) render the requested instant.
      coronaBrightness = elapsedSeconds === 0 ? coronaTarget
        : THREE.MathUtils.lerp(coronaBrightness, coronaTarget, 1 - Math.exp(-Math.min(elapsedSeconds, 0.1) / 0.55));
      eclipseUniforms.uCorona.value = coronaBrightness;
      applyView(elapsedSeconds);
      if (state) {
        // Close solar views emulate filtered/short-exposure photography. The
        // wide establishing shot retains daylight; totality reveals the corona.
        const closeView = 1 - THREE.MathUtils.smoothstep(camera.fov, 5, 18);
        const exposure = event === 'solar-eclipse'
          ? THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(0.0003, 0.22, skyUniforms.uTotality.value), closeView)
          : 1;
        skyUniforms.uExposure.value = exposure;
        moonUniforms.uExposure.value = exposure;
        // Solar bloom follows angular solar size through zoom; retain the
        // existing lens-glare sizing for the separate lunar-eclipse scene.
        const halfHeight = Math.tan(camera.fov * DEG / 2);
        const glareRadius = GLARE_DISTANCE * (event === 'solar-eclipse'
          ? Math.tan(state.sun.angularRadius) * 4
          : Math.max(Math.tan(state.sun.angularRadius) * 9, halfHeight * 0.12));
        placeFacing(glare, sunDirection, GLARE_DISTANCE, glareRadius);
        const sunPixels = Math.tan(state.sun.angularRadius) / halfHeight * viewportHeight / 2;
        glareUniforms.uCore.value = THREE.MathUtils.clamp(sunPixels / (viewportHeight * 0.45), 0.008, 0.6);
      }
      return { sky: state!, daylight, targetAltitude };
    },
    beginIntro() {
      offsetYaw = 0;
      offsetPitch = 0;
      returning = false;
      idleSeconds = Infinity;
      const startFov = event === 'lunar-eclipse' ? 40 : 32;
      intro = { elapsed: 0, duration: 3.6, startFov, endFov: DEFAULT_FOV };
      fov = fovGoal = startFov;
    },
    recentre() {
      returning = true;
      if (!intro) fovGoal = DEFAULT_FOV;
    },
    drag(dx, dy, viewportHeight) {
      returning = false;
      idleSeconds = 0;
      const degreesPerPixel = fov / Math.max(viewportHeight, 1);
      const cosAltitude = Math.max(Math.cos(targetAltitude * DEG), 0.05);
      offsetYaw -= dx * degreesPerPixel / cosAltitude;
      offsetPitch += dy * degreesPerPixel;
      clampOffset();
    },
    zoom(deltaY) {
      // Scrolling during the establishing shot hands the zoom to the user.
      if (intro) {
        fovGoal = fov;
        intro = null;
      }
      fovGoal = THREE.MathUtils.clamp(fovGoal * Math.exp(deltaY * 0.0012), MIN_FOV, MAX_FOV);
    },
    horizonColour() {
      const colour = new THREE.Color(0.42, 0.56, 0.74).multiplyScalar(Math.max(daylight, 0.02));
      return `#${colour.getHexString(THREE.SRGBColorSpace)}`;
    },
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    dispose() {
      moonTexture.dispose();
      moonHeight?.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    },
  };
}
