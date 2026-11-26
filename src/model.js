// Pure glacier geometry, solar/shadow and passage-window model.
// Pixi rendering and DOM sidebar both read the same evaluated state.

export const DEG = Math.PI / 180;

export const WORLD = { width: 1600, height: 1080 };

// The map uses screen-like coordinates: +x is east/right, +y is south/down.
// Azimuth is compass degrees clockwise from north: 0=N, 90=E, 180=S.
export function azimuthVector(azimuthDeg) {
  const a = azimuthDeg * DEG;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

export function sunVector({ azimuth, elevation }) {
  const e = elevation * DEG;
  const h = azimuthVector(azimuth);
  return {
    x: Math.cos(e) * h.x,
    y: Math.cos(e) * h.y,
    z: Math.sin(e),
  };
}

export function sunAtHour(hour) {
  const p = Math.min(1, Math.max(0, (hour - 6) / 6));
  // Deliberately compact illustrative alpine summer path:
  // 06:00 low east-southeast sun, 12:00 high southern sun.
  return {
    hour,
    azimuth: 96 + 84 * p,
    elevation: 7 + 56 * Math.sin(p * Math.PI * 0.5),
  };
}

export const SLOPE = {
  angleDeg: 17,
  downAzimuthDeg: 166,
};

export function slopeModel(slope = SLOPE) {
  const down = azimuthVector(slope.downAzimuthDeg);
  const gradientMagnitude = Math.tan(slope.angleDeg * DEG);
  // Elevation z = gradient.x*x + gradient.y*y.
  const gradient = {
    x: -gradientMagnitude * down.x,
    y: -gradientMagnitude * down.y,
  };
  const normal = {
    x: -gradient.x,
    y: -gradient.y,
    z: 1,
  };
  const nLen = Math.hypot(normal.x, normal.y, normal.z);
  normal.x /= nLen;
  normal.y /= nLen;
  normal.z /= nLen;
  return { down, gradientMagnitude, gradient, normal };
}

/**
 * Map-plane displacement of the shadow of a vertical height H.
 * The denominator is the ray-vs-slope intersection term, so slope aspect and
 * steepness enter together with solar azimuth and elevation.
 */
export function shadowDisplacement(height, sun, slope = SLOPE) {
  const s = slopeModel(slope);
  const denominator = sun.z - s.gradient.x * sun.x - s.gradient.y * sun.y;
  const valid = denominator > 0.018;
  const safeDenominator = Math.max(denominator, 0.018);
  return {
    x: (-height * sun.x) / safeDenominator,
    y: (-height * sun.y) / safeDenominator,
    denominator,
    valid,
  };
}

export function crevasseFrame(crevasse) {
  const dx = crevasse.p1.x - crevasse.p0.x;
  const dy = crevasse.p1.y - crevasse.p0.y;
  const length = Math.hypot(dx, dy);
  const dir = { x: dx / length, y: dy / length };
  // Left normal in Pixi's y-down coordinate convention.
  const normal = { x: -dir.y, y: dir.x };
  const angle = Math.atan2(dy, dx);
  const wallInset =
    crevasse.depth * Math.tan((crevasse.wallLeanDeg ?? 16) * DEG);
  const bottomWidth = Math.max(
    2.5,
    crevasse.width - 2 * wallInset,
  );
  return { length, dir, normal, angle, wallInset, bottomWidth };
}

export function pointAlong(crevasse, distance) {
  const f = crevasseFrame(crevasse);
  return {
    x: crevasse.p0.x + f.dir.x * distance,
    y: crevasse.p0.y + f.dir.y * distance,
  };
}

export const CREVASSES = [
  {
    id: 'c1',
    name: '下坎裂缝',
    p0: { x: 180, y: 650 },
    p1: { x: 1112, y: 953 },
    width: 9.8,
    depth: 19,
    wallLeanDeg: 9,
    rimHeight: 1.2,
    bridges: [
      {
        id: 'b1',
        name: '一号桥 · 蓝冰下唇',
        from: 392,
        to: 468,
        thickness: 2.1,
        routeOrder: 1,
      },
    ],
  },
  {
    id: 'c2',
    name: '中脊裂缝',
    p0: { x: 300, y: 430 },
    p1: { x: 1314, y: 740 },
    width: 9.6,
    depth: 18,
    wallLeanDeg: 12,
    rimHeight: 1.0,
    bridges: [
      {
        id: 'b2',
        name: '二号桥 · 雪檐窄桥',
        from: 486,
        to: 558,
        thickness: 1.25,
        routeOrder: 2,
      },
    ],
  },
  {
    id: 'c3',
    name: '上冰瀑裂缝',
    p0: { x: 610, y: 215 },
    p1: { x: 1503, y: 540 },
    width: 11.2,
    depth: 20,
    wallLeanDeg: 11,
    rimHeight: 1.5,
    bridges: [
      {
        id: 'b3',
        name: '三号桥 · 厚雪拱',
        from: 392,
        to: 470,
        thickness: 4.4,
        routeOrder: 3,
      },
    ],
  },
  {
    id: 'c4',
    name: '北壁露出深槽',
    p0: { x: 70, y: 365 },
    p1: { x: 610, y: 210 },
    width: 20,
    depth: 25,
    wallLeanDeg: 10,
    rimHeight: 2.0,
    bridges: [],
  },
  {
    id: 'c5',
    name: '东南支裂缝',
    p0: { x: 1170, y: 900 },
    p1: { x: 1510, y: 805 },
    width: 12,
    depth: 11,
    wallLeanDeg: 18,
    rimHeight: 0.9,
    bridges: [
      {
        id: 'b4',
        name: '备用雪桥（不在结组路线）',
        from: 142,
        to: 214,
        thickness: 2.8,
        routeOrder: null,
      },
    ],
  },
];

export const ROUTE = [
  { x: 170, y: 1000, label: '大本营' },
  { x: 420, y: 970 },
  { x: 554, y: 892 },
  { bridgeId: 'b1' },
  { x: 625, y: 674 },
  { x: 768, y: 678 },
  { bridgeId: 'b2' },
  { x: 827, y: 486 },
  { x: 980, y: 456 },
  { bridgeId: 'b3' },
  { x: 1048, y: 268 },
  { x: 1210, y: 170 },
  { x: 1390, y: 105, label: '顶峰平台' },
];

export function bridgeCenter(crevasse, bridge) {
  return pointAlong(crevasse, (bridge.from + bridge.to) / 2);
}

export function findBridge(id) {
  for (const crevasse of CREVASSES) {
    const bridge = crevasse.bridges.find((b) => b.id === id);
    if (bridge) return { crevasse, bridge };
  }
  return null;
}

export function evaluateBridge(bridge, crevasse, sunInput, slope = SLOPE) {
  const sun = 'x' in sunInput ? sunInput : sunVector(sunInput);
  const frame = crevasseFrame(crevasse);
  const sm = slopeModel(slope);

  const normalDotSun =
    sun.x * sm.normal.x + sun.y * sm.normal.y + sun.z * sm.normal.z;
  const incidenceCos = Math.min(1, Math.max(-1, normalDotSun));
  const incidenceDeg = Math.acos(incidenceCos) / DEG;
  // A small grazing-angle tolerance keeps the wording stable around 90°.
  const deckIlluminated = normalDotSun > 0.105;

  // The crevasse depth and low rim/serac height set the moving cast-shadow
  // reach. Bridge thickness deliberately changes portal darkness only; the
  // stated passage test is illumination plus width coverage, not thickness.
  const castHeight = crevasse.depth + (crevasse.rimHeight ?? 0);
  const q = shadowDisplacement(castHeight, sun, slope);
  const localX = q.x * frame.dir.x + q.y * frame.dir.y;
  const localCross = q.x * frame.normal.x + q.y * frame.normal.y;

  // The wall toe already shadows wallInset on both margins; the projected ray
  // term adds the moving cast-shadow reach across the opening.
  const rawReach = frame.wallInset * 0.55 + Math.abs(localCross);
  const shadowReach = Math.min(crevasse.width, rawReach);
  const shadowCoverage = Math.min(1, Math.max(0, rawReach / crevasse.width));
  const shadowCoversFullWidth = shadowCoverage >= 0.985;

  const passable = deckIlluminated && !shadowCoversFullWidth;

  return {
    sun,
    frame,
    incidenceDeg,
    illumination: Math.max(0, normalDotSun),
    deckIlluminated,
    shadow: {
      vector: q,
      localX,
      localCross,
      reach: shadowReach,
      coverage: shadowCoverage,
      coversFullWidth: shadowCoversFullWidth,
    },
    passable,
    reason: !deckIlluminated
      ? '桥面处于背阴坡，未被直射阳光照亮'
      : shadowCoversFullWidth
        ? '阴影已扫过雪桥全宽，没有可辨认的受光踩踏带'
        : '桥面受光且仍保留未被阴影覆盖的宽度',
  };
}

export function evaluateAllBridges(sunInput) {
  return CREVASSES.flatMap((crevasse) =>
    crevasse.bridges.map((bridge) => ({
      crevasse,
      bridge,
      evaluation: evaluateBridge(bridge, crevasse, sunInput),
    })),
  );
}

export function passageWindow(bridge, crevasse, slope = SLOPE) {
  const samples = [];
  let firstPass = null;
  let lastPass = null;
  for (let minute = 360; minute <= 720; minute += 2) {
    const hour = minute / 60;
    const ev = evaluateBridge(
      bridge,
      crevasse,
      sunVector(sunAtHour(hour)),
      slope,
    );
    if (ev.passable) {
      firstPass ??= hour;
      lastPass = hour;
    }
    samples.push({ hour, passable: ev.passable, coverage: ev.shadow.coverage });
  }
  return { firstPass, lastPass, samples };
}

export function getBridgeSchedule(bridge, crevasse, slope = SLOPE) {
  const window = passageWindow(bridge, crevasse, slope);
  let closureHour = null;

  // The narrative control starts at 07:00. For the preset route each bridge is
  // passable then and has one persistent closure before noon.
  for (let minute = 421; minute <= 720; minute += 1) {
    const hour = minute / 60;
    const current = evaluateBridge(
      bridge,
      crevasse,
      sunVector(sunAtHour(hour)),
      slope,
    );
    if (!current.passable) {
      let remainsClosed = true;
      for (let later = minute + 5; later <= 720; later += 5) {
        const laterHour = later / 60;
        const ev = evaluateBridge(
          bridge,
          crevasse,
          sunVector(sunAtHour(laterHour)),
          slope,
        );
        if (ev.passable) {
          remainsClosed = false;
          break;
        }
      }
      if (remainsClosed) {
        closureHour = hour;
        break;
      }
    }
  }

  return { ...window, closureHour };
}

export function formatHour(hour) {
  if (hour == null || Number.isNaN(hour)) return '—';
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

