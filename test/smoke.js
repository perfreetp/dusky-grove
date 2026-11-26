const PW = "C:/Users/Administrator/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright";
const { chromium } = require(PW);

const URL = "http://127.0.0.1:8777/index.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));

  await page.goto(URL, { waitUntil: "networkidle" });
  await sleep(2500);

  /* R1 健康 + 权重归一 */
  const r1 = await page.evaluate(() => {
    const D = window.DBG;
    let maxErr = 0, multi = 0, blend = 0;
    for (let v = 0; v < D.NV; v++) {
      let s = 0;
      for (let w = 0; w < D.W_CNT[v]; w++) s += D.W_VAL[v * 4 + w];
      maxErr = Math.max(maxErr, Math.abs(s - 1));
      if (D.W_CNT[v] >= 2) { multi++; if (D.W_VAL[v * 4 + 1] > 0.25) blend++; }
    }
    return { babylon: !!D.BABYLON, nVerts: D.NV, nBones: D.NB, weightMaxErr: maxErr,
             multiBoneVerts: multi, blendZoneVerts: blend };
  });
  console.log("R1 health/weights:", JSON.stringify(r1));

  /* R2 绑定姿势防穿透 */
  console.log("R2 collision @rest:", JSON.stringify(await page.evaluate(() => window.DBG.collision())));

  /* R3/R4 解剖学极限姿势（单轴铰链到极限，偏航归零——真实可达的最大弯曲） */
  await page.evaluate(() => {
    window.DBG.boneList.forEach(b => { if (b.hinge) { b.ax = b.hinge.max; b.ay = 0; } });
  });
  await sleep(400);
  const r4 = await page.evaluate(() => {
    const D = window.DBG;
    const forced = D.boneList.filter(b => b.force > 0.5).map(b => b.name);
    return Object.assign(D.collision(), { forced });
  });
  console.log("R4 collision @extreme + force:", JSON.stringify(r4));

  /* R5/R6 滑块 10% 约束压缩 */
  await page.evaluate(() => {
    window.DBG.boneList.forEach(b => { b.ax = 0; b.ay = 0; });
    window.DBG.byName.elbowL.ax = 2.0;
  });
  await page.evaluate(v => {
    const el = document.getElementById("limit");
    el.value = v; el.dispatchEvent(new Event("input"));
  }, 0.1);
  await sleep(300);
  const r6 = await page.evaluate(() => {
    const el = window.DBG.byName.elbowL;
    return { effAx: +el.effAx.toFixed(4), force: +el.force.toFixed(3),
             expectedMax: +(el.hinge.max * 0.1).toFixed(4) };
  });
  console.log("R6 limit=10% clamp:", JSON.stringify(r6));

  /* R7/R8 肘部鼓包：弯曲前后肘周顶点径向距离 */
  await page.evaluate(v => {
    const el = document.getElementById("limit");
    el.value = v; el.dispatchEvent(new Event("input"));
  }, 0.9);
  const sample = await page.evaluate(() => {
    const D = window.DBG;
    D.boneList.forEach(b => { b.ax = 0; b.ay = 0; });
    const el = D.byName.elbowL;
    const ids = [];
    for (let v = 0; v < D.NV; v++) {
      /* 用绑定姿势坐标采样，避免被当前变形干扰 */
      const px = D.restPos[v*3], py = D.restPos[v*3+1], pz = D.restPos[v*3+2];
      if (Math.hypot(px-el.head.x, py-el.head.y, pz-el.head.z) < 0.14) ids.push(v);
    }
    return ids;
  });
  const radialAvg = () => page.evaluate(ids => {
    const D = window.DBG, B = D.BABYLON;
    const sh = D.byName.shoulderL, el = D.byName.elbowL;
    const shA = sh.abs.getTranslation(), elA = el.abs.getTranslation();
    const ax = elA.subtract(shA), L2 = ax.lengthSquared();
    let sum = 0;
    for (const v of ids) {
      const p = new B.Vector3(D.curPos[v*3], D.curPos[v*3+1], D.curPos[v*3+2]);
      const d = p.subtract(shA), t = B.Vector3.Dot(d, ax) / L2;
      sum += B.Vector3.Distance(p, shA.add(ax.scale(t)));
    }
    return sum / ids.length;
  }, sample);
  const restR = await radialAvg();
  /* 纯鼓包量：变形后顶点逆变换回绑定空间，与同空间下的绑定位置比较 */
  const bulgeMeasure = () => page.evaluate(ids => {
    const D = window.DBG, B = D.BABYLON;
    const el = D.byName.elbowL;
    let sum = 0;
    for (const v of ids) {
      const p = new B.Vector3(D.curPos[v*3], D.curPos[v*3+1], D.curPos[v*3+2]);
      const local = B.Vector3.TransformCoordinates(p, el.invRest);
      const restW = new B.Vector3(D.restPos[v*3], D.restPos[v*3+1], D.restPos[v*3+2]);
      const restLocal = B.Vector3.TransformCoordinates(restW, el.invRest);
      sum += B.Vector3.Distance(local, restLocal);
    }
    return sum / ids.length;
  }, sample);
  await page.evaluate(() => {
    const el = window.DBG.byName.elbowL;
    el.ax = el.hinge.max * 0.9;
  });
  await sleep(300);
  const bendR = await radialAvg();
  const bulgeDelta = await bulgeMeasure();
  console.log("R8 radial avg: rest=" + restR.toFixed(4) + " bent=" + bendR.toFixed(4) +
              " | pure bulge(bind space)=" + bulgeDelta.toFixed(4) + " (samples=" + sample.length + ")");

  /* R9/R10 父子链联动 */
  const before = await page.evaluate(() => {
    window.DBG.boneList.forEach(b => { b.ax = 0; b.ay = 0; });
    return window.DBG.byName.elbowL.abs.getTranslation().asArray();
  });
  await page.evaluate(() => { window.DBG.byName.shoulderL.ax = 1.2; });
  await sleep(300);
  const r10 = await page.evaluate(bef => {
    const B = window.DBG.BABYLON;
    const after = window.DBG.byName.elbowL.abs.getTranslation();
    return { after: after.asArray().map(n => +n.toFixed(4)), delta: +B.Vector3.Distance(
      B.Vector3.FromArray(bef), after).toFixed(4) };
  }, before);
  console.log("R10 parent chain move:", JSON.stringify(r10));

  /* 截图集 */
  await page.evaluate(() => window.DBG.boneList.forEach(b => { if (b.hinge) { b.ax = b.hinge.max * 0.8; b.ay = 0; } }));
  await sleep(300);
  await page.screenshot({ path: "shot_extreme.png" });
  await page.evaluate(() => document.getElementById("weights").click());
  await sleep(300);
  await page.screenshot({ path: "shot_weights.png" });
  await page.evaluate(() => { document.getElementById("weights").click(); document.getElementById("xray").click(); });
  await sleep(300);
  await page.screenshot({ path: "shot_xray.png" });
  await page.evaluate(() => {
    document.getElementById("xray").click();
    window.DBG.boneList.forEach(b => { b.ax = 0; b.ay = 0; });
    document.getElementById("idle").click();
  });
  await sleep(300);
  await page.screenshot({ path: "shot_idle1.png" });
  const tail1 = await page.evaluate(() => window.DBG.byName.tail2.abs.getTranslation().asArray());
  await sleep(800);
  const tail2 = await page.evaluate(() => window.DBG.byName.tail2.abs.getTranslation().asArray());
  await page.screenshot({ path: "shot_idle2.png" });
  const tailDelta = Math.hypot(tail1[0]-tail2[0], tail1[1]-tail2[1], tail1[2]-tail2[2]);
  console.log("Idle tail delta over 0.8s: " + tailDelta.toFixed(4));

  console.log("\nERRORS:", errors.length ? errors.join("\n") : "none");
  await browser.close();

  /* 汇总断言 */
  const fails = [];
  if (r1.weightMaxErr > 1e-5) fails.push("weights not normalized");
  if (r1.blendZoneVerts < 50) fails.push("no multi-bone blend zone");
  if (r4.violations > 0) fails.push("self-intersection at extreme pose");
  if (r4.nan > 0) fails.push("NaN positions");
  if (Math.abs(r6.effAx - r6.expectedMax) > 0.02 || r6.force < 0.5) fails.push("constraint slider failed");
  if (bulgeDelta < 0.005) fails.push("no elbow bulge in bind space");
  if (r10.delta < 0.05) fails.push("parent chain not moving child");
  if (tailDelta < 0.005) fails.push("tail not animating");
  if (errors.length) fails.push("console errors");
  if (fails.length) { console.log("\nASSERT FAILS:", fails); process.exit(1); }
  console.log("\nALL ASSERTIONS PASSED");
})().catch(e => { console.error("TEST FAIL:", e); process.exit(1); });
