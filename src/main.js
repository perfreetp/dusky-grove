import './style.css';
import { createGlacierScene } from './scene.js';
import {
  CREVASSES,
  SLOPE,
  evaluateBridge,
  formatHour,
  getBridgeSchedule,
  shadowDisplacement,
  slopeModel,
  sunAtHour,
  sunVector,
} from './model.js';

const $ = (id) => document.getElementById(id);

const els = {
  routeSummary: $('route-summary'),
  sunArrow: $('sun-arrow'),
  slopeArrow: $('slope-arrow'),
  hudReadout: $('hud-readout'),
  vectorNote: $('vector-note'),
  timeSlider: $('time-slider'),
  timeValue: $('time-value'),
  azimuthSlider: $('azimuth-slider'),
  azimuthValue: $('azimuth-value'),
  elevationSlider: $('elevation-slider'),
  elevationValue: $('elevation-value'),
  slopeSlider: $('slope-slider'),
  slopeValue: $('slope-value'),
  playTime: $('play-time'),
  resetView: $('reset-view'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  detailPanel: $('detail-panel'),
  closureRanking: $('closure-ranking'),
  bridgeList: $('bridge-list'),
};

const initialSun = sunAtHour(7);
const state = {
  hour: 7,
  azimuth: initialSun.azimuth,
  elevation: initialSun.elevation,
  slopeAngle: SLOPE.angleDeg,
  selectedId: 'b2',
  manualSun: false,
};

let scene = null;
let bridgeData = collectBridgeData();
let playing = false;
let rafId = 0;
let lastFrame = 0;

function currentSlope() {
  return { ...SLOPE, angleDeg: state.slopeAngle };
}

function collectBridgeData() {
  const slope = currentSlope();
  return CREVASSES.flatMap((crevasse) =>
    crevasse.bridges.map((bridge) => ({
      crevasse,
      bridge,
      schedule: getBridgeSchedule(bridge, crevasse, slope),
    })),
  );
}

function evaluatedData() {
  const sun = sunVector(state);
  const slope = currentSlope();
  return bridgeData.map((item) => ({
    ...item,
    evaluation: evaluateBridge(item.bridge, item.crevasse, sun, slope),
  }));
}

function cardinal(azimuth) {
  const labels = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return labels[Math.round(((azimuth % 360) / 45)) % 8];
}

function updateControls() {
  els.timeSlider.value = String(state.hour ?? 7);
  els.timeValue.textContent = state.manualSun ? '手动太阳' : formatHour(state.hour);
  els.azimuthSlider.value = String(Math.round(state.azimuth));
  els.azimuthValue.textContent = `${Math.round(state.azimuth)}°`;
  els.elevationSlider.value = String(Math.round(state.elevation));
  els.elevationValue.textContent = `${Math.round(state.elevation)}°`;
  els.slopeSlider.value = String(state.slopeAngle);
  els.slopeValue.textContent = `${state.slopeAngle}°`;

  els.sunArrow.style.transform =
    `translateX(-50%) rotate(${state.azimuth}deg)`;
  els.sunArrow.style.height = `${17 + ((89 - state.elevation) / 87) * 19}px`;
  els.slopeArrow.style.transform =
    `translateX(-50%) rotate(${SLOPE.downAzimuthDeg - 180}deg)`;

  const sun = sunVector(state);
  const slope = currentSlope();
  const displacement = shadowDisplacement(10, sun, slope);
  const magnitude = Math.hypot(displacement.x, displacement.y);
  const shadowAzimuth =
    (Math.atan2(displacement.x, -displacement.y) / Math.PI) * 180 + 360;
  const shadowAz = ((shadowAzimuth % 360) + 360) % 360;
  const sm = slopeModel(slope);
  const incidence = Math.acos(Math.min(1, Math.max(-1,
    sun.x * sm.normal.x + sun.y * sm.normal.y + sun.z * sm.normal.z))) * 180 / Math.PI;

  els.hudReadout.innerHTML = `
    <strong>阴影去向 ${Math.round(shadowAz)}° ${cardinal(shadowAz)}</strong><br>
    每 10 m 垂深沿坡面位移 ${magnitude.toFixed(1)} m；桥面入射角 ${incidence.toFixed(0)}°<br>
    坡度 ${slope.angleDeg}° / 坡向 ${SLOPE.downAzimuthDeg}°，方位与坡向共同改变投影分母。
  `;

  els.vectorNote.textContent =
    `q = −H·Sₕ / (S_z − g·Sₕ)；当前投影项 ${displacement.denominator.toFixed(3)}` +
    `${displacement.valid ? '' : '，光线近掠坡面，实际阴影会被强烈拉长/截断。'}`;
}

function renderSummary(data) {
  const route = data
    .filter((item) => item.bridge.routeOrder != null)
    .sort((a, b) => a.bridge.routeOrder - b.bridge.routeOrder);
  const passCount = route.filter((item) => item.evaluation.passable).length;
  const firstLost = [...route].sort((a, b) => {
    const av = a.schedule.closureHour ?? 99;
    const bv = b.schedule.closureHour ?? 99;
    return av - bv;
  })[0];

  els.routeSummary.textContent =
    `当前 ${passCount}/3 座路线雪桥可通行 · 最先失去窗口：` +
    `${firstLost.bridge.name.split(' · ')[0]} ≈ ${formatHour(firstLost.schedule.closureHour)}`;

  els.closureRanking.innerHTML = [...route]
    .sort((a, b) => (a.schedule.closureHour ?? 99) - (b.schedule.closureHour ?? 99))
    .map((item, index) => `
      <span class="rank-chip ${index === 0 ? 'first' : ''}">
        ${index + 1}. ${item.bridge.name.split(' · ')[0]} ·
        ${item.schedule.closureHour ? `${formatHour(item.schedule.closureHour)} 关闭` : '正午仍可通行'}
      </span>
    `)
    .join('');
}

function coverageClass(coverage) {
  if (coverage >= 0.985) return 'block';
  if (coverage >= 0.72) return 'warn';
  return 'pass';
}

function crossSectionSVG(item) {
  const { crevasse: c, bridge: b, evaluation: ev } = item;
  const topL = 36;
  const topR = 284;
  const topW = topR - topL;
  const topY = 55;
  const bottomY = 126;
  const bottomRatio = Math.max(0.14, ev.frame.bottomWidth / c.width);
  const bottomW = topW * bottomRatio;
  const bottomL = 160 - bottomW / 2;
  const bottomR = 160 + bottomW / 2;
  const len = b.to - b.from;
  const thickH = 8 + Math.min(1, b.thickness / 4.4) * 15;
  const deckY = 39;

  const sunNormal = ev.sun.x * ev.frame.normal.x + ev.sun.y * ev.frame.normal.y;
  const dir = Math.abs(ev.shadow.localCross) > 0.03
    ? Math.sign(ev.shadow.localCross)
    : (sunNormal >= 0 ? -1 : 1);
  const coverage = ev.shadow.coverage;
  const shadowW = coverage * topW;
  const shadowX = dir > 0 ? topL : topR - shadowW;
  const deckX = topL - 4;
  const deckW = topW + 8;
  const deckShadowW = coverage * deckW;
  const deckShadowX = dir > 0 ? deckX : deckX + deckW - deckShadowW;
  const sunX = dir > 0 ? 18 : 302;

  return `
  <svg class="section-svg" viewBox="0 0 320 154" role="img"
       aria-label="雪桥梯形横截面与移动阴影">
    <defs>
      <clipPath id="section-clip">
        <polygon points="${topL},${topY} ${topR},${topY} ${bottomR},${bottomY} ${bottomL},${bottomY}"></polygon>
      </clipPath>
    </defs>
    <rect x="0" y="28" width="320" height="14" fill="#eaf8fd"></rect>
    <line x1="8" y1="42" x2="${topL - 3}" y2="42" stroke="#9dc8da" stroke-width="3" stroke-linecap="round"></line>
    <line x1="${topR + 3}" y1="42" x2="312" y2="42" stroke="#9dc8da" stroke-width="3" stroke-linecap="round"></line>

    <polygon points="${topL},${topY} ${topR},${topY} ${bottomR},${bottomY} ${bottomL},${bottomY}"
             fill="#69a9c7" stroke="#397b9c" stroke-width="2"></polygon>
    <polygon points="${bottomL - 5},${bottomY - 8} ${bottomR + 5},${bottomY - 8} ${bottomR},${bottomY} ${bottomL},${bottomY}"
             fill="#173b57"></polygon>
    <rect x="${bottomL}" y="${bottomY - 3}" width="${bottomW}" height="7" fill="#061827" opacity="0.75"></rect>

    <rect x="${shadowX}" y="${topY}" width="${shadowW}" height="${bottomY - topY + 2}"
          clip-path="url(#section-clip)" fill="#020d1a" opacity="0.48"></rect>

    <rect x="${deckX}" y="${deckY}" width="${deckW}" height="${thickH}" rx="5"
          fill="#f8fdff" stroke="#a9cfdf" stroke-width="2"></rect>
    <rect x="${deckShadowX}" y="${deckY}" width="${deckShadowW}" height="${thickH}" rx="4"
          fill="#020d1a" opacity="${ev.deckIlluminated ? 0.34 + coverage * 0.3 : 0.62}"></rect>

    <circle cx="${sunX}" cy="18" r="9" fill="#ffd166" stroke="#f59e0b" stroke-width="2"></circle>
    <line x1="${sunX + (dir > 0 ? 13 : -13)}" y1="24"
          x2="${sunX + (dir > 0 ? 31 : -31)}" y2="42"
          stroke="#f59e0b" stroke-width="3" stroke-linecap="round"></line>

    <text x="160" y="148" text-anchor="middle" font-size="11" font-weight="800" fill="#5d788c">
      梯形横截面 · 上宽 ${c.width.toFixed(1)} m / 底宽 ${ev.frame.bottomWidth.toFixed(1)} m / 深 ${c.depth} m
    </text>
    <text x="160" y="31" text-anchor="middle"
          font-size="11" font-weight="900" fill="#075975"
          stroke="#f7fcff" stroke-width="3" paint-order="stroke">
      桥厚 T=${b.thickness.toFixed(2)} m
    </text>
  </svg>`;
}

function renderDetail(data) {
  const item = data.find((d) => d.bridge.id === state.selectedId) ?? data[0];
  if (!item) {
    els.detailPanel.innerHTML = '<p class="detail-empty">暂无可显示的雪桥。</p>';
    return;
  }
  state.selectedId = item.bridge.id;
  const { bridge: b, crevasse: c, evaluation: ev } = item;
  const passClass = ev.passable ? 'pass' : 'block';
  const coveragePct = ev.shadow.coverage * 100;
  const coverageBar = coverageClass(ev.shadow.coverage);
  const portalDarkness = Math.round(
    (0.34 + Math.min(1, b.thickness / 4.4) * 0.48) * 100,
  );
  const thicknessPct = Math.min(100, (b.thickness / 5) * 100);

  els.detailPanel.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${b.name}</h2>
        <p>${c.name} · 桥长 ${(b.to - b.from).toFixed(0)} m · 方位投影随太阳更新</p>
      </div>
      <span class="status-pill ${passClass}">${ev.passable ? '可通行' : '不可通行'}</span>
    </div>

    ${crossSectionSVG(item)}

    <div class="metric-grid">
      <div class="metric">
        <span>雪桥厚度</span>
        <div class="thickness-scale">
          <strong>${b.thickness.toFixed(2)} m</strong>
          <div class="thickness-track"><i class="thickness-dot" style="left:${thicknessPct}%"></i></div>
        </div>
      </div>
      <div class="metric">
        <span>桥下阴影浓度（表厚）</span>
        <strong>${portalDarkness}%</strong>
      </div>
      <div class="metric">
        <span>当前太阳角度下桥面</span>
        <strong>${ev.deckIlluminated ? '被照亮' : '未被照亮'}</strong>
      </div>
      <div class="metric">
        <span>光线与坡面法线夹角</span>
        <strong>${ev.incidenceDeg.toFixed(0)}°</strong>
      </div>
      <div class="metric full">
        <span>阴影覆盖雪桥全宽：${coveragePct.toFixed(0)}%（临界 98.5%）</span>
        <div class="bar"><i class="${coverageBar}" style="width:${Math.min(100, coveragePct)}%"></i></div>
      </div>
      <div class="metric">
        <span>横向阴影位移</span>
        <strong>${Math.abs(ev.shadow.localCross).toFixed(1)} m</strong>
      </div>
      <div class="metric">
        <span>沿裂缝方向位移</span>
        <strong>${ev.shadow.localX.toFixed(1)} m</strong>
      </div>
    </div>

    <p class="reason ${passClass}">${ev.reason}。判定：桥面${ev.deckIlluminated ? '受光 ✓' : '未受光 ✗'}，
      阴影${ev.shadow.coversFullWidth ? '覆盖全宽 ✗' : '未覆盖全宽 ✓'}。</p>
    <button type="button" class="play-button" id="focus-selected" style="width:100%;margin-top:10px;">
      在地形中定位该雪桥
    </button>
  `;
}

function renderBridgeList(data) {
  const sorted = [...data].sort((a, b) => {
    const ar = a.bridge.routeOrder ?? 99;
    const br = b.bridge.routeOrder ?? 99;
    if (ar !== br) return ar - br;
    return a.bridge.thickness - b.bridge.thickness;
  });
  const nowPct = state.hour == null ? 0 : ((state.hour - 6) / 6) * 100;

  els.bridgeList.innerHTML = sorted.map((item) => {
    const { bridge: b, crevasse: c, evaluation: ev, schedule } = item;
    const selected = b.id === state.selectedId ? 'selected' : '';
    const dot = ev.passable ? '' : 'block';
    const stateClass = ev.passable ? 'pass' : 'block';
    const left = ((schedule.firstPass ?? 6) - 6) / 6 * 100;
    const end = schedule.lastPass ?? 6;
    const width = Math.max(0, (end - (schedule.firstPass ?? 6)) / 6 * 100);
    return `
      <button type="button" class="bridge-button ${selected}" data-id="${b.id}">
        <i class="status-dot ${dot}"></i>
        <span class="bridge-main">
          <strong>${b.name}</strong>
          <small>厚 ${b.thickness.toFixed(2)} m · ${c.name} · 关闭约 ${formatHour(schedule.closureHour)}</small>
          <span class="timeline" aria-hidden="true">
            <span class="timeline-pass" style="left:${left}%;width:${width}%"></span>
            ${state.manualSun ? '' : `<span class="timeline-now" style="left:${nowPct}%"></span>`}
          </span>
        </span>
        <span class="bridge-state ${stateClass}">
          ${ev.passable ? '可通行' : '不可过'}<br>${Math.round(ev.shadow.coverage * 100)}%影
        </span>
      </button>
    `;
  }).join('');
}

function renderAll() {
  updateControls();
  const data = evaluatedData();
  scene?.update(state);
  renderSummary(data);
  renderDetail(data);
  renderBridgeList(data);
}

function pausePlay() {
  playing = false;
  cancelAnimationFrame(rafId);
  els.playTime.textContent = '▶ 从清晨演示';
  els.playTime.classList.remove('playing');
}

function startPlay() {
  if (playing) return;
  // The primary action is the prescribed dawn-to-noon replay.
  state.hour = 6;
  state.manualSun = false;
  playing = true;
  lastFrame = 0;
  els.playTime.textContent = '⏸ 暂停拖动';
  els.playTime.classList.add('playing');
  rafId = requestAnimationFrame(tick);
}

function tick(now) {
  if (!playing) return;
  if (!lastFrame) lastFrame = now;
  const deltaSeconds = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  state.hour = Math.min(12, (state.hour ?? 6) + deltaSeconds * 0.42);
  const sun = sunAtHour(state.hour);
  state.azimuth = sun.azimuth;
  state.elevation = sun.elevation;
  state.manualSun = false;
  renderAll();
  if (state.hour >= 12) {
    pausePlay();
  } else {
    rafId = requestAnimationFrame(tick);
  }
}

els.timeSlider.addEventListener('input', () => {
  pausePlay();
  state.hour = parseFloat(els.timeSlider.value);
  const sun = sunAtHour(state.hour);
  state.azimuth = sun.azimuth;
  state.elevation = sun.elevation;
  state.manualSun = false;
  renderAll();
});

els.azimuthSlider.addEventListener('input', () => {
  pausePlay();
  state.azimuth = parseFloat(els.azimuthSlider.value);
  state.manualSun = true;
  renderAll();
});

els.elevationSlider.addEventListener('input', () => {
  pausePlay();
  state.elevation = parseFloat(els.elevationSlider.value);
  state.manualSun = true;
  renderAll();
});

els.slopeSlider.addEventListener('input', () => {
  state.slopeAngle = parseFloat(els.slopeSlider.value);
  bridgeData = collectBridgeData();
  renderAll();
});

els.playTime.addEventListener('click', () => {
  if (playing) pausePlay();
  else startPlay();
});

els.bridgeList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  state.selectedId = button.dataset.id;
  scene?.select(state.selectedId, true);
  renderAll();
});

els.detailPanel.addEventListener('click', (event) => {
  if (event.target.closest('#focus-selected')) {
    scene?.focusBridge(state.selectedId);
  }
});

els.resetView.addEventListener('click', () => scene?.resetView());
els.zoomIn.addEventListener('click', () => scene?.zoomIn());
els.zoomOut.addEventListener('click', () => scene?.zoomOut());

renderAll();

createGlacierScene($('pixi-stage'), {
  onSelect: (id) => {
    state.selectedId = id;
    renderAll();
  },
}).then((createdScene) => {
  scene = createdScene;
  scene.select(state.selectedId);
  scene.update(state);
}).catch((error) => {
  console.error(error);
  els.hudReadout.textContent = `PixiJS 初始化失败：${error?.stack || error?.message || error}`;
});
