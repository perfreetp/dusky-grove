import {
  PRESET_THROW, ALIGN_X, localThrowAt, sliceBounds
} from './model.js';
import { createProfileView } from './profile.js';
import { createBlockScene } from './scene3d.js';

const $ = id => document.getElementById(id);

const state = {
  mode: 'dip',
  sliceDip: -2.8,
  sliceStrike: 1.55,
  throwValue: PRESET_THROW,
  playing: false
};

const getSlice = () => state.mode === 'dip' ? state.sliceDip : state.sliceStrike;
function setSlice(value, mode = state.mode) {
  if (mode === 'dip') state.sliceDip = value;
  else state.sliceStrike = value;
}

const profileCanvas = $('profileCanvas');
const hoverTip = $('hoverTip');

const profile = createProfileView(profileCanvas, hoverTip, {
  getMode: () => state.mode,
  getSlice,
  getThrow: () => state.throwValue
});

const scene = createBlockScene($('threeHost'), profile.ampCanvas, {
  getMode: () => state.mode,
  getSlice,
  getThrow: () => state.throwValue,
  onSliceDrag: (value, mode) => {
    setSlice(value, mode);
    syncSliceUI();
    scene.updateTransform();
    profile.update();
    scene.texture.needsUpdate = true;
    updateStats();
  }
});

const sliceSlider = $('sliceSlider');
const throwSlider = $('throwSlider');
const sliceValue = $('sliceValue');
const throwValueEl = $('throwValue');
const offsetReadout = $('offsetReadout');
const layerReadout = $('layerReadout');
const modeBadge = $('modeBadge');
const modeExplain = $('modeExplain');
const playBtn = $('playBtn');
const dipBtn = $('modeDip');
const strikeBtn = $('modeStrike');

function syncSliceUI() {
  const bounds = sliceBounds(state.mode);
  sliceSlider.min = bounds.min;
  sliceSlider.max = bounds.max;
  sliceSlider.value = getSlice();
  const axis = state.mode === 'dip' ? 'X' : 'Y';
  sliceValue.textContent = `${axis} = ${getSlice().toFixed(2)} km`;
}

function updateStats() {
  if (state.mode === 'dip') {
    const t = localThrowAt(state.sliceDip, state.throwValue);
    offsetReadout.textContent = `${t.toFixed(2)} km`;
  } else {
    offsetReadout.textContent = `0–${state.throwValue.toFixed(2)} km`;
  }
  layerReadout.textContent = `${profile.layerCount()} 层`;
}

function updatePlayButton() {
  playBtn.textContent = state.playing ? '⏸ 暂停推进' : '▶ 自动推进';
  playBtn.classList.toggle('playing', state.playing);
}

function updateModeUI() {
  dipBtn.classList.toggle('active', state.mode === 'dip');
  strikeBtn.classList.toggle('active', state.mode === 'strike');
  modeBadge.textContent = state.mode === 'dip'
    ? '倾向剖面 · X 固定，剖面轴 Y'
    : '走向剖面 · Y 固定，剖面轴 X';
  modeExplain.textContent = state.mode === 'dip'
    ? '倾向剖面横穿倾斜断层：H3 等层位在红色断层两侧错开；点击“自动推进”后沿 X（走向）扫描，接近 x≈4.25 的断层尖端时错距归零，色带重新对齐。'
    : '走向剖面平行于断层走向：横轴变为 X，层位呈宽缓弯曲，透镜状 H5 出现或尖灭，因此可追踪层数改变；红色断层迹线接近水平，拖动 Y 可观察断层穿过的层位变化。';
  syncSliceUI();
}

function refreshProfileAndTexture() {
  profile.update();
  scene.texture.needsUpdate = true;
}

function fullRefresh() {
  updateModeUI();
  throwSlider.value = state.throwValue;
  throwValueEl.textContent = `${state.throwValue.toFixed(2)} km`;
  scene.updateTransform();
  scene.updateHorizons();
  refreshProfileAndTexture();
  updateStats();
  updatePlayButton();
}

function chooseMode(mode) {
  state.mode = mode;
  state.playing = false;
  updateModeUI();
  scene.updateTransform();
  refreshProfileAndTexture();
  updateStats();
  updatePlayButton();
}

dipBtn.addEventListener('click', () => chooseMode('dip'));
strikeBtn.addEventListener('click', () => chooseMode('strike'));

sliceSlider.addEventListener('input', () => {
  state.playing = false;
  updatePlayButton();
  setSlice(Number(sliceSlider.value));
  syncSliceUI();
  scene.updateTransform();
  refreshProfileAndTexture();
  updateStats();
});

throwSlider.addEventListener('input', () => {
  state.throwValue = Number(throwSlider.value);
  throwValueEl.textContent = `${state.throwValue.toFixed(2)} km`;
  scene.updateHorizons();
  refreshProfileAndTexture();
  updateStats();
});

playBtn.addEventListener('click', () => {
  const bounds = sliceBounds(state.mode);
  if (!state.playing && getSlice() >= bounds.max - 0.03) setSlice(bounds.min);
  state.playing = !state.playing;
  syncSliceUI();
  updatePlayButton();
});

$('alignBtn').addEventListener('click', () => {
  state.playing = false;
  state.mode = 'dip';
  state.sliceDip = ALIGN_X;
  updateModeUI();
  updatePlayButton();
  scene.updateTransform();
  refreshProfileAndTexture();
  updateStats();
});

$('presetBtn').addEventListener('click', () => {
  state.playing = false;
  state.mode = 'dip';
  state.sliceDip = -2.8;
  state.sliceStrike = 1.55;
  state.throwValue = PRESET_THROW;
  fullRefresh();
});

$('resetView').addEventListener('click', () => scene.resetCamera());

window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    playBtn.click();
  }
});

fullRefresh();

scene.start(dt => {
  if (!state.playing) return;
  const bounds = sliceBounds(state.mode);
  let next = getSlice() + dt * 0.72;
  if (next >= bounds.max) {
    next = bounds.max;
    state.playing = false;
    updatePlayButton();
  }
  setSlice(next);
  syncSliceUI();
  scene.updateTransform();
  refreshProfileAndTexture();
  updateStats();
});
