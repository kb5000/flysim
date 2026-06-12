// Procedural quadcopter model. Body coordinates match the simulator:
// +X nose, +Y right, +Z down.

import { Mesh, boxGeometry, mergeGeometry } from '../engine/mesh.js';
import { mat4, quat } from '../math.js';

const FRAME = [0.12, 0.14, 0.17];
const FRONT = [0.85, 0.22, 0.12];
const MOTOR = [0.18, 0.18, 0.2];
const PROP = [0.08, 0.08, 0.1];

function offset(geo, dx, dy, dz) {
  for (let i = 0; i < geo.positions.length; i += 3) {
    geo.positions[i] += dx;
    geo.positions[i + 1] += dy;
    geo.positions[i + 2] += dz;
  }
  return geo;
}

function rotationAround(pivot, axis, angle) {
  const rotation = mat4.create();
  mat4.fromRotationTranslation(rotation, quat.fromAxisAngle(axis, angle), [0, 0, 0]);
  const tNeg = mat4.create();
  const tPos = mat4.create();
  const tmp = mat4.create();
  const out = mat4.create();
  mat4.fromTranslation(tNeg, [-pivot[0], -pivot[1], -pivot[2]]);
  mat4.fromTranslation(tPos, pivot);
  mat4.multiply(tmp, rotation, tNeg);
  mat4.multiply(out, tPos, tmp);
  return out;
}

export class QuadModel {
  constructor(gl) {
    const body = [];
    body.push(boxGeometry(0.42, 0.28, 0.12, FRAME));
    body.push(offset(boxGeometry(0.18, 0.18, 0.08, FRONT), 0.42, 0, -0.04));
    body.push(boxGeometry(1.0, 0.055, 0.045, FRAME));
    body.push(boxGeometry(0.055, 1.0, 0.045, FRAME));

    this.rotors = [
      [0.9, 0, -0.08],
      [0, 0.9, -0.08],
      [-0.9, 0, -0.08],
      [0, -0.9, -0.08],
    ];
    for (const pos of this.rotors) {
      body.push(offset(boxGeometry(0.13, 0.13, 0.09, MOTOR), ...pos));
    }
    this.body = new Mesh(gl, mergeGeometry(body));
    this.propellers = this.rotors.map((pos) => new Mesh(gl, offset(
      boxGeometry(0.48, 0.035, 0.012, PROP), ...pos
    )));
  }

  draw(drawPart, ctrl, propAngle) {
    drawPart(this.body, mat4.create());
    for (let i = 0; i < this.rotors.length; i++) {
      const direction = (i === 0 || i === 3) ? 1 : -1;
      drawPart(
        this.propellers[i],
        rotationAround(this.rotors[i], [0, 0, 1], propAngle * direction)
      );
    }
  }
}
