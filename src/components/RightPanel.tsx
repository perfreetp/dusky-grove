import { createMemo, For, Show } from 'solid-js';
import { minimumWidth } from '../core/geometry';
import {
  deleteObjects,
  deletionEligibility,
  getDeletedArtRecords,
  historyState,
  restoreObjects,
  selectCorner7GrooveGroup,
  selectedObjects,
  setSelectedIds,
  setUi,
  state,
  ui,
  updateProjectPatch,
} from '../state/editor';

interface RightPanelProps {
  busy: boolean;
  onSimplify: () => void;
  onRunProbe: () => void;
  onResetProbe: () => void;
  onFocusHit: () => void;
  onExportJSON: () => void;
  onExportGLB: () => void;
  onExportCSV: () => void;
  onCopyArt: () => void;
}

export default function RightPanel(props: RightPanelProps) {
  const minWidth = createMemo(() => minimumWidth(ui.widthSamples));
  const selection = createMemo(() => deletionEligibility(selectedObjects()));
  const records = createMemo(() => {
    state.revision;
    return getDeletedArtRecords();
  });
  const history = historyState();
  const activeColliderCount = createMemo(
    () => state.objects.filter((o) => !o.deleted && !o.hiddenBySimplify).reduce((n, o) => n + o.colliders.filter((c) => c.enabled).length, 0),
  );
  const simplifiedCount = createMemo(() => state.objects.filter((o) => !o.deleted && o.kind === 'simplified').length);

  return (
    <aside class="panel panel-right">
      <div class="tabs">
        <button class="tab" classList={{ active: ui.rightTab === 'inspect' }} onClick={() => setUi('rightTab', 'inspect')}>
          检查 / 探针
        </button>
        <button class="tab" classList={{ active: ui.rightTab === 'art' }} onClick={() => setUi('rightTab', 'art')}>
          美术确认
          <Show when={records().length}>
            <span class="tab-count">{records().length}</span>
          </Show>
        </button>
        <button class="tab" classList={{ active: ui.rightTab === 'export' }} onClick={() => setUi('rightTab', 'export')}>
          导出交接
        </button>
      </div>

      <div class="right-scroll">
        <Show when={ui.rightTab === 'inspect'}>
          <section class="card verify-card">
            <div class="card-title">
              <h2>第 7 拐角验收脚本</h2>
            </div>
            <ol class="verify-steps">
              <li>先运行探针，复现门框凹槽碰撞卡点。</li>
              <li>选中第 7 拐角凹槽组，用 Manifold 平直化。</li>
              <li>碰撞体会沿平直面重做并向通行面加厚 4cm。</li>
              <li>再跑探针；按 Ctrl+Z 可对比原状和原碰撞。</li>
            </ol>
            <div class="button-row wrap">
              <button class="btn primary" disabled={ui.probePlaying} onClick={props.onRunProbe}>
                {ui.probePlaying ? '探针行进中…' : '沿路线跑探针'}
              </button>
              <button class="btn" onClick={props.onResetProbe}>
                重置
              </button>
              <button class="btn small" onClick={selectCorner7GrooveGroup}>
                选门框凹槽
              </button>
              <button class="btn small" onClick={() => setSelectedIds(['corner3-reveal'])}>
                选墙角凹槽
              </button>
              <button class="btn success" disabled={props.busy} onClick={props.onSimplify}>
                {props.busy ? 'Manifold 合并中…' : '合并凹槽并平直化'}
              </button>
            </div>
          </section>

          <section class="card width-card">
            <div class="card-title">
              <h2>通行净宽</h2>
              <Show
                when={minWidth()}
                fallback={<span class="badge">计算中</span>}
              >
                {(sample) => (
                  <span
                    class="badge"
                    classList={{
                      danger: sample().width < state.route.clearWidthTarget,
                      ok: sample().width >= state.route.clearWidthTarget,
                    }}
                  >
                    最小 {sample().width.toFixed(2)} m
                  </span>
                )}
              </Show>
            </div>
            <Show when={minWidth()}>
              {(sample) => (
                <>
                  <div class="metric-big" classList={{ danger: sample().width < state.route.clearWidthTarget }}>
                    {sample().width.toFixed(2)}
                    <small>m</small>
                  </div>
                  <p class="hint">
                    位置：路线 {sample().distance.toFixed(1)} m；限制件：{sample().limitingObjectName ?? '未命中'}。
                    绿色测线为每米净宽，红色为最窄断面。
                  </p>
                  <div class="toggle-row">
                    <label>
                      <input type="checkbox" checked={ui.showWidth} onChange={(e) => setUi('showWidth', e.currentTarget.checked)} />
                      显示净宽测线
                    </label>
                    <label>
                      <input type="checkbox" checked={ui.showColliders} onChange={(e) => setUi('showColliders', e.currentTarget.checked)} />
                      显示碰撞体
                    </label>
                  </div>
                </>
              )}
            </Show>
          </section>

          <section class="card probe-card">
            <div class="card-title">
              <h2>探针报告</h2>
              <Show when={ui.probeReport}>
                {(report) => (
                  <span class="badge" classList={{ danger: report().status === 'blocked', ok: report().status === 'pass' }}>
                    {report().status === 'blocked' ? '碰撞停下' : report().status === 'pass' ? '一次通过' : '运行中'}
                  </span>
                )}
              </Show>
            </div>
            <Show
              when={ui.probeReport?.firstHit}
              fallback={
                <p class="hint">
                  探针半径 {state.route.probeRadius.toFixed(2)}m，中心离地 {state.route.probeHeight.toFixed(2)}m。碰到碰撞体后会在接触表面标出红点、竖向离地尺寸和卡点名称。
                </p>
              }
            >
              {(hit) => (
                <div class="hit-box">
                  <strong>{hit().message}</strong>
                  <dl class="kv">
                    <dt>离地高度</dt>
                    <dd>{hit().heightAboveFloor.toFixed(3)} m</dd>
                    <dt>碰撞盒竖向范围</dt>
                    <dd>
                      {hit().colliderBottom.toFixed(2)} – {hit().colliderTop.toFixed(2)} m
                    </dd>
                    <dt>路线里程</dt>
                    <dd>{hit().routeDistance.toFixed(2)} m</dd>
                    <dt>碰撞来源</dt>
                    <dd>{colliderSourceLabel(hit().source)}</dd>
                  </dl>
                  <button class="btn small danger" onClick={props.onFocusHit}>
                    定位卡点视角
                  </button>
                </div>
              )}
            </Show>
            <Show when={ui.probeReport?.status === 'pass'}>
              <div class="pass-box">探针已走完全部 {ui.probeReport?.totalLength.toFixed(1)} m，未碰到启用的碰撞体。</div>
            </Show>
          </section>

          <section class="card selection-card">
            <div class="card-title">
              <h2>框选 / 选中对象</h2>
              <span class="badge cyan">{ui.selectedIds.length}</span>
            </div>
            <Show when={ui.selectedIds.length === 0}>
              <p class="hint">用左键拖框选择场景件；也可在左侧层级中点选，Shift 加选。</p>
            </Show>
            <Show when={selection().eligible.length}>
              <div class="eligible-box">
                <strong>{selection().eligible.length} 件可批量删除</strong>
                <div class="chip-row">
                  <For each={selection().eligible.slice(0, 12)}>
                    {(o) => <span class="chip good">{o.name}</span>}
                  </For>
                  <Show when={selection().eligible.length > 12}>
                    <span class="chip">…另有 {selection().eligible.length - 12} 件</span>
                  </Show>
                </div>
                <button class="btn danger wide" onClick={() => deleteObjects(ui.selectedIds)}>
                  批量删除并实时重算净宽
                </button>
              </div>
            </Show>
            <Show when={selection().blocked.length}>
              <div class="blocked-box">
                <strong>{selection().blocked.length} 件被保护规则保留</strong>
                <For each={selection().blocked.slice(0, 8)}>
                  {(item) => (
                    <div class="blocked-row">
                      <span>{item.object.name}</span>
                      <em>{item.reason}</em>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={selectedObjects()[0]}>
              {(obj) => (
                <div class="object-inspector">
                  <h3>{obj().name}</h3>
                  <dl class="kv">
                    <dt>类型</dt>
                    <dd>{obj().kind}</dd>
                    <dt>位置</dt>
                    <dd>
                      {obj().position[0].toFixed(2)}, {obj().position[1].toFixed(2)}, {obj().position[2].toFixed(2)}
                    </dd>
                    <dt>碰撞体</dt>
                    <dd>{obj().colliders.length} 个</dd>
                    <Show when={obj().simplification}>
                      <dt>Manifold</dt>
                      <dd>
                        {obj().simplification?.vertexCount ?? '—'} 顶点 / 加厚{' '}
                        {((obj().simplification?.inflation ?? 0) * 100).toFixed(1)}cm
                      </dd>
                    </Show>
                  </dl>
                  <Show when={obj().kind === 'simplified' || obj().simplification}>
                    <p class="hint snap-hint">拖动该段可吸附相邻墙面或 {state.gridSize * 100}cm 地面网格；越过工作边界会弹回。</p>
                  </Show>
                  <Show when={ui.snapMessage}>
                    <div class="snap-message">{ui.snapMessage}</div>
                  </Show>
                </div>
              )}
            </Show>

            <label class="slider-row compact">
              <span>碰撞外加厚度</span>
              <strong>{(state.collisionInflation * 100).toFixed(0)} cm</strong>
              <input
                type="range"
                min="0.02"
                max="0.1"
                step="0.01"
                value={state.collisionInflation}
                onInput={(e) => updateProjectPatch({ collisionInflation: e.currentTarget.valueAsNumber })}
              />
            </label>
          </section>

          <section class="card history-card">
            <div class="card-title">
              <h2>撤销历史</h2>
              <span class="badge">{history.past.length}</span>
            </div>
            <Show when={history.past.length === 0} fallback={
              <ol class="history-list">
                <For each={[...history.past].reverse().slice(0, 8)}>
                  {(entry, i) => (
                    <li>
                      <span class="history-index">{history.past.length - i()}</span>
                      {entry.label}
                    </li>
                  )}
                </For>
              </ol>
            }>
              <p class="hint">删除、移动、拉点、合并都会形成独立步骤；Ctrl+Z 撤销，Ctrl+Shift+Z 重做。</p>
            </Show>
          </section>
        </Show>

        <Show when={ui.rightTab === 'art'}>
          <section class="card">
            <div class="card-title">
              <h2>被删装饰清单</h2>
              <span class="badge danger">{records().length}</span>
            </div>
            <p class="hint">清单包含材质、尺寸、来源文件和删除批次，可导出 CSV 或复制给美术负责人确认。撤销后记录会随状态还原。</p>
            <div class="button-row wrap">
              <button class="btn primary" disabled={!records().length} onClick={props.onExportCSV}>
                导出 CSV
              </button>
              <button class="btn" disabled={!records().length} onClick={props.onCopyArt}>
                复制清单文本
              </button>
            </div>
            <div class="art-list">
              <For each={records()}>
                {(r) => (
                  <article class="art-row">
                    <header>
                      <strong>{r.name}</strong>
                      <button class="btn tiny" onClick={() => restoreObjects([r.id])}>
                        恢复
                      </button>
                    </header>
                    <div class="art-meta">{r.category} · {r.dimensions}</div>
                    <div class="art-meta">材质：{r.materialName}</div>
                    <Show when={r.fileName}>
                      <div class="art-meta">来源：{r.fileName}{r.nodeName ? ` / ${r.nodeName}` : ''}</div>
                    </Show>
                    <div class="art-meta subtle">{r.historyLabel} · {r.deletedAt}</div>
                  </article>
                )}
              </For>
              <Show when={!records().length}>
                <div class="empty-state">尚未删除装饰件。框选带外装饰后，这里会生成美术确认清单。</div>
              </Show>
            </div>
          </section>
        </Show>

        <Show when={ui.rightTab === 'export'}>
          <section class="card">
            <div class="card-title">
              <h2>交给关卡程序</h2>
            </div>
            <div class="export-stats">
              <div><strong>{activeColliderCount()}</strong><span>启用碰撞盒</span></div>
              <div><strong>{simplifiedCount()}</strong><span>平直简化段</span></div>
              <div><strong>{records().length}</strong><span>待美术确认</span></div>
            </div>
            <p class="hint">
              GLB 只包含当前未删除、未被合并替代的模型根；JSON 提供 Three/Y-up/米制变换后的世界坐标盒碰撞、路线、探针参数和卡点报告。
            </p>
            <div class="button-column">
              <button class="btn primary" onClick={props.onExportJSON}>下载关卡交接 JSON</button>
              <button class="btn" onClick={props.onExportGLB}>导出简化场景 GLB（含原材质）</button>
              <button class="btn" onClick={props.onExportCSV}>下载美术删除 CSV</button>
            </div>
            <pre class="schema-preview">{`{
  "format": "routeclear-level-handoff",
  "unit": "metre",
  "coordinateSystem": "three-y-up",
  "route": { "points": [[x,z]...], "beltWidth": 1.2 },
  "colliders": [{
    "id": "...", "center": [x,y,z],
    "size": [w,h,d], "rotationY": 0,
    "source": "thickened", "inflation": 0.04
  }],
  "probe": { "radius": 0.32, "height": 0.85 },
  "deletedArt": [{ "name": "...", "materialName": "..." }]
}`}</pre>
          </section>
        </Show>
      </div>
    </aside>
  );
}

function colliderSourceLabel(source: string): string {
  if (source === 'thickened') return '简化后加厚碰撞';
  if (source === 'rebuilt') return '简化后重做碰撞';
  if (source === 'imported') return '导入包围盒碰撞';
  return '原始/旧烘焙碰撞';
}
