/* 方案交付物导出：料仓布置方案(.txt) + 辊道装配尺寸表(.csv) */
import { rollerCount, rollerX, segEndX } from './model.js';

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function exportSiloPlan(p) {
  const lines = [];
  lines.push('料仓与输送辊道布置方案（料仓分册）');
  lines.push('='.repeat(56));
  lines.push(`方案名称：${p.name}`);
  lines.push(`设计人：${p.designer || '—'}`);
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`设计处理量：${p.throughputTph} t/h`);
  lines.push(`果径档位：${p.grades.map((g) => `${g.name} Ø${g.dMin}-${g.dMax}（当量${g.nominal}）`).join('；')}`);
  lines.push('');
  lines.push(`一、现场约束（测绘值）`);
  lines.push(`  车间可用：长 ${p.site.hallLength} × 宽 ${p.site.hallWidth} mm`);
  lines.push(`  可布置 X 区间：${p.site.startX} ~ ${p.site.endX} mm`);
  lines.push('');
  lines.push(`二、料仓布置（共 ${p.silos.length} 座）`);
  if (!p.silos.length) lines.push('  （暂无料仓）');
  p.silos.forEach((s, i) => {
    lines.push(`  [${i + 1}] ${s.name}（${s.vendor} ${s.model}）`);
    lines.push(`      定位：X=${fmt(s.x)} mm，Z=${fmt(s.z)} mm`);
    lines.push(`      仓体：长 ${s.length} × 宽 ${s.width} × 高 ${s.height} mm`);
    lines.push(`      出料口：高度 ${s.outletHeight} mm，口宽 ${s.outletWidth} mm（厂商允许 ${s.outletMin}~${s.outletMax}）`);
    const near = [...p.segments].sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
    if (near) lines.push(`      最近辊道：${near.name}（起点 X=${near.x}，间距 ${Math.round(near.x - s.x)} mm）`);
    lines.push('');
  });
  lines.push('三、安装注意事项');
  lines.push('  1. 料仓支腿按定位坐标放线，出料口中心与下游首段辊道中心线偏差不大于 ±20 mm；');
  lines.push('  2. 出料口高度需与辊面标高匹配，溜槽角度不小于 35°；');
  lines.push('  3. 就位后复核仓体垂直度，地脚螺栓二次灌浆后再挂接料管。');
  if (p.lastCheck) {
    lines.push('');
    lines.push(`四、最近一次通过性检查：投放 ${p.lastCheck.totalFruit} 颗，卡果 ${p.lastCheck.totalJam} 颗`);
    if (p.lastCheck.totalJam === 0) lines.push('  全部档位通过，可按本方案下料安装。');
  }
  return lines.join('\n');
}

export function exportRollerTable(p) {
  const rows = [];
  rows.push([
    '段号', '段名称', '厂商型号', '起点X(mm)', '终点X(mm)', '中心Z(mm)', '段长(mm)',
    '辊径(mm)', '辊距(mm)', '辊子数(个)', '皮带宽度(mm)', '倾角(°)', '上游辊面标高(mm)',
    '落料口X(mm)', '落料口宽(mm)', '落料口偏移Z(mm)', '分拣档位', '对接机构'
  ].join(','));
  const segs = [...p.segments].sort((a, b) => a.x - b.x);
  segs.forEach((s, i) => {
    const grade = p.grades.find((g) => g.id === s.dropOpening.gradeId);
    rows.push([
      i + 1, s.name, `${s.vendor} ${s.model}`, s.x, segEndX(s), s.z, s.length,
      s.rollerDiameter, s.pitch, rollerCount(s), s.beltWidth, s.inclineDeg, s.baseHeight,
      segEndX(s), s.dropOpening.width, s.dropOpening.offsetZ,
      grade ? `${grade.name}(Ø${grade.nominal})` : '混果/末段',
      s.dropOpening.targetName || '—'
    ].join(','));
    // 逐辊坐标行（装配放线用）
    const n = rollerCount(s);
    for (let k = 0; k < n; k++) {
      rows.push([
        `${i + 1}.${k + 1}`, `  └ 第${k + 1}辊`, '', Math.round(rollerX(s, k)), '', s.z, '',
        s.rollerDiameter, s.pitch, '', s.beltWidth, s.inclineDeg, '', '', '', '', '', ''
      ].join(','));
    }
  });
  // 加 UTF-8 BOM，Excel 直接打开不乱码
  return '﻿' + rows.join('\n');
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
