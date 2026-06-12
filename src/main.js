// FlySim bootstrap and main loop.
// Fixed-step physics (120 Hz) with an accumulator; render state is interpolated
// between the previous and current physics states for smooth visuals.

import { initGL } from './engine/gl.js';
import { Camera } from './engine/camera.js';
import { Scene } from './render/scene.js';
import {
  createState, createControls, resetControls, resetToRunway,
} from './sim/state.js';
import { stepPhysics, FIXED_DT } from './sim/physics.js';
import { resetQuad, stepQuad } from './sim/quad.js';
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
  const aircraftSelect = document.getElementById('aircraft-type');
  const inputSelect = document.getElementById('input-device');
  const refreshInput = document.getElementById('refresh-input');
  const inputStatus = document.getElementById('input-status');
  const gamepad = new Gamepad(
    (devices) => updateInputOptions(inputSelect, devices),
    (status) => { inputStatus.textContent = status; }
  );
  const audio = new AudioSys();
  inputSelect.addEventListener('change', () => {
    const value = inputSelect.value;
    gamepad.select(value === 'keyboard' ? null : Number(value));
  });
  refreshInput.addEventListener('click', () => gamepad.refreshDevices(true));
  window.addEventListener('focus', () => gamepad.refreshDevices(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) gamepad.refreshDevices(true);
  });
  gamepad.refreshDevices(true);

  const state = createState();
  resetToRunway(state);
  const ctrl = createControls();
  aircraftSelect.addEventListener('change', () => {
    resetControls(ctrl);
    resetAircraft(state, aircraftSelect.value);
    prevState = snapshot(state);
    acc = 0;
    camera.resetView();
  });

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
    gamepad.refreshDevices();
    const padSample = inputSelect.value === 'keyboard' ? null : gamepad.sample(dt);
    const kbSample = keyboard.sample(dt);
    const usingPad = !!padSample && gamepad.connected;
    const inp = inputSelect.value === 'keyboard' ? kbSample : padSample;

    // apply control conditioning / accumulation
    applyControls(ctrl, inp, dt);

    // right stick drives camera look-around (MSFS-style); recenters off-pad
    camera.setLook(inp?.look?.x ?? 0, inp?.look?.y ?? 0);

    // edge actions from both sources
    // Drain both queues so actions from an inactive device cannot fire later
    // when the user switches inputs.
    const keyboardActions = keyboard.drainActions();
    const gamepadActions = gamepad.drainActions();
    const actions = inputSelect.value === 'keyboard' ? keyboardActions : gamepadActions;
    for (const a of actions) {
      if (a === 'flaps' && state.aircraftType === 'fixedwing') {
        state.flapDetent = (state.flapDetent + 1) % FLAP_DEG.length;
      } else if (a === 'flapsUp' && state.aircraftType === 'fixedwing') {
        state.flapDetent = Math.max(0, state.flapDetent - 1);
      } else if (a === 'flapsDown' && state.aircraftType === 'fixedwing') {
        state.flapDetent = Math.min(FLAP_DEG.length - 1, state.flapDetent + 1);
      }
      else if (a === 'parkbrake') ctrl.parkingBrake = !ctrl.parkingBrake;
      else if (a === 'view') camera.cycle();
      else if (a === 'resetview') camera.resetView();
      else if (a === 'reset') {
        resetAircraft(state, state.aircraftType);
        prevState = snapshot(state);
      }
      else if (a === 'pause') paused = !paused;
      else if (a === 'help') hud.showHelp = !hud.showHelp;
    }

    // ---- fixed-step physics with accumulator ----
    if (!paused && !hud.showHelp) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 8) {
        prevState = snapshot(state);
        if (state.aircraftType === 'quad') {
          stepQuad(state, ctrl, FIXED_DT, groundHeight);
        } else {
          stepPhysics(state, ctrl, FIXED_DT, groundHeight);
        }
        acc -= FIXED_DT; steps++;
      }
    } else {
      acc = 0;
    }

    // ---- interpolation factor ----
    const alpha = clamp(acc / FIXED_DT, 0, 1);
    const rs = interpolate(prevState, state, alpha);

    // Fixed-wing propeller idles; quad rotors stop at zero collective.
    const propSpeed = state.aircraftType === 'quad'
      ? state.thrustState * 180
      : 8 + state.thrustState * 90;
    propAngle += dt * propSpeed;

    // ---- render ----
    camera.update(rs, dt);
    scene.render(camera, rs, ctrl, propAngle);
    hud.draw(rs.full, ctrl, {
      gamepad: usingPad,
      inputName: usingPad ? gamepad.id : 'Keyboard',
      paused,
    }, dt);
    audio.update(state, dt);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function resetAircraft(state, aircraftType) {
  if (aircraftType === 'quad') resetQuad(state, groundHeight);
  else resetToRunway(state);
}

function updateInputOptions(select, devices) {
  const selected = select.value;
  select.replaceChildren(new Option('Keyboard', 'keyboard'));
  if (devices.length === 0) {
    const hint = new Option('No gamepad - press a button, then Refresh', 'no-gamepad');
    hint.disabled = true;
    select.add(hint);
  }
  for (const device of devices) {
    select.add(new Option(device.id || `Gamepad ${device.index + 1}`, String(device.index)));
  }
  const stillAvailable = [...select.options].some((option) => option.value === selected);
  select.value = stillAvailable ? selected : 'keyboard';
}

// accumulate keyboard/gamepad contributions into the persistent controls object.
function applyControls(ctrl, inp, dt) {
  if (!inp) return;
  ctrl.aileron = inp.aileron;
  ctrl.elevator = inp.elevator;
  ctrl.rudder = inp.rudder;
  ctrl.brake = Math.max(inp.brake, ctrl.parkingBrake ? 1 : 0);
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
