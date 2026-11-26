/* stage-model.js — 小型高空舞台：一根钢梁 + 四个弹性吊点 + 两名悬挂演员
 *
 * 力学模型
 *   · 梁：Euler–Bernoulli 梁，2 节点/单元，Hermite 三次形函数，位移法
 *   · 吊点：竖向弹簧（只受拉），R_i = k_i · v_i
 *        四个吊点按各自刚度分配载荷，而非平均分配
 *   · 若某吊点反力为负，该点脱开（k=0），载荷重分配后迭代
 *   · 单位 m / kN / kN·m² / kN/m；向下挠度为正
 *
 * 无外部依赖，可在 Node 中单独测试。
 */
(function (global) {
  'use strict';
  var G = 9.81;

  function defaultConfig() {
    return {
      L: 8.40,
      xs: [0.50, 2.90, 6.30, 7.40],
      k:  [150, 30, 70, 800],      // 吊点竖向刚度 kN/m（刻意不等刚度）
      EI: 13,                      // 梁抗弯刚度 kN·m²
      w:  0.50,                    // 梁自重 + 附件线荷载 kN/m
      nPerM: 30,
      beamTop: 5.34,               // 梁顶标高（未变形）
      beamDepth: 0.28,
      deckTop: 2.00,               // 保护垫顶面标高
      matThick: 0.20,
      defLimit: 90,                // 挠度限值 mm
      mass: 78,                    // 演员质量 kg
      ropeLen: 1.20,               // 保险绳自然长度 m
      ropeK: 30,                   // 保险绳刚度 kN/m
      ropeDamp: 10.0,              // 保险绳阻尼 kN·s/m
      ropeTmax: 1.8,               // 绳索/缓冲器最大张力 kN（防坠器限力）
      headH: 1.66,                 // 演员身高 m
      safety: 0.10,                // 净空安全余量 m
      apex: 1.20,                  // 抛起时脚部上升高度 m
      catchX: 4.20,                // 抛接窗口中心
      kScale: 1.0
    };
  }

  function make(cfg) {
    var c = {};
    var d = defaultConfig();
    for (var kk in d) c[kk] = d[kk];
    if (cfg) for (var key in cfg) c[key] = cfg[key];
    var nSeg = Math.round(c.L * c.nPerM);
    c.nSeg = nSeg;
    c.nN = nSeg + 1;
    c.h = c.L / nSeg;
    c.nd = 2 * c.nN;
    c.supNodes = c.xs.map(function (x) { return Math.round(x / c.h); });
    c.underside0 = c.beamTop - c.beamDepth;
    c.matTop = c.deckTop;
    c.windowH = c.apex + c.headH;        // 抛接窗口净空需求（脚到头顶）
    c.requiredClear = c.windowH + c.safety;
    c.cache = Object.create(null);
    return c;
  }

  /* ---------- Hermite 形函数 ---------- */
  function hermite(m, x) {
    var h = m.h;
    var e = Math.min(m.nSeg - 1, Math.max(0, Math.floor(x / h)));
    var xi = (x - e * h) / h;
    if (xi < 0) xi = 0;
    if (xi > 1) xi = 1;
    return {
      e: e, xi: xi,
      N1: 1 - 3 * xi * xi + 2 * xi * xi * xi,
      N2: h * (xi - 2 * xi * xi + xi * xi * xi),
      N3: 3 * xi * xi - 2 * xi * xi * xi,
      N4: h * (-xi * xi + xi * xi * xi),
      d1: (-6 * xi + 6 * xi * xi) / h,
      d2: 1 - 4 * xi + 3 * xi * xi,
      d3: (6 * xi - 6 * xi * xi) / h,
      d4: -2 * xi + 3 * xi * xi
    };
  }

  /* ---------- 装配与带状 LU 分解（带宽 3） ---------- */
  function factorForKey(m, kNow) {
    var n = m.nd, bw = 3;
    var A = new Float64Array(n * n);
    var c = m.EI / (m.h * m.h * m.h), h = m.h;
    var ke = [
      [12 * c, 6 * c * h, -12 * c, 6 * c * h],
      [6 * c * h, 4 * c * h * h, -6 * c * h, 2 * c * h * h],
      [-12 * c, -6 * c * h, 12 * c, -6 * c * h],
      [6 * c * h, 2 * c * h * h, -6 * c * h, 4 * c * h * h]
    ];
    for (var e = 0; e < m.nSeg; e++) {
      var i = 2 * e;
      for (var a = 0; a < 4; a++) for (var b = 0; b < 4; b++)
        A[(i + a) * n + (i + b)] += ke[a][b];
    }
    for (var s = 0; s < m.supNodes.length; s++) {
      var sn = m.supNodes[s];
      A[(2 * sn) * n + 2 * sn] += Math.max(1e-9, kNow[s]);
    }
    for (var col = 0; col < n; col++) {
      var piv = A[col * n + col];
      if (Math.abs(piv) < 1e-12) piv = 1e-12;
      var im = Math.min(n - 1, col + bw);
      for (var r = col + 1; r <= im; r++) {
        var f = A[r * n + col] / piv;
        A[r * n + col] = f;
        for (var j = col + 1; j <= im; j++) A[r * n + j] -= f * A[col * n + j];
      }
    }
    return { A: A, n: n, bw: bw };
  }

  function solveFactor(F, rhs) {
    var A = F.A, n = F.n, bw = F.bw, i, j, s, t;
    var y = new Float64Array(n);
    for (i = 0; i < n; i++) {
      s = rhs[i];
      for (j = Math.max(0, i - bw); j < i; j++) s -= A[i * n + j] * y[j];
      y[i] = s;
    }
    var x = new Float64Array(n);
    for (i = n - 1; i >= 0; i--) {
      t = y[i];
      for (j = i + 1; j <= Math.min(n - 1, i + bw); j++) t -= A[i * n + j] * x[j];
      x[i] = t / A[i * n + i];
    }
    return x;
  }

  function loadVector(m, loads, wScale) {
    var f = new Float64Array(m.nd), i, e, q, p, N;
    var w = m.w * (wScale == null ? 1 : wScale);
    for (e = 0; e < m.nSeg; e++) {
      i = 2 * e;
      f[i] += w * m.h / 2;
      f[i + 1] += w * m.h * m.h / 12;
      f[i + 2] += w * m.h / 2;
      f[i + 3] += -w * m.h * m.h / 12;
    }
    for (q = 0; q < loads.length; q++) {
      p = loads[q];
      if (!p || !p.P) continue;
      N = hermite(m, Math.max(0, Math.min(m.L, p.x)));
      i = 2 * N.e;
      f[i] += p.P * N.N1;
      f[i + 1] += p.P * N.N2;
      f[i + 2] += p.P * N.N3;
      f[i + 3] += p.P * N.N4;
    }
    return f;
  }

  function vAt(m, u, x) {
    var N = hermite(m, Math.max(0, Math.min(m.L, x)));
    var i = 2 * N.e;
    return N.N1 * u[i] + N.N2 * u[i + 1] + N.N3 * u[i + 2] + N.N4 * u[i + 3];
  }
  function slopeAt(m, u, x) {
    var N = hermite(m, Math.max(0, Math.min(m.L, x)));
    var i = 2 * N.e;
    return N.d1 * u[i] + N.d2 * u[i + 1] + N.d3 * u[i + 2] + N.d4 * u[i + 3];
  }

  /* ---------- 静力求解（含吊点松弛迭代） ---------- */
  function solve(m, loads, opts) {
    opts = opts || {};
    var s, q;
    var kFull = m.k.map(function (k) { return Math.max(1e-9, k * (m.kScale || 1)); });
    var kNow = kFull.slice();
    var active = m.k.map(function () { return true; });
    var F = null, u = null, R = null, iter;
    for (iter = 0; iter < 14; iter++) {
      var key = (m.kScale || 1) + '|' + kNow.map(function (k) { return k > 0 ? 1 : 0; }).join('');
      F = m.cache[key];
      if (!F) { F = factorForKey(m, kNow); m.cache[key] = F; }
      u = solveFactor(F, loadVector(m, loads, opts.wScale));
      R = [];
      var nAct = 0;
      for (s = 0; s < m.supNodes.length; s++) {
        R.push(active[s] ? kNow[s] * u[2 * m.supNodes[s]] : 0);
        if (active[s]) nAct++;
      }
      var worst = -1, worstR = -1e-4;
      for (s = 0; s < R.length; s++) {
        if (active[s] && R[s] < worstR) { worstR = R[s]; worst = s; }
      }
      if (worst < 0 || nAct <= 1) break;
      active[worst] = false;
      kNow[worst] = 0;
    }
    var Rc = R.map(function (r, idx) { return active[idx] ? Math.max(0, r) : 0; });

    var ns = 220, samp = [];
    var peak = { v: -1e9, x: 0 }, minv = { v: 1e9, x: 0 };
    for (q = 0; q <= ns; q++) {
      var xx = m.L * q / ns, vv = vAt(m, u, xx);
      samp.push({ x: xx, v: vv });
      if (vv > peak.v) { peak.v = vv; peak.x = xx; }
      if (vv < minv.v) { minv.v = vv; minv.x = xx; }
    }
    var total = m.w * m.L + loads.reduce(function (a, p) { return a + (p ? p.P : 0); }, 0);
    var sumR = Rc.reduce(function (a, b) { return a + b; }, 0);
    var worstIdx = 0;
    for (s = 1; s < Rc.length; s++) if (Rc[s] > Rc[worstIdx]) worstIdx = s;
    // 最不利吊点（含刚度利用率：R_i / k_i 即该点位移，取最大）
    var critIdx = 0, crit = -1;
    for (s = 0; s < Rc.length; s++) {
      var util = Rc[s] / m.k[s];
      if (util > crit) { crit = util; critIdx = s; }
    }

    return {
      u: u, R: Rc, active: active, sumR: sumR, total: total,
      peak: peak, minv: minv, samples: samp, worst: worstIdx, critical: critIdx,
      kNow: kNow, loads: loads,
      vAt: function (x) { return vAt(m, u, x); },
      slopeAt: function (x) { return slopeAt(m, u, x); }
    };
  }

  function underside(m, r, x) { return m.underside0 - r.vAt(x); }
  function clearance(m, r, x) { return underside(m, r, x) - m.matTop; }

  /* ---------- 抛接动力学（准静态梁 + 绳索弹簧-阻尼） ---------- */
  function makeActor(m, x) {
    var a = { x: x, feet: 0, v: 0, vx: 0, T: 0, slack: false, thrown: false, landed: false };
    resetActor(m, { vAt: function () { return 0; } }, a);
    return a;
  }

  function resetActor(m, r, a) {
    var under = underside(m, r, a.x);
    a.feet = under - m.headH - m.ropeLen - (m.mass * G / 1000) / m.ropeK;
    a.v = 0; a.vx = 0;
    a.T = m.mass * G / 1000;
    a.slack = false; a.thrown = false; a.landed = false; a.caught = false;
    a.restFeet = a.feet;
  }

  // 抛起：竖直初速度；dir 为水平方向（-1 左 / +1 右）
  function launch(m, a, apex, dir, lateral) {
    a.v = Math.sqrt(2 * G * Math.max(0, apex));
    a.vx = dir * (lateral || 0);
    a.thrown = true;
    a.slack = true;
    a.landed = false;
  }

  // 一个子步：先按旧张力求梁，再按几何求张力（迭代 2 次）
  function substep(m, actors) {
    var s, r, T = new Array(actors.length);
    var loads = actors.map(function (a) { return { x: a.x, P: a.T || 0 }; });
    r = solve(m, loads);
    for (s = 0; s < actors.length; s++) {
      var a = actors[s];
      var under = underside(m, r, a.x);
      var hands = a.feet + m.headH;
      var stretch = (under - hands) - m.ropeLen;   // >0 绷紧
      var tv = 0;
      if (stretch > 0) {
        tv = m.ropeK * stretch - m.ropeDamp * a.v;
        if (tv > (m.ropeTmax || 1e9)) tv = m.ropeTmax;
        if (tv < 0) tv = 0;
      }
      T[s] = tv;
      loads[s] = { x: a.x, P: tv };
    }
    return { r: r, T: T };
  }

  // 让演员静止悬挂位与梁变形自洽（迭代收敛）
  function settle(m, actors, iters) {
    iters = iters || 12;
    var i, r = null;
    for (i = 0; i < iters; i++) {
      r = solve(m, actors.map(function (a) { return { x: a.x, P: a.T }; }));
      for (var s = 0; s < actors.length; s++) {
        var a = actors[s];
        var under = underside(m, r, a.x);
        a.feet = under - m.headH - m.ropeLen - (m.mass * G / 1000) / m.ropeK;
        a.T = m.mass * G / 1000;
        a.v = 0; a.vx = 0; a.slack = false; a.thrown = false;
        a.restFeet = a.feet; a.caught = false; a.landed = false;
      }
    }
    return r;
  }

  function stepDynamics(m, actors, dt, nSub) {
    nSub = nSub || 4;
    var h = dt / nSub, s, kk, r = null;
    for (kk = 0; kk < nSub; kk++) {
      var sub = substep(m, actors);
      r = sub.r;
      for (s = 0; s < actors.length; s++) {
        var a = actors[s];
        var Tv = sub.T[s];
        a.T = Tv;
        a.slack = Tv <= 1e-7;
        if (!a.slack) a.thrown = false;
        var acc = (Tv * 1000) / m.mass - G;
        a.v += acc * h;
        a.feet += a.v * h;
        if (a.feet <= m.deckTop) {
          a.feet = m.deckTop;
          if (a.v < 0) a.v = 0;
          a.landed = true;
        }
        if (a.vx) {
          a.x += a.vx * h;
          // 水平速度保持（抛接轨迹示意）
          if (a.x < 0.05) { a.x = 0.05; a.vx = 0; }
          if (a.x > m.L - 0.03) { a.x = m.L - 0.03; a.vx = 0; }
        }
      }
    }
    var loads = actors.map(function (a) { return { x: a.x, P: a.T || 0 }; });
    r = solve(m, loads);
    for (s = 0; s < actors.length; s++) {
      if (!r.active.length) break;
    }
    return r;
  }

  /* ---------- 辅助 ---------- */
  function reactionPct(r) {
    return r.R.map(function (v) { return r.total > 0 ? v / r.total * 100 : 0; });
  }

  var api = {
    G: G,
    defaultConfig: defaultConfig,
    make: make,
    solve: solve,
    vAt: vAt,
    slopeAt: slopeAt,
    underside: underside,
    clearance: clearance,
    makeActor: makeActor,
    resetActor: resetActor,
    launch: launch,
    settle: settle,
    stepDynamics: stepDynamics,
    reactionPct: reactionPct,
    hermite: hermite
  };
  global.StageModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
