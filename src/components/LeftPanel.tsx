import { For, Show } from 'solid-js';
import { DEMO_ROUTE_POINTS } from '../core/demoScene';
import { polylineLength } from '../core/geometry';
import {
  commit,
  selectAllEligibleDecorations,
  selectCorner7GrooveGroup,
  setSelectedIds,
  setUi,
  state,
  ui,
  updateRoutePatch,
} from '../state/editor';
import type { ObjectKind } from '../core/types';

const kindLabel: Record<ObjectKind, string> = {
  floor: '地面',
  wall: '墙段',
  door: '门框',
  decoration: '装饰',
  interactive: '交互',
  simplified: '简化段',
  marker: '标记',
  imported: '导入件',
};

export default function LeftPanel(props: { onImport: () => void }) {
  const routeLength = () => polylineLength(state.route.points);
  const activeObjects = () => state.objects.filter((o) => !o.deleted && !o.hiddenBySimplify);

  return (
    <aside class="panel panel-left">
      <section class="card workflow-card">
        <div class="card-title">
          <span class="step-pill">流程</span>
          <h2>无障碍路线简化</h2>
        </div>
        <ol class="workflow">
          <li classList={{ active: true }}>导入美术模型与材质</li>
          <li>按策划说明拉通行带</li>
          <li>框选带外非交互装饰并删除</li>
          <li>合并墙角/门框凹槽，重做加厚碰撞</li>
          <li>探针走查，导出关卡与美术确认清单</li>
        </ol>
        <button class="btn btn-primary wide" onClick={props.onImport}>
          导入 GLB / glTF / OBJ
        </button>
        <p class="hint">可一次多选 .gltf、.bin、贴图；推荐导出包含材质的 .glb。</p>
      </section>

      <section class="card">
        <div class="card-title">
          <h2>策划路线说明</h2>
          <span class="badge cyan">{state.route.points.length - 2} 个拐角</span>
        </div>
        <textarea
          class="route-text"
          rows={5}
          value={state.route.description}
          onInput={(e) => updateRoutePatch({ description: e.currentTarget.value })}
        />
        <div class="button-row">
          <button
            class="btn"
            onClick={() =>
              commit('按策划说明恢复演示路线', (draft) => {
                draft.route.points = DEMO_ROUTE_POINTS.map((p) => [...p]);
              })
            }
          >
            恢复七拐角路线
          </button>
          <button class="btn" classList={{ active: ui.tool === 'route' }} onClick={() => setUi('tool', 'route')}>
            {ui.tool === 'route' ? '在场景点控制点…' : '继续拉通行带'}
          </button>
        </div>
        <p class="hint">路线总长 {routeLength().toFixed(1)} m；拉带模式下左键地面加点，右键拖动旋转视角。</p>

        <label class="slider-row">
          <span>通行带宽度</span>
          <strong>{state.route.beltWidth.toFixed(2)} m</strong>
          <input
            type="range"
            min="0.9"
            max="2.2"
            step="0.05"
            value={state.route.beltWidth}
            onInput={(e) => updateRoutePatch({ beltWidth: e.currentTarget.valueAsNumber })}
          />
        </label>
        <label class="slider-row">
          <span>净宽验收线</span>
          <strong>{state.route.clearWidthTarget.toFixed(2)} m</strong>
          <input
            type="range"
            min="1.0"
            max="1.8"
            step="0.05"
            value={state.route.clearWidthTarget}
            onInput={(e) => updateRoutePatch({ clearWidthTarget: e.currentTarget.valueAsNumber })}
          />
        </label>
        <label class="slider-row">
          <span>探针半径</span>
          <strong>{state.route.probeRadius.toFixed(2)} m</strong>
          <input
            type="range"
            min="0.22"
            max="0.55"
            step="0.01"
            value={state.route.probeRadius}
            onInput={(e) => updateRoutePatch({ probeRadius: e.currentTarget.valueAsNumber })}
          />
        </label>
      </section>

      <section class="card">
        <div class="card-title">
          <h2>框选清理</h2>
        </div>
        <div class="tool-grid">
          <button class="tool-btn" classList={{ active: ui.tool === 'select' }} onClick={() => setUi('tool', 'select')}>
            <span class="tool-icon">↖</span>
            选择 / 移动简化段
          </button>
          <button class="tool-btn" classList={{ active: ui.tool === 'box' }} onClick={() => setUi('tool', 'box')}>
            <span class="tool-icon">▱</span>
            框选删除
          </button>
        </div>
        <div class="button-row">
          <button class="btn small" onClick={selectAllEligibleDecorations}>
            选中全部带外装饰
          </button>
          <button class="btn small warn-ghost" onClick={selectCorner7GrooveGroup}>
            定位第7拐角凹槽
          </button>
        </div>
        <p class="hint">框选会保留交互终端、按钮、墙和锁定件；合格件与拦截原因会显示在右侧。</p>
      </section>

      <section class="card hierarchy-card">
        <div class="card-title">
          <h2>场景层级</h2>
          <span class="badge">{activeObjects().length}</span>
        </div>
        <div class="hierarchy">
          <For each={state.objects}>
            {(obj) => (
              <button
                class="hierarchy-row"
                classList={{
                  selected: ui.selectedIds.includes(obj.id),
                  deleted: obj.deleted,
                  replaced: obj.hiddenBySimplify,
                }}
                onClick={(e) => {
                  if (e.shiftKey) {
                    setSelectedIds(
                      ui.selectedIds.includes(obj.id)
                        ? ui.selectedIds.filter((id) => id !== obj.id)
                        : [...ui.selectedIds, obj.id],
                    );
                  } else {
                    setSelectedIds([obj.id]);
                  }
                }}
              >
                <span class={`dot kind-${obj.kind}`} />
                <span class="hierarchy-name">{obj.name}</span>
                <span class="kind-badge">{kindLabel[obj.kind]}</span>
                <Show when={obj.deleted}>
                  <span class="status-tag deleted-tag">已删</span>
                </Show>
                <Show when={obj.hiddenBySimplify}>
                  <span class="status-tag replaced-tag">已合并</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </section>
    </aside>
  );
}
