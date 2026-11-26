/* ============================================================
 * 全局状态（Solid Store）+ 命令式撤销/重做
 * 每次布局修改产生一条 Command：do() 前先快照，undo/redo
 * 用快照恢复（数据规模小，快照比反向 diff 更可靠）
 * 拖拽过程通过 beginDrag/commitDrag 合并为单条历史记录
 * ============================================================ */
import { createStore, produce } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { createProject, defaultWizard, makeSegment, makeSilo } from './model.js';
import { runPassabilityCheck, diffChecks } from './check.js';

// Solid store 的代理对象不能被 structuredClone 克隆，工程数据均为纯 JSON 结构
const snapshot = (p) => JSON.parse(JSON.stringify(p));

const [store, setStore] = createStore({
  wizard: defaultWizard(),
  project: null, // 向导未完成时为 null
  selected: { kind: null, id: null }, // {kind:'segment'|'silo', id}
  // 3D 场景交互态（不进历史）
  interaction: {
    dragging: null, // {kind:'segment'|'silo'|'pitch'|'opening'|'roller', ...}
    snapHint: null, // 吸附提示文本
    lastDropped: null // 松手回写的数值提示
  },
  checkRunning: false
});

// ---------- 撤销 / 重做 ----------
const undoStack = [];
const redoStack = [];
const [histVersion, setHistVersion] = createSignal(0);
const [undoDepth, setUndoDepth] = createSignal(0);
const [redoDepth, setRedoDepth] = createSignal(0);
const HIST_LIMIT = 100;

function syncHistSignals() {
  setUndoDepth(undoStack.length);
  setRedoDepth(redoStack.length);
}

function pushHistory(label) {
  undoStack.push({ label, snap: snapshot(store.project) });
  if (undoStack.length > HIST_LIMIT) undoStack.shift();
  redoStack.length = 0;
  setHistVersion((v) => v + 1);
  syncHistSignals();
}

export function undo() {
  const cmd = undoStack.pop();
  if (!cmd) return;
  redoStack.push({ label: cmd.label, snap: snapshot(store.project) });
  setStore('project', cmd.snap);
  setStore('selected', { kind: null, id: null });
  setHistVersion((v) => v + 1);
  syncHistSignals();
}

export function redo() {
  const cmd = redoStack.pop();
  if (!cmd) return;
  undoStack.push({ label: cmd.label, snap: snapshot(store.project) });
  setStore('project', cmd.snap);
  setStore('selected', { kind: null, id: null });
  setHistVersion((v) => v + 1);
  syncHistSignals();
}

export const canUndo = () => undoDepth() > 0;
export const canRedo = () => redoDepth() > 0;
export const historyLabel = () => (undoStack.length ? undoStack[undoStack.length - 1].label : '');

/** 普通修改：自动入栈 */
export function mutate(label, fn) {
  pushHistory(label);
  setStore('project', produce((p) => fn(p)));
}

/** 拖拽开始：记录基线快照（不入栈） */
let dragBase = null;
let dragLabel = '';
export function beginDrag(label) {
  dragBase = snapshot(store.project);
  dragLabel = label;
}
/** 拖拽中：直接改，不入栈 */
export function patchDrag(fn) {
  setStore('project', produce((p) => fn(p)));
}
/** 拖拽结束：与基线有差异才入栈一次 */
export function commitDrag() {
  if (!dragBase) return;
  if (JSON.stringify(dragBase) !== JSON.stringify(snapshot(store.project))) {
    undoStack.push({ label: dragLabel, snap: dragBase });
    if (undoStack.length > HIST_LIMIT) undoStack.shift();
    redoStack.length = 0;
    setHistVersion((v) => v + 1);
    syncHistSignals();
  }
  dragBase = null;
}

// ---------- 工程 / 向导 ----------
export function completeWizard(w) {
  setStore('wizard', w);
  setStore('project', createProject(w));
  undoStack.length = 0;
  redoStack.length = 0;
  setHistVersion((v) => v + 1);
  syncHistSignals();
}

export function resetWizard() {
  setStore('project', null);
  setStore('selected', { kind: null, id: null });
  setStore('wizard', defaultWizard());
}

// ---------- 选择 ----------
export function select(kind, id) {
  setStore('selected', { kind, id });
}

// ---------- 场景编辑 ----------
export function addSilo(catalogId, x, z) {
  const cat = store.wizard.siloCatalog.find((c) => c.id === catalogId);
  if (!cat) return;
  mutate('添加料仓', (p) => {
    p.silos.push(makeSilo(cat, x, z));
  });
  const s = store.project.silos[store.project.silos.length - 1];
  select('silo', s.id);
}

export function addSegment(catalogId, x, z, length) {
  const cat = store.wizard.rollerCatalog.find((c) => c.id === catalogId);
  if (!cat) return;
  mutate('添加辊道段', (p) => {
    p.segments.push(makeSegment(cat, x, z, length));
  });
  const s = store.project.segments[store.project.segments.length - 1];
  select('segment', s.id);
}

export function removeSelected() {
  const { kind, id } = store.selected;
  if (!id) return;
  mutate(kind === 'silo' ? '删除料仓' : '删除辊道段', (p) => {
    if (kind === 'silo') p.silos = p.silos.filter((s) => s.id !== id);
    else p.segments = p.segments.filter((s) => s.id !== id);
  });
  setStore('selected', { kind: null, id: null });
}

/** 面板数值编辑（单字段，入栈） */
export function updateSelected(patch) {
  const { kind, id } = store.selected;
  if (!id) return;
  mutate(kind === 'silo' ? '修改料仓参数' : '修改辊道参数', (p) => {
    const list = kind === 'silo' ? p.silos : p.segments;
    const item = list.find((x) => x.id === id);
    if (item) Object.assign(item, patch);
  });
}

export function updateDropOpening(patch) {
  const seg = store.project.segments.find((s) => s.id === store.selected.id);
  if (!seg) return;
  mutate('修改落料口', (p) => {
    const s = p.segments.find((x) => x.id === seg.id);
    Object.assign(s.dropOpening, patch);
  });
}

// ---------- 通过性检查 ----------
export async function runCheck() {
  const p = store.project;
  if (!p) return;
  setStore('checkRunning', true);
  // 让 UI 先渲染检查态
  await new Promise((r) => setTimeout(r, 30));
  const runSeq = (p.lastCheck?.runSeq || 0) + 1;
  const res = runPassabilityCheck(p, runSeq);
  setStore(
    'project',
    produce((proj) => {
      proj.prevCheck = proj.lastCheck;
      proj.lastCheck = res;
    })
  );
  setStore('checkRunning', false);
  return res;
}

export const checkDiff = () => {
  const p = store.project;
  return p ? diffChecks(p.prevCheck, p.lastCheck) : null;
};

export { store, histVersion };
