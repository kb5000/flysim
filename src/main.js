// FlySim bootstrap and main loop.
// Fixed-step physics (120 Hz) with an accumulator; render state is interpolated
// between the previous and current physics states for smooth visuals.

import { initGL } from './engine/gl.js';
import { Camera } from './engine/camera.js';
import { Scene } from './render/scene.js';
import { createState, createControls, resetToRunway } from './sim/state.js';
import { stepPhysics, FIXED_DT } from './sim/physics.js';
import { groundHeight } from './world/terrain.js';
import { Keyboard } from './input/keyboard.js';
import { Gamepad } from './input/gamepad.js';
import { HUD } from './ui/hud.js';
import { AudioSys } from './ui/audio.js';
import { quat, vec3, clamp } from './math.js';

const FLAP_DEG = [0, 10, 25];

function main() {
  const glCanvas = document.getElementById('gl');
  const hudCanvas = document.getElementById('hud');
  const gl = initGL(glCanvas);

  const scene = new Scene(gl);
  const camera = new Camera();
  const hud = new HUD(hudCanvas);
  const keyboard = new Keyboard();
  const gamepad = new Gamepad();
  const audio = new AudioSys();

  const state = createState();
  resetToRunway(state);
  const ctrl = createControls();

  let prevState = snapshot(state);
  let paused = false;
  let propAngle = 0;

  // start audio on first interaction
  const kick = () => { audio.start(); audio.resume(); };
  window.addEventListener('keydown', kick, { once: true });
  window.addEventListener('pointerdown', kick, { once: true });

  let last = performance.now() / 1000;
  let acc = 0;

  function frame(nowMs) {
    const now = nowMs / 1000;
    let dt = now - last; last = now;
    if (dt > 0.25) dt = 0.25; // avoid spiral after tab switch

    // ---- input ----
    const padSample = gamepad.sample(dt);
    const kbSample = keyboard.sample(dt);
    const usingPad = !!padSample && gamepad.connected;
    const inp = padSample || kbSample;

    // apply control conditioning / accumulation
    applyControls(ctrl, inp, dt);

    // edge actions from both sources
    const actions = [...keyboard.drainActions(), ...gamepad.drainActions()];
    for (const a of actions) {
      if (a === 'flaps') state.flapDetent = (state.flapDetent + 1) % FLAP_DEG.length;
      else if (a === 'view') camera.cycle();
      else if (a === 'reset') { resetToRunway(state); prevState = snapshot(state); }
      else if (a === 'pause') paused = !paused;
      else if (a === 'help') hud.showHelp = !hud.showHelp;
    }

    // ---- fixed-step physics with accumulator ----
    if (!paused && !hud.showHelp) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 8) {
        prevState = snapshot(state);
        stepPhysics(state, ctrl, FIXED_DT, groundHeight);
        acc -= FIXED_DT; steps++;
      }
    } else {
      acc = 0;
    }

    // ---- interpolation factor ----
    const alpha = clamp(acc / FIXED_DT, 0, 1);
    const rs = interpolate(prevState, state, alpha);

    // prop spin from spooled thrust
    propAngle += dt * (8 + state.thrustState * 90);

    // ---- render ----
    camera.update(rs, dt);
    scene.render(camera, rs, ctrl, propAngle);
    hud.draw(rs.full, ctrl, { gamepad: usingPad, paused }, dt);
    audio.update(state, dt);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// accumulate keyboard/gamepad contributions into the persistent controls object.
function applyControls(ctrl, inp, dt) {
  if (!inp) return;
  ctrl.aileron = inp.aileron;
  ctrl.elevator = inp.elevator;
  ctrl.rudder = inp.rudder;
  ctrl.brake = inp.brake;
  // throttle is integrated (incremental)
  ctrl.throttle = clamp(ctrl.throttle + inp.throttleDelta, 0, 1);
  ctrl.pitchTrim = clamp(ctrl.pitchTrim + inp.trimDelta, -1, 1);
  // nosewheel steering follows rudder at low speed
  ctrl.steer = ctrl.rudder;
}

// take a lightweight snapshot of pose for interpolation
function snapshot(s) {
  return { pos: vec3.clone(s.pos), q: quat.clone(s.q) };
}

// interpolate pose; carry the live state for HUD telemetry via .full
function interpolate(a, b, t) {
  return {
    pos: vec3.lerp(a.pos, b.pos, t),
    q: quat.slerp(a.q, b.q, t),
    full: b,
  };
}

main();
