// A deliberately synthetic, smooth Earth wind field for the cloud-coupling
// preview. Both the cloud shader and the tracer paths use these same bands and
// vortices; this is not a weather forecast or a sampled atmospheric dataset.
export function sampleEarthWind(u: number, v: number): [number, number] {
  const latitude = (v - 0.5) * Math.PI;
  const cosLatitude = Math.max(0, Math.cos(latitude));
  const jet = Math.exp(-(((Math.abs(latitude) - 0.72) / 0.34) ** 2));
  let east = (-0.00038 + 0.00096 * jet) * Math.sqrt(cosLatitude);
  let north = 0.00016 * Math.sin(u * Math.PI * 4 + latitude * 2.5) * cosLatitude;
  for (const [centerU, centerV, strength] of [[0.18, 0.62, 0.006], [0.73, 0.38, -0.005]] as const) {
    const dx = ((u - centerU + 1.5) % 1) - 0.5;
    const dy = v - centerV;
    const weight = Math.exp(-(dx * dx + dy * dy) / 0.004);
    east += -dy * strength * weight;
    north += dx * strength * weight;
  }
  return [east, north];
}

// Stylized gyres for the layer-switching prototype. Land is masked using the
// Earth surface texture at render time; these are not observed ocean currents.
export function sampleOceanCurrent(u: number, v: number): [number, number] {
  let east = 0.00008 * Math.cos((v - 0.5) * Math.PI);
  let north = 0;
  for (const [centerU, centerV, strength] of [
    [0.13, 0.62, 0.008], [0.28, 0.37, -0.008],
    [0.58, 0.61, 0.007], [0.76, 0.37, -0.007]
  ] as const) {
    const dx = ((u - centerU + 1.5) % 1) - 0.5;
    const dy = v - centerV;
    const weight = Math.exp(-(dx * dx + dy * dy) / 0.022);
    east += -dy * strength * weight;
    north += dx * strength * weight;
  }
  return [east, north];
}

export const EARTH_WIND_GLSL = /* glsl */`
vec2 earthWind(vec2 uv) {
  float latitude = (uv.y - 0.5) * 3.14159265359;
  float cosLatitude = max(0.0, cos(latitude));
  float jet = exp(-pow((abs(latitude) - 0.72) / 0.34, 2.0));
  vec2 wind = vec2(
    (-0.00038 + 0.00096 * jet) * sqrt(cosLatitude),
    0.00016 * sin(uv.x * 12.56637061436 + latitude * 2.5) * cosLatitude
  );
  vec2 deltaA = vec2(fract(uv.x - 0.18 + 0.5) - 0.5, uv.y - 0.62);
  vec2 deltaB = vec2(fract(uv.x - 0.73 + 0.5) - 0.5, uv.y - 0.38);
  float a = exp(-dot(deltaA, deltaA) / 0.004);
  float b = exp(-dot(deltaB, deltaB) / 0.004);
  wind += vec2(-deltaA.y, deltaA.x) * (0.006 * a);
  wind += vec2(-deltaB.y, deltaB.x) * (-0.005 * b);
  return wind;
}
`;
