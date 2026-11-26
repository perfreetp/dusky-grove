import {
  Application,
  Container,
  Graphics,
  Text,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import {
  CREVASSES,
  ROUTE,
  SLOPE,
  WORLD,
  bridgeCenter,
  crevasseFrame,
  evaluateBridge,
  findBridge,
  slopeModel,
  sunVector,
} from './model.js';

// Stylistic width exaggeration: model widths are metres and map coordinates are
// metre-like world units. Multiplying only the cross-section width keeps the
// top-down ribbons legible at the initial fit zoom.
const WIDTH_SCALE = 2.35;

const COLORS = {
  ink: 0x123047,
  pass: 0x16a36a,
  block: 0xd64545,
  gold: 0xffc857,
};

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function resolvedRoutePoints() {
  return ROUTE.map((node) => {
    if (node.bridgeId) {
      const found = findBridge(node.bridgeId);
      return bridgeCenter(found.crevasse, found.bridge);
    }
    return { x: node.x, y: node.y };
  });
}

function flatPoints(points) {
  return points.flatMap((p) => [p.x, p.y]);
}

function drawTerrainBase(viewport) {
  const base = new Graphics();
  base.rect(-700, -700, 3000, 2500).fill(0xc7e2ef);
  viewport.addChild(base);

  // Broad glacier body and snow basins.
  const glacier = new Graphics();
  glacier
    .poly([
      -180, 180, 260, -120, 1040, -160, 1780, 40, 1810, 760, 1510, 1190,
      520, 1220, -120, 980,
    ])
    .fill({ color: 0xdaf0f8, alpha: 0.92 })
    .stroke({ color: 0x9dc8da, width: 3, alpha: 0.55 });
  viewport.addChild(glacier);

  const basin = new Graphics();
  basin
    .ellipse(1180, 150, 360, 150)
    .fill({ color: 0xf7fdff, alpha: 0.56 })
    .ellipse(250, 930, 310, 130)
    .fill({ color: 0xf7fdff, alpha: 0.42 })
    .ellipse(820, 560, 520, 230)
    .fill({ color: 0xeaf8fd, alpha: 0.28 });
  viewport.addChild(basin);

  // A few deterministic moraine/ice-rock patches give scale without noise.
  const rocks = new Graphics();
  const patches = [
    [115, 185, 34, 15], [1430, 875, 46, 18],
    [705, 130, 28, 12], [1325, 650, 24, 11],
    [250, 610, 22, 10], [930, 1010, 38, 15],
  ];
  for (const [x, y, rx, ry] of patches) {
    rocks
      .ellipse(x, y, rx, ry)
      .fill({ color: 0x55758a, alpha: 0.28 })
      .stroke({ color: 0x365a70, width: 2, alpha: 0.2 });
  }
  viewport.addChild(rocks);
}

function drawContours(viewport) {
  const contours = new Graphics();
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const { down } = slopeModel(SLOPE);
  const cross = { x: -down.y, y: down.x };

  for (let level = -1050; level <= 1050; level += 82) {
    const base = {
      x: center.x + down.x * level,
      y: center.y + down.y * level,
    };
    let started = false;
    for (let t = -1500; t <= 1500; t += 65) {
      const wiggle =
        Math.sin(t * 0.006 + level * 0.025) * 17 +
        Math.sin(t * 0.017 + level * 0.011) * 6;
      const x = base.x + cross.x * t + down.x * wiggle;
      const y = base.y + cross.y * t + down.y * wiggle;
      if (!started) {
        contours.moveTo(x, y);
        started = true;
      } else {
        contours.lineTo(x, y);
      }
    }
    const index = Math.round((level + 1050) / 82);
    const major = index % 5 === 0;
    contours.stroke({
      color: major ? 0x5d93ad : 0x80afc4,
      width: major ? 1.8 : 1,
      alpha: major ? 0.34 : 0.2,
    });
  }
  viewport.addChild(contours);
}

function makeText(text, options = {}) {
  return new Text({
    text,
    style: {
      fontFamily:
        '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif',
      fontSize: options.fontSize ?? 20,
      fontWeight: options.fontWeight ?? '700',
      fill: options.fill ?? 0x173b57,
      stroke: { color: options.stroke ?? 0xffffff, width: options.strokeWidth ?? 4 },
      ...options.style,
    },
  });
}

function drawRoute(viewport) {
  const points = flatPoints(resolvedRoutePoints());
  const route = new Graphics();
  route
    .poly(points)
    .stroke({ width: 12, color: 0x0b2740, alpha: 0.48, cap: 'round', join: 'round' });
  route
    .poly(points)
    .stroke({ width: 6.5, color: 0xff6b35, alpha: 0.98, cap: 'round', join: 'round' });
  route
    .poly(points)
    .stroke({ width: 1.4, color: 0xffe6a3, alpha: 0.55, cap: 'round', join: 'round' });
  viewport.addChild(route);

  for (const node of ROUTE) {
    if (!node.label) continue;
    const label = makeText(node.label, {
      fontSize: 22,
      fontWeight: '900',
      fill: 0x0b314d,
      strokeWidth: 5,
    });
    label.position.set(node.x + 12, node.y - 34);
    viewport.addChild(label);

    const flag = new Graphics();
    flag.circle(node.x, node.y, 7).fill(0xff6b35).stroke({ color: 0xffffff, width: 3 });
    viewport.addChild(flag);
  }
}

export async function createGlacierScene(host, callbacks = {}) {
  const app = new Application();
  await app.init({
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    background: 0xb9d9e9,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
  });
  host.appendChild(app.canvas);

  const viewport = new Viewport({
    screenWidth: host.clientWidth,
    screenHeight: host.clientHeight,
    worldWidth: WORLD.width,
    worldHeight: WORLD.height,
    events: app.renderer.events,
  });
  app.stage.addChild(viewport);

  viewport
    .drag({ presses: 1 })
    .pinch()
    .wheel({ smooth: 6 })
    .decelerate({ friction: 0.93 })
    .clampZoom({ minScale: 0.28, maxScale: 4.2 })
    .clamp({
      left: -260,
      right: WORLD.width + 260,
      top: -220,
      bottom: WORLD.height + 220,
    });

  drawTerrainBase(viewport);
  drawContours(viewport);

  const terrainShade = new Graphics();
  const terrainWarm = new Graphics();
  viewport.addChild(terrainShade);
  viewport.addChild(terrainWarm);

  const crevasseLayer = new Container();
  const routeLayer = new Container();
  const markerLayer = new Container();
  viewport.addChild(crevasseLayer, routeLayer, markerLayer);

  const crevasseViews = new Map();
  const markerViews = new Map();
  let selectedId = null;

  function drawBridgePortals(g, bridge, visualW) {
    const darkness = 0.34 + Math.min(1, bridge.thickness / 4.4) * 0.48;
    const rx = 5 + bridge.thickness * 2.25;
    const len = bridge.to - bridge.from;
    g.ellipse(bridge.from - 1, 0, rx, visualW / 2 + 4)
      .fill({ color: 0x041321, alpha: darkness })
      .stroke({ color: 0x2b6686, width: 2, alpha: 0.72 });
    g.ellipse(bridge.to + 1, 0, rx, visualW / 2 + 4)
      .fill({ color: 0x041321, alpha: darkness })
      .stroke({ color: 0x2b6686, width: 2, alpha: 0.72 });

    // Concentric portal depth lines make the darkness read as bridge thickness.
    for (let i = 1; i <= 3; i += 1) {
      const k = i / 4;
      g.ellipse(bridge.from - 1 - i * 1.7, 0, rx * (1 - k * 0.55), visualW / 2 + 4 - i * 2.2)
        .stroke({ color: 0x0a2b44, width: 1.4, alpha: 0.5 });
      g.ellipse(bridge.to + 1 + i * 1.7, 0, rx * (1 - k * 0.55), visualW / 2 + 4 - i * 2.2)
        .stroke({ color: 0x0a2b44, width: 1.4, alpha: 0.5 });
    }

    // Subtle snow courses on the deck.
    g.roundRect(bridge.from + 8, -visualW / 2 + 4, Math.max(10, len - 16), 2.2, 2)
      .fill({ color: 0xb9dceb, alpha: 0.55 });
    g.roundRect(bridge.from + 14, visualW / 2 - 6, Math.max(10, len - 28), 1.8, 2)
      .fill({ color: 0xc9e5f1, alpha: 0.7 });
  }

  for (const crevasse of CREVASSES) {
    const frame = crevasseFrame(crevasse);
    const length = frame.length;
    const visualW = crevasse.width * WIDTH_SCALE;
    const visualBottom = frame.bottomWidth * WIDTH_SCALE;

    const crevasseContainer = new Container();
    crevasseContainer.position.set(crevasse.p0.x, crevasse.p0.y);
    crevasseContainer.rotation = frame.angle;
    crevasseLayer.addChild(crevasseContainer);

    const rim = new Graphics();
    rim
      .roundRect(-28, -visualW / 2 - 7, length + 56, visualW + 14, 9)
      .fill({ color: 0xf2fbff, alpha: 0.92 })
      .stroke({ color: 0xa9cfdf, width: 2, alpha: 0.8 });
    crevasseContainer.addChild(rim);

    const faces = new Graphics();
    crevasseContainer.addChild(faces);

    const bottom = new Graphics();
    bottom
      .rect(0, -visualBottom / 2, length, visualBottom)
      .fill(0x173b57);
    bottom
      .rect(0, -visualBottom * 0.2, length, visualBottom * 0.4)
      .fill({ color: 0x061827, alpha: 0.62 });
    bottom
      .rect(0, -visualBottom / 2, length, 2)
      .fill({ color: 0x75b4cf, alpha: 0.35 });
    bottom
      .rect(0, visualBottom / 2 - 2, length, 2)
      .fill({ color: 0x071f33, alpha: 0.5 });
    crevasseContainer.addChild(bottom);

    const openShadow = new Graphics();
    crevasseContainer.addChild(openShadow);

    const bridgeViews = new Map();

    for (const bridge of crevasse.bridges) {
      const portal = new Graphics();
      drawBridgePortals(portal, bridge, visualW);
      crevasseContainer.addChild(portal);

      const deck = new Graphics();
      const bridgeLength = bridge.to - bridge.from;
      deck
        .roundRect(bridge.from, -visualW / 2, bridgeLength, visualW, 6)
        .fill(0xf7fdff)
        .stroke({ color: 0xb4d5e4, width: 2, alpha: 0.95 });
      crevasseContainer.addChild(deck);

      const shade = new Graphics();
      crevasseContainer.addChild(shade);

      const statusOutline = new Graphics();
      crevasseContainer.addChild(statusOutline);

      const selection = new Graphics();
      selection.visible = false;
      crevasseContainer.addChild(selection);

      const hitHeight = Math.max(visualW + 22, 38);
      const hit = new Graphics();
      hit
        .rect(bridge.from - 12, -hitHeight / 2, bridgeLength + 24, hitHeight)
        .fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      crevasseContainer.addChild(hit);

      let pointerStart = null;
      hit.on('pointerdown', (event) => {
        pointerStart = { x: event.global.x, y: event.global.y };
      });
      hit.on('pointerup', (event) => {
        if (!pointerStart) return;
        const distance = Math.hypot(
          event.global.x - pointerStart.x,
          event.global.y - pointerStart.y,
        );
        pointerStart = null;
        if (distance < 8) {
          selectBridge(bridge.id);
          callbacks.onSelect?.(bridge.id);
        }
      });
      hit.on('pointerupoutside', () => {
        pointerStart = null;
      });

      bridgeViews.set(bridge.id, {
        bridge,
        deck,
        shade,
        statusOutline,
        selection,
      });

      // World-space status marker.
      const center = bridgeCenter(crevasse, bridge);
      const marker = new Container();
      const offset = -1;
      marker.position.set(
        center.x + frame.normal.x * offset * (visualW /  2 + 31),
        center.y + frame.normal.y * offset * (visualW / 2 + 31),
      );
      const dot = new Graphics();
      marker.addChild(dot);

      const label = makeText(bridge.routeOrder ? String(bridge.routeOrder) : '备', {
        fontSize: 17,
        fontWeight: '1000',
        fill: 0xffffff,
        stroke: 0x0b2740,
        strokeWidth: 3,
      });
      label.anchor.set(0.5);
      marker.addChild(label);

      const mapName = bridge.routeOrder ? bridge.name : '备用雪桥';
      const name = makeText(mapName, {
        fontSize: 19,
        fontWeight: '850',
        fill: 0x123047,
        strokeWidth: 5,
      });
      name.position.set(21, -11);
      marker.addChild(name);

      markerLayer.addChild(marker);
      markerViews.set(bridge.id, { marker, dot, label });
    }

    crevasseViews.set(crevasse.id, {
      crevasse,
      frame,
      length,
      visualW,
      visualBottom,
      faces,
      openShadow,
      bridgeViews,
    });
  }

  drawRoute(routeLayer);

  function selectBridge(id, focus = false) {
    selectedId = id;
    for (const view of crevasseViews.values()) {
      for (const [bridgeId, bv] of view.bridgeViews) {
        const selected = bridgeId === id;
        bv.selection.visible = selected;
        if (selected) {
          const len = bv.bridge.to - bv.bridge.from;
          bv.selection.clear();
          bv.selection
            .roundRect(
              bv.bridge.from - 10,
              -view.visualW / 2 - 10,
              len + 20,
              view.visualW + 20,
              11,
            )
            .stroke({ color: COLORS.gold, width: 4.5, alpha: 0.98 });
        }
      }
    }
    for (const [bridgeId, mv] of markerViews) {
      mv.marker.scale.set(bridgeId === id ? 1.16 : 1);
    }
    if (focus && id) focusBridge(id);
  }

  function focusBridge(id) {
    const found = findBridge(id);
    if (!found) return;
    const p = bridgeCenter(found.crevasse, found.bridge);
    viewport.moveCenter(p.x, p.y);
    if (viewport.scaled < 1.25) viewport.setZoom(1.35, true);
  }

  function drawFaces(view, sun) {
    const { frame, visualW: W, visualBottom: B, length: L, faces } = view;
    faces.clear();
    faces.rect(0, -W / 2, L, W).fill(0x69a9c7);

    const sunNormal = sun.x * frame.normal.x + sun.y * frame.normal.y;
    const positive = clamp01(sunNormal);
    const negative = clamp01(-sunNormal);
    const inset = (W - B) / 2;

    // +normal wall.
    faces.rect(0, B / 2, L, inset)
      .fill({ color: 0xd9f4ff, alpha: 0.08 + positive * 0.38 });
    faces.rect(0, B / 2, L, inset)
      .fill({ color: 0x08263d, alpha: 0.1 + negative * 0.34 });

    // -normal wall.
    faces.rect(0, -W / 2, L, inset)
      .fill({ color: 0xd9f4ff, alpha: 0.08 + negative * 0.38 });
    faces.rect(0, -W / 2, L, inset)
      .fill({ color: 0x08263d, alpha: 0.1 + positive * 0.34 });

    // Crisp top rims and bottom toes.
    faces.rect(0, -W / 2 - 1, L, 2).fill({ color: 0xf4fcff, alpha: 0.8 });
    faces.rect(0, W / 2 - 1, L, 2).fill({ color: 0x2c6f91, alpha: 0.45 });
  }

  function shadowDirection(evaluation, sunNormal) {
    const cross = evaluation.shadow.localCross;
    if (Math.abs(cross) > 0.03) return Math.sign(cross);
    return sunNormal >= 0 ? -1 : 1;
  }

  function drawOpenShadow(view, evaluation, sun) {
    const g = view.openShadow;
    g.clear();
    const W = view.visualW;
    const reach = evaluation.shadow.coverage * W;
    const sunNormal = sun.x * view.frame.normal.x + sun.y * view.frame.normal.y;
    const dir = shadowDirection(evaluation, sunNormal);
    const y = dir > 0 ? -W / 2 : W / 2 - reach;

    g.rect(0, y, view.length, Math.max(0.1, reach))
      .fill({ color: 0x020b16, alpha: 0.16 + evaluation.shadow.coverage * 0.34 });

    // Drifting transverse ribs make the along-crevasse component visible.
    if (reach > 5) {
      const phase = ((evaluation.shadow.localX % 54) + 54) % 54 - 54;
      const y0 = dir > 0 ? -W / 2 + 2 : W / 2 - 2;
      const y1 = dir > 0 ? -W / 2 + reach - 2 : W / 2 - reach + 2;
      for (let x = phase + 54; x < view.length; x += 54) {
        g.moveTo(x, y0)
          .lineTo(x + 9, y1)
          .stroke({ color: 0x9ed3e8, width: 1.4, alpha: 0.11 });
      }

      // Soft deep-shadow cores translate with both components of q. They make
      // the slope-controlled drift legible even when the ribbon is very long.
      const coreY = Math.max(
        -W / 2 + 5,
        Math.min(W / 2 - 5, evaluation.shadow.localCross * WIDTH_SCALE * 0.42),
      );
      const coreXShift = Math.max(-34, Math.min(34, evaluation.shadow.localX * 0.42));
      for (let x = 70; x < view.length - 35; x += 165) {
        const coreX = Math.max(28, Math.min(view.length - 28, x + coreXShift));
        g.ellipse(coreX, coreY, 31, Math.max(3.5, Math.min(8, W * 0.16)))
          .fill({ color: 0x010812, alpha: 0.24 });
      }
    }
  }

  function drawBridgeState(view, bridgeView, evaluation, sun) {
    const W = view.visualW;
    const len = bridgeView.bridge.to - bridgeView.bridge.from;
    const g = bridgeView.shade;
    g.clear();

    if (!evaluation.deckIlluminated) {
      g.roundRect(bridgeView.bridge.from, -W / 2, len, W, 6)
        .fill({ color: 0x0b2740, alpha: 0.46 });
    } else {
      g.roundRect(bridgeView.bridge.from, -W / 2, len, W, 6)
        .fill({ color: 0xffefb0, alpha: 0.08 + evaluation.illumination * 0.08 });
    }

    const reach = evaluation.shadow.coverage * W;
    const sunNormal = sun.x * view.frame.normal.x + sun.y * view.frame.normal.y;
    const dir = shadowDirection(evaluation, sunNormal);

    if (evaluation.shadow.coversFullWidth) {
      g.roundRect(bridgeView.bridge.from, -W / 2, len, W, 6)
        .fill({ color: 0x020d1a, alpha: 0.58 });
    } else if (reach > 0.5) {
      const y = dir > 0 ? -W / 2 : W / 2 - reach;
      g.rect(bridgeView.bridge.from + 1.5, y, len - 3, reach)
        .fill({ color: 0x020d1a, alpha: 0.2 + evaluation.shadow.coverage * 0.42 });
      // Soft front edge.
      const edgeY = dir > 0 ? -W / 2 + reach : W / 2 - reach;
      g.rect(bridgeView.bridge.from + 2, edgeY - 2, len - 4, 3.5)
        .fill({ color: 0x020d1a, alpha: 0.18 });
    }

    bridgeView.statusOutline.clear();
    bridgeView.statusOutline
      .roundRect(bridgeView.bridge.from - 2, -W / 2 - 2, len + 4, W + 4, 7)
      .stroke({
        color: evaluation.passable ? COLORS.pass : COLORS.block,
        width: 3,
        alpha: selectedId === bridgeView.bridge.id ? 0.35 : 0.9,
      });
  }

  function update(state) {
    const sun = sunVector({
      azimuth: state.azimuth,
      elevation: state.elevation,
    });
    const slope = { ...SLOPE, angleDeg: state.slopeAngle ?? SLOPE.angleDeg };
    const sm = slopeModel(slope);
    const light = clamp01(
      sun.x * sm.normal.x + sun.y * sm.normal.y + sun.z * sm.normal.z,
    );

    terrainShade.clear()
      .rect(-700, -700, 3000, 2500)
      .fill({ color: 0x0b314d, alpha: 0.2 * (1 - light) });
    terrainWarm.clear()
      .rect(-700, -700, 3000, 2500)
      .fill({ color: 0xffe4a0, alpha: 0.035 + 0.09 * light });

    for (const view of crevasseViews.values()) {
      drawFaces(view, sun);
      const shadowEval = evaluateBridge(
        { thickness: 0 },
        view.crevasse,
        sun,
        slope,
      );
      drawOpenShadow(view, shadowEval, sun);

      for (const bv of view.bridgeViews.values()) {
        const evaluation = evaluateBridge(
          bv.bridge,
          view.crevasse,
          sun,
          slope,
        );
        drawBridgeState(view, bv, evaluation, sun);
        const mv = markerViews.get(bv.bridge.id);
        if (mv) {
          mv.dot.clear();
          mv.dot
            .circle(0, 0, 15)
            .fill(evaluation.passable ? COLORS.pass : COLORS.block)
            .stroke({ color: 0xffffff, width: 5 });
        }
      }
    }
  }

  function resetView() {
    viewport.fit(true, WORLD.width + 180, WORLD.height + 130);
  }

  function zoomIn() {
    viewport.zoomPercent(0.24, true);
  }

  function zoomOut() {
    viewport.zoomPercent(-0.2, true);
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    app.renderer.resize(width, height);
    viewport.resize(width, height);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resetView();

  return {
    update,
    select: selectBridge,
    focusBridge,
    resetView,
    zoomIn,
    zoomOut,
    destroy() {
      resizeObserver.disconnect();
      app.destroy(true, { children: true });
    },
  };
}
