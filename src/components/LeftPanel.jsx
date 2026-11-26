/* 左侧：设备厂商库（拖拽入场）+ 场景大纲 + 节拍 */
import { For, Show } from 'solid-js';
import { store, select, removeSelected } from '../store.js';
import { computeCadence, rollerCount } from '../model.js';

export default function LeftPanel() {
  const p = () => store.project;
  const cadence = () => computeCadence(p());

  const onDragStart = (e, payload) => {
    e.dataTransfer.setData('application/x-device', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div class="left-panel">
      <div class="section">
        <h3>输送节拍（按处理量推算）</h3>
        <div class="card">
          <div class="two-col">
            <div class="small">处理量</div>
            <div class="mono" style={{ 'text-align': 'right' }}>{p().throughputTph} t/h</div>
            <div class="small">参考果径 Ø{cadence().refDiameter} 单果质量</div>
            <div class="mono" style={{ 'text-align': 'right' }}>{cadence().massKg.toFixed(2)} kg</div>
            <div class="small">理论果量</div>
            <div class="mono" style={{ 'text-align': 'right' }}>{cadence().fruitsPerHour} 果/h</div>
            <div class="small">折合</div>
            <div class="mono" style={{ 'text-align': 'right' }}>{cadence().fruitsPerMin} 果/min</div>
            <div class="small">建议带速</div>
            <div class="mono" style={{ 'text-align': 'right', color: 'var(--accent)' }}>{cadence().speedMs} m/s</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h3>设备厂商库（拖入场景）</h3>
        <For each={p().rollerCatalog}>
          {(cat) => (
            <div class="card" draggable="true" onDragStart={(e) => onDragStart(e, { kind: 'roller', catalogId: cat.id })}>
              <div class="name">▦ {cat.vendor} {cat.model} 辊道</div>
              <div class="sub">
                辊径 Ø{cat.rollerDiameter}｜带宽 {cat.beltWidths.join('/')}｜节距 {cat.pitchMin}~{cat.pitchMax}｜最大倾角 {cat.maxInclineDeg}°
              </div>
            </div>
          )}
        </For>
        <For each={p().siloCatalog}>
          {(cat) => (
            <div class="card" draggable="true" onDragStart={(e) => onDragStart(e, { kind: 'silo', catalogId: cat.id })}>
              <div class="name">▣ {cat.vendor} {cat.model} 料仓</div>
              <div class="sub">
                {cat.capacityM3}m³｜{cat.length}×{cat.width}×{cat.height}｜出料口 {cat.outletMin}~{cat.outletMax}
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="section">
        <h3>场景大纲（{p().silos.length} 仓 / {p().segments.length} 段）</h3>
        <For each={p().silos}>
          {(silo) => (
            <div
              class={`card ${store.selected.kind === 'silo' && store.selected.id === silo.id ? 'selected' : ''}`}
              onClick={() => select('silo', silo.id)}
            >
              <div class="name">▣ {silo.name}</div>
              <div class="sub">X={silo.x} Z={silo.z}｜出料口高 {silo.outletHeight}｜口宽 {silo.outletWidth}</div>
            </div>
          )}
        </For>
        <For each={[...p().segments].sort((a, b) => a.x - b.x)}>
          {(seg) => (
            <div
              class={`card ${store.selected.kind === 'segment' && store.selected.id === seg.id ? 'selected' : ''}`}
              onClick={() => select('segment', seg.id)}
            >
              <div class="name">▦ {seg.name}</div>
              <div class="sub">
                长 {seg.length}｜辊距 {seg.pitch}（{rollerCount(seg)} 辊）｜带宽 {seg.beltWidth}｜倾角 {seg.inclineDeg}°
                <Show when={seg.dropOpening.gradeId}>
                  {' '}<span class="tag">落料口→{p().grades.find((g) => g.id === seg.dropOpening.gradeId)?.name}</span>
                </Show>
              </div>
            </div>
          )}
        </For>
        <Show when={store.selected.id}>
          <button class="danger" style={{ width: '100%', 'margin-top': '6px' }} onClick={removeSelected}>删除选中对象</button>
        </Show>
      </div>
    </div>
  );
}
