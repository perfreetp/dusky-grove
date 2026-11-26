/* ice-crevasse-pulleys — rope geometry (shared by the scene and by tests).
 *
 * Pure 2-D layout of the crevasse: where the sheaves sit, how the rope runs,
 * what wrap angle each contact produces, and what rope speed ratio the drawn
 * strands actually give. All three feed physics.js, so dragging a pulley
 * changes both the friction and the multiplication you see.
 *
 * Rope speed ratio from geometry
 * ------------------------------
 * For a strand running from a point that moves with the load to a fixed point,
 * raising the load by dy shortens the strand by cos(a)·dy, where a is the
 * strand's angle to the vertical. The hauled end must give up the sum of those
 * shortenings, so
 *
 *     ratio = Σ cos(a) over the load-side strands      (1 / 2 / 3 when vertical)
 *
 * Lean the harness sideways, or hoist the load until the strands splay out,
 * and the ratio falls below nominal exactly the way a real system loses
 * advantage on a shallow haul. Clamped so a degenerate layout stays sane.
 *
 * World units are pixels on a 1600 x 1000 design canvas, y down.
 */
(function (root) {
  'use strict';

  var GEO = {
    W: 1600,
    H: 1000,

    mouth: 424,                     // snow line at the crevasse mouth
    crev: { l: 548, r: 872, cx: 710, bottom: 1240 },

    hands: { x: 1010, y: 438 },     // the rescue team's hands, at chest height
    team: { x: 1030, y: 456 },

    // The lip block hangs from a highline strung between two ice-screw anchors
    // set back on the snow. Because the strand runs are long and nearly
    // vertical, the multiplication really is 2:1 and 3:1 (measured below).
    lipHome: { x: 710, y: 452 },
    lipBox: { x0: 652, x1: 786, y0: 404, y1: 536 },
    slingAnchors: [{ x: 588, y: 418 }, { x: 838, y: 422 }],

    anchorOff: { x: 42, y: -26 },   // double: dead end tied to the block
    lip2Off: { x: -84, y: -62 },    // jigger: second groove on the same block
    hitchOff: { x: 128, y: -26 },   // prusik on the haul line, out towards the team

    moverHome: { x: -10, y: -34 },  // moving sheave, above the harness ring
    moverBox: 54,                   // how far the moving sheave may be dragged
    tieOff: { x: 24, y: 2 },        // jigger rope end on the harness

    liftTop: 556,                   // harness ring, just under the rim
    liftBottom: 812,                // harness ring, deep in the crevasse
    sheaveR: { lip: 21, mover: 15 },
    hitchWrap: 1.05,
  };

  function vec(a, b) { return { x: b.x - a.x, y: b.y - a.y }; }
  function len(v) { return Math.hypot(v.x, v.y); }
  function norm(v) { var l = len(v) || 1; return { x: v.x / l, y: v.y / l }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function blockTop(lift, sway) {
    var y = GEO.liftBottom + (GEO.liftTop - GEO.liftBottom) * (lift || 0);
    return { x: GEO.crev.cx + (sway || 0), y: y };
  }

  // Deflection between the two travel directions through a point = wrap angle.
  function wrapOf(prev, at, next) {
    var din = norm(vec(prev, at));
    var dout = norm(vec(at, next));
    return Math.acos(clamp(dot(din, dout), -1, 1));
  }

  /* The rope wraps the sheave on the far side of the chord prev→next. */
  function aroundSheave(prev, c, next, r, wrap) {
    var mid = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
    var away = { x: c.x - mid.x, y: c.y - mid.y };
    if (len(away) < 0.5) away = { x: c.x - prev.x, y: c.y - prev.y };
    var aMid = Math.atan2(away.y, away.x);
    var half = clamp(wrap, 0.1, Math.PI) / 2;
    var p1 = { x: c.x + r * Math.cos(aMid - half), y: c.y + r * Math.sin(aMid - half) };
    var p2 = { x: c.x + r * Math.cos(aMid + half), y: c.y + r * Math.sin(aMid + half) };
    if (len(vec(prev, p2)) < len(vec(prev, p1))) { var t = p1; p1 = p2; p2 = t; }
    var aStart = Math.atan2(p1.y - c.y, p1.x - c.x);
    var aEnd = Math.atan2(p2.y - c.y, p2.x - c.x);
    var d = aEnd - aStart;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    var steps = Math.max(3, Math.ceil(Math.abs(d) / 0.15));
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var a = aStart + (d * i) / steps;
      pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    }
    return { entry: p1, exit: p2, pts: pts };
  }

  /* Node list for a rig, in rope order from the load end to the hands. */
  function nodesFor(rigKey, o) {
    var lip = o.lip || GEO.lipHome;
    var top = blockTop(o.lift, o.sway);
    var mOff = o.moverOff || GEO.moverHome;
    var mover = { x: top.x + mOff.x, y: top.y + mOff.y };
    var hands = GEO.hands;
    var lipR = GEO.sheaveR.lip, moverR = GEO.sheaveR.mover;
    var lip2 = { x: lip.x + GEO.lip2Off.x, y: lip.y + GEO.lip2Off.y };
    var anchor = { x: lip.x + GEO.anchorOff.x, y: lip.y + GEO.anchorOff.y };
    var tie = { x: top.x + GEO.tieOff.x, y: top.y + GEO.tieOff.y };
    var hitch = { x: lip.x + GEO.hitchOff.x, y: lip.y + GEO.hitchOff.y };

    if (rigKey === 'single') {
      return {
        lip: lip, mover: mover, top: top, hands: hands, tie: tie,
        nodes: [
          { p: { x: top.x, y: top.y + 2 }, kind: 'tie', id: 'tie' },
          { p: lip, kind: 'sheave', id: 'lip', r: lipR },
          { p: hands, kind: 'end' },
        ],
        loadStrands: [{ a: { x: top.x, y: top.y + 2 }, b: lip }],
      };
    }
    if (rigKey === 'double') {
      return {
        lip: lip, mover: mover, top: top, hands: hands, anchor: anchor, tie: tie,
        nodes: [
          { p: anchor, kind: 'tie', id: 'anchor' },
          { p: mover, kind: 'sheave', id: 'mover', r: moverR },
          { p: lip, kind: 'sheave', id: 'lip', r: lipR },
          { p: hands, kind: 'end' },
        ],
        loadStrands: [{ a: mover, b: anchor }, { a: mover, b: lip }],
      };
    }
    return {
      lip: lip, lip2: lip2, mover: mover, top: top, hands: hands, tie: tie, hitch: hitch,
      nodes: [
        { p: tie, kind: 'tie', id: 'tie' },
        { p: lip, kind: 'sheave', id: 'lip', r: lipR },
        { p: mover, kind: 'sheave', id: 'mover', r: moverR },
        { p: lip2, kind: 'sheave', id: 'lip2', r: lipR },
        { p: hitch, kind: 'hitch', id: 'hitch' },
        { p: hands, kind: 'end' },
      ],
      loadStrands: [{ a: tie, b: lip }, { a: mover, b: lip }, { a: mover, b: lip2 }],
    };
  }

  var LABELS = {
    lip: '裂口定滑轮',
    lip2: '裂口定滑轮 · 第二圈',
    mover: '配重动滑轮',
    hitch: '抓结',
  };

  /* Geometric speed ratio: sum of cos(angle to vertical) over load strands. */
  function ratioFromStrands(strands, nominal) {
    var sum = 0;
    for (var i = 0; i < strands.length; i++) {
      var a = strands[i].a, b = strands[i].b;
      var dx = a.x - b.x, dy = a.y - b.y;
      var d = Math.hypot(dx, dy);
      if (d < 1) return nominal;
      sum += Math.abs(dy) / d;
    }
    return clamp(sum, nominal * 0.55, nominal);
  }

  function build(rigKey, o) {
    o = o || {};
    var layout = nodesFor(rigKey, o);
    var nodes = layout.nodes;
    var pieces = [];
    var curve = [];
    var raw = [];

    var cur = { x: nodes[0].p.x, y: nodes[0].p.y };
    curve.push({ x: cur.x, y: cur.y });

    for (var i = 1; i < nodes.length; i++) {
      var nd = nodes[i];
      var prevP = nodes[i - 1].p;
      var nextP = i + 1 < nodes.length ? nodes[i + 1].p : nd.p;

      if (nd.kind === 'sheave') {
        var w = wrapOf(prevP, nd.p, nextP);
        var g = aroundSheave(prevP, nd.p, nextP, nd.r, w);
        pieces.push({ kind: 'line', a: { x: cur.x, y: cur.y }, b: g.entry, from: i - 1, to: i });
        var arcIdx = pieces.length;
        pieces.push({ kind: 'arc', c: nd.p, r: nd.r, pts: g.pts, from: i, to: i });
        for (var k = 0; k < g.pts.length; k++) curve.push(g.pts[k]);
        cur = g.exit;
        raw.push({ id: nd.id, kind: 'sheave', label: LABELS[nd.id], x: nd.p.x, y: nd.p.y, r: nd.r, wrap: w, piece: arcIdx });
      } else if (nd.kind === 'hitch') {
        pieces.push({ kind: 'line', a: { x: cur.x, y: cur.y }, b: nd.p, from: i - 1, to: i });
        curve.push({ x: nd.p.x, y: nd.p.y });
        cur = nd.p;
        raw.push({ id: nd.id, kind: 'hitch', label: LABELS[nd.id], x: nd.p.x, y: nd.p.y, r: 10, wrap: GEO.hitchWrap, piece: -1 });
      } else {
        pieces.push({ kind: 'line', a: { x: cur.x, y: cur.y }, b: nd.p, from: i - 1, to: i });
        curve.push({ x: nd.p.x, y: nd.p.y });
        cur = nd.p;
      }
    }

    // merge repeated passes over the same sheave (a capstan adds its wraps)
    var contacts = [];
    var byId = {};
    for (var q = 0; q < raw.length; q++) {
      var c = raw[q];
      if (byId[c.id]) {
        byId[c.id].wrap += c.wrap;
        byId[c.id].passes++;
      } else {
        var copy = {
          id: c.id, kind: c.kind, label: c.label, x: c.x, y: c.y, r: c.r,
          wrap: c.wrap, passes: 1, pieces: [c.piece], index: contacts.length,
        };
        byId[c.id] = copy;
        contacts.push(copy);
      }
    }

    var nominal = rigKey === 'single' ? 1 : (rigKey === 'double' ? 2 : 3);
    var ratio = ratioFromStrands(layout.loadStrands, nominal);

    return {
      rig: rigKey,
      nodes: nodes,
      pieces: pieces,
      curve: curve,
      contacts: contacts,
      wraps: contacts.map(function (z) { return z.wrap; }),
      ratio: ratio,
      nominal: nominal,
      lip: layout.lip,
      lip2: layout.lip2,
      mover: layout.mover,
      top: layout.top,
      tie: layout.tie,
      hitch: layout.hitch,
      anchor: layout.anchor,
      hands: layout.hands,
      sway: o.sway || 0,
    };
  }

  function clampLip(p) {
    var b = GEO.lipBox;
    return { x: clamp(p.x, b.x0, b.x1), y: clamp(p.y, b.y0, b.y1) };
  }
  function clampMoverOff(off) {
    var m = Math.hypot(off.x, off.y), max = GEO.moverBox;
    if (m <= max) return { x: off.x, y: off.y };
    return { x: (off.x / m) * max, y: (off.y / m) * max };
  }

  var api = {
    GEO: GEO, build: build, nodesFor: nodesFor, blockTop: blockTop,
    clampLip: clampLip, clampMoverOff: clampMoverOff, wrapOf: wrapOf,
    ratioFromStrands: ratioFromStrands,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IceGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
