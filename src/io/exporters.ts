import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { activeObjects } from '../core/geometry';
import type { DeletedArtRecord, EditorState, ExportHandoff, ProbeReport } from '../core/types';
import { getDeletedArtRecords } from '../state/editor';

export function downloadTextFile(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildHandoff(state: EditorState, report: ProbeReport | null): ExportHandoff {
  const objects = activeObjects(state);
  const objectById = new Map(objects.map((o) => [o.id, o]));
  const colliders = objects.flatMap((o) =>
    o.colliders
      .filter((c) => c.enabled)
      .map((c) => ({ ...c, objectName: o.name, kind: o.kind })),
  );

  return {
    format: 'routeclear-level-handoff',
    version: 1,
    exportedAt: new Date().toISOString(),
    unit: 'metre',
    coordinateSystem: 'three-y-up',
    projectName: state.projectName,
    route: state.route,
    workBounds: state.workBounds,
    collisionInflation: state.collisionInflation,
    geometry: {
      glbFile: 'routeclear-simplified-scene.glb',
      root: 'RouteClear_SimplifiedRoot',
      simplifiedObjectIds: objects.filter((o) => o.kind === 'simplified').map((o) => o.id),
    },
    colliders,
    probe: {
      radius: state.route.probeRadius,
      height: state.route.probeHeight,
      verticalRadius: state.route.probeVerticalRadius,
      lastReport: report ?? undefined,
    },
    deletedArt: getDeletedArtRecords(),
  };
}

export function deletedArtCsv(records: DeletedArtRecord[]): string {
  const header = ['ID', '名称', '分类', '材质', '尺寸(m)', '来源文件', '节点', '删除批次', '删除时间'];
  const escape = (value: unknown) => {
    const s = value == null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map((r) =>
    [r.id, r.name, r.category, r.materialName, r.dimensions, r.fileName ?? '', r.nodeName ?? '', r.historyLabel, r.deletedAt]
      .map(escape)
      .join(','),
  );
  return `﻿${[header.join(','), ...rows].join('\n')}`;
}

export async function exportRootToGLB(root: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
    trs: false,
    includeCustomExtensions: true,
  });
  if (result instanceof ArrayBuffer) return new Blob([result], { type: 'model/gltf-binary' });
  return new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
}
