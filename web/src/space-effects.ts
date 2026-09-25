import * as THREE from 'three';

export interface StarBackdrop {
  readonly object: THREE.Points;
  update(time: number, camera: THREE.PerspectiveCamera, pixelRatio: number): void;
}

export interface SolarGlow {
  readonly object: THREE.Points;
  update(time: number, pointSize: number, viewPhase: number, visible: boolean, pixelRatio: number): void;
}

export interface AsteroidBelt {
  readonly object: THREE.Group;
  update(simulationDays: number, visible: boolean, pixelRatio: number, opacity: number): void;
}

export interface KuiperBelt {
  readonly object: THREE.Group;
  setOuterPlanetRadius(radius: number): void;
  // opacity 0..1 fades the distant markers; rock meshes hide below 0.02.
  update(simulationDays: number, visible: boolean, pixelRatio: number, opacity?: number): void;
}

export interface OortCloud {
  readonly object: THREE.Group;
  setEnhancedMode(enhanced: boolean, outerPlanetRadius: number): void;
  setVisibility(inner: boolean, outer: boolean): void;
  update(pixelRatio: number, opacity?: number): void;
}

function seededRandom(seedValue: number): () => number {
  let seed = seedValue >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// The Oort Cloud has not been directly imaged. These are separate, deliberately
// sparse markers for the hypothesised flatter inner (Hills) region and the
// roughly isotropic outer region, not a glowing gas nebula or a hard boundary.
function createOortRegion(count: number, seed: number, outer: boolean): {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pixelRatio: { value: number };
  opacity: { value: number };
} {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);
  const palette = outer
    ? [new THREE.Color(0x87909b), new THREE.Color(0xb1b7ba), new THREE.Color(0x988e85)]
    : [new THREE.Color(0x9ca7aa), new THREE.Color(0xb5afa2), new THREE.Color(0x818e96)];

  for (let index = 0; index < count; index++) {
    const angle = random() * Math.PI * 2;
    const radius = outer ? 385 + random() * 165 : 280 + random() * 76;
    const latitude = outer ? random() * 2 - 1 : (random() + random() - 1) * 0.31;
    const planar = Math.sqrt(1 - latitude * latitude);
    positions[index * 3] = Math.cos(angle) * planar * radius;
    positions[index * 3 + 1] = latitude * radius;
    positions[index * 3 + 2] = Math.sin(angle) * planar * radius;
    const colour = palette[Math.floor(random() * palette.length)];
    colours[index * 3] = colour.r;
    colours[index * 3 + 1] = colour.g;
    colours[index * 3 + 2] = colour.b;
    // Deliberately separated, individually visible icy-body markers. The
    // prior sub-pixel, near-transparent dots vanished in the overview even
    // with both region switches enabled; avoid a continuous luminous shell.
    sizes[index] = 1.2 + Math.pow(random(), 4) * 1.25;
    opacities[index] = 0.19 + Math.pow(random(), 2.5) * (outer ? 0.27 : 0.32);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
  const pixelRatio = { value: 1 };
  const opacity = { value: 1 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: pixelRatio, uOpacity: opacity },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      attribute vec3 aColour;
      attribute float aSize, aOpacity;
      uniform float uPixelRatio;
      varying vec3 vColour;
      varying float vOpacity;
      void main() {
        vColour = aColour;
        vOpacity = aOpacity;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColour;
      varying float vOpacity;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.25, 1.0, radius)) * vOpacity * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColour, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -20;
  return { points, pixelRatio, opacity };
}

export function createOortCloud(innerCount = 2400, outerCount = 3200): OortCloud {
  const inner = createOortRegion(innerCount, 0x00a07c10, false);
  const outer = createOortRegion(outerCount, 0x00a07c11, true);
  inner.points.name = 'inner-oort-cloud';
  outer.points.name = 'outer-oort-cloud';
  const cloud = new THREE.Group();
  cloud.add(inner.points, outer.points);
  return {
    object: cloud,
    setEnhancedMode(enhanced, outerPlanetRadius) {
      cloud.scale.setScalar(enhanced ? outerPlanetRadius / 180 : 1);
    },
    setVisibility(showInner, showOuter) {
      inner.points.visible = showInner;
      outer.points.visible = showOuter;
    },
    update(pixelRatio, opacity = 1) {
      inner.pixelRatio.value = pixelRatio;
      outer.pixelRatio.value = pixelRatio;
      inner.opacity.value = opacity;
      outer.opacity.value = opacity;
      cloud.visible = opacity > 0.002;
    },
  };
}

// A thick, low-inclination disk beyond Neptune. The actual radii are 30–50 AU;
// its screen-space distances and tiny-body sizes are compressed/boosted for
// inspection just like the rest of the overview, never used by the ephemeris.
export function createKuiperBelt(count = 3600): KuiperBelt {
  const random = seededRandom(0x6b751ce1);
  const phases = new Float32Array(count);
  const radii = new Float32Array(count);
  const inclinations = new Float32Array(count);
  const nodes = new Float32Array(count);
  const eccentricities = new Float32Array(count);
  const angularSpeeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const variantOf = new Uint8Array(count);
  const variantIndex = new Uint16Array(count);
  const variantCounts = [0, 0];
  const markerPositions = new Float32Array(count * 3);
  const markerColours = new Float32Array(count * 3);
  const markerSizes = new Float32Array(count);
  const colours: THREE.Color[] = [];
  const palette = [new THREE.Color(0x77685e), new THREE.Color(0x8f7770), new THREE.Color(0x78858a), new THREE.Color(0x9a9992)];

  for (let index = 0; index < count; index++) {
    const au = random() < 0.78 ? 36 + random() * 13 : 30 + random() * 20;
    radii[index] = 180 * (1 + 0.32 * (au - 30) / 20);
    phases[index] = random() * Math.PI * 2;
    nodes[index] = random() * Math.PI * 2;
    const cold = random() < 0.68;
    inclinations[index] = THREE.MathUtils.degToRad((cold ? 1 + random() * 5 : 6 + random() * 16) * (random() < 0.5 ? -1 : 1));
    eccentricities[index] = random() * (cold ? 0.045 : 0.13);
    angularSpeeds[index] = 2 * Math.PI / (365.256 * Math.pow(au, 1.5));
    sizes[index] = index < 18 ? 0.11 + random() * 0.09 : 0.025 + Math.pow(random(), 5) * 0.085;
    const variant = random() < 0.58 ? 0 : 1;
    variantOf[index] = variant;
    variantIndex[index] = variantCounts[variant]++;
    const colour = palette[Math.floor(random() * palette.length)].clone().multiplyScalar(0.75 + random() * 0.35);
    colours.push(colour);
    markerColours[index * 3] = colour.r;
    markerColours[index * 3 + 1] = colour.g;
    markerColours[index * 3 + 2] = colour.b;
    markerSizes[index] = index < 18 ? 1.7 : 1.0 + random() * 0.55;
  }

  const loader = new THREE.TextureLoader();
  const textures = [loader.load('/textures/asteroid-carbonaceous.jpg'), loader.load('/textures/asteroid-stony.jpg')];
  for (const texture of textures) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  const meshes = textures.map((texture, variant) => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const vertices = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < vertices.count; index++) {
      const x = vertices.getX(index), y = vertices.getY(index), z = vertices.getZ(index);
      const roughness = 0.84 + 0.11 * Math.sin(x * 5.3 + z * 4.7 + variant)
        + 0.06 * Math.sin(y * 13.1 - x * 8.7);
      vertices.setXYZ(index, x * roughness, y * roughness, z * roughness);
    }
    vertices.needsUpdate = true;
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      map: texture, roughness: 1, metalness: 0, flatShading: true,
      emissive: 0x0a0b0c, emissiveIntensity: 0.15,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, variantCounts[variant]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  });
  for (let index = 0; index < count; index++) meshes[variantOf[index]].setColorAt(variantIndex[index], colours[index]);
  for (const mesh of meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const markerGeometry = new THREE.BufferGeometry();
  markerGeometry.setAttribute('position', new THREE.BufferAttribute(markerPositions, 3));
  markerGeometry.setAttribute('aColour', new THREE.BufferAttribute(markerColours, 3));
  markerGeometry.setAttribute('aSize', new THREE.BufferAttribute(markerSizes, 1));
  const pixelRatio = { value: 1 };
  const markerOpacity = { value: 1 };
  const markers = new THREE.Points(markerGeometry, new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: pixelRatio, uOpacity: markerOpacity }, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */`
      attribute vec3 aColour;
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColour;
      void main() {
        vColour = aColour;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColour;
      void main() {
        float alpha = (1.0 - smoothstep(0.35, 1.0, length(gl_PointCoord - 0.5) * 2.0)) * 0.68 * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColour, alpha);
        #include <colorspace_fragment>
      }
    `,
  }));
  markers.frustumCulled = false;
  markers.renderOrder = 1;
  const belt = new THREE.Group();
  belt.add(...meshes, markers);
  const instance = new THREE.Object3D();
  let lastDays = Number.NaN;
  const updatePositions = (days: number) => {
    for (let index = 0; index < count; index++) {
      const angle = phases[index] + days * angularSpeeds[index];
      const radius = radii[index] * (1 - eccentricities[index] ** 2)
        / (1 + eccentricities[index] * Math.cos(angle - nodes[index]));
      instance.position.set(Math.cos(angle) * radius, Math.sin(angle - nodes[index]) * radius * Math.sin(inclinations[index]), Math.sin(angle) * radius);
      instance.rotation.set(nodes[index], angle * 0.37, phases[index]);
      instance.scale.set(sizes[index] * 1.15, sizes[index] * 0.8, sizes[index]);
      instance.updateMatrix();
      meshes[variantOf[index]].setMatrixAt(variantIndex[index], instance.matrix);
      markerPositions[index * 3] = instance.position.x;
      markerPositions[index * 3 + 1] = instance.position.y;
      markerPositions[index * 3 + 2] = instance.position.z;
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    (markerGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    lastDays = days;
  };
  updatePositions(0);
  return {
    object: belt,
    setOuterPlanetRadius(radius) { belt.scale.setScalar(radius / 180); },
    update(days, visible, ratio, opacity = 1) {
      belt.visible = visible && opacity > 0.002;
      pixelRatio.value = ratio;
      markerOpacity.value = opacity;
      for (const mesh of meshes) mesh.visible = opacity > 0.02;
      if (visible && Math.abs(days - lastDays) >= 0.02) updatePositions(days);
    },
  };
}

export function createStarBackdrop(count = 5600): StarBackdrop {
  const random = seededRandom(0x51a7f13d);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const palette = [
    new THREE.Color(0xaecbff),
    new THREE.Color(0xffffff),
    new THREE.Color(0xffe2ba),
    new THREE.Color(0xdbe7ff)
  ];

  for (let index = 0; index < count; index++) {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(1 - y * y);
    positions[index * 3] = Math.cos(angle) * radial;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = Math.sin(angle) * radial;

    const colour = palette[Math.min(palette.length - 1, Math.floor(random() * palette.length))];
    const magnitude = 0.62 + Math.pow(random(), 5) * 0.62;
    colours[index * 3] = colour.r * magnitude;
    colours[index * 3 + 1] = colour.g * magnitude;
    colours[index * 3 + 2] = colour.b * magnitude;
    sizes[index] = random() > 0.965 ? 2.4 + random() * 1.6 : 0.75 + random() * 1.15;
    phases[index] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      attribute vec3 aColour;
      attribute float aSize, aPhase;
      uniform float uTime, uPixelRatio;
      varying vec3 vColour;
      varying float vAlpha;
      void main() {
        float twinkle = 0.88 + 0.12 * sin(uTime * (0.45 + aPhase * 0.045) + aPhase);
        vColour = aColour * twinkle;
        vAlpha = 0.72 + 0.28 * twinkle;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColour;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.05, 0.34, radius);
        float halo = 1.0 - smoothstep(0.18, 1.0, radius);
        float alpha = (core * 0.64 + halo * 0.46) * vAlpha;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(vColour, alpha);
        #include <colorspace_fragment>
      }
    `
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  stars.renderOrder = -100;

  return {
    object: stars,
    update(time, camera, pixelRatio) {
      uniforms.uTime.value = time;
      uniforms.uPixelRatio.value = pixelRatio;
      stars.position.copy(camera.position);
      stars.scale.setScalar(camera.far * 0.72);
    }
  };
}

export function createSolarGlow(): SolarGlow {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const uniforms = {
    uTime: { value: 0 },
    uPointSize: { value: 72 },
    uViewPhase: { value: 0 },
    uPixelRatio: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      uniform float uPointSize, uPixelRatio;
      void main() {
        gl_PointSize = uPointSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime, uViewPhase;
      void main() {
        vec2 point = (gl_PointCoord - 0.5) * 2.0;
        float radius = length(point);
        float angle = atan(point.y, point.x) + uViewPhase;
        float turbulence = 0.5 + 0.5 * sin(angle * 11.0 + sin(angle * 5.0 - uTime * 0.08) * 0.7 + uTime * 0.035);
        float fineRays = pow(0.5 + 0.5 * sin(angle * 29.0 + uTime * 0.025), 8.0);
        float corona = exp(-radius * 4.25) * (0.82 + turbulence * 0.18);
        float opticalBloom = exp(-radius * 2.05) * smoothstep(1.0, 0.08, radius);
        float rayField = fineRays * exp(-radius * 2.4) * smoothstep(0.98, 0.16, radius);
        float alpha = corona * 0.72 + opticalBloom * 0.16 + rayField * 0.06;
        if (alpha < 0.008 || radius > 1.0) discard;
        vec3 colour = mix(vec3(1.0, 0.42, 0.07), vec3(1.0, 0.96, 0.82), max(0.0, 1.0 - radius));
        gl_FragColor = vec4(colour, alpha);
        #include <colorspace_fragment>
      }
    `
  });
  const glow = new THREE.Points(geometry, material);
  glow.frustumCulled = false;
  glow.renderOrder = 4;
  return {
    object: glow,
    update(time, pointSize, viewPhase, visible, pixelRatio) {
      uniforms.uTime.value = time;
      uniforms.uPointSize.value = pointSize;
      uniforms.uViewPhase.value = viewPhase;
      uniforms.uPixelRatio.value = pixelRatio;
      glow.visible = visible;
    }
  };
}

export function createAsteroidBelt(
  radiusForAu: (astronomicalUnits: number) => number,
  count = 3200,
): AsteroidBelt {
  const random = seededRandom(0xa57e201d);
  const radii = new Float32Array(count);
  const phases = new Float32Array(count);
  const verticalAmplitudes = new Float32Array(count);
  const verticalPhases = new Float32Array(count);
  const eccentricities = new Float32Array(count);
  const periapses = new Float32Array(count);
  const angularSpeeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const scaleX = new Float32Array(count);
  const scaleY = new Float32Array(count);
  const scaleZ = new Float32Array(count);
  const rotationX = new Float32Array(count);
  const rotationY = new Float32Array(count);
  const rotationZ = new Float32Array(count);
  const spinSpeeds = new Float32Array(count);
  const asteroidVariants = new Uint8Array(count);
  const asteroidVariantIndices = new Uint16Array(count);
  const variantCounts = [0, 0, 0, 0];
  const markerPositions = new Float32Array(count * 3);
  const markerSizes = new Float32Array(count);
  const markerColours = new Float32Array(count * 3);
  const colours: THREE.Color[] = [];
  const carbonTint = new THREE.Color(0xc7c7c3);
  const stonyTint = new THREE.Color(0xe1d4c4);

  for (let index = 0; index < count; index++) {
    let au = 2.06;
    // Broad, overlapping families keep the belt granular. Rejection around
    // the 3:1 and 5:2 Jovian resonances leaves restrained Kirkwood gaps.
    for (let attempt = 0; attempt < 16; attempt++) {
      const family = random();
      const centre = family < 0.34 ? 2.31 : family < 0.74 ? 2.72 : 3.08;
      au = THREE.MathUtils.clamp(centre + (random() + random() - 1) * 0.34, 2.06, 3.27);
      const gap25 = Math.exp(-Math.pow((au - 2.50) / 0.026, 2));
      const gap282 = Math.exp(-Math.pow((au - 2.82) / 0.032, 2));
      if (random() > Math.max(gap25 * 0.86, gap282 * 0.68)) break;
    }
    const inclination = Math.pow(random(), 2.1) * THREE.MathUtils.degToRad(16) * (random() < 0.5 ? -1 : 1);
    radii[index] = radiusForAu(au);
    phases[index] = random() * Math.PI * 2;
    verticalAmplitudes[index] = Math.tan(inclination) * radii[index];
    verticalPhases[index] = random() * Math.PI * 2;
    eccentricities[index] = 0.01 + Math.pow(random(), 1.8) * 0.19;
    periapses[index] = random() * Math.PI * 2;
    angularSpeeds[index] = Math.PI * 2 / (365.256 * Math.pow(au, 1.5));
    // Individual bodies should be almost unresolved in a solar-system view.
    // A modest visual floor keeps meshes inspectable only after approaching
    // the belt, without turning it into a ring of planet-sized rocks.
    sizes[index] = index < 12 ? 0.18 + random() * 0.16 : 0.035 + Math.pow(random(), 4.8) * 0.11;
    scaleX[index] = 0.72 + random() * 0.66;
    scaleY[index] = 0.58 + random() * 0.78;
    scaleZ[index] = 0.7 + random() * 0.68;
    rotationX[index] = random() * Math.PI * 2;
    rotationY[index] = random() * Math.PI * 2;
    rotationZ[index] = random() * Math.PI * 2;
    spinSpeeds[index] = (0.8 + random() * 6.2) * (random() < 0.5 ? -1 : 1);
    const rockyType = random() < 0.7 ? 0 : 1;
    const variant = rockyType * 2 + (random() < 0.5 ? 0 : 1);
    asteroidVariants[index] = variant;
    asteroidVariantIndices[index] = variantCounts[variant]++;
    const variation = 0.82 + random() * 0.29;
    const variedColour = (rockyType === 0 ? carbonTint : stonyTint).clone().multiplyScalar(variation);
    colours.push(variedColour);
    markerColours[index * 3] = variedColour.r;
    markerColours[index * 3 + 1] = variedColour.g;
    markerColours[index * 3 + 2] = variedColour.b;
    // Distant asteroids are physically smaller than a screen pixel. This
    // marker is an unresolved brightness sample, not a replacement model;
    // the irregular mesh remains present at the same position for close-up.
    markerSizes[index] = index < 12 ? 1.3 + random() * 0.45 : 0.58 + random() * 0.48;
  }

  const textureLoader = new THREE.TextureLoader();
  const rockyTextures = [
    textureLoader.load('/textures/asteroid-carbonaceous.jpg'),
    textureLoader.load('/textures/asteroid-stony.jpg'),
  ];
  for (const texture of rockyTextures) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
  }

  const geometries = Array.from({ length: 4 }, (_, variant) => {
    // Four shared silhouettes keep the 3,200 bodies cheap to draw while
    // avoiding the repeated smooth icosahedron shape of the earlier belt.
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const craterDirection = new THREE.Vector3(
      Math.sin(variant * 2.7 + 0.4),
      Math.cos(variant * 1.9 + 0.7),
      Math.sin(variant * 3.8 + 1.1),
    ).normalize();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const y = positions.getY(vertex);
      const z = positions.getZ(vertex);
      const direction = new THREE.Vector3(x, y, z).normalize();
      const broad = Math.sin(x * (4.2 + variant) + y * 3.4 - z * 2.8);
      const fracture = Math.sin(x * 10.7 - y * (9.3 + variant) + z * 7.1);
      const crater = Math.exp(-Math.pow((1 - direction.dot(craterDirection)) / 0.09, 2));
      const displacement = 0.88 + broad * 0.11 + fracture * 0.045 - crater * 0.075;
      positions.setXYZ(vertex, x * displacement, y * displacement, z * displacement);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  });

  const materials = rockyTextures.map(texture => new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.035,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    emissive: 0x211e1b,
    emissiveIntensity: 0.18,
  }));
  const belts = geometries.map((geometry, variant) => {
    const belt = new THREE.InstancedMesh(geometry, materials[Math.floor(variant / 2)], variantCounts[variant]);
    belt.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    belt.frustumCulled = false;
    belt.castShadow = false;
    belt.receiveShadow = false;
    return belt;
  });
  for (let index = 0; index < count; index++) {
    belts[asteroidVariants[index]].setColorAt(asteroidVariantIndices[index], colours[index]);
  }
  for (const belt of belts) if (belt.instanceColor) belt.instanceColor.needsUpdate = true;

  const markerGeometry = new THREE.BufferGeometry();
  markerGeometry.setAttribute('position', new THREE.BufferAttribute(markerPositions, 3));
  markerGeometry.setAttribute('aMarkerSize', new THREE.BufferAttribute(markerSizes, 1));
  markerGeometry.setAttribute('aColour', new THREE.BufferAttribute(markerColours, 3));
  const markerUniforms = {
    uOpacity: { value: 0.36 },
    uPixelRatio: { value: 1 },
  };
  const markerMaterial = new THREE.ShaderMaterial({
    uniforms: markerUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */`
      attribute float aMarkerSize;
      attribute vec3 aColour;
      uniform float uPixelRatio;
      varying vec3 vColour;
      void main() {
        vColour = aColour;
        gl_PointSize = aMarkerSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColour;
      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float coverage = 1.0 - smoothstep(0.46, 1.0, radius);
        if (coverage < 0.01) discard;
        gl_FragColor = vec4(vColour, coverage * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const distanceMarkers = new THREE.Points(markerGeometry, markerMaterial);
  distanceMarkers.frustumCulled = false;
  distanceMarkers.renderOrder = 1;

  const group = new THREE.Group();
  group.add(...belts, distanceMarkers);

  const instance = new THREE.Object3D();
  let lastSimulationDays = Number.NaN;
  const updateInstances = (simulationDays: number) => {
    for (let index = 0; index < count; index++) {
      const angle = phases[index] + simulationDays * angularSpeeds[index];
      const orbitRadius = radii[index] * (1 - eccentricities[index] * eccentricities[index])
        / (1 + eccentricities[index] * Math.cos(angle - periapses[index]));
      instance.position.set(
        Math.cos(angle) * orbitRadius,
        Math.sin(angle + verticalPhases[index]) * verticalAmplitudes[index],
        Math.sin(angle) * orbitRadius,
      );
      markerPositions[index * 3] = instance.position.x;
      markerPositions[index * 3 + 1] = instance.position.y;
      markerPositions[index * 3 + 2] = instance.position.z;
      const spin = simulationDays * spinSpeeds[index];
      instance.rotation.set(rotationX[index] + spin * 0.37, rotationY[index] + spin, rotationZ[index] - spin * 0.21);
      instance.scale.set(
        sizes[index] * scaleX[index],
        sizes[index] * scaleY[index],
        sizes[index] * scaleZ[index],
      );
      instance.updateMatrix();
      belts[asteroidVariants[index]].setMatrixAt(asteroidVariantIndices[index], instance.matrix);
    }
    for (const belt of belts) belt.instanceMatrix.needsUpdate = true;
    (markerGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    lastSimulationDays = simulationDays;
  };
  updateInstances(0);

  return {
    object: group,
    update(simulationDays, visible, pixelRatio, opacity) {
      group.visible = visible && opacity > 0.002;
      // Point markers fade continuously; the opaque rock meshes drop out only
      // once the belt is nearly transparent.
      for (const belt of belts) belt.visible = opacity > 0.05;
      for (const material of materials) material.emissiveIntensity = 0.1 + opacity * 0.12;
      markerUniforms.uOpacity.value = opacity * 0.5;
      markerUniforms.uPixelRatio.value = pixelRatio;
      if (visible && (!Number.isFinite(lastSimulationDays) || Math.abs(simulationDays - lastSimulationDays) >= 1 / 1440)) {
        updateInstances(simulationDays);
      }
    },
  };
}
