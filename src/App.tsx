import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import { computeWidthSamples, runProbe } from './core/geometry';
import { planFlatten } from './core/simplify';
import { EditorViewport } from './three/EditorViewport';
import {
  boxesToHullGeometry,
  manifoldGeometries,
  visualBoxesForObjects,
} from './three/manifoldService';
import { importSceneFiles } from './io/importScene';
import {
  buildHandoff,
  deletedArtCsv,
  downloadBlob,
  downloadTextFile,
  exportRootToGLB,
} from './io/exporters';
import {
  commit,
  commitFlattenPlan,
  deleteObjects,
  getDeletedArtRecords,
  historyState,
  notify,
  redo,
  resetDemoScene,
  selectedObjects,
  setSelectedIds,
  setUi,
  state,
  toast,
  ui,
  undo,
} from './state/editor';

export default function App() {
  let viewportHost!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  let viewport: EditorViewport | undefined;
  let probeRaf = 0;
  const [busy, setBusy] = createSignal(false);
  const [dragOver, setDragOver] = createSignal(false);
  const history = historyState();

  onMount(() => {
    viewport = new EditorViewport(viewportHost);
    (window as unknown as { __routeclearViewport?: EditorViewport }).__routeclearViewport = viewport;

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const inputType = tag === 'INPUT' ? (target as HTMLInputElement).type : '';
      const isTextEditing =
        tag === 'TEXTAREA' ||
        target?.isContentEditable ||
        (tag === 'INPUT' && ['text', 'search', 'url', 'email', 'password', 'number'].includes(inputType));
      if (isTextEditing) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && ((key === 'z' && event.shiftKey) || key === 'y')) {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (ui.selectedIds.length) {
          event.preventDefault();
          deleteObjects(ui.selectedIds);
        }
      } else if (event.key === 'Escape') {
        setSelectedIds([]);
        setUi('tool', 'select');
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  createEffect(() => {
    if (!viewport) return;
    state.revision;
    const selected = ui.selectedIds;
    ui.showColliders;
    ui.showBelt;
    ui.showGrid;
    viewport.sync(state, selected);
  });

  createEffect(() => {
    const samples = computeWidthSamples(state);
    setUi('widthSamples', samples);
  });

  createEffect(() => {
    viewport?.renderWidthGuides(ui.widthSamples);
  });

  createEffect(() => {
    const request = ui.viewRequest;
    if (!request || !viewport) return;
    if (request.type === 'corner-7') viewport.focusCorner7();
    if (request.type === 'frame-all') viewport.frameAll();
  });

  createEffect(() => {
    state.revision;
    cancelAnimationFrame(probeRaf);
    setUi('probePlaying', false);
    setUi('probeReport', null);
    viewport?.clearHitMarker();
    viewport?.hideProbe();
  });

  onCleanup(() => {
    cancelAnimationFrame(probeRaf);
    viewport?.dispose();
  });

  function triggerImport() {
    fileInput.click();
  }

  async function handleImportFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const result = await importSceneFiles(files, state.route);
      commit(`导入 ${result.meshCount} 个美术节点`, (draft) => {
        draft.objects.push(...result.objects);
      });
      setSelectedIds(result.objects.map((o) => o.id));
      setUi('rightTab', 'inspect');
      notify(`已从 ${result.fileNames.join(', ')} 导入 ${result.meshCount} 个 mesh，原材质保留`, 'success');
      viewport?.frameAll();
    } catch (error) {
      console.error(error);
      notify(error instanceof Error ? error.message : '导入失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    await handleImportFiles(files);
    input.value = '';
  }

  async function handleSimplify() {
    if (busy()) return;
    const sources = selectedObjects().filter((o) => !o.deleted && !o.hiddenBySimplify);
    if (!sources.some((o) => o.flatten)) {
      notify('请先选择带“门框凹槽/墙角凹槽”标记的立梃或凹槽件，再执行平直化。', 'warn');
      return;
    }

    setBusy(true);
    try {
      const plan = planFlatten(sources, state.route, state.collisionInflation);
      try {
        const sourceBoxes = visualBoxesForObjects(sources);
        const hull = await boxesToHullGeometry(sourceBoxes);
        const size = plan.replacement.size!;
        const replacement = await boxesToHullGeometry([
          {
            center: [
              plan.replacement.position[0],
              plan.replacement.position[1] + size[1] / 2,
              plan.replacement.position[2],
            ],
            size,
          },
        ]);
        manifoldGeometries.set(plan.replacement.id, replacement.geometry);
        plan.replacement.simplification!.vertexCount = hull.vertexCount;
        plan.replacement.simplification!.manifoldVolume = hull.volume;
        hull.geometry.dispose();
      } catch (error) {
        console.error('Manifold initialization failed; using box fallback.', error);
        notify('Manifold WASM 暂不可用，已用等价平直盒体回退；请检查 wasm 资源路径。', 'warn');
      }
      commitFlattenPlan(plan);
    } catch (error) {
      console.error(error);
      notify(error instanceof Error ? error.message : '平直化失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleRunProbe() {
    if (ui.probePlaying) return;
    cancelAnimationFrame(probeRaf);
    viewport?.clearHitMarker();
    const report = runProbe(state);
    setUi('probeReport', null);
    setUi('probePlaying', true);

    const endDistance = report.traveled;
    const duration = Math.max(1800, Math.min(5200, endDistance * 95));
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.85 ? t * 1.05 : 0.8925 + (t - 0.85) * 0.7167;
      const distance = endDistance * Math.min(1, eased);
      viewport?.setProbeDistance(distance);
      if (t < 1) {
        probeRaf = requestAnimationFrame(tick);
      } else {
        setUi('probePlaying', false);
        setUi('probeReport', report);
        if (report.firstHit) {
          viewport?.showHitMarker(report.firstHit);
          notify(`探针停下：${report.firstHit.objectName}，卡点离地 ${report.firstHit.heightAboveFloor.toFixed(2)}m`, 'error');
        } else {
          notify('探针沿路线走完全程，未发生碰撞', 'success');
        }
      }
    };
    probeRaf = requestAnimationFrame(tick);
  }

  function handleResetProbe() {
    cancelAnimationFrame(probeRaf);
    setUi('probePlaying', false);
    setUi('probeReport', null);
    viewport?.clearHitMarker();
    viewport?.hideProbe();
  }

  function handleFocusHit() {
    const hit = ui.probeReport?.firstHit;
    if (hit) viewport?.focusHit(hit);
  }

  function fileStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function handleExportJSON() {
    const handoff = buildHandoff(state, ui.probeReport);
    downloadTextFile(`routeclear-level-handoff-${fileStamp()}.json`, JSON.stringify(handoff, null, 2));
    notify('关卡交接 JSON 已导出，包含路线与世界坐标碰撞数据', 'success');
  }

  async function handleExportGLB() {
    if (!viewport) return;
    setBusy(true);
    try {
      const blob = await exportRootToGLB(viewport.getExportRoot());
      downloadBlob(`routeclear-simplified-scene-${fileStamp()}.glb`, blob);
      notify('简化场景 GLB 已导出', 'success');
    } catch (error) {
      console.error(error);
      notify('GLB 导出失败，请查看控制台', 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleExportCSV() {
    const records = getDeletedArtRecords();
    if (!records.length) {
      notify('还没有被删除的装饰件', 'warn');
      return;
    }
    downloadTextFile(`deleted-art-for-review-${fileStamp()}.csv`, deletedArtCsv(records), 'text/csv');
    notify(`已导出 ${records.length} 件被删装饰的美术确认清单`, 'success');
  }

  async function handleCopyArt() {
    const records = getDeletedArtRecords();
    if (!records.length) {
      notify('还没有被删除的装饰件', 'warn');
      return;
    }
    const text = deletedArtCsv(records);
    try {
      await navigator.clipboard.writeText(text);
      notify('美术确认清单（CSV 文本）已复制', 'success');
    } catch {
      downloadTextFile(`deleted-art-for-review-${fileStamp()}.csv`, text, 'text/csv');
      notify('剪贴板不可用，已改为下载 CSV', 'warn');
    }
  }

  return (
    <div
      class="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleImportFiles(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">RC</div>
          <div>
            <h1>RouteClear</h1>
            <span>视障玩家必经路线 · 场景几何简化与碰撞交接</span>
          </div>
        </div>
        <div class="project-name" title={state.projectName}>{state.projectName}</div>
        <div class="top-actions">
          <button class="btn" onClick={undo} disabled={history.past.length === 0} title="Ctrl+Z">
            ↶ 撤销{history.past.length ? ` · ${history.past[history.past.length - 1].label}` : ''}
          </button>
          <button class="btn" onClick={redo} disabled={history.future.length === 0} title="Ctrl+Shift+Z">
            ↷ 重做
          </button>
          <button class="btn" onClick={() => viewport?.frameAll()}>全景</button>
          <button class="btn warn-ghost" onClick={resetDemoScene}>重置示例</button>
          <button class="btn primary" onClick={triggerImport} disabled={busy()}>导入模型</button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.ktx2"
            hidden
            onChange={(e) => void onFileChange(e)}
          />
        </div>
      </header>

      <div class="workspace">
        <LeftPanel onImport={triggerImport} />

        <main class="viewport-stage" ref={viewportHost}>
          <div class="viewport-hud top-left">
            <strong>三维场景</strong>
            <span>左键拖框 / 拖简化段 · 右键旋转 · 滚轮缩放</span>
          </div>
          <div class="viewport-hud bottom-left legend">
            <span><i class="legend-swatch belt" />通行带</span>
            <span><i class="legend-swatch original" />原碰撞</span>
            <span><i class="legend-swatch thick" />重做加厚碰撞</span>
            <span><i class="legend-swatch bad" />旧凹槽碰撞</span>
            <span><i class="legend-swatch width" />净宽测线</span>
          </div>
          <div class="viewport-hud bottom-right mode-hint">
            当前工具：{ui.tool === 'box' ? '框选删除' : ui.tool === 'route' ? '拉通行带（左键加点）' : '选择 / 移动吸附'}
          </div>

          {ui.rubberRect && (
            <div
              class="rubber-band"
              style={{
                left: `${Math.min(ui.rubberRect.x0, ui.rubberRect.x1)}px`,
                top: `${Math.min(ui.rubberRect.y0, ui.rubberRect.y1)}px`,
                width: `${Math.abs(ui.rubberRect.x1 - ui.rubberRect.x0)}px`,
                height: `${Math.abs(ui.rubberRect.y1 - ui.rubberRect.y0)}px`,
              }}
            />
          )}
          {busy() && <div class="busy-overlay"><div class="spinner" />正在处理几何 / 导入资源…</div>}
        </main>

        <RightPanel
          busy={busy()}
          onSimplify={() => void handleSimplify()}
          onRunProbe={handleRunProbe}
          onResetProbe={handleResetProbe}
          onFocusHit={handleFocusHit}
          onExportJSON={handleExportJSON}
          onExportGLB={() => void handleExportGLB()}
          onExportCSV={handleExportCSV}
          onCopyArt={() => void handleCopyArt()}
        />
      </div>

      {toast() && (
        <div class={`toast toast-${toast()!.kind}`} role="status">
          {toast()!.text}
        </div>
      )}
      {dragOver() && <div class="drop-overlay">松开以导入美术场景模型和材质文件</div>}
    </div>
  );
}
