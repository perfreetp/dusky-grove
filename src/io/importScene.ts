import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { isObjectOutsideBelt, uid } from '../core/geometry';
import type { RouteSpec, SceneObject } from '../core/types';
import { importedObject3Ds } from './assetLibrary';

function classifyNode(name: string): Pick<SceneObject, 'kind' | 'deletable' | 'interactive'> {
  const n = name.toLowerCase();
  if (/interact|kiosk|button|btn|交互|按钮|终端/.test(n)) {
    return { kind: 'interactive', deletable: false, interactive: true };
  }
  if (/floor|ground|地面|地坪/.test(n)) {
    return { kind: 'floor', deletable: false, interactive: false };
  }
  if (/wall|墙|door|frame|jamb|门框|门套|墙角/.test(n)) {
    return { kind: /door|frame|门框/.test(n) ? 'door' : 'wall', deletable: false, interactive: false };
  }
  return { kind: 'imported', deletable: true, interactive: false };
}

function materialSummary(mesh: THREE.Mesh): SceneObject['material'] {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!material) return { name: '默认材质' };
  const anyMat = material as THREE.MeshStandardMaterial;
  return {
    name: material.name || material.type,
    color: anyMat.color ? `#${anyMat.color.getHexString()}` : undefined,
    map: Boolean((anyMat as THREE.MeshStandardMaterial).map),
    transparent: material.transparent,
  };
}

function createFileManager(files: File[]): THREE.LoadingManager {
  const byName = new Map<string, File>();
  for (const file of files) byName.set(file.name.toLowerCase(), file);

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    try {
      const withoutQuery = url.split(/[?#]/)[0];
      const rawName = decodeURIComponent(withoutQuery.split('/').pop() ?? withoutQuery);
      const file = byName.get(rawName.toLowerCase());
      if (file) return URL.createObjectURL(file);
    } catch {
      // Fall through to original URL for blob/data URLs.
    }
    return url;
  });
  return manager;
}

async function loadRoot(file: File, files: File[]): Promise<THREE.Object3D> {
  const manager = createFileManager(files);
  const url = URL.createObjectURL(file);
  try {
    if (/\.glb$/i.test(file.name) || /\.gltf$/i.test(file.name)) {
      const gltf = await new GLTFLoader(manager).loadAsync(url);
      return gltf.scene;
    }

    if (/\.obj$/i.test(file.name)) {
      const mtlFile = files.find((f) => /\.mtl$/i.test(f.name));
      const loader = new OBJLoader(manager);
      if (mtlFile) {
        const materials = await new MTLLoader(manager).loadAsync(URL.createObjectURL(mtlFile));
        materials.preload();
        loader.setMaterials(materials);
      }
      return await loader.loadAsync(url);
    }
    throw new Error(`不支持的模型格式：${file.name}`);
  } finally {
    // Deliberately do not revoke external resource URLs: textures/bin buffers
    // may continue to stream into GPU upload during the first render.
  }
}

export interface ImportResult {
  objects: SceneObject[];
  meshCount: number;
  fileNames: string[];
}

export async function importSceneFiles(files: File[], route: RouteSpec): Promise<ImportResult> {
  const models = files.filter((f) => /\.(glb|gltf|obj)$/i.test(f.name));
  if (!models.length) throw new Error('请选择 .glb / .gltf / .obj 模型文件（可连同 .bin、贴图、.mtl 一起多选）。');

  const objects: SceneObject[] = [];
  const fileNames = models.map((f) => f.name);

  for (const file of models) {
    const root = await loadRoot(file, files);
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });

    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) continue;

      const sizeVec = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(sizeVec);
      box.getCenter(center);
      if (sizeVec.lengthSq() < 1e-8) continue;

      const id = uid('imported');
      const wrapper = new THREE.Group();
      wrapper.name = id;
      wrapper.position.set(center.x, 0, center.z);
      wrapper.userData.objectId = id;
      mesh.userData.objectId = id;
      wrapper.attach(mesh);
      wrapper.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      importedObject3Ds.set(id, wrapper);

      const size: [number, number, number] = [sizeVec.x, sizeVec.y, sizeVec.z];
      const classification = classifyNode(mesh.name || file.name);
      const candidate: SceneObject = {
        id,
        name: mesh.name?.trim() || `${file.name} · mesh ${objects.length + 1}`,
        ...classification,
        selectable: true,
        outsideBelt: false,
        position: [center.x, 0, center.z],
        rotationY: 0,
        size,
        color: materialSummary(mesh)?.color ?? '#94a3b8',
        material: materialSummary(mesh),
        assetId: id,
        fileName: file.name,
        nodeName: mesh.name,
        colliders: [
          {
            id: `${id}-imported-col`,
            objectId: id,
            center: [center.x, center.y, center.z],
            size,
            rotationY: 0,
            enabled: true,
            source: 'imported',
            label: '导入网格世界包围盒碰撞（可随后简化/重做）',
          },
        ],
        artCategory: classification.kind === 'decoration' || classification.kind === 'imported' ? '导入装饰' : '导入结构',
      };
      candidate.outsideBelt = isObjectOutsideBelt(candidate, route);
      objects.push(candidate);
    }
  }

  if (!objects.length) throw new Error('模型文件中没有找到可导入的 Mesh。');
  return { objects, meshCount: objects.length, fileNames };
}
