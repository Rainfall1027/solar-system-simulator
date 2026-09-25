import * as THREE from 'three';
import type { BodyId } from './bodies';
import { EARTH_WIND_GLSL, sampleEarthWind, sampleOceanCurrent } from './earth-wind-demo.ts';

// All flow below is illustrative GPU shading, not meteorological observation
// or an extra dynamical integrator. One shared visual clock is independent of
// sidereal rotation and ephemeris time.
export interface SurfaceEffect {
  readonly continuous?: boolean;
  update(visualSeconds: number, surfaceAngle: number, height: number, sunlight: THREE.Vector3, cameraRadiusDistance: number, apparentRadiusPixels?: number): void;
  // Detail effects fade toward the requested state over ~0.45 s of visual
  // time instead of switching on or off within one frame.
  setVisible(visible: boolean): void;
}

export interface EarthCloudEffect extends SurfaceEffect {
  setLayer(layer: number, immediate?: boolean): void;
  setOverlayOpacity(opacity: number): void;
  setAnimationPlaying(playing: boolean): void;
}

// Eased 0..1 level that follows a boolean target on the shared visual clock.
// When that clock does not advance (first frame, reduced motion) it snaps.
function createFader(seconds = 0.45) {
  let level = 0;
  let target = 0;
  let lastTime: number | null = null;
  return {
    set(visible: boolean) { target = visible ? 1 : 0; },
    snap(visible: boolean) { target = level = visible ? 1 : 0; },
    advance(time: number): number {
      const elapsed = lastTime === null ? 0 : time - lastTime;
      lastTime = time;
      if (elapsed <= 0 || elapsed > 1) level = target;
      else level = target > level ? Math.min(target, level + elapsed / seconds) : Math.max(target, level - elapsed / seconds);
      return level * level * (3 - 2 * level);
    },
  };
}

const NOISE = /* glsl */`
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x),
                 mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x),
                 mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float value = 0.0, amplitude = 0.55;
  for (int octave = 0; octave < 4; octave++) {
    value += noise3(p) * amplitude;
    p = p * 2.03 + vec3(9.2, 3.7, 1.8);
    amplitude *= 0.5;
  }
  return value;
}
`;

export function solarSurface(texture: THREE.Texture): { material: THREE.ShaderMaterial; effect: SurfaceEffect } {
  texture.wrapS = THREE.RepeatWrapping;
  const uniforms = { uSurface: { value: texture }, uTime: { value: 0 }, uDetail: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vPoint;
      varying vec3 vViewNormal;
      void main() {
        vUv = uv; vPoint = normalize(position); vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uSurface;
      uniform float uTime, uDetail;
      varying vec2 vUv;
      varying vec3 vPoint;
      varying vec3 vViewNormal;
      ${NOISE}
      void main() {
        vec2 sampleUv = vUv;
        float heat = 0.0;
        if (uDetail > 0.001) {
          // Three-dimensional turbulence remains continuous at the UV seam.
          vec3 p = vPoint * 8.0;
          vec3 drift = vec3(uTime * 0.092, -uTime * 0.061, uTime * 0.041);
          vec3 flow = vec3(fbm(p + drift), fbm(p.yzx - drift * 0.83 + 13.1), fbm(p.zxy + drift * 0.71 + 31.7)) - 0.5;
          float latitude = 1.0 - vPoint.y * vPoint.y;
          sampleUv += vec2(flow.x * 0.044 * latitude, flow.y * 0.022) * uDetail;
          heat = fbm(vPoint * 38.0 + flow * 4.6 - drift * 1.8);
        }
        vec3 surface = texture2D(uSurface, vec2(fract(sampleUv.x), clamp(sampleUv.y, 0.001, 0.999))).rgb;
        float brightness = dot(surface, vec3(0.299, 0.587, 0.114));
        // Preserve dark sunspots. Bright convection does not paint over them.
        float activityMask = smoothstep(0.035, 0.32, brightness);
        float pulse = 1.0 + sin(uTime * 0.92 + heat * 7.0) * 0.055 * uDetail;
        float limb = pow(1.0 - abs(vViewNormal.z), 2.2);
        // Keep the plasma motion broad and gaseous. The previous high-frequency
        // ridge mask produced bright cellular outlines at close range.
        float broadGlow = smoothstep(0.56, 0.88, heat);
        vec3 colour = surface * (1.04 + heat * 0.24 * uDetail) * pulse;
        colour += vec3(0.72, 0.14, 0.008) * broadGlow * 0.24 * activityMask * uDetail;
        colour += vec3(0.82, 0.16, 0.008) * limb * 0.07;
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false
  });
  const fader = createFader();
  return {
    material,
    effect: {
      update(time) {
        uniforms.uTime.value = time;
        uniforms.uDetail.value = fader.advance(time);
      },
      setVisible(visible) { fader.set(visible); }
    }
  };
}

export function gasFlow(material: THREE.MeshStandardMaterial, id: BodyId): SurfaceEffect {
  if (material.map) material.map.wrapS = THREE.RepeatWrapping;
  const uniforms = {
    uFlowTime: { value: 0 },
    uFlowDetail: { value: 0 },
    uJets: { value: id === 'jupiter' ? 42 : id === 'saturn' ? 56 : 24 },
    uFlowScale: { value: id === 'jupiter' ? 1 : id === 'saturn' ? 0.76 : id === 'neptune' ? 0.82 : 0.5 }
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = `uniform float uFlowTime, uFlowDetail, uJets, uFlowScale;\n${NOISE}\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`
      #ifdef USE_MAP
        vec2 flowUv = vMapUv;
        if (uFlowDetail > 0.001) {
          float latitude = (flowUv.y - 0.5) * 3.14159265;
          float belt = sin(latitude * uJets);
          float poleMask = cos(latitude) * cos(latitude);
          float longitude = flowUv.x * 6.2831853;
          vec3 point = vec3(cos(longitude) * cos(latitude), sin(latitude), sin(longitude) * cos(latitude));
          vec3 timeFlow = vec3(uFlowTime * 0.082, -uFlowTime * 0.052, uFlowTime * 0.039) * uFlowScale;
          float eddyA = fbm(point * 13.0 + timeFlow);
          float eddyB = fbm(point.yzx * 21.0 - timeFlow * 0.73 + 19.0);
          float zonalSpeed = (0.0032 + belt * 0.0014 + (eddyA - 0.5) * 0.0008) * poleMask * uFlowScale;
          vec2 drift = vec2(uFlowTime * zonalSpeed + (eddyA - 0.5) * 0.036,
                            (eddyB - 0.5) * 0.016 * poleMask);
          vec2 movingUv = vec2(fract(flowUv.x + drift.x), clamp(flowUv.y + drift.y, 0.001, 0.999));
          vec4 stableCloud = texture2D(map, flowUv);
          vec4 movingCloud = texture2D(map, movingUv);
          float stormPulse = 0.86 + 0.25 * fbm(point * 27.0 + timeFlow * 1.8 + vec3(belt));
          diffuseColor *= mix(stableCloud, movingCloud, 0.72 * uFlowDetail) * mix(1.0, stormPulse, uFlowDetail);
        } else {
          diffuseColor *= texture2D(map, flowUv);
        }
      #endif
    `);
  };
  material.customProgramCacheKey = () => `gas-latitude-flow-v4-${id}`;
  const fader = createFader();
  return {
    update(time) {
      uniforms.uFlowTime.value = time;
      uniforms.uFlowDetail.value = fader.advance(time);
    },
    setVisible(visible) { fader.set(visible); }
  };
}

function flowTraceLines(positions: Float32Array, progress: Float32Array, seeds: Float32Array, uvs: Float32Array, speeds: Float32Array, paths: number, pointsPerPath: number, uniforms: THREE.ShaderMaterial['uniforms']): THREE.LineSegments {
  const segments = paths * (pointsPerPath - 1);
  const linePositions = new Float32Array(segments * 6);
  const lineProgress = new Float32Array(segments * 2);
  const lineSeeds = new Float32Array(segments * 2);
  const lineUvs = new Float32Array(segments * 4);
  const lineSpeeds = new Float32Array(segments * 2);
  for (let path = 0; path < paths; path++) {
    for (let step = 0; step < pointsPerPath - 1; step++) {
      const from = path * pointsPerPath + step;
      const segment = path * (pointsPerPath - 1) + step;
      for (let endpoint = 0; endpoint < 2; endpoint++) {
        const source = from + endpoint;
        const target = segment * 2 + endpoint;
        linePositions.set(positions.subarray(source * 3, source * 3 + 3), target * 3);
        lineProgress[target] = progress[source];
        lineSeeds[target] = seeds[source];
        lineUvs.set(uvs.subarray(source * 2, source * 2 + 2), target * 2);
        lineSpeeds[target] = speeds[source];
      }
    }
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('aProgress', new THREE.BufferAttribute(lineProgress, 1));
  lineGeometry.setAttribute('aSeed', new THREE.BufferAttribute(lineSeeds, 1));
  lineGeometry.setAttribute('aUv', new THREE.BufferAttribute(lineUvs, 2));
  lineGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(lineSpeeds, 1));
  const lineMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */`
      attribute float aProgress;
      attribute float aSeed;
      attribute vec2 aUv;
      attribute float aSpeed;
      uniform float uTime;
      uniform float uLevel;
      varying float vAlpha;
      varying vec2 vUv;
      varying float vSpeed;
      void main() {
        float phase = fract(aProgress * 2.0 - uTime * 0.11 + aSeed);
        float pulse = pow(max(0.0, 1.0 - abs(phase - 0.5) * 4.0), 2.0);
        vAlpha = (0.54 + 0.46 * pulse) * uLevel;
        vUv = aUv;
        vSpeed = aSpeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      varying vec2 vUv;
      varying float vSpeed;
      uniform sampler2D uEarthMap;
      uniform float uOceanMask;
      void main() {
        vec3 surface = texture2D(uEarthMap, vUv).rgb;
        float water = step(surface.r * 1.12, surface.b) * step(surface.g * 0.97, surface.b);
        if (uOceanMask > 0.5 && water < 0.5) discard;
        vec3 low = uOceanMask > 0.5 ? vec3(0.02, 0.24, 0.79) : vec3(0.03, 0.30, 0.92);
        vec3 high = uOceanMask > 0.5 ? vec3(0.04, 0.92, 0.65) : vec3(1.0, 0.54, 0.08);
        gl_FragColor = vec4(mix(low, high, smoothstep(0.05, 0.9, vSpeed)), vAlpha);
        #include <colorspace_fragment>
      }
    `
  });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.renderOrder = 3;
  lines.frustumCulled = false;
  return lines;
}

export function earthClouds(model: THREE.Group, geometry: THREE.BufferGeometry, cloudTexture: THREE.Texture, earthTexture: THREE.Texture, moonShadow?: MoonShadowUniforms): EarthCloudEffect {
  cloudTexture.wrapS = THREE.RepeatWrapping;
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  cloudTexture.anisotropy = 8;
  const flowTime = { value: 0 };
  const windBlend = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: cloudTexture,
    transparent: true,
    opacity: 0.72,
    alphaTest: 0.012,
    roughness: 1,
    emissive: 0x08111f,
    emissiveIntensity: 0.12,
    depthWrite: false
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uCloudFlowTime = flowTime;
    shader.uniforms.uWindDemoBlend = windBlend;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudPoint = normalize(position);');
    shader.fragmentShader = `uniform float uCloudFlowTime;
uniform float uWindDemoBlend;
varying vec3 vCloudPoint;
${NOISE}
${EARTH_WIND_GLSL}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`
      vec3 spherePoint = normalize(vCloudPoint);
      // The photographed cloud mask defines all visible coverage. Earlier
      // procedural coverage invented broad opaque ribbons across the ocean.
      // A gentle latitude-dependent advection and bounded domain warp move
      // existing cloud systems without drawing new geometric streaks.
      float latitude = abs(spherePoint.y);
      float regionalWind = noise3(spherePoint * 2.8 + vec3(7.3, 2.1, 11.9));
      float zonalSpeed = 0.00016 + 0.00006 * (1.0 - latitude)
        + (regionalWind - 0.5) * 0.000035;
      float windAngle = uCloudFlowTime * zonalSpeed;
      vec3 flowPoint = spherePoint * 11.0;
      float flowTime = uCloudFlowTime * 0.012;
      vec2 eddy = vec2(
        noise3(flowPoint + vec3(flowTime, -flowTime * 0.7, 4.2)),
        noise3(flowPoint.yzx + vec3(9.7, flowTime * 0.8, -flowTime))
      ) - 0.5;
      vec2 cloudUv = vMapUv + vec2(windAngle / 6.2831853, 0.0)
        + eddy * vec2(0.0028, 0.0015) * (1.0 - latitude * 0.55);
      vec4 originalCloud = texture2D(map, vec2(fract(cloudUv.x), clamp(cloudUv.y, 0.001, 0.999)));
      // Crossfade two back-traced samples over a fixed cycle so the
      // photographed mask advects continuously instead of stretching forever.
      float cycle = 100.0;
      float phase = fract(uCloudFlowTime / cycle);
      vec2 wind = earthWind(vMapUv);
      vec2 uvA = vMapUv - wind * (phase * cycle);
      vec2 uvB = vMapUv - wind * ((phase - 1.0) * cycle);
      vec4 flowA = texture2D(map, vec2(fract(uvA.x), clamp(uvA.y, 0.001, 0.999)));
      vec4 flowB = texture2D(map, vec2(fract(uvB.x), clamp(uvB.y, 0.001, 0.999)));
      vec4 cloudDetail = mix(originalCloud, mix(flowA, flowB, smoothstep(0.25, 0.75, phase)), uWindDemoBlend);
      diffuseColor.rgb *= cloudDetail.rgb;
      diffuseColor.a *= smoothstep(0.03, 0.82, cloudDetail.a);
    `);
  };
  material.customProgramCacheKey = () => 'earth-photographic-cloud-flow-v5-wind-demo';
  if (moonShadow) applyMoonShadow(material, moonShadow);
  const cloud = new THREE.Mesh(geometry, material);
  cloud.scale.setScalar(1.008);
  cloud.renderOrder = 2;
  model.add(cloud);

  // Sparse illuminated tracers follow the same UV vector field. Their
  // highlights travel along fixed paths; no per-frame geometry upload is
  // needed. Kept near the surface and hidden outside Earth close-ups.
  const pointsPerPath = 28;
  const pathCount = 112;
  const positions = new Float32Array(pathCount * pointsPerPath * 3);
  const progress = new Float32Array(pathCount * pointsPerPath);
  const seeds = new Float32Array(pathCount * pointsPerPath);
  const uvs = new Float32Array(pathCount * pointsPerPath * 2);
  const speeds = new Float32Array(pathCount * pointsPerPath);
  for (let path = 0; path < pathCount; path++) {
    let u = (path * 0.61803398875 + 0.127) % 1;
    let v = 0.16 + ((path * 0.7548776662 + 0.337) % 1) * 0.68;
    for (let step = 0; step < pointsPerPath; step++) {
      const index = path * pointsPerPath + step;
      const latitude = (v - 0.5) * Math.PI;
      const longitude = u * Math.PI * 2;
      const radial = Math.cos(latitude) * 1.015;
      positions[index * 3] = -Math.cos(longitude) * radial;
      positions[index * 3 + 1] = Math.sin(latitude) * 1.015;
      positions[index * 3 + 2] = Math.sin(longitude) * radial;
      progress[index] = step / (pointsPerPath - 1);
      seeds[index] = (path * 0.38196601125) % 1;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
      const [east, north] = sampleEarthWind(u, v);
      speeds[index] = Math.min(1, Math.hypot(east, north) / 0.0007);
      u = (u + east * 11 + 1) % 1;
      v = THREE.MathUtils.clamp(v + north * 11, 0.07, 0.93);
    }
  }
  const tracerGeometry = new THREE.BufferGeometry();
  tracerGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  tracerGeometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  tracerGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  tracerGeometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
  tracerGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  const tracerTime = { value: 0 };
  const tracerLevel = { value: 0 };
  const tracerMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: tracerTime, uLevel: tracerLevel, uEarthMap: { value: earthTexture }, uOceanMask: { value: 0 } },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */`
      attribute float aProgress;
      attribute float aSeed;
      attribute vec2 aUv;
      attribute float aSpeed;
      uniform float uTime;
      uniform float uLevel;
      varying float vAlpha;
      varying vec2 vUv;
      varying float vSpeed;
      void main() {
        float phase = fract(aProgress * 2.0 - uTime * 0.11 + aSeed);
        vAlpha = pow(max(0.0, 1.0 - abs(phase - 0.5) * 7.0), 1.5) * uLevel;
        vUv = aUv;
        vSpeed = aSpeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 4.0;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      varying vec2 vUv;
      varying float vSpeed;
      uniform sampler2D uEarthMap;
      uniform float uOceanMask;
      void main() {
        vec3 surface = texture2D(uEarthMap, vUv).rgb;
        float water = step(surface.r * 1.12, surface.b) * step(surface.g * 0.97, surface.b);
        if (uOceanMask > 0.5 && water < 0.5) discard;
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float alpha = (1.0 - smoothstep(0.35, 1.0, radius)) * vAlpha;
        if (alpha < 0.01) discard;
        vec3 low = uOceanMask > 0.5 ? vec3(0.02, 0.24, 0.79) : vec3(0.03, 0.30, 0.92);
        vec3 high = uOceanMask > 0.5 ? vec3(0.04, 0.92, 0.65) : vec3(1.0, 0.54, 0.08);
        gl_FragColor = vec4(mix(low, high, smoothstep(0.05, 0.9, vSpeed)), alpha * 0.95);
        #include <colorspace_fragment>
      }
    `
  });
  const tracers = new THREE.Points(tracerGeometry, tracerMaterial);
  tracers.renderOrder = 3;
  tracers.frustumCulled = false;
  model.add(tracers);
  const windLines = flowTraceLines(positions, progress, seeds, uvs, speeds, pathCount, pointsPerPath, tracerMaterial.uniforms);
  model.add(windLines);
  const oceanPathCount = 120;
  const oceanPointsPerPath = 27;
  const oceanPositions = new Float32Array(oceanPathCount * oceanPointsPerPath * 3);
  const oceanProgress = new Float32Array(oceanPathCount * oceanPointsPerPath);
  const oceanSeeds = new Float32Array(oceanPathCount * oceanPointsPerPath);
  const oceanUvs = new Float32Array(oceanPathCount * oceanPointsPerPath * 2);
  const oceanSpeeds = new Float32Array(oceanPathCount * oceanPointsPerPath);
  for (let path = 0; path < oceanPathCount; path++) {
    let u = (path * 0.61803398875 + 0.392) % 1;
    let v = 0.17 + ((path * 0.7548776662 + 0.521) % 1) * 0.66;
    for (let step = 0; step < oceanPointsPerPath; step++) {
      const index = path * oceanPointsPerPath + step;
      const latitude = (v - 0.5) * Math.PI;
      const longitude = u * Math.PI * 2;
      const radial = Math.cos(latitude) * 1.018;
      oceanPositions[index * 3] = -Math.cos(longitude) * radial;
      oceanPositions[index * 3 + 1] = Math.sin(latitude) * 1.018;
      oceanPositions[index * 3 + 2] = Math.sin(longitude) * radial;
      oceanProgress[index] = step / (oceanPointsPerPath - 1);
      oceanSeeds[index] = (path * 0.38196601125) % 1;
      oceanUvs[index * 2] = u;
      oceanUvs[index * 2 + 1] = v;
      const [east, north] = sampleOceanCurrent(u, v);
      oceanSpeeds[index] = Math.min(1, Math.hypot(east, north) / 0.0009);
      u = (u + east * 11 + 1) % 1;
      v = THREE.MathUtils.clamp(v + north * 11, 0.07, 0.93);
    }
  }
  const oceanGeometry = new THREE.BufferGeometry();
  oceanGeometry.setAttribute('position', new THREE.BufferAttribute(oceanPositions, 3));
  oceanGeometry.setAttribute('aProgress', new THREE.BufferAttribute(oceanProgress, 1));
  oceanGeometry.setAttribute('aSeed', new THREE.BufferAttribute(oceanSeeds, 1));
  oceanGeometry.setAttribute('aUv', new THREE.BufferAttribute(oceanUvs, 2));
  oceanGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(oceanSpeeds, 1));
  const oceanMaterial = tracerMaterial.clone();
  oceanMaterial.uniforms.uOceanMask.value = 1;
  const oceanTracers = new THREE.Points(oceanGeometry, oceanMaterial);
  oceanTracers.renderOrder = 3;
  oceanTracers.frustumCulled = false;
  model.add(oceanTracers);
  const oceanLines = flowTraceLines(oceanPositions, oceanProgress, oceanSeeds, oceanUvs, oceanSpeeds, oceanPathCount, oceanPointsPerPath, oceanMaterial.uniforms);
  model.add(oceanLines);
  // In analysis layers the unlit hemisphere must remain readable, as on a
  // weather map. The night-side-only tint does not replace astronomical
  // lighting in the normal/no-overlay view; city lights render above it.
  const mapLight = {
    uEarthMap: { value: earthTexture },
    uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
    uLevel: { value: 0 }
  };
  const analysisMaterial = new THREE.ShaderMaterial({
    uniforms: mapLight,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vViewNormal;
      void main() {
        vUv = uv;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uEarthMap;
      uniform vec3 uSunDirection;
      uniform float uLevel;
      varying vec2 vUv;
      varying vec3 vViewNormal;
      void main() {
        float sunlight = dot(normalize(vViewNormal), normalize(mat3(viewMatrix) * uSunDirection));
        float night = 1.0 - smoothstep(-0.18, 0.18, sunlight);
        vec3 albedo = texture2D(uEarthMap, vUv).rgb;
        gl_FragColor = vec4(albedo, uLevel * night);
        #include <colorspace_fragment>
      }
    `
  });
  const analysisMap = new THREE.Mesh(geometry, analysisMaterial);
  analysisMap.scale.setScalar(1.001);
  analysisMap.renderOrder = 0.5;
  model.add(analysisMap);
  const demoFader = createFader(0.7);
  const oceanFader = createFader(0.7);
  const cloudFader = createFader(0.7);
  const analysisFader = createFader(0.7);
  let overlayOpacity = 0.8;
  let animationPlaying = true;
  let animationSeconds = 0;
  let lastFrameSeconds: number | null = null;
  return {
    continuous: true,
    update(seconds, angle, _height, sunlight, _cameraRadiusDistance) {
      if (lastFrameSeconds !== null && animationPlaying) {
        animationSeconds += THREE.MathUtils.clamp(seconds - lastFrameSeconds, 0, 0.1);
      }
      lastFrameSeconds = seconds;
      flowTime.value = animationSeconds;
      cloud.rotation.y = angle;
      tracers.rotation.y = angle;
      windLines.rotation.y = angle;
      oceanTracers.rotation.y = angle;
      oceanLines.rotation.y = angle;
      analysisMap.rotation.y = angle;
      mapLight.uSunDirection.value.copy(sunlight);
      const demoLevel = demoFader.advance(seconds);
      const oceanLevel = oceanFader.advance(seconds);
      const cloudLevel = cloudFader.advance(seconds);
      mapLight.uLevel.value = analysisFader.advance(seconds) * overlayOpacity * 0.46;
      analysisMap.visible = cloud.visible && mapLight.uLevel.value > 0.01;
      windBlend.value = demoLevel;
      material.opacity = 0.72 + cloudLevel * 0.22 * overlayOpacity - oceanLevel * 0.12;
      tracerTime.value = animationSeconds;
      tracerLevel.value = demoLevel * overlayOpacity;
      tracers.visible = cloud.visible && tracerLevel.value > 0.01;
      windLines.visible = tracers.visible;
      oceanMaterial.uniforms.uTime.value = animationSeconds;
      oceanMaterial.uniforms.uLevel.value = oceanLevel * overlayOpacity;
      oceanTracers.visible = cloud.visible && oceanMaterial.uniforms.uLevel.value > 0.01;
      oceanLines.visible = oceanTracers.visible;
    },
    setVisible(visible) { cloud.visible = visible; },
    setLayer(layer, immediate = false) {
      const select = immediate ? 'snap' : 'set';
      demoFader[select](layer === 2);
      oceanFader[select](layer === 3);
      cloudFader[select](layer === 1);
      analysisFader[select](layer !== 0);
    },
    setOverlayOpacity(value) { overlayOpacity = THREE.MathUtils.clamp(value, 0, 1); },
    setAnimationPlaying(playing) { animationPlaying = playing; }
  };
}

export function earthNightLights(surface: THREE.Group, geometry: THREE.BufferGeometry, lights: THREE.Texture): SurfaceEffect {
  lights.wrapS = THREE.RepeatWrapping;
  const uniforms = {
    uLights: { value: lights },
    uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
    uLevel: { value: 0 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      varying vec2 vNightUv;
      varying vec3 vNightViewNormal;
      varying vec3 vNightViewPosition;
      void main() {
        vNightUv = uv;
        vNightViewNormal = normalize(normalMatrix * normal);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNightViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uLights;
      uniform vec3 uSunDirection;
      uniform float uLevel;
      varying vec2 vNightUv;
      varying vec3 vNightViewNormal;
      varying vec3 vNightViewPosition;
      void main() {
        vec3 normal = normalize(vNightViewNormal);
        vec3 viewDirection = normalize(-vNightViewPosition);
        float solarAltitude = dot(normal, normalize(mat3(viewMatrix) * uSunDirection));
        float night = smoothstep(0.08, -0.18, solarAltitude);
        float visibleHemisphere = smoothstep(-0.04, 0.18, dot(normal, viewDirection));
        float observedRadiance = texture2D(uLights, vNightUv).r;
        // Black Marble is a radiance map rather than a display-ready colour
        // texture. Lift the dim observed settlements while keeping the black
        // ocean floor at zero; this preserves the real spatial distribution.
        float settlement = smoothstep(0.025, 0.34, observedRadiance);
        float core = smoothstep(0.24, 0.76, observedRadiance);
        vec3 colour = mix(vec3(1.0, 0.50, 0.16), vec3(1.0, 0.82, 0.48), core);
        float alpha = (settlement * 0.98 + core * 0.62) * night * visibleHemisphere * uLevel;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(colour, alpha);
        #include <colorspace_fragment>
      }
    `
  });
  const fader = createFader();
  const cityLights = new THREE.Mesh(geometry, material);
  cityLights.scale.setScalar(1.0025);
  cityLights.renderOrder = 1;
  surface.add(cityLights);
  return {
    update(seconds, _angle, _height, sunlight) {
      uniforms.uSunDirection.value.copy(sunlight).normalize();
      uniforms.uLevel.value = fader.advance(seconds);
      cityLights.visible = uniforms.uLevel.value > 0.001;
    },
    setVisible(visible) { fader.set(visible); }
  };
}

export function venusClouds(model: THREE.Group, geometry: THREE.BufferGeometry): SurfaceEffect {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffd19a,
    transparent: true,
    opacity: 0.94,
    roughness: 1,
    depthWrite: false
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uVenusTime = time;
    shader.vertexShader = 'varying vec3 vVenusPoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvVenusPoint = normalize(position);');
    shader.fragmentShader = `varying vec3 vVenusPoint;\nuniform float uVenusTime;\n${NOISE}\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`
      #include <map_fragment>
      vec3 cloudPoint = vVenusPoint;
      float venusLatitude = cloudPoint.y;
      float superRotation = uVenusTime * (0.042 + 0.014 * sin(venusLatitude * 9.0));
      cloudPoint.xz = mat2(cos(superRotation), -sin(superRotation), sin(superRotation), cos(superRotation)) * cloudPoint.xz;
      vec3 venusFlow = vec3(uVenusTime * 0.041, -uVenusTime * 0.027, uVenusTime * 0.017);
      float broadCloud = fbm(cloudPoint * 7.0 + venusFlow);
      float fineCloud = fbm(cloudPoint.yzx * 24.0 - venusFlow * 1.6 + broadCloud * 2.0);
      float streaks = 0.5 + 0.5 * sin(venusLatitude * 58.0 + broadCloud * 8.0 - uVenusTime * 0.12);
      vec3 pale = vec3(1.0, 0.74, 0.43);
      vec3 gold = vec3(0.78, 0.43, 0.19);
      diffuseColor.rgb = mix(gold, pale, smoothstep(0.2, 0.86, broadCloud * 0.72 + fineCloud * 0.2 + streaks * 0.16));
    `);
  };
  material.customProgramCacheKey = () => 'venus-superrotating-clouds-v1';
  const clouds = new THREE.Mesh(geometry, material);
  clouds.scale.setScalar(1.009);
  clouds.renderOrder = 2;
  model.add(clouds);
  const fader = createFader();
  return {
    update(seconds, angle) {
      time.value = seconds;
      clouds.rotation.y = angle - seconds * 0.0055;
      const level = fader.advance(seconds);
      material.opacity = 0.94 * level;
      clouds.visible = level > 0.001;
    },
    setVisible(visible) { fader.set(visible); }
  };
}

export function planetAtmosphere(model: THREE.Group, geometry: THREE.BufferGeometry, id: BodyId): SurfaceEffect {
  const settings: Partial<Record<BodyId, { color: number; scale: number; opacity: number; power: number }>> = {
    venus: { color: 0xffb762, scale: 1.032, opacity: 0.2, power: 2.1 },
    earth: { color: 0x4aa8ff, scale: 1.018, opacity: 0.48, power: 3.8 },
    mars: { color: 0xe07245, scale: 1.018, opacity: 0.1, power: 2.6 },
    jupiter: { color: 0xe9c59e, scale: 1.018, opacity: 0.11, power: 2.5 },
    saturn: { color: 0xf0d7a2, scale: 1.018, opacity: 0.1, power: 2.5 },
    uranus: { color: 0x85f1ff, scale: 1.024, opacity: 0.17, power: 2.25 },
    neptune: { color: 0x4f7fff, scale: 1.023, opacity: 0.19, power: 2.25 }
  };
  const setting = settings[id];
  if (!setting) return { update() {}, setVisible() {} };
  const uniforms = {
    uColour: { value: new THREE.Color(setting.color) },
    uOpacity: { value: setting.opacity },
    uPower: { value: setting.power },
    uSunDirection: { value: new THREE.Vector3(1, 0, 0) }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    vertexShader: /* glsl */`
      varying vec3 vAtmosphereViewNormal;
      varying vec3 vAtmosphereViewPosition;
      void main() {
        // Let three.js combine the camera and model matrices on the CPU (in
        // double precision). The atmosphere is only ~4e-6 scene units thick
        // beside an Earth orbit anchor tens of units from the origin: doing
        // modelMatrix then viewMatrix in the GPU loses the shell to rounding.
        vAtmosphereViewNormal = normalize(normalMatrix * normal);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vAtmosphereViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColour;
      uniform vec3 uSunDirection;
      uniform float uOpacity, uPower;
      varying vec3 vAtmosphereViewNormal;
      varying vec3 vAtmosphereViewPosition;
      void main() {
        vec3 normal = normalize(vAtmosphereViewNormal);
        vec3 viewDirection = normalize(-vAtmosphereViewPosition);
        float rim = pow(clamp(1.0 - max(dot(normal, viewDirection), 0.0), 0.0, 1.0), uPower);
        float sunAmount = dot(normal, normalize(mat3(viewMatrix) * uSunDirection));
        float dayScatter = smoothstep(-0.28, 0.38, sunAmount);
        float terminator = exp(-pow((sunAmount + 0.06) * 5.4, 2.0));
        vec3 sunsetColour = vec3(1.0, 0.30, 0.055);
        vec3 scatteringColour = mix(uColour, sunsetColour, clamp(terminator * 0.78, 0.0, 0.78));
        float alpha = rim * uOpacity * (0.035 + dayScatter * 0.9 + terminator * 0.34);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(scatteringColour, alpha);
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false
  });
  const atmosphere = new THREE.Mesh(geometry, material);
  atmosphere.scale.setScalar(setting.scale);
  atmosphere.renderOrder = 3;
  atmosphere.visible = false;
  model.add(atmosphere);
  let requestedVisible = false;
  return {
    continuous: true,
    update(_seconds, _angle, _height, sunlight, _cameraRadiusDistance, apparentRadiusPixels = Infinity) {
      uniforms.uSunDirection.value.copy(sunlight).normalize();
      // An additive shell shrunk to a few pixels can collapse into a bright
      // point. Fade Earth by projected disc size, not navigation layer, so
      // zooming in and out remains continuous even across view transitions.
      const distanceFade = id === 'earth'
        ? THREE.MathUtils.smoothstep(apparentRadiusPixels, 12, 70)
        : 1;
      uniforms.uOpacity.value = setting.opacity * distanceFade;
      atmosphere.visible = requestedVisible && distanceFade > 0.001;
    },
    setVisible(visible) { requestedVisible = visible; }
  };
}

export function ringParticles(model: THREE.Group, ring: THREE.Mesh): SurfaceEffect {
  const count = 6000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const orbital = new Float32Array(count * 3);
  const size = new Float32Array(count);
  // Fixed seed: identical reloads create identical particle distributions.
  let seed = 917;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < count; index++) {
    const radius = 1.47 + random() * 0.76;
    const angle = random() * Math.PI * 2;
    positions[index * 3] = radius * Math.cos(angle);
    positions[index * 3 + 1] = radius * Math.sin(angle);
    positions[index * 3 + 2] = (random() - 0.5) * 0.008;
    orbital[index * 3] = radius;
    orbital[index * 3 + 1] = angle;
    orbital[index * 3 + 2] = 0.14 / Math.pow(radius, 1.5);
    size[index] = 0.002 + random() * 0.005;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOrbit', new THREE.BufferAttribute(orbital, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.3);
  const uniforms = { uTime: { value: 0 }, uHeight: { value: 900 }, uLight: { value: new THREE.Vector3(1, 0, 0) }, uLevel: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aOrbit;
      attribute float aSize;
      uniform float uTime, uHeight;
      uniform vec3 uLight;
      varying float vLight;
      void main() {
        float angle = aOrbit.y + uTime * aOrbit.z;
        vec3 point = vec3(cos(angle) * aOrbit.x, sin(angle) * aOrbit.x, position.z);
        vec4 mvPosition = modelViewMatrix * vec4(point, 1.0);
        float behindPlanet = step(dot(point, uLight), 0.0);
        float inShadow = 1.0 - smoothstep(0.95, 1.04, length(cross(point, uLight)));
        vLight = 1.0 - behindPlanet * inShadow * 0.96;
        gl_PointSize = clamp(aSize * length(modelMatrix[0].xyz) * uHeight / max(0.000001, -mvPosition.z), 1.0, 3.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uLevel;
      varying float vLight;
      void main() {
        float radius = length(gl_PointCoord - 0.5);
        float alpha = (1.0 - smoothstep(0.1, 0.5, radius)) * 0.62 * vLight * uLevel;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(0.91, 0.85, 0.72, alpha);
        #include <colorspace_fragment>
      }
    `
  });
  const fader = createFader();
  const particles = new THREE.Points(geometry, material);
  particles.rotation.copy(ring.rotation);
  particles.renderOrder = 3;
  model.add(particles);
  const inverseTilt = particles.quaternion.clone().invert();
  return {
    update(time, _angle, height, sunlight) {
      uniforms.uTime.value = time;
      uniforms.uHeight.value = height;
      uniforms.uLight.value.copy(sunlight).normalize().applyQuaternion(inverseTilt);
      uniforms.uLevel.value = fader.advance(time);
      particles.visible = uniforms.uLevel.value > 0.001;
    },
    setVisible(visible) { fader.set(visible); }
  };
}

// Lunar shadow on a globe. For each fragment the shader measures how much of
// the solar disc the Moon hides as seen from that surface point (the same
// disc-overlap formula as eclipse-sky.discCoverage), so the dark umbra, the
// wide soft penumbra and an annular eclipse's antumbra all fall out of the
// real Sun-Moon-Earth geometry. Positions are in Earth radii, scene axes.
export interface MoonShadowUniforms {
  readonly uMoonShadowMoon: { value: THREE.Vector3 };
  readonly uMoonShadowSun: { value: THREE.Vector3 };
  readonly uMoonShadowSunRadius: { value: number };
  readonly uMoonShadowMoonRadius: { value: number };
}

export function createMoonShadowUniforms(moonRadiusInEarthRadii: number): MoonShadowUniforms {
  return {
    uMoonShadowMoon: { value: new THREE.Vector3(60, 0, 0) },
    uMoonShadowSun: { value: new THREE.Vector3(-1, 0, 0) },
    uMoonShadowSunRadius: { value: 0.00465 },
    uMoonShadowMoonRadius: { value: moonRadiusInEarthRadii },
  };
}

const MOON_SHADOW_GLSL = /* glsl */`
uniform vec3 uMoonShadowMoon;
uniform vec3 uMoonShadowSun;
uniform float uMoonShadowSunRadius;
uniform float uMoonShadowMoonRadius;
varying vec3 vMoonShadowPoint;
float moonShadowCoverage(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  if (d <= abs(r1 - r2)) return min(1.0, pow(min(r1, r2) / r1, 2.0));
  float a1 = acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
  float a2 = acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
  float kite = 0.5 * sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return min(1.0, (r1 * r1 * a1 + r2 * r2 * a2 - kite) / (3.14159265 * r1 * r1));
}
float moonShadowLight() {
  vec3 point = normalize(vMoonShadowPoint);
  vec3 toMoon = uMoonShadowMoon - point;
  float moonDistance = length(toMoon);
  vec3 moonDirection = toMoon / moonDistance;
  float cosine = dot(moonDirection, uMoonShadowSun);
  if (cosine <= 0.0) return 1.0;
  float separation = atan(length(cross(moonDirection, uMoonShadowSun)), cosine);
  float moonRadius = asin(clamp(uMoonShadowMoonRadius / moonDistance, 0.0, 1.0));
  return 1.0 - moonShadowCoverage(uMoonShadowSunRadius, moonRadius, separation);
}
`;

/** Darkens direct sunlight on a MeshStandardMaterial inside the Moon's shadow. */
export function applyMoonShadow(material: THREE.MeshStandardMaterial, uniforms: MoonShadowUniforms): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMoonShadowPoint;')
      // World orientation, object centre at the origin; mesh scale drops out
      // in the normalisation, leaving a point on the unit (Earth-radius) sphere.
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMoonShadowPoint = mat3(modelMatrix) * position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MOON_SHADOW_GLSL}`)
      .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
        float moonShadowLit = moonShadowLight();
        reflectedLight.directDiffuse *= moonShadowLit;
        reflectedLight.directSpecular *= moonShadowLit;`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}-moon-shadow-v1`;
  material.needsUpdate = true;
}
