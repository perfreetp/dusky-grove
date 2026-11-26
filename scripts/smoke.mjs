/* 无头冒烟测试：通过 CDP 驱动 Chrome，验证页面无致命错误并跑通核心流程 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5180/';
const PORT = 9222;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1600,1000',
  '--user-data-dir=D:/ccfb/runs/1000376/workspace/.smoke/profile',
  'about:blank'
], { stdio: 'ignore' });

const getJson = (path) => fetch(`http://127.0.0.1:${PORT}${path}`).then((r) => r.json());

let target;
for (let i = 0; i < 40; i++) {
  try {
    const list = await getJson('/json');
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch { /* 等待启动 */ }
  await sleep(250);
}
if (!target) { console.error('Chrome 启动失败'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(`[console.${m.params.type}] ${text}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d.exception?.description || d.text}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(2500);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

try {
  // 1. 向导弹出
  check('向导默认显示', await evalJs(`document.querySelector('.wizard') !== null`));

  // 2. 完成向导
  await evalJs(`document.querySelector('.wizard button.primary').click()`);
  await sleep(300);
  check('向导后进入主界面', await evalJs(`document.querySelector('.app') !== null`));

  // 3. 加载教学示例
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('教学示例')).click()`);
  await sleep(1500);
  const scene = await evalJs(`({
    silos: window.__store.project.silos.length,
    segs: window.__store.project.segments.length
  })`);
  const outline = await evalJs(`document.querySelector('.left-panel').innerText.includes('3 仓 / 3 段')`);
  check('示例载入 3 仓 3 段（大纲）', outline, JSON.stringify(scene));

  // 4. 等待自动检查完成
  await sleep(1200);
  const jamText = await evalJs(`document.querySelector('.right-panel').innerText`);
  check('右侧出现检查结果', jamText.includes('通过性检查') && jamText.includes('投放果实'));
  const jam0 = await evalJs(`window.__store.project.lastCheck.totalJam`);
  const jam75 = await evalJs(`window.__store.project.lastCheck.perGrade.find(g=>g.diameter===75)?.jammed`);
  check('初始布局 75mm 档检出卡果', jam0 > 0 && jam75 > 0, `总卡果=${jam0}，75档=${jam75}`);

  // 5. 一键修复并重跑
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('60→72')).click()`);
  await sleep(1500);
  const after = await evalJs(`document.querySelector('.right-panel').innerText`);
  const jam1 = await evalJs(`window.__store.project.lastCheck.totalJam`);
  check('修复后卡果清零', jam1 === 0, `卡果=${jam1}`);
  check('出现前后对比', after.includes('与上一次检查对比'));

  // 6. 撤销：回到 pitch=60 的原布局
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('撤销')).click()`);
  await sleep(400);
  const pitchAfterUndo = await evalJs(`window.__store.project.segments.find(s=>s.name.includes('第三段')).pitch`);
  check('撤销后辊距回到 60', pitchAfterUndo === 60, `pitch=${pitchAfterUndo}`);

  // 7. 重做
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('重做')).click()`);
  await sleep(400);
  const pitchAfterRedo = await evalJs(`window.__store.project.segments.find(s=>s.name.includes('第三段')).pitch`);
  check('重做后辊距恢复 72', pitchAfterRedo === 72, `pitch=${pitchAfterRedo}`);

  // 8. 导出物
  const dl = await evalJs(`(async () => {
    const mods = await import('/src/exporter.js');
    const st = window.__store;
    return mods.exportRollerTable(st.project).split('\\n').length + '|' + mods.exportSiloPlan(st.project).length;
  })()`);
  check('导出表与方案可生成', /^\d+\|\d+$/.test(dl), `CSV行数|TXT字符数 ${dl}`);

  // 9. canvas 在渲染
  const canvasOk = await evalJs(`(() => {
    const c = document.querySelector('.viewport canvas');
    return c && c.width > 0 && c.height > 0;
  })()`);
  check('PlayCanvas canvas 已初始化', canvasOk);
} catch (e) {
  console.error('测试异常:', e.message);
  results.push({ name: '测试脚本异常', pass: false, extra: e.message });
}

// 汇总控制台致命错误
const fatal = logs.filter((l) => l.includes('[EXCEPTION]') || l.includes('[console.error]'));
if (fatal.length) {
  console.log('\n--- 控制台致命日志 ---');
  fatal.forEach((l) => console.log(l));
}
check('无未捕获异常', fatal.length === 0, `${fatal.length} 条`);

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
chrome.kill();
process.exit(failed.length ? 1 : 0);
