// Procedural terrain: an FBM heightfield rendered as a grid that slides with
// the aircraft (a fixed-resolution window re-centered and re-uploaded as the
// plane moves). Near the airport the terrain is forced flat so the runway sits
// on level ground.

import { Mesh } from '../engine/mesh.js';
import { fbm } from './noise.js';
import { clamp } from '../math.js';
import { RUNWAY } from '../sim/state.js';

const TILE = 50;          // grid cell size (m)
const HALF = 40;          // cells from center to edge -> (2*HALF) cells across
const FREQ = 0.0009;      // horizontal noise frequency
const AMP = 320;          // max terrain height (m)
const FLAT_RADIUS = 1400; // airport flatten radius (m)
const FLAT_FADE = 800;    // fade band

// Sample world ground height at (x,y). Shared by physics & rendering.
export function groundHeight(x, y) {
  // distance from runway centerline region
  const cx = RUNWAY.origin[0];
  const cy = RUNWAY.origin[1] + RUNWAY.length * 0.5;
  const d = Math.hypot(x - cx, y - cy);
  let h = (fbm(x * FREQ + 1000, y * FREQ + 1000, 5) - 0.35) * AMP;
  if (h < 0) h *= 0.25; // shallow valleys
  // ridged detail
  h += (fbm(x * FREQ * 3.1 + 50, y * FREQ * 3.1 + 50, 3) - 0.5) * 40;
  // flatten near airport
  if (d < FLAT_RADIUS) return 0;
  if (d < FLAT_RADIUS + FLAT_FADE) {
    const t = clamp((d - FLAT_RADIUS) / FLAT_FADE, 0, 1);
    return h * (t * t * (3 - 2 * t));
  }
  return h;
}

function colorForHeight(h, slope) {
  // grass -> rock -> snow, darkened by slope a bit
  let c;
  if (h < 60) c = [0.28, 0.42, 0.18];
  else if (h < 160) c = [0.34, 0.40, 0.22];
  else if (h < 240) c = [0.42, 0.38, 0.32];
  else c = [0.85, 0.88, 0.92];
  const shade = clamp(1 - slope * 1.5, 0.6, 1);
  return [c[0] * shade, c[1] * shade, c[2] * shade];
}

export function terrainIndices(nx, ny) {
  const indices = [];
  const stride = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Counter-clockwise when viewed from above (+Z), matching gl.frontFace.
      indices.push(a, b, c, b, d, c);
    }
  }
  return indices;
}

export class Terrain {
  constructor(gl) {
    this.gl = gl;
    this.nx = HALF * 2;
    this.ny = HALF * 2;
    const verts = (this.nx + 1) * (this.ny + 1);
    this.positions = new Float32Array(verts * 3);
    this.normals = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 3);
    const indices = terrainIndices(this.nx, this.ny);
    this.mesh = new Mesh(gl, {
      positions: this.positions,
      normals: this.normals,
      colors: this.colors,
      indices,
      dynamic: true,
    });
    this.centerI = NaN; this.centerJ = NaN;
    this.rebuild(0, 0);
  }

  // Re-center the window on the aircraft, snapped to the tile grid.
  rebuild(px, py) {
    const ci = Math.round(px / TILE);
    const cj = Math.round(py / TILE);
    if (ci === this.centerI && cj === this.centerJ) return;
    this.centerI = ci; this.centerJ = cj;
    const stride = this.nx + 1;
    const ox = (ci - HALF) * TILE;
    const oy = (cj - HALF) * TILE;
    const P = this.positions;
    for (let j = 0; j <= this.ny; j++) {
      for (let i = 0; i <= this.nx; i++) {
        const idx = (j * stride + i) * 3;
        const x = ox + i * TILE;
        const y = oy + j * TILE;
        P[idx] = x; P[idx + 1] = y; P[idx + 2] = groundHeight(x, y);
      }
    }
    // compute normals & colors from neighbouring heights
    const N = this.normals, C = this.colors;
    for (let j = 0; j <= this.ny; j++) {
      for (let i = 0; i <= this.nx; i++) {
        const idx = (j * stride + i);
        const x = ox + i * TILE, y = oy + j * TILE;
        const hl = groundHeight(x - TILE, y), hr = groundHeight(x + TILE, y);
        const hd = groundHeight(x, y - TILE), hu = groundHeight(x, y + TILE);
        // normal of heightfield
        let nx = (hl - hr), ny = (hd - hu), nz = 2 * TILE;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        N[idx * 3] = nx; N[idx * 3 + 1] = ny; N[idx * 3 + 2] = nz;
        const slope = 1 - nz;
        const c = colorForHeight(P[idx * 3 + 2], slope);
        C[idx * 3] = c[0]; C[idx * 3 + 1] = c[1]; C[idx * 3 + 2] = c[2];
      }
    }
    this.mesh.update({ positions: this.positions, normals: this.normals, colors: this.colors });
  }

  draw() { this.mesh.draw(); }
}
