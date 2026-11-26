/* 巡检云台：外壳拖拽、传动链、限位、间隙与拍摄扇区严格联动 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEG = Math.PI / 180;

  const CFG = {
    pitchY: 1.72,
    driveX: 1.18,
    limitUpper: -28,
    limitLower: 10,
    fovHalf: 5,
    targetAngle: 14.5,
    targetDistance: 4.6,
    teeth1: 12,
    teeth2: 24,
    wormStarts: 1,
    teethWheel: 36,
    coverX: 1.86,
    stopRadius: 1.04,
    lugRadius: 0.86,
    wigglePeriod: 8.0
  };
  CFG.targetY = CFG.pitchY - CFG.targetDistance * Math.tan(CFG.targetAngle * DEG);
  CFG.spurRatio = CFG.teeth2 / CFG.teeth1;
  CFG.wormRatio = CFG.teethWheel / CFG.wormStarts;
  CFG.totalRatio = CFG.spurRatio * CFG.wormRatio;

  const state = {
    command: CFG.limitLower,
    theta: CFG.limitLower,
    thetaVelocity: 0,
    backlash: 0.8,
    autoWiggle: true,
    time: CFG.wigglePeriod * 0.5,
    crossSide: 1,
    crossCount: 0,
    coverProgress: 0,
    coverTarget: 0,
    coverDragging: false,
    selectedStop: null,
    hasStopCard: false
  };

  let renderer, scene, camera, controls, raycaster, pointer;
  let coverGroup, cameraRig, wheelSpin, wormSpin, pinionSpin;
  let stopLower, stopUpper, edgeMarker, crossDot3;
  let edgeLowMaterial, edgeHighMaterial;
  let targetBeam;
  const clickables = [];
  const internalLabels = [];
  const clock = new THREE.Clock();

  const M = {};

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function signed(v, digits = 2) { return (v >= 0 ? '+' : '') + v.toFixed(digits) + '°'; }
  function rpmText(degPerSec) { return (degPerSec / 6).toFixed(1) + ' rpm'; }

  function init() {
    if (!window.THREE) {
      $('webglError').hidden = false;
      return;
    }
    initThree();
    initMaterials();
    buildLightsGround();
    buildShell();
    buildDriveTrain();
    buildCamera();
    buildTargetAndSector();
    bindPointer();
    controls = new THREE.OrbitControls(camera, $('scene'));
    controls.target.set(0.35, 1.45, 1.15);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3.2;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    initChart();
    bindUI();

    const query = new URLSearchParams(window.location.search);
    if (query.get('open') === '1') state.coverProgress = state.coverTarget = 1;
    if (query.get('pause') === '1') {
      state.autoWiggle = false;
      updateWiggleButton();
    }
    if (query.get('stop') === 'lower' || query.get('stop') === 'upper') selectStop(query.get('stop'));

    resize();
    window.addEventListener('resize', resize);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe($('stage'));
    requestAnimationFrame(animate);
  }

  function initThree() {
    const canvas = $('scene');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    scene.fog = new THREE.Fog(0x0b1220, 12, 25);

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(6.4, 3.65, -7.1);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
  }

  function initMaterials() {
    M.shell = new THREE.MeshStandardMaterial({ color: 0x9db4cf, metalness: 0.28, roughness: 0.48 });
    M.shellLight = new THREE.MeshStandardMaterial({ color: 0xc4d4e8, metalness: 0.22, roughness: 0.42 });
    M.shellDark = new THREE.MeshStandardMaterial({ color: 0x40536d, metalness: 0.42, roughness: 0.42 });
    M.arm = new THREE.MeshStandardMaterial({ color: 0x7890ad, metalness: 0.35, roughness: 0.45 });
    M.steel = new THREE.MeshStandardMaterial({ color: 0xc8d4e3, metalness: 0.82, roughness: 0.24 });
    M.darkSteel = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.72, roughness: 0.32 });
    M.brass = new THREE.MeshStandardMaterial({ color: 0xd9a531, metalness: 0.72, roughness: 0.28 });
    M.brassLight = new THREE.MeshStandardMaterial({ color: 0xf2cf6b, metalness: 0.65, roughness: 0.24 });
    M.worm = new THREE.MeshStandardMaterial({ color: 0xe8793e, metalness: 0.62, roughness: 0.3 });
    M.motor = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.45, roughness: 0.48 });
    M.camera = new THREE.MeshStandardMaterial({ color: 0xe5edf8, metalness: 0.18, roughness: 0.38 });
    M.lens = new THREE.MeshStandardMaterial({ color: 0x08111f, metalness: 0.4, roughness: 0.12 });
    M.glass = new THREE.MeshStandardMaterial({
      color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 0.75,
      metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.88
    });
    M.panel = new THREE.MeshStandardMaterial({ color: 0x4f83d1, metalness: 0.34, roughness: 0.42 });
    M.panelInset = new THREE.MeshStandardMaterial({ color: 0x2f5d9f, metalness: 0.4, roughness: 0.46 });
    M.handle = new THREE.MeshStandardMaterial({ color: 0xfb923c, emissive: 0x7c2d12, emissiveIntensity: 0.35, roughness: 0.35 });
    M.stopLower = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, emissiveIntensity: 0.55, roughness: 0.38 });
    M.stopUpper = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0x7c2d12, emissiveIntensity: 0.45, roughness: 0.42 });
    M.lug = new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0x854d0e, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.3 });
    M.ring = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.75, roughness: 0.3 });
    M.target = new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0xca8a04, emissiveIntensity: 0.55, roughness: 0.35 });
  }

  function setShadow(obj) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return obj;
  }

  function box(w, h, d, material, x, y, z, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function cylinder(rTop, rBottom, height, segments, material, x, y, z, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, height, segments || 40), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function axisCylinder(radius, height, axis, material, x, y, z, parent = scene, segments = 40) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, segments);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function buildLightsGround() {
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x172033, 0.85));

    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(5.5, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -4;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x67e8f9, 0.45);
    rim.position.set(-5, 4, -4);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshStandardMaterial({ color: 0x0e1b30, roughness: 0.92, metalness: 0.05 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(12, 24, 0x31507a, 0x1b2d49);
    grid.position.y = 0.006;
    scene.add(grid);
  }

  function buildShell() {
    cylinder(1.12, 1.25, 0.34, 64, M.shell, 0, 0.17, 0);
    cylinder(1.03, 1.09, 0.12, 64, M.shellDark, 0, 0.40, 0);
    cylinder(0.50, 0.58, 0.55, 48, M.shell, 0, 0.72, 0);
    axisCylinder(0.56, 0.16, 'y', M.shellDark, 0, 1.00, 0);

    box(1.62, 0.28, 0.94, M.shellDark, 0, 1.08, 0);
    box(0.20, 1.18, 0.38, M.arm, -0.70, 1.47, 0);
    box(0.20, 1.18, 0.38, M.arm, 0.70, 1.47, 0);

    axisCylinder(0.28, 0.18, 'x', M.darkSteel, -0.70, CFG.pitchY, 0);
    axisCylinder(0.28, 0.18, 'x', M.darkSteel, 0.70, CFG.pitchY, 0);
    axisCylinder(0.085, 2.35, 'x', M.steel, 0.25, CFG.pitchY, 0);

    // 右侧传动舱边框
    box(0.16, 0.12, 2.28, M.shellDark, 0.88, 2.86, -0.08);
    box(0.16, 0.12, 2.28, M.shellDark, 0.88, 0.34, -0.08);
    box(0.16, 2.58, 0.12, M.shellDark, 0.88, 1.60, 1.04);
    box(0.16, 2.58, 0.12, M.shellDark, 0.88, 1.60, -1.20);

    coverGroup = new THREE.Group();
    coverGroup.position.set(CFG.coverX, 1.62, -0.08);
    scene.add(coverGroup);

    box(0.10, 3.05, 3.10, M.panel, 0, 0, 0, coverGroup);
    box(0.035, 2.62, 2.62, M.panelInset, 0.065, 0, 0, coverGroup);
    for (let i = -2; i <= 2; i++) {
      box(0.045, 0.055, 1.62, M.shellLight, 0.092, i * 0.34, 0, coverGroup);
    }
    box(0.16, 0.56, 0.20, M.handle, 0.15, -0.05, 0.78, coverGroup);
    box(0.22, 0.10, 0.26, M.handle, 0.16, 0.25, 0.78, coverGroup);
    box(0.22, 0.10, 0.26, M.handle, 0.16, -0.35, 0.78, coverGroup);

    const label = makeTextSprite('侧板：向右拖开', { height: 0.27 });
    label.position.set(0.34, 1.05, 0.55);
    coverGroup.add(label);
  }

  function createPegGear(o) {
    const group = new THREE.Group();
    const body = axisCylinder(o.radius * 0.84, o.thickness, o.axis, o.material, 0, 0, 0, group, 56);
    body.castShadow = true;

    axisCylinder(o.radius * 0.22, o.thickness * 1.25, o.axis, M.darkSteel, 0, 0, 0, group, 32);

    const pitch = 2 * Math.PI * o.radius / o.teeth;
    const pegRadius = o.pegRadius || clamp(pitch * 0.23, 0.022, 0.05);
    const pegGeo = new THREE.CylinderGeometry(pegRadius, pegRadius, o.thickness * 1.7, 10);
    if (o.axis === 'x') pegGeo.rotateZ(Math.PI / 2);
    if (o.axis === 'z') pegGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < o.teeth; i++) {
      const a = o.phase + i * Math.PI * 2 / o.teeth;
      const peg = new THREE.Mesh(pegGeo, o.pegMaterial || o.material);
      if (o.axis === 'x') peg.position.set(0, Math.cos(a) * o.radius, Math.sin(a) * o.radius);
      else peg.position.set(Math.cos(a) * o.radius, Math.sin(a) * o.radius, 0);
      peg.castShadow = true;
      peg.receiveShadow = true;
      group.add(peg);
    }

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(pegRadius * 1.9, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff7ad, emissive: 0xf59e0b, emissiveIntensity: 0.9 })
    );
    if (o.axis === 'x') marker.position.set(o.thickness * 0.78, Math.cos(o.phase) * o.radius, Math.sin(o.phase) * o.radius);
    else marker.position.set(Math.cos(o.phase) * o.radius, Math.sin(o.phase) * o.radius, o.thickness * 0.78);
    group.add(marker);

    return group;
  }

  class HelixCurve extends THREE.Curve {
    constructor(radius, length, turns) {
      super();
      this.radius = radius;
      this.length = length;
      this.turns = turns;
    }
    getPoint(t, target = new THREE.Vector3()) {
      const a = t * this.turns * Math.PI * 2;
      return target.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, (t - 0.5) * this.length);
    }
  }

  function buildDriveTrain() {
    const wheelR = 0.72;
    const wormR = 0.18;
    const wormY = CFG.pitchY - (wheelR + wormR);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(CFG.stopRadius, 0.026, 10, 110), M.ring);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(CFG.driveX, CFG.pitchY, 0);
    ring.castShadow = true;
    scene.add(ring);

    wheelSpin = createPegGear({
      teeth: CFG.teethWheel, radius: wheelR, thickness: 0.24, axis: 'x',
      phase: Math.PI - Math.PI / CFG.teethWheel, material: M.brass, pegMaterial: M.brassLight
    });
    wheelSpin.position.set(CFG.driveX, CFG.pitchY, 0);
    scene.add(wheelSpin);

    box(0.20, 0.22, 0.28, M.lug, 0, CFG.lugRadius, 0, wheelSpin);
    axisCylinder(0.07, 0.30, 'x', M.darkSteel, 0, CFG.lugRadius, 0, wheelSpin, 20);

    stopLower = makeStop('lower', CFG.limitLower, M.stopLower);
    stopUpper = makeStop('upper', CFG.limitUpper, M.stopUpper);

    wormSpin = new THREE.Group();
    wormSpin.position.set(CFG.driveX, wormY, 0);
    scene.add(wormSpin);

    axisCylinder(0.07, 1.95, 'z', M.steel, 0, 0, 0, wormSpin, 28);
    axisCylinder(0.13, 0.78, 'z', M.worm, 0, 0, 0, wormSpin, 40);
    const helix = new THREE.Mesh(
      new THREE.TubeGeometry(new HelixCurve(0.17, 0.78, 3.2), 140, 0.035, 10, false),
      M.worm
    );
    helix.castShadow = true;
    wormSpin.add(helix);

    const gear2 = createPegGear({
      teeth: CFG.teeth2, radius: 0.36, thickness: 0.18, axis: 'z',
      phase: Math.PI / 2 - Math.PI / CFG.teeth2, material: M.steel, pegMaterial: M.shellLight
    });
    gear2.position.set(0, 0, 0.94);
    wormSpin.add(gear2);

    pinionSpin = createPegGear({
      teeth: CFG.teeth1, radius: 0.18, thickness: 0.18, axis: 'z',
      phase: -Math.PI / 2, material: M.darkSteel, pegMaterial: M.steel
    });
    pinionSpin.position.set(CFG.driveX, wormY + 0.54, 0.94);
    scene.add(pinionSpin);

    axisCylinder(0.21, 0.52, 'z', M.motor, CFG.driveX, wormY + 0.54, 1.30, scene, 36);
    box(0.42, 0.42, 0.12, M.darkSteel, CFG.driveX, wormY + 0.54, 1.59);

    addPartLabel('z₃=36 蜗轮 / 俯仰轴', CFG.driveX + 0.1, CFG.pitchY + 0.92, 0.12, 0.30);
    addPartLabel('单头蜗杆 · 36:1', CFG.driveX + 0.05, wormY - 0.36, 0.25, 0.25);
    addPartLabel('z₂=24', CFG.driveX - 0.05, wormY - 0.50, 0.98, 0.20);
    addPartLabel('z₁=12（反向）', CFG.driveX + 0.05, wormY + 0.90, 0.98, 0.24);
  }

  function makeStop(id, angleDeg, material) {
    const a = angleDeg * DEG;
    const r = CFG.stopRadius;
    const mesh = box(
      0.38, 0.30, 0.36, material,
      CFG.driveX, CFG.pitchY + r * Math.cos(a), r * Math.sin(a)
    );
    mesh.rotation.x = a;
    mesh.userData.stopId = id;
    clickables.push(mesh);

    const bolt1 = axisCylinder(0.045, 0.44, 'x', M.steel, 0, 0.02, 0.11, mesh, 16);
    const bolt2 = axisCylinder(0.045, 0.44, 'x', M.steel, 0, 0.02, -0.11, mesh, 16);
    bolt1.userData.stopId = id;
    bolt2.userData.stopId = id;
    clickables.push(bolt1, bolt2);

    const labelAngle = a;
    const label = makeTextSprite((id === 'lower' ? '下限位 ' : '上限位 ') + angleDeg + '°', { height: 0.24 });
    label.position.set(
      CFG.driveX + 0.34,
      CFG.pitchY + (r + 0.28) * Math.cos(labelAngle),
      (r + 0.28) * Math.sin(labelAngle)
    );
    scene.add(label);
    internalLabels.push(label);
    return mesh;
  }

  function addPartLabel(text, x, y, z, height) {
    const sprite = makeTextSprite(text, { height: height || 0.28 });
    sprite.position.set(x, y, z);
    scene.add(sprite);
    internalLabels.push(sprite);
    return sprite;
  }

  function makeTextSprite(text, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    roundedRect(ctx, 18, 28, 604, 104, 28);
    ctx.fillStyle = 'rgba(7, 17, 31, .82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(103, 232, 249, .72)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = '800 46px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8f7ff';
    ctx.fillText(text, 320, 82);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
    const sprite = new THREE.Sprite(material);
    const h = opts.height || 0.28;
    sprite.scale.set(h * 4, h, 1);
    sprite.renderOrder = 99;
    return sprite;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function buildCamera() {
    cameraRig = new THREE.Group();
    cameraRig.position.set(0, CFG.pitchY, 0);
    scene.add(cameraRig);

    box(0.80, 0.50, 0.98, M.camera, 0, 0.03, 0.10, cameraRig);
    box(0.92, 0.08, 1.16, M.shellLight, 0, 0.32, 0.10, cameraRig);
    box(0.74, 0.12, 0.20, M.shellDark, 0, -0.24, -0.30, cameraRig);
    axisCylinder(0.25, 0.30, 'z', M.lens, 0, 0.03, 0.66, cameraRig, 48);
    axisCylinder(0.18, 0.045, 'z', M.glass, 0, 0.03, 0.83, cameraRig, 48);

    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      axisCylinder(
        0.035, 0.05, 'z', M.glass,
        Math.cos(a) * 0.31, 0.03 + Math.sin(a) * 0.31, 0.79,
        cameraRig, 16
      );
    }
  }

  function buildTargetAndSector() {
    const x = 0;
    const z = CFG.targetDistance;
    const yT = CFG.targetY;

    axisCylinder(0.035, yT, 'y', M.target, -0.82, yT / 2, z, scene, 16);
    axisCylinder(0.035, yT, 'y', M.target, 0.82, yT / 2, z, scene, 16);
    box(1.86, 0.075, 0.075, M.target, 0, yT, z);
    box(0.28, 0.05, 0.50, M.darkSteel, -0.82, 0.025, z);
    box(0.28, 0.05, 0.50, M.darkSteel, 0.82, 0.025, z);

    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, CFG.pitchY, 0),
      new THREE.Vector3(0, yT, z)
    ]);
    targetBeam = new THREE.Line(beamGeo, new THREE.LineDashedMaterial({
      color: 0xfde047, dashSize: 0.16, gapSize: 0.09, linewidth: 2
    }));
    targetBeam.computeLineDistances();
    scene.add(targetBeam);

    edgeMarker = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(edgeMarker);

    const seg = 36;
    const radius = 4.8;
    const positions = [0, 0, 0];
    const indices = [];
    for (let i = 0; i <= seg; i++) {
      const rel = (-CFG.fovHalf + 2 * CFG.fovHalf * i / seg) * DEG;
      positions.push(0, -radius * Math.sin(rel), radius * Math.cos(rel));
    }
    for (let i = 1; i <= seg; i++) indices.push(0, i, i + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const sector = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.17,
      side: THREE.DoubleSide, depthWrite: false
    }));
    cameraRig.add(sector);

    const edgeGeoHigh = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -radius * Math.sin(-CFG.fovHalf * DEG), radius * Math.cos(CFG.fovHalf * DEG))
    ]);
    edgeHighMaterial = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
    cameraRig.add(new THREE.Line(edgeGeoHigh, edgeHighMaterial));

    const edgeGeoLow = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -radius * Math.sin(CFG.fovHalf * DEG), radius * Math.cos(CFG.fovHalf * DEG))
    ]);
    edgeLowMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 3 });
    cameraRig.add(new THREE.Line(edgeGeoLow, edgeLowMaterial));
  }

  const chart = {
    x0: 48, yGround: 232, w: 292, hMax: 2.5, dMax: 5.2,
    aMin: 6, aMax: 17
  };
  chart.x1 = chart.x0 + chart.w;
  chart.camX = chart.x0;
  chart.camY = chart.yGround - CFG.pitchY / chart.hMax * 198;

  function xDist(d) { return chart.x0 + clamp(d, 0, chart.dMax) / chart.dMax * chart.w; }
  function yHeight(h) { return chart.yGround - h / chart.hMax * 198; }
  function xAngle(a) { return chart.x0 + clamp((a - chart.aMin) / (chart.aMax - chart.aMin), -0.15, 1.15) * chart.w; }

  function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function initChart() {
    const grid = $('chartGrid');
    for (let d = 0; d <= 5; d++) {
      const x = xDist(d);
      grid.appendChild(svgEl('line', { x1: x, y1: 28, x2: x, y2: chart.yGround, class: 'grid-line' }));
      const t = svgEl('text', { x, y: 246, 'text-anchor': 'middle', class: 'grid-text' });
      t.textContent = d + 'm';
      grid.appendChild(t);
    }
    for (let h = 0.5; h <= 2.0; h += 0.5) {
      const y = yHeight(h);
      grid.appendChild(svgEl('line', { x1: chart.x0, y1: y, x2: chart.x1, y2: y, class: 'grid-line' }));
      const t = svgEl('text', { x: 38, y: y + 3, 'text-anchor': 'end', class: 'grid-text' });
      t.textContent = h.toFixed(1);
      grid.appendChild(t);
    }

    $('groundLine').setAttribute('x1', 34);
    $('groundLine').setAttribute('y1', chart.yGround);
    $('groundLine').setAttribute('x2', 346);
    $('groundLine').setAttribute('y2', chart.yGround);

    $('cameraDot').setAttribute('cx', chart.camX);
    $('cameraDot').setAttribute('cy', chart.camY);

    const tx = xDist(CFG.targetDistance);
    const ty = yHeight(CFG.targetY);
    const gantry = $('targetGantry');
    gantry.appendChild(svgEl('line', { x1: tx - 16, y1: chart.yGround, x2: tx - 16, y2: ty, class: 'target-post' }));
    gantry.appendChild(svgEl('line', { x1: tx + 16, y1: chart.yGround, x2: tx + 16, y2: ty, class: 'target-post' }));
    gantry.appendChild(svgEl('rect', { x: tx - 24, y: ty - 4, width: 48, height: 8, rx: 3, class: 'target-bar' }));
    $('targetDot').setAttribute('cx', tx);
    $('targetDot').setAttribute('cy', ty);

    $('targetRay').setAttribute('x1', chart.camX);
    $('targetRay').setAttribute('y1', chart.camY);
    $('targetRay').setAttribute('x2', tx);
    $('targetRay').setAttribute('y2', ty);

    const lp = polarChart(CFG.limitLower, 4.8);
    $('limitRay').setAttribute('x1', chart.camX);
    $('limitRay').setAttribute('y1', chart.camY);
    $('limitRay').setAttribute('x2', lp[0]);
    $('limitRay').setAttribute('y2', lp[1]);

    const limitText = svgEl('text', { x: lp[0] - 4, y: lp[1] - 8, class: 'chart-label danger', 'text-anchor': 'end' });
    limitText.textContent = '限位 ' + CFG.limitLower + '°';
    $('chart').appendChild(limitText);

    const targetText = svgEl('text', { x: tx, y: ty + 22, class: 'chart-label warn', 'text-anchor': 'middle' });
    targetText.textContent = '目标线 ' + CFG.targetAngle.toFixed(1) + '°';
    $('chart').appendChild(targetText);

    initTape();
  }

  function initTape() {
    const layer = $('tapeLayer');
    const y = 266;
    layer.appendChild(svgEl('line', { x1: chart.x0, y1: y, x2: chart.x1, y2: y, class: 'tape-line' }));
    for (let a = 6; a <= 17; a++) {
      const x = xAngle(a);
      const major = a % 2 === 0;
      layer.appendChild(svgEl('line', {
        x1: x, y1: y - (major ? 9 : 5), x2: x, y2: y + (major ? 9 : 5),
        class: major ? 'tape-tick major' : 'tape-tick'
      }));
      if (major) {
        const t = svgEl('text', { x, y: 286, 'text-anchor': 'middle', class: 'tape-label' });
        t.textContent = a + '°';
        layer.appendChild(t);
      }
    }

    const addMarker = (id, angle, cls, label, dy) => {
      const x = xAngle(angle);
      layer.appendChild(svgEl('line', { id, x1: x, y1: 252, x2: x, y2: 279, class: cls }));
      if (label) {
        const t = svgEl('text', { x, y: dy || 250, 'text-anchor': 'middle', class: 'tape-label' });
        t.textContent = label;
        layer.appendChild(t);
      }
    };
    addMarker('tapeLimit', CFG.limitLower, 'tape-limit', '限');
    addMarker('tapeTarget', CFG.targetAngle, 'tape-target', '目');
    addMarker('tapePitch', CFG.limitLower, 'tape-pitch', 'θ');
    addMarker('tapeEdge', CFG.limitLower + CFG.fovHalf, 'tape-edge', '缘');
  }

  function polarChart(angleDeg, radius) {
    const a = angleDeg * DEG;
    const d = radius * Math.cos(a);
    const h = CFG.pitchY - radius * Math.sin(a);
    return [xDist(d), yHeight(h)];
  }

  function updateChart() {
    const radius = 4.8;
    const seg = 28;
    let d = `M ${chart.camX.toFixed(2)} ${chart.camY.toFixed(2)}`;
    for (let i = 0; i <= seg; i++) {
      const angle = state.theta - CFG.fovHalf + 2 * CFG.fovHalf * i / seg;
      const p = polarChart(angle, radius);
      d += ` L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
    }
    d += ' Z';
    $('sectorPath').setAttribute('d', d);

    const aim = polarChart(state.theta, radius);
    $('aimLine').setAttribute('x1', chart.camX);
    $('aimLine').setAttribute('y1', chart.camY);
    $('aimLine').setAttribute('x2', aim[0]);
    $('aimLine').setAttribute('y2', aim[1]);

    const high = polarChart(state.theta - CFG.fovHalf, radius);
    $('edgeHigh').setAttribute('x1', chart.camX);
    $('edgeHigh').setAttribute('y1', chart.camY);
    $('edgeHigh').setAttribute('x2', high[0]);
    $('edgeHigh').setAttribute('y2', high[1]);

    const low = polarChart(state.theta + CFG.fovHalf, radius);
    $('edgeLow').setAttribute('x1', chart.camX);
    $('edgeLow').setAttribute('y1', chart.camY);
    $('edgeLow').setAttribute('x2', low[0]);
    $('edgeLow').setAttribute('y2', low[1]);

    const edgeAngle = state.theta + CFG.fovHalf;
    const crossH = CFG.pitchY - CFG.targetDistance * Math.tan(edgeAngle * DEG);
    const cx = xDist(CFG.targetDistance);
    const cy = yHeight(crossH);
    $('crossDot').setAttribute('cx', cx);
    $('crossDot').setAttribute('cy', clamp(cy, 24, chart.yGround));

    const setX = (id, angle) => {
      const node = $(id);
      if (!node) return;
      const x = xAngle(angle);
      node.setAttribute('x1', x);
      node.setAttribute('x2', x);
    };
    setX('tapePitch', state.theta);
    setX('tapeEdge', edgeAngle);
  }

  function bindUI() {
    $('ratioText').innerHTML =
      `外啮合：ω₁ / ω₂ = −z₂ / z₁ = <b>−${CFG.spurRatio}</b>，负号表示 <span class="rev">反向</span><br>` +
      `蜗杆蜗轮：ω蜗 / ω₃ = z₃ / z头 = <b>${CFG.wormRatio}</b><br>` +
      `总链：ω₁ / θ俯仰 = <b>−${CFG.totalRatio}</b>（同一段 θ 驱动镜头、蜗轮与扇区）`;

    $('pitchSlider').addEventListener('input', (e) => {
      state.autoWiggle = false;
      updateWiggleButton();
      state.command = parseFloat(e.target.value);
    });

    $('backlashSlider').addEventListener('input', (e) => {
      state.backlash = parseFloat(e.target.value);
    });

    $('presetBtn').addEventListener('click', presetContact);
    $('wiggleBtn').addEventListener('click', () => {
      state.autoWiggle = !state.autoWiggle;
      updateWiggleButton();
    });
    $('coverBtn').addEventListener('click', () => {
      state.coverTarget = state.coverProgress > 0.5 ? 0 : 1;
    });
    $('resetViewBtn').addEventListener('click', () => {
      camera.position.set(6.4, 3.65, -7.1);
      controls.target.set(0.35, 1.45, 1.15);
      controls.update();
    });
    $('stopClose').addEventListener('click', () => {
      $('stopCard').hidden = true;
      state.hasStopCard = false;
    });
    $('selectLowerBtn').addEventListener('click', () => selectStop('lower'));
    $('selectUpperBtn').addEventListener('click', () => selectStop('upper'));

    updateWiggleButton();
  }

  function updateWiggleButton() {
    const btn = $('wiggleBtn');
    btn.textContent = state.autoWiggle ? '暂停往复微动' : '开始间隙往复微动';
    btn.classList.toggle('active', state.autoWiggle);
  }

  function presetContact() {
    state.autoWiggle = false;
    updateWiggleButton();
    state.command = CFG.limitLower;
    state.theta = CFG.limitLower;
    state.thetaVelocity = 0;
    state.crossSide = state.theta + CFG.fovHalf >= CFG.targetAngle ? 1 : -1;
    $('pitchSlider').value = state.command.toFixed(2);
    selectStop('lower');
  }

  function stepKinematic(dt) {
    state.time += dt;
    if (state.autoWiggle) {
      const u = (state.time % CFG.wigglePeriod) / CFG.wigglePeriod;
      const tri = u < 0.5 ? u * 2 : 2 - u * 2;
      const min = CFG.limitLower - 2.6;
      const max = CFG.limitLower + state.backlash + 0.85;
      state.command = min + tri * (max - min);
    }

    const before = state.theta;
    const halfGap = state.backlash / 2;
    let next = before;

    // 标准滞回/死区间隙模型：反向时必须先走过 B，输出才重新跟随。
    if (state.command > before + halfGap) next = state.command - halfGap;
    else if (state.command < before - halfGap) next = state.command + halfGap;

    // 硬限位拥有最高优先级：任何传动/间隙结果都必须被夹在两角之间。
    next = clamp(next, CFG.limitUpper, CFG.limitLower);
    state.theta = next;
    state.thetaVelocity = dt > 1e-5 ? (state.theta - before) / dt : 0;

    const edgeAngle = state.theta + CFG.fovHalf;
    const side = edgeAngle >= CFG.targetAngle ? 1 : -1;
    if (state.crossSide !== 0 && side !== state.crossSide) state.crossCount += 1;
    state.crossSide = side;
  }

  function selectStop(id) {
    state.selectedStop = id;
    state.hasStopCard = true;
    $('stopCard').hidden = false;
    renderStopInspector();
  }

  function stopData(id) {
    if (id === 'upper') {
      return {
        id, name: '上限位挡块', angle: CFG.limitUpper,
        mesh: stopUpper, rule: 'θ ≤ −28° 时判定顶住上限位'
      };
    }
    return {
      id, name: '下限位挡块', angle: CFG.limitLower,
      mesh: stopLower, rule: 'θ ≥ +10° 时判定顶住下限位'
    };
  }

  function renderStopInspector() {
    const id = state.selectedStop;
    if (!id) return;
    const data = stopData(id);
    const delta = state.theta - data.angle;
    const atStop = id === 'lower'
      ? state.theta >= CFG.limitLower - 0.001
      : state.theta <= CFG.limitUpper + 0.001;
    const relation = Math.abs(delta) < 0.002
      ? '刚好顶到，差值为 0'
      : (id === 'lower' ? `距下限位还有 ${Math.abs(delta).toFixed(3)}°` : `距上限位还有 ${Math.abs(delta).toFixed(3)}°`);

    $('stopDl').innerHTML = `
      <dt>${data.name} · 限位角 ${signed(data.angle, 1)}</dt>
      <dd>${data.rule}</dd>
      <dd>当前实际俯仰 θ = <b>${state.theta.toFixed(3)}°</b></dd>
      <dd class="big-delta">Δ = ${signed(delta, 3)}</dd>
      <dd>${relation}；传动间隙 B=${state.backlash.toFixed(2)}° 已计入 θ。</dd>
    `;

    $('stopCardTitle').textContent = data.name;
    $('stopCardBody').innerHTML = `
      <div class="row"><span>限位角</span><strong>${signed(data.angle, 2)}</strong></div>
      <div class="row"><span>当前俯仰 θ</span><strong>${state.theta.toFixed(3)}°</strong></div>
      <div class="delta">${signed(delta, 3)}</div>
      <div class="row"><span>θ − θ限位</span><strong>${delta.toFixed(4)}°</strong></div>
      <div class="row"><span>判定</span><strong style="color:${atStop ? 'var(--green)' : 'var(--amber)'}">${atStop ? '接触限位' : relation}</strong></div>
    `;
  }

  function updateReadouts() {
    $('cmdVal').textContent = state.command.toFixed(2) + '°';
    $('pitchVal').textContent = state.theta.toFixed(2) + '°';
    $('backlashVal').textContent = state.backlash.toFixed(2) + '°';
    $('halfGapVal').textContent = (state.backlash / 2).toFixed(2) + '°';
    $('pitchSlider').value = state.command.toFixed(2);

    const atLower = state.theta >= CFG.limitLower - 0.001;
    const atUpper = state.theta <= CFG.limitUpper + 0.001;
    const contact = $('contactVal');
    if (atLower) {
      contact.textContent = '顶住下限位';
      contact.className = 'danger';
    } else if (atUpper) {
      contact.textContent = '顶住上限位';
      contact.className = 'danger';
    } else {
      contact.textContent = '两角限位之间';
      contact.className = 'ok';
    }

    const edge = state.theta + CFG.fovHalf;
    const crossError = edge - CFG.targetAngle;
    $('edgeVal').textContent = edge.toFixed(2) + '°';
    $('crossVal').textContent = signed(crossError, 2);
    $('crossVal').className = Math.abs(crossError) < 0.12 ? 'warn' : (crossError > 0 ? 'danger' : 'ok');
    $('crossCountVal').textContent = String(state.crossCount);

    const badge = $('crossBadge');
    if (Math.abs(crossError) < 0.12) {
      badge.textContent = '正在越过目标线';
      badge.className = 'badge warn';
    } else if (crossError > 0) {
      badge.textContent = '下缘已越过';
      badge.className = 'badge danger';
    } else {
      badge.textContent = '下缘未到目标';
      badge.className = 'badge good';
    }

    $('deltaLower').textContent = (state.theta - CFG.limitLower).toFixed(3) + '°';
    $('deltaUpper').textContent = (state.theta - CFG.limitUpper).toFixed(3) + '°';

    const pitchDps = state.thetaVelocity;
    const wormDps = CFG.wormRatio * pitchDps;
    const spurDps = wormDps;
    const pinionDps = -CFG.spurRatio * spurDps;
    $('speedPitch').textContent = pitchDps.toFixed(1) + ' °/s';
    $('speedWorm').textContent = rpmText(wormDps);
    $('speedSpur').textContent = rpmText(spurDps);
    $('speedPinion').textContent = rpmText(pinionDps);
    $('speedWheel').textContent = rpmText(pitchDps);

    renderStopInspector();
  }

  function updateMechanism() {
    const pitchRad = state.theta * DEG;
    cameraRig.rotation.x = pitchRad;
    wheelSpin.rotation.x = pitchRad;

    const wormAngle = CFG.wormRatio * pitchRad;
    wormSpin.rotation.z = wormAngle;
    pinionSpin.rotation.z = -CFG.spurRatio * wormAngle;

    const edgeAngle = state.theta + CFG.fovHalf;
    const y = CFG.pitchY - CFG.targetDistance * Math.tan(edgeAngle * DEG);
    edgeMarker.position.set(0, y, CFG.targetDistance);
    const near = Math.abs(edgeAngle - CFG.targetAngle) < 0.12;
    edgeMarker.material.color.set(near ? 0xffffff : 0x22d3ee);
    edgeMarker.scale.setScalar(near ? 1.45 + 0.25 * Math.sin(state.time * 18) : 1);
    edgeLowMaterial.color.set(edgeAngle >= CFG.targetAngle ? 0xfb7185 : 0x22d3ee);

    const selected = state.selectedStop;
    stopLower.material.emissiveIntensity = selected === 'lower' ? 1.15 : 0.55;
    stopUpper.material.emissiveIntensity = selected === 'upper' ? 1.1 : 0.45;
    const pulse = 1 + (selected ? 0.055 * (0.5 + 0.5 * Math.sin(state.time * 9)) : 0);
    stopLower.scale.setScalar(selected === 'lower' ? pulse : 1);
    stopUpper.scale.setScalar(selected === 'upper' ? pulse : 1);

    coverGroup.position.x = CFG.coverX + state.coverProgress * 1.55;
    const labelOpacity = clamp((state.coverProgress - 0.28) / 0.45, 0, 1);
    internalLabels.forEach((label) => { label.material.opacity = labelOpacity; label.visible = labelOpacity > 0.01; });
    const pct = Math.round(state.coverProgress * 100);
    $('coverBtn').textContent = state.coverProgress > 0.5 ? '合上侧板' : '打开侧板';
    $('viewBadge').textContent = state.coverProgress < 0.05
      ? '外壳闭合：拖动蓝色侧板把手打开传动舱'
      : state.coverProgress > 0.95
        ? '侧板已打开：观察 z₁/z₂ 反向转动与蜗轮蜗杆'
        : `侧板打开 ${pct}%：继续向右拖动`;
  }

  function setPointerFromEvent(event) {
    const rect = $('scene').getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pick(event, objects) {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(objects, true);
  }

  function bindPointer() {
    const canvas = $('scene');
    let coverDrag = null;
    let clickStart = null;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const coverHits = pick(event, [coverGroup]);
      if (coverHits.length) {
        coverDrag = { x: event.clientX, progress: state.coverProgress };
        state.coverDragging = true;
        state.coverTarget = state.coverProgress;
        if (controls) controls.enabled = false;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      clickStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, true);

    canvas.addEventListener('pointermove', (event) => {
      if (coverDrag) {
        const dx = event.clientX - coverDrag.x;
        state.coverProgress = clamp(coverDrag.progress + dx / 230, 0, 1);
        state.coverTarget = state.coverProgress;
        $('viewBadge').textContent = `侧板打开 ${Math.round(state.coverProgress * 100)}%`;
        event.preventDefault();
        return;
      }

      const overCover = pick(event, [coverGroup]).length > 0;
      if (overCover) {
        canvas.style.cursor = 'grab';
        return;
      }
      const overStop = pick(event, clickables).length > 0;
      canvas.style.cursor = overStop ? 'pointer' : 'grab';
    });

    function finishPointer(event) {
      if (coverDrag) {
        try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
        coverDrag = null;
        state.coverDragging = false;
        if (controls) controls.enabled = true;
        canvas.style.cursor = 'grab';
        return;
      }

      if (clickStart) {
        const moved = Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y);
        if (moved < 7) {
          const hits = pick(event, clickables);
          if (hits.length) {
            let obj = hits[0].object;
            while (obj && !obj.userData.stopId) obj = obj.parent;
            if (obj && obj.userData.stopId) selectStop(obj.userData.stopId);
          }
        }
      }
      clickStart = null;
    }

    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', () => {
      coverDrag = null;
      clickStart = null;
      state.coverDragging = false;
      if (controls) controls.enabled = true;
    });
  }

  function resize() {
    const stage = $('stage');
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height || !renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    stepKinematic(dt);

    if (!state.coverDragging) {
      const easing = 1 - Math.exp(-dt * 9);
      state.coverProgress += (state.coverTarget - state.coverProgress) * easing;
      if (Math.abs(state.coverTarget - state.coverProgress) < 0.001) {
        state.coverProgress = state.coverTarget;
      }
    }

    updateMechanism();
    updateChart();
    updateReadouts();
    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  init();
})();
