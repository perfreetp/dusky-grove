/* ============================================================
 * 教学示例：李工的 8 t/h 分选线
 * 场景设定（与需求故事一致）：
 *  - 3 座料仓 + 3 段辊道，沿 X 向接力布置
 *  - 第三段（末段）辊距 60mm，对 75mm 档过紧（安全下限 64mm），
 *    检查时该档在落料口前稳定卡 3 颗；把辊距调到 72mm 后卡果清零
 *  - 落料口按档位绑定：段1→小果，段2→中果(75)，段3→大果
 * ============================================================ */
import { store, completeWizard, mutate } from './store.js';
import { defaultWizard, makeSegment, makeSilo } from './model.js';

export function loadExampleProject() {
  const w = defaultWizard();
  w.projectName = '李工的 8t/h 分选线';
  w.designer = '李工';
  w.throughputTph = 8;
  w.batchPerGrade = 24; // 每档 24 颗，概率稳定复现 3 颗卡果
  completeWizard(w);

  const p = store.project;
  const rc = w.rollerCatalog[0]; // RL-80：辊径80，节距 40~120
  const sc = w.siloCatalog[0]; // HC-5

  mutate('载入教学示例', (proj) => {
    // 三座料仓布置在辊道上游侧
    proj.silos.push(makeSilo(sc, 600, 0));
    proj.silos.push(makeSilo(sc, 600, 1600));
    proj.silos.push(makeSilo(sc, 600, -1600));
    for (const s of proj.silos) {
      s.outletHeight = 320;
      s.outletWidth = 300;
    }

    // 三段辊道：段长 5000，接力不断档
    const seg1 = makeSegment(rc, 1800, 0, 5000);
    seg1.name = '第一段·初选辊道';
    seg1.pitch = 75;
    seg1.inclineDeg = 5;
    seg1.dropOpening.width = 320;
    seg1.dropOpening.gradeId = proj.grades[0].id; // 小果档在第一段分拣
    seg1.dropOpening.targetName = '一号分拣杯组';

    const seg2 = makeSegment(rc, 6800, 0, 5000);
    seg2.name = '第二段·中果辊道';
    seg2.pitch = 75;
    seg2.inclineDeg = 4;
    seg2.dropOpening.width = 340;
    seg2.dropOpening.gradeId = proj.grades[2].id; // 大果档在第二段分拣
    seg2.dropOpening.targetName = '二号分拣杯组';

    const seg3 = makeSegment(rc, 11800, 0, 5000);
    seg3.name = '第三段·末段辊道';
    seg3.pitch = 60; // ← 问题点：75mm 档安全下限 63.75，60 过紧，落料口前稳定卡果
    seg3.inclineDeg = 2; // 倾角也偏低，加重滞留
    seg3.dropOpening.width = 380;
    seg3.dropOpening.gradeId = proj.grades[1].id; // 中果档 75 走到第三段落料口
    seg3.dropOpening.targetName = '三号分拣杯组（落料口前为已知卡点）';

    proj.segments.push(seg1, seg2, seg3);
  });
}

/** 示例的“修复动作”：第三段辊距 60 → 72（也可由用户在面板/拖拽完成） */
export function applyExampleFix() {
  const seg3 = store.project.segments.find((s) => s.name.includes('第三段'));
  if (!seg3) return;
  mutate('第三段辊距 60→72', (proj) => {
    const s = proj.segments.find((x) => x.id === seg3.id);
    s.pitch = 72;
    s.inclineDeg = 5;
  });
}
