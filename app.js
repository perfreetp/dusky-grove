'use strict';

/* ----------------------------- 基础配置与状态 ----------------------------- */

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

const WORLD_W = 1280;
const WORLD_H = 820;

const PHYS = {
  Tres: 140,       // 热储温度 °C
  Tinj: 42,        // 回灌温度 °C
  designYears: 15
};

const PATTERNS = {
  pair: {
    label: '对井',
    typical: 520,
    critical: 360,
    btK: 0.62,
    wells: [
      { id: 'I1', type: 'inj', x: 380, y: 410 },
      { id: 'P1', type: 'prod', x: 900, y: 410 }
    ],
    mesh: []
  },
  five: {
    label: '五点法',
    typical: 426,
    critical: 400,
    btK: 0.50,
    wells: [
      { id: 'P1', type: 'prod', x: 640, y: 410 },
      { id: 'I1', type: 'inj', x: 310, y: 140 },
      { id: 'I2', type: 'inj', x: 970, y: 140 },
      { id: 'I3', type: 'inj', x: 310, y: 680 },
      { id: 'I4', type: 'inj', x: 970, y: 680 }
    ],
    mesh: [
      ['I1', 'I2', 'P1'],
      ['I2', 'I4', 'P1'],
      ['I4', 'I3', 'P1'],
      ['I3', 'I1', 'P1']
    ]
  },
  row: {
    label: '行列井网',
    typical: 460,
    critical: 340,
    btK: 0.92,
    wells: [
      { id: 'I1', type: 'inj', x: 220, y: 180 },
      { id: 'I2', type: 'inj', x: 640, y: 180 },
      { id: 'I3', type: 'inj', x: 1060, y: 180 },
      { id: 'P1', type: 'prod', x: 220, y: 640 },
      { id: 'P2', type: 'prod', x: 640, y: 640 },
      { id: 'P3', type: 'prod', x: 1060, y: 640 }
    ],
    mesh: [
      ['I1', 'I2', 'P1'],
      ['I2', 'P2', 'P1'],
      ['I2', 'I3', 'P2'],
      ['I3', 'P3', 'P2']
    ]
  }
};

const state = {
  pattern: 'pair',
  flow: 90,
  time: 4,
  speed: 0.8,
  playing: true,
  selectedId: 'P1',
  hoveredId: null,
  showPipes: true,
  showMesh: true,
  showPlumes: true,
  showLabels: true,
  wells: PATTERNS.pair.wells.map((w) => ({ ...w })),
  mesh: PATTERNS.pair.mesh
};

let app = null;
let viewport = null;
let wellLayer = null;
let plumeLayer = null;
let meshG = null;
let pipeLayer = null;
let pipeG = null;
let linkG = null;
let fxG = null;
let linkLabelLayer = null;
let wellViews = {};
let plumeViews = {};
let distanceLabels = {};
let coldTexture = null;
let funnelTexture = null;
let dragState = null;
let sectionHits = [];
let heatCanvas = document.createElement('canvas');
let uiDirty = true;
let lastDashboard = 0;

/* -------------------------------- 工具函数 -------------------------------- */

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sigmoid01 = (x) => {
  const v = clamp(x, -60, 60);
  return 1 / (1 + Math.exp(-v));
};

function getWell(id) {
  return state.wells.find((w) => w.id === id) || null;
}

function wellsOfType(type) {
  return state.wells.filter((w) => w.type === type);
}

function nearestWell(well, type) {
  return wellsOfType(type)
    .map((w) => ({ w, d: dist(well, w) }))
    .sort((a, b) => a.d - b.d)[0]?.w || null;
}

function criticalDistance(cfg = PATTERNS[state.pattern], q = state.flow) {
  return cfg.critical * Math.pow(q / 120, 0.35);
}

function breakthroughYears(d, cfg = PATTERNS[state.pattern], q = state.flow) {
  return cfg.btK * Math.pow(d / 100, 2) * Math.pow(120 / Math.max(20, q), 0.85);
}

function wellRisk(well) {
  if (!well) return false;
  const other = nearestWell(well, well.type === 'prod' ? 'inj' : 'prod');
  if (!other) return false;
  return dist(well, other) < criticalDistance();
}

/* ------------------------------ 降阶热工模型 ------------------------------ */

function producerModel(producer, t = state.time, q = state.flow) {
  const cfg = PATTERNS[state.pattern];
  const injectors = wellsOfType('inj');
  const producers = wellsOfType('prod');
  const qPerProducer = q / Math.max(1, producers.length);
  const pairs = injectors.map((inj) => {
    const d = dist(producer, inj);
    return { inj, d, bt: breakthroughYears(d, cfg, q) };
  });
  const nearestPair = pairs.slice().sort((a, b) => a.d - b.d)[0] || null;
  const dMin = nearestPair?.d ?? Infinity;
  const btMin = nearestPair?.bt ?? Infinity;
  const nearest = nearestPair?.inj || null;

  let cold = 0;
  const contributions = pairs.map(({ inj, d, bt }) => {
    const span = Math.max(1.2, bt * 0.55 + 1.2);
    const u = Math.max(0, (t - bt) / span);
    const arrivalFraction = 1 - Math.exp(-Math.pow(u, 1.35));
    const weight = injectors.length === 1 ? 1 : clamp(Math.pow(dMin / d, 1.4), 0.38, 1);
    const f = arrivalFraction * weight;
    cold = 1 - (1 - cold) * (1 - f);
    return {
      injId: inj.id,
      d,
      bt,
      f,
      weight,
      front: d * Math.min(1.06, t / bt)
    };
  });

  const localCooling = 1.5 + 7 * (1 - Math.exp(-t / 7));
  const temp = PHYS.Tinj + (PHYS.Tres - PHYS.Tinj - localCooling) * (1 - cold);
  const deltaT = Math.max(0, temp - PHYS.Tinj);
  const power = 0.001162 * qPerProducer * deltaT;
  const dcrit = criticalDistance(cfg, q);

  return {
    producerId: producer.id,
    qPerProducer,
    cold,
    temp,
    deltaT,
    power,
    dMin,
    btMin,
    nearestId: nearest?.id,
    frontDistance: dMin * Math.min(1.06, t / btMin),
    critical: dcrit,
    risk: dMin < dcrit,
    contributions
  };
}

function fieldPower(q = state.flow, t = PHYS.designYears) {
  return wellsOfType('prod').reduce((sum, p) => sum + producerModel(p, t, q).power, 0);
}

function selectionContext() {
  let selected = getWell(state.selectedId) || state.wells[0];
  let producer;
  let injector;

  if (selected.type === 'prod') {
    producer = selected;
    injector = nearestWell(producer, 'inj');
  } else {
    injector = selected;
    producer = nearestWell(injector, 'prod');
  }

  const model = producer ? producerModel(producer) : null;
  const contribution = model?.contributions.find((c) => c.injId === injector?.id) || model?.contributions[0] || null;
  const distance = producer && injector ? dist(producer, injector) : 0;
  const critical = criticalDistance();
  const risk = distance < critical;

  return { selected, producer, injector, model, contribution, distance, critical, risk };
}

/* --------------------------------- UI 绑定 -------------------------------- */

function bindUI() {
  document.querySelectorAll('.pattern-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPattern(btn.dataset.pattern));
  });

  const flow = $('flowSlider');
  const time = $('timeSlider');
  const speed = $('speedSlider');

  flow.addEventListener('input', () => {
    state.flow = +flow.value;
    uiDirty = true;
    renderCharts();
  });

  time.addEventListener('pointerdown', () => setPlaying(false));
  time.addEventListener('input', () => {
    state.time = +time.value;
    uiDirty = true;
    updateDashboard();
    renderCharts();
    renderSection();
  });

  speed.addEventListener('input', () => {
    state.speed = +speed.value;
    uiDirty = true;
  });

  $('playBtn').addEventListener('click', togglePlaying);
  $('topPlayBtn').addEventListener('click', togglePlaying);
  $('resetTimeBtn').addEventListener('click', resetTime);
  $('topResetBtn').addEventListener('click', resetTime);

  $('typicalBtn').addEventListener('click', () => {
    const id = state.pattern;
    state.wells = PATTERNS[id].wells.map((w) => ({ ...w }));
    state.mesh = PATTERNS[id].mesh;
    state.selectedId = 'P1';
    rebuildWellViews();
    uiDirty = true;
    updateDashboard();
    renderCharts();
    renderSection();
  });

  $('fitBtn').addEventListener('click', fitView);
  $('fitBtn2').addEventListener('click', fitView);
  $('zoomInBtn').addEventListener('click', () => zoomBy(1.22));
  $('zoomOutBtn').addEventListener('click', () => zoomBy(1 / 1.22));

  $('togglePipes').addEventListener('change', (e) => { state.showPipes = e.target.checked; uiDirty = true; });
  $('toggleMesh').addEventListener('change', (e) => { state.showMesh = e.target.checked; uiDirty = true; });
  $('togglePlumes').addEventListener('change', (e) => { state.showPlumes = e.target.checked; });
  $('toggleLabels').addEventListener('change', (e) => { state.showLabels = e.target.checked; });

  $('wellList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-select]');
    if (row) selectWell(row.dataset.select);
  });
  $('timeLegend').addEventListener('click', (e) => {
    const item = e.target.closest('[data-select]');
    if (item) selectWell(item.dataset.select);
  });
  $('compareList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-pattern]');
    if (row) setPattern(row.dataset.pattern);
  });
  $('compareList').addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-pattern]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setPattern(row.dataset.pattern);
    }
  });

  const canvas = $('sectionCanvas');
  canvas.addEventListener('click', onSectionClick);
  canvas.addEventListener('pointermove', onSectionPointerMove);

  window.addEventListener('resize', () => {
    resizeSectionCanvas();
    renderSection();
  });

  paintRanges();
}

function paintRanges() {
  document.querySelectorAll('input[type="range"]').forEach((el) => {
    const min = +el.min;
    const max = +el.max;
    el.style.setProperty('--fill', `${((+el.value - min) / (max - min)) * 100}%`);
  });
  $('flowValue').textContent = `${state.flow} m³/h`;
  $('timeValue').textContent = `${state.time.toFixed(1)} a`;
  $('speedValue').textContent = `${state.speed.toFixed(1)} a/s`;
}

function togglePlaying() {
  state.playing = !state.playing;
  updatePlayButtons();
}

function updatePlayButtons() {
  const label = state.playing ? '⏸ 暂停' : '▶ 播放';
  $('playBtn').textContent = label;
  $('topPlayBtn').textContent = state.playing ? '⏸ 暂停演化' : '▶ 继续演化';
}

function resetTime() {
  state.time = 0;
  state.playing = false;
  $('timeSlider').value = '0';
  updatePlayButtons();
  uiDirty = true;
  updateDashboard();
  renderCharts();
  renderSection();
}

function setPattern(id) {
  if (!PATTERNS[id]) return;
  state.pattern = id;
  state.wells = PATTERNS[id].wells.map((w) => ({ ...w }));
  state.mesh = PATTERNS[id].mesh;
  state.selectedId = 'P1';

  document.querySelectorAll('.pattern-btn').forEach((btn) => {
    const active = btn.dataset.pattern === id;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  rebuildWellViews();
  updateDashboard();
  renderCompare();
  renderCharts();
  renderSection();
  requestAnimationFrame(fitView);
}

function selectWell(id) {
  if (!getWell(id)) return;
  state.selectedId = id;
  updateDashboard();
  renderTimeChart();
  renderSection();
}

/* -------------------------------- Pixi 平面 -------------------------------- */

function initPixi() {
  const wrap = $('planWrap');
  if (!window.PIXI || !(window.pixi_viewport?.Viewport || PIXI.Viewport)) {
    wrap.innerHTML = '<div style="padding:24px;color:#ffb3c0">PixiJS 或 pixi-viewport 未能从 CDN 加载，请检查网络后刷新。</div>';
    return;
  }

  app = new PIXI.Application({
    resizeTo: wrap,
    background: 0x071423,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true
  });
  app.view.setAttribute('aria-label', '可缩放平移的地热田井场平面图');
  wrap.appendChild(app.view);

  const ViewportCtor = window.pixi_viewport.Viewport || PIXI.Viewport;
  viewport = new ViewportCtor({
    screenWidth: wrap.clientWidth,
    screenHeight: wrap.clientHeight,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    interaction: app.renderer.plugins.interaction
  });

  viewport
    .drag({ pressDrag: true })
    .pinch()
    .wheel({ smooth: 5, percent: 0.16 })
    .decelerate({ friction: 0.9 })
    .clamp({ direction: 'all', underflow: 'center' })
    .clampZoom({ minScale: 0.32, maxScale: 2.8 });

  app.stage.addChild(viewport);

  const groundG = new PIXI.Graphics();
  const gridG = new PIXI.Graphics();
  plumeLayer = new PIXI.Container();
  meshG = new PIXI.Graphics();
  pipeLayer = new PIXI.Container();
  pipeG = new PIXI.Graphics();
  pipeLayer.addChild(pipeG);
  linkG = new PIXI.Graphics();
  wellLayer = new PIXI.Container();
  fxG = new PIXI.Graphics();
  linkLabelLayer = new PIXI.Container();

  viewport.addChild(groundG, gridG, plumeLayer, meshG, pipeLayer, linkG, wellLayer, fxG, linkLabelLayer);
  layers = { groundG, gridG };

  drawSite();
  makeTextures();
  rebuildWellViews();

  app.stage.interactive = true;
  app.stage.on('pointermove', onStagePointerMove);
  app.stage.on('pointerup', finishDrag);
  app.stage.on('pointerupoutside', finishDrag);
  window.addEventListener('pointerup', finishDrag);
  window.__geoSandbox = {
    state,
    get viewport() { return viewport; },
    get app() { return app; },
    get sectionHits() { return sectionHits; }
  };

  app.ticker.add((delta) => {
    const dt = app.ticker.deltaMS / 1000;
    if (state.playing) {
      state.time = Math.min(30, state.time + dt * state.speed);
      if (state.time >= 30) {
        state.playing = false;
        updatePlayButtons();
      }
      $('timeSlider').value = state.time.toFixed(1);
    }

    updatePlanDynamic();

    const now = performance.now();
    if ((uiDirty || state.playing) && now - lastDashboard > 70) {
      const structuralUpdate = uiDirty;
      paintRanges();
      updateDashboard();
      if (structuralUpdate) {
        renderCharts();
      } else {
        renderTimeChart();
      }
      renderSection();
      lastDashboard = now;
      uiDirty = false;
    }
  });

  const ro = new ResizeObserver(() => {
    if (!app || !viewport) return;
    app.resize();
    viewport.resize(wrap.clientWidth, wrap.clientHeight);
  });
  ro.observe(wrap);

  requestAnimationFrame(() => {
    resizeSectionCanvas();
    fitView();
    updateDashboard();
    renderCompare();
    renderCharts();
    renderSection();
  });
}

let layers = {};

function makeTextures() {
  coldTexture = makeRadialTexture([
    [0, 'rgba(69,227,255,0.50)'],
    [0.38, 'rgba(37,99,235,0.28)'],
    [0.72, 'rgba(14,165,233,0.10)'],
    [1, 'rgba(14,165,233,0)']
  ]);
  funnelTexture = makeRadialTexture([
    [0, 'rgba(165,243,252,0.42)'],
    [0.45, 'rgba(34,211,238,0.20)'],
    [1, 'rgba(34,211,238,0)']
  ]);
}

function makeRadialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([p, color]) => g.addColorStop(p, color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return PIXI.Texture.from(c);
}

function drawSite() {
  const { groundG, gridG } = layers;

  groundG.clear();
  groundG.beginFill(0x0a192b, 0.96);
  groundG.lineStyle(2, 0x2c5278, 0.75);
  groundG.drawRoundedRect(40, 40, 1200, 740, 26);
  groundG.endFill();

  // 场地浅色内芯
  groundG.beginFill(0x0d2138, 0.55);
  groundG.lineStyle(1, 0x244866, 0.5);
  groundG.drawRoundedRect(62, 62, 1156, 696, 18);
  groundG.endFill();

  // 换热站
  groundG.beginFill(0x1e334d, 1);
  groundG.lineStyle(2, 0x6f8fb3, 0.8);
  groundG.drawRoundedRect(580, 746, 120, 31, 7);
  groundG.endFill();
  groundG.beginFill(0x45e3ff, 0.18);
  groundG.drawRoundedRect(592, 754, 22, 15, 3);
  groundG.drawRoundedRect(622, 754, 22, 15, 3);
  groundG.drawRoundedRect(652, 754, 34, 15, 3);
  groundG.endFill();

  const stationText = new PIXI.Text('换热站', {
    fontFamily: 'Microsoft YaHei, sans-serif',
    fontSize: 12,
    fontWeight: '700',
    fill: 0xdcecff
  });
  stationText.anchor.set(0.5);
  stationText.position.set(640, 761);
  groundG.addChild(stationText);

  gridG.clear();
  for (let x = 80; x <= 1200; x += 40) {
    const major = x % 200 === 0;
    gridG.lineStyle(1, major ? 0x31577a : 0x1d3a58, major ? 0.34 : 0.22);
    gridG.moveTo(x, 66);
    gridG.lineTo(x, 754);
  }
  for (let y = 100; y <= 720; y += 40) {
    const major = y % 200 === 0;
    gridG.lineStyle(1, major ? 0x31577a : 0x1d3a58, major ? 0.34 : 0.22);
    gridG.moveTo(66, y);
    gridG.lineTo(1214, y);
  }

  // 淡青色三角测量网格，提示三角形井网的拓扑基底
  const triA = 86;
  const triH = triA * Math.sqrt(3) / 2;
  gridG.lineStyle(1, 0x2dd4bf, 0.075);
  for (let row = 0; row <= 9; row++) {
    const y = 88 + row * triH;
    const offset = row % 2 ? triA / 2 : 0;
    for (let col = -1; col <= 14; col++) {
      const x = 86 + col * triA + offset;
      if (x > 58 && x + triA < 1222) {
        gridG.moveTo(x, y);
        gridG.lineTo(x + triA, y);
      }
      if (row < 9) {
        const mx = x + triA / 2;
        if (mx > 58 && mx < 1222 && y + triH < 752) {
          gridG.moveTo(x, y);
          gridG.lineTo(mx, y + triH);
          gridG.moveTo(x + triA, y);
          gridG.lineTo(mx, y + triH);
        }
      }
    }
  }

  for (let x = 200; x <= 1200; x += 200) {
    const t = new PIXI.Text(String(x), { fontFamily: 'Consolas, monospace', fontSize: 10, fill: 0x5f7f9f });
    t.anchor.set(0.5);
    t.position.set(x, 70);
    gridG.addChild(t);
  }

  const north = new PIXI.Container();
  const ng = new PIXI.Graphics();
  ng.lineStyle(2, 0x9fc2e4, 0.9);
  ng.beginFill(0x45e3ff, 0.85);
  ng.drawPolygon([0, -18, 7, 6, 0, 1, -7, 6]);
  ng.endFill();
  north.addChild(ng);
  const nText = new PIXI.Text('N', { fontSize: 13, fontWeight: '900', fill: 0xdcecff });
  nText.anchor.set(0.5);
  nText.position.set(0, 16);
  north.addChild(nText);
  north.position.set(1188, 96);
  groundG.addChild(north);
}

function rebuildWellViews() {
  if (!wellLayer) return;

  Object.values(wellViews).forEach((c) => c.destroy({ children: true }));
  Object.values(plumeViews).forEach((s) => s.destroy({ children: true }));
  Object.values(distanceLabels).forEach((t) => t.destroy());
  wellViews = {};
  plumeViews = {};
  distanceLabels = {};

  for (const w of state.wells) {
    if (state.showPlumes) {
      const tex = w.type === 'inj' ? coldTexture : funnelTexture;
      const sprite = new PIXI.Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.position.set(w.x, w.y);
      plumeLayer.addChild(sprite);
      plumeViews[w.id] = sprite;
    }

    const view = createWellView(w);
    wellLayer.addChild(view);
    wellViews[w.id] = view;

    if (w.type === 'prod') {
      const label = new PIXI.Text('', {
        fontFamily: 'Consolas, Microsoft YaHei, monospace',
        fontSize: 12,
        fontWeight: '800',
        fill: 0xbfeaff,
        stroke: 0x06101d,
        strokeThickness: 4
      });
      label.anchor.set(0.5);
      linkLabelLayer.addChild(label);
      distanceLabels[w.id] = label;
    }
  }
}

function createWellView(w) {
  const color = w.type === 'inj' ? 0x39c5ff : 0xff8a3d;
  const c = new PIXI.Container();
  c.position.set(w.x, w.y);
  c.interactive = true;
  c.buttonMode = true;
  c.cursor = 'grab';
  c.wellId = w.id;

  const g = new PIXI.Graphics();

  // 阴影与橇座
  g.beginFill(0x000000, 0.28);
  g.drawEllipse(0, 21, 22, 7);
  g.endFill();

  g.beginFill(0x263a55, 1);
  g.lineStyle(1.5, 0x8ba6c4, 0.75);
  g.drawRoundedRect(-20, 11, 40, 9, 3);
  g.endFill();

  // 套管和井口圆帽
  g.lineStyle(2.5, 0xe6f4ff, 0.95);
  g.beginFill(color, 1);
  g.drawCircle(0, 3, 13);
  g.endFill();
  g.lineStyle(2, 0x17304c, 0.55);
  g.drawCircle(0, 3, 7);

  // 立管和阀门轮
  g.lineStyle(4, 0xb9cde6, 1);
  g.moveTo(0, -8);
  g.lineTo(0, -18);
  g.lineStyle(2, 0xe8f3ff, 0.9);
  g.drawCircle(0, -21, 5.2);
  g.moveTo(-5, -21);
  g.lineTo(5, -21);
  g.moveTo(0, -26);
  g.lineTo(0, -16);

  // 流向箭头
  g.lineStyle(2.4, 0xffffff, 0.96);
  if (w.type === 'prod') {
    g.moveTo(0, 10);
    g.lineTo(0, -1);
    g.moveTo(-5, 4);
    g.lineTo(0, -2);
    g.lineTo(5, 4);
  } else {
    g.moveTo(0, -5);
    g.lineTo(0, 7);
    g.moveTo(-5, 1);
    g.lineTo(0, 7);
    g.lineTo(5, 1);
  }

  c.addChild(g);

  const label = new PIXI.Text(w.id, {
    fontFamily: 'Consolas, Microsoft YaHei, monospace',
    fontSize: 13,
    fontWeight: '900',
    fill: w.type === 'inj' ? 0xbdefff : 0xffe0c7,
    stroke: 0x06101d,
    strokeThickness: 4
  });
  label.anchor.set(0.5);
  label.position.set(0, 36);
  label.name = 'wellLabel';
  c.addChild(label);

  const typeLabel = new PIXI.Text(w.type === 'inj' ? '回灌' : '采出', {
    fontFamily: 'Microsoft YaHei, sans-serif',
    fontSize: 10,
    fontWeight: '700',
    fill: 0x9fb9d5,
    stroke: 0x06101d,
    strokeThickness: 3
  });
  typeLabel.anchor.set(0.5);
  typeLabel.position.set(0, 50);
  typeLabel.name = 'typeLabel';
  c.addChild(typeLabel);

  c.on('pointerdown', onWellPointerDown);
  c.on('pointerover', onWellPointerOver);
  c.on('pointermove', onWellPointerMove);
  c.on('pointerout', onWellPointerOut);

  return c;
}

function onWellPointerDown(e) {
  const id = e.currentTarget.wellId;
  selectWell(id);
  const w = getWell(id);
  const p = wellLayer.toLocal(e.data.global);
  dragState = {
    id,
    offsetX: w.x - p.x,
    offsetY: w.y - p.y
  };
  wellViews[id].alpha = 0.9;
  wellViews[id].cursor = 'grabbing';
  try { viewport.plugins.pause('drag'); } catch (_) { /* noop */ }
  $('tooltip').classList.remove('show');
  e.stopPropagation();
}

function onStagePointerMove(e) {
  if (!dragState) return;
  const p = wellLayer.toLocal(e.data.global);
  const w = getWell(dragState.id);
  w.x = clamp(p.x + dragState.offsetX, 82, WORLD_W - 82);
  w.y = clamp(p.y + dragState.offsetY, 88, 690);
  wellViews[w.id].position.set(w.x, w.y);
  uiDirty = true;
}

function finishDrag() {
  if (!dragState) return;
  const id = dragState.id;
  if (wellViews[id]) {
    wellViews[id].alpha = 1;
    wellViews[id].cursor = 'grab';
  }
  dragState = null;
  try { viewport.plugins.resume('drag'); } catch (_) { /* noop */ }
  updateDashboard();
  renderCharts();
  renderSection();
}

function onWellPointerOver(e) {
  if (dragState) return;
  state.hoveredId = e.currentTarget.wellId;
  showTooltip(e);
}

function onWellPointerMove(e) {
  if (state.hoveredId) positionTooltip(e);
  if (dragState) onStagePointerMove(e);
}

function onWellPointerOut() {
  state.hoveredId = null;
  $('tooltip').classList.remove('show');
}

function showTooltip(e) {
  const w = getWell(state.hoveredId);
  if (!w) return;
  const other = nearestWell(w, w.type === 'prod' ? 'inj' : 'prod');
  const d = other ? Math.round(dist(w, other)) : '—';
  let extra = '';
  if (w.type === 'prod') {
    const m = producerModel(w);
    extra = `<div class="row"><span>出水温度</span><b>${m.temp.toFixed(1)} °C</b></div>
             <div class="row"><span>预测突破</span><b>${m.btMin.toFixed(1)} a</b></div>
             <div class="row"><span>采热功率</span><b>${m.power.toFixed(2)} MWt</b></div>`;
  } else {
    extra = `<div class="row"><span>注入总量</span><b>${state.flow} m³/h</b></div>
             <div class="row"><span>最近采井</span><b>${other?.id || '—'}</b></div>`;
  }
  $('tooltip').innerHTML = `
    <b style="color:${w.type === 'inj' ? 'var(--inj)' : 'var(--prod)'}">${w.id} · ${w.type === 'inj' ? '回灌井' : '采井'}</b>
    <div class="row"><span>最近井距</span><b>${d} m</b></div>
    ${extra}
    <div style="color:var(--faint);margin-top:4px">拖动可改变井距</div>`;
  $('tooltip').classList.add('show');
  positionTooltip(e);
}

function positionTooltip(e) {
  const tip = $('tooltip');
  const raw = e.data?.originalEvent || e;
  const x = Math.min((raw.clientX || 0) + 14, window.innerWidth - 205);
  const y = Math.min((raw.clientY || 0) + 14, window.innerHeight - 150);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function fitView() {
  if (!viewport || !app) return;
  const wrap = $('planWrap');
  viewport.resize(wrap.clientWidth, wrap.clientHeight);
  const scale = Math.min(wrap.clientWidth / WORLD_W, wrap.clientHeight / WORLD_H) * 0.985;
  const center = { x: WORLD_W / 2, y: WORLD_H / 2 };
  viewport.scale.set(scale);
  viewport.moveCenter(center.x, center.y);
}

function zoomBy(factor) {
  if (!viewport) return;
  const next = clamp(viewport.scale.x * factor, 0.32, 2.8);
  const center = viewport.center;
  viewport.scale.set(next);
  viewport.moveCenter(center.x, center.y);
}

/* ------------------------------ Pixi 动态绘制 ------------------------------ */

function updatePlanDynamic() {
  if (!app) return;

  for (const w of state.wells) {
    const view = wellViews[w.id];
    if (!view) continue;
    view.position.set(w.x, w.y);
    const selected = w.id === state.selectedId;
    view.scale.set(selected ? 1.12 : 1);
    const label = view.getChildByName('wellLabel');
    const typeLabel = view.getChildByName('typeLabel');
    if (label) label.visible = state.showLabels;
    if (typeLabel) typeLabel.visible = state.showLabels;
  }

  drawPlumes();
  drawMesh();
  drawPipes();
  drawLinksAndFx();
}

function drawPlumes() {
  plumeLayer.visible = state.showPlumes;
  if (!state.showPlumes) return;

  for (const w of state.wells) {
    const sprite = plumeViews[w.id];
    if (!sprite) continue;
    sprite.position.set(w.x, w.y);

    if (w.type === 'inj') {
      const p = nearestWell(w, 'prod');
      let radius = 46 + 70 * Math.sqrt(state.time + 0.2);
      if (p) {
        const d = dist(w, p);
        const bt = breakthroughYears(d);
        radius = 44 + d * Math.min(1.04, state.time / bt);
      }
      const size = clamp(radius * 2, 90, 760);
      sprite.width = size;
      sprite.height = size;
      sprite.alpha = 0.82;
    } else {
      const dep = 1 - Math.exp(-state.time / 6);
      const radius = 58 + 125 * dep;
      sprite.width = radius * 2;
      sprite.height = radius * 2;
      sprite.alpha = 0.58;
    }
  }
}

function drawMesh() {
  meshG.clear();
  meshG.visible = state.showMesh;
  if (!state.showMesh) return;

  for (const tri of state.mesh) {
    const pts = tri.map((id) => getWell(id)).filter(Boolean);
    if (pts.length !== 3) continue;
    meshG.beginFill(0x45e3ff, 0.025);
    meshG.lineStyle(1.2, 0x2dd4bf, 0.28);
    meshG.drawPolygon(pts.flatMap((p) => [p.x, p.y]));
    meshG.endFill();
  }
}

function drawPipes() {
  pipeLayer.visible = state.showPipes;
  if (!state.showPipes) return;
  pipeG.clear();

  const prodY = 716;
  const injY = 744;

  const drawPolyline = (points, color) => {
    pipeG.lineStyle(7.5, 0x17283d, 0.96);
    pipeG.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => pipeG.lineTo(x, y));
    pipeG.lineStyle(3.4, color, 0.96);
    pipeG.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => pipeG.lineTo(x, y));
  };

  drawPolyline([[110, prodY], [1170, prodY]], 0xff8a3d);
  drawPolyline([[110, injY], [1170, injY]], 0x39c5ff);
  drawPolyline([[640, prodY], [640, 746]], 0xff8a3d);
  drawPolyline([[640, injY], [640, 746]], 0x39c5ff);

  for (const w of state.wells) {
    const y = w.type === 'prod' ? prodY : injY;
    drawPolyline([[w.x, w.y + 20], [w.x, y]], w.type === 'prod' ? 0xff8a3d : 0x39c5ff);

    // 流向小箭头
    pipeG.beginFill(w.type === 'prod' ? 0xffb07a : 0x9be7ff, 0.9);
    const ay = (w.y + 24 + y) / 2;
    const dir = w.type === 'prod' ? 1 : 1;
    pipeG.drawPolygon([w.x, ay + 6 * dir, w.x - 5, ay - 3 * dir, w.x + 5, ay - 3 * dir]);
    pipeG.endFill();
  }

  if (!pipeLayer.labelTexts) {
    const mk = (text, x, y, color) => {
      const t = new PIXI.Text(text, { fontSize: 11, fontWeight: '800', fill: color, stroke: 0x06101d, strokeThickness: 4 });
      t.position.set(x, y);
      pipeLayer.addChild(t);
      return t;
    };
    pipeLayer.labelTexts = [
      mk('采出管廊 → 换热站', 118, 697, 0xffc39e),
      mk('回灌管廊 → 换热站', 118, 750, 0xbdefff)
    ];
  }
  pipeLayer.labelTexts.forEach((t) => { t.visible = state.showLabels; });
}

function drawDashedLine(g, x1, y1, x2, y2, dash = 10, gap = 7) {
  const total = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / total;
  const dy = (y2 - y1) / total;
  for (let s = 0; s < total; s += dash + gap) {
    const e = Math.min(total, s + dash);
    g.moveTo(x1 + dx * s, y1 + dy * s);
    g.lineTo(x1 + dx * e, y1 + dy * e);
  }
}

function drawLinksAndFx() {
  linkG.clear();
  fxG.clear();

  const now = performance.now() / 1000;
  const producers = wellsOfType('prod');

  producers.forEach((p, index) => {
    const inj = nearestWell(p, 'inj');
    if (!inj) return;
    const d = dist(p, inj);
    const risk = d < criticalDistance();
    const selected = state.selectedId === p.id || state.selectedId === inj.id;
    const color = risk ? 0xff4263 : selected ? 0x45e3ff : 0x7aa8cf;

    linkG.lineStyle(selected ? 3 : 1.6, color, selected ? 0.95 : 0.55);
    drawDashedLine(linkG, inj.x, inj.y, p.x, p.y, selected ? 12 : 8, selected ? 6 : 8);

    const label = distanceLabels[p.id];
    if (label) {
      label.text = `${Math.round(d)} m`;
      label.position.set((inj.x + p.x) / 2, (inj.y + p.y) / 2 - 12);
      label.style.fill = risk ? '#ff8fa3' : selected ? '#d9fbff' : '#b7d2ea';
      label.visible = state.showLabels;
    }

    if (risk) {
      const pulse = 27 + 4 * Math.sin(now * 4 + index);
      fxG.lineStyle(3, 0xff4263, 0.9);
      fxG.drawCircle(p.x, p.y, pulse);
      fxG.lineStyle(1.5, 0xff8aa0, 0.45);
      fxG.drawCircle(p.x, p.y, pulse + 8 + 2 * Math.sin(now * 3));
    }
  });

  const selected = getWell(state.selectedId);
  if (selected) {
    const r = 31 + 2.5 * Math.sin(now * 5);
    fxG.lineStyle(2.5, 0xffffff, 0.95);
    fxG.drawCircle(selected.x, selected.y, r);
    fxG.lineStyle(1, 0x45e3ff, 0.55);
    fxG.drawCircle(selected.x, selected.y, r + 6);
  }
}

/* --------------------------------- 仪表盘 --------------------------------- */

function updateDashboard() {
  if (!$('kpiDistance')) return;
  paintRanges();

  const ctx = selectionContext();
  const { selected, producer, injector, model, contribution, distance, critical, risk } = ctx;

  $('topTime').textContent = `${state.time.toFixed(1)} a`;
  $('timeValue').textContent = `${state.time.toFixed(1)} a`;
  $('timeSlider').value = state.time.toFixed(1);
  $('flowValue').textContent = `${state.flow} m³/h`;
  $('flowSlider').value = String(state.flow);
  $('speedValue').textContent = `${state.speed.toFixed(1)} a/s`;
  $('speedSlider').value = String(state.speed);
  $('topSelected').textContent = selected?.id || '—';

  const riskCount = wellsOfType('prod').filter((p) => producerModel(p).risk).length;
  $('riskCount').textContent = riskCount;
  $('riskChip').classList.toggle('live', riskCount > 0);

  $('kpiDistance').innerHTML = `${Math.round(distance)}<span class="unit">m</span>`;
  $('kpiBreakthrough').innerHTML = `${model ? model.btMin.toFixed(1) : '—'}<span class="unit">a</span>`;
  $('kpiTemp').innerHTML = `${model ? model.temp.toFixed(1) : '—'}<span class="unit">°C</span>`;
  $('kpiPower').innerHTML = `${model ? model.power.toFixed(2) : '—'}<span class="unit">MWt</span>`;
  const front = contribution ? contribution.front : model?.frontDistance || 0;
  $('kpiFront').innerHTML = `${Math.round(front)}<span class="unit">m</span>`;
  $('kpiCritical').innerHTML = `${Math.round(critical)}<span class="unit">m</span>`;

  const kpiDist = $('kpiDistance').parentElement;
  kpiDist.classList.toggle('danger', risk);
  kpiDist.classList.toggle('ok', !risk);
  $('kpiBreakthrough').parentElement.classList.toggle('danger', model && model.btMin <= PHYS.designYears);
  $('kpiTemp').parentElement.classList.toggle('warn', model && model.cold > 0.18);
  $('kpiPower').parentElement.classList.toggle('ok', !risk);
  $('kpiPower').parentElement.classList.toggle('danger', risk);

  const banner = $('banner');
  const bannerText = $('bannerText');
  banner.classList.remove('ok', 'warn', 'danger');
  if (risk) {
    banner.classList.add('danger');
    banner.querySelector('.ico').textContent = '!';
    bannerText.innerHTML = `<b>热干扰已发生：</b>${producer.id} 与 ${injector.id} 的井距 ${Math.round(distance)} m 小于临界值 ${Math.round(critical)} m。冷水通道形成后，该井采热曲线已标红。`;
  } else if (riskCount > 0) {
    banner.classList.add('warn');
    banner.querySelector('.ico').textContent = '!';
    bannerText.innerHTML = `当前选中井暂未越界，但场地内已有 <b>${riskCount}</b> 口采井井距小于临界值。`;
  } else {
    banner.classList.add('ok');
    banner.querySelector('.ico').textContent = '✓';
    bannerText.innerHTML = `当前 <b>${PATTERNS[state.pattern].label}</b> 井距大于临界值，预计评价年限内不会发生强烈热突破。可继续增大回灌流量或拖近井距观察临界变化。`;
  }

  renderWellList();
}

function renderWellList() {
  const list = $('wellList');
  const signature = state.wells.map((w) => w.id).join('|');

  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature;
    list.innerHTML = state.wells.map((w) => `
      <button class="well-row" data-select="${w.id}" data-well-row="${w.id}">
        <i class="well-dot"></i>
        <span class="well-id">${w.id}</span>
        <span class="well-meta"></span>
        <span class="well-status"></span>
      </button>`).join('');
  }

  state.wells.forEach((w) => {
    const row = list.querySelector(`[data-well-row="${w.id}"]`);
    if (!row) return;

    const other = nearestWell(w, w.type === 'prod' ? 'inj' : 'prod');
    const d = other ? Math.round(dist(w, other)) : 0;
    const risk = wellRisk(w);
    const selected = w.id === state.selectedId;
    const color = w.type === 'inj' ? 'var(--inj)' : 'var(--prod)';
    const meta = w.type === 'inj'
      ? `回灌 · 最近 ${other?.id || '—'} ${d}m`
      : `采出 · T ${producerModel(w).temp.toFixed(0)}°C · ${d}m`;

    row.classList.toggle('selected', selected);
    row.classList.toggle('risk', risk);
    row.querySelector('.well-id').textContent = w.id;
    row.querySelector('.well-meta').textContent = meta;

    const dot = row.querySelector('.well-dot');
    dot.style.background = color;
    dot.style.boxShadow = `0 0 8px ${color}`;

    const status = row.querySelector('.well-status');
    status.textContent = risk ? '干扰' : '正常';
    status.className = `well-status ${risk ? 'risk' : 'ok'}`;
  });
}

function renderCompare() {
  const order = ['pair', 'five', 'row'];
  const data = order.map((id) => {
    const cfg = PATTERNS[id];
    const bt = breakthroughYears(cfg.typical, cfg, state.flow);
    return { id, ...cfg, bt };
  });
  const maxBt = Math.max(24, ...data.map((d) => d.bt));
  $('compareList').innerHTML = data.map((d) => {
    const cls = d.bt < 8 ? 'fast' : d.bt < 17 ? 'mid' : '';
    const active = state.pattern === d.id ? 'active' : '';
    return `
      <div class="compare-row ${active}" data-pattern="${d.id}" role="button" tabindex="0">
        <div class="compare-name">${d.label}<small>${d.typical} m</small></div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${clamp((d.bt / maxBt) * 100, 8, 100).toFixed(1)}%"></div></div>
        <div class="compare-val">${d.bt.toFixed(1)} a<small>突破时间</small></div>
      </div>`;
  }).join('');
}

/* -------------------------------- SVG 图表 -------------------------------- */

function clearSvg(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text !== null) node.textContent = text;
  return node;
}

function renderCharts() {
  renderCompare();
  renderFlowChart();
  renderTimeChart();
}

function niceMax(v, step = 5) {
  return Math.max(step, Math.ceil(v / step) * step);
}

function renderFlowChart() {
  const svg = $('flowChart');
  if (!svg) return;
  clearSvg(svg);

  const W = 360;
  const H = 202;
  const m = { l: 42, r: 16, t: 18, b: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const qMin = 40;
  const qMax = 260;

  const samples = [];
  for (let q = qMin; q <= qMax; q += 2) samples.push({ q, p: fieldPower(q, PHYS.designYears) });
  const peak = samples.reduce((a, b) => (b.p > a.p ? b : a), samples[0]);
  const currentP = fieldPower(state.flow, PHYS.designYears);
  const yMax = niceMax(Math.max(...samples.map((s) => s.p), currentP) * 1.12, 5);

  const X = (q) => m.l + ((q - qMin) / (qMax - qMin)) * pw;
  const Y = (p) => m.t + ph - (p / yMax) * ph;

  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'flowArea', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#45e3ff', 'stop-opacity': 0.34 }));
  grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#45e3ff', 'stop-opacity': 0.02 }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  for (let i = 0; i <= 4; i++) {
    const val = (yMax / 4) * i;
    const y = Y(val);
    svg.appendChild(svgEl('line', { x1: m.l, y1: y, x2: W - m.r, y2: y, stroke: 'rgba(148,184,220,.16)', 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: m.l - 7, y: y + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: '#7894b2', 'font-family': 'Consolas' }, val.toFixed(0)));
  }

  [40, 80, 120, 160, 200, 240].forEach((q) => {
    svg.appendChild(svgEl('text', { x: X(q), y: H - 10, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#7894b2', 'font-family': 'Consolas' }, String(q)));
  });
  svg.appendChild(svgEl('text', { x: m.l + pw / 2, y: H - 3, 'text-anchor': 'middle', 'font-size': 10, fill: '#8fa9c6' }, '回灌流量 m³/h'));

  const lineD = samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.q).toFixed(1)},${Y(s.p).toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${X(qMax)},${m.t + ph} L${X(qMin)},${m.t + ph} Z`;
  svg.appendChild(svgEl('path', { d: areaD, fill: 'url(#flowArea)' }));
  svg.appendChild(svgEl('path', { d: lineD, fill: 'none', stroke: '#45e3ff', 'stroke-width': 2.6, 'stroke-linejoin': 'round' }));

  svg.appendChild(svgEl('line', { x1: X(peak.q), y1: m.t, x2: X(peak.q), y2: m.t + ph, stroke: '#ffd166', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
  svg.appendChild(svgEl('circle', { cx: X(peak.q), cy: Y(peak.p), r: 5.5, fill: '#ffd166', stroke: '#1a2940', 'stroke-width': 2 }));
  const peakText = svgEl('text', {
    x: clamp(X(peak.q) + 8, m.l + 4, W - 88),
    y: Math.max(14, Y(peak.p) - 10),
    'font-size': 10.5,
    'font-weight': 800,
    fill: '#ffd166'
  }, `拐点 Q*=${peak.q}`);
  svg.appendChild(peakText);

  svg.appendChild(svgEl('line', { x1: X(state.flow), y1: m.t, x2: X(state.flow), y2: m.t + ph, stroke: '#ffffff', 'stroke-width': 1.2, opacity: 0.75 }));
  svg.appendChild(svgEl('circle', { cx: X(state.flow), cy: Y(currentP), r: 5, fill: '#ffffff', stroke: '#2563eb', 'stroke-width': 2.5 }));

  const pastPeak = state.flow > peak.q + 6;
  $('peakLabel').textContent = `峰值拐点 Q*≈${peak.q} m³/h${pastPeak ? ' · 当前已越过，功率下降' : ''}`;
  $('peakLabel').style.color = pastPeak ? 'var(--danger)' : 'var(--muted)';
}

function renderTimeChart() {
  const svg = $('timeChart');
  if (!svg) return;
  clearSvg(svg);

  const W = 360;
  const H = 222;
  const m = { l: 42, r: 14, t: 14, b: 34 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const producers = wellsOfType('prod');

  const series = producers.map((p) => {
    const points = [];
    for (let t = 0; t <= 30.001; t += 0.25) points.push({ t, power: producerModel(p, t, state.flow).power });
    const current = producerModel(p);
    return { p, points, current, risk: current.risk };
  });

  const maxPower = Math.max(2, ...series.flatMap((s) => s.points.map((pt) => pt.power)));
  const yMax = niceMax(maxPower * 1.12, 2);
  const X = (t) => m.l + (t / 30) * pw;
  const Y = (v) => m.t + ph - (v / yMax) * ph;

  for (let i = 0; i <= 4; i++) {
    const val = (yMax / 4) * i;
    const y = Y(val);
    svg.appendChild(svgEl('line', { x1: m.l, y1: y, x2: W - m.r, y2: y, stroke: 'rgba(148,184,220,.15)' }));
    svg.appendChild(svgEl('text', { x: m.l - 7, y: y + 3.5, 'text-anchor': 'end', 'font-size': 9.5, fill: '#7894b2', 'font-family': 'Consolas' }, val.toFixed(0)));
  }
  [0, 5, 10, 15, 20, 25, 30].forEach((t) => {
    svg.appendChild(svgEl('text', { x: X(t), y: H - 10, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#7894b2', 'font-family': 'Consolas' }, String(t)));
  });
  svg.appendChild(svgEl('text', { x: m.l + pw / 2, y: H - 3, 'text-anchor': 'middle', 'font-size': 10, fill: '#8fa9c6' }, '演化时间 / a'));

  svg.appendChild(svgEl('line', { x1: X(state.time), y1: m.t, x2: X(state.time), y2: m.t + ph, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.2, 'stroke-dasharray': '4 4' }));

  series.forEach((s) => {
    const selected = s.p.id === state.selectedId;
    const color = s.risk ? '#ff4263' : '#ff9f43';
    const d = s.points.map((pt, i) => `${i ? 'L' : 'M'}${X(pt.t).toFixed(1)},${Y(pt.power).toFixed(1)}`).join(' ');
    svg.appendChild(svgEl('path', {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': selected ? 3.2 : 1.8,
      opacity: state.selectedId && !selected ? 0.62 : 0.95,
      'stroke-linejoin': 'round'
    }));
    svg.appendChild(svgEl('circle', {
      cx: X(state.time),
      cy: Y(s.current.power),
      r: selected ? 5 : 3.8,
      fill: color,
      stroke: '#081321',
      'stroke-width': 1.5
    }));
  });

  const legend = $('timeLegend');
  const legendSignature = series.map((s) => `${s.p.id}:${s.risk ? 1 : 0}`).join('|');
  if (legend.dataset.signature !== legendSignature) {
    legend.dataset.signature = legendSignature;
    legend.innerHTML = series.map((s) => `
      <button class="legend-item ${s.risk ? 'red' : ''}" data-select="${s.p.id}" type="button">
        <i class="line" style="background:${s.risk ? 'var(--danger)' : '#ff9f43'}"></i>${s.p.id}${s.risk ? ' · 热干扰标红' : ''}
      </button>`).join('');
  }
}

/* ------------------------------- 剖面 Canvas ------------------------------- */

function resizeSectionCanvas() {
  const canvas = $('sectionCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(280, rect.width);
  const h = Math.max(210, rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
}

function depthBackground(z, zMin, zTop, zBottom) {
  if (z < zTop) return 45 + clamp((z - zMin) / (zTop - zMin), 0, 1) * 82;
  if (z <= zBottom) return 132 + ((z - zTop) / (zBottom - zTop)) * 12;
  return 144 + Math.min(12, ((z - zBottom) / 260) * 12);
}

const TEMP_STOPS = [
  [42, [23, 59, 145]],
  [60, [22, 137, 214]],
  [82, [34, 211, 238]],
  [100, [155, 225, 93]],
  [116, [253, 224, 71]],
  [128, [251, 124, 52]],
  [140, [169, 22, 44]]
];

function temperatureColor(t) {
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    const [t2, c2] = TEMP_STOPS[i + 1];
    if (t <= t2) {
      const k = (t - t1) / (t2 - t1);
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * k),
        Math.round(c1[1] + (c2[1] - c1[1]) * k),
        Math.round(c1[2] + (c2[2] - c1[2]) * k)
      ];
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

function renderSection() {
  const canvas = $('sectionCanvas');
  if (!canvas || !app) return;
  resizeSectionCanvas();

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W < 10 || H < 10) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  sectionHits = [];

  const ctxSel = selectionContext();
  if (!ctxSel.producer || !ctxSel.injector) {
    ctx.fillStyle = '#8fa9c6';
    ctx.fillText('当前井网缺少配对井', 20, 30);
    return;
  }

  const { producer, injector, distance: L, critical, risk } = ctxSel;
  const cfg = PATTERNS[state.pattern];
  const bt = breakthroughYears(L, cfg, state.flow);

  const m = { l: 48, r: 20, t: 34, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const zMin = 1200;
  const zMax = 2400;
  const zTop = 1880;
  const zBottom = 2140;
  const h = zBottom - zTop;
  const zc = (zTop + zBottom) / 2;
  const xMin = -0.24 * L;
  const xMax = 1.24 * L;

  const X = (x) => m.l + ((x - xMin) / (xMax - xMin)) * pw;
  const Z = (z) => m.t + ((z - zMin) / (zMax - zMin)) * ph;

  // 低分辨率温度场
  const cols = Math.max(120, Math.min(240, Math.round(pw / 3)));
  const rows = 92;
  heatCanvas.width = cols;
  heatCanvas.height = rows;
  const hctx = heatCanvas.getContext('2d');
  const img = hctx.createImageData(cols, rows);
  const Rf = L * Math.min(1.06, state.time / bt);
  const diffusion = 22 + 13 * Math.sqrt(Math.max(0.1, state.time));
  const depletion = 1 - Math.exp(-state.time / 6);

  for (let j = 0; j < rows; j++) {
    const z = zMin + ((j + 0.5) / rows) * (zMax - zMin);
    for (let i = 0; i < cols; i++) {
      const x = xMin + ((i + 0.5) / cols) * (xMax - xMin);
      const bg = depthBackground(z, zMin, zTop, zBottom);

      const verticalWeight = (z - zc) * 1.55;
      const rInj = Math.hypot(x, verticalWeight);
      let coldInj = sigmoid01((Rf - rInj) / diffusion);

      const outside = Math.max(0, Math.abs(z - zc) - h / 2);
      const confine = Math.exp(-(outside * outside) / (2 * 42 * 42));
      coldInj *= confine;

      const zRel = clamp((z - zTop) / h, 0, 1);
      const coneR = (48 + 132 * depletion) * (1.22 - 0.68 * zRel);
      const funnelShape = sigmoid01((coneR - Math.abs(x - L)) / 24);
      const coldFun = 0.46 * depletion * funnelShape * confine;

      const cold = clamp(1 - (1 - coldInj) * (1 - coldFun), 0, 1);
      const temp = bg - 98 * cold;
      const [r, g, b] = temperatureColor(temp);
      const k = (j * cols + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  hctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(heatCanvas, m.l, m.t, pw, ph);

  // 图框与坐标轴
  ctx.strokeStyle = 'rgba(157,197,235,.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(m.l, m.t, pw, ph);

  [1200, 1400, 1600, 1800, 2000, 2200, 2400].forEach((z) => {
    const y = Z(z);
    ctx.strokeStyle = 'rgba(255,255,255,.13)';
    ctx.beginPath();
    ctx.moveTo(m.l, y);
    ctx.lineTo(m.l + pw, y);
    ctx.stroke();
    ctx.fillStyle = '#7894b2';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${z}`, m.l - 7, y + 3);
  });
  ctx.fillStyle = '#8fa9c6';
  ctx.font = '10px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('深度 m', 8, m.t - 12);

  // 热储层边界
  const rzTop = Z(zTop);
  const rzBottom = Z(zBottom);
  ctx.strokeStyle = 'rgba(69,227,255,.75)';
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(m.l, rzTop);
  ctx.lineTo(m.l + pw, rzTop);
  ctx.moveTo(m.l, rzBottom);
  ctx.lineTo(m.l + pw, rzBottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(220,239,255,.72)';
  ctx.font = '11px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('盖层', m.l + 8, Z(1550));
  ctx.fillStyle = 'rgba(224,251,255,.95)';
  ctx.fillText(`热储层 / h=${h} m`, m.l + 8, Z(zc) + 4);
  ctx.fillStyle = 'rgba(220,239,255,.62)';
  ctx.fillText('基底', m.l + 8, Z(2280));

  // 冷水锋面
  ctx.save();
  ctx.beginPath();
  ctx.rect(m.l, rzTop, pw, rzBottom - rzTop);
  ctx.clip();
  const frontPxX = Rf / (xMax - xMin) * pw;
  const frontPxY = h * 0.78 / (zMax - zMin) * ph;
  if (Rf > 4) {
    ctx.strokeStyle = 'rgba(224,254,255,.92)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.ellipse(X(0), Z(zc), frontPxX, frontPxY, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(224,254,255,.9)';
    ctx.font = '10px "Microsoft YaHei"';
    ctx.textAlign = 'center';
    const labelX = clamp(X(Rf * 0.72), m.l + 40, m.l + pw - 40);
    ctx.fillText('冷水锋面', labelX, rzTop + 16);
  }

  // 采井降温漏斗轮廓：上宽下窄，随累计采出程度扩张
  ctx.strokeStyle = risk ? 'rgba(255,138,160,.82)' : 'rgba(165,243,252,.72)';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let k = 0; k <= 36; k++) {
    const zRel = k / 36;
    const z = zTop + zRel * h;
    const coneR = (48 + 132 * depletion) * (1.22 - 0.68 * zRel);
    const x = X(L - coneR);
    const y = Z(z);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let k = 36; k >= 0; k--) {
    const zRel = k / 36;
    const z = zTop + zRel * h;
    const coneR = (48 + 132 * depletion) * (1.22 - 0.68 * zRel);
    ctx.lineTo(X(L + coneR), Z(z));
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  if (depletion > 0.12) {
    const fx = clamp(X(L) - 78, m.l + 48, m.l + pw - 58);
    ctx.font = '800 10px "Microsoft YaHei"';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(6,16,29,.82)';
    ctx.strokeText('降温漏斗', fx, rzTop + 16);
    ctx.fillStyle = risk ? 'rgba(255,196,206,.98)' : 'rgba(207,250,254,.98)';
    ctx.fillText('降温漏斗', fx, rzTop + 16);
  }
  ctx.restore();

  // 井轨迹与井口
  drawSectionWell(ctx, injector.id, 'inj', 0, X, Z, zTop, zBottom, m);
  drawSectionWell(ctx, producer.id, 'prod', L, X, Z, zTop, zBottom, m);

  // A-A' 与距离轴
  ctx.fillStyle = '#dcecff';
  ctx.font = '800 13px "Microsoft YaHei"';
  ctx.textAlign = 'center';
  ctx.fillText('A', X(0), H - 11);
  ctx.fillText("A′", X(L), H - 11);
  ctx.strokeStyle = 'rgba(220,239,255,.25)';
  ctx.beginPath();
  ctx.moveTo(X(0), H - 20);
  ctx.lineTo(X(L), H - 20);
  ctx.stroke();
  ctx.fillStyle = '#8fa9c6';
  ctx.font = '10px Consolas';
  ctx.fillText(`井距 ${Math.round(L)} m`, (X(0) + X(L)) / 2, H - 22);

  if (risk) {
    ctx.fillStyle = 'rgba(255,66,99,.95)';
    ctx.font = '900 12px "Microsoft YaHei"';
    ctx.textAlign = 'right';
    ctx.fillText('⚠ 临界井距以下：热干扰通道形成', m.l + pw - 4, m.t + 16);
  }

  $('sectionTitle').textContent = `热储层温度剖面 A–A′：${injector.id} → ${producer.id}`;
  $('sectionSub').textContent = risk
    ? `当前井距 ${Math.round(L)} m < 临界 ${Math.round(critical)} m；见峰后采温下降与功率曲线标红。`
    : `沿 ${injector.id} 回灌井至 ${producer.id} 采井切取；预测热突破 ${bt.toFixed(1)} a。`;
}

function drawSectionWell(ctx, id, type, xM, X, Z, zTop, zBottom, m) {
  const xp = X(xM);
  const topY = m.t - 15;
  const bottomY = Z(zBottom) + 4;
  const color = type === 'inj' ? '#39c5ff' : '#ff8a3d';
  const selected = state.selectedId === id;

  if (selected) {
    ctx.beginPath();
    ctx.arc(xp, topY - 2, 17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(69,227,255,.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 套管
  ctx.strokeStyle = '#1b2b40';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(xp, topY);
  ctx.lineTo(xp, bottomY);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(xp, topY);
  ctx.lineTo(xp, bottomY);
  ctx.stroke();

  // 射孔段
  const y1 = Z(zTop);
  const y2 = Z(zBottom);
  ctx.strokeStyle = 'rgba(255,255,255,.72)';
  ctx.lineWidth = 1.4;
  for (let y = y1 + 5; y < y2 - 3; y += 10) {
    ctx.beginPath();
    ctx.moveTo(xp - 7, y);
    ctx.lineTo(xp + 7, y - 4);
    ctx.stroke();
  }

  // 简化井口装置
  ctx.fillStyle = '#263a55';
  ctx.strokeStyle = '#c9def5';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(xp - 13, topY - 7, 26, 10, 3) : ctx.rect(xp - 13, topY - 7, 26, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(xp, topY - 12, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = type === 'inj' ? '#bdefff' : '#ffe0c7';
  ctx.font = '900 12px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(id, xp, topY - 25);

  // 流向箭头
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (type === 'inj') {
    ctx.moveTo(xp, y1 + 18);
    ctx.lineTo(xp, y1 + 34);
    ctx.moveTo(xp - 5, y1 + 29);
    ctx.lineTo(xp, y1 + 35);
    ctx.lineTo(xp + 5, y1 + 29);
  } else {
    ctx.moveTo(xp, y1 + 35);
    ctx.lineTo(xp, y1 + 19);
    ctx.moveTo(xp - 5, y1 + 24);
    ctx.lineTo(xp, y1 + 18);
    ctx.lineTo(xp + 5, y1 + 24);
  }
  ctx.stroke();

  sectionHits.push({ id, x: xp, y: topY - 12, r: 22 });
}

function onSectionClick(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = sectionHits.find((h) => Math.hypot(x - h.x, y - h.y) <= h.r + 6);
  if (hit) selectWell(hit.id);
}

function onSectionPointerMove(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = sectionHits.some((h) => Math.hypot(x - h.x, y - h.y) <= h.r + 6);
  e.currentTarget.style.cursor = hit ? 'pointer' : 'crosshair';
}

/* ---------------------------------- 启动 ---------------------------------- */

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  initPixi();
  bindUI();
  updatePlayButtons();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
