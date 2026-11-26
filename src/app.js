/* 高空舞台剖面 —— 交互与绘制 */
(function () {
  'use strict';
  const SM = window.StageModel;
  const m = SM.make();
  const P0 = m.mass * SM.G / 1000;

  const state = {
    actors: [SM.makeActor(m, 0.98), SM.makeActor(m, 1.84)],
    r: null,
    sliceX: 3.20,       // 剖切面位置（沿梁长）
    limit: m.defLimit,
    playing: false, t: 0, accum: 0,
    dragIdx: -1
  };

  const $ = (id) => document.getElementById(id);
  const stagewrap = $('stagewrap');
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------------- 比例 ---------------- */
  const PX = { s: 1, ox: 0, oy: 0, stripTop: 0, stripH: 0, baseline: 0 };
  function layout() {
    const W = stagewrap.clientWidth, H = stagewrap.clientHeight;
    const padX = 36, padT = 62, padB = 132;
    const worldTop = m.beamTop + 0.42;
    const worldBot = 0;
    PX.stripH = 88;
    PX.stripTop = H - PX.stripH;
    const availH = H - padT - padB;
    const s = Math.min((W - 2 * padX) / m.L, availH / (worldTop - worldBot));
    PX.s = s;
    PX.ox = (W - s * m.L) / 2;
    PX.oy = padT + (availH - s * (worldTop - worldBot)) / 2 + s * worldTop;
    PX.baseline = PX.stripTop + 30;
  }
  const X = (x) => PX.ox + x * PX.s;
  const Y = (y) => PX.oy - y * PX.s;
  const U = (l) => l * PX.s;

  /* ---------------- Konva ---------------- */
  const stage = new Konva.Stage({ container: 'konva', width: 1, height: 1 });
  const LBG = new Konva.Layer({ listening: false });
  const LB = new Konva.Layer({ listening: false });
  const LC = new Konva.Layer({ listening: false });
  const LA = new Konva.Layer();
  stage.add(LBG, LB, LC, LA);

  const PAL = {
    get steel() { return cssVar('--steel'); },
    get steel2() { return cssVar('--steel2'); },
    get steelTop() { return cssVar('--steelTop'); },
    get accent() { return cssVar('--accent'); },
    get danger() { return cssVar('--danger'); },
    get warn() { return cssVar('--warn'); },
    get ok() { return cssVar('--ok'); },
    get ink2() { return cssVar('--ink2'); },
    get muted() { return cssVar('--muted'); },
    get line2() { return cssVar('--line2'); },
    get mat() { return cssVar('--mat'); },
    get deck() { return cssVar('--deck'); },
    get panel() { return cssVar('--panel'); },
    get stagebg() { return cssVar('--stagebg'); },
    get grid() { return cssVar('--grid'); },
    get amber() { return cssVar('--amber'); }
  };

  const wex = (x) => SM.vAt(m, state.r.u, x);

  /* =============== 背景 =============== */
  function drawBG() {
    LBG.destroyChildren();
    const W = stage.width(), H = stage.height(), P = PAL;
    LBG.add(new Konva.Rect({
      x: 0, y: 0, width: W, height: H,
      fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: H },
      fillLinearGradientColorStops: [0, P.stagebg, 1, cssVar('--bg2')]
    }));
    // 舞台地板
    const dy = Y(m.deckTop);
    LBG.add(new Konva.Rect({ x: X(0) - U(0.3), y: dy, width: U(m.L) + U(0.6), height: Y(0) - dy, fill: P.deck }));
    LBG.add(new Konva.Line({ points: [X(0) - U(0.3), dy, X(m.L) + U(0.3), dy], stroke: P.line2, strokeWidth: 1 }));
    // 保护垫
    LBG.add(new Konva.Rect({ x: X(2.42), y: Y(m.matTop), width: U(3.56), height: U(m.matThick), fill: P.mat, opacity: .40 }));
    LBG.add(new Konva.Rect({ x: X(2.42), y: Y(m.matTop), width: U(3.56), height: U(.05), fill: P.mat, opacity: .85 }));
    const mt = new Konva.Text({ text: '保护垫区', fontSize: 9.5, fill: P.muted });
    mt.x(X(2.42) + 7); mt.y(Y(m.matTop) + U(.28));
    LBG.add(mt);
    // 网格
    for (let x = 0; x <= m.L + 1e-6; x += 0.5) {
      const major = Math.abs(x - Math.round(x)) < 1e-6;
      LBG.add(new Konva.Line({ points: [X(x), Y(0), X(x), Y(m.beamTop + .42)], stroke: P.grid, strokeWidth: major ? 1 : .6 }));
    }
    for (let y = 0; y <= m.beamTop + .42; y += 0.5) {
      LBG.add(new Konva.Line({ points: [X(0), Y(y), X(m.L), Y(y)], stroke: P.grid, strokeWidth: .6 }));
    }
    // 梁长刻度
    for (let x = 0; x <= m.L; x += 1) {
      const t = new Konva.Text({ text: x + ' m', fontSize: 8.5, fill: P.muted, opacity: .7 });
      t.x(X(x) - t.width() / 2); t.y(Y(0) + 7);
      LBG.add(t);
    }
    // 挠度曲线面板底
    LBG.add(new Konva.Rect({ x: 8, y: PX.stripTop - 6, width: W - 16, height: PX.stripH, fill: cssVar('--panel3'), opacity: .78, cornerRadius: 10 }));
    LBG.add(new Konva.Line({ points: [16, PX.baseline, W - 16, PX.baseline], stroke: P.line2, strokeWidth: 1, opacity: .75 }));
    const t1 = new Konva.Text({ text: '挠度曲线 v(x)  竖向放大', fontSize: 9.5, fill: P.muted });
    t1.x(18); t1.y(PX.stripTop + 6);
    LBG.add(t1);
  }

  /* =============== 梁 / 吊点 / 剖面带 =============== */
  function reversePairs(arr) {
    const o = [];
    for (let i = arr.length - 2; i >= 0; i -= 2) o.push(arr[i], arr[i + 1]);
    return o;
  }
  function drawBeam() {
    LB.destroyChildren();
    const P = PAL, r = state.r, N = 150;

    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const x = m.L * i / N, v = wex(x);
      top.push(X(x), Y(m.beamTop - v));
      bot.push(X(x), Y(m.underside0 - v));
    }
    const outline = top.concat(reversePairs(bot));
    LB.add(new Konva.Shape({
      sceneFunc: (ctx) => {
        ctx.beginPath(); ctx.moveTo(outline[0], outline[1]);
        for (let i = 2; i < outline.length; i += 2) ctx.lineTo(outline[i], outline[i + 1]);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, Y(m.beamTop), 0, Y(m.underside0));
        g.addColorStop(0, P.steelTop); g.addColorStop(.38, P.steel); g.addColorStop(1, P.steel2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = P.steelTop; ctx.lineWidth = 1; ctx.stroke();
      }
    }));

    // 超限区段在梁身上标红
    const limV = state.limit / 1000;
    const spans = [];
    let open = false, s0 = 0;
    for (let i = 0; i <= N; i++) {
      const x = m.L * i / N, v = wex(x);
      const over = v > limV;
      if (over && !open) { open = true; s0 = x; }
      if (!over && open) { spans.push([s0, x]); open = false; }
    }
    if (open) spans.push([s0, m.L]);
    for (const [a, b] of spans) {
      const q = [];
      const n = 24;
      for (let k = 0; k <= n; k++) { const x = a + (b - a) * k / n, v = wex(x); q.push(X(x), Y(m.beamTop - v)); }
      for (let k = n; k >= 0; k--) { const x = a + (b - a) * k / n, v = wex(x); q.push(X(x), Y(m.underside0 - v)); }
      LB.add(new Konva.Shape({
        sceneFunc: (ctx) => {
          ctx.beginPath(); ctx.moveTo(q[0], q[1]);
          for (let k = 2; k < q.length; k += 2) ctx.lineTo(q[k], q[k + 1]);
          ctx.closePath();
          ctx.fillStyle = P.danger; ctx.globalAlpha = .34; ctx.fill(); ctx.globalAlpha = 1;
          ctx.strokeStyle = P.danger; ctx.lineWidth = 1.4; ctx.stroke();
        }
      }));
    }

    // 未变形梁底参照
    const ref = [];
    for (let i = 0; i <= 30; i++) ref.push(X(m.L * i / 30), Y(m.underside0));
    LB.add(new Konva.Line({ points: ref, stroke: P.warn, strokeWidth: 1, dash: [5, 5], opacity: .45 }));

    // 腹板中线 + 分段
    const mid = [];
    for (let i = 0; i <= N; i++) { const x = m.L * i / N, v = wex(x); mid.push(X(x), Y((m.beamTop + m.underside0) / 2 - v)); }
    LB.add(new Konva.Line({ points: mid, stroke: P.line2, strokeWidth: .8, opacity: .6 }));
    for (let x = 0.7; x < m.L; x += 0.7) {
      const v = wex(x);
      LB.add(new Konva.Line({ points: [X(x), Y(m.underside0 - v), X(x), Y(m.beamTop - v)], stroke: P.line2, strokeWidth: .7, opacity: .45 }));
    }

    // 吊点
    const narrow = stage.width() < 620;
    for (let i = 0; i < 4; i++) {
      const x = m.xs[i], v = wex(x), R = r.R[i], act = r.active[i];
      const pct = r.total > 0 ? R / r.total * 100 : 0;
      const yT = Y(m.beamTop + .42), yB = Y(m.underside0 - v);
      const col = !act ? P.muted : (i === r.worst ? P.danger : i === r.critical ? P.warn : P.accent);

      LB.add(new Konva.Line({ points: [X(x), yT, X(x), yB], stroke: act ? P.steelTop : P.muted, strokeWidth: 2.2, dash: act ? null : [4, 4], opacity: act ? 1 : .5 }));
      LB.add(new Konva.Rect({ x: X(x) - U(.075), y: yT - 3, width: U(.15), height: 6, fill: P.steel2, cornerRadius: 2 }));
      LB.add(new Konva.Rect({ x: X(x) - U(.10), y: yB - 2, width: U(.20), height: 4, fill: col, cornerRadius: 2 }));
      if (act) {
        const sp = [], n = 7, y0 = yT + (yB - yT) * .16, y1 = yT + (yB - yT) * .56;
        for (let k = 0; k <= n * 2; k++) sp.push(X(x) + (k % 2 ? U(.05) : -U(.05)), y0 + (y1 - y0) * k / (n * 2));
        LB.add(new Konva.Line({ points: sp, stroke: P.accent, strokeWidth: 1.4, opacity: .9, lineJoin: 'round' }));
      }
      // 文本靠内侧排布，反力柱放在另一侧，互不遮挡
      const side = narrow ? [1, 1, -1, 1][i] : (x < m.L / 2 ? 1 : -1);   // 窄屏：3 号向左、其余向右，避开 3/4 挤在一起
      const barX = X(x) - side * 12;
      const bMax = U(0.50);
      const bLen = act ? Math.max(4, bMax * Math.min(1, R / (1.5 * P0))) : 0;
      LB.add(new Konva.Line({ points: [barX, yT - 6, barX, yT - 6 - bLen], stroke: col, strokeWidth: 5, lineCap: 'round', opacity: .9 }));
      LB.add(new Konva.Line({ points: [barX - 5, yT - 6 - bLen, barX + 5, yT - 6 - bLen], stroke: col, strokeWidth: 1.4, opacity: .9 }));
      const tx = narrow ? (side > 0 ? X(x) + 7 : X(x) - 7 - 62) : (side > 0 ? X(x) + 11 : X(x) - 11 - 82);
      const wTxt = narrow ? 62 : 82;
      // 窄屏时相邻吊点标签上下错开，避免相互压字
      const alt = narrow ? (i === 1 || i === 3 ? 14 : 0) : 0;
      const stackTop = Math.max(3, yT - 6 - bLen - (narrow ? 25 : 44) - alt);
      const al = side > 0 ? 'left' : 'right';
      const nm = new Konva.Text({
        text: '吊点 ' + (i + 1), fontSize: narrow ? 8 : 9, fill: narrow ? col : P.muted, width: wTxt, align: al
      });
      nm.x(tx); nm.y(stackTop);
      LB.add(nm);
      const val = new Konva.Text({
        text: act ? R.toFixed(2) : '0.00', fontSize: narrow ? 9.5 : 12,
        fontStyle: 'bold', fill: col, fontFamily: 'ui-monospace,monospace', width: wTxt, align: al
      });
      val.x(tx); val.y(stackTop + (narrow ? 8 : 11));
      LB.add(val);
      if (!narrow) {
        const unit = new Konva.Text({
          text: act ? pct.toFixed(0) + '% · k ' + m.k[i] : '已松弛',
          fontSize: 8.5, fill: P.ink2, width: wTxt, align: al
        });
        unit.x(tx); unit.y(stackTop + 27);
        LB.add(unit);
      }
      if (i === r.worst) {
        LB.add(new Konva.Circle({ x: X(x), y: yB, radius: 5.5, stroke: P.danger, strokeWidth: 1.8, dash: [2, 2] }));
        const wWin = X(windowCenter());
        const wTagSide = Math.abs(X(x) - wWin) < 96 ? (X(x) > wWin ? 'left' : 'right') : (side > 0 ? 'left' : 'right');
        const wTagX = wTagSide === 'left' ? X(x) + 9 : X(x) - 9 - 66;
        const w = new Konva.Text({ text: '▲ 最不利', fontSize: narrow ? 8 : 9.5, fontStyle: 'bold', fill: P.danger, width: narrow ? 56 : 66, align: wTagSide });
        w.x(wTagX); w.y(yB + 13);
        LB.add(w);
      }
    }
    drawDeflStrip();
  }

  function drawDeflStrip() {
    const P = PAL, r = state.r, lim = state.limit / 1000;
    const base = PX.baseline, H = PX.stripH - 40;
    const maxV = Math.max(lim * 1.55, r.peak.v * 1.15, 1e-3);
    const mapV = (v) => base - H * Math.min(1, v / maxV);
    const kx0 = X(0), kx1 = X(m.L);
    const ly = mapV(lim);
    LB.add(new Konva.Line({ points: [kx0, ly, kx1, ly], stroke: P.warn, strokeWidth: 1, dash: [5, 5], opacity: .85 }));
    const ll = new Konva.Text({ text: '限值 ' + state.limit + ' mm', fontSize: 9, fill: P.warn, opacity: .9 });
    ll.x(kx1 - ll.width() - 2); ll.y(ly - 12);
    LB.add(ll);
    const pts = [], red = [];
    for (let i = 0; i <= 200; i++) {
      const x = m.L * i / 200, v = wex(x);
      pts.push(X(x), mapV(v));
      if (v > lim) red.push(X(x), mapV(v));
    }
    LB.add(new Konva.Line({ points: pts, stroke: P.accent, strokeWidth: 1.9, lineJoin: 'round', shadowColor: P.accent, shadowBlur: 6, shadowOpacity: .45 }));
    if (red.length > 3) LB.add(new Konva.Line({ points: red, stroke: P.danger, strokeWidth: 3.2, lineCap: 'round' }));
    for (let i = 0; i < 4; i++) {
      const x = m.xs[i];
      LB.add(new Konva.Line({ points: [X(x), base, X(x), mapV(wex(x))], stroke: i === r.worst ? P.danger : P.steel2, strokeWidth: 1, dash: [2, 3], opacity: .85 }));
      const t = new Konva.Text({ text: (i + 1) + '', fontSize: 8.5, fill: i === r.worst ? P.danger : P.muted, align: 'center', width: 18 });
      t.x(X(x) - 9); t.y(base + 5);
      LB.add(t);
    }
    const px = X(r.peak.x), py = mapV(r.peak.v);
    LB.add(new Konva.Circle({ x: px, y: py, radius: 3.6, fill: r.peak.v > lim ? P.danger : P.accent, stroke: P.panel, strokeWidth: 1.4 }));
    const pkT = new Konva.Text({ text: (r.peak.v * 1000).toFixed(1) + ' mm @ ' + r.peak.x.toFixed(2) + ' m', fontSize: 9.5, fontStyle: 'bold', fill: r.peak.v > lim ? P.danger : P.accent, fontFamily: 'ui-monospace,monospace' });
    pkT.x(Math.min(stage.width() - pkT.width() - 14, px + 7)); pkT.y(py - 15);
    LB.add(pkT);
    for (let x = 0; x <= m.L; x += 1) {
      const t = new Konva.Text({ text: x, fontSize: 8, fill: P.muted, opacity: .5, align: 'center', width: 16 });
      t.x(X(x) - 8); t.y(base + 5);
      LB.add(t);
    }
  }

  /* =============== 演员 =============== */
  function drawActors() {
    LA.destroyChildren();
    const P = PAL, r = state.r;
    for (let i = 0; i < 2; i++) {
      const a = state.actors[i];
      const x = X(a.x);
      const under = SM.underside(m, r, a.x);
      const yGrip = Y(under);
      const yHead = Y(a.feet + m.headH);
      const yFeet = Y(a.feet);
      const taut = ((under - (a.feet + m.headH)) - m.ropeLen) > 0;
      const col = a.slack ? P.warn : P.steel;

      const sag = taut ? 0 : U(.045 + .05 * Math.max(0, Math.min(1, a.feet - m.deckTop)));
      LA.add(new Konva.Line({
        points: [x, yGrip, x + U(.04), (yGrip + yHead) / 2 + sag, x, yHead],
        stroke: taut ? P.accent : P.muted, strokeWidth: taut ? 1.6 : 1.1,
        dash: taut ? null : [4, 4], tension: .3
      }));
      LA.add(new Konva.Circle({ x: x, y: yGrip, radius: 2.8, fill: P.panel, stroke: taut ? P.accent : P.muted, strokeWidth: 1.2 }));

      const g = new Konva.Group({ name: 'actor' });
      const bh = yFeet - yHead;
      const bw = Math.min(U(.30), bh * .30);
      g.add(new Konva.Circle({ x: x, y: yHead + bh * .085, radius: bh * .062, fill: col }));
      g.add(new Konva.Rect({ x: x - bw / 2, y: yHead + bh * .155, width: bw, height: bh * .47, fill: col, opacity: .76, cornerRadius: Math.min(6, bw / 2) }));
      g.add(new Konva.Line({ points: [x - bw * .44, yHead + bh * .22, x - bw * .12, yHead + bh * .02], stroke: col, strokeWidth: 2.6, lineCap: 'round' }));
      g.add(new Konva.Line({ points: [x + bw * .44, yHead + bh * .22, x + bw * .12, yHead + bh * .02], stroke: col, strokeWidth: 2.6, lineCap: 'round' }));
      g.add(new Konva.Line({ points: [x - bw * .20, yHead + bh * .62, x - bw * .28, yFeet], stroke: col, strokeWidth: 3.2, lineCap: 'round' }));
      g.add(new Konva.Line({ points: [x + bw * .20, yHead + bh * .62, x + bw * .28, yFeet], stroke: col, strokeWidth: 3.2, lineCap: 'round' }));
      g.add(new Konva.Line({ points: [x - bw * .44, yFeet, x + bw * .44, yFeet], stroke: col, strokeWidth: 2.6, lineCap: 'round', opacity: .8 }));

      const narrow = stage.width() < 620;
      const lab = new Konva.Text({
        text: narrow ? ['甲', '乙'][i] : ['甲', '乙'][i] + ' · ' + a.x.toFixed(2) + ' m',
        fontSize: narrow ? 8 : 9.5, fill: P.ink2, align: 'center', width: narrow ? 24 : 100, opacity: .95
      });
      lab.x(x - (narrow ? 12 : 50)); lab.y(yFeet + 3 + (narrow ? i * 10 : 7));
      g.add(lab);
      if (!taut) {
        const s = new Konva.Text({ text: '绳松弛', fontSize: 8.5, fill: P.warn, align: 'center', width: 60 });
        s.x(x - 30); s.y(yHead - 13);
        g.add(s);
      }
      const hit = new Konva.Rect({ x: x - 24, y: yHead - 10, width: 48, height: bh + 20, fill: 'rgba(0,0,0,0.002)' });
      g.add(hit);
      g.on('mousedown touchstart', (ev) => { if (!state.playing) { beginDrag(i); ev.cancelBubble = true; } });
      g.on('mouseenter', () => { if (!state.playing) stage.container().style.cursor = 'grab'; });
      g.on('mouseleave', () => { stage.container().style.cursor = ''; });
      LA.add(g);
    }
  }

  /* =============== 剖切 + 抛接窗口 =============== */
  function drawSection() {
    LC.destroyChildren();
    const P = PAL, r = state.r;
    const xs = state.sliceX;
    const under = SM.underside(m, r, xs);
    const clearV = under - m.matTop;
    const need = m.requiredClear;
    const bad = clearV < need;
    const col = bad ? P.danger : P.ok;
    const vS0 = wex(xs);
    const sx = X(xs), yTop = Y(m.underside0 - vS0), yFloor = Y(0);

    // 切面
    LC.add(new Konva.Rect({ x: sx - 3, y: yTop, width: 6, height: yFloor - yTop, fill: P.accent, opacity: .10 }));
    LC.add(new Konva.Line({ points: [sx - 3, yTop, sx - 3, yFloor], stroke: P.accent, strokeWidth: 1, opacity: .55 }));
    LC.add(new Konva.Line({ points: [sx + 3, yTop, sx + 3, yFloor], stroke: P.accent, strokeWidth: 1, opacity: .55 }));
    for (let yy = yTop + 12; yy < yFloor; yy += 14) {
      LC.add(new Konva.Line({ points: [sx - 3, yy, sx + 3, yy - 7], stroke: P.accent, strokeWidth: .8, opacity: .4 }));
    }
    // 梁截面
    const vS = wex(xs);
    const ybT = Y(m.beamTop - vS), ybB = Y(m.underside0 - vS);
    LC.add(new Konva.Rect({ x: sx - U(.10), y: ybT, width: U(.20), height: ybB - ybT, fill: P.steel, stroke: P.steelTop, strokeWidth: 1 }));

    // 窗口就在旁边时不重复画尺寸线，避免两套读数叠在一起
    const winNear = Math.abs(sx - X(windowCenter())) < 140;
    // 净空尺寸线：梁底 -> 正下方的承载面（垫区内为垫面，其余为台面）
    const inMat = xs >= 2.42 + 0.06 && xs <= 5.98 - 0.06;
    const surfaceY = inMat ? m.matTop : m.deckTop;
    const clearHere = under - surfaceY;
    const yA = ybB;
    const yB = Math.max(Y(surfaceY), yA + 8);
    const dimX = sx + 12;
    const dimCol = (inMat && clearHere < need) ? P.danger : P.accent;
    if (!winNear) LC.add(new Konva.Line({ points: [dimX, yA, dimX, yB], stroke: dimCol, strokeWidth: 1.2 }));
    if (!winNear) {
      LC.add(new Konva.Line({ points: [dimX - 5, yA, dimX + 5, yA], stroke: dimCol, strokeWidth: 1.2 }));
      LC.add(new Konva.Line({ points: [dimX - 5, yB, dimX + 5, yB], stroke: dimCol, strokeWidth: 1.2 }));
      LC.add(new Konva.Line({ points: [dimX - 3, yA + 8, dimX, yA + 2, dimX + 3, yA + 8], stroke: dimCol, strokeWidth: 1.2 }));
      LC.add(new Konva.Line({ points: [dimX - 3, yB - 8, dimX, yB - 2, dimX + 3, yB - 8], stroke: dimCol, strokeWidth: 1.2 }));
      const dimTxt = new Konva.Text({ text: (clearHere * 100).toFixed(1) + ' cm', fontSize: 12, fontStyle: 'bold', fill: dimCol, fontFamily: 'ui-monospace,monospace' });
      dimTxt.x(dimX + 9); dimTxt.y((yA + yB) / 2 - 8);
      LC.add(dimTxt);
      const slab = new Konva.Text({ text: inMat ? '至垫面' : '至台面', fontSize: 9, fill: P.muted });
      slab.x(dimX + 9); slab.y((yA + yB) / 2 + 7);
      LC.add(slab);
    }

    // 垫区内：需求高度线 + 不足部分涂红
    if (inMat) {
      const yNeed = Y(m.matTop + need);
      LC.add(new Konva.Line({ points: [sx - 26, yNeed, sx + 26, yNeed], stroke: P.warn, strokeWidth: 1, dash: [4, 4], opacity: .8 }));
      const shortBy = need - clearHere;
      if (shortBy > 0 && !winNear) {
        LC.add(new Konva.Rect({ x: sx - 22, y: ybB, width: 44, height: Math.max(0, yNeed - ybB), fill: P.danger, opacity: .16 }));
        const lb = new Konva.Text({ text: '缺 ' + (shortBy * 100).toFixed(0) + ' cm', fontSize: 9, fontStyle: 'bold', fill: P.danger });
        lb.x(dimX + 9); lb.y(yB + 5);
        LC.add(lb);
      }
    }
    const footY = Y(0) + 7;
    const chipW = 76;
    const chipX = Math.max(10, sx - chipW - 8);
    const tagBg = new Konva.Rect({ x: chipX, y: footY, width: chipW, height: 15, fill: P.panel, opacity: .94, stroke: P.accent, strokeWidth: .8, cornerRadius: 4 });
    LC.add(tagBg);
    const tag = new Konva.Text({ text: '剖切 ' + xs.toFixed(2) + ' m', fontSize: 9, fill: P.accent, align: 'center', width: chipW });
    tag.x(chipX); tag.y(footY + 2);
    LC.add(tag);

    // ---- 抛接窗口 ----
    const winX = windowCenter();
    const uW = SM.underside(m, r, winX);
    const cW = uW - m.matTop;
    const badW = cW < need;
    const wcol = badW ? P.danger : P.ok;
    const wx = X(winX), wTop = Y(uW), wBot = Y(m.matTop);
    const wh = Math.max(U(.36), 42);
    LC.add(new Konva.Rect({ x: wx - wh, y: wTop, width: wh * 2, height: wBot - wTop, fill: wcol, opacity: .08, stroke: wcol, strokeWidth: 1.4, radius: 4, cornerRadius: 6 }));
    // 读数放在窗口右侧，避让人物
    const chipW2 = stage.width() < 620 ? 76 : 86;
    const chipX2 = Math.min(stage.width() - chipW2 - 8, wx + wh + 8);
    const chipY2 = wTop + 4;
    LC.add(new Konva.Rect({ x: chipX2, y: chipY2, width: chipW2, height: 34, fill: P.panel, opacity: .95, stroke: wcol, strokeWidth: 1, cornerRadius: 6 }));
    const wv = new Konva.Text({ text: (cW * 100).toFixed(1) + ' cm', fontSize: stage.width() < 620 ? 11 : 12.5, fontStyle: 'bold', fill: wcol, fontFamily: 'ui-monospace,monospace', align: 'center', width: chipW2 });
    wv.x(chipX2); wv.y(chipY2 + 3);
    LC.add(wv);
    const ws = new Konva.Text({ text: badW ? '净空不足' : '净空足够', fontSize: 8.5, fill: wcol, align: 'center', width: chipW2, opacity: .95 });
    ws.x(chipX2); ws.y(chipY2 + 19);
    LC.add(ws);
    const winTrack = Math.abs(winX - m.catchX) > 0.12;
    if (winTrack) {
      LC.add(new Konva.Line({ points: [X(m.catchX), wTop + 30, wx, wTop + 30], stroke: wcol, strokeWidth: 1, dash: [3, 4], opacity: .5 }));
    }
    {
      const txt = winTrack ? '窗口 → ' + winX.toFixed(2) + ' m' : '抛接窗口';
      const tw = new Konva.Text({ text: txt, fontSize: 9, fill: wcol, align: 'center', width: wh * 2 - 8, opacity: .95 });
      tw.x(wx - wh + 4); tw.y(wTop + 4);
      LC.add(tw);
    }
  }

  // 抛接窗口：静止时固定在 m.catchX；只有真正被抛起（离静止位 > 0.2 m）的演员才会带走窗口
  function windowCenter() {
    for (const a of state.actors) {
      const rest = a.restFeet == null ? a.feet : a.restFeet;
      if (a.thrown || a.slack || a.feet > rest + 0.18) {
        return Math.min(m.L - 0.12, Math.max(0.12, a.x));
      }
    }
    return m.catchX;
  }

  /* =============== 交互 =============== */
  function beginDrag(i) {
    state.dragIdx = i;
    stage.container().style.cursor = 'grabbing';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
  }
  function onMove(ev) {
    if (state.dragIdx < 0) return;
    if (ev.cancelable && ev.type === 'touchmove') ev.preventDefault();
    const p = stage.getPointerPosition();
    if (!p) return;
    const wx = Math.max(0.05, Math.min(m.L - 0.05, (p.x - PX.ox) / PX.s));
    state.actors[state.dragIdx].x = wx;
    reseat(false);
  }
  function endDrag() {
    if (state.dragIdx < 0) return;
    state.dragIdx = -1;
    stage.container().style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', endDrag);
    window.removeEventListener('touchend', endDrag);
    reseat(true);
  }

  /* =============== 重算 =============== */
  function reseat(doSettle) {
    if (!state.r) { state.r = SM.solve(m, state.actors.map((a) => ({ x: a.x, P: P0 }))); }
    if (doSettle) {
      SM.settle(m, state.actors, 10);
    } else {
      state.actors.forEach((a) => {
        a.T = P0; a.v = 0; a.slack = false; a.thrown = false;
        a.feet = SM.underside(m, state.r, a.x) - m.headH - m.ropeLen;
      });
    }
    state.r = SM.solve(m, state.actors.map((a) => ({ x: a.x, P: a.T })));
    drawBeam(); drawSection(); drawActors(); updateUI(); drawChart();
  }

  /* =============== UI =============== */
  function updateUI() {
    const r = state.r, lim = state.limit;
    const pk = r.peak.v * 1000;
    $('hudPeak').textContent = pk.toFixed(1);
    $('hudPeakAt').textContent = r.peak.x.toFixed(2);
    $('hudWorst').textContent = '#' + (r.worst + 1);

    let html = '';
    for (let i = 0; i < 4; i++) {
      const R = r.R[i], pct = r.total > 0 ? R / r.total * 100 : 0;
      const defl = R / m.k[i] * 1000;
      const cls = !r.active[i] ? 'off' : (i === r.worst ? 'worst' : (i === r.critical ? 'crit' : ''));
      const badge = !r.active[i] ? '<span class="badge grey">松弛</span>'
        : i === r.worst ? '<span class="badge red">最不利</span>'
        : i === r.critical ? '<span class="badge amber">位移最大</span>' : '<span class="badge teal">正常</span>';
      html += `<div class="sup ${cls}">` +
        `<div class="supTop"><span class="supName">吊点 ${i + 1}</span><span class="supX mono">x=${m.xs[i].toFixed(2)} m</span>${badge}</div>` +
        `<div class="supMain"><b class="mono">${R.toFixed(3)}</b><span class="unit">kN</span><span class="pct mono">${pct.toFixed(1)}%</span></div>` +
        `<div class="meter"><span class="fill${cls === 'worst' ? ' bad' : ''}" style="width:${Math.min(100, pct * 1.6)}%"></span></div>` +
        `<div class="supFoot mono">k=${m.k[i]} kN/m · 吊点位移 ${defl.toFixed(1)} mm</div></div>`;
    }
    $('supportList').innerHTML = html;

    const avg = r.total / 4;
    let wi = 0;
    for (let i = 1; i < 4; i++) if (Math.abs(r.R[i] - avg) > Math.abs(r.R[wi] - avg)) wi = i;
    $('avgNote').innerHTML = `平均分配：每点 <b class="mono">${avg.toFixed(3)} kN</b>；按刚度分配后最大偏差 <b class="mono">${(Math.abs(r.R[wi] - avg) / avg * 100).toFixed(0)}%</b>（吊点 ${wi + 1}）。` +
      (r.R[3] === Math.max(...r.R) ? ' <span class="badge red">远端吊点已翻转</span>' : '');
    $('balance').textContent = Math.abs(r.sumR - r.total) < 0.02 ? 'ΣR = W ✓' : 'Δ ' + (r.sumR - r.total).toFixed(3);
    $('balance').className = 'badge ' + (Math.abs(r.sumR - r.total) < 0.02 ? 'teal' : 'red');

    const over = pk > lim;
    $('peakVal').textContent = pk.toFixed(1);
    $('peakAt').textContent = r.peak.x.toFixed(2);
    const bar = $('peakBar');
    bar.style.width = Math.min(100, pk / lim * 100) + '%';
    bar.className = 'fill' + (over ? ' bad' : '');
    $('limitTag').textContent = lim;
    $('peakBand').textContent = redRange();

    const under = SM.underside(m, r, windowCenter());
    const clear = (under - m.matTop) * 100;
    const need = m.requiredClear * 100;
    $('clearVal').textContent = clear.toFixed(1);
    $('needVal').textContent = Math.round(need);
    const cb = $('clearBar');
    cb.style.width = Math.min(100, clear / need * 100) + '%';
    cb.className = 'fill' + (clear < need ? ' bad' : '');
    $('clearTag').textContent = clear < need ? '不足 ' + (need - clear).toFixed(1) + ' cm' : '满足';
    $('clearTag').className = 'badge ' + (clear < need ? 'red' : 'teal');
    $('hudWin').textContent = clear.toFixed(0);
    $('hudWinBadge').textContent = clear < need ? '不足' : 'OK';
    $('hudWinBadge').className = 'badge ' + (clear < need ? 'red' : 'teal');
    $('hudSum').textContent = r.sumR.toFixed(2) + ' / ' + r.total.toFixed(2);
    $('sliceVal').textContent = state.sliceX.toFixed(2) + ' m';
    if ($('detailPanel').classList.contains('open')) drawDetail();
  }

  function redRange() {
    const over = [];
    for (let i = 0; i <= 400; i++) {
      const x = m.L * i / 400;
      if (state.r.vAt(x) * 1000 > state.limit) over.push(x);
    }
    if (!over.length) return '无';
    let s = over[0], e = over[0], parts = [];
    for (let i = 1; i < over.length; i++) {
      if (over[i] - e > 0.04) { parts.push([s, e]); s = over[i]; }
      e = over[i];
    }
    parts.push([s, e]);
    return parts.map(([a, b]) => a.toFixed(1) + '–' + b.toFixed(1)).join(' / ') + ' m';
  }

  /* =============== 曲线图 =============== */
  function drawChart() {
    const el = $('mainChart'); if (!el) return;
    const P = PAL, r = state.r;
    const w = el.clientWidth || 300, h = 132, padL = 26, padR = 10, padT = 10, padB = 20;
    const maxV = Math.max(state.limit / 1000 * 1.3, r.peak.v * 1.12, 1e-4);
    const mx = (x) => padL + (w - padL - padR) * x / m.L;
    const my = (v) => h - padB - (h - padT - padB) * v / maxV;
    let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="挠度曲线">`;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (h - padT - padB) * i / 4;
      s += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${P.muted}" stroke-opacity=".16"/>`;
    }
    s += `<line x1="${padL}" y1="${my(state.limit / 1000)}" x2="${w - padR}" y2="${my(state.limit / 1000)}" stroke="${P.warn}" stroke-dasharray="4 4"/>`;
    s += `<text x="${w - padR}" y="${my(state.limit / 1000) - 3}" text-anchor="end" font-size="8" fill="${P.warn}">限值 ${state.limit}</text>`;
    let path = '', red = '', open = false;
    for (let i = 0; i <= 160; i++) {
      const x = m.L * i / 160, v = r.vAt(x);
      path += (i ? 'L' : 'M') + mx(x).toFixed(1) + ',' + my(v).toFixed(1);
      if (v * 1000 > state.limit) { red += (open ? 'L' : 'M') + mx(x).toFixed(1) + ',' + my(v).toFixed(1); open = true; } else open = false;
    }
    s += `<path d="${path}" fill="none" stroke="${P.accent}" stroke-width="1.7"/>`;
    if (red) s += `<path d="${red}" fill="none" stroke="${P.danger}" stroke-width="3"/>`;
    for (let i = 0; i < 4; i++) {
      const x = mx(m.xs[i]), y = my(r.vAt(m.xs[i]));
      s += `<line x1="${x}" y1="${h - padB}" x2="${x}" y2="${y}" stroke="${P.steel2}" stroke-dasharray="2 3" opacity=".8"/>`;
      s += `<circle cx="${x}" cy="${y}" r="2.4" fill="${i === r.worst ? P.danger : P.accent}"/>`;
      s += `<text x="${x}" y="${h - 6}" text-anchor="middle" font-size="8" fill="${P.muted}">${i + 1}</text>`;
    }
    const px = mx(r.peak.x), py = my(r.peak.v);
    s += `<circle cx="${px}" cy="${py}" r="3.2" fill="${r.peak.v * 1000 > state.limit ? P.danger : P.accent}"/>`;
    s += `<text x="${px > w * .6 ? px - 6 : px + 6}" y="${py - 4}" text-anchor="${px > w * .6 ? 'end' : 'start'}" font-size="8.5" fill="${r.peak.v * 1000 > state.limit ? P.danger : P.accent}">${(r.peak.v * 1000).toFixed(1)} @ ${r.peak.x.toFixed(2)}</text>`;
    s += '</svg>';
    el.innerHTML = s;
  }

  function drawDetail() {
    const el = $('detailChart'); if (!el) return;
    const P = PAL, r = state.r;
    const w = Math.max(280, el.clientWidth || 300), h = 210, padL = 36, padR = 12, padT = 14, padB = 24;
    const maxV = Math.max(state.limit / 1000 * 1.2, r.peak.v * 1.12, 1e-4);
    const mx = (x) => padL + (w - padL - padR) * x / m.L;
    const my = (v) => h - padB - (h - padT - padB) * v / maxV;
    let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="挠度曲线详图">`;
    for (let i = 0; i <= 5; i++) {
      const v = maxV * i / 5, y = my(v);
      s += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${P.muted}" stroke-opacity=".15"/>`;
      s += `<text x="${padL - 5}" y="${y + 3}" text-anchor="end" font-size="7.5" fill="${P.muted}">${(v * 1000).toFixed(0)}</text>`;
    }
    s += `<line x1="${padL}" y1="${my(state.limit / 1000)}" x2="${w - padR}" y2="${my(state.limit / 1000)}" stroke="${P.warn}" stroke-dasharray="4 4"/>`;
    let path = '', red = '', open = false;
    for (let i = 0; i <= 200; i++) {
      const x = m.L * i / 200, v = r.vAt(x);
      path += (i ? 'L' : 'M') + mx(x).toFixed(1) + ',' + my(v).toFixed(1);
      if (v * 1000 > state.limit) { red += (open ? 'L' : 'M') + mx(x).toFixed(1) + ',' + my(v).toFixed(1); open = true; } else open = false;
    }
    s += `<path d="${path}" fill="none" stroke="${P.accent}" stroke-width="1.9"/>`;
    if (red) s += `<path d="${red}" fill="none" stroke="${P.danger}" stroke-width="3.4"/>`;
    for (let i = 0; i < 4; i++) {
      const x = mx(m.xs[i]), y = my(r.vAt(m.xs[i]));
      s += `<line x1="${x}" y1="${h - padB}" x2="${x}" y2="${y}" stroke="${P.steel2}" stroke-dasharray="2 3" opacity=".8"/>`;
      s += `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="8" fill="${P.muted}">吊${i + 1}</text>`;
    }
    const px = mx(r.peak.x), py = my(r.peak.v);
    s += `<circle cx="${px}" cy="${py}" r="3.8" fill="${P.danger}"/>`;
    s += `<text x="${Math.min(w - 96, px + 7)}" y="${py - 6}" font-size="9" fill="${P.danger}">峰值 ${(r.peak.v * 1000).toFixed(1)} mm @ ${r.peak.x.toFixed(2)} m</text>`;
    s += '</svg>';
    el.innerHTML = s;
  }

  /* =============== 抛接动画 =============== */
  let raf = null, last = 0;
  function tick(ts) {
    if (!state.playing) return;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 1 / 60);
    last = ts;
    state.accum += dt;
    let guard = 0;
    while (state.accum >= 1 / 60 && guard++ < 8) {
      const before = state.actors[1].x;
      SM.stepDynamics(m, state.actors, 1 / 60, 16);
      const b = state.actors[1];
      // 顶到梁：封顶，不再上冲
      const under = SM.underside(m, state.r, b.x);
      if (b.feet + m.headH > under - 0.02) {
        b.feet = under - 0.02 - m.headH;
        if (b.v > 0) b.v = 0;
      }
      // 到达抛接窗口：被接住，横向停住
      if (!b.caught && ((before - m.catchX) * (b.x - m.catchX) <= 0 || (b.v <= 0 && Math.abs(b.x - m.catchX) < 0.30))) {
        b.x = m.catchX; b.vx = 0; b.caught = true;
      }
      state.accum -= 1 / 60;
    }
    state.r = SM.solve(m, state.actors.map((a) => ({ x: a.x, P: a.T })));
    state.t += dt;
    drawBeam(); drawSection(); drawActors(); updateUI(); drawChart();
    if (state.t > 4.8) { finishThrow(); return; }
    raf = requestAnimationFrame(tick);
  }
  function startThrow() {
    if (state.playing) return;
    SM.settle(m, state.actors, 10);
    state.r = SM.solve(m, state.actors.map((a) => ({ x: a.x, P: a.T })));
    const b = state.actors[1];
    b.slack = true; b.thrown = true; b.caught = false;
    const apex = 1.05;
    b.v = Math.sqrt(2 * SM.G * apex);
    const tApex = b.v / SM.G;
    const dx = m.catchX - b.x;
    b.vx = Math.max(-6.5, Math.min(6.5, dx / tApex));
    state.playing = true; state.t = 0; state.accum = 0; last = 0;
    $('btnThrow').classList.add('on');
    raf = requestAnimationFrame(tick);
    toast('把乙抛向窗口：窗口跟过去，注意梁下垂吃掉多少净空');
  }
  function finishThrow() {
    state.playing = false;
    if (raf) cancelAnimationFrame(raf);
    $('btnThrow').classList.remove('on');
    state.actors[1].v = 0; state.actors[1].vx = 0;
    SM.settle(m, state.actors, 10);
    reseat(true);
  }

  /* =============== 按钮 / 滑块 =============== */
  function applyPreset() {
    if (state.playing) finishThrow();
    state.actors[0].x = 0.98;
    state.actors[1].x = 1.84;
    state.sliceX = 3.20;
    $('slice').value = Math.round(state.sliceX / m.L * 100);
    reseat(true);
    toast('偏载布局：两人挤在左端。把乙拖过 7.8 m，看吊点 4 翻转为最大。');
  }
  function applySymmetric() {
    if (state.playing) finishThrow();
    state.actors[0].x = 3.30;
    state.actors[1].x = 4.50;
    state.sliceX = 3.20;
    $('slice').value = Math.round(state.sliceX / m.L * 100);
    reseat(true);
    toast('中跨重载：峰值 128 mm 超限，窗口净空掉到 293 cm');
  }
  $('btnSym').addEventListener('click', applySymmetric);

  $('btnThrow').addEventListener('click', startThrow);
  $('btnStop').addEventListener('click', () => { if (state.playing) finishThrow(); SM.settle(m, state.actors, 10); reseat(true); toast('已复位'); });
  $('presetBtn').addEventListener('click', applyPreset);

  const sliceEl = $('slice');
  sliceEl.addEventListener('input', () => {
    state.sliceX = +sliceEl.value / 100 * m.L;
    drawSection(); updateUI();
  });
  const limEl = $('limit');
  limEl.value = state.limit;
  $('limitVal').textContent = state.limit;
  limEl.addEventListener('input', () => {
    state.limit = Math.max(10, Math.min(200, +limEl.value));
    $('limitVal').textContent = state.limit;
    drawBeam(); drawSection(); updateUI(); drawChart();
  });
  const kEl = $('kScale');
  kEl.addEventListener('input', () => {
    m.kScale = +kEl.value / 100;
    $('kScaleVal').textContent = m.kScale.toFixed(2) + '×';
    reseat(true);
  });
  $('btnDetail').addEventListener('click', () => {
    const p = $('detailPanel'), on = p.classList.toggle('open');
    $('btnDetail').setAttribute('aria-expanded', on ? 'true' : 'false');
    $('btnDetail').textContent = on ? '收起' : '展开';
    if (on) drawDetail();
  });

  /* =============== toast =============== */
  let tT = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* =============== 尺寸 =============== */
  let rz = null;
  function resize() {
    const w = stagewrap.clientWidth, h = stagewrap.clientHeight;
    if (!w || !h) return;
    stage.width(w); stage.height(h);
    layout();
    drawBG(); drawBeam(); drawSection(); drawActors(); updateUI(); drawChart();
  }
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(resize, 70); });

  /* =============== 启动 =============== */
  function boot() {
    layout();
    stage.width(stagewrap.clientWidth || 800);
    stage.height(stagewrap.clientHeight || 460);
    SM.settle(m, state.actors, 10);
    state.r = SM.solve(m, state.actors.map((a) => ({ x: a.x, P: a.T })));
    sliceEl.value = Math.round(state.sliceX / m.L * 100);
    drawBG(); drawBeam(); drawSection(); drawActors(); updateUI(); drawChart();
  }
  boot();
  setTimeout(() => { resize(); if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(resize, 70); }).observe(stagewrap); }, 40);
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'r' || e.key === 'R') { applyPreset(); return; }
    if (e.key === ' ') { e.preventDefault(); startThrow(); }
  });
  window.__stage = { m, state, SM, reseat, drawBG, drawBeam, drawSection, drawActors, updateUI, layout, resize, applyPreset, finishThrow, PX, X, Y, U };
})();
