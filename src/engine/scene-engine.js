/* ============================================================
 * PlayCanvas 场景引擎
 * 性能策略：
 *  - 辊子：单个 CylinderGeometry + 实例化（两段材质批次），数千辊子 1~2 个 draw call
 *  - 果实：单个 SphereGeometry + 实例化，检查动画每帧只改矩阵缓冲
 *  - 拾取：解析射线（rayCylinderZ / rayAABB），不为每个辊子建实体
 *  - 静态框架/料仓：实体数 = 段数/仓数，与辊子总数无关
 * ============================================================ */
import * as pc from 'playcanvas';
import { MM, rollerCount } from '../model.js';
import { rollerPose, frameBox, segEndPose, rayPlane, rayCylinderZ, rayAABB, snap, snapAny, clamp } from '../scene-geo.js';
import { safePitchRange } from '../check.js';

const DEG = Math.PI / 180;

export class SceneEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks; // onSelect, onSnapHint, onDragCommit...
    this.app = new pc.Application(canvas);
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.scene.ambientLight = new pc.Color(0.55, 0.58, 0.62);

    // ---------- 相机（自研轨道控制，左键拾取/拖拽，右键平移，滚轮缩放） ----------
    this.camera = new pc.Entity('cam');
    this.camera.addComponent('camera', { fov: 45, nearClip: 0.05, farClip: 200 });
    this.app.root.addChild(this.camera);
    this.orbit = { yaw: 35 * DEG, pitch: 32 * DEG, dist: 18, target: new pc.Vec3(8, 1, 0) };
    this._updateCamera();

    const dir = new pc.Entity('dir-light');
    dir.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.97, 0.9), intensity: 1.1 });
    dir.setEulerAngles(48, -38, 0);
    this.app.root.addChild(dir);
    const hemi = new pc.Entity('hemi');
    hemi.addComponent('light', { type: 'omni', color: new pc.Color(0.7, 0.8, 1), intensity: 0.55, range: 60 });
    hemi.setPosition(2, 14, 6);
    this.app.root.addChild(hemi);

    // ---------- 材质 ----------
    this.mats = {
      roller: new pc.StandardMaterial(),
      rollerSel: new pc.StandardMaterial(),
      frame: new pc.StandardMaterial(),
      frameSel: new pc.StandardMaterial(),
      silo: new pc.StandardMaterial(),
      siloSel: new pc.StandardMaterial(),
      opening: new pc.StandardMaterial(),
      openingSel: new pc.StandardMaterial(),
      ground: new pc.StandardMaterial(),
      wall: new pc.StandardMaterial(),
      fruit: new pc.StandardMaterial(),
      jam: new pc.StandardMaterial(),
      marker: new pc.StandardMaterial()
    };
    this.mats.roller.diffuse.set(0.36, 0.45, 0.55); this.mats.roller.update();
    this.mats.rollerSel.diffuse.set(0.95, 0.62, 0.15); this.mats.rollerSel.update();
    this.mats.frame.diffuse.set(0.32, 0.34, 0.38); this.mats.frame.update();
    this.mats.frameSel.diffuse.set(0.95, 0.62, 0.15); this.mats.frameSel.emissive.set(0.25, 0.14, 0.02); this.mats.frameSel.update();
    this.mats.silo.diffuse.set(0.42, 0.5, 0.46); this.mats.silo.update();
    this.mats.siloSel.diffuse.set(0.95, 0.62, 0.15); this.mats.siloSel.emissive.set(0.25, 0.14, 0.02); this.mats.siloSel.update();
    this.mats.opening.diffuse.set(0.2, 0.55, 0.85); this.mats.opening.update();
    this.mats.openingSel.diffuse.set(0.95, 0.62, 0.15); this.mats.openingSel.emissive.set(0.25, 0.14, 0.02); this.mats.openingSel.update();
    this.mats.ground.diffuse.set(0.82, 0.83, 0.85); this.mats.ground.update();
    this.mats.wall.diffuse.set(0.75, 0.3, 0.28); this.mats.wall.update();
    this.mats.fruit.diffuse.set(0.35, 0.72, 0.32); this.mats.fruit.update();
    this.mats.jam.diffuse.set(0.85, 0.12, 0.1); this.mats.jam.emissive.set(0.35, 0.03, 0.02); this.mats.jam.update();
    this.mats.marker.diffuse.set(0.9, 0.2, 0.15); this.mats.marker.emissive.set(0.4, 0.05, 0.03); this.mats.marker.update();

    // ---------- 共享几何 ----------
    this.geo = {
      roller: new pc.CylinderGeometry({ radius: 0.5, height: 1, capSegments: 12 }),
      fruit: new pc.SphereGeometry({ radius: 0.5, latitudeBands: 8, longitudeBands: 10 }),
      box: new pc.BoxGeometry(),
      cone: new pc.ConeGeometry({ baseRadius: 0.5, height: 1, capSegments: 16 })
    };
    this.rollerMesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, this.geo.roller);
    this.fruitMesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, this.geo.fruit);
    // 这两个 mesh 被实例化 MeshInstance 跨多次重建共享；实体 destroy 会按引用计数
    // 释放 mesh 的顶点/索引缓冲，这里手动持有引用，保证重建期间缓冲不被销毁
    this.rollerMesh.incRefCount();
    this.fruitMesh.incRefCount();

    // 辊轴默认沿 Y，旋转到沿 Z
    this.rollerAxisRot = new pc.Quat().setFromEulerAngles(90, 0, 0);

    // ---------- 场景节点容器 ----------
    this.staticRoot = new pc.Entity('static');
    this.app.root.addChild(this.staticRoot);
    this.rollerNode = new pc.Entity('rollers');
    this.app.root.addChild(this.rollerNode);
    this.fruitNode = new pc.Entity('fruits');
    this.app.root.addChild(this.fruitNode);
    this.markerRoot = new pc.Entity('markers');
    this.app.root.addChild(this.markerRoot);

    // 运行期数据
    this.project = null;
    this.selected = { kind: null, id: null };
    this.staticEntities = []; // {kind,id,entity,seg/silo}
    this.rollerInstances = null; // {miNormal, miSel, transforms[]}
    this.fruitInstances = null;
    this.animState = []; // 果实动画
    this.animActive = false;
    this.structSig = '';
    this.rollerSig = '';
    this.fruitSig = '';
    this.labels = [];
    this.jamLabels = [];
    this.groundEntity = null;

    this._bindInput();
    this.app.on('update', (dt) => this._tick(dt));
    this.app.on('resizecanvas', () => this._updateCamera());
    this.app.start();
  }

  /* ---------------- 相机轨道控制 ---------------- */
  _updateCamera() {
    const { yaw, pitch, dist, target } = this.orbit;
    const cp = Math.cos(pitch);
    const pos = new pc.Vec3(
      target.x + dist * cp * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * cp * Math.cos(yaw)
    );
    this.camera.setPosition(pos);
    this.camera.lookAt(target.x, target.y, target.z);
  }

  /* ---------------- 输入绑定 ---------------- */
  _bindInput() {
    const mouse = new pc.Mouse(this.canvas);
    this.mouse = mouse;
    this._drag = null; // 场景内拖拽状态
    this._pan = null;
    this._rotate = null; // 空白处左键旋转视角
    this._downHit = null;

    mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
      if (e.button === pc.MOUSEBUTTON_RIGHT) {
        this._pan = { x: e.x, y: e.y };
        this.canvas.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== pc.MOUSEBUTTON_LEFT) return;
      const hit = this._pick(e.x, e.y);
      this._downHit = hit;
      if (!hit) {
        this._rotate = { x: e.x, y: e.y };
        this.cb.onSelect?.(null);
        return;
      }
      this._beginSceneDrag(hit, e);
    });

    mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
      if (this._pan) {
        const dx = (e.x - this._pan.x) / this.canvas.clientWidth;
        const dy = (e.y - this._pan.y) / this.canvas.clientHeight;
        const right = this.camera.right.clone().mulScalar(-dx * this.orbit.dist * 1.4);
        const fwd = new pc.Vec3().cross(this.camera.up, this.camera.right).mulScalar(dy * this.orbit.dist * 1.4);
        this.orbit.target.add(right.add(fwd));
        this._pan = { x: e.x, y: e.y };
        this._updateCamera();
        return;
      }
      if (this._rotate && !this._drag) {
        const dx = e.x - this._rotate.x;
        const dy = e.y - this._rotate.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          this.orbit.yaw -= dx * 0.006;
          this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.006, 0.08, 1.45);
          this._rotate = { x: e.x, y: e.y };
          this._updateCamera();
        }
        return;
      }
      if (!this._drag) {
        // 悬停拾取节流：最多每 80ms 一次，避免几千辊子时频繁射线计算
        const now = performance.now();
        if (!this._hoverAt || now - this._hoverAt > 80) {
          this._hoverAt = now;
          const h = this._pick(e.x, e.y);
          this.canvas.style.cursor = h ? 'pointer' : 'default';
        }
        return;
      }
      this._updateSceneDrag(e);
    });

    mouse.on(pc.EVENT_MOUSEUP, (e) => {
      if (e.button === pc.MOUSEBUTTON_RIGHT) {
        this._pan = null;
        this.canvas.style.cursor = 'default';
        return;
      }
      if (e.button !== pc.MOUSEBUTTON_LEFT) return;
      if (this._drag) this._endSceneDrag();
      this._rotate = null;
      this._downHit = null;
    });

    mouse.on(pc.EVENT_MOUSEWHEEL, (e) => {
      const delta = e.wheelDelta > 0 ? 1 : e.wheelDelta < 0 ? -1 : 0;
      this.orbit.dist = clamp(this.orbit.dist * (1 - delta * 0.12), 2.5, 80);
      this._updateCamera();
    });
  }

  /** 屏幕坐标 -> 射线（m 域） */
  _screenRay(sx, sy) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const ndcX = (sx / w) * 2 - 1;
    const ndcY = 1 - (sy / h) * 2;
    const cam = this.camera.camera;
    const p0 = cam.screenToWorld(ndcX, ndcY, cam.nearClip);
    const p1 = cam.screenToWorld(ndcX, ndcY, cam.farClip);
    const dir = p1.sub(p0).normalize();
    const origin = this.camera.getPosition();
    return { origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z } };
  }

  /** 解析拾取：返回命中的可操作对象（先段级粗筛，再逐辊精算） */
  _pick(sx, sy) {
    if (!this.project) return null;
    const ray = this._screenRay(sx, sy);
    let best = null;
    const consider = (t, payload) => {
      if (t !== null && (!best || t < best.t)) best = { t, ...payload };
    };

    for (const seg of this.project.segments) {
      // 粗筛：段整体 AABB（含辊面、框架、落料口）
      const n0 = rollerPose(seg, 0);
      const n1 = rollerPose(seg, rollerCount(seg) - 1);
      const minX = Math.min(n0.x, n1.x) - seg.rollerDiameter;
      const maxX = Math.max(n0.x, n1.x) + seg.rollerDiameter;
      const minY = Math.min(n0.y, n1.y) - seg.rollerDiameter - 120;
      const maxY = Math.max(n0.y, n1.y) + seg.rollerDiameter;
      const hz = seg.beltWidth / 2 + 60;
      const coarse = rayAABB(
        ray.origin, ray.dir,
        { x: minX * MM, y: minY * MM, z: (seg.z - hz) * MM },
        { x: maxX * MM, y: maxY * MM, z: (seg.z + hz) * MM }
      );
      if (coarse === null) continue; // 射线不经过本段，跳过全部辊子

      const n = rollerCount(seg);
      const r = (seg.rollerDiameter / 2) * MM;
      const hzRoll = (seg.beltWidth / 2) * MM;
      for (let i = 0; i < n; i++) {
        const p = rollerPose(seg, i);
        const t = rayCylinderZ(
          ray.origin, ray.dir,
          { x: p.x * MM, y: p.y * MM, z: p.z * MM },
          r, hzRoll
        );
        if (t !== null) consider(t, { kind: 'roller', segmentId: seg.id, index: i });
      }
      // 段框架盒
      const fb = frameBox(seg);
      const t2 = rayAABB(
        ray.origin, ray.dir,
        { x: (fb.cx - fb.sx / 2) * MM, y: (fb.cy - fb.sy / 2) * MM, z: (fb.cz - fb.sz / 2) * MM },
        { x: (fb.cx + fb.sx / 2) * MM, y: (fb.cy + fb.sy / 2) * MM, z: (fb.cz + fb.sz / 2) * MM }
      );
      if (t2 !== null) consider(t2, { kind: 'frame', segmentId: seg.id });
      // 落料口
      const end = segEndPose(seg);
      const ow = seg.dropOpening.width;
      const t3 = rayAABB(
        ray.origin, ray.dir,
        { x: (end.x - 60) * MM, y: (end.y - seg.rollerDiameter) * MM, z: (end.z + seg.dropOpening.offsetZ - ow / 2) * MM },
        { x: (end.x + 60) * MM, y: end.y * MM, z: (end.z + seg.dropOpening.offsetZ + ow / 2) * MM }
      );
      if (t3 !== null) consider(t3, { kind: 'opening', segmentId: seg.id });
    }

    // 料仓
    for (const silo of this.project.silos) {
      const t = rayAABB(
        ray.origin, ray.dir,
        { x: (silo.x - silo.length / 2) * MM, y: 0, z: (silo.z - silo.width / 2) * MM },
        { x: (silo.x + silo.length / 2) * MM, y: (silo.height - silo.outletHeight) * MM, z: (silo.z + silo.width / 2) * MM }
      );
      if (t !== null) consider(t, { kind: 'silo', siloId: silo.id });
    }
    return best;
  }

  /* ---------------- 场景内拖拽（含吸附） ---------------- */
  _beginSceneDrag(hit, e) {
    const p = this.project;
    if (hit.kind === 'roller' || hit.kind === 'frame') {
      const seg = p.segments.find((s) => s.id === hit.segmentId);
      this.cb.onSelect?.({ kind: 'segment', id: seg.id });
      this._drag = {
        type: hit.kind === 'roller' ? 'pitch' : 'segment',
        segmentId: seg.id,
        startX: e.x, startY: e.y,
        origin: { ...seg },
        planeHit: this._groundPlaneHit(e)
      };
      this.cb.onDragStart?.(this._drag.type === 'pitch' ? '调整辊距' : '移动辊道段');
    } else if (hit.kind === 'opening') {
      const seg = p.segments.find((s) => s.id === hit.segmentId);
      this.cb.onSelect?.({ kind: 'segment', id: seg.id });
      this._drag = { type: 'opening', segmentId: seg.id, startX: e.x, origin: { ...seg.dropOpening }, planeHit: this._groundPlaneHit(e) };
      this.cb.onDragStart?.('挪动落料口');
    } else if (hit.kind === 'silo') {
      const silo = p.silos.find((s) => s.id === hit.siloId);
      this.cb.onSelect?.({ kind: 'silo', id: silo.id });
      this._drag = { type: 'silo', siloId: silo.id, startX: e.x, startY: e.y, origin: { ...silo }, planeHit: this._groundPlaneHit(e) };
      this.cb.onDragStart?.('移动料仓');
    }
  }

  _groundPlaneHit(e) {
    const ray = this._screenRay(e.x, e.y);
    const h = rayPlane(ray.origin, ray.dir, 0.001);
    return h ? { x: h.x / MM, z: h.z / MM } : null;
  }

  _updateSceneDrag(e) {
    const d = this._drag;
    const p = this.project;
    const ray = this._screenRay(e.x, e.y);
    const plane = rayPlane(ray.origin, ray.dir, 0.001);
    if (!plane) return;
    const worldX = plane.x / MM;
    const worldZ = plane.z / MM;
    const hint = [];

    if (d.type === 'pitch') {
      // 横向鼠标位移映射辊距：每像素 0.2mm，Shift 微调 0.05
      const step = (e.shiftKey ? 0.05 : 0.2);
      let pitch = d.origin.pitch + (e.x - d.startX) * step;
      const seg = p.segments.find((s) => s.id === d.segmentId);
      // 吸附：档位安全区间边界 + 厂商上下限 + 5mm 整数
      const gradeTargets = [];
      for (const g of p.grades) {
        const r = safePitchRange(g.nominal);
        gradeTargets.push(r.min, r.max);
      }
      const targets = [...new Set([...gradeTargets, seg.pitchMin, seg.pitchMax])];
      const s = snapAny(pitch, targets, 2.2);
      if (s.snapped) { pitch = s.value; hint.push(`已吸附 ${s.value} mm`); }
      pitch = clamp(Math.round(pitch), seg.pitchMin, seg.pitchMax);
      this.cb.onPatch?.((proj) => {
        const t = proj.segments.find((x) => x.id === d.segmentId);
        t.pitch = pitch;
      });
      hint.unshift(`辊距 ${pitch} mm（辊子 ${rollerCount(p.segments.find((s) => s.id === d.segmentId))} 个）`);
      this.cb.onSnapHint?.(hint.join('；'));
    } else if (d.type === 'segment' || d.type === 'silo') {
      const o = d.planeHit;
      let dx = worldX - o.x;
      let dz = worldZ - o.z;
      let nx = d.origin.x + dx;
      let nz = d.origin.z + dz;
      const site = p.site;

      if (d.type === 'segment') {
        const seg = p.segments.find((s) => s.id === d.segmentId);
        const len = d.origin.length;
        // 吸附目标：相邻段端点、车间边界、中心线 z=0
        const targetsX = [site.startX, site.endX - len, 0];
        for (const other of p.segments) {
          if (other.id === seg.id) continue;
          targetsX.push(other.x - len, other.x + other.length);
        }
        const sx = snapAny(nx, targetsX, 120);
        if (sx.snapped) { nx = sx.value; hint.push('X 向已吸附端点/边界'); }
        const sz = snap(nz, 0, 80);
        if (sz.snapped) { nz = 0; hint.push('已吸附输送中心线'); }
        nx = clamp(nx, site.startX, site.endX - len);
        this.cb.onPatch?.((proj) => {
          const t = proj.segments.find((x) => x.id === d.segmentId);
          t.x = Math.round(nx); t.z = Math.round(nz);
        });
        hint.unshift(`位置 X=${Math.round(nx)}, Z=${Math.round(nz)} mm`);
      } else {
        const silo = p.silos.find((s) => s.id === d.siloId);
        const targetsX = [0, ...p.segments.map((s) => s.x - silo.length / 2), ...p.segments.map((s) => s.x + s.length - silo.length / 2)];
        const sx = snapAny(nx, targetsX, 120);
        if (sx.snapped) { nx = sx.value; hint.push('X 向已吸附辊道端点'); }
        const sz = snap(nz, 0, 80);
        if (sz.snapped) { nz = 0; hint.push('已吸附输送中心线'); }
        this.cb.onPatch?.((proj) => {
          const t = proj.silos.find((x) => x.id === d.siloId);
          t.x = Math.round(nx); t.z = Math.round(nz);
        });
        hint.unshift(`料仓位置 X=${Math.round(nx)}, Z=${Math.round(nz)} mm`);
      }
      this.cb.onSnapHint?.(hint.join('；'));
    } else if (d.type === 'opening') {
      const seg = p.segments.find((s) => s.id === d.segmentId);
      // 落料口横向拖动（offsetZ），Shift+横向拖动改口宽
      let offZ = d.origin.offsetZ + (worldZ - (d.planeHit ? d.planeHit.z : 0));
      const so = snap(offZ, 0, 60);
      if (so.snapped) { offZ = 0; hint.push('已吸附段中心线'); }
      offZ = clamp(Math.round(offZ), -seg.beltWidth / 2 + 50, seg.beltWidth / 2 - 50);
      let width = d.origin.width;
      if (e.shiftKey) {
        width = clamp(Math.round(d.origin.width + (e.x - d.startX) * 0.5), 150, seg.beltWidth);
        hint.push(`Shift 拖宽：口宽 ${width} mm`);
      }
      this.cb.onPatch?.((proj) => {
        const t = proj.segments.find((x) => x.id === d.segmentId);
        t.dropOpening.offsetZ = offZ;
        t.dropOpening.width = width;
      });
      hint.unshift(`落料口偏移 Z=${offZ} mm，口宽 ${width} mm`);
      this.cb.onSnapHint?.(hint.join('；'));
    }
  }

  _endSceneDrag() {
    const d = this._drag;
    this._drag = null;
    const p = this.project;
    let summary = '';
    if (d.type === 'pitch') {
      const seg = p.segments.find((s) => s.id === d.segmentId);
      summary = `辊距已落值：${seg.pitch} mm（区间 ${seg.pitchMin}~${seg.pitchMax}）`;
    } else if (d.type === 'segment') {
      const seg = p.segments.find((s) => s.id === d.segmentId);
      summary = `段位置已落值：X=${seg.x}, Z=${seg.z} mm`;
    } else if (d.type === 'silo') {
      const silo = p.silos.find((s) => s.id === d.siloId);
      summary = `料仓位置已落值：X=${silo.x}, Z=${silo.z} mm`;
    } else if (d.type === 'opening') {
      const seg = p.segments.find((s) => s.id === d.segmentId);
      summary = `落料口已落值：偏移 Z=${seg.dropOpening.offsetZ}, 口宽 ${seg.dropOpening.width} mm`;
    }
    this.cb.onSnapHint?.(null);
    this.cb.onDragCommit?.(summary);
  }

  /** 从左侧设备库拖入：由 Solid 层把屏幕坐标转发进来 */
  handleExternalDrop(screenX, screenY, payload) {
    const ray = this._screenRay(screenX, screenY);
    const plane = rayPlane(ray.origin, ray.dir, 0.001);
    const x = plane ? Math.round(plane.x / MM) : 2000;
    const z = plane ? Math.round(plane.z / MM) : 0;
    this.cb.onExternalDrop?.({ x, z, payload });
  }

  /* ---------------- 数据同步（Solid store -> 场景） ---------------- */
  sync(project, selected) {
    this.project = project;
    this.selected = selected || { kind: null, id: null };
    if (!project) {
      this._clearAll();
      return;
    }
    this._syncGround(project);
    const sig = this._structSig(project);
    if (sig !== this.structSig) {
      this.structSig = sig;
      this._rebuildStatic(project);
    } else {
      this._refreshStaticSelection(project);
    }
    this._syncRollers(project);
    this._syncFruits(project);
  }

  _structSig(p) {
    return JSON.stringify({
      silos: p.silos.map((s) => [s.id, s.length, s.width, s.height, s.outletHeight, s.outletWidth, s.model]),
      segs: p.segments.map((s) => [s.id, s.length, s.beltWidth, s.rollerDiameter, s.model, s.dropOpening.width, s.maxInclineDeg])
    });
  }

  _clearAll() {
    for (const e of this.staticEntities) e.entity.destroy();
    this.staticEntities = [];
    this._destroyRollerInstances();
    this._destroyFruitInstances();
    if (this.groundEntity) { this.groundEntity.destroy(); this.groundEntity = null; }
    for (const l of this.labels) l.destroy();
    this.labels = [];
  }

  _syncGround(p) {
    const site = p.site;
    if (!this.groundEntity) {
      const e = new pc.Entity('ground');
      e.addComponent('render', { type: 'box' });
      this.app.root.addChild(e);
      this.groundEntity = e;
    }
    const L = (site.endX + 1000) * MM;
    const W = site.hallWidth * MM;
    this.groundEntity.setLocalScale(L, 0.02, W);
    this.groundEntity.setPosition(L / 2 - 500 * MM, -0.015, 0);
    this.groundEntity.render.material = this.mats.ground;
    // 车间端墙（硬边界）
    if (!this.wallEntity) {
      const w = new pc.Entity('wall');
      w.addComponent('render', { type: 'box' });
      this.app.root.addChild(w);
      this.wallEntity = w;
    }
    this.wallEntity.setLocalScale(0.15, 4, W);
    this.wallEntity.setPosition(site.endX * MM, 2, 0);
    this.wallEntity.render.material = this.mats.wall;
  }

  _rebuildStatic(project) {
    for (const e of this.staticEntities) e.entity.destroy();
    this.staticEntities = [];
    for (const l of this.labels) l.destroy();
    this.labels = [];

    for (const silo of project.silos) {
      const ent = new pc.Entity(`silo-${silo.id}`);
      // 仓体（上部箱）
      const bodyH = (silo.height - silo.outletHeight) * MM;
      const body = new pc.Entity('body');
      body.addComponent('render', { type: 'box' });
      body.setLocalScale(silo.length * MM, bodyH, silo.width * MM);
      body.setPosition(0, bodyH / 2, 0);
      ent.addChild(body);
      // 斗部（锥形出料斗）
      const cone = new pc.Entity('hopper');
      const coneMesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, this.geo.cone);
      cone.addComponent('render');
      cone.render.meshInstances = [new pc.MeshInstance(coneMesh, this.mats.silo)];
      const hopH = silo.outletHeight * MM;
      cone.setLocalScale(silo.length * MM * 0.9, hopH, silo.width * MM * 0.9);
      cone.setPosition(0, bodyH - hopH / 2, 0);
      cone.setLocalEulerAngles(180, 0, 0); // 尖朝下
      ent.addChild(cone);
      // 出料口短管
      const pipe = new pc.Entity('outlet');
      pipe.addComponent('render', { type: 'box' });
      pipe.setLocalScale(silo.outletWidth * MM, 0.25, silo.outletWidth * MM);
      pipe.setPosition(0, 0.125, 0);
      ent.addChild(pipe);
      // 支腿
      for (const [lx, lz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const leg = new pc.Entity('leg');
        leg.addComponent('render', { type: 'box' });
        leg.setLocalScale(0.08, bodyH, 0.08);
        leg.setPosition(lx * silo.length * 0.42 * MM, bodyH / 2, lz * silo.width * 0.42 * MM);
        ent.addChild(leg);
      }
      ent.setPosition(silo.x * MM, 0, silo.z * MM);
      this.staticRoot.addChild(ent);
      this.staticEntities.push({ kind: 'silo', id: silo.id, entity: ent, parts: [body, cone, pipe] });
      this._addLabel(`${silo.name}（出料口高 ${silo.outletHeight}）`, silo.x * MM, (silo.height + 250) * MM, silo.z * MM);
    }

    for (const seg of project.segments) {
      const ent = new pc.Entity(`seg-${seg.id}`);
      const fb = frameBox(seg);
      const frame = new pc.Entity('frame');
      frame.addComponent('render', { type: 'box' });
      frame.setLocalScale(fb.sx * MM, fb.sy * MM, fb.sz * MM);
      frame.setPosition(fb.cx * MM, fb.cy * MM, fb.cz * MM);
      frame.setLocalEulerAngles(0, 0, fb.angle / DEG);
      ent.addChild(frame);
      // 支腿（每 2m 一组）
      const nLegs = Math.max(2, Math.round(seg.length / 2000));
      for (let k = 0; k <= nLegs; k++) {
        const i = Math.round((k / nLegs) * (rollerCount(seg) - 1));
        const p = rollerPose(seg, i);
        const leg = new pc.Entity('leg');
        leg.addComponent('render', { type: 'box' });
        const topY = p.y - seg.rollerDiameter / 2 - 60;
        leg.setLocalScale(0.07, Math.max(0.1, topY * MM), 0.07);
        leg.setPosition(p.x * MM, (topY / 2) * MM, p.z - seg.beltWidth * 0.42 * MM);
        ent.addChild(leg);
        const leg2 = leg.clone();
        leg2.setPosition(p.x * MM, (topY / 2) * MM, p.z + seg.beltWidth * 0.42 * MM);
        ent.addChild(leg2);
      }
      // 落料口（蓝色漏斗口）
      const end = segEndPose(seg);
      const op = new pc.Entity('opening');
      op.addComponent('render', { type: 'box' });
      op.setLocalScale(0.12, 0.12, seg.dropOpening.width * MM);
      op.setPosition(end.x * MM, (end.y - seg.rollerDiameter * 0.8) * MM, (end.z + seg.dropOpening.offsetZ) * MM);
      ent.addChild(op);
      this.staticRoot.addChild(ent);
      this.staticEntities.push({ kind: 'segment', id: seg.id, entity: ent, frame, opening: op });
      this._addLabel(`${seg.name}｜辊距${seg.pitch}｜倾角${seg.inclineDeg}°`, (seg.x + seg.length / 2) * MM, (seg.baseHeight + 700) * MM, seg.z * MM);
    }
    this._refreshStaticSelection(project);
  }

  _refreshStaticSelection(project) {
    for (const item of this.staticEntities) {
      const selected = this.selected.id === item.id;
      if (item.kind === 'silo') {
        const mat = selected ? this.mats.siloSel : this.mats.silo;
        for (const part of item.parts) part.render.material = mat;
      } else {
        item.frame.render.material = selected ? this.mats.frameSel : this.mats.frame;
        item.opening.render.material = selected ? this.mats.openingSel : this.mats.opening;
      }
    }
  }

  /* ---------------- 辊子实例化 ---------------- */
  _syncRollers(project) {
    const sig = JSON.stringify(project.segments.map((s) => [
      s.id, s.pitch, s.length, s.rollerDiameter, s.beltWidth, s.inclineDeg, s.baseHeight, s.x, s.z,
      this.selected.kind === 'segment' && this.selected.id === s.id ? 1 : 0
    ]));
    if (sig === this.rollerSig && this.rollerInstances) return;
    this.rollerSig = sig;
    this._destroyRollerInstances();

    const normal = [];
    const selected = [];
    for (const seg of project.segments) {
      const n = rollerCount(seg);
      const isSel = this.selected.kind === 'segment' && this.selected.id === seg.id;
      const r = (seg.rollerDiameter / 2) * MM;
      const hz = (seg.beltWidth * 0.96) * MM;
      for (let i = 0; i < n; i++) {
        const p = rollerPose(seg, i);
        const m = new pc.Mat4();
        m.setTRS(
          new pc.Vec3(p.x * MM, p.y * MM, p.z * MM),
          this.rollerAxisRot,
          new pc.Vec3(r * 2, hz, r * 2)
        );
        (isSel ? selected : normal).push(m);
      }
    }
    const mk = (mats, list) => {
      if (!list.length) return null;
      const mi = new pc.MeshInstance(this.rollerMesh, mats);
      const vb = new pc.VertexBuffer(
        this.app.graphicsDevice,
        pc.VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice),
        list.length,
        { usage: pc.BUFFER_DYNAMIC }
      );
      mi.setInstancing(vb);
      this._writeMatrices(vb, list);
      const e = new pc.Entity();
      e.addComponent('render', { meshInstances: [mi] });
      this.rollerNode.addChild(e);
      return { mi, vb, entity: e, count: list.length };
    };
    this.rollerInstances = { normal: mk(this.mats.roller, normal), selected: mk(this.mats.rollerSel, selected) };
  }

  _writeMatrices(vb, matrices) {
    const data = new Float32Array(vb.getNumVertices() * 16);
    matrices.forEach((m, i) => { data.set(m.data, i * 16); });
    vb.setData(data);
  }

  _destroyRollerInstances() {
    if (!this.rollerInstances) return;
    for (const k of ['normal', 'selected']) {
      const r = this.rollerInstances[k];
      if (r) { r.entity.destroy(); r.vb.destroy(); }
    }
    this.rollerInstances = null;
  }

  /* ---------------- 果实实例化 + 通过性动画 ---------------- */
  _syncFruits(project) {
    const check = project.lastCheck;
    const sig = check ? check.id + ':' + check.items.length + ':' + check.totalFruit : 'none';
    if (sig === this.fruitSig && this.fruitInstances) return;
    this.fruitSig = sig;
    this._destroyFruitInstances();
    this.animState = [];
    this._clearMarkers();
    if (!check) return;

    // 组装每颗果实的动画路径（按检查逻辑的路径段）
    const segs = [...project.segments].sort((a, b) => a.x - b.x);
    const jamByKey = new Map();
    for (const it of check.items) {
      if (it.rollerA === null) continue;
      jamByKey.set(`${it.segmentId}|${it.gradeId}|${it.fruitId}`, it);
    }
    const openingJam = check.items.filter((it) => it.rollerA === null);

    const states = [];
    const batch = project.batchPerGrade || 20;
    for (const grade of project.grades) {
      let endIdx = segs.findIndex((s) => s.dropOpening.gradeId === grade.id);
      if (endIdx < 0) endIdx = segs.length - 1;
      const path = segs.slice(0, endIdx + 1);
      if (!path.length) continue;
      // 路径关键点（mm）
      const points = [];
      for (const seg of path) {
        const n = rollerCount(seg);
        for (let i = 0; i < n; i++) {
          const p = rollerPose(seg, i);
          points.push({ x: p.x, y: p.y + seg.rollerDiameter / 2 + grade.nominal / 2, z: seg.z });
        }
      }
      const totalLen = path.reduce((acc, s) => acc + s.length, 0);
      for (let f = 0; f < batch; f++) {
        // 找到该果实实际卡住的段（检查引擎按路径顺序，取首个）
        let jamItem = null;
        for (const s of path) {
          const it = jamByKey.get(`${s.id}|${grade.id}|${f}`);
          if (it) { jamItem = it; break; }
        }
        const opJam = openingJam.find((it) => it.gradeId === grade.id && it.fruitId === f);
        const stopX = jamItem ? jamItem.x : opJam ? opJam.x : null;
        states.push({
          grade, fruitId: f, points, totalLen,
          diameter: grade.nominal,
          stopX,
          jam: !!(jamItem || opJam),
          jamItem: jamItem || opJam,
          progress: -f * 0.04 - Math.random() * 0.05, // 错峰出发
          speed: 0.55 + (f % 5) * 0.03,
          done: false
        });
      }
    }
    this.animState = states;
    this.animActive = true;

    const n = states.length;
    const instFmt = pc.VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice);
    const mi = new pc.MeshInstance(this.fruitMesh, this.mats.fruit);
    const vb = new pc.VertexBuffer(this.app.graphicsDevice, instFmt, Math.max(n, 1), { usage: pc.BUFFER_DYNAMIC });
    mi.setInstancing(vb);
    // 每实例颜色：正常绿 / 卡果红 —— 用两个批次
    const greenEnt = new pc.Entity();
    greenEnt.addComponent('render', { meshInstances: [mi] });
    this.fruitNode.addChild(greenEnt);

    const miRed = new pc.MeshInstance(this.fruitMesh, this.mats.jam);
    const vbRed = new pc.VertexBuffer(this.app.graphicsDevice, instFmt, Math.max(n, 1), { usage: pc.BUFFER_DYNAMIC });
    miRed.setInstancing(vbRed);
    miRed.visible = false;
    const redEnt = new pc.Entity();
    redEnt.addComponent('render', { meshInstances: [miRed] });
    this.fruitNode.addChild(redEnt);

    this.fruitInstances = { vb, vbRed, mi, miRed, greenEnt, redEnt, n };
    this._buildJamMarkers(check, project);
  }

  /** 卡果位置红色定位柱 + 辊间编号标注 */
  _buildJamMarkers(check) {
    this._clearMarkers();
    for (const it of check.items) {
      const beam = new pc.Entity('jam-beam');
      beam.addComponent('render', { type: 'cylinder' });
      beam.setLocalScale(0.06, 2.4, 0.06);
      beam.setPosition(it.x * MM, 1.2, it.z * MM + 0.18);
      beam.render.material = this.mats.marker;
      this.markerRoot.addChild(beam);
      const label = it.rollerA
        ? `卡果｜${it.gradeName} Ø${it.diameter}｜辊 ${it.rollerA}↔${it.rollerB} 之间`
        : `卡果｜${it.gradeName} Ø${it.diameter}｜落料口`;
      const e = this._makeLabelEntity(label, true);
      e.setPosition(it.x * MM, 2.5, it.z * MM + 0.18);
      this.markerRoot.addChild(e);
      this.jamLabels.push(e);
    }
  }

  _clearMarkers() {
    this.markerRoot.destroy?.();
    this.jamLabels = [];
    this.markerRoot = new pc.Entity('markers');
    this.app.root.addChild(this.markerRoot);
  }

  _destroyFruitInstances() {
    if (!this.fruitInstances) return;
    const f = this.fruitInstances;
    f.greenEnt.destroy(); f.redEnt.destroy();
    f.vb.destroy(); f.vbRed.destroy();
    this.fruitInstances = null;
    this.animActive = false;
  }

  /* ---------------- 文字标签（canvas 贴图 + 面向相机） ---------------- */
  _makeLabelEntity(text, danger = false) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '28px "Microsoft YaHei", sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width + 28);
    canvas.width = w; canvas.height = 48;
    ctx.font = font;
    ctx.fillStyle = danger ? 'rgba(150,20,16,0.85)' : 'rgba(20,32,48,0.78)';
    ctx.beginPath();
    ctx.roundRect?.(0, 0, w, 48, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 14, 26);
    const tex = new pc.Texture(this.app.graphicsDevice, { width: w, height: 48 });
    tex.setSource(canvas);
    const mat = new pc.StandardMaterial();
    mat.emissiveMap = tex;
    mat.useLighting = false;
    mat.emissive = new pc.Color(1, 1, 1);
    mat.opacity = 0.95;
    mat.update();
    const e = new pc.Entity('label');
    const mesh = pc.Mesh.fromGeometry(
      this.app.graphicsDevice,
      new pc.PlaneGeometry({ halfExtents: new pc.Vec2(w / 48 * 0.32, 0.32) })
    );
    e.addComponent('render');
    e.render.meshInstances = [new pc.MeshInstance(mesh, mat)];
    return e;
  }

  _addLabel(text, x, y, z, danger = false) {
    const e = this._makeLabelEntity(text, danger);
    e.setPosition(x, y, z);
    this.app.root.addChild(e);
    this.labels.push(e);
  }

  /* ---------------- 帧循环：果实滚动 ---------------- */
  _tick(dt) {
    // 标签面向相机
    for (const l of this.labels) l.lookAt(this.camera.getPosition());

    if (!this.animActive || !this.fruitInstances) return;
    const d = this.fruitInstances;
    if (!this._animScratch || this._animScratch.n !== d.n) {
      this._animScratch = {
        n: d.n,
        greenData: new Float32Array(d.n * 16),
        redData: new Float32Array(d.n * 16),
        mat: new pc.Mat4(),
        pos: new pc.Vec3(),
        scl: new pc.Vec3()
      };
    }
    const sc = this._animScratch;
    // 清零：未使用的实例槽给零矩阵（退化不可见）
    sc.greenData.fill(0);
    sc.redData.fill(0);
    let greenCount = 0;
    let redCount = 0;
    let anyMoving = false;
    for (const st of this.animState) {
      if (!st.done) {
        // 全程约 9 秒走完，错峰出发由负 progress 体现
        st.progress += dt * st.speed / 9;
        if (st.progress >= 1) { st.progress = 1; st.done = true; }
        if (!st.done) anyMoving = true;
      }
      const t = Math.max(0, st.progress);
      const pos = this._samplePath(st.points, t);
      let x = pos.x;
      let y = pos.y;
      let z = pos.z;
      if (st.stopX !== null && pos.x >= st.stopX) {
        const p = st.points[this._locateIndex(st.points, st.stopX)];
        x = st.stopX; y = p.y; z = p.z;
        st.done = true;
      }
      const r = (st.diameter / 2) * MM;
      sc.mat.setTRS(
        sc.pos.set(x * MM, y * MM, z * MM),
        pc.Quat.IDENTITY,
        sc.scl.set(r * 2, r * 2, r * 2)
      );
      const isRed = st.jam && st.done;
      const target = isRed ? sc.redData : sc.greenData;
      const idx = isRed ? redCount++ : greenCount++;
      target.set(sc.mat.data, idx * 16);
    }
    d.vb.setData(sc.greenData);
    d.vbRed.setData(sc.redData);
    d.mi.visible = greenCount > 0;
    d.miRed.visible = redCount > 0;
    if (!anyMoving && this.animState.every((s) => s.done)) this.animActive = false;
  }

  _samplePath(points, t) {
    const segT = t * (points.length - 1);
    const i = Math.min(points.length - 2, Math.floor(segT));
    const f = segT - i;
    const a = points[i];
    const b = points[i + 1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
  }

  _locateIndex(points, x) {
    let lo = 0;
    for (let i = 0; i < points.length; i++) if (points[i].x <= x) lo = i;
    return lo;
  }

  focusView() {
    if (!this.project) return;
    const segs = this.project.segments;
    if (!segs.length) { this.orbit.target.set(4, 1, 0); this._updateCamera(); return; }
    const minX = Math.min(...segs.map((s) => s.x));
    const maxX = Math.max(...segs.map((s) => s.x + s.length));
    this.orbit.target.set(((minX + maxX) / 2) * MM, 1, 0);
    this.orbit.dist = clamp(((maxX - minX) * MM) * 0.9, 6, 40);
    this._updateCamera();
  }

  destroy() {
    this.app.destroy();
  }
}
