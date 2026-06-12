// Camera with three modes: chase (spring-smoothed), cockpit, orbit.
// Builds a view matrix from the aircraft state each frame.
// Right-stick look-around (MSFS-style): deflection pans the view, releasing
// the stick recenters; resetView() snaps back instantly.
import { mat4, vec3, quat, clamp } from '../math.js';

export const CameraMode = { CHASE: 0, COCKPIT: 1, ORBIT: 2, COUNT: 3 };

const LOOK_YAW_MAX = 2.4;    // rad, ~137° each side
const LOOK_PITCH_MAX = 1.0;  // rad

export class Camera {
  constructor() {
    this.mode = CameraMode.CHASE;
    this.view = mat4.create();
    this.proj = mat4.create();
    this.eye = [0, -20, 8];
    this.smoothEye = [0, -20, 8];
    this.smoothTarget = [0, 0, 0];
    this.orbitAngle = 0;
    this.fov = 60 * Math.PI / 180;
    this.lookInX = 0; this.lookInY = 0;   // raw stick input this frame
    this.lookYaw = 0; this.lookPitch = 0; // smoothed view offset (rad)
  }

  cycle() { this.mode = (this.mode + 1) % CameraMode.COUNT; this.resetView(); }

  // raw right-stick values, -1..1 (y positive = stick down = look up? no: stick
  // down (+1) looks down, matching MSFS default).
  setLook(x, y) { this.lookInX = x; this.lookInY = y; }

  resetView() { this.lookYaw = 0; this.lookPitch = 0; }

  setProjection(aspect, near = 0.5, far = 60000) {
    mat4.perspective(this.proj, this.fov, aspect, near, far);
  }

  // s: aircraft state (interpolated pos/q). dt for smoothing.
  update(s, dt) {
    const pos = s.pos;
    const fwd = quat.rotate(s.q, [1, 0, 0]);   // nose in world
    const up = quat.rotate(s.q, [0, 0, -1]);   // body up (-Z down) in world
    const right = quat.rotate(s.q, [0, 1, 0]);

    // smooth look offsets toward stick deflection; recenter on release
    const k = clamp(dt * 8, 0, 1);
    this.lookYaw += (this.lookInX * LOOK_YAW_MAX - this.lookYaw) * k;
    this.lookPitch += (this.lookInY * LOOK_PITCH_MAX - this.lookPitch) * k;

    if (this.mode === CameraMode.COCKPIT) {
      // eye just behind the nose; view direction panned by the look offsets
      const eye = vec3.addScaled(pos, fwd, 0.6);
      const eUp = vec3.addScaled(eye, up, 0.6);
      const cy = Math.cos(this.lookYaw), sy = Math.sin(this.lookYaw);
      const cp = Math.cos(this.lookPitch), sp = Math.sin(this.lookPitch);
      // yaw about body-up (stick right = look right), then pitch about body-right
      let dir = [0, 0, 0];
      for (let i = 0; i < 3; i++) dir[i] = fwd[i] * cy + right[i] * sy;
      for (let i = 0; i < 3; i++) dir[i] = dir[i] * cp - up[i] * sp;
      const center = vec3.addScaled(eUp, dir, 50);
      mat4.lookAt(this.view, eUp, center, up);
      this.eye = eUp;
      return;
    }

    if (this.mode === CameraMode.ORBIT) {
      // slow auto-orbit; right stick steers angle and viewing height
      this.orbitAngle += dt * (0.3 + this.lookInX * 2.0);
      const r = 22, h = 6 + this.lookPitch * 14;
      const offset = [Math.cos(this.orbitAngle) * r, Math.sin(this.orbitAngle) * r, h];
      const eye = vec3.add(pos, offset);
      mat4.lookAt(this.view, eye, pos, [0, 0, 1]);
      this.eye = eye;
      return;
    }

    // CHASE: spring-smoothed follow behind and above, using world-up so it
    // doesn't tumble with roll, but biased toward the aircraft heading.
    // Look offsets swing the camera around the aircraft (yaw about world-up).
    const headingDir = vec3.normalize([fwd[0], fwd[1], 0.0001]);
    const cy = Math.cos(this.lookYaw), sy = Math.sin(this.lookYaw);
    const behind = [
      -(headingDir[0] * cy - headingDir[1] * sy),
      -(headingDir[0] * sy + headingDir[1] * cy),
      0,
    ];
    const desiredEye = [
      pos[0] + behind[0] * 18,
      pos[1] + behind[1] * 18,
      pos[2] + 6.5 + this.lookPitch * 12,
    ];
    this.smoothEye = vec3.lerp(this.smoothEye, desiredEye, clamp(dt * 6, 0, 1));
    this.smoothTarget = vec3.lerp(this.smoothTarget, vec3.addScaled(pos, fwd, 4), clamp(dt * 8, 0, 1));
    mat4.lookAt(this.view, this.smoothEye, this.smoothTarget, [0, 0, 1]);
    this.eye = this.smoothEye;
  }
}
