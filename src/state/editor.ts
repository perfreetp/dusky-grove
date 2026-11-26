import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { createDemoState } from '../core/demoScene';
import {
  footprintInsideBounds,
  isObjectOutsideBelt,
  snapObjectPosition,
} from '../core/geometry';
import { planFlatten, type FlattenPlan } from '../core/simplify';
import type {
  DeletedArtRecord,
  EditorState,
  HistoryEntry,
  ProbeReport,
  SceneObject,
  Vec2XZ,
  Vec3,
  WidthSample,
} from '../core/types';
import { formatDimensions } from '../core/geometry';

export type ToolMode = 'select' | 'box' | 'route';
export type RightTab = 'inspect' | 'art' | 'export';

export interface RubberRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface UiState {
  tool: ToolMode;
  rightTab: RightTab;
  selectedIds: string[];
  showColliders: boolean;
  showBelt: boolean;
  showWidth: boolean;
  showGrid: boolean;
  rubberRect: RubberRect | null;
  widthSamples: WidthSample[];
  probeReport: ProbeReport | null;
  probePlaying: boolean;
  snapMessage: string;
  lastSnapCandidates: string[];
  viewRequest: { type: 'frame-all' | 'corner-7' | 'probe-hit'; nonce: number } | null;
}

interface Gesture {
  label: string;
  before: EditorState;
  dirty: boolean;
}

function cloneState(s: EditorState): EditorState {
  // Solid's store proxy is not a reliable structuredClone input in every
  // browser; project state is plain JSON-serializable scene data.
  return JSON.parse(JSON.stringify(s)) as EditorState;
}

const initialState = createDemoState();

export const [state, setState] = createStore<EditorState>(initialState);
const [history, setHistory] = createStore<{ past: HistoryEntry[]; future: HistoryEntry[] }>({
  past: [],
  future: [],
});

export const [ui, setUi] = createStore<UiState>({
  tool: 'select',
  rightTab: 'inspect',
  selectedIds: [],
  showColliders: true,
  showBelt: true,
  showWidth: true,
  showGrid: true,
  rubberRect: null,
  widthSamples: [],
  probeReport: null,
  probePlaying: false,
  snapMessage: '',
  lastSnapCandidates: [],
  viewRequest: null,
});

export const [toast, setToast] = createSignal<{ text: string; kind: 'info' | 'success' | 'warn' | 'error'; nonce: number } | null>(null);
let toastHandle: ReturnType<typeof setTimeout> | undefined;

export function notify(text: string, kind: 'info' | 'success' | 'warn' | 'error' = 'info') {
  setToast({ text, kind, nonce: Date.now() + Math.random() });
  if (toastHandle) clearTimeout(toastHandle);
  toastHandle = setTimeout(() => setToast(null), 4200);
}

let gesture: Gesture | null = null;

function pushPast(label: string, before: EditorState) {
  setHistory('past', (past) => [
    ...past.slice(-99),
    { label, at: new Date().toISOString(), state: before },
  ]);
  setHistory('future', []);
}

export function commit(label: string, mutator: (draft: EditorState) => void) {
  const before = cloneState(state);
  const next = cloneState(state);
  mutator(next);
  next.revision += 1;
  pushPast(label, before);
  setState(reconcile(next));
}

export function beginGesture(label: string) {
  gesture = { label, before: cloneState(state), dirty: false };
}

export function updateGesture(mutator: (draft: EditorState) => void) {
  if (!gesture) return;
  gesture.dirty = true;
  const next = cloneState(state);
  mutator(next);
  next.revision += 1;
  setState(reconcile(next));
}

export function endGesture() {
  if (gesture?.dirty) pushPast(gesture.label, gesture.before);
  gesture = null;
}

export function cancelGesture() {
  if (gesture) setState(reconcile(gesture.before));
  gesture = null;
}

export function undo() {
  cancelGesture();
  const entry = history.past[history.past.length - 1];
  if (!entry) {
    notify('没有可撤销的步骤', 'warn');
    return;
  }
  const current = cloneState(state);
  setState(reconcile(entry.state));
  setHistory((h) => ({
    past: h.past.slice(0, -1),
    future: [{ label: entry.label, at: new Date().toISOString(), state: current }, ...h.future].slice(0, 100),
  }));
  setUi('selectedIds', []);
  notify(`已撤销：${entry.label}`, 'info');
}

export function redo() {
  cancelGesture();
  const entry = history.future[0];
  if (!entry) {
    notify('没有可重做的步骤', 'warn');
    return;
  }
  const current = cloneState(state);
  setState(reconcile(entry.state));
  setHistory((h) => ({
    past: [...h.past, { label: entry.label, at: new Date().toISOString(), state: current }].slice(-100),
    future: h.future.slice(1),
  }));
  setUi('selectedIds', []);
  notify(`已重做：${entry.label}`, 'success');
}

export function canUndo(): boolean {
  return history.past.length > 0;
}
export function canRedo(): boolean {
  return history.future.length > 0;
}
export function historyState() {
  return history;
}

export function setSelectedIds(ids: string[]) {
  setUi('selectedIds', [...new Set(ids)]);
}

export function toggleSelectedId(id: string) {
  const ids = ui.selectedIds.includes(id)
    ? ui.selectedIds.filter((x) => x !== id)
    : [...ui.selectedIds, id];
  setSelectedIds(ids);
}

export function selectedObjects(): SceneObject[] {
  return ui.selectedIds
    .map((id) => state.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => Boolean(o));
}

export function deletionEligibility(objects: SceneObject[]): {
  eligible: SceneObject[];
  blocked: Array<{ object: SceneObject; reason: string }>;
} {
  const eligible: SceneObject[] = [];
  const blocked: Array<{ object: SceneObject; reason: string }> = [];
  for (const object of objects) {
    if (object.deleted) continue;
    if (object.locked) blocked.push({ object, reason: '锁定场景件' });
    else if (object.interactive) blocked.push({ object, reason: '策划标记为交互件' });
    else if (!object.deletable) blocked.push({ object, reason: '结构/不可删除' });
    else if (!isObjectOutsideBelt(object, state.route))
      blocked.push({ object, reason: '与通行带相交或距离过近' });
    else eligible.push(object);
  }
  return { eligible, blocked };
}

export function deleteObjects(ids: string[], label = `框选删除 ${ids.length} 件`) {
  const objects = ids
    .map((id) => state.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => Boolean(o));
  const { eligible, blocked } = deletionEligibility(objects);
  if (!eligible.length) {
    notify(blocked[0] ? `没有可删件：${blocked[0].reason}` : '框选范围内没有可删除的带外装饰', 'warn');
    return { deletedIds: [] as string[], blocked };
  }

  const eligibleIds = new Set(eligible.map((o) => o.id));
  const at = new Date().toISOString();
  const actualLabel = `删除 ${eligible.length} 件带外装饰`;
  commit(actualLabel, (draft) => {
    for (const o of draft.objects) {
      if (eligibleIds.has(o.id)) {
        o.deleted = true;
        o.deletedAt = at;
        o.deletedLabel = actualLabel;
      }
    }
  });
  setSelectedIds(blocked.map((b) => b.object.id));
  setUi('rightTab', 'inspect');
  notify(
    blocked.length
      ? `已删除 ${eligible.length} 件；保留 ${blocked.length} 件交互/结构件`
      : `已删除 ${eligible.length} 件装饰，通行净宽已重算`,
    'success',
  );
  return { deletedIds: [...eligibleIds], blocked };
}

export function restoreObjects(ids: string[]) {
  const idSet = new Set(ids);
  commit(`美术确认后恢复 ${ids.length} 件`, (draft) => {
    for (const o of draft.objects) {
      if (idSet.has(o.id)) {
        o.deleted = false;
        o.deletedAt = undefined;
        o.deletedLabel = undefined;
      }
    }
  });
  notify(`已恢复 ${ids.length} 件`, 'success');
}

export function selectAllEligibleDecorations() {
  const ids = state.objects
    .filter((o) => !o.deleted && !o.hiddenBySimplify)
    .filter((o) => deletionEligibility([o]).eligible.length > 0)
    .map((o) => o.id);
  setSelectedIds(ids);
  notify(`已选中 ${ids.length} 件带外、非交互装饰`, 'success');
  return ids;
}

export function selectCorner7GrooveGroup() {
  const ids = ['door7-north-jamb', 'door7-groove'];
  setSelectedIds(ids);
  setUi('tool', 'select');
  setUi('rightTab', 'inspect');
  setUi('viewRequest', { type: 'corner-7', nonce: Date.now() });
  notify('已选中第 7 拐角门框立梃和内侧凹槽', 'info');
}

export function commitFlattenPlan(plan: FlattenPlan) {
  commit(`Manifold 平直化：${plan.replacement.name}`, (draft) => {
    for (const o of draft.objects) {
      if (plan.sourceIds.includes(o.id)) o.hiddenBySimplify = true;
    }
    draft.objects.push(plan.replacement);
  });
  setSelectedIds([plan.replacement.id]);
  notify('凹槽已合并为平直面，碰撞体已沿新表面加厚重做', 'success');
  return plan.replacement.id;
}

export function simplifySelected(stats?: { vertexCount?: number; volume?: number }) {
  const sources = selectedObjects().filter((o) => !o.deleted && !o.hiddenBySimplify);
  try {
    const plan = planFlatten(sources, state.route, state.collisionInflation, stats);
    return commitFlattenPlan(plan);
  } catch (error) {
    notify(error instanceof Error ? error.message : '平直化失败', 'error');
    return null;
  }
}

export function beginObjectMove(id: string) {
  const obj = state.objects.find((o) => o.id === id);
  if (!obj || obj.deleted || obj.hiddenBySimplify) return false;
  if (obj.kind !== 'simplified' && !obj.simplification) {
    notify('只有简化后生成的几何段开放移动吸附', 'warn');
    return false;
  }
  beginGesture(`移动 ${obj.name}`);
  return true;
}

export function previewObjectMove(id: string, raw: Vec3) {
  const obj = state.objects.find((o) => o.id === id);
  if (!obj || !gesture) return null;
  const snap = snapObjectPosition(raw, obj, state.objects, state.gridSize, state.snapDistance);
  const inside = footprintInsideBounds(snap.position, obj, state.workBounds);
  updateGesture((draft) => {
    const target = draft.objects.find((o) => o.id === id);
    if (!target) return;
    const dx = snap.position[0] - target.position[0];
    const dz = snap.position[2] - target.position[2];
    target.position = [...snap.position];
    for (const c of target.colliders) {
      c.center = [c.center[0] + dx, c.center[1], c.center[2] + dz];
    }
  });
  setUi('lastSnapCandidates', snap.candidates);
  setUi(
    'snapMessage',
    inside
      ? snap.candidates.slice(-2).join('；') || `自由移动 · 网格 ${state.gridSize.toFixed(2)}m`
      : '已越过工作边界，松手将弹回原位',
  );
  return { ...snap, inside };
}

export function finishObjectMove(id: string): { ok: boolean; bounced: boolean } {
  const obj = state.objects.find((o) => o.id === id);
  if (!gesture || !obj) {
    endGesture();
    return { ok: false, bounced: false };
  }
  const inside = footprintInsideBounds(obj.position, obj, state.workBounds);
  if (!inside) {
    cancelGesture();
    setUi('snapMessage', '越界移动已弹回');
    notify('拖过简化工作边界，几何和碰撞已弹回原位', 'warn');
    return { ok: false, bounced: true };
  }
  endGesture();
  setUi('snapMessage', '已吸附并更新碰撞体');
  return { ok: true, bounced: false };
}

export function cancelObjectMove() {
  cancelGesture();
  setUi('snapMessage', '');
}

export function addRoutePoint(point: Vec2XZ) {
  commit('拉通行带：增加控制点', (draft) => {
    draft.route.points.push([...point]);
  });
}

export function updateRoutePatch(patch: Partial<EditorState['route']>) {
  setState('route', patch);
}

export function updateProjectPatch(patch: Partial<EditorState>) {
  setState(patch as never);
}

export function replaceState(next: EditorState, label: string) {
  const before = cloneState(state);
  pushPast(label, before);
  next.revision = state.revision + 1;
  setState(reconcile(next));
}

export function resetDemoScene() {
  const next = createDemoState();
  const before = cloneState(state);
  pushPast('重新载入示例场景', before);
  setState(reconcile(next));
  setHistory('future', []);
  setSelectedIds([]);
  setUi('probeReport', null);
  setUi('widthSamples', []);
  notify('已载入第 7 拐角复现示例', 'success');
}

export function getDeletedArtRecords(): DeletedArtRecord[] {
  return state.objects
    .filter((o) => o.deleted)
    .map((o) => ({
      id: o.id,
      name: o.name,
      category: o.artCategory ?? o.kind,
      fileName: o.fileName,
      nodeName: o.nodeName,
      materialName: o.material?.name ?? '未命名材质',
      dimensions: formatDimensions(o.size),
      deletedAt: o.deletedAt ? new Date(o.deletedAt).toLocaleString('zh-CN') : '—',
      historyLabel: o.deletedLabel ?? '删除装饰',
    }));
}
