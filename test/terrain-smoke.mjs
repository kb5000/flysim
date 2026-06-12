import assert from 'node:assert/strict';
import { terrainIndices } from '../src/world/terrain.js';

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
console.log('TERRAIN TESTS PASSED');
