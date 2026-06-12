// Camera with three modes: chase (spring-smoothed), cockpit, orbit.
// Builds a view matrix from the aircraft state each frame.
import { mat4, vec3, quat, clamp } from '../math.js';

export const CameraMode = { CHASE: 0, COCKPIT: 1, ORBIT: 2, COUNT: 3 };

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
  }

  cycle() { this.mode = (this.mode + 1) % CameraMode.COUNT; }

  setProjection(aspect, near = 0.5, far = 60000) {
    mat4.perspective(this.proj, this.fov, aspect, near, far);
  }

  // s: aircraft state (interpolated pos/q). dt for smoothing. alpha unused.
  update(s, dt) {
    const pos = s.pos;
    const fwd = quat.rotate(s.q, [1, 0, 0]);   // nose in world
    const up = quat.rotate(s.q, [0, 0, -1]);   // body up (-Z down) in world
    const right = quat.rotate(s.q, [0, 1, 0]);

    if (this.mode === CameraMode.COCKPIT) {
      // eye just behind the nose, looking forward; small offset up
      const eye = vec3.addScaled(pos, fwd, 0.6);
      const eUp = vec3.addScaled(eye, up, 0.6);
      const center = vec3.addScaled(eUp, fwd, 50);
      mat4.lookAt(this.view, eUp, center, up);
      this.eye = eUp;
      return;
    }

    if (this.mode === CameraMode.ORBIT) {
      this.orbitAngle += dt * 0.3;
      const r = 22, h = 6;
      const offset = [Math.cos(this.orbitAngle) * r, Math.sin(this.orbitAngle) * r, h];
      const eye = vec3.add(pos, offset);
      mat4.lookAt(this.view, eye, pos, [0, 0, 1]);
      this.eye = eye;
      return;
    }

    // CHASE: spring-smoothed follow behind and above, using world-up so it
    // doesn't tumble with roll, but biased toward the aircraft heading.
    const headingDir = vec3.normalize([fwd[0], fwd[1], 0.0001]);
    const desiredEye = [
      pos[0] - headingDir[0] * 18 + 0,
      pos[1] - headingDir[1] * 18,
      pos[2] + 6.5,
    ];
    const k = clamp(dt * 6, 0, 1);
    this.smoothEye = vec3.lerp(this.smoothEye, desiredEye, k);
    this.smoothTarget = vec3.lerp(this.smoothTarget, vec3.addScaled(pos, fwd, 4), clamp(dt * 8, 0, 1));
    mat4.lookAt(this.view, this.smoothEye, this.smoothTarget, [0, 0, 1]);
    this.eye = this.smoothEye;
  }
}
