import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  X_MIN, X_MAX, Y_MIN, Y_MAX, D_MAX,
  FAULT_Y0, FAULT_DIP, HORIZONS,
  baseDepthAt, faultEnvelope, localThrowAt, clamp, sliceBounds
} from './model.js';

export function createBlockScene(host, ampCanvas, hooks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '可旋转的三维地层块，拖动青色剖切面');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9f1f8);
  scene.fog = new THREE.Fog(0xe9f1f8, 18, 34);

  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  const defaultCam = new THREE.Vector3(8.7, 4.9, 9.7);
  const defaultTarget = new THREE.Vector3(0, -2.55, 0);
  camera.position.copy(defaultCam);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(defaultTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 6.5;
  controls.maxDistance = 25;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7c90, 1.65));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(6, 11, 7);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9bd5ff, 0.65);
  fill.position.set(-8, 4, -6);
  scene.add(fill);

  const boxClipPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -X_MIN),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), X_MAX),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), D_MAX),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -Y_MIN),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), Y_MAX)
  ];

  // Transparent block and edges.
  const blockGeo = new THREE.BoxGeometry(X_MAX - X_MIN, D_MAX, Y_MAX - Y_MIN);
  blockGeo.translate(0, -D_MAX / 2, 0);
  const block = new THREE.Mesh(
    blockGeo,
    new THREE.MeshBasicMaterial({ color: 0xb9d8f4, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false })
  );
  block.renderOrder = 0;
  scene.add(block);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(blockGeo),
    new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.58 })
  );
  scene.add(edges);

  const grid = new THREE.GridHelper(X_MAX - X_MIN, 10, 0x7aa2c7, 0xb7c9dc);
  grid.position.y = 0.012;
  grid.scale.z = (Y_MAX - Y_MIN) / (X_MAX - X_MIN);
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  scene.add(grid);

  // Inclined fault plane.
  const faultBottomY = FAULT_Y0 + FAULT_DIP * D_MAX;
  const faultGeo = new THREE.BufferGeometry();
  faultGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    X_MIN, 0.015, FAULT_Y0,
    X_MAX, 0.015, FAULT_Y0,
    X_MAX, -D_MAX, faultBottomY,
    X_MIN, -D_MAX, faultBottomY
  ], 3));
  faultGeo.setIndex([0, 1, 2, 0, 2, 3]);
  faultGeo.computeVertexNormals();
  const faultMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.20,
    roughness: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    clippingPlanes: boxClipPlanes
  });
  const faultMesh = new THREE.Mesh(faultGeo, faultMat);
  faultMesh.renderOrder = 2;
  scene.add(faultMesh);
  const faultEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(faultGeo),
    new THREE.LineBasicMaterial({ color: 0x991b1b, transparent: true, opacity: 0.95 })
  );
  scene.add(faultEdge);

  // Undulating horizon patches, split into two fault walls.
  const MX = 142, MY = 100;
  const records = [];

  HORIZONS.forEach((h, i) => {
    const vertCount = (MX + 1) * (MY + 1);
    const positions = new Float32Array(vertCount * 3);
    const baseD = new Float32Array(vertCount);
    const sides = new Int8Array(vertCount);

    for (let iy = 0; iy <= MY; iy++) {
      const y = Y_MIN + (Y_MAX - Y_MIN) * iy / MY;
      for (let ix = 0; ix <= MX; ix++) {
        const x = X_MIN + (X_MAX - X_MIN) * ix / MX;
        const id = iy * (MX + 1) + ix;
        const d0 = baseDepthAt(i, x, y);
        const side = y - FAULT_Y0 - FAULT_DIP * d0 >= 0 ? 1 : -1;
        baseD[id] = d0;
        sides[id] = side;
        const t = localThrowAt(x, hooks.getThrow());
        const d = d0 + side * t / 2;
        const yd = y + side * FAULT_DIP * t / 2;
        positions[id * 3] = x;
        positions[id * 3 + 1] = -d;
        positions[id * 3 + 2] = yd;
      }
    }

    const plus = [], minus = [];
    const id = (ix, iy) => iy * (MX + 1) + ix;
    for (let iy = 0; iy < MY; iy++) {
      for (let ix = 0; ix < MX; ix++) {
        const a = id(ix, iy), b = id(ix + 1, iy), c = id(ix + 1, iy + 1), d = id(ix, iy + 1);
        if (sides[a] === 1 && sides[b] === 1 && sides[c] === 1 && sides[d] === 1) plus.push(a, b, d, b, c, d);
        if (sides[a] === -1 && sides[b] === -1 && sides[c] === -1 && sides[d] === -1) minus.push(a, b, d, b, c, d);
      }
    }

    const attr = new THREE.BufferAttribute(positions, 3);
    const mat = new THREE.MeshStandardMaterial({
      color: h.color,
      roughness: 0.88,
      metalness: 0.02,
      transparent: true,
      opacity: 0.66,
      side: THREE.DoubleSide,
      depthWrite: false,
      clippingPlanes: boxClipPlanes
    });

    const geoPlus = new THREE.BufferGeometry();
    geoPlus.setAttribute('position', attr);
    geoPlus.setIndex(plus);
    geoPlus.computeVertexNormals();
    const geoMinus = new THREE.BufferGeometry();
    geoMinus.setAttribute('position', attr);
    geoMinus.setIndex(minus);
    geoMinus.computeVertexNormals();

    const meshPlus = new THREE.Mesh(geoPlus, mat);
    const meshMinus = new THREE.Mesh(geoMinus, mat);
    meshPlus.renderOrder = 1;
    meshMinus.renderOrder = 1;
    scene.add(meshPlus, meshMinus);
    records.push({ attr, baseD, sides, geoPlus, geoMinus });
  });

  // Live amplitude section texture.
  const texture = new THREE.CanvasTexture(ampCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const sectionGeo = new THREE.PlaneGeometry(1, D_MAX);
  sectionGeo.translate(0, -D_MAX / 2, 0);
  const sectionMat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.965
  });
  const sectionMesh = new THREE.Mesh(sectionGeo, sectionMat);
  sectionMesh.renderOrder = 8;
  scene.add(sectionMesh);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(sectionGeo),
    new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 1 })
  );
  sectionMesh.add(frame);

  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 28, 18),
    new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      emissive: 0x0e7490,
      emissiveIntensity: 0.8,
      depthTest: false
    })
  );
  handle.renderOrder = 20;
  scene.add(handle);

  function updateTransform() {
    const mode = hooks.getMode();
    const s = hooks.getSlice();
    if (mode === 'dip') {
      sectionMesh.rotation.set(0, -Math.PI / 2, 0);
      sectionMesh.position.set(s, 0.035, 0);
      sectionMesh.scale.set(Y_MAX - Y_MIN, 1, 1);
      handle.position.set(s, 0.42, 0);
    } else {
      sectionMesh.rotation.set(0, 0, 0);
      sectionMesh.position.set(0, 0.035, s);
      sectionMesh.scale.set(X_MAX - X_MIN, 1, 1);
      handle.position.set(0, 0.42, s);
    }
  }

  function updateHorizons() {
    const throwValue = hooks.getThrow();
    for (const rec of records) {
      const arr = rec.attr.array;
      let k = 0, id = 0;
      for (let iy = 0; iy <= MY; iy++) {
        const y = Y_MIN + (Y_MAX - Y_MIN) * iy / MY;
        for (let ix = 0; ix <= MX; ix++) {
          const x = X_MIN + (X_MAX - X_MIN) * ix / MX;
          const side = rec.sides[id];
          const d0 = rec.baseD[id];
          const t = localThrowAt(x, throwValue);
          arr[k++] = x;
          arr[k++] = -(d0 + side * t / 2);
          arr[k++] = y + side * FAULT_DIP * t / 2;
          id++;
        }
      }
      rec.attr.needsUpdate = true;
      rec.geoPlus.computeVertexNormals();
      rec.geoMinus.computeVertexNormals();
    }
  }

  // Direct dragging of the section plane.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  let drag = null;

  function setRayFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function pickSection(event) {
    setRayFromEvent(event);
    return raycaster.intersectObjects([sectionMesh, handle], true);
  }

  window.addEventListener('pointerdown', event => {
    if (event.target !== renderer.domElement) return;
    const hits = pickSection(event);
    if (!hits.length) return;
    event.preventDefault();
    event.stopPropagation();

    const mode = hooks.getMode();
    if (mode === 'dip') dragPlane.normal.set(0, 0, 1);
    else dragPlane.normal.set(1, 0, 0);
    dragPlane.constant = 0;
    raycaster.ray.intersectPlane(dragPlane, hitPoint);
    drag = {
      pointerId: event.pointerId,
      mode,
      startSlice: hooks.getSlice(),
      startAxis: mode === 'dip' ? hitPoint.x : hitPoint.z
    };
    controls.enabled = false;
    try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* noop */ }
    renderer.domElement.style.cursor = 'grabbing';
  }, true);

  window.addEventListener('pointermove', event => {
    if (drag) {
      setRayFromEvent(event);
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        const axis = drag.mode === 'dip' ? hitPoint.x : hitPoint.z;
        const bounds = sliceBounds(drag.mode);
        const next = clamp(drag.startSlice + axis - drag.startAxis, bounds.min, bounds.max);
        hooks.onSliceDrag(next, drag.mode);
      }
      return;
    }
    if (event.target === renderer.domElement) {
      const hits = pickSection(event);
      renderer.domElement.style.cursor = hits.length ? 'grab' : 'default';
    }
  });

  function endDrag(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    drag = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = 'default';
    try { renderer.domElement.releasePointerCapture(event.pointerId); } catch { /* noop */ }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  updateTransform();

  function resetCamera() {
    camera.position.copy(defaultCam);
    controls.target.copy(defaultTarget);
    controls.update();
  }

  function start(frame) {
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      frame?.(dt);
      controls.update();
      renderer.render(scene, camera);
    });
  }

  return {
    texture,
    updateTransform,
    updateHorizons,
    resetCamera,
    start,
    faultEnvelopeAt: faultEnvelope
  };
}
