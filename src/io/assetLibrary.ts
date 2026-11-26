import type * as THREE from 'three';

/** Non-reactive storage for imported glTF/OBJ Object3D roots and GPU assets. */
export const importedObject3Ds = new Map<string, THREE.Object3D>();

export function clearImportedObjects() {
  importedObject3Ds.clear();
}
