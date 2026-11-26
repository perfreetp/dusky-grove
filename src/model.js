/* ============================================================
 * 核心领域模型与默认数据（全部尺寸单位：毫米 mm，角度：度）
 * 坐标系：X = 输送方向，Y = 竖直向上，Z = 辊道横向
 * PlayCanvas 内部以米渲染：所有实体坐标 = 数据值 / 1000
 * ============================================================ */

export const MM = 0.001; // mm -> m

/** 新方案向导的默认厂商目录与现场约束 */
export function defaultWizard() {
  return {
    projectName: '分选线布置方案',
    designer: '',
    throughputTph: 8, // 每小时处理量（吨）
    // 果径档位（分选线的筛孔档位），dMin/dMax 为果径区间 mm
    grades: [
      { id: 'g1', name: '小果档', dMin: 60, dMax: 68, nominal: 65 },
      { id: 'g2', name: '中果档', dMin: 70, dMax: 79, nominal: 75 },
      { id: 'g3', name: '大果档', dMin: 80, dMax: 90, nominal: 85 }
    ],
    // 设备厂商目录：辊道（辊子直径/皮带宽度可选系列，节距可调范围）
    rollerCatalog: [
      {
        id: 'rc1',
        vendor: '众联输送',
        model: 'RL-80',
        rollerDiameter: 80,
        beltWidths: [600, 800, 1000],
        pitchMin: 40,
        pitchMax: 120,
        maxInclineDeg: 12
      },
      {
        id: 'rc2',
        vendor: '众联输送',
        model: 'RL-100',
        rollerDiameter: 100,
        beltWidths: [800, 1000, 1200],
        pitchMin: 50,
        pitchMax: 150,
        maxInclineDeg: 10
      }
    ],
    // 设备厂商目录：料仓
    siloCatalog: [
      {
        id: 'sc1',
        vendor: '华储机械',
        model: 'HC-5',
        capacityM3: 5,
        width: 1000,
        length: 1200,
        height: 2200,
        outletMin: 200,
        outletMax: 450
      },
      {
        id: 'sc2',
        vendor: '华储机械',
        model: 'HC-8',
        capacityM3: 8,
        width: 1200,
        length: 1500,
        height: 2600,
        outletMin: 250,
        outletMax: 600
      }
    ],
    // 现场测绘的安装约束
    site: {
      hallLength: 24000, // 车间可用长度（X 向）
      hallWidth: 12000, // 车间可用宽度（Z 向）
      baseY: 0, // 地面标高
      startX: 1000, // 允许布置起点 X
      endX: 22000 // 允许布置终点 X（硬墙/设备区）
    },
    batchPerGrade: 20 // 通过性检查每档投放果实数
  };
}

/** 初始空工程（向导完成后填充） */
export function createProject(w) {
  return {
    id: uid('p'),
    name: w.projectName,
    designer: w.designer,
    createdAt: Date.now(),
    throughputTph: w.throughputTph,
    grades: w.grades.map((g) => ({ ...g })),
    rollerCatalog: w.rollerCatalog.map((c) => ({ ...c })),
    siloCatalog: w.siloCatalog.map((c) => ({ ...c })),
    site: { ...w.site },
    batchPerGrade: w.batchPerGrade,
    silos: [],
    segments: [],
    // 通过性检查结果（每次检查覆盖）
    lastCheck: null,
    prevCheck: null
  };
}

let _uid = 0;
export function uid(prefix) {
  _uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${_uid}`;
}

/** 根据厂商目录创建料仓实例 */
export function makeSilo(catalogItem, x = 0, z = 0) {
  return {
    id: uid('silo'),
    catalogId: catalogItem.id,
    vendor: catalogItem.vendor,
    model: catalogItem.model,
    name: `${catalogItem.model} 料仓`,
    x,
    z,
    width: catalogItem.width,
    length: catalogItem.length,
    height: catalogItem.height,
    outletHeight: Math.round((catalogItem.outletMin + catalogItem.outletMax) / 2),
    outletWidth: Math.round((catalogItem.outletMin + catalogItem.outletMax) / 2),
    outletMin: catalogItem.outletMin,
    outletMax: catalogItem.outletMax,
    outletGradeId: null // 出料口服务的果径档（可空 = 混果）
  };
}

/** 根据厂商目录创建辊道段 */
export function makeSegment(catalogItem, x = 0, z = 0, length = 4000) {
  const pitch = 60;
  return {
    id: uid('seg'),
    catalogId: catalogItem.id,
    vendor: catalogItem.vendor,
    model: catalogItem.model,
    name: `${catalogItem.model} 辊道段`,
    x, // 段起点（输送上游端）X
    z, // 段中心线 Z
    length,
    beltWidth: catalogItem.beltWidths[0],
    rollerDiameter: catalogItem.rollerDiameter,
    pitch, // 辊距（相邻辊轴中心距）
    inclineDeg: 0,
    baseHeight: 800, // 上游端辊面标高（腿高）
    maxInclineDeg: catalogItem.maxInclineDeg,
    pitchMin: catalogItem.pitchMin,
    pitchMax: catalogItem.pitchMax,
    widthOptions: [...catalogItem.beltWidths],
    // 落料口：位于段末端，offsetZ 相对段中心线
    dropOpening: {
      width: 300,
      offsetZ: 0,
      gradeId: null, // 该落料口分拣的果径档
      targetName: '' // 对接的分拣机构（备注）
    }
  };
}

/** 段上辊子数量（含两端） */
export function rollerCount(seg) {
  return Math.max(2, Math.round(seg.length / seg.pitch) + 1);
}

/** 段上第 i 个辊子的世界 X（mm）；沿倾斜方向的水平投影 */
export function rollerX(seg, i) {
  return seg.x + (seg.length * i) / (rollerCount(seg) - 1);
}

/** 段末端世界 X */
export function segEndX(seg) {
  return seg.x + seg.length;
}

/** 每小时吨数 -> 输送节拍（m/s 与 个/分钟），按当量果径估算 */
export function computeCadence(project) {
  // 取中间档当量直径估算单果质量（苹果近似密度 800 kg/m3 的球）
  const g = project.grades[Math.floor(project.grades.length / 2)] || { nominal: 75 };
  const r = (g.nominal / 2) * MM;
  const massKg = (4 / 3) * Math.PI * r ** 3 * 800;
  const fruitsPerHour = (project.throughputTph * 1000) / Math.max(massKg, 0.01);
  const fruitsPerMin = fruitsPerHour / 60;
  // 果间间距按 2.5 倍果径估
  const spacing = g.nominal * 2.5 * MM;
  const speedMs = (fruitsPerHour * spacing) / 3600;
  return {
    massKg,
    fruitsPerHour: Math.round(fruitsPerHour),
    fruitsPerMin: Math.round(fruitsPerMin),
    speedMs: +speedMs.toFixed(2),
    refDiameter: g.nominal
  };
}
