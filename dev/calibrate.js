'use strict';
const { createSim, subStep, calibrate, fruitPos, defaultConfig } = require('./engine');
const PI = Math.PI;

function settle(s, W, steps, gust) {
  for (let i = 0; i < steps; i++) subStep(s, W, !!gust);
}

// tuned stiffness is now the engine default; only override buckling shape
function tunedConfig() {
  const cfg = defaultConfig();
  cfg.bucklingSharpness = 14;
  cfg.soften = 0.08;
  return cfg;
}

// ---------- 1. ramp scan + critical wind ----------
const cfg = tunedConfig();
const s = createSim(cfg);
const tipY0 = s.restTip[1];
const maxDroop = tipY0 - cfg.groundY;
const cal = calibrate(s, 28, 29);

console.log('=== ramp curve (quasi-static) ===');
console.log('W(m/s)  droop%   tipY    beta[deg]                pinned');
for (const c of cal.curve) {
  const pinned = c.betas.some((b) => Math.abs(b) >= cfg.betaMaxDeg - 0.5);
  console.log(
    c.W.toFixed(2).padStart(5),
    (c.ratio * 100).toFixed(1).padStart(5) + '%',
    (tipY0 - c.droop).toFixed(3).padStart(6),
    c.betas.map((b) => b.toFixed(1).padStart(6)).join(' '),
    pinned ? 'TAUT' : ''
  );
}
console.log('\nCRITICAL wind (50% droop) =', cal.crit.toFixed(2), 'm/s');
console.log('rope pin onset            =', cal.pinAt === null ? 'never' : cal.pinAt.toFixed(2), 'm/s');

// steepness around critical
const c = cal.curve;
const iCrit = c.findIndex((p) => p.W >= cal.crit);
const far = (c[4].ratio - c[1].ratio) / (c[4].W - c[1].W);
const near = (c[Math.min(iCrit + 2, c.length - 1)].ratio - c[Math.max(iCrit - 2, 0)].ratio) /
  (c[Math.min(iCrit + 2, c.length - 1)].W - c[Math.max(iCrit - 2, 0)].W);
console.log('slope far from crit =', far.toFixed(4), '  slope near crit =', near.toFixed(4),
  '  steepness ratio =', (near / far).toFixed(1) + 'x');

// ---------- 2. no-wind gravity sag ----------
const s0 = createSim(cfg);
settle(s0, 0, 2400);
const sag0 = tipY0 - s0.nodes[cfg.N][1];
console.log('\n=== no wind ===');
console.log('static tip sag =', sag0.toFixed(3), 'm  (', (100 * sag0 / maxDroop).toFixed(1), '% of max)');
console.log('fruit betas =', s0.fruits.map((f) => (f.beta * 180 / PI).toFixed(2)).join(', '));
const rodErr = Math.max(...[...Array(cfg.N)].map((_, j) =>
  Math.abs(Math.hypot(s0.nodes[j + 1][0] - s0.nodes[j][0], s0.nodes[j + 1][1] - s0.nodes[j][1]) - cfg.L)));
console.log('rod length error (FK, should be ~0) =', rodErr.toExponential(1));

// ---------- 3. dynamic stability with gusts ----------
console.log('\n=== dynamic 20 s runs with gusts ===');
for (const W of [0, cal.crit * 0.6, cal.crit, cal.crit * 1.4, 26]) {
  const sd = createSim(cfg);
  let nan = false;
  for (let f = 0; f < 20 * 60; f++) {
    for (let q = 0; q < 4; q++) subStep(sd, W, true);
    if (sd.nodes.some((p) => !isFinite(p[0]) || !isFinite(p[1]))) { nan = true; break; }
  }
  const betas = sd.fruits.map((fr) => (fr.beta * 180 / PI).toFixed(1));
  console.log(`W=${W.toFixed(1).padStart(4)}  nan=${nan}  droop%=${
    (100 * (tipY0 - sd.nodes[cfg.N][1]) / maxDroop).toFixed(1).padStart(5)}  beta=${betas.join(',')}`);
}

// ---------- 4. two-way coupling checks ----------
console.log('\n=== coupling checks ===');
for (const W of [0, cal.crit * 0.8]) {
  const full = createSim(cfg); settle(full, W, 2400);
  const bareCfg = tunedConfig(); bareCfg.fruits = [];
  const bare = createSim(bareCfg); settle(bare, W, 2400);
  console.log(`W=${W.toFixed(1)}: tip Y full=${full.nodes[cfg.N][1].toFixed(3)} bare=${bare.nodes[cfg.N][1].toFixed(3)} ` +
    `fruit-load drop=${(bare.nodes[cfg.N][1] - full.nodes[cfg.N][1]).toFixed(3)} m`);
}
// anchor-acceleration coupling: compare to fixed-anchor pendulum
const coupled = createSim(cfg);
settle(coupled, cal.crit * 0.9, 2400);
let b = 0, bd = 0, h = cfg.h, L = cfg.ropeLen, W = cal.crit * 0.9;
for (let i = 0; i < 2400; i++) {
  const vrel = W - L * bd * Math.cos(b);
  const D = 0.5 * cfg.rho * cfg.fruitCdA * vrel * Math.abs(vrel);
  const bdd = (D / cfg.fruitMass) * Math.cos(b) / L - (cfg.g / L) * Math.sin(b) - cfg.pendDamp * bd;
  bd += bdd * h; b += bd * h;
}
console.log('fruit beta coupled (moving anchor):', (coupled.fruits[0].beta * 180 / PI).toFixed(1), 'deg');
console.log('fruit beta fixed-anchor pendulum  :', (b * 180 / PI).toFixed(1), 'deg');

const over = createSim(cfg);
settle(over, cal.crit * 1.25, 2400);
console.log('over-critical droop% =', (100 * (tipY0 - over.nodes[cfg.N][1]) / maxDroop).toFixed(1),
  ' taut count =', over.fruits.filter((f) => f.taut).length, '/', over.fruits.length);
