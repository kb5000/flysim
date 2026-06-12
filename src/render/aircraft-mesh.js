// Procedural low-poly single-engine aircraft built from boxes/plates.
// Control surfaces (elevator, ailerons, rudder) and the propeller are drawn as
// separate parts so they can deflect/spin via per-part model matrices.
//
// Local model frame matches the body frame: +X nose, +Y right, +Z down.
// The renderer applies an extra body->render rotation if needed; here we keep
// body coordinates and let the scene convert.

import { Mesh, boxGeometry, facesToGeometry, mergeGeometry } from '../engine/mesh.js';
import { mat4, quat } from '../math.js';

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

export class AircraftModel {
  constructor(gl) {
    this.gl = gl;
    // ---- static body (fuselage, wings, tail fin, gear, cabin) ----
    const parts = [];
    // fuselage: tapered-ish via two stacked boxes
    parts.push(offset(boxGeometry(2.4, 0.5, 0.45, FUSE), -0.2, 0, 0));
    parts.push(offset(boxGeometry(1.0, 0.42, 0.38, FUSE), 1.4, 0, -0.05)); // nose
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
    // gear legs + wheels (visual)
    for (const gy of [-1.3, 1.3]) {
      parts.push(offset(boxGeometry(0.05, 0.05, 0.45, [0.1, 0.1, 0.1]), -0.4, gy, 0.5));
      parts.push(offset(boxGeometry(0.18, 0.1, 0.18, [0.05, 0.05, 0.05]), -0.4, gy, 0.82));
    }
    parts.push(offset(boxGeometry(0.05, 0.05, 0.5, [0.1, 0.1, 0.1]), 1.1, 0, 0.5));
    parts.push(offset(boxGeometry(0.16, 0.1, 0.16, [0.05, 0.05, 0.05]), 1.1, 0, 0.82));

    this.body = new Mesh(gl, mergeGeometry(parts));

    // ---- elevator (hinged at tail), pivots about Y at x=-3.95 ----
    this.elevatorHinge = [-3.95, 0, -0.05];
    this.elevator = new Mesh(gl, offset(plate(-0.25, 0, 0.5, 3.5, 0.08, ACCENT), 0, 0, 0));
    // ---- rudder, hinged about Z at tail ----
    this.rudderHinge = [-3.95, 0, -0.7];
    this.rudder = new Mesh(gl, offset(boxGeometry(0.3, 0.05, 0.6, ACCENT), 0, 0, 0));
    // ---- ailerons (outer wing trailing edge), left & right ----
    this.aileronHingeL = [-0.45, -3.3, -0.55];
    this.aileronHingeR = [-0.45, 3.3, -0.55];
    this.aileronL = new Mesh(gl, offset(plate(-0.2, 0, 0.4, 2.4, 0.07, ACCENT), 0, 0, 0));
    this.aileronR = new Mesh(gl, offset(plate(-0.2, 0, 0.4, 2.4, 0.07, ACCENT), 0, 0, 0));
    // ---- propeller disc/blades at nose ----
    this.propPos = [2.45, 0, -0.05];
    const blade = offset(boxGeometry(0.04, 0.05, 0.9, PROP), 0, 0, 0);
    this.prop = new Mesh(gl, blade);
    // spinner
    this.spinner = new Mesh(gl, offset(boxGeometry(0.12, 0.12, 0.12, [0.2, 0.2, 0.22]), 2.5, 0, -0.05));
  }

  // Draw all parts. `drawPart(mesh, localMat)` is provided by the scene which
  // multiplies by the aircraft world matrix and sets uniforms.
  // ctrl: {elevator, aileron, rudder} normalized; propAngle radians.
  draw(drawPart, ctrl, propAngle) {
    const I = mat4.create();
    drawPart(this.body, I);

    // elevator deflection: pull (elevator>0) => trailing edge up => nose up.
    const de = ctrl.elevator * (22 * Math.PI / 180);
    drawPart(this.elevator, hinge(this.elevatorHinge, [0, 1, 0], -de));

    // rudder: positive rudder (right yaw) => trailing edge left
    const dr = ctrl.rudder * (24 * Math.PI / 180);
    drawPart(this.rudder, hinge(this.rudderHinge, [0, 0, 1], dr));

    // ailerons: right roll (aileron>0) => right aileron up, left aileron down
    const da = ctrl.aileron * (20 * Math.PI / 180);
    drawPart(this.aileronR, hinge(this.aileronHingeR, [0, 1, 0], da));
    drawPart(this.aileronL, hinge(this.aileronHingeL, [0, 1, 0], -da));

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
