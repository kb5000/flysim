// Minimal vec3 / quat / mat4 math library (column-major mat4, WebGL convention).
// All functions are pure unless suffixed; small helpers return new arrays.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// ---------- vec3 ----------
export const vec3 = {
  create(x = 0, y = 0, z = 0) { return [x, y, z]; },
  clone(a) { return [a[0], a[1], a[2]]; },
  add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
  addScaled(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },
  len(a) { return Math.hypot(a[0], a[1], a[2]); },
  len2(a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; },
  normalize(a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l < 1e-9) return [0, 0, 0];
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  negate(a) { return [-a[0], -a[1], -a[2]]; },
  lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  },
};

// ---------- quat (x,y,z,w), unit length, rotates body->world ----------
export const quat = {
  identity() { return [0, 0, 0, 1]; },
  clone(q) { return [q[0], q[1], q[2], q[3]]; },
  fromAxisAngle(axis, angle) {
    const a = vec3.normalize(axis);
    const h = angle * 0.5;
    const s = Math.sin(h);
    return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
  },
  // q from Euler in body convention used here: yaw(Z-down via heading), pitch(Y), roll(X)
  mul(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },
  normalize(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    if (l < 1e-9) return [0, 0, 0, 1];
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  conjugate(q) { return [-q[0], -q[1], -q[2], q[3]]; },
  // build quaternion from an orthonormal body basis expressed in world coords:
  // X = body +X (nose) in world, Y = body +Y (right) in world, Z = body +Z (down) in world.
  fromBasis(X, Y, Z) {
    const m00 = X[0], m10 = X[1], m20 = X[2];
    const m01 = Y[0], m11 = Y[1], m21 = Y[2];
    const m02 = Z[0], m12 = Z[1], m22 = Z[2];
    const tr = m00 + m11 + m22;
    let qw, qx, qy, qz;
    if (tr > 0) {
      const S = Math.sqrt(tr + 1) * 2;
      qw = 0.25 * S; qx = (m21 - m12) / S; qy = (m02 - m20) / S; qz = (m10 - m01) / S;
    } else if (m00 > m11 && m00 > m22) {
      const S = Math.sqrt(1 + m00 - m11 - m22) * 2;
      qw = (m21 - m12) / S; qx = 0.25 * S; qy = (m01 + m10) / S; qz = (m02 + m20) / S;
    } else if (m11 > m22) {
      const S = Math.sqrt(1 + m11 - m00 - m22) * 2;
      qw = (m02 - m20) / S; qx = (m01 + m10) / S; qy = 0.25 * S; qz = (m12 + m21) / S;
    } else {
      const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
      qw = (m10 - m01) / S; qx = (m02 + m20) / S; qy = (m12 + m21) / S; qz = 0.25 * S;
    }
    return quat.normalize([qx, qy, qz, qw]);
  },
  // build a level attitude (wings level, given pitch up about body Y and a
  // compass heading psi measured clockwise from north). Body: X-nose,Y-right,Z-down;
  // world ENU. Returns body->world quaternion.
  fromHeadingPitchRoll(psi, theta, phi) {
    // start from level-north basis, then rotate. We compose body-frame axes.
    // Heading rotates about world -Z (clockwise from north = turning toward east).
    // Build via intrinsic Z(yaw)-Y(pitch)-X(roll) in NED-like body, then map to ENU.
    // Easiest: construct basis vectors directly.
    const cps = Math.cos(psi), sps = Math.sin(psi);
    const cth = Math.cos(theta), sth = Math.sin(theta);
    const cph = Math.cos(phi), sph = Math.sin(phi);
    // NED forward(north-east-down) classic DCM rows give body axes in NED:
    // We'll compute body axes in NED then convert NED->ENU: (N,E,D)->(E,N,-D)?
    // ENU = (East, North, Up). NED=(North,East,Down). Map v_enu = [vE, vN, -vD]=[v[1],v[0],-v[2]].
    const ned2enu = (v) => [v[1], v[0], -v[2]];
    // body X (nose) in NED
    const Xn = [cth * cps, cth * sps, -sth];
    const Yn = [sph * sth * cps - cph * sps, sph * sth * sps + cph * cps, sph * cth];
    const Zn = [cph * sth * cps + sph * sps, cph * sth * sps - sph * cps, cph * cth];
    return quat.fromBasis(ned2enu(Xn), ned2enu(Yn), ned2enu(Zn));
  },
  // rotate vector v by quaternion q (body -> world)
  rotate(q, v) {
    const [x, y, z, w] = q;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + (y * tz - z * ty),
      v[1] + w * ty + (z * tx - x * tz),
      v[2] + w * tz + (x * ty - y * tx),
    ];
  },
  // inverse rotate (world -> body)
  rotateInv(q, v) {
    return quat.rotate(quat.conjugate(q), v);
  },
  // integrate quaternion by body angular velocity omega (rad/s) over dt
  integrate(q, omega, dt) {
    // dq/dt = 0.5 * q * (0, omega)
    const ox = omega[0] * dt * 0.5;
    const oy = omega[1] * dt * 0.5;
    const oz = omega[2] * dt * 0.5;
    const [x, y, z, w] = q;
    const nx = x + (w * ox + y * oz - z * oy);
    const ny = y + (w * oy + z * ox - x * oz);
    const nz = z + (w * oz + x * oy - y * ox);
    const nw = w + (-x * ox - y * oy - z * oz);
    return quat.normalize([nx, ny, nz, nw]);
  },
  slerp(a, b, t) {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (cos < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; cos = -cos; }
    if (cos > 0.9995) {
      return quat.normalize([
        a[0] + (bb[0] - a[0]) * t,
        a[1] + (bb[1] - a[1]) * t,
        a[2] + (bb[2] - a[2]) * t,
        a[3] + (bb[3] - a[3]) * t,
      ]);
    }
    const theta0 = Math.acos(cos);
    const theta = theta0 * t;
    const s0 = Math.sin(theta0 - theta) / Math.sin(theta0);
    const s1 = Math.sin(theta) / Math.sin(theta0);
    return [
      a[0] * s0 + bb[0] * s1,
      a[1] * s0 + bb[1] * s1,
      a[2] * s0 + bb[2] * s1,
      a[3] * s0 + bb[3] * s1,
    ];
  },
  // Extract aviation Euler angles [roll, pitch, heading] for our convention:
  // body X-nose,Y-right,Z-down; world ENU. Heading is clockwise from north (0..2π).
  toEuler(q) {
    // body axes in world (ENU)
    const X = quat.rotate(q, [1, 0, 0]); // nose
    const Y = quat.rotate(q, [0, 1, 0]); // right wing
    // pitch: nose elevation above horizon. X[2] is world-up component.
    const pitch = Math.asin(clamp(X[2], -1, 1));
    // heading: clockwise from north. nose horizontal projection (E=X[0], N=X[1]).
    let heading = Math.atan2(X[0], X[1]); // atan2(east, north) -> CW from north
    if (heading < 0) heading += 2 * Math.PI;
    // roll: bank of right wing below horizon. Right wing world-up component Y[2].
    // When level, Y[2]=0; positive roll (right wing down) -> Y[2] negative.
    const roll = Math.atan2(-Y[2], Math.hypot(Y[0], Y[1]) || 1e-9) * 0; // placeholder
    // Better roll: project right-wing onto the horizontal-normal plane.
    // Compute the level "right" reference perpendicular to nose-horizontal & up.
    const noseH = [X[0], X[1], 0];
    const nl = Math.hypot(noseH[0], noseH[1]) || 1e-9;
    const rightRef = [noseH[1] / nl, -noseH[0] / nl, 0]; // level right (east of nose)
    const cosR = Y[0] * rightRef[0] + Y[1] * rightRef[1] + Y[2] * 0;
    const sinR = -Y[2];
    const rollAng = Math.atan2(sinR, cosR);
    return [rollAng, pitch, heading];
  },
};

// ---------- mat4 (column-major, Float32Array of 16) ----------
export const mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(out) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },
  multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return out;
  },
  perspective(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[11] = -1;
    if (far != null && far !== Infinity) {
      const nf = 1 / (near - far);
      out[10] = (far + near) * nf;
      out[14] = 2 * far * near * nf;
    } else {
      out[10] = -1;
      out[14] = -2 * near;
    }
    return out;
  },
  lookAt(out, eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let zl = Math.hypot(z0, z1, z2);
    if (zl < 1e-9) { z0 = 0; z1 = 0; z2 = 1; zl = 1; }
    z0 /= zl; z1 /= zl; z2 /= zl;
    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    let xl = Math.hypot(x0, x1, x2);
    if (xl < 1e-9) { x0 = 1; x1 = 0; x2 = 0; xl = 1; }
    x0 /= xl; x1 /= xl; x2 /= xl;
    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;
    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  },
  fromRotationTranslation(out, q, t) {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = 1 - (yy + zz); out[1] = xy + wz; out[2] = xz - wy; out[3] = 0;
    out[4] = xy - wz; out[5] = 1 - (xx + zz); out[6] = yz + wx; out[7] = 0;
    out[8] = xz + wy; out[9] = yz - wx; out[10] = 1 - (xx + yy); out[11] = 0;
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
    return out;
  },
  fromTranslation(out, t) {
    mat4.identity(out);
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2];
    return out;
  },
  fromScaling(out, s) {
    out.fill(0);
    out[0] = s[0]; out[5] = s[1]; out[10] = s[2]; out[15] = 1;
    return out;
  },
  // normal matrix = inverse transpose of upper 3x3, packed as mat3 in 9-float array
  normalFromMat4(out9, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { out9.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); return out9; }
    det = 1.0 / det;
    out9[0] = b01 * det;
    out9[1] = (-a22 * a01 + a02 * a21) * det;
    out9[2] = (a12 * a01 - a02 * a11) * det;
    out9[3] = b11 * det;
    out9[4] = (a22 * a00 - a02 * a20) * det;
    out9[5] = (-a12 * a00 + a02 * a10) * det;
    out9[6] = b21 * det;
    out9[7] = (-a21 * a00 + a01 * a20) * det;
    out9[8] = (a11 * a00 - a01 * a10) * det;
    return out9;
  },
};
