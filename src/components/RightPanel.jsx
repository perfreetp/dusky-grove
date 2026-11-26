/* 右侧：选中对象属性 + 通过性检查结果 + 方案导出 */
import { For, Show, createMemo } from 'solid-js';
import { store, updateSelected, updateDropOpening, runCheck, checkDiff, resetWizard } from '../store.js';
import { rollerCount, segEndX } from '../model.js';
import { safePitchRange, RULES } from '../check.js';
import { exportSiloPlan, exportRollerTable, downloadText } from '../exporter.js';

function SegmentInspector() {
  const seg = () => store.project.segments.find((s) => s.id === store.selected.id);
  const p = () => store.project;
  const set = (patch) => updateSelected(patch);
  const setOpen = (patch) => updateDropOpening(patch);

  return (
    <Show when={seg()} fallback={<p class="small">未选中辊道段。</p>}>
      {(s) => (
        <>
          <label class="field"><span>段名称</span>
            <input value={s().name} onInput={(e) => set({ name: e.currentTarget.value })} />
          </label>
          <div class="two-col">
            <label class="field"><span>起点 X（mm）</span>
              <input type="number" value={s().x} onInput={(e) => set({ x: +e.currentTarget.value })} />
            </label>
            <label class="field"><span>中心 Z（mm）</span>
              <input type="number" value={s().z} onInput={(e) => set({ z: +e.currentTarget.value })} />
            </label>
            <label class="field"><span>段长度（mm）</span>
              <input type="number" step="100" value={s().length} onInput={(e) => set({ length: Math.max(500, +e.currentTarget.value) })} />
            </label>
            <label class="field"><span>辊面标高（mm）</span>
              <input type="number" value={s().baseHeight} onInput={(e) => set({ baseHeight: +e.currentTarget.value })} />
            </label>
          </div>

          <label class="field">
            <span>皮带宽度（mm）— 厂商系列 {s().widthOptions.join('/')}</span>
            <select value={s().beltWidth} onChange={(e) => set({ beltWidth: +e.currentTarget.value })}>
              <For each={s().widthOptions}>{(w) => <option value={w}>{w}</option>}</For>
            </select>
          </label>

          <label class="field">
            <span>倾角（°），厂商上限 {s().maxInclineDeg}°（低于 {RULES.MIN_INCLINE}° 易滞留）</span>
            <input
              type="range" min="0" max={s().maxInclineDeg} step="0.5"
              value={s().inclineDeg}
              onInput={(e) => set({ inclineDeg: +e.currentTarget.value })}
            />
            <div class="mono" style={{ 'text-align': 'right' }}>{s().inclineDeg}°</div>
          </label>

          <label class="field">
            <span>辊距 pitch（mm），允许 {s().pitchMin}~{s().pitchMax}，当前 {rollerCount(s())} 个辊子</span>
            <input
              type="range" min={s().pitchMin} max={s().pitchMax} step="1"
              value={s().pitch}
              onInput={(e) => set({ pitch: +e.currentTarget.value })}
            />
            <div class="mono" style={{ 'text-align': 'right' }}>{s().pitch} mm</div>
          </label>
          <div class="card" style={{ 'margin-bottom': '12px' }}>
            <div class="small" style={{ 'margin-bottom': '4px' }}>各果径档安全辊距（吸附目标）：</div>
            <For each={p().grades}>
              {(g) => {
                const r = safePitchRange(g.nominal);
                const ok = s().pitch >= r.min && s().pitch <= r.max;
                return (
                  <div class="diff-line">
                    <span>{g.name} Ø{g.nominal}</span>
                    <span class={ok ? 'down' : 'up'}>{r.min}~{r.max} mm {ok ? '✓' : '✗'}</span>
                  </div>
                );
              }}
            </For>
          </div>

          <h3 style={{ margin: '14px 0 8px', 'font-size': '12px', color: 'var(--fg-dim)' }}>落料口（对接分拣机构）</h3>
          <div class="two-col">
            <label class="field"><span>口宽（mm）</span>
              <input type="number" value={s().dropOpening.width} onInput={(e) => setOpen({ width: +e.currentTarget.value })} />
            </label>
            <label class="field"><span>横向偏移 Z（mm）</span>
              <input type="number" value={s().dropOpening.offsetZ} onInput={(e) => setOpen({ offsetZ: +e.currentTarget.value })} />
            </label>
          </div>
          <label class="field"><span>分拣档位（该口接哪档果）</span>
            <select value={s().dropOpening.gradeId || ''} onChange={(e) => setOpen({ gradeId: e.currentTarget.value || null })}>
              <option value="">混果/末段</option>
              <For each={p().grades}>{(g) => <option value={g.id}>{g.name}（Ø{g.nominal}）</option>}</For>
            </select>
          </label>
          <label class="field"><span>对接机构备注</span>
            <input value={s().dropOpening.targetName} onInput={(e) => setOpen({ targetName: e.currentTarget.value })} placeholder="如：三号分拣杯组" />
          </label>
          <div class="small">落料口世界 X：{segEndX(s())} mm（场景中可直接拖动，Shift+拖改口宽）</div>
        </>
      )}
    </Show>
  );
}

function SiloInspector() {
  const silo = () => store.project.silos.find((x) => x.id === store.selected.id);
  const set = (patch) => updateSelected(patch);
  return (
    <Show when={silo()} fallback={<p class="small">未选中料仓。</p>}>
      {(s) => (
        <>
          <label class="field"><span>料仓名称</span>
            <input value={s().name} onInput={(e) => set({ name: e.currentTarget.value })} />
          </label>
          <div class="two-col">
            <label class="field"><span>位置 X（mm）</span>
              <input type="number" value={s().x} onInput={(e) => set({ x: +e.currentTarget.value })} />
            </label>
            <label class="field"><span>位置 Z（mm）</span>
              <input type="number" value={s().z} onInput={(e) => set({ z: +e.currentTarget.value })} />
            </label>
          </div>
          <label class="field">
            <span>出料口高度（mm），厂商范围 {s().outletMin}~{s().outletMax}</span>
            <input
              type="range" min={s().outletMin} max={s().outletMax} step="5"
              value={s().outletHeight}
              onInput={(e) => set({ outletHeight: +e.currentTarget.value })}
            />
            <div class="mono" style={{ 'text-align': 'right' }}>{s().outletHeight} mm</div>
          </label>
          <label class="field"><span>出料口宽度（mm）</span>
            <input
              type="range" min={s().outletMin} max={s().outletMax} step="5"
              value={s().outletWidth}
              onInput={(e) => set({ outletWidth: +e.currentTarget.value })}
            />
            <div class="mono" style={{ 'text-align': 'right' }}>{s().outletWidth} mm</div>
          </label>
          <div class="small">仓体 {s().length}×{s().width}×{s().height} mm（厂商目录锁定，只读）</div>
        </>
      )}
    </Show>
  );
}

function CheckPanel() {
  const p = () => store.project;
  const diff = createMemo(() => checkDiff());
  return (
    <div class="section">
      <h3>通过性检查</h3>
      <button class="primary" style={{ width: '100%' }} disabled={store.checkRunning} onClick={() => runCheck()}>
        {store.checkRunning ? '检查中…' : '▶ 投放果实并检查卡果'}
      </button>
      <Show when={p().lastCheck}>
        {(c) => (
          <>
            <div class="kpi-row" style={{ 'margin-top': '10px' }}>
              <div class="kpi"><div class="v">{c().totalFruit}</div><div class="k">投放果实</div></div>
              <div class="kpi"><div class={`v ${c().totalJam ? 'red' : 'green'}`}>{c().totalJam}</div><div class="k">卡果数</div></div>
              <div class="kpi">
                <div class={`v ${c().totalJam ? 'red' : 'green'}`}>
                  {((1 - c().totalJam / Math.max(c().totalFruit, 1)) * 100).toFixed(0)}%
                </div>
                <div class="k">通过率</div>
              </div>
            </div>

            <Show when={diff()}>
              {(d) => (
                <div class="card">
                  <div class="small" style={{ 'margin-bottom': '6px' }}>与上一次检查对比（卡果数）：</div>
                  <For each={d().grades}>
                    {(g) => (
                      <div class="diff-line">
                        <span>{g.name} Ø{g.diameter}</span>
                        <span>
                          {g.before} → {g.after}{' '}
                          <span class={g.after < g.before ? 'down' : g.after > g.before ? 'up' : 'flat'}>
                            ({g.after - g.before > 0 ? '+' : ''}{g.after - g.before})
                          </span>
                        </span>
                      </div>
                    )}
                  </For>
                  <div class="diff-line" style={{ 'border-bottom': 'none', 'font-weight': '700' }}>
                    <span>合计</span>
                    <span class={d().totalDelta < 0 ? 'down' : d().totalDelta > 0 ? 'up' : 'flat'}>
                      {d().totalDelta === 0 ? '持平' : `${d().totalDelta > 0 ? '+' : ''}${d().totalDelta} 颗`}
                    </span>
                  </div>
                </div>
              )}
            </Show>

            <div class="small" style={{ margin: '8px 0 4px' }}>分档结果：</div>
            <For each={c().perGrade}>
              {(g) => (
                <div class="diff-line">
                  <span>{g.gradeName} Ø{g.diameter}</span>
                  <span class={g.jammed ? 'up' : 'down'}>{g.jammed ? `${g.jammed}/${g.total} 卡` : '全部通过 ✓'}</span>
                </div>
              )}
            </For>

            <Show when={c().items.length}>
              <div class="small" style={{ margin: '10px 0 4px' }}>卡果明细（场景中红色定位）：</div>
              <For each={c().items}>
                {(it) => (
                  <div class="jam-item">
                    <b>{it.gradeName} Ø{it.diameter}</b> · {it.segmentName}
                    <Show when={it.rollerA} fallback={<div>落料口处卡料</div>}>
                      <div>停在第 <b>{it.rollerA}</b> 与第 <b>{it.rollerB}</b> 辊之间（X={Math.round(it.x)} mm）</div>
                    </Show>
                    <div class="small">{it.reason}</div>
                  </div>
                )}
              </For>
            </Show>

            <For each={c().constraintIssues}>
              {(it) => <div class="issue-item">⚠ {it.text}</div>}
            </For>
            <For each={c().openingIssues}>
              {(it) => <div class="issue-item">⚠ {it.text}</div>}
            </For>
            <For each={c().warnings}>
              {(t) => <div class="issue-item">ℹ {t}</div>}
            </For>
          </>
        )}
      </Show>
    </div>
  );
}

function ExportPanel() {
  const p = () => store.project;
  return (
    <div class="section">
      <h3>方案交付（车间规划/安装）</h3>
      <div class="toolbar">
        <button onClick={() => downloadText('料仓布置方案.txt', exportSiloPlan(p()))}>出料仓布置方案</button>
        <button onClick={() => downloadText('辊道装配尺寸表.csv', exportRollerTable(p()))}>出辊道装配尺寸表</button>
      </div>
      <button class="ghost" style={{ width: '100%', 'margin-top': '10px' }} onClick={resetWizard}>返回新建向导</button>
    </div>
  );
}

export default function RightPanel() {
  return (
    <div class="right-panel">
      <div class="section">
        <h3>属性编辑</h3>
        <Show
          when={store.selected.kind === 'segment'}
          fallback={<Show when={store.selected.kind === 'silo'}><SiloInspector /></Show>}
        >
          <SegmentInspector />
        </Show>
        <Show when={!store.selected.kind}>
          <p class="small">在场景中点选辊道段/料仓，或从左侧大纲选择，即可编辑参数。拖动场景对象后数值会自动回写到这里。</p>
        </Show>
      </div>
      <CheckPanel />
      <ExportPanel />
    </div>
  );
}
