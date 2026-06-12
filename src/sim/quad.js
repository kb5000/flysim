// Stabilized quadcopter model using the same normalized controls as the plane:
// aileron -> roll rate, elevator -> pitch rate, rudder -> yaw rate, throttle ->
// collective thrust. Body frame remains +X nose, +Y right, +Z down.

import { clamp, quat, vec3 } from '../math.js';

export const QUAD = {
  mass: 1.6,
  inertia: [0.035, 0.04, 0.065],
  maxThrust: 32,
  thrustTau: 0.12,
  maxRate: [2.6, 2.6, 1.8],
  rateGain: [0.16, 0.18, 0.12],
  maxTorque: [0.42, 0.42, 0.22],
  linearDrag: 0.22,
  angularDrag: 0.025,
  groundClearance: 0.22,
  crashVerticalSpeed: 6,
};

const G = 9.80665;

export function resetQuad(s, groundHeight = () => 0) {
  s.aircraftType = 'quad';
  s.pos = [0, 40, groundHeight(0, 40) + QUAD.groundClearance];
  s.vel = [0, 0, 0];
  s.q = quat.fromHeadingPitchRoll(0, 0, 0);
  s.omega = [0, 0, 0];
  s.throttle = 0;
  s.thrustState = 0;
  s.flapDetent = 0;
  s.onGround = true;
  s.crashed = false;
  s.alpha = 0; s.beta = 0; s.V = 0; s.ias = 0;
  s.gLoad = 1; s.aoaWarn = false;
  s.altitude = s.pos[2]; s.vspeed = 0; s.agl = QUAD.groundClearance;
  s.nWheelOnGround = 4;
}

export function stepQuad(s, ctrl, dt, groundHeight = () => 0) {
  if (s.crashed) return;

  s.throttle = clamp(ctrl.throttle, 0, 1);
  const spool = 1 - Math.exp(-dt / QUAD.thrustTau);
  s.thrustState += (s.throttle - s.thrustState) * spool;

  const thrustBody = [0, 0, -QUAD.maxThrust * s.thrustState];
  let forceWorld = quat.rotate(s.q, thrustBody);
  forceWorld[2] -= QUAD.mass * G;
  forceWorld = vec3.addScaled(forceWorld, s.vel, -QUAD.linearDrag);

  const desiredRate = [
    ctrl.aileron * QUAD.maxRate[0],
    ctrl.elevator * QUAD.maxRate[1],
    ctrl.rudder * QUAD.maxRate[2],
  ];
  const torque = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    torque[i] = clamp(
      (desiredRate[i] - s.omega[i]) * QUAD.rateGain[i]
        - s.omega[i] * QUAD.angularDrag,
      -QUAD.maxTorque[i],
      QUAD.maxTorque[i]
    );
  }

  const acc = vec3.scale(forceWorld, 1 / QUAD.mass);
  s.vel = vec3.addScaled(s.vel, acc, dt);
  s.pos = vec3.addScaled(s.pos, s.vel, dt);

  const [Ix, Iy, Iz] = QUAD.inertia;
  const [p, q, r] = s.omega;
  s.omega = [
    p + (torque[0] - (Iz - Iy) * q * r) / Ix * dt,
    q + (torque[1] - (Ix - Iz) * r * p) / Iy * dt,
    r + (torque[2] - (Iy - Ix) * p * q) / Iz * dt,
  ];
  s.q = quat.integrate(s.q, s.omega, dt);

  const ground = groundHeight(s.pos[0], s.pos[1]);
  const floor = ground + QUAD.groundClearance;
  const wasOnGround = s.onGround;
  s.onGround = s.pos[2] <= floor;
  if (s.onGround) {
    const impact = Math.max(0, -s.vel[2]);
    if (!wasOnGround && impact > QUAD.crashVerticalSpeed) s.crashed = true;
    s.pos[2] = floor;
    if (s.vel[2] < 0) s.vel[2] = 0;
    s.vel[0] *= Math.exp(-dt * 5);
    s.vel[1] *= Math.exp(-dt * 5);
  }

  s.V = vec3.len(s.vel);
  s.ias = s.V;
  s.alpha = 0;
  s.beta = 0;
  s.gLoad = QUAD.maxThrust * s.thrustState / (QUAD.mass * G);
  s.aoaWarn = false;
  s.altitude = s.pos[2];
  s.agl = s.pos[2] - ground;
  s.vspeed = s.vel[2];
  s.nWheelOnGround = s.onGround ? 4 : 0;
}
