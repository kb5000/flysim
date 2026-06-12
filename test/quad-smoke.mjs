import assert from 'node:assert/strict';
import { createControls, createState } from '../src/sim/state.js';
import { QUAD, resetQuad, stepQuad } from '../src/sim/quad.js';
import { quat } from '../src/math.js';

const DT = 1 / 120;
const ground = () => 0;

function airborneQuad() {
  const s = createState('quad');
  resetQuad(s, ground);
  s.pos[2] = 10;
  s.onGround = false;
  return s;
}

{
  const s = airborneQuad();
  const ctrl = createControls();
  const hover = QUAD.mass * 9.80665 / QUAD.maxThrust;
  ctrl.throttle = hover;
  s.throttle = hover;
  s.thrustState = hover;
  for (let i = 0; i < 5 / DT; i++) stepQuad(s, ctrl, DT, ground);
  assert(Math.abs(s.pos[2] - 10) < 0.25, `hover drifted to ${s.pos[2].toFixed(2)}m`);
  assert(Math.abs(s.vspeed) < 0.1, `hover vertical speed ${s.vspeed.toFixed(2)}m/s`);
}

{
  const s = airborneQuad();
  const ctrl = createControls();
  ctrl.throttle = 0.7;
  for (let i = 0; i < 2 / DT; i++) stepQuad(s, ctrl, DT, ground);
  assert(s.pos[2] > 12, `high throttle should climb, altitude ${s.pos[2].toFixed(2)}m`);
}

{
  const s = airborneQuad();
  s.thrustState = 0.5;
  const ctrl = createControls();
  ctrl.throttle = 0.5;
  ctrl.aileron = 0.7;
  for (let i = 0; i < 0.5 / DT; i++) stepQuad(s, ctrl, DT, ground);
  const [roll] = quat.toEuler(s.q);
  assert(roll > 0.1, `positive aileron should roll right, roll ${roll.toFixed(3)}rad`);
}

console.log('QUAD TESTS PASSED');
