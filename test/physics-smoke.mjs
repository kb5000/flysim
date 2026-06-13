// Physics smoke test — pure sim, no WebGL/DOM. Run: node test/physics-smoke.mjs
// Validates the flight dynamics meet basic realism acceptance checks.

import { createState, createControls, resetToRunway } from '../src/sim/state.js';
import { stepPhysics, FIXED_DT } from '../src/sim/physics.js';
import { aero } from '../src/sim/aero.js';
import { density } from '../src/sim/atmosphere.js';
import { C172 } from '../src/sim/aircraft-c172.js';
import { thrust } from '../src/sim/propulsion.js';
import { quat } from '../src/math.js';

const MS_TO_KT = 1.94384;
let failures = 0;
function check(name, cond, detail) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}

// flat ground at z=0
const ground = () => 0;

// ---------------------------------------------------------------------------
// Test 1: full-throttle takeoff roll accelerates to > 55 kt within a sane run.
// ---------------------------------------------------------------------------
(function takeoffRoll() {
  const s = createState();
  resetToRunway(s);
  const ctrl = createControls();
  ctrl.throttle = 1.0;
  let dist0 = s.pos[1];
  let reachedAt = null;
  const maxT = 60; // seconds
  for (let t = 0; t < maxT / FIXED_DT; t++) {
    stepPhysics(s, ctrl, FIXED_DT, ground);
    if (s.ias * MS_TO_KT > 55 && reachedAt === null) {
      reachedAt = { time: t * FIXED_DT, dist: Math.abs(s.pos[1] - dist0) };
      break;
    }
  }
  const ok = reachedAt !== null && reachedAt.dist < 700;
  check('takeoff: reach 55 kt under full throttle',
    ok,
    reachedAt ? `at ${reachedAt.time.toFixed(1)}s, ${reachedAt.dist.toFixed(0)}m roll`
              : `never reached 55kt (final ${(s.ias*MS_TO_KT).toFixed(1)}kt)`);
})();

// ---------------------------------------------------------------------------
// Test 2: cruise-speed excess power supports a useful climb rate.
// ---------------------------------------------------------------------------
(function climbPerformance() {
  const V = 50;
  const rho = density(0);
  const weight = C172.mass * 9.80665;
  const CL = weight / (0.5 * rho * V * V * C172.S);
  const alpha = (CL - C172.CL0) / C172.CLa;
  const vBody = [V * Math.cos(alpha), 0, V * Math.sin(alpha)];
  const drag = aero(vBody, [0, 0, 0], rho, createControls(), 0).CD
    * 0.5 * rho * V * V * C172.S;
  const s = { thrustState: 1 };
  const climbRate = (thrust(s, V) - drag) * V / weight;
  check('climb: full power has useful cruise-speed excess power',
    climbRate > 2.5,
    `estimated ${climbRate.toFixed(1)}m/s (${(climbRate * 196.85).toFixed(0)}fpm)`);
})();

// ---------------------------------------------------------------------------
// Test 3: trimmed level flight does not diverge over 60 s.
// We find an approximate trim, then check altitude/speed stay bounded.
// ---------------------------------------------------------------------------
(function trimmedCruise() {
  const s = createState();
  resetToRunway(s);
  // place airborne, level, at cruise speed pointing north
  s.pos = [0, 0, 500];
  const Vc = 50; // m/s ~ 97 kt
  s.q = quat.fromHeadingPitchRoll(0,0,0); // nose north
  s.vel = [0, Vc, 0];
  s.omega = [0, 0, 0];
  s.onGround = false;
  s.throttle = 0.6;
  s.thrustState = 0.6;

  const ctrl = createControls();
  ctrl.throttle = 0.6;

  // Auto-trim pitch to balance Cm ~ 0 at this condition by scanning elevator trim.
  // Use a short relaxation: try trims and pick the one giving least pitch rate drift.
  let bestTrim = 0, bestScore = Infinity;
  for (let trim = -1; trim <= 1.0001; trim += 0.05) {
    const t = createState();
    Object.assign(t, structuredClone({
      pos: [0,0,500], vel: [0,Vc,0], omega:[0,0,0],
      flapDetent:0, onGround:false, crashed:false,
      throttle:0.6, thrustState:0.6,
    }));
    t.q = quat.fromHeadingPitchRoll(0,0,0);
    const c = createControls(); c.throttle = 0.6; c.pitchTrim = trim;
    // simulate 3s, measure final |pitch rate| + altitude drift rate
    for (let k = 0; k < 3 / FIXED_DT; k++) stepPhysics(t, c, FIXED_DT, ground);
    const score = Math.abs(t.omega[1]) + Math.abs(t.vspeed) * 0.05;
    if (score < bestScore) { bestScore = score; bestTrim = trim; }
  }
  ctrl.pitchTrim = bestTrim;

  let minAlt = Infinity, maxAlt = -Infinity, minV = Infinity, maxV = -Infinity;
  let diverged = false;
  for (let t = 0; t < 60 / FIXED_DT; t++) {
    stepPhysics(s, ctrl, FIXED_DT, ground);
    minAlt = Math.min(minAlt, s.pos[2]); maxAlt = Math.max(maxAlt, s.pos[2]);
    minV = Math.min(minV, s.V); maxV = Math.max(maxV, s.V);
    const [roll, pitch] = quat.toEuler(s.q);
    if (!isFinite(s.pos[2]) || Math.abs(pitch) > 1.2 || Math.abs(roll) > 1.2 || s.pos[2] < 100) {
      diverged = true; break;
    }
  }
  check('cruise: trimmed level flight stays bounded 60s',
    !diverged,
    `trim=${bestTrim.toFixed(2)} alt[${minAlt.toFixed(0)},${maxAlt.toFixed(0)}]m V[${minV.toFixed(1)},${maxV.toFixed(1)}]m/s`);
})();

// ---------------------------------------------------------------------------
// Test 4: lift drops past stall — CL at high alpha < CL at moderate alpha.
// ---------------------------------------------------------------------------
(function stall() {
  const rho = density(0);
  const V = 40;
  const omega = [0, 0, 0];
  const ctrl = createControls();
  function clAt(alphaDeg) {
    const a = alphaDeg * Math.PI / 180;
    const vBody = [V * Math.cos(a), 0, V * Math.sin(a)];
    return aero(vBody, omega, rho, ctrl, 0).CL;
  }
  const clPeak = clAt(13);
  const clDeep = clAt(25);
  check('stall: CL falls past stall angle',
    clDeep < clPeak,
    `CL(13°)=${clPeak.toFixed(2)} > CL(25°)=${clDeep.toFixed(2)}`);
})();

// ---------------------------------------------------------------------------
// Test 5: aileron input rolls the aircraft and produces adverse yaw.
// Right aileron (positive) -> positive roll rate p; adverse yaw -> negative-ish
// yaw acceleration relative to no-aileron baseline.
// ---------------------------------------------------------------------------
(function aileronRoll() {
  function run(aileron) {
    const s = createState();
    s.pos = [0, 0, 500];
    s.q = quat.fromHeadingPitchRoll(0,0,0);
    s.vel = [0, 50, 0];
    s.omega = [0, 0, 0];
    s.onGround = false; s.throttle = 0.6; s.thrustState = 0.6;
    const ctrl = createControls();
    ctrl.throttle = 0.6; ctrl.aileron = aileron;
    for (let k = 0; k < 0.5 / FIXED_DT; k++) stepPhysics(s, ctrl, FIXED_DT, ground);
    return { p: s.omega[0], r: s.omega[2] };
  }
  const right = run(0.6);
  const none = run(0.0);
  const rolled = right.p > 0.05; // built up a right roll rate
  // adverse yaw: yaw rate moves opposite to the turn (right roll -> left/neg yaw tendency)
  const adverse = right.r < none.r;
  check('aileron: produces roll rate', rolled, `p=${right.p.toFixed(3)} rad/s`);
  check('aileron: shows adverse yaw', adverse,
    `r(aileron)=${right.r.toFixed(4)} < r(none)=${none.r.toFixed(4)}`);
})();

// ---------------------------------------------------------------------------
// Test 6: positive rudder command yaws right (positive body yaw rate).
// ---------------------------------------------------------------------------
(function rudderDirection() {
  const s = createState();
  s.pos = [0, 0, 500];
  s.q = quat.fromHeadingPitchRoll(0, 0, 0);
  s.vel = [0, 50, 0];
  s.onGround = false;
  s.throttle = 0.6; s.thrustState = 0.6;
  const ctrl = createControls();
  ctrl.throttle = 0.6; ctrl.rudder = 0.7;
  for (let k = 0; k < 0.4 / FIXED_DT; k++) stepPhysics(s, ctrl, FIXED_DT, ground);
  check('rudder: positive input yaws right without excessive response',
    s.omega[2] > 0.02 && s.omega[2] < 0.4,
    `r=${s.omega[2].toFixed(3)} rad/s`);
})();

// ---------------------------------------------------------------------------
// Test 7: a yaw disturbance should damp instead of producing prolonged drift.
// ---------------------------------------------------------------------------
(function yawDamping() {
  const s = createState();
  s.pos = [0, 0, 500];
  s.q = quat.fromHeadingPitchRoll(0, 0, 0);
  s.vel = [0, 50, 0];
  s.omega = [0, 0, 0.25];
  s.onGround = false;
  s.throttle = 0.6; s.thrustState = 0.6;
  const ctrl = createControls();
  ctrl.throttle = 0.6;
  for (let k = 0; k < 2 / FIXED_DT; k++) stepPhysics(s, ctrl, FIXED_DT, ground);
  check('yaw: disturbance damps promptly',
    Math.abs(s.omega[2]) < 0.12,
    `r=${s.omega[2].toFixed(3)} rad/s after 2s`);
})();

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
