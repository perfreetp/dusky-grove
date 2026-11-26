// Geological model: x = strike, y = dip direction, d = depth downward.
export const X_MIN = -5, X_MAX = 5;
export const Y_MIN = -3.6, Y_MAX = 3.6;
export const D_MAX = 5.75;

export const FAULT_Y0 = -0.25;
export const FAULT_DIP = 0.52; // y increase per km of depth
export const PRESET_THROW = 0.58;
export const ALIGN_X = 4.25;

export const TARGET_INDEX = 2;

export const HORIZONS = [
  { name: 'H1', d: 0.62, ax: 0.08, ay: 0.14, kx: 0.72, ky: 1.08, p1: 0.2, p2: 1.1, amp: 0.92, sigma: 0.112, color: '#d8a24a' },
  { name: 'H2', d: 1.29, ax: 0.13, ay: 0.23, kx: 0.61, ky: 0.96, p1: 1.4, p2: 0.4, amp: -0.82, sigma: 0.116, color: '#b9783f' },
  { name: 'H3', d: 1.97, ax: 0.18, ay: 0.34, kx: 0.55, ky: 0.91, p1: 2.2, p2: 2.0, amp: 1.00, sigma: 0.100, color: '#c85f4b' },
  { name: 'H4', d: 2.67, ax: 0.15, ay: 0.29, kx: 0.66, ky: 1.04, p1: 0.8, p2: 2.7, amp: -0.90, sigma: 0.112, color: '#7f9654' },
  { name: 'H5 lens', d: 3.22, lens: true, ax: 0.10, ay: 0.18, kx: 0.82, ky: 1.12, p1: 2.8, p2: 0.7, amp: 0.86, sigma: 0.095, color: '#4f91a3' },
  { name: 'H6', d: 3.88, ax: 0.17, ay: 0.25, kx: 0.58, ky: 0.88, p1: 1.9, p2: 1.6, amp: -0.92, sigma: 0.115, color: '#8a6f4d' },
  { name: 'H7', d: 4.54, ax: 0.13, ay: 0.22, kx: 0.70, ky: 1.00, p1: 3.1, p2: 2.4, amp: 0.84, sigma: 0.118, color: '#766a58' },
  { name: 'H8', d: 5.17, ax: 0.10, ay: 0.17, kx: 0.63, ky: 0.94, p1: 0.5, p2: 0.2, amp: -0.76, sigma: 0.122, color: '#475569' }
];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function rawBaseDepth(h, i, x, y) {
  const foldDip = h.ay * Math.sin(y * 1.05 + 0.28 * x + h.p1);
  const foldStrike = h.ax * Math.sin(x * h.kx + h.p2 + 0.15 * Math.sin(y * 0.8));
  const dome = -0.27 * Math.exp(-((x + 1.6) ** 2 / 20 + (y + 0.2) ** 2 / 6)) * (0.55 + 0.07 * i);
  const basin = 0.17 * Math.exp(-((x - 3.2) ** 2 / 12 + (y + 1.8) ** 2 / 5));
  const tilt = 0.045 * y - 0.018 * x;
  return h.d + foldDip + foldStrike + dome + basin + tilt;
}

function rawWeight(h, x, y) {
  if (!h.lens) return 1;
  const lens = Math.exp(-(((x - 0.1) / 2.8) ** 2) - (((y - 0.55) / 1.35) ** 2));
  return smoothstep(0.25, 0.55, lens);
}

// Fine lookup tables keep per-pixel profile rendering cheap.
const GX = 220, GY = 160;
const depthTables = HORIZONS.map(() => new Float32Array((GX + 1) * (GY + 1)));
const weightTables = HORIZONS.map(() => new Float32Array((GX + 1) * (GY + 1)));

for (let iy = 0; iy <= GY; iy++) {
  const y = lerp(Y_MIN, Y_MAX, iy / GY);
  for (let ix = 0; ix <= GX; ix++) {
    const x = lerp(X_MIN, X_MAX, ix / GX);
    const id = iy * (GX + 1) + ix;
    HORIZONS.forEach((h, i) => {
      depthTables[i][id] = rawBaseDepth(h, i, x, y);
      weightTables[i][id] = rawWeight(h, x, y);
    });
  }
}

function sampleTable(table, x, y) {
  const fx = clamp((x - X_MIN) / (X_MAX - X_MIN) * GX, 0, GX);
  const fy = clamp((y - Y_MIN) / (Y_MAX - Y_MIN) * GY, 0, GY);
  const ix = Math.min(GX - 1, Math.floor(fx));
  const iy = Math.min(GY - 1, Math.floor(fy));
  const tx = fx - ix, ty = fy - iy;
  const row = GX + 1;
  const i00 = iy * row + ix;
  const a = lerp(table[i00], table[i00 + 1], tx);
  const b = lerp(table[i00 + row], table[i00 + row + 1], tx);
  return lerp(a, b, ty);
}

export const baseDepthAt = (i, x, y) => sampleTable(depthTables[i], x, y);
export const weightAt = (i, x, y) => sampleTable(weightTables[i], x, y);
export const faultCoord = (y, d) => y - FAULT_Y0 - FAULT_DIP * d;
export const faultDepthAtY = y => (y - FAULT_Y0) / FAULT_DIP;
export const faultYAtDepth = d => FAULT_Y0 + FAULT_DIP * d;

// Throw is full at the west preset section and dies smoothly at the east tip.
export function faultEnvelope(x) {
  return 1 - smoothstep(-0.15, ALIGN_X, x);
}

export function localThrowAt(x, nominalThrow) {
  return nominalThrow * faultEnvelope(x);
}

export function branchDepth(i, x, y, side, nominalThrow) {
  const t = localThrowAt(x, nominalThrow);
  const sourceY = y - side * FAULT_DIP * t / 2;
  return {
    depth: baseDepthAt(i, x, sourceY) + side * t / 2,
    weight: weightAt(i, x, sourceY),
    throw: t
  };
}

function ricker(distance, sigma) {
  const a = distance / sigma;
  return (1 - a * a) * Math.exp(-0.5 * a * a);
}

export function amplitudeAt(x, y, d, nominalThrow) {
  const side = faultCoord(y, d) >= 0 ? 1 : -1;
  let value = 0;
  for (let i = 0; i < HORIZONS.length; i++) {
    const b = branchDepth(i, x, y, side, nominalThrow);
    if (b.weight < 0.015) continue;
    value += HORIZONS[i].amp * b.weight * ricker(d - b.depth, HORIZONS[i].sigma);
  }
  // A tiny bedding texture makes the color bands feel continuous.
  value += 0.035 * Math.sin(8.5 * d + 1.7 * x + 0.8 * y) * Math.exp(-d / 7);
  return value;
}

export function profileCoordinate(mode, u, fixed) {
  return mode === 'dip' ? { x: fixed, y: u } : { x: u, y: fixed };
}

export function profileRange(mode) {
  return mode === 'dip' ? { min: Y_MIN, max: Y_MAX, label: 'Y / 倾向坐标 (km)' } : { min: X_MIN, max: X_MAX, label: 'X / 走向坐标 (km)' };
}

export function sliceBounds(mode) {
  return mode === 'dip'
    ? { min: X_MIN + 0.2, max: X_MAX - 0.2 }
    : { min: Y_MIN + 0.18, max: Y_MAX - 0.18 };
}

export function countTrackedHorizons(mode, fixed, nominalThrow) {
  let count = 0;
  for (let i = 0; i < HORIZONS.length; i++) {
    let maxWeight = 0;
    for (let k = 0; k <= 90; k++) {
      const r = profileRange(mode);
      const u = lerp(r.min, r.max, k / 90);
      const p = profileCoordinate(mode, u, fixed);
      maxWeight = Math.max(maxWeight, weightAt(i, p.x, p.y));
    }
    if (maxWeight > 0.5) count++;
  }
  return count;
}
