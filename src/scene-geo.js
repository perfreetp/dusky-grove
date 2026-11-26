/* ============================================================
 * 场景几何与拾取数学（mm 数据域 / m 渲染域转换都在这里）
 * ============================================================ */
import { MM } from './model.js';
import { rollerCount } from './model.js';

const DEG = Math.PI / 180;

/** 段上第 i 个辊子的世界位姿（mm 域），返回 {x,y,z}（辊轴沿 Z） */
export function rollerPose(seg, i) {
  const n = rollerCount(seg);
  const t = n === 1 ? 0 : i / (n - 1);
  const horiz = seg.length * Math.cos(seg.inclineDeg * DEG);
  const rise = seg.length * Math.sin(seg.inclineDeg * DEG);
  return {
    x: seg.x + horiz * t,
    y: seg.baseHeight + seg.rollerDiameter / 2 + rise * t,
    z: seg.z
  };
}

/** 段末端（下游端）中心 */
export function segEndPose(seg) {
  const p = rollerPose(seg, rollerCount(seg) - 1);
  return p;
}

/** 段框架（主梁）盒体中心与尺寸（mm） */
export function frameBox(seg) {
  const a = rollerPose(seg, 0);
  const b = rollerPose(seg, rollerCount(seg) - 1);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 - seg.rollerDiameter / 2 - 60;
  const cz = seg.z;
  const horiz = seg.length * Math.cos(seg.inclineDeg * DEG);
  const rise = seg.length * Math.sin(seg.inclineDeg * DEG);
  const axisLen = Math.hypot(horiz, rise);
  return {
    cx,
    cy,
    cz,
    sx: axisLen,
    sy: 120,
    sz: seg.beltWidth + 80,
    angle: -seg.inclineDeg * DEG // 绕 Z 旋转
  };
}

/** mm 三元组 -> m 三元组 */
export function toM(v) {
  return v * MM;
}

/** 射线（origin/dir，m 域，Vec3 形态的纯对象）与水平平面 y=const 求交 */
export function rayPlane(origin, dir, planeY) {
  if (Math.abs(dir.y) < 1e-8) return null;
  const t = (planeY - origin.y) / dir.y;
  if (t < 0) return null;
  return { x: origin.x + dir.x * t, y: planeY, z: origin.z + dir.z * t, t };
}

/**
 * 射线 vs 有限圆柱（轴沿 Z，m 域输入）
 * 圆柱中心 c，半径 r，半长 hz；返回命中 t 或 null
 */
export function rayCylinderZ(origin, dir, c, r, hz) {
  const ox = origin.x - c.x;
  const oy = origin.y - c.y;
  const a = dir.x * dir.x + dir.y * dir.y;
  const b = 2 * (ox * dir.x + oy * dir.y);
  const cc = ox * ox + oy * oy - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0 || a < 1e-9) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const z = origin.z + dir.z * t - c.z;
    if (Math.abs(z) <= hz) return t;
  }
  return null;
}

/** 射线 vs 轴对齐盒（m 域），slab 法，返回最近正 t 或 null */
export function rayAABB(origin, dir, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(dir[ax]) < 1e-9) {
      if (origin[ax] < min[ax] || origin[ax] > max[ax]) return null;
    } else {
      let t1 = (min[ax] - origin[ax]) / dir[ax];
      let t2 = (max[ax] - origin[ax]) / dir[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? tmax : null;
}

/** 吸附：把 value 吸到 target（容差 tol），返回 {value, snapped} */
export function snap(value, target, tol) {
  if (Math.abs(value - target) <= tol) return { value: target, snapped: true };
  return { value, snapped: false };
}

/** 多候选吸附：取最近的命中目标 */
export function snapAny(value, targets, tol) {
  let best = null;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= tol && (!best || d < best.d)) best = { value: t, d, target: t };
  }
  return best ? { value: best.value, snapped: true, target: best.target } : { value, snapped: false };
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
