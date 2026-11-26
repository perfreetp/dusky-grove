import type { BoxCollider, EditorState, SceneObject, Vec3, Vec2XZ } from './types';

const CORRIDOR_HALF = 1.1;
const WALL_THICKNESS = 0.2;
const WALL_HEIGHT = 3.0;

function boxCollider(
  objectId: string,
  center: Vec3,
  size: Vec3,
  rotationY = 0,
  source: BoxCollider['source'] = 'original',
  extra: Partial<BoxCollider> = {},
): BoxCollider {
  return {
    id: `${objectId}-col-${Math.random().toString(36).slice(2, 8)}`,
    objectId,
    center,
    size,
    rotationY,
    enabled: true,
    source,
    ...extra,
  };
}

function decoration(
  id: string,
  name: string,
  position: Vec3,
  size: Vec3,
  color: string,
  artCategory: string,
  artNote: string,
  rotationY = 0,
): SceneObject {
  return {
    id,
    name,
    kind: 'decoration',
    selectable: true,
    deletable: true,
    interactive: false,
    outsideBelt: true,
    position,
    rotationY,
    size,
    color,
    roughness: 0.78,
    colliders: [
      boxCollider(id, [position[0], size[1] / 2, position[2]], size, rotationY, 'original'),
    ],
    material: { name: `${name}标准材质`, color },
    artCategory,
    artNote,
  };
}

function corridorBoundaries(points: Vec2XZ[], offset: number): { left: Vec2XZ[]; right: Vec2XZ[] } {
  const normals = points.slice(0, -1).map((a, i) => {
    const b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / len;
    const tz = (b[1] - a[1]) / len;
    return [-tz, tx] as Vec2XZ;
  });

  const left: Vec2XZ[] = [];
  const right: Vec2XZ[] = [];

  points.forEach((p, i) => {
    let miter: Vec2XZ;
    if (i === 0) {
      miter = normals[0];
    } else if (i === points.length - 1) {
      miter = normals[normals.length - 1];
    } else {
      const n0 = normals[i - 1];
      const n1 = normals[i];
      const dot = n0[0] * n1[0] + n0[1] * n1[1];
      const denominator = 1 + dot;
      // Intersection of the two offset lines; exact for the demo's 90° turns.
      miter =
        denominator < 0.08
          ? n1
          : [(n0[0] + n1[0]) / denominator, (n0[1] + n1[1]) / denominator];
    }
    left.push([p[0] + miter[0] * offset, p[1] + miter[1] * offset]);
    right.push([p[0] - miter[0] * offset, p[1] - miter[1] * offset]);
  });

  return { left, right };
}

function wallFromBoundary(id: string, label: string, a: Vec2XZ, b: Vec2XZ): SceneObject {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 0.01;
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const rotationY = Math.atan2(dx, dz);
  // A tiny end overlap closes seams without extending across the walking line.
  const size: Vec3 = [WALL_THICKNESS, WALL_HEIGHT, len + 0.04];

  return {
    id,
    name: label,
    kind: 'wall',
    selectable: true,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position: [mx, 0, mz],
    rotationY,
    size,
    color: id.endsWith('L') ? '#c7cdd8' : '#d3d8e1',
    roughness: 0.92,
    colliders: [boxCollider(id, [mx, WALL_HEIGHT / 2, mz], size, rotationY, 'original')],
  };
}

function buildCorridorWalls(points: Vec2XZ[]): SceneObject[] {
  const offset = CORRIDOR_HALF + WALL_THICKNESS / 2;
  const { left, right } = corridorBoundaries(points, offset);
  const walls: SceneObject[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    walls.push(
      wallFromBoundary(
        `wall-segment-${i + 1}-L`,
        `走廊墙段 ${i + 1}（左边界）`,
        left[i],
        left[i + 1],
      ),
    );
    walls.push(
      wallFromBoundary(
        `wall-segment-${i + 1}-R`,
        `走廊墙段 ${i + 1}（右边界）`,
        right[i],
        right[i + 1],
      ),
    );
  }
  return walls;
}

export const DEMO_ROUTE_POINTS: Vec2XZ[] = [
  [0, 8],
  [0, 5], // 拐角 1
  [3, 5], // 2
  [3, 1], // 3
  [7, 1], // 4
  [7, 5], // 5
  [10, 5], // 6
  [10, 1], // 7 — 问题门框
  [14, 1],
];

export function createDemoState(): EditorState {
  const objects: SceneObject[] = [];

  objects.push({
    id: 'floor-main',
    name: '建筑地面',
    kind: 'floor',
    selectable: false,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position: [7, -0.05, 4],
    rotationY: 0,
    size: [18, 0.1, 12],
    color: '#202938',
    roughness: 0.96,
    colliders: [],
    locked: true,
  });

  objects.push(...buildCorridorWalls(DEMO_ROUTE_POINTS));

  // 第一批可批量清理的储物/装饰件，集中在起点和前几个拐角。
  objects.push(
    decoration('dec-cabinet-east', '东侧矮柜 A', [0.86, 0, 6.55], [0.48, 1.05, 0.9], '#a16207', '储物家具', '突出墙面，材质与碰撞均来自美术场景'),
    decoration('dec-cabinet-west', '西侧矮柜 B', [-0.86, 0, 6.55], [0.48, 1.05, 0.9], '#92400e', '储物家具', '柜门把手有独立材质'),
    decoration('dec-crate-01', '物流箱 01', [0.9, 0, 7.55], [0.5, 0.62, 0.5], '#b45309', '杂物', '可移走，不参与交互'),
    decoration('dec-crate-02', '物流箱 02', [-0.9, 0, 7.55], [0.5, 0.62, 0.5], '#c2410c', '杂物', '可移走，不参与交互'),
    decoration('dec-planter-01', '绿植花箱 01', [1.35, 0, 4.18], [0.55, 0.62, 0.5], '#15803d', '绿植', '枝叶 mesh 与盆体材质分离'),
    decoration('dec-planter-02', '绿植花箱 02', [2.25, 0, 5.84], [0.55, 0.62, 0.5], '#166534', '绿植', '装饰，无交互'),
    decoration('dec-chair-01', '等候椅', [3.86, 0, 3.35], [0.46, 0.9, 0.58], '#475569', '座椅', '金属椅脚和布艺坐垫'),
    decoration('dec-planter-03', '转角花箱 03', [4.65, 0, 1.84], [0.58, 0.58, 0.46], '#166534', '绿植', '贴墙装饰'),
    decoration('dec-crate-03', '清洁用品箱', [5.65, 0, 0.16], [0.5, 0.7, 0.46], '#0f766e', '杂物', '非交互装饰'),
    decoration('dec-sculpture', '大厅抽象雕塑', [7.9, 0, 3.2], [0.46, 1.65, 0.46], '#7c3aed', '雕塑', '金属漆材质'),
    decoration('dec-chair-02', '休息椅 02', [8.4, 0, 5.86], [0.58, 0.88, 0.46], '#334155', '座椅', '靠墙放置'),
    decoration('dec-planter-04', '走廊花箱 04', [10.86, 0, 3.7], [0.46, 0.58, 0.62], '#14532d', '绿植', '不参与门禁交互'),
    decoration('dec-bench', '起点长条凳', [-0.92, 0, 8.72], [0.48, 0.46, 1.25], '#78350f', '座椅', '凳面木纹材质'),
    decoration('dec-vase', '落地花瓶', [0.96, 0, 8.55], [0.34, 1.15, 0.34], '#0e7490', '摆件', '易碎但本关无交互逻辑'),
  );

  // 受保护的交互物：即使被框到也不能作为装饰删除。
  objects.push({
    id: 'int-kiosk-01',
    name: '互动导览终端',
    kind: 'interactive',
    selectable: true,
    deletable: false,
    interactive: true,
    outsideBelt: false,
    position: [2.08, 0, 4.12],
    rotationY: 0,
    size: [0.55, 1.72, 0.45],
    color: '#0ea5e9',
    emissive: '#075985',
    colliders: [
      boxCollider('int-kiosk-01', [2.08, 0.86, 4.12], [0.55, 1.72, 0.45], 0, 'original'),
    ],
    material: { name: 'Kiosk_Body_Emissive', color: '#0ea5e9' },
    artCategory: '交互设施',
    artNote: '策划标记为可交互，框选删除时必须保留',
  });

  // 第 7 拐角门框与内侧凹槽。
  objects.push({
    id: 'door7-south-jamb',
    name: '第7门框 · 南立梃',
    kind: 'door',
    selectable: true,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position: [10.9, 0, 0.05],
    rotationY: 0,
    size: [0.28, 2.2, 0.3],
    color: '#8b95a5',
    roughness: 0.55,
    metalness: 0.25,
    colliders: [boxCollider('door7-south-jamb', [10.9, 1.1, 0.05], [0.28, 2.2, 0.3])],
    artCategory: '门框',
  });

  objects.push({
    id: 'door7-north-jamb',
    name: '第7门框 · 凹槽立梃',
    kind: 'door',
    selectable: true,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position: [10.9, 0, 1.95],
    rotationY: 0,
    size: [0.28, 2.2, 0.3],
    color: '#9aa4b4',
    roughness: 0.5,
    metalness: 0.3,
    parts: [
      { id: 'jamb-body', position: [0, 1.1, 0], size: [0.28, 2.2, 0.3], color: '#9aa4b4' },
      { id: 'jamb-reveal-dark', position: [0, 1.08, -0.151], size: [0.18, 2.02, 0.018], color: '#4b5563' },
      { id: 'jamb-lip-a', position: [0, 1.08, -0.17], size: [0.24, 2.08, 0.035], color: '#c7ceda' },
      { id: 'jamb-lip-b', position: [0, 1.08, 0.15], size: [0.24, 2.08, 0.035], color: '#7c8798' },
    ],
    colliders: [boxCollider('door7-north-jamb', [10.9, 1.1, 1.95], [0.28, 2.2, 0.3])],
    grooveTag: 'door-frame',
    flatten: { axis: 'z', surface: 1.76, spanAxis: 'x', thickness: 0.36, height: 2.12 },
    artCategory: '门框',
    artNote: '内侧门套线和锁舌凹槽形成凹面',
  });

  objects.push({
    id: 'door7-groove',
    name: '第7门框内侧凹槽',
    kind: 'door',
    selectable: true,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position: [10.9, 0, 1.76],
    rotationY: 0,
    size: [0.24, 2.08, 0.08],
    color: '#374151',
    parts: [
      { id: 'groove-slot', position: [0, 1.04, 0], size: [0.16, 1.96, 0.035], color: '#111827' },
      { id: 'groove-edge-l', position: [-0.105, 1.04, -0.018], size: [0.035, 2.04, 0.07], color: '#d1d5db' },
      { id: 'groove-edge-r', position: [0.105, 1.04, -0.018], size: [0.035, 2.04, 0.07], color: '#9ca3af' },
    ],
    colliders: [
      boxCollider(
        'door7-groove',
        [10.9, 1.03, 1.51],
        [0.18, 2.06, 0.42],
        0,
        'original',
        {
          id: 'door7-groove-bad-collider',
          label: '旧凹槽烘焙碰撞：向通行面伸出',
          collisionOnly: true,
        },
      ),
    ],
    grooveTag: 'door-frame',
    flatten: { axis: 'z', surface: 1.76, spanAxis: 'x', thickness: 0.36, height: 2.12 },
    artCategory: '门框凹槽',
    artNote: '试玩记录：第 7 拐角反复撞墙；旧碰撞体保留了凹槽折面',
  });

  objects.push({
    id: 'corner3-reveal',
    name: '第3拐角墙面凹槽',
    kind: 'wall',
    selectable: true,
    deletable: false,
    interactive: false,
    outsideBelt: false,
    position: [3.55, 0, 2.04],
    rotationY: 0,
    size: [0.58, 2.55, 0.16],
    color: '#64748b',
    roughness: 0.88,
    parts: [
      { id: 'reveal-body', position: [0, 1.275, 0], size: [0.58, 2.55, 0.16], color: '#64748b' },
      { id: 'reveal-slot', position: [0, 1.3, -0.09], size: [0.34, 2.1, 0.035], color: '#1e293b' },
      { id: 'reveal-lip-l', position: [-0.25, 1.28, -0.11], size: [0.055, 2.42, 0.08], color: '#cbd5e1' },
      { id: 'reveal-lip-r', position: [0.25, 1.28, -0.11], size: [0.055, 2.42, 0.08], color: '#94a3b8' },
    ],
    colliders: [
      boxCollider(
        'corner3-reveal',
        [3.55, 1.27, 1.79],
        [0.42, 2.45, 0.5],
        0,
        'original',
        { id: 'corner3-reveal-bad-collider', label: '墙角凹槽折面碰撞', collisionOnly: true },
      ),
    ],
    grooveTag: 'corner',
    flatten: { axis: 'z', surface: 1.96, spanAxis: 'x', thickness: 0.24, height: 2.6 },
    artCategory: '墙角凹槽',
    artNote: '墙角内凹灰槽会形成折面碰撞，简化时拉平为一段墙面',
  });

  objects.push({
    id: 'int-door-call-7',
    name: '第7门呼叫按钮',
    kind: 'interactive',
    selectable: true,
    deletable: false,
    interactive: true,
    outsideBelt: false,
    position: [10.72, 1.05, 1.7],
    rotationY: 0,
    size: [0.12, 0.18, 0.06],
    color: '#22c55e',
    emissive: '#14532d',
    colliders: [],
    artCategory: '交互按钮',
    artNote: '门禁交互不能被简化掉',
  });

  return {
    revision: 1,
    projectName: '视障路线场景简化 · 第7拐角试玩复现',
    unit: 'metre',
    gridSize: 0.25,
    snapDistance: 0.32,
    collisionInflation: 0.04,
    workBounds: { minX: -1.8, maxX: 15.8, minZ: -1.8, maxZ: 9.8 },
    route: {
      description:
        '策划路线说明（示例）：从北侧无障碍入口出发，沿主走廊经过 7 个直角拐角，到达东侧无障碍电梯。通行带设计净宽 1.20m；探针模拟靠声效和盲杖走位的玩家，半径 0.32m。试玩反馈：玩家在第 7 个拐角连续撞墙。',
      points: DEMO_ROUTE_POINTS.map((p) => [...p] as Vec2XZ),
      beltWidth: 1.2,
      probeRadius: 0.32,
      probeHeight: 0.85,
      probeVerticalRadius: 0.32,
      clearWidthTarget: 1.4,
    },
    objects,
  };
}
