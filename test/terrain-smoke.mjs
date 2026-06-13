import assert from 'node:assert/strict';
import { groundHeight, runwaySurfaceHeight, terrainIndices } from '../src/world/terrain.js';
import {
  RUNWAY_CHANCE, runwayForChunk, runwaysInRadius,
} from '../src/world/runway-layout.js';

const vertices = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
];
const [ia, ib, ic] = terrainIndices(1, 1);
const a = vertices[ia], b = vertices[ib], c = vertices[ic];
const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
const normalZ = ab[0] * ac[1] - ab[1] * ac[0];

assert(normalZ > 0, 'terrain triangles must face upward with CCW front faces');

assert(RUNWAY_CHANCE > 0 && RUNWAY_CHANCE < 1, 'runway generation must be probabilistic');
const generated = [];
for (let j = -20; j <= 20; j++) {
  for (let i = -20; i <= 20; i++) {
    const runway = runwayForChunk(i, j);
    if (runway && (i !== 0 || j !== 0)) generated.push(runway);
  }
}
assert(generated.length > 0, 'sampled chunks must generate some remote runways');
assert(generated.length < 41 * 41, 'not every chunk should contain a runway');
assert.deepEqual(runwayForChunk(7, -3), runwayForChunk(7, -3), 'chunk generation must be stable');

for (const runway of generated.slice(0, 20)) {
  const x = runway.origin[0] + Math.sin(runway.heading) * runway.length * 0.5;
  const y = runway.origin[1] + Math.cos(runway.heading) * runway.length * 0.5;
  assert(
    Math.abs(groundHeight(x, y) - runwaySurfaceHeight(runway)) < 1e-9,
    'runway center must be flattened to its sampled surrounding height'
  );
  const edgeX = x + Math.cos(runway.heading) * (runway.width / 2 + 60);
  const edgeY = y - Math.sin(runway.heading) * (runway.width / 2 + 60);
  assert(
    Math.abs(groundHeight(edgeX, edgeY) - runwaySurfaceHeight(runway)) < 1e-9,
    'runway shoulders must remain flat enough for coarse render grids'
  );
}
assert(runwaysInRadius(0, 0, 1000).some((runway) => runway.origin[0] === 0 && runway.origin[1] === 0));
console.log('TERRAIN TESTS PASSED');
