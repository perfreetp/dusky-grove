/* ice-crevasse-pulleys — main.js
 *
 * The PixiJS scene: the crevasse, the rope, the sheaves, the stranded climber,
 * the rescue team, and every interaction. Numbers come from physics.js
 * (forces, heat, stall) and riggeom.js (rope path, wrap angles, geometric
 * ratio); this file draws and wires events only.
 *
 * Drawing goes through a small adapter so the same scene runs on PixiJS v7
 * (UMD), PixiJS v8 (ESM) or the bundled Canvas-2D fallback in shim.js.
 */
(function () {
  'use strict';

  var P = window.IcePhys;
  var GG = window.IceGeo;
  if (!P || !GG) { console.error('physics/geometry failed to load'); return; }
  var GEO = GG.GEO;
  var TUNE = P.TUNE;

  // ---------------------------------------------------------------- palette
  var C = {
    rope: 0xf2e6c8,
    ropeDark: 0x8c7c5f,
    metal: 0xa9bccb,
    metalDark: 0x36454f,
    cyan: 0x7fd8e8,
    cyanDim: 0x2f6b7a,
    amber: 0xffbd6a,
    hot: 0xff6a3d,
    ink: 0xdfeef8,
  };

  var app = null;
  var layers = {};
  var scene = {};
  var usingShim = false;
  var PXV = 7;

  // ------------------------------------------------------------------ state
  var S = {
    rig: 'double',
    mass: 70,
    vCmd: 0.6,
    pulling: false,
    auto: false,
    lift: 0.16,
    lip: { x: GEO.lipHome.x, y: GEO.lipHome.y },
    lipVel: { x: 0, y: 0 },
    moverOff: { x: GEO.moverHome.x, y: GEO.moverHome.y },
    sway: 0,
    swayVel: 0,
    swing: 0,
    ropeSpin: 0,
    reel: 0,
    phys: null,
    metrics: null,
    view: null,
    tick: 0,
    drag: null,
    records: {},
    stalledAt: null,
    autoStallAt: null,
    hurt: 0,
    toastTimer: 0,
    hintFaded: false,
    ready: false,
  };

  // ------------------------------------------------------------------ utils
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(c1, c2, t) {
    var r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
    var r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
    return (Math.round(lerp(r1, r2, t)) << 16) | (Math.round(lerp(g1, g2, t)) << 8) | Math.round(lerp(b1, b2, t));
  }

  // ============================================================ draw adapter
  function Gfx(parent) {
    this.raw = new PIXI.Graphics();
    parent.addChild(this.raw);
    this._p = [];
    this._cur = [0, 0];
  }
  /* Accepts points as [x, y] pairs or {x, y} objects; stores them as pairs. */
  function pairs(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var q = pts[i];
      out.push(q && typeof q === 'object' && !(q instanceof Array) ? [q.x, q.y] : [q[0], q[1]]);
    }
    return out;
  }
  Gfx.prototype._push = function (pts) {
    var p = pairs(pts);
    this._p.push(p);
    this._cur = p[p.length - 1] || this._cur;
    return this;
  };
  Gfx.prototype.moveTo = function (x, y) {
    this._p.push([[x, y]]);
    this._cur = [x, y];
    return this;
  };
  Gfx.prototype.lineTo = function (x, y) {
    if (!this._p.length) return this.moveTo(x, y);
    this._p[this._p.length - 1].push([x, y]);
    this._cur = [x, y];
    return this;
  };
  Gfx.prototype.polyline = function (pts) { return this._push(pts); };
  /* Appends a vertex to the subpath being built, so a closed region can be
   * assembled from several runs of points. */
  Gfx.prototype.point = function (x, y) {
    if (!this._p.length) this._p.push([]);
    this._p[this._p.length - 1].push([x, y]);
    this._cur = [x, y];
    return this;
  };
  Gfx.prototype.vertices = function (pts) {
    for (var i = 0; i < pts.length; i++) {
      var q = pts[i];
      this.point(q instanceof Array ? q[0] : q.x, q instanceof Array ? q[1] : q.y);
    }
    return this;
  };
  Gfx.prototype.quadraticCurveTo = function (cx, cy, x, y) {
    var p0 = this._cur;
    this.moveTo(p0[0], p0[1]);
    for (var i = 1; i <= 10; i++) {
      var t = i / 10, mt = 1 - t;
      this.lineTo(mt * mt * p0[0] + 2 * mt * t * cx + t * t * x,
        mt * mt * p0[1] + 2 * mt * t * cy + t * t * y);
    }
    return this;
  };
  Gfx.prototype.circle = function (cx, cy, r) {
    var pts = [];
    var n = Math.max(16, Math.min(56, Math.ceil(r * 1.5)));
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return this._push(pts);
  };
  Gfx.prototype.ellipse = function (cx, cy, rx, ry) {
    var pts = [];
    for (var i = 0; i <= 36; i++) {
      var a = (i / 36) * Math.PI * 2;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return this._push(pts);
  };
  Gfx.prototype.arc = function (cx, cy, r, a0, a1) {
    var n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 0.1));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return this._push(pts);
  };
  Gfx.prototype.rect = function (x, y, w, h) {
    return this._push([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
  };
  Gfx.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
    if (!r) return this.rect(x, y, w, h);
    var pts = [];
    function corner(cx, cy, a0) {
      for (var i = 0; i <= 5; i++) {
        var a = a0 + (i / 5) * (Math.PI / 2);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    }
    corner(x + w - r, y + r, -Math.PI / 2);
    corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2);
    corner(x + r, y + r, Math.PI);
    pts.push(pts[0]);
    return this._push(pts);
  };
  Gfx.prototype.closePath = function () {
    var p = this._p[this._p.length - 1];
    if (p && p.length > 1) p.push([p[0][0], p[0][1]]);
    return this;
  };
  Gfx.prototype.fill = function (opt) {
    opt = opt || {};
    var color = opt.color != null ? opt.color : 0;
    var alpha = opt.alpha != null ? opt.alpha : 1;
    var g = this.raw;
    var i, k, pts;
    if (usingShim) {
      for (i = 0; i < this._p.length; i++) {
        pts = this._p[i];
        if (pts.length < 3) continue;
        g.moveTo(pts[0][0], pts[0][1]);
        for (k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
        g.fill({ color: color, alpha: alpha });
      }
    } else if (PXV >= 8) {
      for (i = 0; i < this._p.length; i++) {
        pts = this._p[i];
        if (pts.length < 3) continue;
        var fl = [];
        for (k = 0; k < pts.length; k++) { fl.push(pts[k][0], pts[k][1]); }
        g.poly(fl).fill({ color: color, alpha: alpha });
      }
    } else {
      for (i = 0; i < this._p.length; i++) {
        pts = this._p[i];
        if (pts.length < 3) continue;
        var f2 = [];
        for (k = 0; k < pts.length; k++) { f2.push(pts[k][0], pts[k][1]); }
        g.beginFill(color, alpha);
        g.drawPolygon(f2);
        g.endFill();
      }
    }
    this._p = [];
    return this;
  };
  Gfx.prototype.stroke = function (opt) {
    opt = opt || {};
    var color = opt.color != null ? opt.color : 0;
    var alpha = opt.alpha != null ? opt.alpha : 1;
    var width = opt.width || 1;
    var g = this.raw;
    var i, k, pts;
    if (usingShim) {
      for (i = 0; i < this._p.length; i++) {
        pts = this._p[i];
        if (pts.length < 2) continue;
        g.moveTo(pts[0][0], pts[0][1]);
        for (k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
        g.stroke({ width: width, color: color, alpha: alpha, cap: opt.cap || 'round', join: 'round' });
      }
    } else if (PXV >= 8) {
      for (i = 0; i < this._p.length; i++) {
        pts = this._p[i];
        if (pts.length < 2) continue;
        var fl = [];
        for (k = 0; k < pts.length; k++) { fl.push(pts[k][0], pts[k][1]); }
        g.poly(fl).stroke({ width: width, color: color, alpha: alpha, cap: opt.cap || 'round', join: 'round' });
      }
    } else {
      g.lineStyle({ width: width, color: color, alpha: alpha, cap: opt.cap || 'round', join: 'round' });
      for (i = 0; i < this._p.length; i++) {
        pts = this._p[i];
        if (pts.length < 2) continue;
        g.moveTo(pts[0][0], pts[0][1]);
        for (k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
      }
    }
    this._p = [];
    return this;
  };
  Gfx.prototype.clear = function () { this.raw.clear(); this._p = []; this._cur = [0, 0]; return this; };
  Gfx.prototype.pos = function (x, y) { this.raw.position.set(x, y); return this; };
  Object.defineProperty(Gfx.prototype, 'alpha', {
    get: function () { return this.raw.alpha; },
    set: function (v) { this.raw.alpha = v; },
  });
  Object.defineProperty(Gfx.prototype, 'visible', {
    get: function () { return this.raw.visible; },
    set: function (v) { this.raw.visible = v; },
  });
  function gfx(parent) { return new Gfx(parent); }

  function label(parent, str, size, fill, weight) {
    var t = new PIXI.Text(str, {
      fontFamily: '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",system-ui,sans-serif',
      fontSize: size || 12,
      fill: fill == null ? C.ink : fill,
      fontWeight: weight || '500',
      align: 'center',
    });
    if (t.anchor && t.anchor.set) t.anchor.set(0.5, 0.5);
    parent.addChild(t);
    return t;
  }

  // ------------------------------------------------------------------- view
  var VIEW = { scale: 1, ox: 0, oy: 0 };
  var BG_REF_MOUTH = 424;   // world-y of the crevasse mouth (see buildBackground)
  function stageSize() {
    var el2 = document.getElementById('stage');
    var vw = el2 && el2.clientWidth ? el2.clientWidth : window.innerWidth;
    var vh = el2 && el2.clientHeight ? el2.clientHeight : window.innerHeight;
    return { w: vw, h: vh };
  }
  function layout() {
    var sz = stageSize();
    var vw = sz.w, vh = sz.h;
    var wide = vw / vh > 1.25;
    var scale, ox, oy;
    if (wide) {
      // cover the viewport; the world is 1600x1000, so on very tall screens the
      // scene is cropped at the sides rather than leaving a band underneath
      scale = Math.max(vw / GEO.W, vh / GEO.H);
      ox = (vw - GEO.W * scale) / 2;
      oy = (vh - GEO.H * scale) / 2;
      // aim the mouth at ~46% of the height
      oy = vh * 0.46 - (BG_REF_MOUTH) * scale;
      oy = Math.min(oy, 40);
      oy = Math.max(oy, vh - (GEO.H + 60) * scale);
    } else {
      // portrait: fill the band, centred on the crevasse, cropping the sides
      var focusX = GEO.crev.cx;
      scale = Math.max(vw / 760, vh / 1040);
      ox = vw / 2 - focusX * scale;
      oy = vh / 2 - 620 * scale;
    }
    VIEW.scale = scale; VIEW.ox = ox; VIEW.oy = oy;
    layers.world.scale.set(scale);
    layers.world.position.set(ox, oy);
  }
  function toWorld(clientX, clientY) {
    var r = app.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - VIEW.ox) / VIEW.scale,
      y: (clientY - r.top - VIEW.oy) / VIEW.scale,
    };
  }

  // ============================================================ background
  /* Section through the glacier, in the order the eye reads it:
   *   sky and peaks, then the ice body, the snow pack laid over it, and finally
   *   the crevasse cut through both, with its walls, cornices and depth.
   * Every outline is a smooth function of x or y, so nothing stair-steps. */
  var BG = {
    snowLine: 424,        // top of the snow at the rim
    rimHalf: 162,         // half-width of the crevasse at the top
    snowPack: 30,         // snow thickness beside the rim
  };

  function surfY(x) {
    return BG.snowLine + Math.sin(x * 0.0031 + 0.5) * 4.5
      + Math.sin(x * 0.0091 + 2.1) * 2 + Math.sin(x * 0.02 + 1) * 0.7;
  }
  function packDepth(x) {
    var d = Math.min(1, Math.abs(x - GEO.crev.cx) / 500);
    return BG.snowPack * (0.7 + 0.3 * Math.pow(d, 1.2));
  }
  function iceTop(x) { return surfY(x) + packDepth(x); }
  function slotHalf(y) {
    var t = clamp((y - BG.snowLine) / 820, 0, 2.4);
    var base = BG.rimHalf - 54 * Math.pow(Math.min(t, 1), 0.62) - 10 * Math.max(0, t - 1);
    // the lip overhangs: widest at the surface, pinching in over the first
    // ~40 px, which is what a snow cornice does over a crack
    var d = Math.max(0, y - BG.snowLine);
    var over = 30 * Math.pow(Math.max(0, 1 - d / 74), 2);
    return base + over;
  }
  function faceWidth(y) {
    var t = clamp((y - BG.snowLine) / 820, 0, 2.4);
    return 34 * (1 - 0.5 * Math.min(t, 1)) + 6;
  }

  function buildBackground() {
    var bg = layers.bg;
    var cx = GEO.crev.cx;
    var W0 = -160, W1 = GEO.W + 160;
    var H = GEO.H;
    var sy = BG.snowLine;
    var halfTop = slotHalf(sy);

    // ------------------------------------------------ sky
    var sky = gfx(bg);
    for (var i = 0; i <= 22; i++) {
      var t = i / 22;
      var col = mix(0x040b14, 0x10283b, Math.pow(t, 1.35));
      if (t > 0.84) col = mix(col, 0x2a5267, (t - 0.84) / 0.16);
      sky.rect(W0, t * 440 - 2, W1 - W0, 440 / 22 + 3).fill({ color: col });
    }
    var halo = gfx(bg);
    halo.ellipse(cx, 372, 940, 140).fill({ color: 0x3b7e96, alpha: 0.09 });

    // ------------------------------------------------ far peaks
    function ridge(pts, fill, alpha) {
      var r = gfx(bg);
      r.polyline(pts);
      r.lineTo(W1, 700).lineTo(W0, 700).closePath().fill({ color: fill, alpha: alpha == null ? 1 : alpha });
    }
    ridge([[W0, 326], [90, 262], [180, 310], [270, 238], [360, 316], [450, 256], [530, 324],
      [620, 262], [710, 328], [810, 246], [900, 318], [990, 258], [1080, 326], [1170, 242],
      [1260, 312], [1350, 254], [1450, 318], [1550, 260], [W1, 330]], 0x132738);
    var capsG = gfx(bg);
    [[270, 238, 100], [710, 262, 88], [1170, 242, 96], [1550, 260, 86]].forEach(function (q) {
      var px = q[0], py = q[1], w = q[2];
      capsG.moveTo(px - w * 0.30, py + 30).lineTo(px - w * 0.10, py + 11).lineTo(px, py)
        .lineTo(px + w * 0.11, py + 15).lineTo(px + w * 0.31, py + 32)
        .lineTo(px + w * 0.10, py + 22).lineTo(px, py + 36).lineTo(px - w * 0.12, py + 21)
        .closePath().fill({ color: 0x2b4a61, alpha: 0.9 });
    });
    ridge([[W0, 384], [120, 348], [260, 376], [390, 346], [510, 382], [630, 352],
      [760, 384], [890, 348], [1020, 382], [1150, 350], [1280, 380], [1420, 346], [1550, 374], [W1, 352]],
      0x1e3548, 0.97);

    // ------------------------------------------------ ice body, in section
    function iceBand(depth, color, alpha) {
      var g = gfx(bg);
      var pts = [];
      for (var x = W0; x <= W1; x += 20) pts.push([x, iceTop(x) + depth]);
      g.vertices(pts);
      g.point(W1, H + 100);
      g.point(W0, H + 100);
      g.closePath().fill({ color: color, alpha: alpha });
    }
    // a smooth ramp, sampled finely so no band edges are visible
    for (var ib = 0; ib <= 40; ib++) {
      var ibt = ib / 40;
      var ibc = mix(0x33596e, 0x081520, Math.pow(ibt, 0.78));
      iceBand(ibt * 640, ibc, 1);
    }
    // layering: strata + faint fractures
    // fine layers, only where the eye can actually resolve them
    var strata = gfx(bg);
    for (var si = 0; si < 26; si++) {
      var ly = iceTop(cx) + 16 + si * 40;
      if (ly > H + 40) break;
      var la = Math.max(0.012, 0.075 - si * 0.0035);
      strata.moveTo(W0, ly).quadraticCurveTo(cx, ly + 11, W1, ly - 3)
        .stroke({ width: 1.4 + (si % 2) * 0.8, color: 0x9ccbe3, alpha: la });
    }
    var fractures = gfx(bg);
    for (var fi = 0; fi < 22; fi++) {
      var fx = W0 + ((fi * 131 + 40) % (W1 - W0));
      if (Math.abs(fx - cx) < halfTop + 70) continue;
      fractures.moveTo(fx, iceTop(fx)).lineTo(fx + 6 + (fi % 3) * 4, H + 40)
        .stroke({ width: 1.2, color: 0xd2ebf9, alpha: 0.055 });
    }

    // ------------------------------------------------ snow pack
    var topPts = [], botPts = [];
    for (var x2 = W0; x2 <= W1; x2 += 16) {
      topPts.push([x2, surfY(x2)]);
      botPts.push([x2, iceTop(x2)]);
    }
    var pack = gfx(bg);
    pack.vertices(topPts);
    for (var bi = botPts.length - 1; bi >= 0; bi--) pack.point(botPts[bi][0], botPts[bi][1]);
    pack.closePath().fill({ color: 0xffffff });
    // a single wind-scoured drift line low in the pack, nothing else
    var driftLine = gfx(bg);
    driftLine.polyline(topPts.map(function (q) { return [q[0], q[1] + packDepth(q[0]) * 0.72]; }))
      .stroke({ width: 1.4, color: 0xd7e9f7, alpha: 0.45 });
    var underPack = gfx(bg);
    underPack.polyline(botPts).stroke({ width: 7, color: 0x16374c, alpha: 0.34 });
    var packContact = gfx(bg);
    packContact.polyline(botPts).stroke({ width: 1.6, color: 0xf2fbff, alpha: 0.55 });
    // sastrugi
    var sastru = gfx(bg);
    for (var sg = 0; sg < 34; sg++) {
      var sgx = W0 + ((sg * 179 + 60) % (W1 - W0));
      if (Math.abs(sgx - cx) < halfTop + 50) continue;
      var sgy = surfY(sgx) + 3.5 + (sg % 4) * 4;
      var sgw = 18 + (sg % 4) * 18;
      sastru.moveTo(sgx - sgw, sgy).quadraticCurveTo(sgx, sgy - 3.4, sgx + sgw, sgy - 1)
        .stroke({ width: 1.1, color: 0xffffff, alpha: 0.32 });
    }

    // ------------------------------------------------ the crevasse
    /* One solid silhouette for the opening, then a narrow band of ice face
     * along each edge shaded with a continuous colour ramp. No translucent
     * overlaps, no visible steps. */
    var edgeL = [], edgeR = [];
    for (var k = 0; k <= 60; k++) {
      var yk = sy - 8 + ((H + 90 - sy) * k) / 60;
      edgeL.push([cx - slotHalf(yk), yk]);
      edgeR.push([cx + slotHalf(yk), yk]);
    }
    var slot = gfx(bg);
    slot.vertices(edgeL);
    for (var ri = edgeR.length - 1; ri >= 0; ri--) slot.point(edgeR[ri][0], edgeR[ri][1]);
    slot.closePath().fill({ color: 0x050d16 });

    // the opening gets darker with depth in a few continuous steps
    for (var dz = 0; dz < 18; dz++) {
      var dt0 = sy + dz * 44;
      var dt1 = dt0 + 46;
      if (dt0 > H + 40) break;
      var dg = gfx(bg);
      dg.moveTo(cx - slotHalf(dt0), dt0).lineTo(cx + slotHalf(dt0), dt0)
        .lineTo(cx + slotHalf(dt1), dt1).lineTo(cx - slotHalf(dt1), dt1)
        .closePath().fill({ color: 0x010609, alpha: 0.10 + dz * 0.05 });
    }

    // ice face along each edge: slices share a colour ramp, so they merge
    [-1, 1].forEach(function (side) {
      var lit = side < 0;
      var n = 64;
      for (var i = 0; i < n; i++) {
        var y0 = sy - 6 + ((H + 90 - sy) * i) / n;
        var y1 = sy - 6 + ((H + 90 - sy) * (i + 1)) / n + 1.2;
        var f = i / n;
        var c = lit
          ? mix(0x7fb4cb, 0x0c2836, Math.pow(f, 0.55))
          : mix(0x4c7e95, 0x081b26, Math.pow(f, 0.5));
        var g2 = gfx(bg);
        g2.moveTo(cx + side * slotHalf(y0), y0)
          .lineTo(cx + side * (slotHalf(y0) + faceWidth(y0)), y0)
          .lineTo(cx + side * (slotHalf(y1) + faceWidth(y1)), y1)
          .lineTo(cx + side * slotHalf(y1), y1).closePath()
          .fill({ color: c, alpha: 1 });
      }
      // strata scored into the face
      var fs = gfx(bg);
      for (var f2 = 0; f2 < 12; f2++) {
        var fy = sy + 26 + f2 * 52;
        if (fy > H + 20) break;
        var wf = faceWidth(fy);
        fs.moveTo(cx + side * slotHalf(fy), fy)
          .lineTo(cx + side * (slotHalf(fy) + wf * 0.85), fy + 5)
          .stroke({ width: 1.6, color: lit ? 0xd8f1ff : 0xa9d6ea, alpha: Math.max(0.02, 0.15 - f2 * 0.011) });
      }
      // the pale rim where the ice breaks into the opening
      var knife = gfx(bg);
      for (var kk = 0; kk < 16; kk++) {
        var ky = sy + kk * 24;
        knife.moveTo(cx + side * (slotHalf(ky) + 0.5), ky)
          .lineTo(cx + side * (slotHalf(ky) + 1.8), ky + 1.6)
          .stroke({ width: 2, color: 0xe6f7ff, alpha: Math.max(0, (lit ? 0.45 : 0.3) - kk * 0.028) });
      }
    });

    // ------------------------------------------------ the rim
    // the overhang casts a shadow straight down the face
    [-1, 1].forEach(function (side) {
      var cast = gfx(bg);
      cast.moveTo(cx + side * (slotHalf(sy + 4) - 1), sy + 4)
        .lineTo(cx + side * slotHalf(sy + 88), sy + 88)
        .lineTo(cx + side * (slotHalf(sy + 88) - 18), sy + 88)
        .lineTo(cx + side * (slotHalf(sy + 4) - 18), sy + 4)
        .closePath().fill({ color: 0x030b12, alpha: 0.45 });
    });
    var rimLine = gfx(bg);
    rimLine.moveTo(cx - halfTop - 66, sy - 5).lineTo(cx - halfTop - 2, sy - 3)
      .stroke({ width: 3, color: 0xffffff, alpha: 0.85 });
    rimLine.moveTo(cx + halfTop + 66, sy - 5).lineTo(cx + halfTop + 2, sy - 3)
      .stroke({ width: 3, color: 0xffffff, alpha: 0.78 });
    var puff = gfx(bg);
    [[cx - halfTop - 20, sy - 5, 14, 4.4], [cx - halfTop + 8, sy + 3, 9, 3],
      [cx + halfTop + 20, sy - 5, 12, 4], [cx + halfTop - 8, sy + 3, 8, 2.7]].forEach(function (q) {
      puff.ellipse(q[0], q[1], q[2], q[3]).fill({ color: 0xffffff, alpha: 0.6 });
    });

    // ------------------------------------------------ markers, drifting snow
    var flags = gfx(bg);
    [[180, sy - 36, 0xcf5a3d], [330, sy - 32, 0x3f7f96], [1350, sy - 34, 0xcf5a3d], [1230, sy - 30, 0x3f7f96]].forEach(function (f) {
      flags.moveTo(f[0], f[1] + 28).lineTo(f[0], f[1]).stroke({ width: 1.6, color: 0x6d8496, alpha: 0.85 });
      flags.moveTo(f[0], f[1]).lineTo(f[0] + 10, f[1] + 5).lineTo(f[0], f[1] + 10)
        .closePath().fill({ color: f[2], alpha: 0.85 });
    });
    var dust = gfx(bg);
    for (var dd = 0; dd < 32; dd++) {
      var dx = W0 + ((dd * 293 + 90) % (W1 - W0));
      var dy = 80 + ((dd * 157) % 280);
      dust.circle(dx, dy, 0.6 + (dd % 3) * 0.4).fill({ color: 0xdff0fb, alpha: 0.07 + (dd % 4) * 0.028 });
    }
  }

  // ============================================================ scene parts
  function buildScene() {
    scene.ropeShadow = gfx(layers.mid);
    scene.ropeGlow = gfx(layers.mid);
    scene.ropeMain = gfx(layers.mid);
    scene.ropeTicks = gfx(layers.mid);

    scene.floorShadow = gfx(layers.mid);
    scene.sling = gfx(layers.mid);
    scene.block = new PIXI.Container();
    layers.mid.addChild(scene.block);
    scene.person = gfx(scene.block);
    drawPerson(scene.person);

    scene.rig = new PIXI.Container();
    layers.mid.addChild(scene.rig);
    scene.parts = {};
    ['lip', 'lip2', 'mover', 'hitch', 'anchor'].forEach(function (id) {
      var holder = new PIXI.Container();
      scene.rig.addChild(holder);
      scene.parts[id] = { holder: holder, halo: gfx(holder), body: gfx(holder), id: id };
    });

    // rigging that supports the lip block (sling to two ice screws)
    scene.rigging = gfx(layers.mid);

    scene.team = new PIXI.Container();
    layers.mid.addChild(scene.team);
    scene.teamBody = gfx(scene.team);

    scene.ratio = gfx(layers.top);
    scene.ratioLabels = {
      rope: label(layers.top, '', 11, C.rope),
      load: label(layers.top, '', 11, 0x77e2c3),
      note: label(layers.top, '', 10.5, 0x8fb6cb),
    };
    scene.ratioLabels.rope.anchor.set(0, 0.5);
    scene.ratioLabels.load.anchor.set(0, 0.5);
    scene.ratioLabels.note.anchor.set(0, 0.5);
    scene.heatFx = gfx(layers.top);

    scene.labels = new PIXI.Container();
    layers.top.addChild(scene.labels);
    scene.labelPool = {};

    scene.hint = new PIXI.Container();
    layers.top.addChild(scene.hint);
    var hb = gfx(scene.hint);
    hb.roundRect(-58, -15, 116, 30, 10)
      .fill({ color: 0x06131f, alpha: 0.86 })
      .stroke({ width: 1, color: 0x9fdfec, alpha: 0.6 });
    label(scene.hint, '拖动滑轮', 12.5, 0xcdeff7);
    var ar = gfx(scene.hint);
    ar.circle(0, 22, 1.9).fill({ color: 0x9fdfec, alpha: 0.6 });
    ar.circle(0, 28, 1.4).fill({ color: 0x9fdfec, alpha: 0.35 });
    scene.hint.alpha = 0;
  }

  function drawPerson(g) {
    // legs
    g.roundRect(-19, 14, 16, 38, 8).fill({ color: 0x37424e });
    g.roundRect(5, 16, 16, 36, 8).fill({ color: 0x414c58 });
    g.roundRect(-23, 48, 21, 13, 4).fill({ color: 0x161d24 });
    g.roundRect(4, 50, 21, 13, 4).fill({ color: 0x161d24 });
    g.roundRect(-23, 58, 21, 4, 2).fill({ color: 0x5e6b77 });
    g.roundRect(4, 60, 21, 4, 2).fill({ color: 0x5e6b77 });
    // jacket
    g.roundRect(-25, -50, 50, 70, 16).fill({ color: 0xc8502c });
    g.roundRect(-25, -50, 50, 70, 16).stroke({ width: 2.6, color: 0x32120a, alpha: 0.5 });
    g.moveTo(-25, -26).lineTo(25, -26).stroke({ width: 1.6, color: 0x9c3919, alpha: 0.45 });
    g.moveTo(-25, -4).lineTo(25, -4).stroke({ width: 1.6, color: 0x9c3919, alpha: 0.45 });
    g.roundRect(-21, -46, 16, 36, 8).fill({ color: 0xe1704a, alpha: 0.45 });
    // pack
    g.roundRect(-40, -42, 18, 48, 7).fill({ color: 0x2a3640 });
    g.roundRect(-40, -42, 18, 13, 6).fill({ color: 0x394754 });
    // arms
    g.moveTo(-21, -44).lineTo(-31, -72).stroke({ width: 11, color: 0xb2471f });
    g.moveTo(21, -44).lineTo(31, -72).stroke({ width: 11, color: 0xb2471f });
    g.circle(-31, -74, 6).fill({ color: 0x31667a });
    g.circle(31, -74, 6).fill({ color: 0x31667a });
    // helmet
    g.circle(0, -66, 16).fill({ color: 0xe4b03c });
    g.arc(0, -66, 16, Math.PI * 1.02, Math.PI * 1.98).stroke({ width: 3.4, color: 0x89620f, alpha: 0.85 });
    g.roundRect(-17, -70, 34, 6, 3).fill({ color: 0x201811, alpha: 0.9 });
    g.circle(0, -74, 2.6).fill({ color: 0xfff4d2 });
    // harness
    g.roundRect(-26, -8, 52, 9, 4).fill({ color: 0x1c232a });
    g.moveTo(-15, 2).lineTo(-12, 15).stroke({ width: 6, color: 0x1c232a });
    g.moveTo(15, 2).lineTo(12, 17).stroke({ width: 6, color: 0x1c232a });
    // attachment ring (the pivot)
    g.circle(0, -48, 7.4).stroke({ width: 3.4, color: 0xc9d9e6 });
    g.circle(0, -48, 3.2).stroke({ width: 1.6, color: 0x8ba2b5, alpha: 0.9 });
    g.moveTo(0, -48).lineTo(0, -14).stroke({ width: 2.4, color: 0xa3b6c6, alpha: 0.85 });
  }
  var RING_Y = -48;

  /* --- sheave ---------------------------------------------------------- */
  function drawSheave(part, r, hot, tension, dir, mark) {
    var halo = part.halo, body = part.body;
    halo.clear(); body.clear();
    var heatCol = hot >= TUNE.HEAT_THRESHOLD ? C.hot : (hot > 0.2 ? C.amber : C.cyan);
    if (hot > 0.1) {
      var pulse = 0.55 + 0.45 * Math.sin(S.tick * 5 + r);
      halo.circle(0, 0, r + 11 + 7 * P.smoothstep(hot, 0.35, 2.0))
        .fill({ color: heatCol, alpha: 0.04 + 0.12 * Math.min(2, hot) * pulse });
    }
    body.circle(0, 0, r + 5.5).fill({ color: 0x33424f });
    body.circle(0, 0, r + 5.5).stroke({ width: 1.4, color: 0x151f27, alpha: 0.9 });
    body.circle(0, 0, r + 1.4).stroke({ width: 3.6, color: 0x1e2b35, alpha: 0.95 });
    body.circle(0, 0, r).fill({ color: 0x879baa });
    body.circle(0, 0, r - 3.6).fill({ color: 0xb2c3d1 });
    body.circle(0, 0, r - 3.6).stroke({ width: 1, color: 0x768a99, alpha: 0.65 });
    var spin = S.ropeSpin * dir;
    for (var s = 0; s < 5; s++) {
      var a = spin + (s * Math.PI * 2) / 5;
      body.moveTo(Math.cos(a) * 4.4, Math.sin(a) * 4.4)
        .lineTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6))
        .stroke({ width: 2.6, color: 0x6b8092, alpha: 0.9 });
    }
    body.circle(0, 0, 5.4).fill({ color: 0x25323c });
    body.circle(0, 0, 2.2).fill({ color: 0xc8d7e3 });
    if (hot > 0.14) {
      body.circle(0, 0, r + 2.6).stroke({
        width: 2.8, color: heatCol, alpha: 0.26 + 0.62 * P.smoothstep(hot, 0.18, 1.2),
      });
    }
    if (tension) {
      var tq = clamp(tension / 1700, 0, 1);
      body.arc(0, 0, r + 10, -Math.PI * 0.92, -Math.PI * 0.92 + Math.PI * 2 * tq)
        .stroke({ width: 2.4, color: mix(C.cyanDim, C.amber, tq), alpha: 0.62 });
    }
    if (mark) {
      body.circle(0, 0, r + 15).stroke({ width: 1.4, color: C.amber, alpha: 0.55 });
      body.arc(0, 0, r + 15, -2.1, -1.1).stroke({ width: 2.4, color: C.amber, alpha: 0.85 });
    }
  }

  /* --- prusik ---------------------------------------------------------- */
  function drawHitch(part, hot, tension, mark) {
    var halo = part.halo, body = part.body;
    halo.clear(); body.clear();
    var heatCol = hot >= TUNE.HEAT_THRESHOLD ? C.hot : (hot > 0.2 ? C.amber : C.cyan);
    if (hot > 0.1) {
      var pulse = 0.6 + 0.4 * Math.sin(S.tick * 6.2);
      halo.circle(0, 0, 17 + 9 * Math.min(1.6, hot)).fill({ color: heatCol, alpha: 0.05 + 0.14 * Math.min(1.6, hot) * pulse });
    }
    // rope through the knot
    body.moveTo(-26, 1).lineTo(-10, 0).stroke({ width: 2.6, color: C.rope, alpha: 0.9 });
    body.moveTo(10, 0).lineTo(28, -2).stroke({ width: 2.6, color: C.rope, alpha: 0.9 });
    var cord = mix(0x4f9c8b, 0xffa24a, P.smoothstep(hot, 0.25, 1.05));
    for (var i = 0; i < 4; i++) {
      var yy = -8.6 + i * 5.7;
      body.moveTo(-10, yy).quadraticCurveTo(0, yy - 5.8, 10, yy).stroke({ width: 3.4, color: cord, alpha: 0.97 });
    }
    body.roundRect(-11.5, -13.5, 23, 28, 7).stroke({ width: 1.3, color: 0x13201c, alpha: 0.5 });
    if (tension) {
      var tq = clamp(tension / 1700, 0, 1);
      body.arc(0, 0, 17.5, -Math.PI * 0.55, -Math.PI * 0.55 + Math.PI * 2 * tq * 0.85)
        .stroke({ width: 2.4, color: mix(C.cyanDim, C.amber, tq), alpha: 0.58 });
    }
    if (mark) {
      body.circle(0, 0, 22).stroke({ width: 1.4, color: C.amber, alpha: 0.55 });
    }
  }

  /* --- anchor plate ---------------------------------------------------- */
  function drawAnchor(part, x, y, text) {
    part.holder.position.set(x, y);
    part.halo.clear();
    var b = part.body;
    b.clear();
    b.roundRect(-11, -7, 22, 14, 4).fill({ color: 0x4b5e6c });
    b.roundRect(-11, -7, 22, 14, 4).stroke({ width: 1.3, color: 0x131d26, alpha: 0.95 });
    b.circle(0, 0, 3.6).fill({ color: 0xd6e2ec });
    b.circle(0, 0, 1.6).fill({ color: 0x53687a });
    if (text) {
      if (!part.text) part.text = label(part.holder, text, 10, 0x93aec2);
      part.text.position.set(2, -22);
    }
  }

  // ================================================================ rope
  function ropeView() {
    return GG.build(S.rig, { lift: S.lift, sway: S.sway, lip: S.lip, moverOff: S.moverOff });
  }

  function heatAlong(view, m) {
    var curve = view.curve;
    var heat = new Array(curve.length);
    for (var i = 0; i < curve.length; i++) heat[i] = 0;
    if (!m) return heat;
    for (var c = 0; c < view.contacts.length; c++) {
      var ct = view.contacts[c];
      var h = m.heat[c] || 0;
      if (h < 0.02) continue;
      if (ct.kind === 'hitch') {
        var best = 0, bd = 1e9;
        for (var a = 0; a < curve.length; a++) {
          var d = Math.hypot(curve[a].x - ct.x, curve[a].y - ct.y);
          if (d < bd) { bd = d; best = a; }
        }
        for (var s = -3; s <= 3; s++) {
          var q = best + s;
          if (q >= 0 && q < heat.length) heat[q] = Math.max(heat[q], h * (1 - Math.abs(s) / 4.4));
        }
      } else {
        for (var k = 0; k < curve.length; k++) {
          if (Math.hypot(curve[k].x - ct.x, curve[k].y - ct.y) <= ct.r + 3) {
            heat[k] = Math.max(heat[k], h);
          }
        }
      }
    }
    var out = heat.slice();
    for (var r = 1; r <= 6; r++) {
      var w = 1 - r / 7.5;
      for (var j = 0; j < heat.length; j++) {
        if (j - r >= 0) out[j] = Math.max(out[j], heat[j - r] * w);
        if (j + r < heat.length) out[j] = Math.max(out[j], heat[j + r] * w);
      }
    }
    return out;
  }

  var ROPE_STAGES = [
    { t: 0.16, col: C.rope, w: 2.8, glow: 0 },
    { t: 0.5, col: 0xffc273, w: 3.0, glow: 11 },
    { t: 0.95, col: 0xff8f4e, w: 3.3, glow: 16 },
    { t: 99, col: C.hot, w: 3.6, glow: 22 },
  ];
  function stageOf(h) {
    for (var i = 0; i < ROPE_STAGES.length; i++) if (h < ROPE_STAGES[i].t) return i;
    return ROPE_STAGES.length - 1;
  }

  function drawRope(view, m) {
    scene.ropeShadow.clear();
    scene.ropeGlow.clear();
    scene.ropeMain.clear();
    scene.ropeTicks.clear();
    var curve = view.curve;
    if (!curve || curve.length < 2) return;
    var heat = heatAlong(view, m);

    scene.ropeShadow.polyline(curve).stroke({ width: 5.4, color: 0x0a141c, alpha: 0.4 });

    var i = 0;
    while (i < curve.length - 1) {
      var st = stageOf(heat[i]);
      var j = i + 1;
      while (j < curve.length - 1 && stageOf(heat[j]) === st) j++;
      var run = curve.slice(i, Math.min(curve.length, j + 1));
      if (run.length >= 2) {
        var cfg = ROPE_STAGES[st];
        if (cfg.glow) {
          scene.ropeGlow.polyline(run).stroke({ width: cfg.w, color: cfg.col, alpha: 0.1 + 0.02 * st });
          scene.ropeGlow.polyline(run).stroke({ width: cfg.glow, color: cfg.col, alpha: 0.09 + 0.035 * st });
        }
        scene.ropeMain.polyline(run).stroke({ width: cfg.w, color: cfg.col, alpha: 0.97 });
        if (st >= 2) {
          scene.ropeMain.polyline(run).stroke({ width: 1.1, color: 0xffe2d2, alpha: 0.3 + 0.2 * (st - 2) });
        }
      }
      i = Math.max(j, i + 1);
    }

    for (var t = 3; t < curve.length; t += 3) {
      if (heat[t] > 0.22) continue;
      scene.ropeTicks.circle(curve[t].x, curve[t].y, 0.8).fill({ color: 0x8b7a5c, alpha: 0.32 });
    }
  }

  // ================================================================= load
  function drawLoad(view, m) {
    var ring = view.top;  // the harness attachment point
    var swingTarget = (S.sway / 34) * 0.14 + (m && m.stalled ? Math.sin(S.tick * 7) * 0.012 : 0);
    S.swing = lerp(S.swing, swingTarget, 0.1);
    scene.block.pivot.set(0, RING_Y);
    scene.block.position.set(ring.x + S.sway * 0.25, ring.y);
    scene.block.rotation = -S.swing;

    scene.sling.clear();
    var g = scene.sling;
    if (view.mover) {
      g.moveTo(ring.x, ring.y).lineTo(view.mover.x, view.mover.y)
        .stroke({ width: 4.2, color: 0x8fa4b5, alpha: 0.9 });
      g.moveTo(ring.x, ring.y).lineTo(view.mover.x, view.mover.y)
        .stroke({ width: 1.4, color: 0xdbe9f2, alpha: 0.45 });
    } else if (view.tie) {
      g.moveTo(ring.x, ring.y).lineTo(view.tie.x, view.tie.y)
        .stroke({ width: 3.6, color: 0x8fa4b5, alpha: 0.85 });
    }
    g.roundRect(ring.x - 3.2, ring.y - 9, 6.4, 13, 3).stroke({ width: 1.9, color: 0xc2d2de });

    scene.floorShadow.clear();
    var depth = 1 - S.lift;
    scene.floorShadow.ellipse(GEO.crev.cx + S.sway * 0.4, GEO.crev.bottom - 34,
      52 + 34 * depth, 13 + 6 * depth).fill({ color: 0x02070c, alpha: 0.34 + 0.3 * depth });

    if (m && m.stalled) S.hurt = Math.min(1, S.hurt + 0.05);
    else S.hurt = Math.max(0, S.hurt - 0.03);
    if (!scene.strain) scene.strain = gfx(layers.top);
    var sg = scene.strain;
    sg.clear();
    if (S.hurt > 0.02) {
      sg.circle(ring.x, ring.y, 22 + 8 * S.hurt + 3 * Math.sin(S.tick * 6))
        .stroke({ width: 2, color: C.hot, alpha: 0.6 * S.hurt });
    }
  }

  // ================================================================= team
  /* Two rescuers braced on the snow beside the mouth. Their lead glove rides
   * the haul line, and the line leaves the frame along the same direction, so
   * the rope reads as one continuous run. */
  function drawTeam(view, m) {
    var g = scene.teamBody;
    g.clear();
    var hx = GEO.hands.x, hy = GEO.hands.y;
    var pulling = m && m.pulling;
    var rate = m ? clamp(Math.abs(m.vRope) / 0.6, 0, 1) : 0;
    var phase = S.reel * 2.4;

    // snow the team stands on: a trampled patch under their feet
    var ground = surfY(hx + 40) + 4;
    g.ellipse(hx + 84, ground + 2, 108, 12).fill({ color: 0xffffff, alpha: 0.35 });
    g.ellipse(hx + 84, ground + 3, 92, 8).fill({ color: 0xa8c6d8, alpha: 0.28 });

    for (var i = 0; i < 2; i++) {
      var bx = hx + 46 + i * 44;
      var footY = surfY(bx) + 5;
      var by = footY - 92;
      var lean = pulling ? -3 - 4 * rate * Math.sin(phase + i * Math.PI) : -1;

      // legs
      g.moveTo(bx - 8, by + 16).lineTo(bx - 21, footY - 11).stroke({ width: 12, color: 0x17303d });
      g.moveTo(bx + 8, by + 16).lineTo(bx + 23, footY - 11).stroke({ width: 12, color: 0x1b3a49 });
      g.roundRect(bx - 33, footY - 14, 22, 12, 4).fill({ color: 0x101820 });
      g.roundRect(bx + 13, footY - 14, 22, 12, 4).fill({ color: 0x101820 });

      // torso
      g.roundRect(bx - 17 + lean, by - 26, 34, 48, 11).fill({ color: i ? 0x1e4353 : 0x22505f });
      g.roundRect(bx - 17 + lean, by - 26, 34, 48, 11).stroke({ width: 1.6, color: 0x0a1922, alpha: 0.55 });
      g.roundRect(bx - 12 + lean, by - 20, 8, 22, 4).fill({ color: 0x2d6376, alpha: 0.65 });
      // pack
      g.roundRect(bx - 26 + lean, by - 22, 10, 27, 4).fill({ color: 0x152a36 });
      // arm to the glove
      var handX = hx + 6 + i * 5, handY = hy + i * 13;
      g.moveTo(handX, handY).lineTo(bx - 12 + lean, by - 12).stroke({ width: 9.5, color: 0x1b3f4f });
      g.moveTo(handX, handY).lineTo(bx - 12 + lean, by - 12).stroke({ width: 3, color: 0x2c6175, alpha: 0.6 });
      // head + helmet
      g.circle(bx - 2 + lean, by - 34, 8.6).fill({ color: i ? 0x173644 : 0x1a3d4c });
      g.circle(bx - 2 + lean, by - 37, 7.4).fill({ color: i ? 0xd8a638 : 0xdfaf46 });
      g.arc(bx - 2 + lean, by - 37, 7.4, Math.PI * 1.06, Math.PI * 1.94)
        .stroke({ width: 1.8, color: 0x77550f, alpha: 0.65 });
    }

    // gloves on the line
    for (var k = 0; k < 2; k++) {
      var off = pulling ? Math.sin(phase + k * Math.PI) * 10 * rate : 0;
      var gx = hx + 6 + k * 5 - off * 0.4, gy = hy + k * 13 - off;
      g.circle(gx, gy, 8.4).fill({ color: 0x2b5c6e });
      g.circle(gx, gy, 8.4).stroke({ width: 1.8, color: 0x0a1922, alpha: 0.85 });
      g.roundRect(gx - 2.4, gy - 10.5, 4.8, 7, 2.2).fill({ color: 0x3a7689 });
      g.arc(gx, gy, 4.8, -0.7, 1.0).stroke({ width: 1.6, color: 0xb6e6f0, alpha: 0.4 });
    }

    // the haul line leaves the frame along the same direction as the rope run
    var dirX = 1, dirY = -0.12;
    if (view && view.curve && view.curve.length > 3) {
      var a = view.curve[view.curve.length - 1];
      var b = view.curve[view.curve.length - 3];
      var dx = a.x - b.x, dy = a.y - b.y;
      var dl = Math.hypot(dx, dy) || 1;
      dirX = dx / dl; dirY = dy / dl;
    }
    var far = { x: hx + 6 + dirX * 720, y: hy + dirY * 720 };
    g.moveTo(hx + 6, hy).lineTo(far.x, far.y).stroke({ width: 2.9, color: C.rope, alpha: 0.9 });
  }

  // ================================================================= labels
  function getLabel(id) {
    var L = scene.labelPool[id];
    if (!L) {
      var holder = new PIXI.Container();
      var bg = gfx(holder);
      var txt = label(holder, '', 11.5);
      scene.labels.addChild(holder);
      L = scene.labelPool[id] = { holder: holder, bg: bg, txt: txt, w: -1, h: -1 };
    }
    return L;
  }
  function setLabel(id, str, x, y, hot, hidden) {
    var L = getLabel(id);
    L.holder.visible = !hidden;
    if (hidden) return;
    if (L.txt.text !== str) L.txt.text = str;
    var w = L.txt.width + 18, h = L.txt.height + 9;
    if (Math.abs(w - L.w) > 0.4 || Math.abs(h - L.h) > 0.4) {
      L.bg.clear();
      L.bg.roundRect(-w / 2, -h / 2, w, h, 7)
        .fill({ color: hot ? 0x3d1509 : 0x06121d, alpha: hot ? 0.94 : 0.72 })
        .stroke({ width: 1, color: hot ? C.hot : 0x9cc8e0, alpha: hot ? 0.8 : 0.24 });
      L.w = w; L.h = h;
    }
    if (L.txt.style) L.txt.style.fill = hot ? 0xffc9b6 : 0xdfeef8;
    L.holder.position.set(x, y);
  }

  // ================================================================== loop
  function update(dt) {
    S.tick += dt;

    var targetSway = Math.sin(S.tick * 0.65) * 4;
    if (S.metrics && S.metrics.moving) targetSway += Math.sin(S.tick * 2.2) * 4 + S.metrics.vLoad * 6;
    S.swayVel += ((targetSway - S.sway) * 12 - S.swayVel * 3.8) * dt;
    S.sway += S.swayVel * dt;
    S.sway = clamp(S.sway, -30, 30);

    S.lip.x += S.lipVel.x * dt;
    S.lip.y += S.lipVel.y * dt;
    S.lipVel.x *= Math.exp(-dt * 9);
    S.lipVel.y *= Math.exp(-dt * 9);
    S.lip = GG.clampLip(S.lip);

    var view = ropeView();
    S.view = view;
    if (!S.phys) { S.phys = P.createState(S.rig, S.mass); S.phys.lift = S.lift; }

    var pulling = S.pulling || S.auto;
    var m = P.step(S.phys, {
      dt: dt,
      mass: S.mass,
      pulling: pulling,
      vCmd: S.vCmd,
      wraps: view.wraps,
      ratio: view.ratio,
      liftSpan: 4.4,
    });
    S.metrics = m;
    S.lift = S.phys.lift;
    S.ropeSpin += m.vRope * dt * 4.6;
    S.reel += m.vRope * dt * 2.4;

    if (m.stalled) {
      var ci = m.hottest;
      var wasStalled = !!S.stalledAt;
      S.stalledAt = {
        mass: Math.round(S.mass),
        label: P.RIGS[S.rig].contacts[ci].label,
        heat: m.hot,
        temp: m.temp[ci],
        ma: m.ma,
        Rreq: m.Rreq,
      };
      if (!wasStalled) recordStall(S.stalledAt);
      showStall();
    } else if (!pulling) {
      S.stalledAt = null;
    }

    drawRope(view, m);
    drawLoad(view, m);
    drawRig(view, m);
    drawTeam(view, m);
    drawHeat(view, m);
    drawRatioMarks(view, m);
    drawLabels(view, m);
    drawHint(view);

    if (S.auto) {
      if (m.stalled && S.autoStallAt == null) S.autoStallAt = S.tick;
      if (S.autoStallAt != null && S.tick - S.autoStallAt > 1.5) {
        setAuto(false);
        S.autoStallAt = null;
        toast('自动拉绳：已停滞 · 换一组滑轮再试');
      }
      if (!m.stalled) S.autoStallAt = null;
      if (m.done) setAuto(false);
    }

    writeHud(m);
  }

  function drawRig(view, m) {
    var live = {};
    var tension = m ? (m.mass * P.G * m.F) / m.ratio : 0;
    for (var i = 0; i < view.contacts.length; i++) {
      var ct = view.contacts[i];
      var part = scene.parts[ct.id];
      if (!part) continue;
      live[ct.id] = true;
      part.holder.visible = true;
      part.holder.position.set(ct.x, ct.y);
      var hot = m ? (m.heat[i] || 0) : 0;
      var worst = !!(m && i === m.worst && hot < TUNE.HEAT_THRESHOLD);
      if (ct.kind === 'hitch') drawHitch(part, hot, tension, worst);
      else drawSheave(part, ct.r, hot, tension, ct.id === 'lip2' ? -1 : 1, worst);
      if (m && m.losses[i]) tension *= m.losses[i].ratio;
    }
    ['lip', 'lip2', 'mover', 'hitch', 'anchor'].forEach(function (id) {
      if (!live[id] && scene.parts[id]) scene.parts[id].holder.visible = false;
    });

    // The lip block rides a highline strung between two snow anchors. The
    // highline sags, the block hangs from its low point, and the two anchors
    // are drawn as ice screws with their cable tie-ins.
    var rg = scene.rigging;
    rg.clear();
    var a0 = GEO.slingAnchors[0], a1 = GEO.slingAnchors[1];
    var hang = { x: view.lip.x, y: view.lip.y - 30 };
    // catenary-ish sag between the anchors, pulled down to the block
    var sag = 16;
    var left = [], right = [];
    for (var q = 0; q <= 12; q++) {
      var t = q / 12;
      var x = lerp(a0.x, hang.x, t);
      var y = lerp(a0.y, hang.y, t) + Math.sin(t * Math.PI) * sag;
      left.push([x, y]);
    }
    for (var q2 = 0; q2 <= 12; q2++) {
      var t2 = q2 / 12;
      var x2 = lerp(hang.x, a1.x, t2);
      var y2 = lerp(hang.y, a1.y, t2) + Math.sin(t2 * Math.PI) * sag;
      right.push([x2, y2]);
    }
    rg.polyline(left).stroke({ width: 3.2, color: 0x2b3d4c, alpha: 0.95 });
    rg.polyline(right).stroke({ width: 3.2, color: 0x2b3d4c, alpha: 0.95 });
    rg.polyline(left).stroke({ width: 1.1, color: 0x92a8b9, alpha: 0.55 });
    rg.polyline(right).stroke({ width: 1.1, color: 0x92a8b9, alpha: 0.55 });
    // the anchors: ice screws driven into the snow, cable loop on the eye
    [a0, a1].forEach(function (a, idx) {
      var dir = idx === 0 ? 1 : -1;
      rg.ellipse(a.x, a.y + 7, 13, 4.5).fill({ color: 0x8ea4b3, alpha: 0.55 });
      rg.moveTo(a.x, a.y + 4).lineTo(a.x + dir * 2, a.y - 16)
        .stroke({ width: 5, color: 0x8fa3b1, alpha: 0.95 });
      rg.moveTo(a.x, a.y + 4).lineTo(a.x + dir * 2, a.y - 16)
        .stroke({ width: 1.6, color: 0xd2e0ea, alpha: 0.5 });
      rg.circle(a.x, a.y - 18, 4.4).stroke({ width: 2.2, color: 0xbfd0dc });
      // a little snow piled round the screw
      rg.ellipse(a.x, a.y + 5, 16, 5).fill({ color: 0xffffff, alpha: 0.5 });
    });
    // the block the sheaves ride in
    var blockTop = hang.y;
    rg.roundRect(view.lip.x - 30, blockTop - 13, 60, 17, 7).fill({ color: 0x3a4b59 });
    rg.roundRect(view.lip.x - 30, blockTop - 13, 60, 17, 7).stroke({ width: 1.2, color: 0x16202a, alpha: 0.9 });
    rg.roundRect(view.lip.x - 22, blockTop - 17, 44, 6, 3).fill({ color: 0x53687a });
    rg.circle(view.lip.x, blockTop - 19, 3.4).stroke({ width: 2, color: 0xc0d0dc });
    // shackle down to whichever sheave hangs lowest
    rg.moveTo(view.lip.x, blockTop + 4).lineTo(view.lip.x, view.lip.y - 18)
      .stroke({ width: 3.2, color: 0xa8b9c7, alpha: 0.92 });

    if (view.anchor) {
      drawAnchor(scene.parts.anchor, view.anchor.x, view.anchor.y, '死端');
      scene.parts.anchor.holder.visible = true;
    }
  }

  var hazeT = 0;
  function drawHeat(view, m) {
    var g = scene.heatFx;
    g.clear();
    if (!m) return;
    hazeT += 0.016;
    for (var i = 0; i < view.contacts.length; i++) {
      var h = m.heat[i] || 0;
      if (h < 0.35) continue;
      var ct = view.contacts[i];
      var col = h > 0.9 ? C.hot : C.amber;
      for (var k = 0; k < 3; k++) {
        var ph = ((hazeT * 0.5 + k / 3) % 1);
        var yy = -ph * 42;
        var alpha = (1 - ph) * 0.32 * P.smoothstep(h, 0.35, 1.2);
        g.moveTo(ct.x - 8 + Math.sin(ph * 6 + k * 2) * 5, ct.y + yy)
          .quadraticCurveTo(ct.x + 9, ct.y + yy - 16, ct.x + 3 + Math.sin(ph * 5 + k) * 5, ct.y + yy - 32)
          .stroke({ width: 3, color: col, alpha: alpha });
      }
    }
  }

  function drawLabels(view, m) {
    for (var id in scene.labelPool) scene.labelPool[id].holder.visible = false;
    for (var i = 0; i < view.contacts.length; i++) {
      var ct = view.contacts[i];
      var hot = m ? (m.heat[i] || 0) >= TUNE.HEAT_THRESHOLD : false;
      var str = ct.label;
      if (ct.passes > 1 && S.rig === 'jigger') str = ct.id === 'lip' ? '裂口定滑轮 A' : str;
      if (hot && m) str += ' · ' + Math.round(m.temp[i]) + '°C';
      var ox, oy;
      if (ct.id === 'lip') {
        ox = S.rig === 'jigger' ? -66 : -92;
        oy = S.rig === 'jigger' ? 58 : 30;
      } else if (ct.id === 'lip2') {
        ox = -100; oy = -30;
      } else if (ct.id === 'mover') {
        ox = -96; oy = -22;
      } else {
        ox = 48; oy = -32;
      }
      setLabel(ct.id, str, ct.x + ox, ct.y + oy, hot);
    }
  }

  /* Ratio diagram beside the crevasse. A fixed reference metre makes the
   * multiplication legible at rest: the rope run is divided into `n` equal
   * lengths, and the load only rises by one of them. Live speeds and a small
   * marker on each bar show how fast each one is actually moving. */
  function drawRatioMarks(view, m) {
    var g = scene.ratio;
    g.clear();
    if (!m || !scene.ratioLabels) return;
    var L = scene.ratioLabels;
    var x0 = GEO.crev.r + 96;
    var y0 = 592;
    var unit = 44;                    // px per one rope-length unit
    var n = Math.max(1, Math.round(m.ratio));
    var ropeLen = unit * n;

    g.roundRect(x0 - 22, y0 - 46, ropeLen + 56, 138, 12)
      .fill({ color: 0x040f19, alpha: 0.6 })
      .stroke({ width: 1, color: 0x9cc8e0, alpha: 0.18 });

    // rope run: n equal lengths
    for (var i = 0; i < n; i++) {
      var a = x0 + i * unit;
      var b = a + unit;
      g.moveTo(a + 2, y0).lineTo(b - 2, y0)
        .stroke({ width: 3.2, color: C.rope, alpha: 0.9 });
      if (i > 0) {
        g.moveTo(a, y0 - 8).lineTo(a, y0 + 8)
          .stroke({ width: 1.3, color: 0x9db5c7, alpha: 0.55 });
      }
    }
    g.moveTo(x0 - 1, y0 - 10).lineTo(x0 - 1, y0 + 10).stroke({ width: 2, color: 0xbcd3e2, alpha: 0.85 });
    g.moveTo(x0 + ropeLen + 1, y0 - 10).lineTo(x0 + ropeLen + 1, y0 + 10)
      .stroke({ width: 2, color: 0xbcd3e2, alpha: 0.85 });

    // load rise: exactly one length
    g.moveTo(x0, y0 + 34).lineTo(x0 + unit, y0 + 34)
      .stroke({ width: 3.2, color: 0x77e2c3, alpha: 0.95 });
    g.moveTo(x0, y0 + 26).lineTo(x0, y0 + 42).stroke({ width: 1.4, color: 0x9db5c7, alpha: 0.8 });
    g.moveTo(x0 + unit, y0 + 26).lineTo(x0 + unit, y0 + 42)
      .stroke({ width: 1.4, color: 0x9db5c7, alpha: 0.8 });

    // live markers ride their bars at the actual speeds
    var liveRope = clamp(m.vRope / 0.6, 0, 1.4) * ropeLen;
    var liveLoad = clamp(m.vLoad / 0.6, 0, 1.4) * ropeLen;
    if (m.vRope > 0.005) {
      g.circle(x0 + liveRope, y0, 4.6).fill({ color: 0xffffff, alpha: 0.9 });
      g.circle(x0 + liveLoad, y0 + 34, 4.6).fill({ color: 0xffffff, alpha: 0.9 });
    }

    L.rope.text = '绳收 1 m';
    L.load.text = '配重升 1/' + n + ' m';
    L.rope.position.set(x0 + ropeLen + 10, y0);
    L.load.position.set(x0 + unit + 12, y0 + 34);
    L.note.text = '绳速比 ' + m.ratio.toFixed(2) + ' : 1 · 摩擦后 ' + m.ma.toFixed(2) + '×';
    L.note.position.set(x0 - 2, y0 + 62);
  }

  /* Time-to-stall estimate for the current rig & weight, from the model. */
  function predictStall() {
    if (!S.view) return null;
    var m = S.metrics;
    if (!m) return null;
    var mass = S.mass;
    // raise the mass until the required pull exceeds capacity at the current
    // geometry, using the same contact solution the live run uses
    var rig = P.RIGS[S.rig];
    var wraps = S.view.wraps;
    for (var trial = mass; trial <= TUNE.MASS_MAX; trial += 2) {
      var st = P.createState(S.rig, trial);
      st.heat = m.heat.slice();
      var probe = P.step(st, { dt: 1 / 60, pulling: true, vCmd: S.vCmd, wraps: wraps, ratio: S.view.ratio, liftSpan: 1e6 });
      if (probe.speedFactor < 0.06) return { mass: trial, contact: probe.hottest };
    }
    return null;
  }

  function drawHint(view) {
    var show = !S.hintFaded && !S.drag && S.tick < 40;
    scene.hint.alpha = lerp(scene.hint.alpha, show ? 0.94 : 0, 0.07);
    scene.hint.visible = scene.hint.alpha > 0.02;
    if (scene.hint.visible) {
      scene.hint.position.set(view.lip.x - 4, view.lip.y - 92 + Math.sin(S.tick * 2.0) * 3);
    }
  }

  // ===================================================================== HUD
  /* Heat runs far above its threshold when a contact is really scorching, so
   * the gauge is logarithmic: the 0.5 danger line sits near a third of the bar
   * and a runaway contact can still run off the end. */
  function heatPos(h) {
    return clamp(Math.log1p(Math.max(0, h)) / Math.log1p(6), 0, 1);
  }
  var el = {};
  function $(id) { return document.getElementById(id); }

  function writeHud(m) {
    var rig = P.RIGS[m.rig];
    el.statRatio.textContent = m.ratio.toFixed(2) + ':1';
    el.statRatioSub.textContent = '理论 ' + rig.ratio + ':1';
    el.statMA.textContent = m.ma.toFixed(2) + '×';
    el.statRope.textContent = m.vRope.toFixed(2);
    el.statLoad.textContent = m.vLoad.toFixed(2);
    el.statF.textContent = '×' + m.F.toFixed(2);

    el.forceFill.style.width = (clamp(m.Rreq / (m.Rmax * 1.1), 0, 1) * 100).toFixed(1) + '%';
    el.forceText.textContent = Math.round(m.Rreq) + ' N';
    el.forceText.style.color = m.loadRatio > 0.95 ? '#ff8a6a' : (m.loadRatio > 0.8 ? '#ffbd6a' : '');
    var maStat = el.statMA.parentNode;
    maStat.classList.toggle('warn', m.loadRatio > 0.8);
    maStat.classList.toggle('bad', m.loadRatio > 0.95);

    var state = '静止', col = '#93acc0';
    if (m.grabbing) state = '抓结换位';
    else if (m.stalled) { state = '提升停滞'; col = '#ff8a6a'; }
    else if (m.done) state = '已到裂口';
    else if (m.moving) { state = '提升中'; col = '#77e2c3'; }
    else if (m.pulling) { state = '吃紧…'; col = '#ffbd6a'; }
    el.liveState.textContent = state;
    el.liveState.style.color = col;

    var html = '';
    var worstLoss = 0;
    for (var wi2 = 0; wi2 < rig.contacts.length; wi2++) {
      worstLoss = Math.max(worstLoss, m.losses[wi2].ratio - 1);
    }
    for (var i = 0; i < rig.contacts.length; i++) {
      var c = rig.contacts[i];
      var h = m.heat[i] || 0;
      var loss = m.losses[i];
      var isHot = h >= TUNE.HEAT_THRESHOLD;
      // the segment carrying the heaviest friction is always flagged, whether
      // or not it has heated past the threshold yet
      var isWorst = (loss.ratio - 1) >= worstLoss - 1e-9 && (loss.ratio - 1) > 0.01;
      html += '<div class="contact' + (isHot ? ' hot' : '') + (isWorst ? ' worst' : '') + '">' +
        '<span class="dot"></span><span>' +
        '<span class="cname">' + c.label +
        (isHot ? ' <em class="tag-hot">过热</em>' : '') +
        '</span>' +
        '<span class="cmeta">' + (c.kind === 'hitch' ? '抓结滑动' : '弯曲 + 轴承') +
        ' · 包角 ' + Math.round((loss.theta * 180) / Math.PI) + '°</span></span>' +
        '<span class="closs">+' + ((loss.ratio - 1) * 100).toFixed(1) + '%' +
        '<small>' + Math.round(m.temp[i]) + '°C</small></span></div>';
    }
    el.contacts.innerHTML = html;

    var hi = m.hottest;
    var hh = m.heat[hi] || 0;
    el.statHotName.textContent = rig.contacts[hi].label;
    el.statTemp.textContent = Math.round(m.temp[hi]) + ' °C';
    el.statTemp.style.color = hh >= TUNE.HEAT_THRESHOLD ? '#ff8a6a' : (hh > 0.22 ? '#ffbd6a' : '#e9f3fb');
    el.heatPin.style.left = (heatPos(hh) * 100).toFixed(1) + '%';
    el.heatOver.style.width = (clamp((heatPos(hh) - heatPos(TUNE.HEAT_THRESHOLD)) / (1 - heatPos(TUNE.HEAT_THRESHOLD)), 0, 1) * 45).toFixed(1) + '%';
    el.statPower.textContent = Math.round(m.frictionPower) + ' W';


    // speed-ratio strip: rope travel vs load rise, side by side
    var vmax = Math.max(0.35, m.vRope, Math.abs(m.vCmd));
    el.barRope.style.width = (clamp(m.vRope / vmax, 0, 1) * 100).toFixed(1) + '%';
    el.barLoad.style.width = (clamp(m.vLoad / vmax, 0, 1) * 100).toFixed(1) + '%';
    el.numRope.textContent = m.vRope.toFixed(2) + ' m/s';
    el.numLoad.textContent = m.vLoad.toFixed(2) + ' m/s';
    el.numRatio.textContent = m.ratio.toFixed(2);

    // stall forecast: where this rig will give up at the current speed
    if (!el.forecast) return;
    var pred = predictStall();
    el.forecast.textContent = pred
      ? '预计 ' + pred.mass + ' kg 见停滞'
      : '可达上限 ' + TUNE.MASS_MAX + ' kg';
    el.forecast.style.color = pred && pred.mass - S.mass < 20 ? '#ffbd6a' : '#7c94a6';
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2300);
  }

  function showStall() {
    var s = S.stalledAt;
    if (!s) return;
    var key = s.mass + '|' + s.label + '|' + Math.round(s.temp) + '|' + Math.round(s.Rreq);
    if (key === S.stallKey) return;
    S.stallKey = key;
    el.stallTitle.innerHTML = '提升停滞 · <b>' + s.mass + ' kg</b> · ' + P.RIGS[S.rig].name;
    var hotLine = s.hotLabel && s.hotLabel !== s.label
      ? '；同时 <b>' + s.hotLabel + '</b> 最烫（' + Math.round(s.temp) + '°C）'
      : '';
    el.stallDetail.innerHTML = '摩擦最重的绳段：<b>' + s.label + '</b>' + hotLine +
      '。有效倍率只剩 ' + s.ma.toFixed(2) + '×，所需拉力 ' + Math.round(s.Rreq) +
      ' N 已越过队伍上限 1500 N。';
    el.stallBanner.classList.add('show');
  }
  function hideStall() { el.stallBanner.classList.remove('show'); S.stallKey = null; }

  function recordStall(s) {
    if (S.records[S.rig]) return;
    S.records[S.rig] = s;
    renderRecords();
    if (Object.keys(S.records).length >= 2) renderCompare();
  }

  function renderRecords() {
    var html = '';
    ['single', 'double', 'jigger'].forEach(function (k) {
      var r = P.RIGS[k];
      var rec = S.records[k];
      html += '<div class="rec-row' + (rec ? ' done' : '') + '">' +
        '<span class="tag">' + r.short + '</span>' +
        (rec
          ? '<span class="rmeta">' + r.name + ' · ' + (rec.label || '') + '</span><b>' + rec.mass + ' kg</b>'
          : '<span class="empty">' + r.name + ' 未测</span><b>—</b>') +
        '</div>';
    });
    el.records.innerHTML = html;
    el.recHint.textContent = Object.keys(S.records).length + '/3 已测';
  }

  function renderCompare() {
    var keys = Object.keys(S.records);
    if (keys.length < 2) { el.compare.hidden = true; return; }
    var max = Math.max.apply(null, keys.map(function (k) { return S.records[k].mass; }));
    var sorted = keys.slice().sort(function (a, b) { return S.records[b].mass - S.records[a].mass; });
    var html = '';
    sorted.forEach(function (k, i) {
      var mm = S.records[k].mass;
      html += '<div class="cmp' + (i === 0 ? ' first' : '') + '">' +
        '<span>' + P.RIGS[k].short + '</span>' +
        '<span class="track"><i style="width:' + Math.max(5, (mm / max) * 100).toFixed(0) + '%"></i></span>' +
        '<b>' + mm + ' kg</b></div>';
    });
    el.compare.hidden = false;
    el.compare.innerHTML = html;
  }

  function setRig(key, quiet) {
    if (!P.RIGS[key]) return;
    S.rig = key;
    S.phys = P.createState(key, S.mass);
    S.phys.lift = S.lift;
    S.stalledAt = null;
    S.autoStallAt = null;
    hideStall();
    Array.prototype.forEach.call(document.querySelectorAll('.rig'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-rig') === key));
    });
    el.rigTitle.textContent = P.RIGS[key].name;
    el.rigDesc.textContent = P.RIGS[key].desc;
    if (!quiet) toast(P.RIGS[key].name + ' · 绳速比 ' + P.RIGS[key].ratio + ':1');
  }

  function setMass(v, silent) {
    var nm = clamp(Math.round(v / 2) * 2, TUNE.MASS_MIN, TUNE.MASS_MAX);
    S.mass = nm;
    el.massSlider.value = String(nm);
    el.massVal.textContent = String(nm);
    S.stalledAt = null;
    hideStall();
    if (!silent) S.hintFaded = true;
  }

  function resetScene() {
    S.phys = P.createState(S.rig, S.mass);
    S.phys.lift = 0.16;
    S.lift = 0.16;
    S.stalledAt = null;
    S.autoStallAt = null;
    S.lip = { x: GEO.lipHome.x, y: GEO.lipHome.y };
    S.lipVel = { x: 0, y: 0 };
    S.moverOff = { x: GEO.moverHome.x, y: GEO.moverHome.y };
    S.sway = 0; S.swayVel = 0;
    hideStall();
  }

  // ================================================================= input
  function hitPulley(clientX, clientY) {
    var view = S.view;
    if (!view) return null;
    var p = toWorld(clientX, clientY);
    var best = null, bestD = 1e9;
    for (var i = 0; i < view.contacts.length; i++) {
      var ct = view.contacts[i];
      if (ct.kind !== 'sheave') continue;
      var d = Math.hypot(p.x - ct.x, p.y - ct.y);
      if (d < ct.r + 24 && d < bestD) { bestD = d; best = ct.id; }
    }
    if (view.mover) {
      var dm = Math.hypot(p.x - view.mover.x, p.y - view.mover.y);
      if (dm < 38 && dm < bestD) { bestD = dm; best = 'mover'; }
    }
    return best;
  }

  function startDrag(id, ev) {
    var p = toWorld(ev.clientX, ev.clientY);
    S.drag = id === 'mover' ? { type: 'mover' } : { type: 'lip', off: { x: S.lip.x - p.x, y: S.lip.y - p.y } };
    S.hintFaded = true;
    app.canvas.style.cursor = 'grabbing';
  }
  function moveDrag(ev) {
    if (!S.drag) return;
    var p = toWorld(ev.clientX, ev.clientY);
    if (S.drag.type === 'lip') {
      var want = GG.clampLip({ x: p.x + S.drag.off.x, y: p.y + S.drag.off.y });
      S.lipVel.x = (want.x - S.lip.x) * 16;
      S.lipVel.y = (want.y - S.lip.y) * 16;
      S.lip = want;
    } else {
      var top = GG.blockTop(S.lift, S.sway);
      S.moverOff = GG.clampMoverOff({ x: p.x - top.x, y: p.y - top.y });
    }
  }
  function endDrag() {
    if (!S.drag) return;
    S.drag = null;
    app.canvas.style.cursor = '';
  }

  function wireInput() {
    var cv = app.canvas;
    cv.style.touchAction = 'none';

    cv.addEventListener('pointerdown', function (ev) {
      var id = hitPulley(ev.clientX, ev.clientY);
      if (!id) return;
      ev.preventDefault();
      startDrag(id, ev);
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    });
    cv.addEventListener('pointermove', function (ev) {
      if (S.drag) { moveDrag(ev); return; }
      cv.style.cursor = hitPulley(ev.clientX, ev.clientY) ? 'grab' : '';
    });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    Array.prototype.forEach.call(document.querySelectorAll('.rig'), function (b) {
      b.addEventListener('click', function () { setRig(b.getAttribute('data-rig')); });
    });

    el.massSlider.addEventListener('input', function () { setMass(+el.massSlider.value); });
    el.massInc.addEventListener('click', function () { setMass(S.mass + 10); });
    el.massDec.addEventListener('click', function () { setMass(S.mass - 10); });
    el.speedSlider.addEventListener('input', function () {
      S.vCmd = +el.speedSlider.value;
      el.speedVal.textContent = S.vCmd.toFixed(2);
    });

    var press = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      setPulling(true);
      if (ev && ev.pointerId != null && el.btnPull.setPointerCapture) {
        try { el.btnPull.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      }
    };
    var release = function () { setPulling(false); };
    el.btnPull.addEventListener('pointerdown', press);
    el.btnPull.addEventListener('pointerup', release);
    el.btnPull.addEventListener('pointercancel', release);
    el.btnPull.addEventListener('pointerleave', function (ev) { if (!ev.buttons) release(); });

    el.btnAuto.addEventListener('click', function () { setAuto(!S.auto); });
    el.btnReset.addEventListener('click', function () { resetScene(); toast('已复位'); });
    el.stallClose.addEventListener('click', hideStall);
    el.btnCompare.addEventListener('click', runCompare);

    window.addEventListener('keydown', function (ev) {
      if ((ev.code === 'Space' || ev.key === ' ') && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        setPulling(true);
      }
    });
    window.addEventListener('keyup', function (ev) {
      if (ev.code === 'Space' || ev.key === ' ') setPulling(false);
    });

    var rz = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        var sz = stageSize();
        app.renderer.resize(sz.w, sz.h);
        layout();
      }, 80);
    });
  }

  function setPulling(v) {
    S.pulling = v;
    if (v) S.hintFaded = true;
    el.btnPull.classList.toggle('on', v);
    el.btnPull.textContent = v ? '拉绳中…' : '按住拉绳';
    if (v) { S.stalledAt = null; hideStall(); if (S.auto) setAuto(false); }
  }
  function setAuto(v) {
    S.auto = v;
    el.btnAuto.classList.toggle('on', v);
    el.btnAuto.setAttribute('aria-pressed', String(v));
    if (v) { S.stalledAt = null; S.autoStallAt = null; hideStall(); setPulling(false); }
    el.btnPull.classList.toggle('on', v);
    el.btnPull.textContent = v ? '自动拉绳' : '按住拉绳';
  }

  function runCompare() {
    if (el.btnCompare.disabled) return;
    el.btnCompare.disabled = true;
    var rigs = ['single', 'double', 'jigger'];
    var out = {};
    var i = 0;
    function next() {
      if (i < rigs.length) {
        var k = rigs[i++];
        el.btnCompare.textContent = '正在测 ' + P.RIGS[k].name + '…';
        setTimeout(function () {
          var g = GG.build(k, { lift: 0.3, lip: { x: GEO.lipHome.x, y: GEO.lipHome.y }, moverOff: { x: GEO.moverHome.x, y: GEO.moverHome.y } });
          out[k] = P.findStall(k, { from: TUNE.MASS_MIN, to: TUNE.MASS_MAX, step: 2, vCmd: S.vCmd, wraps: g.wraps, ratio: g.ratio });
          next();
        }, 20);
        return;
      }
      el.btnCompare.disabled = false;
      el.btnCompare.textContent = '自动测完三组对照';
      S.records = {};
      rigs.forEach(function (k) {
        if (out[k]) S.records[k] = { mass: out[k].mass, label: out[k].label, heat: out[k].heat, temp: out[k].temp, ma: out[k].ma };
      });
      renderRecords();
      renderCompare();
      var best = rigs.filter(function (k) { return out[k]; })
        .sort(function (a, b) { return out[b].mass - out[a].mass; })[0];
      if (best) toast('最扛重：' + P.RIGS[best].name + '，到 ' + out[best].mass + ' kg 才停滞');
    }
    setTimeout(next, 30);
  }

  // ================================================================== boot
  function boot() {
    if (app) return;
    usingShim = !!(PIXI.__shim);
    PXV = usingShim ? 0 : (parseInt(String(PIXI.VERSION), 10) || 7);

    var s0 = stageSize();
    var opts = {
      width: s0.w,
      height: s0.h,
      backgroundColor: 0x050b14,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    };

    var start = function () {
      var view = app.view || app.canvas || (app.renderer && (app.renderer.view || app.renderer.canvas));
      app.canvas = view;
      var mount = document.getElementById('stage');
      if (mount && view.parentNode !== mount) mount.appendChild(view);
      view.style.width = '100%';
      view.style.height = '100%';
      view.style.display = 'block';

      layers.world = new PIXI.Container();
      app.stage.addChild(layers.world);
      layers.bg = new PIXI.Container();
      layers.mid = new PIXI.Container();
      layers.top = new PIXI.Container();
      layers.world.addChild(layers.bg);
      layers.world.addChild(layers.mid);
      layers.world.addChild(layers.top);

      buildBackground();
      buildScene();
      layout();

      ['statRatio', 'statRatioSub', 'statMA', 'statRope', 'statLoad', 'statF', 'forceFill', 'forceText',
        'liveState', 'contacts', 'statHotName', 'statTemp', 'heatPin', 'heatOver', 'statPower', 'massVal', 'forecast', 'barRope', 'barLoad', 'numRope', 'numLoad', 'numRatio',
        'rigTitle', 'rigDesc', 'records', 'recHint', 'compare', 'toast', 'stallBanner',
        'stallTitle', 'stallDetail', 'stallClose', 'massSlider', 'speedSlider', 'speedVal',
        'massInc', 'massDec', 'btnPull', 'btnAuto', 'btnReset', 'btnCompare'].forEach(function (id) {
        el[id] = $(id);
      });

      wireInput();
      setRig('double', true);
      setMass(S.mass, true);
      renderRecords();
      S.ready = true;

      var bootEl = document.getElementById('boot');
      if (bootEl) {
        bootEl.classList.add('gone');
        setTimeout(function () { bootEl.style.display = 'none'; }, 700);
      }

      var last = performance.now();
      function loop() {
        var now = performance.now();
        var dt = clamp((now - last) / 1000, 0.001, 0.05);
        last = now;
        try { update(dt); } catch (err) { console.error(err); }
        app.renderer.render(app.stage);
      }
      if (app.ticker && app.ticker.add) {
        app.ticker.add(loop);
        // Pixi v7 starts its ticker automatically; the Canvas-2D fallback has
        // to be started explicitly, so ask either way and ignore the no-op.
        if (app.ticker.start) app.ticker.start();
      } else {
        requestAnimationFrame(function raf() { requestAnimationFrame(raf); loop(); });
      }

      window.__probe = function () {
        return {
          ready: S.ready, rig: S.rig, mass: S.mass,
          lip: { x: S.lip.x, y: S.lip.y },
          metrics: S.metrics && {
            ratio: S.metrics.ratio, vRope: S.metrics.vRope, vLoad: S.metrics.vLoad,
            F: S.metrics.F, ma: S.metrics.ma, stalled: S.metrics.stalled,
            hot: S.metrics.hot, heat: S.metrics.heat, temp: S.metrics.temp,
            wraps: S.metrics.wraps, Rreq: S.metrics.Rreq,
          },
        };
      };
      window.__setRig = function (k) { setRig(k, true); };
      window.__worldToScreen = function (wx, wy) {
        return { x: VIEW.ox + wx * VIEW.scale, y: VIEW.oy + wy * VIEW.scale };
      };
      window.__dbg = function () {
        function bnd(g) {
          try {
            var b = g.raw.getBounds();
            return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
          } catch (e) { return 'err:' + e.message; }
        }
        return {
          ropeMain: bnd(scene.ropeMain), ropeShadow: bnd(scene.ropeShadow),
          block: bnd(scene.person), curve: S.view && S.view.curve.length,
          midChildren: layers.mid.children.length,
          curvePts: S.view && S.view.curve.filter(function (q, i) { return i % 5 === 0; })
            .map(function (q) { return [Math.round(q.x), Math.round(q.y)]; }),
        };
      };
    };

    if (usingShim) {
      app = new PIXI.Application(opts);
      start();
    } else if (PXV >= 8) {
      app = new PIXI.Application();
      app.init(opts).then(start);
    } else {
      app = new PIXI.Application(opts);
      start();
    }
  }

  window.__startPixiScene = boot;
  if (window.PIXI) boot();
  else {
    var tries = 0;
    var wait = setInterval(function () {
      if (window.PIXI) { clearInterval(wait); boot(); }
      else if (++tries > 120) clearInterval(wait);
    }, 50);
  }
})();
