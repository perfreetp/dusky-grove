import { defaultWizard, makeSegment, makeSilo, createProject } from '../src/model.js';
import { runPassabilityCheck } from '../src/check.js';

const w = defaultWizard();
w.batchPerGrade = 24;
const p = createProject(w);
const rc = w.rollerCatalog[0];
const sc = w.siloCatalog[0];
p.silos.push(makeSilo(sc, 600, 0));
const mk = (x, pitch, inc, gradeId) => {
  const s = makeSegment(rc, x, 0, 5000);
  s.pitch = pitch;
  s.inclineDeg = inc;
  s.dropOpening.gradeId = gradeId;
  return s;
};
p.segments.push(
  mk(1800, 75, 5, w.grades[0].id),
  mk(6800, 75, 4, w.grades[2].id),
  mk(11800, 60, 2, w.grades[1].id)
);const r1 = runPassabilityCheck(p, 1);
console.log('=== 初始布局（第三段 pitch=60, 倾角2°）===');
console.log('总果实', r1.totalFruit, '卡果', r1.totalJam);
for (const g of r1.perGrade) console.log(g.gradeName, 'Ø' + g.diameter, '卡', g.jammed, '/', g.total);
console.log('卡果位置样例:', r1.items.slice(0, 4).map((i) => `${i.segmentName} 辊${i.rollerA}-${i.rollerB} ${i.reason}`));

p.segments[2].pitch = 72;
p.segments[2].inclineDeg = 5;
const r2 = runPassabilityCheck(p, 2);
console.log('\n=== 修复后（第三段 pitch=72, 倾角5°）===');
console.log('总果实', r2.totalFruit, '卡果', r2.totalJam);
for (const g of r2.perGrade) console.log(g.gradeName, 'Ø' + g.diameter, '卡', g.jammed, '/', g.total);

const counts = [];
for (let seq = 1; seq <= 8; seq++) {
  p.segments[2].pitch = 60;
  p.segments[2].inclineDeg = 2;
  counts.push(runPassabilityCheck(p, seq).bySegment[p.segments[2].id]);
}
console.log('\n初始布局 8 轮第三段卡果数分布:', counts.join(','));
const counts2 = [];
for (let seq = 1; seq <= 8; seq++) {
  p.segments[2].pitch = 72;
  p.segments[2].inclineDeg = 5;
  counts2.push(runPassabilityCheck(p, seq).totalJam);
}
console.log('修复布局 8 轮总卡果数:', counts2.join(','));
