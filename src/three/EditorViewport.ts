import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  addRoutePoint,
  beginObjectMove,
  finishObjectMove,
  previewObjectMove,
  setSelectedIds,
  setUi,
  state,
  ui,
  cancelObjectMove,
} from '../state/editor';
import { pointAtDistance } from '../core/geometry';
import type { ProbeHit, RouteSpec, SceneObject, WidthSample } from '../core/types';
import { importedObject3Ds } from '../io/assetLibrary';
import { manifoldGeometries } from './manifoldService';

interface DragState {
  mode: 'box' | 'move';
  pointerId: number;
  startX: number;
  startY: number;
  objectId?: string;
  offsetX: number;
  offsetZ: number;
}

interface Spring {
  objectId: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  duration: number;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((child) => {
    const renderable = child as THREE.Mesh;
    if (renderable.geometry) renderable.geometry.dispose();
    const material = (renderable as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => disposeMaterial(m));
    else if (material) disposeMaterial(material);
  });
}

function disposeMaterial(material: THREE.Material) {
  const anyMat = material as THREE.MeshStandardMaterial;
  anyMat.map?.dispose();
  anyMat.normalMap?.dispose();
  anyMat.roughnessMap?.dispose();
  anyMat.metalnessMap?.dispose();
  material.dispose();
}

export function makeTextSprite(
  text: string,
  options: { background?: string; border?: string; color?: string; scale?: number; width?: number } = {},
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bg = options.background ?? 'rgba(8, 15, 28, 0.88)';
  const border = options.border ?? '#38bdf8';
  ctx.fillStyle = bg;
  roundRect(ctx, 12, 12, canvas.width - 24, canvas.height - 24, 28);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = border;
  ctx.stroke();

  const lines = text.split('\n');
  ctx.fillStyle = options.color ?? '#e0f2fe';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = lines.length > 1 ? 46 : 62;
  ctx.font = `700 ${fontSize}px "Microsoft YaHei", system-ui, sans-serif`;
  const lineHeight = fontSize * 1.12;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const width = options.width ?? Math.max(2.2, text.length * 0.23);
  const height = width * (canvas.height / canvas.width);
  sprite.scale.set(width * (options.scale ?? 1), height * (options.scale ?? 1), 1);
  sprite.renderOrder = 2000;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class EditorViewport {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();
  readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  readonly modelRoot = new THREE.Group();
  readonly colliderRoot = new THREE.Group();
  readonly routeRoot = new THREE.Group();
  readonly widthRoot = new THREE.Group();
  readonly selectionRoot = new THREE.Group();
  readonly markerRoot = new THREE.Group();

  private objectRoots = new Map<string, THREE.Object3D>();
  private colliderViews = new Map<string, THREE.Group>();
  private drag: DragState | null = null;
  private spring: Spring | null = null;
  private resizeObserver: ResizeObserver;
  private frameId = 0;
  private routeSignature = '';
  private probe: THREE.Group;
  private hitMarker: THREE.Group;
  private cameraTween: { from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; start: number } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color('#0b1220');
    this.scene.fog = new THREE.Fog('#0b1220', 24, 48);

    const width = container.clientWidth || 1200;
    const height = container.clientHeight || 800;
    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.05, 120);
    this.camera.position.set(6.8, 11.5, 15.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'three-canvas';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(6.2, 0, 4.2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 38;
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.update();

    const hemi = new THREE.HemisphereLight('#dbeafe', '#1e293b', 1.65);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(4, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -10;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 35;
    this.scene.add(sun);

    const grid = new THREE.GridHelper(30, 60, '#334155', '#1e293b');
    grid.position.set(7, 0.006, 4);
    grid.name = 'snap-grid';
    this.scene.add(grid);

    this.modelRoot.name = 'RouteClear_ExportRoot';
    this.scene.add(this.modelRoot, this.colliderRoot, this.routeRoot, this.widthRoot, this.selectionRoot, this.markerRoot);

    this.probe = this.createProbe();
    this.scene.add(this.probe);
    this.hitMarker = new THREE.Group();
    this.hitMarker.visible = false;
    this.scene.add(this.hitMarker);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown, true);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.animate();
    this.sync(state, ui.selectedIds);
  }

  private createProbe(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.MeshStandardMaterial({
        color: '#facc15',
        emissive: '#854d0e',
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.82,
      }),
    );
    body.name = 'probe-sphere';
    body.castShadow = true;
    group.add(body);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#fde047', side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthTest: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.78;
    ring.name = 'probe-ring';
    group.add(ring);
    group.visible = false;
    return group;
  }

  private onContextMenu = (event: Event) => event.preventDefault();

  private setPointerFromEvent(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return { rect, x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private groundPoint(event: PointerEvent): THREE.Vector3 | null {
    this.setPointerFromEvent(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, point) ? point : null;
  }

  private findObjectId(object: THREE.Object3D | null): string | undefined {
    let current: THREE.Object3D | null = object;
    while (current && current !== this.scene) {
      if (current.userData?.objectId) return current.userData.objectId as string;
      current = current.parent;
    }
    return undefined;
  }

  private pickObject(event: PointerEvent): string | undefined {
    this.setPointerFromEvent(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.modelRoot.children, true);
    for (const hit of hits) {
      const id = this.findObjectId(hit.object);
      if (id) return id;
    }
    return undefined;
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const local = this.setPointerFromEvent(event);
    this.controls.enabled = false;

    if (ui.tool === 'route') {
      const p = this.groundPoint(event);
      if (p) addRoutePoint([Number(p.x.toFixed(2)), Number(p.z.toFixed(2))]);
      this.controls.enabled = true;
      return;
    }

    const hitId = ui.tool === 'select' ? this.pickObject(event) : undefined;
    if (hitId && ui.tool === 'select') {
      const obj = state.objects.find((o) => o.id === hitId);
      if (event.shiftKey) {
        setSelectedIds(ui.selectedIds.includes(hitId) ? ui.selectedIds.filter((id) => id !== hitId) : [...ui.selectedIds, hitId]);
      } else if (!ui.selectedIds.includes(hitId)) {
        setSelectedIds([hitId]);
      }

      if (obj?.kind === 'simplified' || obj?.simplification) {
        const p = this.groundPoint(event);
        if (p && beginObjectMove(hitId)) {
          this.drag = {
            mode: 'move',
            pointerId: event.pointerId,
            startX: local.x,
            startY: local.y,
            objectId: hitId,
            offsetX: p.x - obj.position[0],
            offsetZ: p.z - obj.position[2],
          };
          this.renderer.domElement.setPointerCapture(event.pointerId);
          this.renderer.domElement.style.cursor = 'grabbing';
          return;
        }
      }
    }

    this.drag = {
      mode: 'box',
      pointerId: event.pointerId,
      startX: local.x,
      startY: local.y,
      offsetX: 0,
      offsetZ: 0,
    };
    setUi('rubberRect', { x0: local.x, y0: local.y, x1: local.x, y1: local.y });
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const local = this.setPointerFromEvent(event);

    if (this.drag.mode === 'box') {
      const rect = {
        x0: this.drag.startX,
        y0: this.drag.startY,
        x1: local.x,
        y1: local.y,
      };
      setUi('rubberRect', rect);
      const ids = this.selectObjectsInScreenRect(rect);
      setSelectedIds(ids);
      return;
    }

    if (this.drag.mode === 'move' && this.drag.objectId) {
      const p = this.groundPoint(event);
      if (!p) return;
      const raw: [number, number, number] = [
        Number((p.x - this.drag.offsetX).toFixed(3)),
        0,
        Number((p.z - this.drag.offsetZ).toFixed(3)),
      ];
      previewObjectMove(this.drag.objectId, raw);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      this.controls.enabled = true;
      return;
    }

    if (this.drag.mode === 'box') {
      setUi('rubberRect', null);
    } else if (this.drag.mode === 'move' && this.drag.objectId) {
      const id = this.drag.objectId;
      const root = this.objectRoots.get(id);
      const from = root?.position.clone() ?? new THREE.Vector3();
      const result = finishObjectMove(id);
      if (result.bounced && root) {
        const obj = state.objects.find((o) => o.id === id);
        if (obj) {
          this.spring = {
            objectId: id,
            from,
            to: new THREE.Vector3(obj.position[0], obj.position[1], obj.position[2]),
            start: performance.now(),
            duration: 360,
          };
        }
      }
      this.renderer.domElement.style.cursor = '';
    }

    try {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer may already be released by the browser.
    }
    this.drag = null;
    this.controls.enabled = true;
  };

  private onPointerCancel = (event: PointerEvent) => {
    if (this.drag?.mode === 'move' && this.drag.objectId) cancelObjectMove();
    setUi('rubberRect', null);
    try {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    this.drag = null;
    this.controls.enabled = true;
  };

  selectObjectsInScreenRect(rect: { x0: number; y0: number; x1: number; y1: number }): string[] {
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(rect.x0, rect.x1);
    const maxX = Math.max(rect.x0, rect.x1);
    const minY = Math.min(rect.y0, rect.y1);
    const maxY = Math.max(rect.y0, rect.y1);
    const ids: string[] = [];
    const box = new THREE.Box3();

    for (const obj of state.objects) {
      if (obj.deleted || obj.hiddenBySimplify || !obj.selectable) continue;
      const root = this.objectRoots.get(obj.id);
      if (!root?.parent) continue;
      box.setFromObject(root);
      if (box.isEmpty()) continue;

      let sxMin = Infinity;
      let sxMax = -Infinity;
      let syMin = Infinity;
      let syMax = -Infinity;
      const corner = new THREE.Vector3();
      for (let x = 0; x < 2; x++) {
        for (let y = 0; y < 2; y++) {
          for (let z = 0; z < 2; z++) {
            corner.set(
              x ? box.max.x : box.min.x,
              y ? box.max.y : box.min.y,
              z ? box.max.z : box.min.z,
            ).project(this.camera);
            const sx = ((corner.x + 1) / 2) * canvasRect.width;
            const sy = ((-corner.y + 1) / 2) * canvasRect.height;
            sxMin = Math.min(sxMin, sx);
            sxMax = Math.max(sxMax, sx);
            syMin = Math.min(syMin, sy);
            syMax = Math.max(syMax, sy);
          }
        }
      }

      if (sxMax >= minX && sxMin <= maxX && syMax >= minY && syMin <= maxY) ids.push(obj.id);
    }
    return ids;
  }

  sync(editorState: typeof state, selectedIds: string[]) {
    this.syncObjects(editorState.objects);
    this.syncColliders(editorState.objects);
    this.syncSelection(selectedIds);
    this.syncRoute(editorState.route, ui.showBelt);
    const grid = this.scene.getObjectByName('snap-grid');
    if (grid) grid.visible = ui.showGrid;
  }

  private createObjectRoot(obj: SceneObject): THREE.Object3D {
    const imported = obj.assetId ? importedObject3Ds.get(obj.assetId) : undefined;
    if (imported) {
      imported.userData.objectId = obj.id;
      return imported;
    }

    const manifoldGeometry = manifoldGeometries.get(obj.id);
    const group = new THREE.Group();
    group.userData.objectId = obj.id;

    if (obj.parts?.length) {
      for (const part of obj.parts) {
        const geometry = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
        const material = new THREE.MeshStandardMaterial({
          color: part.color ?? obj.color ?? '#94a3b8',
          roughness: obj.roughness ?? 0.8,
          metalness: obj.metalness ?? 0.05,
          transparent: (part.opacity ?? 1) < 1,
          opacity: part.opacity ?? 1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...part.position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.objectId = obj.id;
        group.add(mesh);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.28 }),
        );
        edges.position.copy(mesh.position);
        group.add(edges);
      }
    } else if (obj.size) {
      const geometry = manifoldGeometry ?? new THREE.BoxGeometry(obj.size[0], obj.size[1], obj.size[2]);
      const material = new THREE.MeshStandardMaterial({
        color: obj.color ?? '#94a3b8',
        roughness: obj.roughness ?? 0.82,
        metalness: obj.metalness ?? 0.05,
        transparent: (obj.opacity ?? 1) < 1,
        opacity: obj.opacity ?? 1,
        emissive: obj.emissive ? new THREE.Color(obj.emissive) : new THREE.Color('#000000'),
        emissiveIntensity: obj.emissive ? 0.55 : 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = obj.size[1] / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.objectId = obj.id;
      group.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: obj.kind === 'simplified' ? '#e0f2fe' : '#0f172a',
          transparent: true,
          opacity: obj.kind === 'simplified' ? 0.7 : 0.24,
        }),
      );
      edges.position.y = obj.size[1] / 2;
      group.add(edges);
    }

    return group;
  }

  private syncObjects(objects: SceneObject[]) {
    const stateIds = new Set(objects.map((o) => o.id));

    // Undo can remove a newly-created simplification/import record entirely.
    // Detach its root while retaining imported GPU resources for redo.
    for (const [id, root] of this.objectRoots) {
      if (!stateIds.has(id) && root.parent) root.parent.remove(root);
    }

    for (const obj of objects) {
      let root = this.objectRoots.get(obj.id);
      const inactive = obj.deleted || obj.hiddenBySimplify;
      if (inactive) {
        if (root?.parent) root.parent.remove(root);
        continue;
      }
      if (!root) {
        root = this.createObjectRoot(obj);
        this.objectRoots.set(obj.id, root);
      }
      if (!root.parent) this.modelRoot.add(root);

      if (this.spring?.objectId === obj.id) continue;
      root.position.set(obj.position[0], obj.position[1], obj.position[2]);
      root.rotation.set(0, obj.rotationY, 0);
      root.visible = true;
    }
  }

  private colliderColor(c: SceneObject['colliders'][number]): number {
    if (c.collisionOnly) return 0xef4444;
    if (c.source === 'thickened' || c.source === 'rebuilt') return 0x34d399;
    if (c.source === 'imported') return 0xa78bfa;
    return 0xf59e0b;
  }

  private syncColliders(objects: SceneObject[]) {
    const valid = new Set<string>();
    for (const obj of objects) {
      if (obj.deleted || obj.hiddenBySimplify) continue;
      for (const c of obj.colliders) {
        if (!c.enabled) continue;
        valid.add(c.id);
        let view = this.colliderViews.get(c.id);
        if (!view) {
          view = new THREE.Group();
          const fill = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({
              color: 0xf59e0b,
              transparent: true,
              opacity: 0.1,
              depthWrite: false,
            }),
          );
          fill.name = 'fill';
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
            new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false, transparent: true, opacity: 0.95 }),
          );
          edges.name = 'edges';
          edges.renderOrder = 998;
          fill.renderOrder = 997;
          view.add(fill, edges);
          this.colliderRoot.add(view);
          this.colliderViews.set(c.id, view);
        }
        const color = this.colliderColor(c);
        const fill = view.getObjectByName('fill') as THREE.Mesh;
        const edges = view.getObjectByName('edges') as THREE.LineSegments;
        (fill.material as THREE.MeshBasicMaterial).color.setHex(color);
        (edges.material as THREE.LineBasicMaterial).color.setHex(color);
        (fill.material as THREE.MeshBasicMaterial).opacity = c.collisionOnly ? 0.2 : c.source === 'thickened' ? 0.16 : 0.08;
        view.position.set(c.center[0], c.center[1], c.center[2]);
        view.rotation.set(0, c.rotationY, 0);
        view.scale.set(c.size[0], c.size[1], c.size[2]);
        view.visible = ui.showColliders;
      }
    }

    for (const [id, view] of this.colliderViews) {
      if (!valid.has(id)) {
        this.colliderRoot.remove(view);
        disposeTree(view);
        this.colliderViews.delete(id);
      }
    }
  }

  private syncSelection(selectedIds: string[]) {
    disposeTree(this.selectionRoot);
    this.selectionRoot.clear();
    for (const id of selectedIds) {
      const root = this.objectRoots.get(id);
      if (!root?.parent) continue;
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) continue;
      const helper = new THREE.Box3Helper(box, new THREE.Color('#22d3ee'));
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      helper.renderOrder = 1200;
      this.selectionRoot.add(helper);
    }
  }

  private syncRoute(route: RouteSpec, showBelt: boolean) {
    const signature = JSON.stringify({ p: route.points, w: route.beltWidth, showBelt });
    if (signature === this.routeSignature) return;
    this.routeSignature = signature;
    disposeTree(this.routeRoot);
    this.routeRoot.clear();

    const y = 0.035;
    const half = route.beltWidth / 2;

    if (showBelt) {
      const positions: number[] = [];
      const indices: number[] = [];
      let vertexBase = 0;
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i];
        const b = route.points[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const verts: Array<[number, number, number]> = [
          [a[0] + nx * half, y, a[1] + nz * half],
          [a[0] - nx * half, y, a[1] - nz * half],
          [b[0] + nx * half, y, b[1] + nz * half],
          [b[0] - nx * half, y, b[1] - nz * half],
        ];
        for (const v of verts) positions.push(...v);
        indices.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase + 2, vertexBase + 1, vertexBase + 3);
        vertexBase += 4;

        const edgeGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a[0] + nx * half, y + 0.015, a[1] + nz * half),
          new THREE.Vector3(b[0] + nx * half, y + 0.015, b[1] + nz * half),
          new THREE.Vector3(a[0] - nx * half, y + 0.015, a[1] - nz * half),
          new THREE.Vector3(b[0] - nx * half, y + 0.015, b[1] - nz * half),
        ]);
        const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.8 }));
        this.routeRoot.add(edges);
      }
      const ribbonGeometry = new THREE.BufferGeometry();
      ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      ribbonGeometry.setIndex(indices);
      ribbonGeometry.computeVertexNormals();
      const ribbon = new THREE.Mesh(
        ribbonGeometry,
        new THREE.MeshBasicMaterial({ color: '#06b6d4', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.routeRoot.add(ribbon);
    }

    const linePoints = route.points.map(([x, z]) => new THREE.Vector3(x, y + 0.035, z));
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineDashedMaterial({ color: '#a5f3fc', dashSize: 0.28, gapSize: 0.18, linewidth: 2 }),
    );
    line.computeLineDistances();
    this.routeRoot.add(line);

    route.points.forEach(([x, z], index) => {
      const isCorner = index > 0 && index < route.points.length - 1;
      const isSeventh = index === 7;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(isSeventh ? 0.18 : 0.11, 20, 12),
        new THREE.MeshBasicMaterial({ color: isSeventh ? '#f97316' : isCorner ? '#67e8f9' : '#a7f3d0' }),
      );
      dot.position.set(x, 0.16, z);
      this.routeRoot.add(dot);

      const label =
        index === 0 ? '起点' : index === route.points.length - 1 ? '电梯/终点' : `拐角 ${index}`;
      const sprite = makeTextSprite(label, {
        border: isSeventh ? '#fb923c' : '#22d3ee',
        background: isSeventh ? 'rgba(124,45,18,.9)' : 'rgba(8,47,73,.88)',
        width: isCorner ? 1.45 : 1.7,
      });
      sprite.position.set(x, isSeventh ? 0.72 : 0.52, z);
      this.routeRoot.add(sprite);
    });
  }

  renderWidthGuides(samples: WidthSample[]) {
    disposeTree(this.widthRoot);
    this.widthRoot.clear();
    if (!ui.showWidth || samples.length < 2) return;

    const positions: number[] = [];
    let min: WidthSample | undefined;
    for (const sample of samples) {
      if (!min || sample.width < min.width) min = sample;
      const everyMetre = Math.abs((sample.distance % 1) - 0.125) < 0.13 || sample.distance < 0.1;
      if (!everyMetre) continue;
      this.appendWidthLine(sample, positions, 0.09);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: '#a3e635', transparent: true, opacity: 0.55, depthTest: false }),
    );
    lines.renderOrder = 900;
    this.widthRoot.add(lines);

    if (min) {
      const minPositions: number[] = [];
      this.appendWidthLine(min, minPositions, 0.13);
      const minGeometry = new THREE.BufferGeometry();
      minGeometry.setAttribute('position', new THREE.Float32BufferAttribute(minPositions, 3));
      const minLine = new THREE.LineSegments(
        minGeometry,
        new THREE.LineBasicMaterial({ color: '#f43f5e', depthTest: false, linewidth: 3 }),
      );
      minLine.renderOrder = 1001;
      this.widthRoot.add(minLine);

      const mid: [number, number] = [
        min.point[0] + min.normal[0] * (min.leftDistance - min.rightDistance) / 2,
        min.point[1] + min.normal[1] * (min.leftDistance - min.rightDistance) / 2,
      ];
      const sprite = makeTextSprite(`最小净宽 ${min.width.toFixed(2)} m`, {
        border: '#fb7185',
        background: 'rgba(76,5,25,.9)',
        width: 2.7,
      });
      sprite.position.set(mid[0], 0.62, mid[1]);
      this.widthRoot.add(sprite);
    }
  }

  private appendWidthLine(sample: WidthSample, positions: number[], y: number) {
    const left: [number, number] = [
      sample.point[0] + sample.normal[0] * sample.leftDistance,
      sample.point[1] + sample.normal[1] * sample.leftDistance,
    ];
    const right: [number, number] = [
      sample.point[0] - sample.normal[0] * sample.rightDistance,
      sample.point[1] - sample.normal[1] * sample.rightDistance,
    ];
    positions.push(left[0], y, left[1], right[0], y, right[1]);
  }

  setProbeDistance(distance: number) {
    const at = pointAtDistance(state.route.points, distance);
    this.probe.visible = true;
    this.probe.position.set(at.point[0], state.route.probeHeight, at.point[1]);
    const sphere = this.probe.getObjectByName('probe-sphere') as THREE.Mesh;
    sphere.scale.setScalar(state.route.probeRadius);
    const ring = this.probe.getObjectByName('probe-ring') as THREE.Mesh;
    ring.scale.setScalar(state.route.probeRadius / 0.42);
  }

  hideProbe() {
    this.probe.visible = false;
  }

  showHitMarker(hit: ProbeHit) {
    disposeTree(this.hitMarker);
    this.hitMarker.clear();
    this.hitMarker.visible = true;

    const point = new THREE.Vector3(...hit.closestPoint);
    const pin = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: '#ef4444', depthTest: false }),
    );
    pin.position.copy(point);
    pin.renderOrder = 1500;
    this.hitMarker.add(pin);

    const poleGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(point.x, 0.02, point.z),
      new THREE.Vector3(point.x, hit.heightAboveFloor, point.z),
    ]);
    const pole = new THREE.Line(
      poleGeometry,
      new THREE.LineDashedMaterial({ color: '#fca5a5', dashSize: 0.12, gapSize: 0.08, depthTest: false }),
    );
    pole.computeLineDistances();
    pole.renderOrder = 1490;
    this.hitMarker.add(pole);

    const groundRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.34, 40),
      new THREE.MeshBasicMaterial({ color: '#ef4444', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.8 }),
    );
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.set(point.x, 0.06, point.z);
    this.hitMarker.add(groundRing);

    const label = makeTextSprite(`卡点 · 离地 ${hit.heightAboveFloor.toFixed(2)} m\n${hit.objectName}`, {
      border: '#ef4444',
      background: 'rgba(69,10,10,.92)',
      width: 3.4,
    });
    label.position.set(point.x, hit.heightAboveFloor + 0.55, point.z);
    this.hitMarker.add(label);
  }

  clearHitMarker() {
    this.hitMarker.visible = false;
    disposeTree(this.hitMarker);
    this.hitMarker.clear();
  }

  frameAll() {
    this.cameraTween = {
      from: this.camera.position.clone(),
      to: new THREE.Vector3(6.8, 11.5, 15.2),
      targetFrom: this.controls.target.clone(),
      targetTo: new THREE.Vector3(6.2, 0, 4.2),
      start: performance.now(),
    };
  }

  focusCorner7() {
    this.cameraTween = {
      from: this.camera.position.clone(),
      to: new THREE.Vector3(8.6, 5.4, 6.2),
      targetFrom: this.controls.target.clone(),
      targetTo: new THREE.Vector3(10.9, 1.0, 1.25),
      start: performance.now(),
    };
  }

  focusHit(hit: ProbeHit) {
    this.cameraTween = {
      from: this.camera.position.clone(),
      to: new THREE.Vector3(hit.position[0] - 2.8, 4.2, hit.position[2] + 4.1),
      targetFrom: this.controls.target.clone(),
      targetTo: new THREE.Vector3(hit.closestPoint[0], 0.9, hit.closestPoint[2]),
      start: performance.now(),
    };
  }

  private resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    const now = performance.now();

    if (this.cameraTween) {
      const t = Math.min(1, (now - this.cameraTween.start) / 650);
      const eased = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.cameraTween.from, this.cameraTween.to, eased);
      this.controls.target.lerpVectors(this.cameraTween.targetFrom, this.cameraTween.targetTo, eased);
      if (t >= 1) this.cameraTween = null;
    }

    if (this.spring) {
      const t = Math.min(1, (now - this.spring.start) / this.spring.duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const root = this.objectRoots.get(this.spring.objectId);
      if (root) root.position.lerpVectors(this.spring.from, this.spring.to, eased);
      if (t >= 1) {
        if (root) root.position.copy(this.spring.to);
        this.spring = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  getExportRoot(): THREE.Group {
    return this.modelRoot;
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    canvas.remove();
  }
}
