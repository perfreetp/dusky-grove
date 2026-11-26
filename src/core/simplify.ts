import { colliderWorldAABB, distanceToPolyline } from './geometry';
import type { EditorState, SceneObject, Vec3 } from './types';
import { uid } from './geometry';

export interface FlattenPlan {
  replacement: SceneObject;
  sourceIds: string[];
  surface: number;
  inflation: number;
}

/**
 * Plan a straight replacement segment for a door-frame/wall reveal group.
 * Manifold performs the actual hull/boolean mesh operation in the viewport or
 * IO layer; this pure function owns the serializable result and collision box.
 */
export function planFlatten(
  sourceObjects: SceneObject[],
  route: EditorState['route'],
  inflation: number,
  stats?: { vertexCount?: number; volume?: number },
): FlattenPlan {
  const active = sourceObjects.filter((o) => !o.deleted && !o.hiddenBySimplify);
  const guide = active.find((o) => o.flatten);
  if (!guide?.flatten) {
    throw new Error('请选择带有凹槽/门套标记的墙段，再执行平直化合并。');
  }

  const f = guide.flatten;
  const sourceIds = active.map((o) => o.id);
  const id = `simplified-flat-${uid('seg')}`;

  let minSpan = Infinity;
  let maxSpan = -Infinity;
  let back = -Infinity;
  for (const o of active) {
    if (f.spanAxis === 'x') {
      minSpan = Math.min(minSpan, o.position[0] - (o.size?.[0] ?? 0.3) / 2);
      maxSpan = Math.max(maxSpan, o.position[0] + (o.size?.[0] ?? 0.3) / 2);
    } else {
      minSpan = Math.min(minSpan, o.position[2] - (o.size?.[2] ?? 0.3) / 2);
      maxSpan = Math.max(maxSpan, o.position[2] + (o.size?.[2] ?? 0.3) / 2);
    }
    for (const c of o.colliders) {
      const bb = colliderWorldAABB(c);
      if (f.axis === 'z') back = Math.max(back, bb.maxZ);
      else back = Math.max(back, bb.maxX);
    }
  }

  // Add a small cap so adjacent pieces are visually merged into one segment.
  minSpan -= 0.035;
  maxSpan += 0.035;
  const span = maxSpan - minSpan;
  const spanCenter = (minSpan + maxSpan) / 2;
  const depth = f.thickness;
  const surface = f.surface;
  if (!Number.isFinite(back) || back < surface + depth * 0.5) back = surface + depth;

  // Decide which side the route centerline is on so collision thickness is
  // added toward the player side, smoothing tiny recesses instead of growing
  // into the wall.
  const guidePoint: [number, number] =
    f.axis === 'z' ? [guide.position[0], surface] : [surface, guide.position[2]];
  const nearest = distanceToPolyline(guidePoint, route.points);
  const routeCoord = f.axis === 'z' ? nearest.point[1] : nearest.point[0];
  const towardRoute = routeCoord < surface ? -1 : 1;

  const baseCenterCoord = surface + depth / 2;
  const inflatedDepth = depth + inflation;
  const colliderCenterCoord = baseCenterCoord + (towardRoute * inflation) / 2;

  let position: Vec3;
  let size: Vec3;
  let colliderCenter: Vec3;
  let colliderSize: Vec3;

  if (f.axis === 'z' && f.spanAxis === 'x') {
    position = [spanCenter, 0, baseCenterCoord];
    size = [span, f.height, depth];
    colliderCenter = [spanCenter, f.height / 2, colliderCenterCoord];
    colliderSize = [span, f.height, inflatedDepth];
  } else if (f.axis === 'x' && f.spanAxis === 'z') {
    position = [baseCenterCoord, 0, spanCenter];
    size = [depth, f.height, span];
    colliderCenter = [colliderCenterCoord, f.height / 2, spanCenter];
    colliderSize = [inflatedDepth, f.height, span];
  } else {
    throw new Error('当前凹槽方向与跨度轴组合暂不支持。');
  }

  const replacement: SceneObject = {
    id,
    name: `平直化段 · ${guide.name}`,
    kind: 'simplified',
    selectable: true,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position,
    rotationY: 0,
    size,
    color: '#38bdf8',
    roughness: 0.48,
    metalness: 0.08,
    material: { name: 'SIM_Flattened_Wall', color: '#38bdf8' },
    colliders: [
      {
        id: `${id}-thick-collider`,
        objectId: id,
        center: colliderCenter,
        size: colliderSize,
        rotationY: 0,
        enabled: true,
        source: 'thickened',
        inflation,
        label: `沿平直表面重做，向通行面加厚 ${(inflation * 100).toFixed(1)} cm`,
      },
    ],
    simplification: {
      method: 'manifold-hull-flatten',
      replaces: sourceIds,
      planeAxis: f.axis,
      planeValue: surface,
      inflation,
      vertexCount: stats?.vertexCount,
      manifoldVolume: stats?.volume,
    },
    artCategory: '简化几何',
    artNote: '由 Manifold 合并凹槽/门套后生成；原对象在撤销前保留并隐藏',
  };

  return { replacement, sourceIds, surface, inflation };
}
