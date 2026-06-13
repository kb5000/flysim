// Procedural terrain: an FBM heightfield rendered as a grid that slides with
// the aircraft (a fixed-resolution window re-centered and re-uploaded as the
// plane moves). Near the airport the terrain is forced flat so the runway sits
// on level ground.

import { Mesh } from '../engine/mesh.js';
import { fbm } from './noise.js';
import { clamp } from '../math.js';
import { RUNWAY } from '../sim/state.js';
import { runwaysNearPoint } from './runway-layout.js';

const DEFAULT_DISTANCE = 6000;
const GRID_HALF = 100;    // fixed vertex budget; spacing scales with distance
const STREAM_ROWS_PER_FRAME = 3;
const FREQ = 0.0009;      // horizontal noise frequency
const AMP = 320;          // max terrain height (m)
const RUNWAY_FLAT_MARGIN = 80;
const RUNWAY_FADE = 320;
const runwayHeights = new WeakMap();

function rawTerrainHeight(x, y) {
  let h = (fbm(x * FREQ + 1000, y * FREQ + 1000, 5) - 0.35) * AMP;
  if (h < 0) h *= 0.25; // shallow valleys
  h += (fbm(x * FREQ * 3.1 + 50, y * FREQ * 3.1 + 50, 3) - 0.5) * 40;
  return h;
}

export function runwaySurfaceHeight(runway) {
  if (runway === RUNWAY) return 0;
  if (runwayHeights.has(runway)) return runwayHeights.get(runway);
  const dir = [Math.sin(runway.heading), Math.cos(runway.heading)];
  const side = [Math.cos(runway.heading), -Math.sin(runway.heading)];
  const margin = RUNWAY_FADE * 0.7;
  let sum = 0;
  let samples = 0;
  for (let i = 0; i <= 8; i++) {
    const along = runway.length * i / 8;
    for (const cross of [-runway.width / 2 - margin, runway.width / 2 + margin]) {
      const x = runway.origin[0] + dir[0] * along + side[0] * cross;
      const y = runway.origin[1] + dir[1] * along + side[1] * cross;
      sum += rawTerrainHeight(x, y);
      samples++;
    }
  }
  const height = sum / samples;
  runwayHeights.set(runway, height);
  return height;
}

function runwayDistance(x, y, runway) {
  const dx = x - runway.origin[0];
  const dy = y - runway.origin[1];
  const along = dx * Math.sin(runway.heading) + dy * Math.cos(runway.heading);
  const cross = dx * Math.cos(runway.heading) - dy * Math.sin(runway.heading);
  const outsideAlong = Math.max(
    -along - RUNWAY_FLAT_MARGIN,
    along - runway.length - RUNWAY_FLAT_MARGIN,
    0
  );
  const outsideCross = Math.max(
    Math.abs(cross) - runway.width / 2 - RUNWAY_FLAT_MARGIN,
    0
  );
  return Math.hypot(outsideAlong, outsideCross);
}

// Sample world ground height at (x,y). Shared by physics, rendering and map.
export function groundHeight(x, y) {
  let height = rawTerrainHeight(x, y);
  let nearest = null;
  let nearestDistance = Infinity;
  for (const runway of runwaysNearPoint(x, y, RUNWAY_FADE)) {
    const distance = runwayDistance(x, y, runway);
    if (distance < nearestDistance) {
      nearest = runway;
      nearestDistance = distance;
    }
  }
  if (nearestDistance < RUNWAY_FADE) {
    const t = clamp(nearestDistance / RUNWAY_FADE, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    height = runwaySurfaceHeight(nearest) * (1 - smooth) + height * smooth;
  }
  return height;
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
    this.initialized = false;
    this.lastPosition = [0, 0];
    this.setRenderDistance(DEFAULT_DISTANCE);
  }

  setRenderDistance(distance) {
    const nextDistance = clamp(distance, 4000, 8000);
    if (this.renderDistance === nextDistance) return;
    this.renderDistance = nextDistance;
    this.half = GRID_HALF;
    this.tile = nextDistance / GRID_HALF;
    this.nx = GRID_HALF * 2;
    this.ny = GRID_HALF * 2;
    if (!this.mesh) {
      const verts = (this.nx + 1) * (this.ny + 1);
      this.positions = new Float32Array(verts * 3);
      this.normals = new Float32Array(verts * 3);
      this.colors = new Float32Array(verts * 3);
      this.nextPositions = new Float32Array(verts * 3);
      this.nextNormals = new Float32Array(verts * 3);
      this.nextColors = new Float32Array(verts * 3);
      this.mesh = new Mesh(this.gl, {
        positions: this.positions,
        normals: this.normals,
        colors: this.colors,
        indices: terrainIndices(this.nx, this.ny),
        dynamic: true,
      });
    }
    this.centerI = NaN;
    this.centerJ = NaN;
    this.pending = null;
    if (!this.initialized) {
      this._startBuild(0, 0);
      while (this.pending) this._advanceBuild(this.ny + 1);
      this.initialized = true;
    } else {
      this._startBuild(
        Math.round(this.lastPosition[0] / this.tile),
        Math.round(this.lastPosition[1] / this.tile)
      );
    }
  }

  // Stream a replacement terrain window over several frames. The current mesh
  // remains intact until all rows are ready, avoiding partially rebuilt strips.
  updateStreaming(px, py) {
    this.lastPosition[0] = px;
    this.lastPosition[1] = py;
    const tile = this.tile;
    const centerX = Number.isFinite(this.centerI) ? this.centerI * tile : 0;
    const centerY = Number.isFinite(this.centerJ) ? this.centerJ * tile : 0;
    const shiftDistance = Math.max(400, this.renderDistance * 0.1);
    if (!this.pending && Math.hypot(px - centerX, py - centerY) >= shiftDistance) {
      this._startBuild(Math.round(px / tile), Math.round(py / tile));
    }
    if (this.pending) this._advanceBuild(STREAM_ROWS_PER_FRAME);
  }

  _startBuild(ci, cj) {
    this.pending = {
      ci,
      cj,
      row: 0,
      ox: (ci - this.half) * this.tile,
      oy: (cj - this.half) * this.tile,
    };
  }

  _advanceBuild(rowBudget) {
    if (!this.pending) return;
    const tile = this.tile;
    const stride = this.nx + 1;
    const { ox, oy } = this.pending;
    const P = this.nextPositions;
    const N = this.nextNormals;
    const C = this.nextColors;
    const endRow = Math.min(this.ny + 1, this.pending.row + rowBudget);
    for (let j = this.pending.row; j < endRow; j++) {
      for (let i = 0; i <= this.nx; i++) {
        const vertex = j * stride + i;
        const idx = vertex * 3;
        const x = ox + i * tile;
        const y = oy + j * tile;
        P[idx] = x; P[idx + 1] = y; P[idx + 2] = groundHeight(x, y);
        const hl = groundHeight(x - tile, y), hr = groundHeight(x + tile, y);
        const hd = groundHeight(x, y - tile), hu = groundHeight(x, y + tile);
        let nx = (hl - hr), ny = (hd - hu), nz = 2 * tile;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        N[idx] = nx; N[idx + 1] = ny; N[idx + 2] = nz;
        const slope = 1 - nz;
        const c = colorForHeight(P[idx + 2], slope);
        C[idx] = c[0]; C[idx + 1] = c[1]; C[idx + 2] = c[2];
      }
    }
    this.pending.row = endRow;
    if (endRow <= this.ny) return;

    [this.positions, this.nextPositions] = [this.nextPositions, this.positions];
    [this.normals, this.nextNormals] = [this.nextNormals, this.normals];
    [this.colors, this.nextColors] = [this.nextColors, this.colors];
    this.mesh.update({ positions: this.positions, normals: this.normals, colors: this.colors });
    this.centerI = this.pending.ci;
    this.centerJ = this.pending.cj;
    this.pending = null;
  }

  draw() { this.mesh.draw(); }
}
