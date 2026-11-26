import * as THREE from 'three';
import initManifold from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
// Vite emits and hashes the WASM asset; locateFile prevents wrong relative paths.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import type { BoxCollider, SceneObject, Vec3 } from '../core/types';

let manifoldPromise: Promise<ManifoldToplevel> | null = null;

export function getManifold(): Promise<ManifoldToplevel> {
  if (!manifoldPromise) {
    manifoldPromise = initManifold({
      locateFile: () => manifoldWasmUrl,
    }).then((mod) => {
      mod.setup();
      return mod;
    });
  }
  return manifoldPromise;
}

export interface WorldBoxSpec {
  center: Vec3;
  size: Vec3;
  rotationY?: number;
}

export async function boxesToHullGeometry(boxes: WorldBoxSpec[]): Promise<{
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  volume: number;
}> {
  const wasm = await getManifold();
  const { Manifold } = wasm;
  const sourceManifolds = boxes.map((box) => {
    const m = Manifold.cube(box.size as [number, number, number], true);
    const degrees = THREE.MathUtils.radToDeg(box.rotationY ?? 0);
    return m.rotate([0, degrees, 0]).translate(box.center as [number, number, number]);
  });

  try {
    const merged = Manifold.union(sourceManifolds);
    const hull = merged.hull();
    const mesh = hull.getMesh();
    const positionCount = mesh.vertProperties.length / mesh.numProp;
    const positions = new Float32Array(positionCount * 3);
    for (let i = 0; i < positionCount; i++) {
      positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
      positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts.slice(), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const result = {
      geometry,
      vertexCount: hull.numVert(),
      volume: hull.volume(),
    };

    hull.delete();
    merged.delete();
    return result;
  } finally {
    for (const m of sourceManifolds) m.delete();
  }
}

/** Visual boxes (not stale collision-only boxes) used for groove hulling. */
export function visualBoxesForObjects(objects: SceneObject[]): WorldBoxSpec[] {
  const boxes: WorldBoxSpec[] = [];
  for (const obj of objects) {
    if (obj.deleted || obj.hiddenBySimplify) continue;
    if (obj.parts?.length) {
      const cos = Math.cos(obj.rotationY);
      const sin = Math.sin(obj.rotationY);
      for (const part of obj.parts) {
        const lp = part.position;
        const rotated: Vec3 = [
          lp[0] * cos + lp[2] * sin,
          lp[1],
          -lp[0] * sin + lp[2] * cos,
        ];
        boxes.push({
          center: [
            obj.position[0] + rotated[0],
            obj.position[1] + rotated[1],
            obj.position[2] + rotated[2],
          ],
          size: part.size,
          rotationY: obj.rotationY,
        });
      }
    } else if (obj.size) {
      boxes.push({
        center: [
          obj.position[0],
          obj.position[1] + obj.size[1] / 2,
          obj.position[2],
        ],
        size: obj.size,
        rotationY: obj.rotationY,
      });
    }
  }
  return boxes;
}

export function colliderBoxesForExport(colliders: BoxCollider[]): WorldBoxSpec[] {
  return colliders.map((c) => ({ center: c.center, size: c.size, rotationY: c.rotationY }));
}

/** Non-reactive registry: Solid state stores the id, Three owns GPU geometry. */
export const manifoldGeometries = new Map<string, THREE.BufferGeometry>();
