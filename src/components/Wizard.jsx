/* 新建方案向导：厂商目录 + 现场约束 + 处理量/果径档 */
import { createStore } from 'solid-js/store';
import { defaultWizard } from '../model.js';
import { completeWizard } from '../store.js';

export default function Wizard() {
  const [w, setW] = createStore(defaultWizard());

  const update = (path, value) => setW(path, value);

  const addGrade = () =>
    setW('grades', w.grades.length, (g) => [...g, { id: `g${Date.now()}`, name: '新档位', dMin: 60, dMax: 70, nominal: 65 }]);
  const removeGrade = (i) => setW('grades', (gs) => gs.filter((_, idx) => idx !== i));

  const addRoller = () =>
    setW('rollerCatalog', (rs) => [
      ...rs,
      { id: `rc${Date.now()}`, vendor: '新厂商', model: 'RL-X', rollerDiameter: 80, beltWidths: [800], pitchMin: 50, pitchMax: 120, maxInclineDeg: 10 }
    ]);
  const removeRoller = (i) => setW('rollerCatalog', (rs) => rs.filter((_, idx) => idx !== i));

  const addSilo = () =>
    setW('siloCatalog', (ss) => [
      ...ss,
      { id: `sc${Date.now()}`, vendor: '新厂商', model: 'HC-X', capacityM3: 5, width: 1000, length: 1200, height: 2200, outletMin: 200, outletMax: 450 }
    ]);
  const removeSilo = (i) => setW('siloCatalog', (ss) => ss.filter((_, idx) => idx !== i));

  return (
    <div class="wizard-mask">
      <div class="wizard">
        <h1>新建分选线布置方案</h1>
        <p class="lead">先录入设备厂商目录尺寸与现场测绘约束，再按处理量与果径区间确定输送节拍。全部尺寸单位 mm。</p>

        <div class="wizard-grid">
          <div>
            <div class="section">
              <h3>工程信息</h3>
              <div class="two-col">
                <label class="field"><span>方案名称</span>
                  <input value={w.projectName} onInput={(e) => update('projectName', e.currentTarget.value)} />
                </label>
                <label class="field"><span>设计人</span>
                  <input value={w.designer} onInput={(e) => update('designer', e.currentTarget.value)} placeholder="如：李工" />
                </label>
              </div>
              <label class="field"><span>每小时处理量（吨/小时 t/h）</span>
                <input type="number" min="1" value={w.throughputTph} onInput={(e) => update('throughputTph', +e.currentTarget.value)} />
              </label>
              <label class="field"><span>通过性检查每档投放果实数</span>
                <input type="number" min="5" max="200" value={w.batchPerGrade} onInput={(e) => update('batchPerGrade', +e.currentTarget.value)} />
              </label>
            </div>

            <div class="section">
              <h3>果径档位（分选区间）</h3>
              <table class="data">
                <thead><tr><th>档位名</th><th>果径下限</th><th>当量果径</th><th>上限</th><th></th></tr></thead>
                <tbody>
                  {w.grades.map((g, i) => (
                    <tr>
                      <td><input value={g.name} onInput={(e) => update(`grades.${i}.name`, e.currentTarget.value)} /></td>
                      <td><input type="number" value={g.dMin} onInput={(e) => update(`grades.${i}.dMin`, +e.currentTarget.value)} /></td>
                      <td><input type="number" value={g.nominal} onInput={(e) => update(`grades.${i}.nominal`, +e.currentTarget.value)} /></td>
                      <td><input type="number" value={g.dMax} onInput={(e) => update(`grades.${i}.dMax`, +e.currentTarget.value)} /></td>
                      <td><button class="ghost danger" onClick={() => removeGrade(i)}>删</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button style={{ 'margin-top': '8px' }} onClick={addGrade}>+ 增加果径档</button>
            </div>

            <div class="section">
              <h3>现场测绘安装约束</h3>
              <div class="two-col">
                <label class="field"><span>车间可用长度</span>
                  <input type="number" value={w.site.hallLength} onInput={(e) => update('site.hallLength', +e.currentTarget.value)} />
                </label>
                <label class="field"><span>车间可用宽度</span>
                  <input type="number" value={w.site.hallWidth} onInput={(e) => update('site.hallWidth', +e.currentTarget.value)} />
                </label>
                <label class="field"><span>布置起点 X</span>
                  <input type="number" value={w.site.startX} onInput={(e) => update('site.startX', +e.currentTarget.value)} />
                </label>
                <label class="field"><span>布置终点 X（硬墙）</span>
                  <input type="number" value={w.site.endX} onInput={(e) => update('site.endX', +e.currentTarget.value)} />
                </label>
              </div>
            </div>
          </div>

          <div>
            <div class="section">
              <h3>厂商目录 · 辊道</h3>
              <table class="data">
                <thead><tr><th>厂商/型号</th><th>辊径</th><th>带宽系列</th><th>节距范围</th><th>最大倾角</th><th></th></tr></thead>
                <tbody>
                  {w.rollerCatalog.map((c, i) => (
                    <tr>
                      <td>
                        <input value={c.vendor} onInput={(e) => update(`rollerCatalog.${i}.vendor`, e.currentTarget.value)} />
                        <input style={{ 'margin-top': '4px' }} value={c.model} onInput={(e) => update(`rollerCatalog.${i}.model`, e.currentTarget.value)} />
                      </td>
                      <td><input type="number" value={c.rollerDiameter} onInput={(e) => update(`rollerCatalog.${i}.rollerDiameter`, +e.currentTarget.value)} /></td>
                      <td><input value={c.beltWidths.join(',')} onInput={(e) => update(`rollerCatalog.${i}.beltWidths`, e.currentTarget.value.split(',').map(Number).filter(Boolean))} /></td>
                      <td>
                        <input type="number" value={c.pitchMin} onInput={(e) => update(`rollerCatalog.${i}.pitchMin`, +e.currentTarget.value)} />
                        <input style={{ 'margin-top': '4px' }} type="number" value={c.pitchMax} onInput={(e) => update(`rollerCatalog.${i}.pitchMax`, +e.currentTarget.value)} />
                      </td>
                      <td><input type="number" value={c.maxInclineDeg} onInput={(e) => update(`rollerCatalog.${i}.maxInclineDeg`, +e.currentTarget.value)} /></td>
                      <td><button class="ghost danger" onClick={() => removeRoller(i)}>删</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button style={{ 'margin-top': '8px' }} onClick={addRoller}>+ 增加辊道型号</button>
            </div>

            <div class="section">
              <h3>厂商目录 · 料仓</h3>
              <table class="data">
                <thead><tr><th>厂商/型号</th><th>容积m³</th><th>长×宽×高</th><th>出料口范围</th><th></th></tr></thead>
                <tbody>
                  {w.siloCatalog.map((c, i) => (
                    <tr>
                      <td>
                        <input value={c.vendor} onInput={(e) => update(`siloCatalog.${i}.vendor`, e.currentTarget.value)} />
                        <input style={{ 'margin-top': '4px' }} value={c.model} onInput={(e) => update(`siloCatalog.${i}.model`, e.currentTarget.value)} />
                      </td>
                      <td><input type="number" value={c.capacityM3} onInput={(e) => update(`siloCatalog.${i}.capacityM3`, +e.currentTarget.value)} /></td>
                      <td>
                        <input type="number" value={c.length} onInput={(e) => update(`siloCatalog.${i}.length`, +e.currentTarget.value)} />
                        <input style={{ 'margin-top': '4px' }} type="number" value={c.width} onInput={(e) => update(`siloCatalog.${i}.width`, +e.currentTarget.value)} />
                        <input style={{ 'margin-top': '4px' }} type="number" value={c.height} onInput={(e) => update(`siloCatalog.${i}.height`, +e.currentTarget.value)} />
                      </td>
                      <td>
                        <input type="number" value={c.outletMin} onInput={(e) => update(`siloCatalog.${i}.outletMin`, +e.currentTarget.value)} />
                        <input style={{ 'margin-top': '4px' }} type="number" value={c.outletMax} onInput={(e) => update(`siloCatalog.${i}.outletMax`, +e.currentTarget.value)} />
                      </td>
                      <td><button class="ghost danger" onClick={() => removeSilo(i)}>删</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button style={{ 'margin-top': '8px' }} onClick={addSilo}>+ 增加料仓型号</button>
            </div>
          </div>
        </div>

        <div style={{ 'margin-top': '18px', display: 'flex', 'justify-content': 'flex-end', gap: '10px' }}>
          <button class="primary" onClick={() => completeWizard(w)}>进入三维布置 →</button>
        </div>
      </div>
    </div>
  );
}
