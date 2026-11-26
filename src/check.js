/* ============================================================
 * 通过性检查引擎
 * 规则（设备工程可调阈值集中在此）：
 *  1) 辊距挤压卡果：pitch < K_PINCH * 果径  —— 辊间过紧，果实被夹停
 *  2) 辊隙跌落卡果：pitch > K_FALL  * 果径  —— 间隙过大，果实楔入两辊之间
 *  3) 落料口卡料：口宽 < K_OPEN_MIN * 果径
 *  4) 落料口漏果：口宽 > K_OPEN_MAX * 果径（警告）
 *  5) 倾角不足：< 3° 时果实缺少重力助推，卡果概率上浮
 * 结果可复现：种子由 检查轮次+段+档位+果实序号 派生
 * ============================================================ */
import { rollerCount, rollerX, segEndX } from './model.js';

export const RULES = {
  K_PINCH: 0.85,
  K_FALL: 1.25,
  K_OPEN_MIN: 1.1,
  K_OPEN_MAX: 2.2,
  MIN_INCLINE: 3,
  PINCH_GAIN: 1.3, // 严重度 -> 单果卡果概率增益
  FALL_GAIN: 0.6,
  LOW_INCLINE_BOOST: 0.03
};

/** 字符串 -> 32bit 种子（FNV-1a 变体） */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 确定性随机 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** 单个果实在一段辊道上的卡果概率（不含落料口） */
function jamProbability(seg, d) {
  let p = 0;
  const pinchLimit = RULES.K_PINCH * d;
  const fallLimit = RULES.K_FALL * d;
  if (seg.pitch < pinchLimit) {
    p += ((pinchLimit - seg.pitch) / pinchLimit) * RULES.PINCH_GAIN;
  }
  if (seg.pitch > fallLimit) {
    p += ((seg.pitch - fallLimit) / fallLimit) * RULES.FALL_GAIN;
  }
  if (seg.inclineDeg < RULES.MIN_INCLINE) {
    p += RULES.LOW_INCLINE_BOOST;
  }
  return clamp01(p);
}

/** 推荐辊距安全区间（吸附提示与面板提示共用） */
export function safePitchRange(d) {
  return { min: Math.ceil(RULES.K_PINCH * d), max: Math.floor(RULES.K_FALL * d) };
}

/**
 * 执行一次通过性检查
 * @param project 工程数据
 * @param runSeq  检查轮次序号（参与种子，保证每轮可复现且互不相同）
 */
export function runPassabilityCheck(project, runSeq = 1) {
  const segs = [...project.segments].sort((a, b) => a.x - b.x);
  const result = {
    id: `check_${runSeq}`,
    timestamp: Date.now(),
    runSeq,
    totalFruit: 0,
    totalJam: 0,
    items: [], // 卡果明细
    openingIssues: [],
    constraintIssues: [],
    warnings: [],
    perGrade: [],
    bySegment: {}
  };
  for (const s of segs) result.bySegment[s.id] = 0;

  if (!segs.length || !project.grades.length) {
    result.warnings.push('场景中没有辊道段或果径档位，无法检查。');
    return result;
  }

  // 段间连续性 / 边界约束
  const site = project.site;
  segs.forEach((s, i) => {
    if (s.x < site.startX - 1 || segEndX(s) > site.endX + 1) {
      result.constraintIssues.push({
        segmentId: s.id,
        text: `${s.name} 超出车间可布置范围（X ${site.startX}~${site.endX} mm）`
      });
    }
    if (Math.abs(s.z) > site.hallWidth / 2) {
      result.constraintIssues.push({ segmentId: s.id, text: `${s.name} 横向超出车间宽度` });
    }
    if (s.inclineDeg > s.maxInclineDeg) {
      result.constraintIssues.push({
        segmentId: s.id,
        text: `${s.name} 倾角 ${s.inclineDeg}° 超过厂商允许值 ${s.maxInclineDeg}°`
      });
    }
    if (i > 0) {
      const gap = s.x - segEndX(segs[i - 1]);
      if (gap > 50) {
        result.warnings.push(`${segs[i - 1].name} 与 ${s.name} 之间存在 ${Math.round(gap)} mm 断档`);
      } else if (gap < -50) {
        result.constraintIssues.push({
          segmentId: s.id,
          text: `${s.name} 与上游段重叠 ${Math.round(-gap)} mm`
        });
      }
    }
  });

  const batch = project.batchPerGrade || 20;

  for (const grade of project.grades) {
    const d = grade.nominal;
    // 该档位的终点段：落料口绑定该档的段；未绑定则走完全程
    let endIdx = segs.findIndex((s) => s.dropOpening.gradeId === grade.id);
    if (endIdx < 0) endIdx = segs.length - 1;
    const path = segs.slice(0, endIdx + 1);

    let jammed = 0;
    for (let f = 0; f < batch; f++) {
      result.totalFruit += 1;
      let stopped = false;
      for (const seg of path) {
        const rand = rng(hashSeed(`${result.id}|${seg.id}|${grade.id}|${f}`));
        const p = jamProbability(seg, d);
        if (rand() < p) {
          // 卡在某个辊间：用第二随机数定位具体辊隙
          const n = rollerCount(seg);
          const pick = rng(hashSeed(`${result.id}|${seg.id}|${grade.id}|${f}|gap`));
          const gapIdx = Math.min(n - 2, Math.floor(pick() * (n - 1)));
          const x = (rollerX(seg, gapIdx) + rollerX(seg, gapIdx + 1)) / 2;
          const reason =
            seg.pitch < RULES.K_PINCH * d
              ? '辊距过紧挤压卡果'
              : seg.pitch > RULES.K_FALL * d
                ? '辊隙过大楔入卡果'
                : '低倾角滞留卡果';
          result.items.push({
            fruitId: f,
            gradeId: grade.id,
            gradeName: grade.name,
            diameter: d,
            segmentId: seg.id,
            segmentName: seg.name,
            rollerA: gapIdx + 1,
            rollerB: gapIdx + 2,
            x,
            z: seg.z,
            reason
          });
          result.bySegment[seg.id] += 1;
          jammed += 1;
          result.totalJam += 1;
          stopped = true;
          break;
        }
      }
      if (stopped) continue;

      // 抵达终点段落料口：检查口宽
      const last = path[path.length - 1];
      const open = last.dropOpening.width;
      if (open < RULES.K_OPEN_MIN * d) {
        result.items.push({
          fruitId: f,
          gradeId: grade.id,
          gradeName: grade.name,
          diameter: d,
          segmentId: last.id,
          segmentName: last.name,
          rollerA: null,
          rollerB: null,
          x: segEndX(last),
          z: last.z + last.dropOpening.offsetZ,
          reason: `落料口宽 ${open}mm 小于果径下限 ${Math.ceil(RULES.K_OPEN_MIN * d)}mm，口部卡料`
        });
        result.bySegment[last.id] += 1;
        jammed += 1;
        result.totalJam += 1;
      } else if (open > RULES.K_OPEN_MAX * d) {
        result.openingIssues.push({
          segmentId: last.id,
          text: `${last.name} 落料口宽 ${open}mm 对 ${grade.name}(Ø${d}) 偏大，存在漏果风险`
        });
      }
    }
    result.perGrade.push({ gradeId: grade.id, gradeName: grade.name, diameter: d, jammed, total: batch });
  }

  // 落料口问题去重
  result.openingIssues = dedup(result.openingIssues, (o) => o.text);
  return result;
}

function dedup(arr, key) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 两次检查的对比摘要 */
export function diffChecks(prev, cur) {
  if (!prev) return null;
  const out = { totalDelta: cur.totalJam - prev.totalJam, grades: [], segments: [] };
  for (const c of cur.perGrade) {
    const p = prev.perGrade.find((x) => x.gradeId === c.gradeId);
    out.grades.push({
      name: c.gradeName,
      diameter: c.diameter,
      before: p ? p.jammed : 0,
      after: c.jammed
    });
  }
  const segIds = new Set([...Object.keys(cur.bySegment), ...Object.keys(prev.bySegment)]);
  for (const id of segIds) {
    const before = prev.bySegment[id] || 0;
    const after = cur.bySegment[id] || 0;
    if (before !== after) out.segments.push({ segmentId: id, before, after });
  }
  return out;
}
