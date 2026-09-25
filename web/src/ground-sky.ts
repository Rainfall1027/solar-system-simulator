import * as THREE from 'three';
import { eclipseSky, horizontalDirection, skyBackdrop, type EclipseSky, type GroundSite, type GroundTarget, type SkyPoint } from './eclipse-sky.ts';

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
const CORONA_DISTANCE = 1100;
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

// Corona in units of solar radii (the plane spans +-8 radii).
const CORONA_FRAGMENT = /* glsl */`
  uniform float uLevel;
  uniform float uChromosphere;
  varying vec2 vPoint;
  float streamer(float angle) {
    return 0.55 + 0.25 * cos(angle * 2.0 - 0.4) + 0.12 * cos(angle * 5.0 + 1.3)
      + 0.08 * cos(angle * 13.0 + 0.2) + 0.05 * cos(angle * 29.0 + 2.7);
  }
  void main() {
    float radius = length(vPoint) * 8.0;
    if (radius < 0.98) discard;
    // The plane ends at eight solar radii along its axes. Fade the outer
    // streamers to zero *before* that boundary so its square silhouette can
    // never be composited over the sky, even at high exposure.
    float edge = 1.0 - smoothstep(5.2, 7.7, radius);
    if (edge <= 0.0) discard;
    float angle = atan(vPoint.y, vPoint.x);
    float rays = streamer(angle);
    float height = max(radius - 1.0, 0.0);
    // Unequal, gently curved streamers. Dense inner corona falls much faster
    // than the faint outer structures; no uniform luminous ring or spokes.
    float filaments = pow(0.5 + 0.5 * sin(angle * 19.0 + sin(angle * 7.0) * 2.0
      + 1.8 * log(max(radius, 1.0))), 2.0);
    float inner = 0.65 * exp(-height * (6.5 + rays));
    float outer = 0.18 * exp(-height / (0.32 + rays * 0.75)) / (radius * radius);
    vec3 corona = vec3(0.95, 0.97, 1.0) * (inner + outer * (0.85 + filaments * 0.15)) * uLevel;
    // Thin pink chromosphere, only at 2nd/3rd contact and totality.
    float ring = exp(-pow((radius - 1.012) / 0.012, 2.0));
    float patches = pow(max(0.0, cos(angle * 7.0 + sin(angle * 3.0))), 16.0);
    vec3 pink = vec3(1.0, 0.08, 0.17) * ring * patches * 0.35 * uChromosphere;
    vec3 colour = corona + pink;
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
  const coronaUniforms = { uLevel: { value: 0 }, uChromosphere: { value: 0 } };
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: coronaUniforms, vertexShader: DISC_VERTEX, fragmentShader: CORONA_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  corona.renderOrder = 2;
  scene.add(corona);

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
        placeFacing(corona, sunDirection, CORONA_DISTANCE, CORONA_DISTANCE * Math.tan(state.sun.angularRadius) * 8);
        const visible = event === 'solar-eclipse' ? 1 - state.coverage : 1;
        const sunUp = THREE.MathUtils.smoothstep(state.sun.altitude, -8, 4);
        // Perceived brightness: roughly logarithmic in the remaining sunlight.
        daylight = Math.pow(Math.max(visible, 0.0008), 0.42) * THREE.MathUtils.smoothstep(state.sun.altitude, -12, 8);
        const totality = event === 'solar-eclipse' ? THREE.MathUtils.smoothstep(state.coverage, 0.9999, 1) : 0;
        // Annular eclipses never reveal the corona, even with high coverage.
        const coronaLevel = state.moon.angularRadius >= state.sun.angularRadius ? totality : 0;
        if (event === 'solar-eclipse') daylight = THREE.MathUtils.lerp(daylight, 0.001, totality);
        skyUniforms.uSunDirection.value.copy(sunDirection);
        skyUniforms.uDaylight.value = daylight;
        skyUniforms.uSunUp.value = 0.15 + 0.85 * sunUp;
        skyUniforms.uTotality.value = totality * sunUp;
        coronaUniforms.uLevel.value = coronaLevel;
        coronaUniforms.uChromosphere.value = coronaLevel;
        moonUniforms.uEarthshine.value = 0.3 + 0.7 * totality;
        if (event === 'lunar-eclipse') {
          const minutesFromPeak = Math.abs(utcMs - (options.peakMs ?? utcMs)) / 60_000;
          moonUniforms.uRedness.value = 1 - THREE.MathUtils.smoothstep(minutesFromPeak, 28, 110);
        }
        // Naked-eye limiting magnitude falls as the sky darkens.
        pointUniforms.uLimit.value = 6 - 12 * THREE.MathUtils.smoothstep(daylight, 0.03, 0.42);
        sun.visible = state.sun.altitude > -1;
        moon.visible = event === 'solar-eclipse' ? state.sun.altitude > -1 : state.moon.altitude > -1;
        corona.visible = event === 'solar-eclipse';
        glareUniforms.uLevel.value = Math.pow(visible, 0.7) * sunUp * 0.65;
      }
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
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    },
  };
}
