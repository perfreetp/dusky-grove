// 校核：简支解析解 + Maxwell–Betti 互等定理 + 对称性
import SM from '../../web/stage-model.js';
let fails = 0;
const ok = (c, m, e) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (e !== undefined ? '  ' + e : '')); if (!c) fails++; };

// 1. 简支梁跨中集中力：δ = PL³/48EI，反力各 P/2
{
  const L = 8, EI = 1000, P = 1;
  const m = SM.make({ L, EI, w: 0, xs: [0, L], k: [5e5, 5e5], nPerM: 64 });
  const r = SM.solve(m, [{ x: L / 2, P }]);
  const exact = (P * L ** 3) / (48 * EI);
  ok(Math.abs(r.vAt(L / 2) - exact) / exact < 0.03, '简支跨中 δ ≈ PL³/48EI',
     (r.vAt(L / 2) * 1000).toFixed(2) + ' vs ' + (exact * 1000).toFixed(2) + ' mm');
  ok(Math.abs(r.R[0] - P / 2) < 0.02 && Math.abs(r.R[1] - P / 2) < 0.02, '简支反力 = P/2',
     r.R.map(v => v.toFixed(3)).join('/'));
}

// 2. Maxwell–Betti 互等：同一线性体系下，两单位力作用点的位移互等
//    （用两端简支的静定体系，四个吊点全部受拉，体系不随工况改变）
{
  const m = SM.make({ L: 8, EI: 1000, w: 0, xs: [0, 8], k: [5e5, 5e5], nPerM: 32 });
  const a = SM.solve(m, [{ x: 2.2, P: 1 }]);
  const b = SM.solve(m, [{ x: 6.4, P: 1 }]);
  const dAB = a.vAt(6.4), dBA = b.vAt(2.2);
  ok(Math.abs(dAB - dBA) / Math.max(1e-12, Math.abs(dAB)) < 1e-6, 'Betti 互等定理',
     dAB.toExponential(4) + ' vs ' + dBA.toExponential(4));
}

// 3. 静定体系（两吊点）：反力必须满足静力平衡，与刚度无关（解析值）
{
  const m = SM.make({ L: 8, EI: 1000, w: 0, xs: [1, 7], k: [5e5, 5e5], nPerM: 32 });
  const r = SM.solve(m, [{ x: 3, P: 1 }]);
  // 竖向平衡：R1+R2=1；对 x=1 取矩：6·R2 = 1·(3−1)=2 → R2=1/3
  ok(Math.abs(r.R[1] - 1 / 3) < 0.01 && Math.abs(r.R[0] - 2 / 3) < 0.01,
     '静定梁反力 = 解析值 2/3、1/3', r.R.map(v => v.toFixed(3)).join('/'));
}

// 4. 连续梁的负反力是解析结果，吊点应据此松弛（不是数值假象）
//    刚性支座下 x=4 处集中力：反力 = −0.111 / 0.611 / 0.611 / −0.111（独立 FE 参考值）
{
  const m = SM.make({ L: 8, EI: 1000, w: 0, xs: [0, 2.4, 5.6, 8], k: [5e5, 5e5, 5e5, 5e5], nPerM: 32 });
  const r = SM.solve(m, [{ x: 4, P: 1 }]);
  ok(!r.active[0] && !r.active[3] && r.active[1] && r.active[2],
     '连续梁跨中荷载时两端吊点脱开、中间两点各 P/2',
     'act ' + r.active.map(a => +a).join('') + '  R=' + r.R.map(v => v.toFixed(3)).join('/'));
  ok(Math.abs(r.R[1] - 0.5) < 0.02 && Math.abs(r.R[2] - 0.5) < 0.02, '剩余两点各 P/2',
     r.R[1].toFixed(3) + ' / ' + r.R[2].toFixed(3));
}

// 5. 对称性：对称布置的吊点与荷载 → 对称的挠度曲线
{
  const m = SM.make({ L: 8, EI: 1000, w: 0.5, xs: [1, 3, 5, 7], k: [300, 300, 300, 300], nPerM: 32 });
  const r = SM.solve(m, [{ x: 3.2, P: 1 }, { x: 4.8, P: 1 }]);
  ok(Math.abs(r.vAt(2) - r.vAt(6)) < 1e-5 && Math.abs(r.vAt(1) - r.vAt(7)) < 1e-5, '对称工况挠度左右对称',
     r.vAt(2).toExponential(3) + ' vs ' + r.vAt(6).toExponential(3));
  ok(Math.abs(r.peak.x - 4) < 0.05, '对称工况峰值在跨中', r.peak.x.toFixed(2) + ' m');
}

// 4. 自重也按刚度分配，且不产生负反力
{
  const m = SM.make();
  const r = SM.solve(m, []);
  ok(Math.abs(r.sumR - r.total) < 1e-6 && Math.min(...r.R) >= 0, '自重单独作用：平衡且无负反力',
     r.R.map(v => v.toFixed(2)).join('/'));
}
console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
