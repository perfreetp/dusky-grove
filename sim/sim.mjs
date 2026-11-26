// 与页面完全相同的布局求解 + AABB 干涉模型,用于标定预设参数
const T0 = 30, ALPHA = 0.15, G0 = 6, GMIN = 2, LF = 209.25;
const H = 90, D = 100, SG = 2.5, PT = 6, PH = 110, HST = 130;
const WSKEW = [1, 0.45, 0.2, 0.2, 0.45, 1];
const VMAX_END = 30000, VMAX_SIDE = 1500;
const TX = T0 * (1 + ALPHA) / 2, HY = H / 2, DZ = D / 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function layout(depths, F) {
  const ins = []; depths.forEach((d, i) => { if (d > 0.05) ins.push(i); });
  const g0 = Math.max(GMIN, G0 * (1 - 0.55 * F));
  const t = depths.map(d => T0 * (sstep(0.05, 0.6, d) + ALPHA * d));
  let delta = 0, g = g0;
  if (ins.length) {
    const W = ins.reduce((s, i) => s + t[i], 0) + (ins.length - 1) * g;
    const E = W - LF;
    if (E > 0) {
      const absorb = Math.min(E, (g - GMIN) * (ins.length - 1));
      g = g - absorb / (ins.length - 1);
      delta = (E - absorb) / 2 * (1.15 - 0.3 * F);
    }
    g = Math.max(GMIN * 0.7, g - 0.2 * delta); // 端板变形反挤间隙
  }
  const pos = new Array(6).fill(null);
  if (ins.length) {
    const Wtot = ins.reduce((s, i) => s + t[i], 0) + (ins.length - 1) * g;
    let cur = -Wtot / 2;
    ins.forEach(i => { pos[i] = cur + t[i] / 2; cur += t[i] + g; });
  }
  return { g, delta, pos };
}

function cellBox(i, x, d, delta) {
  const s = delta * WSKEW[i] * d;
  const rz = 0.012 * s * (i < 3 ? 1 : -1), ry = 0.010 * s * (i % 2 ? 1 : -1);
  const zc = 0.9 * s * (i % 2 ? 1 : -1);
  const cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const ex = TX * Math.abs(cy * cz) + HY * Math.abs(cy * sz) + DZ * Math.abs(sy);
  const ey = TX * Math.abs(sz) + HY * Math.abs(cz);
  const ez = TX * Math.abs(sy * cz) + HY * Math.abs(sy * sz) + DZ * Math.abs(cy);
  const yc = (1 - d) * HST + HY;
  return { x1: x - ex, x2: x + ex, y1: yc - ey, y2: yc + ey, z1: zc - ez, z2: zc + ez };
}

function plates(delta) {
  const o = 0.5 * delta;
  return [
    { name: '左端板', type: 'end', x1: -(LF/2+delta+PT+o), x2: -(LF/2+delta), y1: 0, y2: PH, z1: -(D/2+4), z2: D/2+4 },
    { name: '右端板', type: 'end', x1: LF/2+delta, x2: LF/2+delta+PT+o, y1: 0, y2: PH, z1: -(D/2+4), z2: D/2+4 },
    { name: '前侧板', type: 'side', x1: -(LF/2+delta+PT), x2: LF/2+delta+PT, y1: 0, y2: PH, z1: D/2+SG, z2: D/2+SG+PT },
    { name: '后侧板', type: 'side', x1: -(LF/2+delta+PT), x2: LF/2+delta+PT, y1: 0, y2: PH, z1: -(D/2+SG+PT), z2: -(D/2+SG) },
  ];
}
const inter = (a, b) => {
  const ox = Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1), oy = Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1), oz = Math.min(a.z2,b.z2)-Math.max(a.z1,b.z1);
  return (ox>0 && oy>0 && oz>0) ? ox*oy*oz : 0;
};

function check(depths, F, verbose = true) {
  const { g, delta, pos } = layout(depths, F);
  const pl = plates(delta);
  let maxR = 0, worst = '';
  depths.forEach((d, i) => {
    if (d <= 0.05 || pos[i] === null) return;
    const cb = cellBox(i, pos[i], d, delta);
    pl.forEach(p => {
      const v = inter(cb, p);
      if (v > 0) {
        const r = v / (p.type === 'end' ? VMAX_END : VMAX_SIDE);
        if (r > maxR) { maxR = r; worst = `C${i+1}<->${p.name} v=${v.toFixed(0)}`; }
      }
    });
  });
  if (verbose) console.log(`F=${F} d=[${depths.map(x=>x.toFixed(2)).join(',')}] g=${g.toFixed(2)} delta=${delta.toFixed(2)} maxR=${maxR.toFixed(3)} ${worst}`);
  return maxR;
}

console.log('--- A: 5颗全推入, 不同压紧力 (期望 maxR < 0.7) ---');
[0, 0.5, 1].forEach(F => check([1,1,1,1,1,0], F));
console.log('--- B: 第6颗逐渐推入, F=0.5 (期望在 0.55~0.8 之间首次超限) ---');
for (let d = 0.1; d <= 1.001; d += 0.05) check([1,1,1,1,1,Math.round(d*100)/100], 0.5);
console.log('--- C: 第6颗逐渐推入, F=1.0 (期望比 B 更晚超限) ---');
for (let d = 0.4; d <= 1.001; d += 0.1) check([1,1,1,1,1,Math.round(d*100)/100], 1.0);
console.log('--- D: 全部推满 F=0.5 (期望超限, 失败态) ---');
check([1,1,1,1,1,1], 0.5);
console.log('--- E: 单颗/少数几颗任意深度 (期望无干涉) ---');
check([0,0,0,0,0,1], 0.5); check([1,0,0,0,0,0], 0); check([1,1,0,0,0,0], 1);
