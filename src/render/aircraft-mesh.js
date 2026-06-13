// Procedural low-poly single-engine aircraft built from boxes/plates.
// Control surfaces (elevator, ailerons, rudder) and the propeller are drawn as
// separate parts so they can deflect/spin via per-part model matrices.
//
// Local model frame matches the body frame: +X nose, +Y right, +Z down.
// The renderer applies an extra body->render rotation if needed; here we keep
// body coordinates and let the scene convert.

import { Mesh, boxGeometry, facesToGeometry, mergeGeometry } from '../engine/mesh.js';
import { mat4, quat } from '../math.js';
import { C172 } from '../sim/aircraft-c172.js';

const FUSE = [0.55, 0.95, 0.35];
const WING = [0.80, 0.80, 0.85];
const ACCENT = [0.78, 0.18, 0.18];
const PROP = [0.1, 0.1, 0.12];
const GLASS = [0.35, 0.55, 0.7];

// A thin plate in the X-Y plane (wing/tailplane), span along Y, chord along X.
function plate(cx, cy, chord, span, thick, color) {
  return offset(boxGeometry(chord / 2, span / 2, thick / 2, color), cx, cy, 0);
}
function offset(geo, dx, dy, dz) {
  const p = geo.positions;
  for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; }
  return geo;
}

// Build a rectangular strut between two points. The local box Z axis is
// rotated onto the strut direction, including its normals for correct lighting.
function strutBetween(a, b, halfWidth, color) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  const zAxis = [dx / length, dy / length, dz / length];
  const reference = Math.abs(zAxis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const xAxis = normalize(cross(reference, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const center = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
  const geo = boxGeometry(halfWidth, halfWidth, length * 0.5, color);
  for (let i = 0; i < geo.positions.length; i += 3) {
    const x = geo.positions[i], y = geo.positions[i + 1], z = geo.positions[i + 2];
    geo.positions[i] = center[0] + xAxis[0] * x + yAxis[0] * y + zAxis[0] * z;
    geo.positions[i + 1] = center[1] + xAxis[1] * x + yAxis[1] * y + zAxis[1] * z;
    geo.positions[i + 2] = center[2] + xAxis[2] * x + yAxis[2] * y + zAxis[2] * z;
    const nx = geo.normals[i], ny = geo.normals[i + 1], nz = geo.normals[i + 2];
    geo.normals[i] = xAxis[0] * nx + yAxis[0] * ny + zAxis[0] * nz;
    geo.normals[i + 1] = xAxis[1] * nx + yAxis[1] * ny + zAxis[1] * nz;
    geo.normals[i + 2] = xAxis[2] * nx + yAxis[2] * ny + zAxis[2] * nz;
  }
  return geo;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export class AircraftModel {
  constructor(gl) {
    this.gl = gl;
    // ---- static body (fuselage, wings, tail fin, gear, cabin) ----
    const parts = [];
    // fuselage: tapered-ish via two stacked boxes
    parts.push(offset(boxGeometry(2.4, 0.5, 0.45, FUSE), -0.2, 0, 0));
    parts.push(offset(boxGeometry(1.0, 0.42, 0.38, FUSE), 1.4, 0, -0.05)); // nose
    // stepped tail cone reaches the stabilizer root instead of leaving it
    // visually detached from the main fuselage.
    parts.push(offset(boxGeometry(0.55, 0.36, 0.32, FUSE), -2.85, 0, -0.02));
    parts.push(offset(boxGeometry(0.45, 0.22, 0.24, FUSE), -3.65, 0, -0.03));
    // cabin/glass
    parts.push(offset(boxGeometry(0.7, 0.42, 0.3, GLASS), 0.5, 0, -0.45));
    // main wing (high wing): span 11, chord 1.5, sit above fuselage (-Z up)
    parts.push(offset(plate(0.2, 0, 1.5, 10.4, 0.12, WING), 0, 0, -0.55));
    // wing struts hint
    parts.push(offset(boxGeometry(0.05, 0.05, 0.5, FUSE), 0.2, 2.2, -0.3));
    parts.push(offset(boxGeometry(0.05, 0.05, 0.5, FUSE), 0.2, -2.2, -0.3));
    // horizontal stabilizer (fixed part)
    parts.push(offset(plate(-3.6, 0, 0.7, 3.6, 0.1, WING), 0, 0, -0.05));
    // vertical fin (fixed part) in X-Z plane
    parts.push(offset(boxGeometry(0.55, 0.06, 0.7, WING), -3.7, 0, -0.7));
    // accent stripe along fuselage
    parts.push(offset(boxGeometry(2.4, 0.51, 0.07, ACCENT), -0.2, 0, 0.0));
    parts.push(offset(boxGeometry(0.9, 0.23, 0.05, ACCENT), -3.25, 0, 0.0));
    // Visual wheel bottoms match the physics contact points exactly.
    for (const gear of C172.gear) {
      const main = gear.name !== 'nose';
      const radius = main ? 0.18 : 0.16;
      const halfWidth = main ? 0.1 : 0.08;
      const wheelZ = gear.pos[2] - radius;
      const anchor = main
        ? [-0.35, Math.sign(gear.pos[1]) * 0.42, 0.30]
        : [gear.pos[0], 0, 0.30];
      const wheelCenter = [gear.pos[0], gear.pos[1], wheelZ];
      parts.push(strutBetween(anchor, wheelCenter, main ? 0.075 : 0.06, [0.12, 0.12, 0.12]));
      if (main) {
        const braceAnchor = [0.05, Math.sign(gear.pos[1]) * 0.38, 0.34];
        parts.push(strutBetween(braceAnchor, wheelCenter, 0.045, [0.16, 0.16, 0.16]));
      }
      parts.push(offset(
        boxGeometry(radius, halfWidth, radius, [0.05, 0.05, 0.05]),
        gear.pos[0], gear.pos[1], wheelZ
      ));
    }

    this.body = new Mesh(gl, mergeGeometry(parts));

    // ---- elevator: aft of the stabilizer trailing edge ----
    this.elevatorHinge = [-3.95, 0, -0.05];
    this.elevator = new Mesh(gl, plate(-4.2, 0, 0.5, 3.5, 0.08, ACCENT));
    // ---- rudder, hinged about Z at tail ----
    this.rudderHinge = [-3.95, 0, -0.7];
    this.rudder = new Mesh(gl, offset(
      boxGeometry(0.3, 0.05, 0.6, ACCENT),
      -4.25, 0, -0.7
    ));
    // ---- ailerons (outer wing trailing edge), left & right ----
    this.aileronHingeL = [-0.45, -3.3, -0.55];
    this.aileronHingeR = [-0.45, 3.3, -0.55];
    this.aileronL = new Mesh(gl, offset(plate(-0.65, -3.3, 0.4, 2.4, 0.07, ACCENT), 0, 0, -0.55));
    this.aileronR = new Mesh(gl, offset(plate(-0.65, 3.3, 0.4, 2.4, 0.07, ACCENT), 0, 0, -0.55));
    // ---- inboard flaps, between cabin and ailerons ----
    this.flapHingeL = [-0.55, -1.7, -0.55];
    this.flapHingeR = [-0.55, 1.7, -0.55];
    this.flapL = new Mesh(gl, offset(plate(-0.75, -1.7, 0.4, 2.0, 0.07, ACCENT), 0, 0, -0.55));
    this.flapR = new Mesh(gl, offset(plate(-0.75, 1.7, 0.4, 2.0, 0.07, ACCENT), 0, 0, -0.55));
    // ---- propeller disc/blades at nose ----
    this.propPos = [2.45, 0, -0.05];
    const blade = offset(
      boxGeometry(0.04, 0.05, 0.9, PROP),
      this.propPos[0], this.propPos[1], this.propPos[2]
    );
    this.prop = new Mesh(gl, blade);
    // spinner
    this.spinner = new Mesh(gl, offset(boxGeometry(0.12, 0.12, 0.12, [0.2, 0.2, 0.22]), 2.5, 0, -0.05));
  }

  // Draw all parts. `drawPart(mesh, localMat)` is provided by the scene which
  // multiplies by the aircraft world matrix and sets uniforms.
  // ctrl: {elevator, aileron, rudder} normalized; propAngle radians.
  draw(drawPart, ctrl, propAngle, flapDetent = 0) {
    const I = mat4.create();
    drawPart(this.body, I);

    // elevator deflection: pull (elevator>0) => trailing edge up => nose up.
    const de = ctrl.elevator * (22 * Math.PI / 180);
    drawPart(this.elevator, hinge(this.elevatorHinge, [0, 1, 0], -de));

    // Right rudder moves the trailing edge right, pushing the tail left.
    const dr = ctrl.rudder * (24 * Math.PI / 180);
    drawPart(this.rudder, hinge(this.rudderHinge, [0, 0, 1], -dr));

    // +Y rotation moves an aft surface down. Right roll needs right up, left down.
    const da = ctrl.aileron * (20 * Math.PI / 180);
    drawPart(this.aileronR, hinge(this.aileronHingeR, [0, 1, 0], -da));
    drawPart(this.aileronL, hinge(this.aileronHingeL, [0, 1, 0], da));

    const flapAngles = [0, 10, 25];
    const df = (flapAngles[flapDetent] || 0) * Math.PI / 180;
    drawPart(this.flapR, hinge(this.flapHingeR, [0, 1, 0], df));
    drawPart(this.flapL, hinge(this.flapHingeL, [0, 1, 0], df));

    // propeller: spin about X (nose axis); draw a few blades
    for (let i = 0; i < 3; i++) {
      const ang = propAngle + i * (2 * Math.PI / 3);
      drawPart(this.prop, hinge(this.propPos, [1, 0, 0], ang));
    }
    drawPart(this.spinner, I);
  }
}

// build a model matrix that rotates about `axis` by `angle` around pivot point.
function hinge(pivot, axis, angle) {
  const q = quat.fromAxisAngle(axis, angle);
  const m = mat4.create();
  mat4.fromRotationTranslation(m, q, [0, 0, 0]);
  // translate so rotation happens about pivot: M = T(p) * R * T(-p)
  const out = mat4.create();
  const tNeg = mat4.create(); mat4.fromTranslation(tNeg, [-pivot[0], -pivot[1], -pivot[2]]);
  const tPos = mat4.create(); mat4.fromTranslation(tPos, pivot);
  const tmp = mat4.create();
  mat4.multiply(tmp, m, tNeg);
  mat4.multiply(out, tPos, tmp);
  return out;
}
