import assert from 'node:assert/strict';
import { createDemoState } from '../src/core/demoScene.ts';
import {
  computeWidthSamples,
  isObjectOutsideBelt,
  minimumWidth,
  runProbe,
  snapObjectPosition,
  footprintInsideBounds,
} from '../src/core/geometry.ts';
import { planFlatten } from '../src/core/simplify.ts';
import type { EditorState } from '../src/core/types.ts';

function activeDecorations(s: EditorState) {
  return s.objects.filter((o) => o.kind === 'decoration' && !o.deleted);
}

// 1. The shipped demo must reproduce the playtest failure at corner 7.
const initial = createDemoState();
const initialProbe = runProbe(initial);
assert.equal(initialProbe.status, 'blocked', 'initial probe should be blocked');
assert.equal(initialProbe.firstHit?.objectId, 'door7-groove');
assert.ok(
  Math.abs((initialProbe.firstHit?.heightAboveFloor ?? -1) - initial.route.probeHeight) < 0.001,
  'hit marker should report probe center height',
);
console.log('✓ initial probe blocks at', initialProbe.firstHit?.objectName, initialProbe.firstHit?.heightAboveFloor.toFixed(2), 'm');

// 2. Every art decoration in the demo is genuinely outside the swept belt.
const decorations = activeDecorations(initial);
assert.ok(decorations.length >= 14, 'demo should contain a batch of decorative pieces');
for (const decoration of decorations) {
  assert.equal(
    isObjectOutsideBelt(decoration, initial.route),
    true,
    `${decoration.name} should be outside route belt`,
  );
}
const initialMinWidth = minimumWidth(computeWidthSamples(initial));
assert.ok(initialMinWidth && initialMinWidth.width < initial.route.clearWidthTarget);
console.log('✓ eligible decorations:', decorations.length, '; initial min width', initialMinWidth.width.toFixed(2), 'm');

// 3. Batch delete all decorations; width/probe recompute and structural collision remains.
const afterDelete = structuredClone(initial);
for (const o of afterDelete.objects) {
  if (o.kind === 'decoration') o.deleted = true;
}
const deletedProbe = runProbe(afterDelete);
assert.equal(deletedProbe.status, 'blocked');
assert.equal(deletedProbe.firstHit?.objectId, 'door7-groove');
const afterDeleteMinWidth = minimumWidth(computeWidthSamples(afterDelete));
assert.ok(afterDeleteMinWidth);
assert.ok(afterDeleteMinWidth.width > (initialMinWidth?.width ?? 0));
console.log('✓ after batch delete min width', afterDeleteMinWidth.width.toFixed(2), 'm; groove still blocks probe');

// 4. Flatten the groove/jamb group and rebuild a slightly thicker collider.
const sources = afterDelete.objects.filter((o) => ['door7-groove', 'door7-north-jamb'].includes(o.id));
const plan = planFlatten(sources, afterDelete.route, afterDelete.collisionInflation, {
  vertexCount: 42,
  volume: 1,
});
const afterFlatten: EditorState = structuredClone(afterDelete);
for (const o of afterFlatten.objects) {
  if (plan.sourceIds.includes(o.id)) o.hiddenBySimplify = true;
}
afterFlatten.objects.push(plan.replacement);

const thickCollider = plan.replacement.colliders[0];
assert.equal(thickCollider.source, 'thickened');
assert.equal(thickCollider.inflation, afterFlatten.collisionInflation);
const flatProbe = runProbe(afterFlatten);
assert.equal(flatProbe.status, 'pass', `probe should pass after flattening, got ${flatProbe.firstHit?.objectName}`);
const flatMinWidth = minimumWidth(computeWidthSamples(afterFlatten));
assert.ok(flatMinWidth && flatMinWidth.width >= afterFlatten.route.clearWidthTarget - 0.02);
console.log('✓ flattened segment passes probe; min width', flatMinWidth.width.toFixed(2), 'm');

// 5. Undo is represented by restoring the exact pre-command snapshot.
const restored = structuredClone(initial);
const restoredProbe = runProbe(restored);
assert.equal(restoredProbe.status, 'blocked');
assert.equal(restored.objects.find((o) => o.id === 'door7-groove')?.hiddenBySimplify, undefined);
assert.equal(restored.objects.some((o) => o.kind === 'simplified'), false);
const grooveCollider = restored.objects
  .find((o) => o.id === 'door7-groove')
  ?.colliders.find((c) => c.id === 'door7-groove-bad-collider');
assert.ok(grooveCollider, 'undo snapshot must restore original collision body');
console.log('✓ undo snapshot restores original object positions and collision bodies');

// 6. Snap and boundary rules.
const simplified = plan.replacement;
const gridSnap = snapObjectPosition(
  [simplified.position[0] + 0.08, 0, simplified.position[2] + 0.09],
  simplified,
  [],
  afterFlatten.gridSize,
  afterFlatten.snapDistance,
);
assert.ok(Math.abs(gridSnap.position[0] - Math.round(gridSnap.position[0] / 0.25) * 0.25) < 1e-9);
assert.ok(gridSnap.snappedX && gridSnap.snappedZ);

const wallSnap = snapObjectPosition(
  [simplified.position[0] + 0.05, 0, simplified.position[2] + 0.05],
  simplified,
  afterFlatten.objects,
  afterFlatten.gridSize,
  afterFlatten.snapDistance,
);
assert.ok(wallSnap.candidates.some((line) => line.includes('贴')));

const outOfBounds = structuredClone(simplified);
outOfBounds.position = [50, 0, 50];
assert.equal(footprintInsideBounds(outOfBounds.position, outOfBounds, afterFlatten.workBounds), false);
console.log('✓ grid snapping and out-of-bounds spring rejection work');

console.log('\nAll logic checks passed.');
