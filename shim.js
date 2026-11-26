/* ice-crevasse-pulleys — minimal PixiJS compatibility layer.
 *
 * The page prefers real PixiJS v7 (UMD) from a CDN. If that cannot load
 * (offline, blocked, old browser) this shim renders the same scene through the
 * Canvas 2D API. It implements just the subset of the Pixi v7 API that main.js
 * uses, with matching semantics (path accumulation, fill/stroke, transforms,
 * anchors), so no scene logic lives here.
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  var nextId = 1;

  function rgbOf(v) {
    if (typeof v === 'number') return '#' + ('00000' + (v >>> 0).toString(16)).slice(-6);
    return String(v);
  }

  // ---------------------------------------------------------------- transform
  function transforms(node) {
    node._x = 0; node._y = 0; node._sx = 1; node._sy = 1;
    node._rot = 0; node.alpha = 1; node.visible = true;
    node.position = {
      get x() { return node._x; }, set x(v) { node._x = v; },
      get y() { return node._y; }, set y(v) { node._y = v; },
      set(x, y) { node._x = x; node._y = y; },
    };
    node.scale = {
      get x() { return node._sx; }, set x(v) { node._sx = v; },
      get y() { return node._sy; }, set y(v) { node._sy = v; },
      set(x, y) { node._sx = x; node._sy = y == null ? x : y; },
    };
    Object.defineProperty(node, 'x', { get() { return node._x; }, set(v) { node._x = v; } });
    Object.defineProperty(node, 'y', { get() { return node._y; }, set(v) { node._y = v; } });
    Object.defineProperty(node, 'rotation', { get() { return node._rot; }, set(v) { node._rot = v; } });
    node._px = 0; node._py = 0;
    node.pivot = {
      get x() { return node._px; }, set x(v) { node._px = v; },
      get y() { return node._py; }, set y(v) { node._py = v; },
      set(x, y) { node._px = x; node._py = y == null ? x : y; },
    };
  }

  // -------------------------------------------------------------- Graphics
  function Graphics() {
    transforms(this);
    this.id = nextId++;
    this.kind = 'g';
    this.ops = [];
    this._path = [];   // [{ pts: [[x,y],...] }]
    this._cur = [0, 0];
  }
  Graphics.prototype._sub = function () {
    if (!this._path.length) this._path.push({ pts: [] });
    return this._path[this._path.length - 1];
  };
  Graphics.prototype.clear = function () { this.ops.length = 0; this._path.length = 0; return this; };
  Graphics.prototype.moveTo = function (x, y) {
    this._path.push({ pts: [[x, y]] });
    this._cur = [x, y];
    return this;
  };
  Graphics.prototype.lineTo = function (x, y) {
    var s = this._sub();
    if (!s.pts.length) s.pts.push([this._cur[0], this._cur[1]]);
    s.pts.push([x, y]);
    this._cur = [x, y];
    return this;
  };
  Graphics.prototype.quadraticCurveTo = function (cx, cy, x, y) {
    var p0 = [this._cur[0], this._cur[1]];
    this.moveTo(p0[0], p0[1]);
    for (var i = 1; i <= 12; i++) {
      var t = i / 12, mt = 1 - t;
      this.lineTo(mt * mt * p0[0] + 2 * mt * t * cx + t * t * x,
        mt * mt * p0[1] + 2 * mt * t * cy + t * t * y);
    }
    this._cur = [x, y];
    return this;
  };
  Graphics.prototype._poly = function (cx, cy, rx, ry, a0, a1) {
    var steps = 56;
    var span = a1 - a0;
    var closed = Math.abs(Math.abs(span) - TAU) < 1e-6;
    var s = this._sub();
    var started = s.pts.length > 0;
    for (var i = 0; i <= steps; i++) {
      var a = a0 + (span * i) / steps;
      s.pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    if (!started && !closed) this._path[this._path.length - 1].open = true;
    this._cur = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
    return this;
  };
  Graphics.prototype.circle = function (cx, cy, r) { return this._poly(cx, cy, r, r, 0, TAU); };
  Graphics.prototype.ellipse = function (cx, cy, rx, ry) { return this._poly(cx, cy, rx, ry, 0, TAU); };
  Graphics.prototype.arc = function (cx, cy, r, a0, a1) { return this._poly(cx, cy, r, r, a0, a1); };
  Graphics.prototype.rect = function (x, y, w, h) {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h);
    this.lineTo(x, y);
    return this;
  };
  Graphics.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
    if (!r) return this.rect(x, y, w, h);
    var a;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    a = -Math.PI / 2; this._poly(x + w - r, y + r, r, r, a, 0);
    this.lineTo(x + w, y + h - r);
    this._poly(x + w - r, y + h - r, r, r, 0, Math.PI / 2);
    this.lineTo(x + r, y + h);
    this._poly(x + r, y + h - r, r, r, Math.PI / 2, Math.PI);
    this.lineTo(x, y + r);
    this._poly(x + r, y + r, r, r, Math.PI, Math.PI * 1.5);
    this._path[this._path.length - 1].pts.push([x + r, y]);
    return this;
  };
  Graphics.prototype.closePath = function () {
    var s = this._sub();
    if (s.pts.length > 1) s.pts.push(s.pts[0].slice());
    return this;
  };
  Graphics.prototype.fill = function (opt) {
    opt = opt || {};
    if (this._path.length) {
      this.ops.push({
        type: 'fill', paths: this._path,
        color: opt.color != null ? opt.color : 0,
        alpha: opt.alpha != null ? opt.alpha : 1,
      });
    }
    this._path = [];
    return this;
  };
  Graphics.prototype.stroke = function (opt) {
    opt = opt || {};
    if (this._path.length) {
      this.ops.push({
        type: 'stroke', paths: this._path,
        color: opt.color != null ? opt.color : 0,
        alpha: opt.alpha != null ? opt.alpha : 1,
        width: opt.width || 1,
        cap: opt.cap || 'butt',
        join: opt.join || 'miter',
      });
    }
    this._path = [];
    return this;
  };

  // ------------------------------------------------------------------- Text
  var measureCanvas = null;
  function measure(t) {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    var c = measureCanvas.getContext('2d');
    var st = t.style || {};
    var size = st.fontSize || 14;
    c.font = (st.fontWeight || 'normal') + ' ' + size + 'px ' + (st.fontFamily || 'sans-serif');
    var lines = String(t.text).split('\n');
    var w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, c.measureText(lines[i]).width);
    var lh = st.lineHeight || size * 1.35;
    return { w: w, h: lines.length * lh, lh: lh, lines: lines, size: size };
  }
  function Text(str, style) {
    transforms(this);
    this.id = nextId++;
    this.kind = 't';
    this.style = style || {};
    var self = this;
    var ax = this.style.anchorX || this.style.anchor || 0;
    var ay = this.style.anchorY || this.style.anchor || 0;
    this.anchor = {
      x: ax, y: ay,
      set(a, b) {
        if (a && typeof a === 'object') { self.anchor.x = a.x || 0; self.anchor.y = a.y || 0; }
        else { self.anchor.x = a || 0; self.anchor.y = b == null ? (a || 0) : b; }
      },
    };
    Object.defineProperty(this, 'text', {
      get() { return self._text; },
      set(v) { self._text = String(v == null ? '' : v); self._dirty = true; },
    });
    this._text = String(str == null ? '' : str);
    this._dirty = true;
  }
  Text.prototype.setAnchor = function (a, b) { this.anchor.set(a, b); return this; };
  Object.defineProperty(Text.prototype, 'width', {
    get() { var m = measure(this); return m.w; },
  });
  Object.defineProperty(Text.prototype, 'height', {
    get() { var m = measure(this); return m.h; },
  });

  // -------------------------------------------------------------- Container
  function Container() {
    transforms(this);
    this.kind = 'c';
    this.children = [];
    this.parent = null;
  }
  Container.prototype.addChild = function () {
    for (var i = 0; i < arguments.length; i++) {
      var c = arguments[i];
      if (!c) continue;
      if (c.parent) c.parent.removeChild(c);
      c.parent = this;
      this.children.push(c);
    }
    return arguments.length === 1 ? arguments[0] : this;
  };
  Container.prototype.removeChild = function (c) {
    var i = this.children.indexOf(c);
    if (i >= 0) { this.children.splice(i, 1); c.parent = null; }
    return c;
  };
  Container.prototype.removeChildren = function () {
    var out = this.children.slice();
    out.forEach(function (c) { c.parent = null; });
    this.children.length = 0;
    return out;
  };

  // --------------------------------------------------------------- Renderer
  function Renderer(opts) {
    opts = opts || {};
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.view = this.canvas;
    this.ctx = this.canvas.getContext('2d');
    this._scale = opts.resolution || 1;
    this.width = 0;
    this.height = 0;
    this.background = opts.backgroundColor != null ? opts.backgroundColor : null;
  }
  Renderer.prototype.resize = function (w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    var s = this._scale;
    this.canvas.width = Math.round(this.width * s);
    this.canvas.height = Math.round(this.height * s);
    this.render(null);
  };
  Renderer.prototype.render = function (root) {
    var c = this.ctx, s = this._scale;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.background != null) {
      c.fillStyle = rgbOf(this.background);
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    c.setTransform(s, 0, 0, s, 0, 0);
    if (root) {
      c.save();
      this._node(root, c, 1);
      c.restore();
    }
  };
  Renderer.prototype._node = function (n, c, pa) {
    if (!n || n.visible === false) return;
    var a = pa * (n.alpha == null ? 1 : n.alpha);
    if (a <= 0.004) return;
    c.save();
    c.translate(n._x || 0, n._y || 0);
    if (n._rot) c.rotate(n._rot);
    if (n._sx !== 1 || n._sy !== 1) c.scale(n._sx, n._sy);
    if (n._px || n._py) c.translate(-(n._px || 0), -(n._py || 0));
    if (n.kind === 'c') {
      for (var i = 0; i < n.children.length; i++) this._node(n.children[i], c, a);
      c.restore();
      return;
    }
    c.restore();
    c.save();
    c.translate(n._x || 0, n._y || 0);
    if (n._rot) c.rotate(n._rot);
    if (n._sx !== 1 || n._sy !== 1) c.scale(n._sx, n._sy);
    if (n._px || n._py) c.translate(-(n._px || 0), -(n._py || 0));
    if (n.kind === 'g') this._g(n, c, a);
    else if (n.kind === 't') this._t(n, c, a);
    c.restore();
  };
  Renderer.prototype._g = function (g, c, alpha) {
    for (var i = 0; i < g.ops.length; i++) {
      var o = g.ops[i];
      c.globalAlpha = alpha * (o.alpha == null ? 1 : o.alpha);
      c.fillStyle = c.strokeStyle = rgbOf(o.color);
      c.lineCap = o.cap || 'butt';
      c.lineJoin = o.join || 'miter';
      c.beginPath();
      for (var p = 0; p < o.paths.length; p++) {
        var pts = o.paths[p].pts;
        if (!pts || pts.length < 2) continue;
        c.moveTo(pts[0][0], pts[0][1]);
        for (var k = 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]);
        if (o.type === 'fill') c.closePath();
      }
      if (o.type === 'stroke') { c.lineWidth = o.width; c.stroke(); }
      else c.fill();
    }
    c.globalAlpha = 1;
  };
  Renderer.prototype._t = function (t, c, alpha) {
    var st = t.style || {};
    var m = measure(t);
    var pad = st.padding || 0;
    var top = -m.h * t.anchor.y;
    c.font = (st.fontWeight || 'normal') + ' ' + m.size + 'px ' + (st.fontFamily || 'sans-serif');
    if (st.backgroundColor != null) {
      c.globalAlpha = alpha;
      c.fillStyle = rgbOf(st.backgroundColor);
      var rr = st.bgRadius || 4;
      c.beginPath();
      var bx = -m.w * t.anchor.x - pad, by = top - pad;
      var bw = m.w + pad * 2, bh = m.h + pad * 2;
      if (c.roundRect) c.roundRect(bx, by, bw, bh, rr); else c.rect(bx, by, bw, bh);
      c.fill();
    }
    c.globalAlpha = alpha;
    c.fillStyle = rgbOf(st.fill != null ? st.fill : 0xffffff);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    for (var i = 0; i < m.lines.length; i++) {
      c.fillText(m.lines[i], -m.w * t.anchor.x, top + i * m.lh + m.lh / 2);
    }
    c.globalAlpha = 1;
  };

  // ----------------------------------------------------------------- Ticker
  function Ticker() { this.fns = []; this._raf = 0; this._last = 0; }
  Ticker.prototype.add = function (fn) {
    this.fns.push(fn);
    if (!this._raf) this.start();
    return this;
  };
  Ticker.prototype.remove = function (fn) {
    var i = this.fns.indexOf(fn);
    if (i >= 0) this.fns.splice(i, 1);
    return this;
  };
  Ticker.prototype.start = function () {
    var self = this;
    if (self._raf) return self;
    function loop(t) {
      self._raf = requestAnimationFrame(loop);
      var now = t / 1000;
      var dt = self._last ? Math.min(0.1, Math.max(0.001, now - self._last)) : 1 / 60;
      self._last = now;
      for (var i = 0; i < self.fns.length; i++) self.fns[i](dt);
    }
    self._raf = requestAnimationFrame(loop);
    return self;
  };
  Ticker.prototype.stop = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0; this._last = 0;
    return this;
  };

  // ----------------------------------------------------------- Application
  function Application(opts) {
    var app = this;
    app.stage = new Container();
    app.renderer = null;
    app.canvas = null;
    app.ticker = new Ticker();
    var init = function (o) {
      o = o || {};
      app.renderer = new Renderer(o);
      app.canvas = app.view = app.renderer.canvas;
      app.renderer.resize(o.width || 800, o.height || 600);
      return Promise.resolve(app);
    };
    app.init = init;
    // matching Pixi v7: options passed to the constructor start the app
    if (opts) init(opts);
    app.destroy = function () {
      if (app.renderer && app.renderer.canvas.parentNode) {
        app.renderer.canvas.parentNode.removeChild(app.renderer.canvas);
      }
    };
  }

  var PIXI = {
    VERSION: 'shim-1',
    __shim: true,
    Application: Application,
    Container: Container,
    Graphics: Graphics,
    Text: Text,
    Ticker: Ticker,
    Renderer: Renderer,
    TextStyle: function (s) { Object.assign(this, s); },
  };

  window.PIXI = PIXI;
  window.__PIXI_SHIM_READY__ = true;
  if (window.__startPixiScene) window.__startPixiScene();
})();
