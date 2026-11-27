// Articulated fruiting-branch simulator.
// Planar (x = wind direction, y = up).
//
// Core model: the branch is an open kinematic chain of rigid rods. Each joint
// carries an absolute angle theta with angular velocity omega. Joint torques
// come from (a) gravity and wind on all downstream mass, (b) a rotational
// spring toward the rest *relative* angle with per-joint stiffness K (the
// segmented bending rigidity), (c) angular damping. Rod lengths are exact by
// forward kinematics. Twigs hang off host joints with their own springs.
//
// Fruits are pendulums on short ropes: their swing angle beta is driven by wind
// drag AND the measured acceleration of their anchor node, and rope tension is
// fed back as an equivalent joint torque, so branch and fruit are two-way
// coupled rather than solved independently.
//
// Near a preset critical wind Wcrit the joint stiffness collapses along a
// logistic curve (buckling), producing slow-then-sudden droop; past it the fruit
// ropes reach their hard swing limit and go taut.
'use strict';

const PI = Math.PI;
const wrapAngle = (a) => {
  while (a > PI) a -= 2 * PI;
  while (a < -PI) a += 2 * PI;
  return a;
};

function defaultConfig() {
  return {
    g: 9.81,
    rho: 1.225,
    N: 7,
    L: 0.5,
    base: [0, 1.6],
    nodeMass: 0.3,
    // per-joint rotational stiffness (N m / rad), base stiff -> tip soft
    K: [2560, 2280, 2000, 1720, 1440, 1200, 960],
    angDamp: 14,        // angular damping coefficient (N m s / rad)
    twigs: [
      { host: 2, L: 0.38, relDeg: -52, K: 720, damp: 6 },
      { host: 4, L: 0.34, relDeg: -55, K: 640, damp: 6 },
    ],
    fruits: [{ anchor: 'tip' }, { anchor: 'twig0' }, { anchor: 'twig1' }],
    fruitMass: 0.85,
    ropeLen: 0.46,
    betaMaxDeg: 55,
    fruitCdA: 0.05,
    pendDamp: 0.7,
    cdBranch: 1.15,
    dia0: 0.09,
    dia1: 0.04,
    h: 1 / 240,
    gustFrac: 0.16,
    groundY: 0.04,
    Wcrit: 14.5,
    soften: 0.08,        // residual stiffness fraction after buckling
    bucklingSharpness: 14,
  };
}

function createSim(cfg) {
  cfg = Object.assign(defaultConfig(), cfg || {});
  const N = cfg.N;

  // main chain: absolute rest angles, gentle arc rising then leveling
  const restTheta = [];
  for (let j = 0; j < N; j++) restTheta.push(((9 - j * 1.6) * PI) / 180);
  const theta = restTheta.slice();
  const omega = new Array(N).fill(0);

  // twigs: each has its own absolute angle state, attached at a host node
  const twigs = cfg.twigs.map((tw) => ({
    host: tw.host,
    L: tw.L,
    restTheta: restTheta[tw.host] + (tw.relDeg * PI) / 180,
    theta: restTheta[tw.host] + (tw.relDeg * PI) / 180,
    omega: 0,
    K: tw.K,
    damp: tw.damp,
    mass: 0.12,
  }));

  // node index bookkeeping: nodes 0..N are main chain (0 fixed),
  // twig tip nodes follow
  const twigNode = twigs.map((tw) => N + 1 + twigs.indexOf(tw));
  const anchorOf = (f) =>
    f.anchor === 'tip' ? N : f.anchor === 'twig0' ? twigNode[0] : twigNode[1];
  const fruits = cfg.fruits.map((f) => ({
    anchor: anchorOf(f),
    beta: 0,
    betaDot: 0,
    taut: false,
    tension: 0,
  }));

  // wind area per main node (tapered cylinder segment behind each node)
  const area = new Array(N + 1 + twigs.length).fill(0);
  for (let j = 1; j <= N; j++) {
    const t = j / N;
    area[j] = cfg.L * (cfg.dia1 + (cfg.dia0 - cfg.dia1) * (1 - t));
  }
  twigs.forEach((tw, i) => { area[twigNode[i]] = tw.L * 0.03; });

  const masses = new Array(N + 1 + twigs.length).fill(0);
  for (let j = 1; j <= N; j++) masses[j] = cfg.nodeMass;
  twigs.forEach((tw, i) => { masses[twigNode[i]] = tw.mass; });

  const sim = {
    cfg, N, theta, omega, restTheta, twigs, twigNode, fruits, area, masses,
    nodes: [], time: 0, wind: 0, acc: 0,
    prevAnchorVel: {}, anchorVel: {},
    restTip: null,
  };
  forwardKinematics(sim);
  return sim;
}

// forward kinematics: rebuild all node positions from angle state
function forwardKinematics(s) {
  const cfg = s.cfg;
  const nodes = [cfg.base.slice()];
  for (let j = 0; j < s.N; j++) {
    const p = nodes[j];
    nodes.push([p[0] + cfg.L * Math.cos(s.theta[j]), p[1] + cfg.L * Math.sin(s.theta[j])]);
  }
  s.twigs.forEach((tw, i) => {
    const hp = nodes[tw.host];
    nodes.push([hp[0] + tw.L * Math.cos(tw.theta), hp[1] + tw.L * Math.sin(tw.theta)]);
  });
  s.nodes = nodes;
  if (!s.restTip) s.restTip = nodes[s.N].slice();
  return nodes;
}

function subStep(s, windSpeed, gustOn) {
  const cfg = s.cfg, h = cfg.h, t = s.time;
  const N = s.N;

  let wv = windSpeed;
  if (gustOn && windSpeed > 1e-6) {
    const g = cfg.gustFrac * windSpeed;
    wv += g * (0.7 * Math.sin(1.7 * t) + 0.3 * Math.sin(4.3 * t + 1.3));
  }

  // remember anchor velocities from previous committed step for acceleration
  const prevAnchorVel = {};
  for (const k in s.anchorVel) prevAnchorVel[k] = s.anchorVel[k].slice();
  if (!s._prevNodes) s._prevNodes = s.nodes.map((p) => p.slice());

  const nodes = forwardKinematics(s);

  // ---------- buckling: stiffness collapse near critical wind ----------
  const load = wv / cfg.Wcrit;
  const logistic = 1 / (1 + Math.exp(-cfg.bucklingSharpness * (load - 1)));
  const degrade = (1 - (1 - cfg.soften) * Math.min(load, 1) * 0.3) *
                  (1 - (1 - cfg.soften) * logistic);

  // ---------- main chain joint torques ----------
  const I = cfg.nodeMass * cfg.L * cfg.L;
  // which fruit sits at each node (fruit mass counted once, at its anchor)
  const fruitAt = {};
  s.fruits.forEach((fr) => { fruitAt[fr.anchor] = (fruitAt[fr.anchor] || 0) + cfg.fruitMass; });
  for (let j = 0; j < N; j++) {
    let tau = 0;
    // gravity + wind on every downstream main node
    for (let q = j + 1; q <= N; q++) {
      const rx = nodes[q][0] - nodes[j][0];
      const ry = nodes[q][1] - nodes[j][1];
      const m = cfg.nodeMass + (fruitAt[q] || 0);
      tau += rx * (-m * cfg.g);
      const Fx = 0.5 * cfg.rho * cfg.cdBranch * s.area[q] * wv * wv;
      tau -= ry * Fx;
    }
    // twig loads transmitted at their host nodes (when downstream of joint j)
    s.twigs.forEach((tw, ti) => {
      if (tw.host >= j) {
        const id = s.twigNode[ti];
        const rx = nodes[id][0] - nodes[j][0];
        const ry = nodes[id][1] - nodes[j][1];
        const m = tw.mass + (fruitAt[id] || 0);
        tau += rx * (-m * cfg.g);
        const Fx = 0.5 * cfg.rho * cfg.cdBranch * s.area[id] * wv * wv;
        tau -= ry * Fx;
      }
    });
    // rotational spring toward rest relative angle
    const rel = j === 0 ? wrapAngle(s.theta[0] - s.restTheta[0])
                        : wrapAngle(wrapAngle(s.theta[j] - s.theta[j - 1]) -
                                    wrapAngle(s.restTheta[j] - s.restTheta[j - 1]));
    tau += -cfg.K[j] * degrade * rel;
    tau += -cfg.angDamp * s.omega[j];
    // effective joint inertia grows toward the loaded tip
    const downstreamCount = N - j;
    const Ieff = I * (1 + 1.2 * (downstreamCount / N)) +
                 (fruitAt[N] || 0) * cfg.L * cfg.L * (j === N - 1 ? 1 : 0.4);
    s.omega[j] += (tau / Ieff) * h;
  }
  for (let j = 0; j < N; j++) s.theta[j] = wrapAngle(s.theta[j] + s.omega[j] * h);

  // ---------- twig joint torques (against host segment) ----------
  const fruitAtTwig = {};
  s.fruits.forEach((fr) => { fruitAtTwig[fr.anchor] = (fruitAtTwig[fr.anchor] || 0) + cfg.fruitMass; });
  s.twigs.forEach((tw, ti) => {
    const id = s.twigNode[ti];
    const hp = nodes[tw.host];
    const rx = nodes[id][0] - hp[0];
    const ry = nodes[id][1] - hp[1];
    const fruitM = fruitAtTwig[id] || 0;
    const m = tw.mass + fruitM;
    let tau = rx * (-m * cfg.g);
    const Fx = 0.5 * cfg.rho * cfg.cdBranch * s.area[id] * wv * wv;
    tau -= ry * Fx;
    const rel = wrapAngle(wrapAngle(tw.theta - s.theta[tw.host]) -
                          wrapAngle(tw.restTheta - s.restTheta[tw.host]));
    tau += -tw.K * degrade * rel - tw.damp * tw.omega;
    // effective inertia includes the hanging fruit mass
    const It = (tw.mass + fruitM) * tw.L * tw.L;
    tw.omega += (tau / It) * h;
    tw.theta = wrapAngle(tw.theta + tw.omega * h);
  });

  // rebuild with updated angles
  const nodes2 = forwardKinematics(s);

  // ---------- ground contact: angular stop when a node reaches the ground ----------
  for (let j = 0; j < N; j++) {
    if (nodes2[j + 1][1] < cfg.groundY) {
      // reflect the violating rotation: pull theta back so the node lifts,
      // and kill downward angular velocity
      const overshoot = cfg.groundY - nodes2[j + 1][1];
      const lever = cfg.L;
      s.theta[j] = wrapAngle(s.theta[j] + overshoot / lever);
      if (s.omega[j] < 0) s.omega[j] *= -0.2;
    }
  }
  s.twigs.forEach((tw, ti) => {
    const id = s.twigNode[ti];
    if (nodes2[id][1] < cfg.groundY) {
      const overshoot = cfg.groundY - nodes2[id][1];
      tw.theta = wrapAngle(tw.theta + overshoot / tw.L);
      if (tw.omega < 0) tw.omega *= -0.2;
    }
  });
  const nodes3 = forwardKinematics(s);

  // ---------- fresh anchor velocities from actual node motion ----------
  const newAnchorVel = {};
  for (let i = 0; i < nodes3.length; i++) {
    newAnchorVel[i] = [
      (nodes3[i][0] - s._prevNodes[i][0]) / h,
      (nodes3[i][1] - s._prevNodes[i][1]) / h,
    ];
  }

  // ---------- fruits: pendulum driven by wind + measured anchor accel ----------
  s.fruits.forEach((fr) => {
    const ai = fr.anchor;
    const cur = newAnchorVel[ai] || [0, 0];
    const prv = prevAnchorVel[ai] || [0, 0];
    const aAx = (cur[0] - prv[0]) / h;
    const aAy = (cur[1] - prv[1]) / h;
    const t0 = Math.cos(fr.beta), t1 = Math.sin(fr.beta);
    const vFruitX = cur[0] + cfg.ropeLen * fr.betaDot * t0;
    const vrel = wv - vFruitX;
    const D = 0.5 * cfg.rho * cfg.fruitCdA * vrel * Math.abs(vrel);
    const betaDD =
      ((D / cfg.fruitMass - aAx) * t0 - (cfg.g + aAy) * t1) / cfg.ropeLen -
      cfg.pendDamp * fr.betaDot;
    fr.betaDot += betaDD * h;
    fr.beta += fr.betaDot * h;
    const bMax = (cfg.betaMaxDeg * PI) / 180;
    if (fr.beta > bMax) { fr.beta = bMax; fr.betaDot = Math.min(fr.betaDot, 0); }
    if (fr.beta < -bMax) { fr.beta = -bMax; fr.betaDot = Math.max(fr.betaDot, 0); }
    // rope is taut whenever the fruit rests against its hard swing limit
    fr.taut = Math.abs(fr.beta) >= bMax - 1e-6;

    // rope tension, recorded for visualization / feedback
    const eR0 = Math.sin(fr.beta), eR1 = -Math.cos(fr.beta);
    const aRad = aAx * eR0 + aAy * eR1 - cfg.ropeLen * fr.betaDot * fr.betaDot;
    let T = D * eR0 - cfg.fruitMass * cfg.g * eR1 - cfg.fruitMass * aRad;
    if (T < 0) T = 0;
    if (fr.taut) T = Math.max(T, 0.15 * cfg.fruitMass * cfg.g);
    fr.tension = T;
  });

  s._prevNodes = nodes3.map((p) => p.slice());
  s.anchorVel = newAnchorVel;
  s.prevAnchorVel = prevAnchorVel;

  s.time += h;
}

function step(s, frameDt, windSpeed, gustOn) {
  s.acc += Math.min(frameDt, 0.05);
  const h = s.cfg.h;
  let guard = 0;
  while (s.acc >= h && guard < 24) {
    subStep(s, windSpeed, gustOn);
    s.acc -= h;
    guard++;
  }
  s.wind = windSpeed;
}

function fruitPos(s, fr) {
  const a = s.nodes[fr.anchor];
  return [
    a[0] + s.cfg.ropeLen * Math.sin(fr.beta),
    a[1] - s.cfg.ropeLen * Math.cos(fr.beta),
  ];
}

function calibrate(s, Wmax, levels) {
  Wmax = Wmax || 28;
  levels = levels || 29;
  const settleSteps = 2400;
  const tipY0 = s.restTip ? s.restTip[1] : forwardKinematics(s)[s.N][1];
  const maxDroop = tipY0 - s.cfg.groundY;
  const curve = [];
  let pinAt = null, critAt = null;
  for (let k = 0; k <= levels; k++) {
    const W = (Wmax * k) / levels;
    for (let q = 0; q < settleSteps; q++) subStep(s, W, false);
    const tipY = s.nodes[s.N][1];
    const droop = tipY0 - tipY;
    const betas = s.fruits.map((fr) => (fr.beta * 180) / PI);
    const pinned = s.fruits.some((fr) => fr.taut);
    if (pinAt === null && pinned) pinAt = W;
    curve.push({ W, droop, ratio: droop / maxDroop, betas });
    if (critAt === null && droop / maxDroop > 0.5) critAt = W;
  }
  let crit = critAt;
  if (critAt !== null) {
    let lo = Wmax * (curve.findIndex((c) => c.ratio > 0.5) - 1) / levels;
    let hi = critAt;
    for (let b = 0; b < 14; b++) {
      const mid = (lo + hi) / 2;
      const probe = createSim(s.cfg);
      for (let q = 0; q < settleSteps; q++) subStep(probe, mid, false);
      const d = tipY0 - probe.nodes[s.N][1];
      if (d / maxDroop > 0.5) hi = mid; else lo = mid;
    }
    crit = (lo + hi) / 2;
  } else {
    crit = Wmax * 0.85;
  }
  return { crit, pinAt, curve, maxDroop };
}

module.exports = { createSim, step, subStep, calibrate, fruitPos, forwardKinematics, defaultConfig };
