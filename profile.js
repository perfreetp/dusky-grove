import {
  HORIZONS, TARGET_INDEX, D_MAX, clamp, lerp,
  amplitudeAt, branchDepth, countTrackedHorizons,
  faultDepthAtY, faultYAtDepth, profileCoordinate, profileRange
} from './model.js';

let W = 460, H = 340;
const M = { l: 50, r: 14, t: 16, b: 42 };
let PW = W - M.l - M.r;
let PH = H - M.t - M.b;
const AMP_W = 520, AMP_H = 380;
const AMP_GAIN = 1.18;

function makeColorLUT() {
  const stops = [
    [0.00, [20, 40, 120]],
    [0.24, [37, 99, 235]],
    [0.43, [125, 211, 252]],
    [0.50, [248, 250, 252]],
    [0.57, [253, 230, 138]],
    [0.78, [249, 115, 22]],
    [1.00, [153, 27, 27]]
  ];
  const lut = new Uint8Array(512 * 3);
  for (let i = 0; i < 512; i++) {
    const t = i / 511;
    let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
    lut[i * 3] = Math.round(lerp(a[1][0], b[1][0], k));
    lut[i * 3 + 1] = Math.round(lerp(a[1][1], b[1][1], k));
    lut[i * 3 + 2] = Math.round(lerp(a[1][2], b[1][2], k));
  }
  return lut;
}

export function createProfileView(canvas, tip, config) {
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(280, rect.width || canvas.parentElement?.clientWidth || 420);
    H = Math.max(280, canvas.clientHeight || rect.height || 340);
    PW = W - M.l - M.r;
    PH = H - M.t - M.b;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();

  const lut = makeColorLUT();

  const ampCanvas = document.createElement('canvas');
  ampCanvas.width = AMP_W;
  ampCanvas.height = AMP_H;
  const ampCtx = ampCanvas.getContext('2d');
  const ampImage = ampCtx.createImageData(AMP_W, AMP_H);

  let hover = null;

  const xPix = u => {
    const r = profileRange(config.getMode());
    return M.l + (u - r.min) / (r.max - r.min) * PW;
  };
  const yPix = d => M.t + clamp(d / D_MAX, 0, 1) * PH;

  function renderAmplitude() {
    const mode = config.getMode();
    const fixed = config.getSlice();
    const thr = config.getThrow();
    const range = profileRange(mode);
    const data = ampImage.data;
    let p = 0;

    for (let py = 0; py < AMP_H; py++) {
      const d = (py + 0.5) / AMP_H * D_MAX;
      for (let px = 0; px < AMP_W; px++) {
        const u = lerp(range.min, range.max, (px + 0.5) / AMP_W);
        const q = profileCoordinate(mode, u, fixed);
        const a = amplitudeAt(q.x, q.y, d, thr);
        const id = Math.round((clamp(a / AMP_GAIN, -1, 1) + 1) * 0.5 * 511);
        const c = id * 3;
        data[p++] = lut[c];
        data[p++] = lut[c + 1];
        data[p++] = lut[c + 2];
        data[p++] = 255;
      }
    }
    ampCtx.putImageData(ampImage, 0, 0);
  }

  function drawAxes() {
    const range = profileRange(config.getMode());
    ctx.save();
    ctx.font = '600 11.5px system-ui, sans-serif';
    ctx.lineWidth = 1;

    // Plot frame and depth grid.
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(M.l, M.t, PW, PH);

    ctx.strokeStyle = 'rgba(100,116,139,.22)';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let d = 0; d <= 5; d++) {
      const y = yPix(d);
      ctx.beginPath();
      ctx.moveTo(M.l, y);
      ctx.lineTo(M.l + PW, y);
      ctx.stroke();
      ctx.fillText(String(d), M.l - 10, y);
    }

    const span = range.max - range.min;
    const step = config.getMode() === 'dip' ? 1.5 : 2.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const start = Math.ceil(range.min / step) * step;
    for (let u = start; u <= range.max + 1e-6; u += step) {
      const x = xPix(u);
      ctx.strokeStyle = 'rgba(100,116,139,.16)';
      ctx.beginPath();
      ctx.moveTo(x, M.t);
      ctx.lineTo(x, M.t + PH);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(u.toFixed(u % 1 ? 1 : 0), x, M.t + PH + 9);
    }

    ctx.fillStyle = '#334155';
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(range.label, M.l + PW / 2, H - 8);

    ctx.save();
    ctx.translate(17, M.t + PH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('深度 (km)', 0, 0);
    ctx.restore();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(M.l + 0.5, M.t + 0.5, PW - 1, PH - 1);
    ctx.restore();
  }

  function drawHorizon(i, target = false) {
    const mode = config.getMode();
    const fixed = config.getSlice();
    const thr = config.getThrow();
    const range = profileRange(mode);
    const N = 300;

    const drawSide = side => {
      let open = false;
      ctx.beginPath();
      for (let k = 0; k <= N; k++) {
        const u = lerp(range.min, range.max, k / N);
        const q = profileCoordinate(mode, u, fixed);
        const b = branchDepth(i, q.x, q.y, side, thr);
        const fDepth = faultDepthAtY(q.y);
        const valid = b.weight > 0.16 && b.depth >= -0.25 && b.depth <= D_MAX + 0.25 &&
          (side === 1 ? b.depth <= fDepth + 0.012 : b.depth >= fDepth - 0.012);
        if (valid) {
          const x = xPix(u), y = yPix(b.depth);
          if (!open) { ctx.moveTo(x, y); open = true; }
          else ctx.lineTo(x, y);
        } else {
          open = false;
        }
      }
      if (target) {
        ctx.strokeStyle = 'rgba(30,20,5,.72)';
        ctx.lineWidth = 4.2;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2.1;
        ctx.setLineDash([8, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(15,23,42,.42)';
        ctx.lineWidth = 1.15;
        ctx.setLineDash([]);
        ctx.stroke();
      }
    };
    drawSide(1);
    drawSide(-1);
  }

  function drawFault() {
    const mode = config.getMode();
    const fixed = config.getSlice();
    ctx.save();
    ctx.beginPath();
    if (mode === 'dip') {
      ctx.moveTo(xPix(faultYAtDepth(0)), yPix(0));
      ctx.lineTo(xPix(faultYAtDepth(D_MAX)), yPix(D_MAX));
    } else {
      const d = faultDepthAtY(fixed);
      if (d >= 0 && d <= D_MAX) {
        ctx.moveTo(M.l, yPix(d));
        ctx.lineTo(M.l + PW, yPix(d));
      }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.82)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(153,27,27,.96)';
    ctx.lineWidth = 3.2;
    ctx.setLineDash([11, 7]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#991b1b';
    ctx.font = '900 15px system-ui, sans-serif';
    if (mode === 'dip') {
      const lx = xPix(faultYAtDepth(0.72)) + 9;
      const ly = yPix(0.72) - 7;
      ctx.fillText('F', lx, ly);
    } else {
      const d = faultDepthAtY(fixed);
      if (d >= 0 && d <= D_MAX) ctx.fillText('F 断层迹线', M.l + 10, yPix(d) - 8);
    }
    ctx.restore();
  }

  function drawHover() {
    if (!hover) return;
    const { cx, cy, u, d } = hover;
    ctx.save();
    ctx.strokeStyle = 'rgba(15,23,42,.58)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, M.t); ctx.lineTo(cx, M.t + PH);
    ctx.moveTo(M.l, cy); ctx.lineTo(M.l + PW, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawAxes();
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.l, M.t, PW, PH);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ampCanvas, M.l, M.t, PW, PH);
    HORIZONS.forEach((_, i) => drawHorizon(i, i === TARGET_INDEX));
    drawFault();
    drawHover();
    ctx.restore();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(M.l + 0.5, M.t + 0.5, PW - 1, PH - 1);
  }

  function eventToProfile(event) {
    const rect = canvas.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    if (cx < M.l || cx > M.l + PW || cy < M.t || cy > M.t + PH) return null;
    const range = profileRange(config.getMode());
    const u = range.min + (cx - M.l) / PW * (range.max - range.min);
    const d = (cy - M.t) / PH * D_MAX;
    return { cx, cy, u, d: clamp(d, 0, D_MAX) };
  }

  function placeTip(event, p) {
    const wrap = tip.parentElement;
    const rect = wrap.getBoundingClientRect();
    const q = profileCoordinate(config.getMode(), p.u, config.getSlice());
    const a = amplitudeAt(q.x, q.y, p.d, config.getThrow());
    tip.innerHTML = `
      <div class="tip-row"><span>层位深度</span><b>${p.d.toFixed(2)} km</b></div>
      <div class="tip-row"><span>振幅</span><b class="${a >= 0 ? 'warm' : 'cool'}">${a >= 0 ? '+' : ''}${a.toFixed(2)}</b></div>`;
    tip.hidden = false;
    tip.style.visibility = 'hidden';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = event.clientX - rect.left + 16;
    let top = event.clientY - rect.top + 16;
    if (left + tw + 10 > rect.width) left = event.clientX - rect.left - tw - 12;
    if (top + th + 10 > rect.height) top = event.clientY - rect.top - th - 12;
    tip.style.left = `${Math.max(6, left)}px`;
    tip.style.top = `${Math.max(6, top)}px`;
    tip.style.visibility = 'visible';
  }

  canvas.addEventListener('pointermove', event => {
    const p = eventToProfile(event);
    if (!p) {
      if (hover) { hover = null; draw(); }
      tip.hidden = true;
      return;
    }
    hover = p;
    placeTip(event, p);
    draw();
  });

  canvas.addEventListener('pointerleave', () => {
    hover = null;
    tip.hidden = true;
    draw();
  });

  new ResizeObserver(() => {
    resizeCanvas();
    draw();
  }).observe(canvas);

  return {
    ampCanvas,
    renderAmplitude,
    draw,
    update() { renderAmplitude(); draw(); },
    layerCount() { return countTrackedHorizons(config.getMode(), config.getSlice(), config.getThrow()); }
  };
}
