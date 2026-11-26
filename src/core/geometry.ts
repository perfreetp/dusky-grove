import type {
  BoxCollider,
  EditorState,
  ProbeHit,
  ProbeReport,
  SceneObject,
  Vec2XZ,
  Vec3,
  WidthSample,
  WorkBounds,
} from './types';

export const EPS = 1e-6;

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function v2Sub(a: Vec2XZ, b: Vec2XZ): Vec2XZ {
  return [a[0] - b[0], a[1] - b[1]];
}

export function v2Add(a: Vec2XZ, b: Vec2XZ): Vec2XZ {
  return [a[0] + b[0], a[1] + b[1]];
}

export function v2Scale(a: Vec2XZ, s: number): Vec2XZ {
  return [a[0] * s, a[1] * s];
}

export function v2Len(a: Vec2XZ): number {
  return Math.hypot(a[0], a[1]);
}

export function colliderAxes(c: Pick<BoxCollider, 'rotationY'>): {
  x: Vec2XZ;
  z: Vec2XZ;
  cos: number;
  sin: number;
} {
  const cos = Math.cos(c.rotationY);
  const sin = Math.sin(c.rotationY);
  // Three.js rotation around +Y: local X -> (cos, -sin), local Z -> (sin, cos).
  return { cos, sin, x: [cos, -sin], z: [sin, cos] };
}

export function colliderHalfExtents(c: BoxCollider): Vec3 {
  return [c.size[0] / 2, c.size[1] / 2, c.size[2] / 2];
}

export function colliderWorldAABB(c: BoxCollider): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  const [hx, hy, hz] = colliderHalfExtents(c);
  const { cos, sin } = colliderAxes(c);
  const ex = hx * Math.abs(cos) + hz * Math.abs(sin);
  const ez = hx * Math.abs(sin) + hz * Math.abs(cos);
  return {
    minX: c.center[0] - ex,
    maxX: c.center[0] + ex,
    minY: c.center[1] - hy,
    maxY: c.center[1] + hy,
    minZ: c.center[2] - ez,
    maxZ: c.center[2] + ez,
  };
}

export function activeObjects(state: EditorState): SceneObject[] {
  return state.objects.filter((o) => !o.deleted && !o.hiddenBySimplify);
}

export function activeColliders(
  state: EditorState,
): Array<BoxCollider & { object: SceneObject }> {
  const out: Array<BoxCollider & { object: SceneObject }> = [];
  for (const object of activeObjects(state)) {
    for (const c of object.colliders) {
      if (c.enabled) out.push({ ...c, object });
    }
  }
  return out;
}

/** Signed-ish XZ distance: zero while the point is inside the OBB. */
export function pointOBBDistanceXZ(p: Vec2XZ, c: BoxCollider): number {
  const { x: ax, z: az } = colliderAxes(c);
  const dx = p[0] - c.center[0];
  const dz = p[1] - c.center[2];
  const lx = dx * ax[0] + dz * ax[1];
  const lz = dx * az[0] + dz * az[1];
  const [hx, , hz] = colliderHalfExtents(c);
  const ox = Math.max(Math.abs(lx) - hx, 0);
  const oz = Math.max(Math.abs(lz) - hz, 0);
  return Math.hypot(ox, oz);
}

export function closestPointOnOBBXZ(p: Vec2XZ, c: BoxCollider): Vec2XZ {
  const { x: ax, z: az } = colliderAxes(c);
  const dx = p[0] - c.center[0];
  const dz = p[1] - c.center[2];
  const lx = dx * ax[0] + dz * ax[1];
  const lz = dx * az[0] + dz * az[1];
  const [hx, , hz] = colliderHalfExtents(c);
  const qx = clamp(lx, -hx, hx);
  const qz = clamp(lz, -hz, hz);
  return [
    c.center[0] + ax[0] * qx + az[0] * qz,
    c.center[2] + ax[1] * qx + az[1] * qz,
  ];
}

function verticalOverlapForProbe(c: BoxCollider, route: EditorState['route']): boolean {
  const low = route.probeHeight - route.probeRadius;
  const high = route.probeHeight + route.probeRadius;
  const bb = colliderWorldAABB(c);
  return bb.maxY >= low && bb.minY <= high;
}

export function probeCollides(
  p: Vec2XZ,
  state: EditorState,
): { collider: BoxCollider & { object: SceneObject }; distance: number } | null {
  let best: { collider: BoxCollider & { object: SceneObject }; distance: number } | null = null;
  for (const c of activeColliders(state)) {
    if (!verticalOverlapForProbe(c, state.route)) continue;
    const d = pointOBBDistanceXZ(p, c);
    if (d <= state.route.probeRadius && (!best || d < best.distance)) {
      best = { collider: c, distance: d };
    }
  }
  return best;
}

export function polylineLength(points: Vec2XZ[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

export function pointAtDistance(
  points: Vec2XZ[],
  distance: number,
): { point: Vec2XZ; tangent: Vec2XZ; normal: Vec2XZ; segmentIndex: number } {
  let remaining = Math.max(0, distance);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < EPS) continue;
    if (remaining <= len || i === points.length - 2) {
      const t = clamp(remaining / len, 0, 1);
      const tangent: Vec2XZ = [dx / len, dz / len];
      // Rotate tangent clockwise in XZ; sign is only used to label two sides.
      const normal: Vec2XZ = [-tangent[1], tangent[0]];
      return {
        point: [a[0] + dx * t, a[1] + dz * t],
        tangent,
        normal,
        segmentIndex: i,
      };
    }
    remaining -= len;
  }
  const last = points[points.length - 1] ?? [0, 0];
  return { point: [...last], tangent: [0, 1], normal: [-1, 0], segmentIndex: 0 };
}

export function distancePointSegment2D(
  p: Vec2XZ,
  a: Vec2XZ,
  b: Vec2XZ,
): { distance: number; t: number; point: Vec2XZ } {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const lenSq = vx * vx + vz * vz;
  if (lenSq < EPS) {
    return { distance: Math.hypot(p[0] - a[0], p[1] - a[1]), t: 0, point: [...a] };
  }
  const t = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / lenSq, 0, 1);
  const q: Vec2XZ = [a[0] + vx * t, a[1] + vz * t];
  return { distance: Math.hypot(p[0] - q[0], p[1] - q[1]), t, point: q };
}

export function distanceToPolyline(
  p: Vec2XZ,
  points: Vec2XZ[],
): { distance: number; point: Vec2XZ; segmentIndex: number } {
  let best = { distance: Infinity, point: p, segmentIndex: -1 };
  for (let i = 0; i < points.length - 1; i++) {
    const r = distancePointSegment2D(p, points[i], points[i + 1]);
    if (r.distance < best.distance) best = { ...r, segmentIndex: i };
  }
  return best;
}

export function runProbe(state: EditorState): ProbeReport {
  const points = state.route.points;
  const totalLength = polylineLength(points);
  const step = Math.max(0.02, state.route.probeRadius / 12);
  const hits: ProbeHit[] = [];

  for (let s = 0; s <= totalLength + EPS; s += step) {
    const d = Math.min(s, totalLength);
    const { point, segmentIndex } = pointAtDistance(points, d);
    const collision = probeCollides(point, state);
    if (collision) {
      const c = collision.collider;
      const closest2 = closestPointOnOBBXZ(point, c);
      const bb = colliderWorldAABB(c);
      const y = clamp(state.route.probeHeight, bb.minY, bb.maxY);
      const hit: ProbeHit = {
        segmentIndex,
        routeDistance: d,
        position: [point[0], state.route.probeHeight, point[1]],
        closestPoint: [closest2[0], y, closest2[1]],
        heightAboveFloor: y,
        colliderBottom: bb.minY,
        colliderTop: bb.maxY,
        colliderId: c.id,
        objectId: c.objectId,
        objectName: c.object.name,
        source: c.source,
        message: `探针在第 ${segmentIndex + 1} 段路线被「${c.object.name}」挡住，卡点离地 ${y.toFixed(2)} m。`,
      };
      hits.push(hit);
      return {
        status: 'blocked',
        progress: clamp(d / totalLength, 0, 1),
        traveled: d,
        totalLength,
        hits,
        firstHit: hit,
      };
    }
  }

  return {
    status: 'pass',
    progress: 1,
    traveled: totalLength,
    totalLength,
    hits: [],
    passedAt: new Date().toISOString(),
  };
}

/** Exact ray vs 2D OBB slab. Returns positive entry distance, 0 if inside. */
export function rayColliderDistance2D(
  origin: Vec2XZ,
  dir: Vec2XZ,
  c: BoxCollider,
): number | null {
  const { x: ax, z: az } = colliderAxes(c);
  const dx = origin[0] - c.center[0];
  const dz = origin[1] - c.center[2];
  const localOrigin: Vec2XZ = [dx * ax[0] + dz * ax[1], dx * az[0] + dz * az[1]];
  const localDir: Vec2XZ = [
    dir[0] * ax[0] + dir[1] * ax[1],
    dir[0] * az[0] + dir[1] * az[1],
  ];
  const [hx, , hz] = colliderHalfExtents(c);

  let tMin = -Infinity;
  let tMax = Infinity;
  for (const axis of [0, 1] as const) {
    const o = axis === 0 ? localOrigin[0] : localOrigin[1];
    const d = axis === 0 ? localDir[0] : localDir[1];
    const min = axis === 0 ? -hx : -hz;
    const max = axis === 0 ? hx : hz;
    if (Math.abs(d) < EPS) {
      if (o < min || o > max) return null;
      continue;
    }
    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : 0;
}

function widthColliderAllowed(c: BoxCollider): boolean {
  const bb = colliderWorldAABB(c);
  // Ignore floor and overhead signs/headers above the accessible head band.
  if (bb.maxY <= 0.08) return false;
  if (bb.minY >= 2.05) return false;
  return true;
}

export function computeWidthSamples(state: EditorState, interval = 0.25): WidthSample[] {
  const points = state.route.points;
  const total = polylineLength(points);
  const colliders = activeColliders(state).filter(widthColliderAllowed);
  const samples: WidthSample[] = [];
  const maxRay = 8;

  for (let d = 0; d <= total + EPS; d += interval) {
    const at = pointAtDistance(points, Math.min(d, total));
    let left = maxRay;
    let right = maxRay;
    let leftName: string | undefined;
    let rightName: string | undefined;
    let leftId: string | undefined;
    let rightId: string | undefined;

    for (const c of colliders) {
      const tl = rayColliderDistance2D(at.point, at.normal, c);
      if (tl !== null && tl < left) {
        left = tl;
        leftName = c.object.name;
        leftId = c.id;
      }
      const rd: Vec2XZ = [-at.normal[0], -at.normal[1]];
      const tr = rayColliderDistance2D(at.point, rd, c);
      if (tr !== null && tr < right) {
        right = tr;
        rightName = c.object.name;
        rightId = c.id;
      }
    }

    samples.push({
      distance: Math.min(d, total),
      point: at.point,
      tangent: at.tangent,
      normal: at.normal,
      leftDistance: left,
      rightDistance: right,
      width: left + right,
      limitingObjectName: left <= right ? leftName : rightName,
      limitingColliderId: left <= right ? leftId : rightId,
    });
  }
  return samples;
}

export function minimumWidth(samples: WidthSample[]): WidthSample | undefined {
  return samples.reduce<WidthSample | undefined>((min, s) => {
    if (!min || s.width < min.width) return s;
    return min;
  }, undefined);
}

export function objectFootprintCircle(obj: SceneObject): { x: number; z: number; radius: number } {
  let minX = obj.position[0];
  let maxX = obj.position[0];
  let minZ = obj.position[2];
  let maxZ = obj.position[2];
  let found = false;

  for (const c of obj.colliders) {
    const bb = colliderWorldAABB(c);
    if (!found) {
      minX = bb.minX;
      maxX = bb.maxX;
      minZ = bb.minZ;
      maxZ = bb.maxZ;
      found = true;
    } else {
      minX = Math.min(minX, bb.minX);
      maxX = Math.max(maxX, bb.maxX);
      minZ = Math.min(minZ, bb.minZ);
      maxZ = Math.max(maxZ, bb.maxZ);
    }
  }

  if (!found && obj.size) {
    const [w, , d] = obj.size;
    const ex = (w + d) / 4;
    minX = obj.position[0] - ex;
    maxX = obj.position[0] + ex;
    minZ = obj.position[2] - ex;
    maxZ = obj.position[2] + ex;
  }

  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  const radius = Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2);
  return { x, z, radius };
}

export function objectFootprintCorners(obj: SceneObject): Vec2XZ[] {
  const [halfX, halfZ] = objectWorldHalfExtents(obj);
  const cos = Math.cos(obj.rotationY);
  const sin = Math.sin(obj.rotationY);
  const center: Vec2XZ = [obj.position[0], obj.position[2]];
  const local: Vec2XZ[] = [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [halfX, halfZ],
    [-halfX, halfZ],
    [0, -halfZ],
    [halfX, 0],
    [0, halfZ],
    [-halfX, 0],
  ];
  return local.map(([x, z]) => [
    center[0] + x * cos + z * sin,
    center[1] - x * sin + z * cos,
  ]);
}

export function isObjectOutsideBelt(obj: SceneObject, route: EditorState['route']): boolean {
  if (obj.locked || obj.interactive || !obj.deletable) return false;
  // Test the OBB corners and edge midpoints rather than a conservative circle.
  // This lets shallow cabinets sit just outside the swept belt even at corners.
  const points = objectFootprintCorners(obj);
  let minimum = Infinity;
  for (const p of points) {
    minimum = Math.min(minimum, distanceToPolyline(p, route.points).distance);
  }
  return minimum >= route.beltWidth / 2 - 0.03;
}

export function objectWorldHalfExtents(obj: SceneObject): Vec2XZ {
  let hx = (obj.size?.[0] ?? 0.5) / 2;
  let hz = (obj.size?.[2] ?? 0.5) / 2;
  if (!obj.size && obj.colliders[0]) {
    const bb = colliderWorldAABB(obj.colliders[0]);
    hx = (bb.maxX - bb.minX) / 2;
    hz = (bb.maxZ - bb.minZ) / 2;
  }
  const cos = Math.cos(obj.rotationY);
  const sin = Math.sin(obj.rotationY);
  return [hx * Math.abs(cos) + hz * Math.abs(sin), hx * Math.abs(sin) + hz * Math.abs(cos)];
}

export interface SnapResult {
  position: Vec3;
  snappedX: boolean;
  snappedZ: boolean;
  candidates: string[];
}

export function snapObjectPosition(
  raw: Vec3,
  obj: SceneObject,
  objects: SceneObject[],
  gridSize: number,
  snapDistance: number,
): SnapResult {
  const [halfX, halfZ] = objectWorldHalfExtents(obj);
  let x = raw[0];
  let z = raw[2];
  let snappedX = false;
  let snappedZ = false;
  const candidates: string[] = [];

  const gridX = Math.round(x / gridSize) * gridSize;
  if (Math.abs(gridX - x) <= snapDistance) {
    x = gridX;
    snappedX = true;
    candidates.push(`X → 地面网格 ${gridX.toFixed(2)} m`);
  }
  const gridZ = Math.round(z / gridSize) * gridSize;
  if (Math.abs(gridZ - z) <= snapDistance) {
    z = gridZ;
    snappedZ = true;
    candidates.push(`Z → 地面网格 ${gridZ.toFixed(2)} m`);
  }

  for (const other of objects) {
    if (other.id === obj.id || other.deleted || other.hiddenBySimplify) continue;
    for (const c of other.colliders) {
      if (!c.enabled) continue;
      const bb = colliderWorldAABB(c);
      const zOverlap = z + halfZ + 0.25 >= bb.minZ && z - halfZ - 0.25 <= bb.maxZ;
      if (zOverlap) {
        const touches: Array<{ value: number; label: string }> = [
          { value: bb.maxX + halfX, label: `X 贴 ${other.name} 东面` },
          { value: bb.minX - halfX, label: `X 贴 ${other.name} 西面` },
        ];
        for (const candidate of touches) {
          if (Math.abs(candidate.value - x) <= snapDistance) {
            x = candidate.value;
            snappedX = true;
            candidates.push(candidate.label);
          }
        }
      }
      const xOverlap = x + halfX + 0.25 >= bb.minX && x - halfX - 0.25 <= bb.maxX;
      if (xOverlap) {
        const touches: Array<{ value: number; label: string }> = [
          { value: bb.maxZ + halfZ, label: `Z 贴 ${other.name} 北侧` },
          { value: bb.minZ - halfZ, label: `Z 贴 ${other.name} 南侧` },
        ];
        for (const candidate of touches) {
          if (Math.abs(candidate.value - z) <= snapDistance) {
            z = candidate.value;
            snappedZ = true;
            candidates.push(candidate.label);
          }
        }
      }
    }
  }

  return { position: [x, raw[1] ?? 0, z], snappedX, snappedZ, candidates };
}

export function footprintInsideBounds(
  position: Vec3,
  obj: SceneObject,
  bounds: WorkBounds,
  tolerance = 0.04,
): boolean {
  const [hx, hz] = objectWorldHalfExtents({ ...obj, position });
  return (
    position[0] - hx >= bounds.minX - tolerance &&
    position[0] + hx <= bounds.maxX + tolerance &&
    position[2] - hz >= bounds.minZ - tolerance &&
    position[2] + hz <= bounds.maxZ + tolerance
  );
}

export function formatDimensions(size?: Vec3): string {
  if (!size) return '—';
  return `${size[0].toFixed(2)} × ${size[1].toFixed(2)} × ${size[2].toFixed(2)} m`;
}

export function uid(prefix = 'id'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}
