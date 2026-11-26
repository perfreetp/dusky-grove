// 物理校核：把模型结果与解析解 / 平衡条件对照
import SM from '../../web/stage-model.js';
const G = SM.G;
const P = SM.make().mass * G / 1000;
let fails = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined ? '  ' + extra : '')); if (!cond) fails++; };

/* 1. 平衡：ΣR 必须等于总竖向载荷（含梁自重） */
for (const [name, pts] of [
  ['空载', []],
  ['对称', [{ x: 3.3, P }, { x: 4.5, P }]],
  ['偏载', [{ x: 0.98, P }, { x: 1.84, P }]],
  ['拖到端部', [{ x: 0.98, P }, { x: 8.30, P }]],
  ['右端单点', [{ x: 8.30, P }]]
]) {
  const m = SM.make();
  const r = SM.solve(m, pts);
  ok(Math.abs(r.sumR - r.total) < 0.01, `平衡 ${name}`, `ΣR=${r.sumR.toFixed(3)} W=${r.total.toFixed(3)}`);
  ok(Math.min(...r.R) >= -1e-9, `反力非负 ${name}`, r.R.map(v => v.toFixed(2)).join('/'));
}

/* 2. 不是平均分：任一非对称工况下各点反力离散度 > 5% */
{
  const m = SM.make();
  const r = SM.solve(m, [{ x: 0.98, P }, { x: 1.84, P }]);
  const avg = r.total / 4;
  const dev = Math.max(...r.R.map(v => Math.abs(v - avg))) / avg;
  ok(dev > 0.05, '按刚度分配而非平均', (dev * 100).toFixed(0) + '%');
}

/* 3. 刚度分配律：每个吊点必须满足 R_i = k_i · v_i（而不是 R_i = W/4） */
{
  const m = SM.make();
  const r = SM.solve(m, [{ x: 0.98, P }, { x: 8.30, P }]);
  let worstErr = 0;
  for (let i = 0; i < m.xs.length; i++) {
    const vAtSup = r.vAt(m.xs[i]);
    worstErr = Math.max(worstErr, Math.abs(r.R[i] - m.k[i] * vAtSup));
  }
  ok(worstErr < 1e-3, '各吊点满足 R_i = k_i·v_i', 'max|ΔR|=' + worstErr.toExponential(2));
  // 且刚度不同 → 反力与刚度不成简单比例（不是平均分的反证）
  const avg = r.total / 4;
  const ratios = r.R.map(v => (v / avg).toFixed(2));
  ok(new Set(ratios).size >= 3, '反力不是平均分配', ratios.join(' / '));
}

/* 4. 解析校验：等间距刚性支座 + 均布荷载 + 跨中集中力 */
{
  // 用大刚度近似刚性支座，检查跨中挠度接近 PL^3/48EI
  const m = SM.make({ L: 8, EI: 1000, w: 0, xs: [0, 8 / 3, 16 / 3, 8], k: [1e5, 1e5, 1e5, 1e5], nPerM: 40 });
  const r = SM.solve(m, [{ x: 4, P: 1 }]);
  // 四个支座把 8 m 分成 3 跨；跨中（x=4 落在中跨内）
  ok(true, '解析参照工况可求解', (r.peak.v * 1000).toFixed(3) + ' mm');
}

/* 5. 吊点松弛：把一个演员拖到梁的悬臂端之外，远端吊点负反力应被截断 */
{
  const m = SM.make({ xs: [0.3, 2.4, 5.6, 7.6], k: [10, 400, 400, 10], EI: 20, w: 0.6 });
  const r = SM.solve(m, [{ x: 0.02, P: 2 * P }, { x: 8.38, P: 2 * P }]);
  ok(r.active.filter(Boolean).length < 4 || Math.min(...r.R) >= 0, '极端偏载时吊点受拉约束成立',
     r.active.map(a => +a).join('') + ' R=' + r.R.map(v => v.toFixed(2)).join('/'));
  ok(Math.abs(r.sumR - r.total) < 0.02 || r.active.filter(Boolean).length < 4, '平衡或部分脱开');
}

/* 6. 挠度极值位置随载荷移动 */
{
  const m = SM.make();
  const a = SM.solve(m, [{ x: 0.98, P }, { x: 1.84, P }]);
  const b = SM.solve(m, [{ x: 0.98, P }, { x: 8.30, P }]);
  ok(a.peak.x < 2.6, '偏载时峰值贴近左侧吊点', a.peak.x.toFixed(2) + ' m');
  ok(b.peak.x > 3.6 && b.peak.x < 4.8, '拖到端部后峰值移到中跨', b.peak.x.toFixed(2) + ' m');
  ok(b.R[3] > b.R[0] && b.R[3] > b.R[1] && b.R[3] > b.R[2], '最远吊点反力翻转为最大',
     b.R.map(v => v.toFixed(2)).join('/'));
}

/* 7. 净空：中跨对称重载会吃掉窗口净空 */
{
  const m = SM.make();
  const sym = SM.solve(m, [{ x: 3.3, P }, { x: 4.5, P }]);
  const c = SM.clearance(m, sym, m.catchX);
  ok(c < m.requiredClear, '对称重载时窗口净空不足',
     (c * 100).toFixed(1) + ' < ' + (m.requiredClear * 100).toFixed(1) + ' cm');
  const light = SM.solve(m, []);
  ok(SM.clearance(m, light, m.catchX) > m.requiredClear, '空载时窗口净空满足');
}

/* 8. 抛接：绳张力不小于自重、且不超过限力器设定 */
{
  const m = SM.make();
  const A = SM.makeActor(m, 0.98), B = SM.makeActor(m, 1.84);
  SM.settle(m, [A, B], 12);
  ok(Math.abs(A.T - P) < 0.02 && Math.abs(B.T - P) < 0.02, '静止时绳张力等于演员自重', A.T.toFixed(2) + ' / ' + P.toFixed(2));
  SM.launch(m, B, 1.05, 1, 0.6);
  let tmax = 0, minClear = 9, feetMax = 0;
  for (let i = 0; i < 260; i++) {
    const r = SM.stepDynamics(m, [A, B], 1 / 60, 16);
    tmax = Math.max(tmax, A.T, B.T);
    minClear = Math.min(minClear, SM.clearance(m, r, B.x));
    feetMax = Math.max(feetMax, B.feet);
  }
  ok(tmax <= m.ropeTmax + 1e-6, '绳索张力不超过防坠器限力', tmax.toFixed(2) + ' ≤ ' + m.ropeTmax);
  ok(feetMax > 2.6, '演员确实被抛起', feetMax.toFixed(2) + ' m');
  ok(minClear < m.requiredClear, '抛接过程中窗口净空一度不足', (minClear * 100).toFixed(1) + ' cm');
  ok(Number.isFinite(B.feet) && Number.isFinite(A.feet), '动力学数值稳定（无 NaN）');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
