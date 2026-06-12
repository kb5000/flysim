// Runway: a flat asphalt strip along world +Y with centerline markings,
// threshold stripes and a thin grass apron. Built once as a static mesh.
import { Mesh, mergeGeometry } from '../engine/mesh.js';
import { RUNWAY } from '../sim/state.js';

function quad(x0, y0, x1, y1, z, color) {
  // CCW from above (normal +Z)
  const positions = [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const colors = [];
  for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2]);
  const indices = [0, 1, 2, 0, 2, 3];
  return { positions, normals, colors, indices };
}

export class Runway {
  constructor(gl) {
    const L = RUNWAY.length, W = RUNWAY.width;
    const parts = [];
    const z = 0.05; // slightly above ground to avoid z-fight
    // asphalt
    parts.push(quad(-W / 2, 0, W / 2, L, z, [0.13, 0.13, 0.15]));
    // centerline dashes
    const dashLen = 24, gap = 16, cx = 0.5;
    for (let y = 30; y < L - 30; y += dashLen + gap) {
      parts.push(quad(-cx, y, cx, y + dashLen, z + 0.01, [0.85, 0.85, 0.85]));
    }
    // threshold stripes (piano keys) at both ends
    for (const baseY of [6, L - 18]) {
      for (let k = -4; k <= 4; k++) {
        const sx = k * 2.4;
        parts.push(quad(sx, baseY, sx + 1.4, baseY + 12, z + 0.01, [0.9, 0.9, 0.9]));
      }
    }
    // aiming point blocks
    for (const ay of [300, L - 320]) {
      parts.push(quad(-5, ay, -2.5, ay + 30, z + 0.01, [0.9, 0.9, 0.9]));
      parts.push(quad(2.5, ay, 5, ay + 30, z + 0.01, [0.9, 0.9, 0.9]));
    }
    this.mesh = new Mesh(gl, mergeGeometry(parts));
  }
  draw() { this.mesh.draw(); }
}
