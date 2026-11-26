export type Vec3 = [number, number, number];
export type Vec2XZ = [number, number];

export type ObjectKind =
  | 'floor'
  | 'wall'
  | 'door'
  | 'decoration'
  | 'interactive'
  | 'simplified'
  | 'marker'
  | 'imported';

export interface MaterialSummary {
  name: string;
  color?: string;
  map?: boolean;
  transparent?: boolean;
}

export interface BoxCollider {
  id: string;
  objectId: string;
  /** World-space center, metres. */
  center: Vec3;
  /** Full X/Y/Z extents in the collider's local axes, metres. */
  size: Vec3;
  /** Rotation around world Y, radians. */
  rotationY: number;
  enabled: boolean;
  source: 'original' | 'rebuilt' | 'thickened' | 'imported';
  /** Extra outward thickness already included in size/center. */
  inflation?: number;
  label?: string;
  /** Collision-only artifacts can be shown in red even when no mesh exists. */
  collisionOnly?: boolean;
}

export interface ScenePart {
  id: string;
  name?: string;
  position: Vec3;
  size: Vec3;
  color?: string;
  emissive?: string;
  opacity?: number;
}

export interface SimplificationInfo {
  method: 'manifold-hull-flatten' | 'manifold-union';
  replaces: string[];
  planeAxis?: 'x' | 'z';
  planeValue?: number;
  inflation: number;
  vertexCount?: number;
  manifoldVolume?: number;
  createdAtStep?: number;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: ObjectKind;
  selectable: boolean;
  deletable: boolean;
  interactive: boolean;
  outsideBelt: boolean;
  position: Vec3;
  rotationY: number;
  /** Procedural primary box size, full extents. */
  size?: Vec3;
  color?: string;
  emissive?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  parts?: ScenePart[];
  material?: MaterialSummary;
  assetId?: string;
  fileName?: string;
  nodeName?: string;
  colliders: BoxCollider[];
  deleted?: boolean;
  deletedAt?: string;
  deletedLabel?: string;
  hiddenBySimplify?: boolean;
  artCategory?: string;
  artNote?: string;
  grooveTag?: 'corner' | 'door-frame' | 'wall-reveal';
  flatten?: {
    axis: 'x' | 'z';
    /** Target flat surface coordinate on axis. */
    surface: number;
    spanAxis: 'x' | 'z';
    thickness: number;
    height: number;
  };
  simplification?: SimplificationInfo;
  locked?: boolean;
}

export interface RouteSpec {
  description: string;
  points: Vec2XZ[];
  beltWidth: number;
  probeRadius: number;
  probeHeight: number;
  probeVerticalRadius: number;
  clearWidthTarget: number;
}

export interface WidthSample {
  distance: number;
  point: Vec2XZ;
  tangent: Vec2XZ;
  normal: Vec2XZ;
  leftDistance: number;
  rightDistance: number;
  width: number;
  limitingObjectName?: string;
  limitingColliderId?: string;
}

export interface ProbeHit {
  segmentIndex: number;
  routeDistance: number;
  position: Vec3;
  closestPoint: Vec3;
  heightAboveFloor: number;
  colliderBottom: number;
  colliderTop: number;
  colliderId: string;
  objectId: string;
  objectName: string;
  source: BoxCollider['source'];
  message: string;
}

export interface ProbeReport {
  status: 'idle' | 'running' | 'pass' | 'blocked';
  progress: number;
  traveled: number;
  totalLength: number;
  hits: ProbeHit[];
  firstHit?: ProbeHit;
  passedAt?: string;
}

export interface WorkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface EditorState {
  revision: number;
  projectName: string;
  unit: 'metre';
  gridSize: number;
  snapDistance: number;
  collisionInflation: number;
  workBounds: WorkBounds;
  route: RouteSpec;
  objects: SceneObject[];
}

export interface HistoryEntry {
  label: string;
  at: string;
  state: EditorState;
}

export interface DeletedArtRecord {
  id: string;
  name: string;
  category: string;
  fileName?: string;
  nodeName?: string;
  materialName: string;
  dimensions: string;
  deletedAt: string;
  historyLabel: string;
}

export interface ExportHandoff {
  format: 'routeclear-level-handoff';
  version: 1;
  exportedAt: string;
  unit: 'metre';
  coordinateSystem: 'three-y-up';
  projectName: string;
  route: RouteSpec;
  workBounds: WorkBounds;
  collisionInflation: number;
  geometry: {
    glbFile: string;
    root: string;
    simplifiedObjectIds: string[];
  };
  colliders: Array<BoxCollider & { objectName: string; kind: ObjectKind }>;
  probe: {
    radius: number;
    height: number;
    verticalRadius: number;
    lastReport?: ProbeReport;
  };
  deletedArt: DeletedArtRecord[];
}
