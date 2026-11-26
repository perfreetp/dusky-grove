/* 大规模性能测试：数千辊子 + 检查后果实实例化，测帧率与内存 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

rmSync('D:/ccfb/runs/1000376/workspace/.smoke/profile7', { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9228', '--disable-gpu', '--no-sandbox',
  '--window-size=1600,1000',
  '--user-data-dir=D:/ccfb/runs/1000376/workspace/.smoke/profile7', 'about:blank'
], { stdio: 'ignore' });
const getJson = (p) => fetch(`http://127.0.0.1:9228${p}`).then((r) => r.json());
let target;
for (let i = 0; i < 40; i++) {
  try { target = (await getJson('/json')).find((t) => t.type === 'page'); if (target) break; } catch { /* */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.resolve(m.result); };
const send = (method, params = {}) => new Promise((resolve) => { const mid = ++id; pending.set(mid, { resolve }); ws.send(JSON.stringify({ id: mid, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5180/' });
await sleep(1500);
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await ev(`document.querySelector('.wizard button.primary').click()`);
await sleep(400);

// 构造大规模场景：6 段，每段 20m、辊距 30mm → 每段 ~667 辊，合计 4000+
await ev(`(async function(){
  const mod = await import('/src/model.js');
  const st = window.__store;
  const cat = st.wizard.rollerCatalog[0];
  st.mutate('大规模性能场景', p => {
    for (let k = 0; k < 6; k++) {
      const seg = mod.makeSegment(cat, 1500 + k * 20500, 0, 20000);
      seg.pitch = 30;
      p.segments.push(seg);
    }
  });
  return st.project.segments.length;
})()`);
await sleep(1500);
const rollerTotal = await ev(`window.__store.project.segments.reduce((a,s)=>a+Math.max(2,Math.round(s.length/s.pitch)+1),0)`);
console.log('辊子总数:', rollerTotal);

// 帧率采样：requestAnimationFrame 计数
const fps = await ev(`(async function(){
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let frames = 0; const t0 = performance.now();
  await new Promise(res => {
    const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return Math.round(frames / ((performance.now() - t0) / 1000));
})()`);
console.log('静态场景 FPS:', fps);

// 跑检查，加入果实实例
await ev(`window.__store.runCheck()`);
await sleep(2500);
const fruitN = await ev(`window.__store.project.lastCheck.totalFruit`);
const fpsAnim = await ev(`(async function(){
  let frames = 0; const t0 = performance.now();
  await new Promise(res => {
    const tick = () => { frames++; if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return Math.round(frames / ((performance.now() - t0) / 1000));
})()`);
console.log('果实数:', fruitN, ' 动画期 FPS:', fpsAnim);

// 内存
const mem = await ev(`performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) + 'MB' : 'n/a'`);
console.log('JS 堆占用:', mem);

// 交互：连续改 5 次辊距（触发实例化缓冲重建），测耗时
const rebuildMs = await ev(`(function(){
  const seg = window.__store.project.segments[0];
  window.__store.select('segment', seg.id);
  const t0 = performance.now();
  for (const p of [40, 50, 35, 55, 45]) {
    window.__store.updateSelected({ pitch: p });
  }
  return Math.round(performance.now() - t0);
})()`);
console.log('5 次辊距修改（含重建）总耗时:', rebuildMs + 'ms');
console.log(fps >= 30 && fpsAnim >= 25 ? '\n性能达标 ✓' : '\n性能需关注 ⚠');
chrome.kill();
process.exit(0);
