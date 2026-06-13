// Runways: flat, arbitrarily oriented asphalt strips with markings.
// Built once as a static mesh over terrain-smoothed surfaces.
import { Mesh, mergeGeometry } from '../engine/mesh.js';
import { runwaySurfaceHeight } from './terrain.js';
import { RUNWAY_CHUNK_SIZE, runwaysInRadius } from './runway-layout.js';

function quad(runway, x0, y0, x1, y1, z, color) {
  const transform = (x, y) => [
    runway.origin[0] + x * Math.cos(runway.heading) + y * Math.sin(runway.heading),
    runway.origin[1] - x * Math.sin(runway.heading) + y * Math.cos(runway.heading),
    z,
  ];
  const a = transform(x0, y0), b = transform(x1, y0);
  const c = transform(x1, y1), d = transform(x0, y1);
  // CCW from above (normal +Z)
  const positions = [...a, ...b, ...c, ...d];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const colors = [];
  for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2]);
  const indices = [0, 1, 2, 0, 2, 3];
  return { positions, normals, colors, indices };
}

export class Runway {
  constructor(gl) {
    this.gl = gl;
    this.renderDistance = 6000;
    this.centerChunk = [Infinity, Infinity];
    this.shoulderMesh = null;
    this.surfaceMesh = null;
    this.markingMesh = null;
    this.rebuild(0, 0);
  }

  setRenderDistance(distance) {
    this.renderDistance = distance;
    this.centerChunk = [Infinity, Infinity];
  }

  rebuild(x, y) {
    const ci = Math.floor(x / RUNWAY_CHUNK_SIZE);
    const cj = Math.floor(y / RUNWAY_CHUNK_SIZE);
    if (ci === this.centerChunk[0] && cj === this.centerChunk[1]) return;
    this.centerChunk = [ci, cj];
    const shoulders = [];
    const surfaces = [];
    const markings = [];
    for (const runway of runwaysInRadius(x, y, this.renderDistance * 1.25)) {
      const L = runway.length, W = runway.width;
      const z = runwaySurfaceHeight(runway) + 0.06;
      // A pale compacted shoulder makes the full runway width readable at
      // distance and masks coarse terrain triangles along the asphalt edges.
      shoulders.push(quad(runway, -W / 2 - 4, -8, W / 2 + 4, L + 8, z, [0.30, 0.30, 0.27]));
      surfaces.push(quad(runway, -W / 2, 0, W / 2, L, z, [0.13, 0.13, 0.15]));
      const dashLen = 24, gap = 16, cx = 0.5;
      for (let y = 30; y < L - 30; y += dashLen + gap) {
        markings.push(quad(runway, -cx, y, cx, y + dashLen, z, [0.85, 0.85, 0.85]));
      }
      for (const baseY of [6, L - 18]) {
        for (let k = -4; k <= 4; k++) {
          const sx = k * 2.4;
          markings.push(quad(runway, sx, baseY, sx + 1.4, baseY + 12, z, [0.9, 0.9, 0.9]));
        }
      }
      if (L > 700) {
        for (const ay of [Math.min(300, L * 0.3), Math.max(L - 320, L * 0.65)]) {
          markings.push(quad(runway, -5, ay, -2.5, ay + 30, z, [0.9, 0.9, 0.9]));
          markings.push(quad(runway, 2.5, ay, 5, ay + 30, z, [0.9, 0.9, 0.9]));
        }
      }
    }
    this._replaceMesh('shoulderMesh', shoulders);
    this._replaceMesh('surfaceMesh', surfaces);
    this._replaceMesh('markingMesh', markings);
  }

  _replaceMesh(name, parts) {
    if (this[name]) this[name].destroy();
    this[name] = parts.length ? new Mesh(this.gl, mergeGeometry(parts)) : null;
  }

  draw() {
    const gl = this.gl;
    if (this.shoulderMesh) this.shoulderMesh.draw();
    gl.enable(gl.POLYGON_OFFSET_FILL);
    if (this.surfaceMesh) {
      gl.polygonOffset(-1, -2);
      this.surfaceMesh.draw();
    }
    if (this.markingMesh) {
      gl.polygonOffset(-2, -4);
      this.markingMesh.draw();
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}
