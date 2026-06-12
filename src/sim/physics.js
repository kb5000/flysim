// Rigid-body 6DOF integrator: combines aerodynamics, propulsion, gravity and
// landing-gear ground reaction. Fixed-step semi-implicit Euler at 120 Hz.
//
// World frame: ENU (+X east, +Y north, +Z up). Body: +X nose, +Y right, +Z down.
// Quaternion s.q rotates body -> world. Angular velocity s.omega is body-frame.

import { C172 } from './aircraft-c172.js';
import { aero } from './aero.js';
import { updateEngine, thrust } from './propulsion.js';
import { gearForces } from './gear.js';
import { density, tasToIas } from './atmosphere.js';
import { quat, vec3, clamp } from '../math.js';

export const FIXED_DT = 1 / 120;
const G = 9.80665;

// Default flat ground at z=0. World may override (terrain) by passing a fn.
function flatGround() { return 0; }

// Step the simulation by exactly dt seconds.
// ctrl: control commands; groundHeight(x,y) optional terrain sampler.
export function stepPhysics(s, ctrl, dt, groundHeight = flatGround) {
  if (s.crashed) return;

  // ---- engine spool ----
  s.throttle = clamp(ctrl.throttle, 0, 1);
  updateEngine(s, dt);

  // ---- airspeed in body frame ----
  // (no wind) relative wind = -velocity; body airspeed vector = R^-1 * vel
  const vBody = quat.rotateInv(s.q, s.vel);
  const rho = density(s.pos[2]);

  // ---- aerodynamics ----
  const a = aero(vBody, s.omega, rho, ctrl, s.flapDetent);

  // ---- propulsion (body +X) ----
  const T = thrust(s, a.V);
  const Fthrust = [T, 0, 0];
  // slight propeller torque/slipstream yaw (left-turning tendency)
  const propYaw = -C172.propTorqueFactor * T; // body N·m about +Z
  const propRoll = -C172.propTorqueFactor * 0.4 * T;

  // ---- sum body forces (aero + thrust) ----
  let Fbody = vec3.add(a.force, Fthrust);
  let Mbody = vec3.clone(a.moment);
  Mbody[2] += propYaw;
  Mbody[0] += propRoll;

  // ---- rotate body force to world, add gravity ----
  let Fworld = quat.rotate(s.q, Fbody);
  Fworld[2] -= C172.mass * G; // gravity in world -Z

  // ---- ground reaction ----
  const gear = gearForces(s, ctrl, groundHeight);
  Fworld = vec3.add(Fworld, gear.force);
  Mbody = vec3.add(Mbody, gear.moment);

  s.nWheelOnGround = gear.nContact;
  const wasOnGround = s.onGround;
  s.onGround = gear.nContact > 0;

  // crash check: hard impact on touchdown
  if (gear.nContact > 0 && !wasOnGround && gear.maxDownSpeed > C172.crashVerticalSpeed) {
    s.crashed = true;
  }
  // fuselage strike: CG itself hits the ground (gear collapsed / belly landing)
  if (groundHeight(s.pos[0], s.pos[1]) - s.pos[2] > 0.3) {
    s.crashed = true;
  }

  // ---- linear acceleration & integration (semi-implicit) ----
  const acc = vec3.scale(Fworld, 1 / C172.mass);
  s.vel = vec3.addScaled(s.vel, acc, dt);
  s.pos = vec3.addScaled(s.pos, s.vel, dt);

  // ---- angular acceleration (diagonal inertia + gyroscopic coupling) ----
  const p = s.omega[0], q = s.omega[1], r = s.omega[2];
  const Ix = C172.Ixx, Iy = C172.Iyy, Iz = C172.Izz;
  // Euler's equations: I·ω̇ = M − ω × (I·ω)
  const pdot = (Mbody[0] - (Iz - Iy) * q * r) / Ix;
  const qdot = (Mbody[1] - (Ix - Iz) * r * p) / Iy;
  const rdot = (Mbody[2] - (Iy - Ix) * p * q) / Iz;
  s.omega = [p + pdot * dt, q + qdot * dt, r + rdot * dt];

  // ---- attitude integration ----
  s.q = quat.integrate(s.q, s.omega, dt);

  // crashed: kill motion so it settles
  if (s.crashed) {
    s.omega = [0, 0, 0];
  }

  // ---- telemetry for HUD ----
  s.alpha = a.alpha;
  s.beta = a.beta;
  s.V = a.V;
  s.ias = tasToIas(a.V, rho);
  // load factor: lift component over weight (body -Z is up-ish); use aero z force
  const liftBody = -a.force[2];
  s.gLoad = liftBody / (C172.mass * G);
  s.aoaWarn = a.alpha > (C172.alphaStall - 3 * Math.PI / 180);
  s.altitude = s.pos[2];
  s.agl = s.pos[2] - groundHeight(s.pos[0], s.pos[1]);
  s.vspeed = s.vel[2];
  s.CL = a.CL;
}
