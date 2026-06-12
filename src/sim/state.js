// Aircraft dynamic state and the runtime control inputs that drive it.
import { quat, vec3 } from '../math.js';
import { C172 } from './aircraft-c172.js';

// Runway geometry shared with the world: runway runs along world +Y (north),
// threshold at origin, runway surface at z=0.
export const RUNWAY = {
  origin: [0, 0, 0],
  heading: 0,        // along +Y
  length: 1000,
  width: 30,
};

export function createState() {
  return {
    // kinematics (world ENU: +X east, +Y north, +Z up)
    pos: [0, 30, 0],          // start near runway threshold
    vel: [0, 0, 0],           // world-frame velocity m/s
    q: quat.identity(),       // body -> world
    omega: [0, 0, 0],         // body angular velocity p,q,r (rad/s)

    // propulsion
    throttle: 0.0,            // commanded 0..1
    thrustState: 0.0,         // actual spooled thrust fraction 0..1

    // configuration
    flapDetent: 0,            // index into flap arrays
    onGround: true,
    crashed: false,

    // derived telemetry (filled each physics step for HUD)
    alpha: 0, beta: 0, V: 0, ias: 0, gLoad: 1, aoaWarn: false,
    altitude: 0, vspeed: 0, agl: 0,
    nWheelOnGround: 0,
  };
}

// Live control commands (normalized) updated by input layer each frame.
export function createControls() {
  return {
    aileron: 0,   // -1..1 (right roll positive)
    elevator: 0,  // -1..1 (pull = nose up positive)
    rudder: 0,    // -1..1 (right yaw positive)
    throttle: 0,  // 0..1 absolute commanded
    brake: 0,     // 0..1
    pitchTrim: 0, // -1..1 elevator trim
    steer: 0,     // -1..1 nosewheel steer (derived from rudder on ground)
  };
}

// place aircraft at runway threshold, engine idle, ready for takeoff
export function resetToRunway(s) {
  // CG height above ground = gear z (0.85). Place pos.z so wheels sit on surface.
  s.pos = [0, 40, C172.gear[1].pos[2]];
  s.vel = [0, 0, 0];
  // Level attitude, nose pointing north (heading 0) down the runway (+Y).
  s.q = quat.fromHeadingPitchRoll(0, 0, 0);
  s.omega = [0, 0, 0];
  s.throttle = 0.0;
  s.thrustState = 0.0;
  s.flapDetent = 0;
  s.onGround = true;
  s.crashed = false;
  s.alpha = 0; s.beta = 0; s.V = 0; s.ias = 0; s.gLoad = 1; s.aoaWarn = false;
}
