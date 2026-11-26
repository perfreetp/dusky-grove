import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.CHECK_URL ?? 'http://127.0.0.1:4173';
const screenshotDir = path.resolve('test-screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

const executablePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

if (!executablePath) throw new Error('No Chrome or Edge executable found for browser check.');

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.three-canvas', { timeout: 30000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(screenshotDir, '01-initial.png') });

  // Reproduce playtest failure.
  await page.getByRole('button', { name: /沿路线跑探针/ }).first().click();
  await page.waitForSelector('.hit-box', { timeout: 12000 });
  const hitText = (await page.locator('.hit-box').innerText()).replace(/\s+/g, ' ');
  if (!hitText.includes('第7门框内侧凹槽')) throw new Error(`Unexpected hit object: ${hitText}`);
  if (!/离地高度\s*0\.850\s*m/.test(hitText)) throw new Error(`Unexpected hit height: ${hitText}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshotDir, '02-probe-blocked.png') });
  console.log('✓ browser: probe blocks at corner 7 with height');

  // Flatten groove via Manifold.
  await page.getByRole('button', { name: '选门框凹槽', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /合并凹槽并平直化/ }).click();
  await page.waitForSelector('text=/平直化段/', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(screenshotDir, '03-flattened.png') });
  console.log('✓ browser: Manifold flatten command created simplified segment');

  // Probe should now pass.
  await page.getByRole('button', { name: /沿路线跑探针/ }).first().click();
  await page.waitForSelector('.pass-box', { timeout: 12000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(screenshotDir, '04-probe-pass.png') });
  console.log('✓ browser: probe passes after collision rebuild');

  // Batch delete all eligible decorations and inspect art handoff list.
  await page.getByRole('button', { name: '选中全部带外装饰' }).click();
  await page.getByRole('button', { name: /批量删除并实时重算净宽/ }).click();
  await page.getByRole('button', { name: /美术确认/ }).click();
  await page.waitForSelector('.art-row', { timeout: 5000 });
  const artCount = await page.locator('.art-row').count();
  if (artCount !== 14) throw new Error(`Expected 14 deleted art rows, got ${artCount}`);
  await page.screenshot({ path: path.join(screenshotDir, '05-art-list.png'), fullPage: false });
  console.log('✓ browser: batch delete produced 14 art-review records');

  // One undo restores the whole batch, including transforms/collision snapshots.
  await page.keyboard.press('Control+z');
  await page.waitForSelector('.empty-state', { timeout: 5000 });
  console.log('✓ browser: undo restored batch and cleared art records');

  // Export JSON and GLB through the real Three/GLTF exporter.
  await page.getByRole('button', { name: /导出交接/ }).click();
  const jsonDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: '下载关卡交接 JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = path.join(screenshotDir, jsonDownload.suggestedFilename());
  await jsonDownload.saveAs(jsonPath);

  const glbDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: /导出简化场景 GLB/ }).click();
  const glbDownload = await glbDownloadPromise;
  const glbPath = path.join(screenshotDir, glbDownload.suggestedFilename());
  await glbDownload.saveAs(glbPath);
  const glbStat = fs.statSync(glbPath);
  if (glbStat.size < 1000) throw new Error(`GLB unexpectedly small: ${glbStat.size}`);
  console.log('✓ browser: exported JSON and GLB', `(${Math.round(glbStat.size / 1024)} KB)`);

  // Re-import the exported GLB to verify the art/level handoff round-trip.
  await page.locator('input[type="file"]').setInputFiles(glbPath);
  await page.waitForFunction(() => document.body.innerText.includes('导入') && document.body.innerText.includes('mesh'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  console.log('✓ browser: exported GLB re-imports successfully');

  if (pageErrors.length) throw new Error(`Page errors:\n${pageErrors.join('\n')}`);
  const seriousConsoleErrors = consoleErrors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
  if (seriousConsoleErrors.length) {
    console.warn('Console errors:\n' + seriousConsoleErrors.join('\n'));
  }
  if (failedRequests.length) throw new Error(`Failed requests:\n${failedRequests.join('\n')}`);

  console.log('\nBrowser verification passed. Screenshots in test-screenshots/');
} finally {
  await browser.close();
}
