// Xbox gamepad (Gamepad API standard mapping). Hot-pluggable. Produces the same
// shape as the keyboard sampler plus edge actions, and reports connection state.
//
// Bindings follow the MSFS 2020 default Xbox controller profile:
//   Left stick   = aileron / elevator (pull back = nose up)
//   Right stick  = camera look-around
//   LT / RT      = rudder left / right
//   A / B (hold) = throttle increase / decrease
//   X (hold)     = brakes
//   RB (hold)    = modifier: left stick Y becomes pitch trim (pull = nose-up trim)
//   D-pad Up/Dn  = flaps retract / extend one notch
//   D-pad Left   = parking brake toggle
//   Y            = reset camera view
//   View (Back)  = cycle camera,  Menu (Start) = pause
//   D-pad Right  = reset to runway (FlySim extra; unbound in MSFS)
//
// Standard mapping reference:
//   axes[0] LX, axes[1] LY, axes[2] RX, axes[3] RY
//   buttons: 0 A,1 B,2 X,3 Y,4 LB,5 RB,6 LT,7 RT,8 Back,9 Start,
//            12 DpadUp,13 DpadDown,14 DpadLeft,15 DpadRight
import { conditionAxis } from './controls.js';
import { clamp } from '../math.js';

const THROTTLE_RATE = 0.5; // full sweep in 2 s, like MSFS's gradual A/B throttle

export class Gamepad {
  constructor() {
    this.index = null;
    this.connected = false;
    this.id = '';
    this.prevButtons = [];
    this.actions = [];
    window.addEventListener('gamepadconnected', (e) => {
      this.index = e.gamepad.index;
      this.connected = true;
      this.id = e.gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.index) {
        this.connected = false; this.index = null;
      }
    });
  }

  _pad() {
    if (this.index == null) {
      // attempt to discover an already-connected pad
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p) { this.index = p.index; this.connected = true; this.id = p.id; break; }
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return (this.index != null) ? pads[this.index] : null;
  }

  // returns null if no pad, else same control contributions as keyboard.sample
  sample(dt) {
    const p = this._pad();
    if (!p) { this.connected = false; return null; }
    this.connected = true;
    const a = p.axes, b = p.buttons.map((x) => x.value);

    // RB is a modifier (as in MSFS): while held, the left stick trims instead
    // of deflecting the primary controls.
    const rbHeld = (b[5] ?? 0) > 0.5;

    // LY: pushing forward gives negative; we want forward = nose down = elevator negative.
    // Pull back (+1) -> +1 (nose up). Matches MSFS (pull back to climb).
    const aileron = rbHeld ? 0 : conditionAxis(a[0] ?? 0);
    const elevator = rbHeld ? 0 : conditionAxis(a[1] ?? 0);
    // pull back with RB held = nose-up trim, rate scaled by deflection
    const trimDelta = rbHeld ? conditionAxis(a[1] ?? 0) * dt * 0.3 : 0;

    // rudder from triggers LT(6)/RT(7): right positive
    const lt = b[6] ?? 0, rt = b[7] ?? 0;
    const rudder = clamp(rt - lt, -1, 1);

    // throttle: hold A to increase, hold B to decrease
    let throttleDelta = 0;
    if ((b[0] ?? 0) > 0.5) throttleDelta += dt * THROTTLE_RATE;
    if ((b[1] ?? 0) > 0.5) throttleDelta -= dt * THROTTLE_RATE;

    const brake = (b[2] ?? 0); // X (hold)

    // right stick = camera look-around (deadzone only; expo not wanted for view)
    const look = {
      x: conditionAxis(a[2] ?? 0),
      y: conditionAxis(a[3] ?? 0),
    };

    // edge actions
    this._edge(b, 12, 'flapsUp');    // D-pad up: retract one notch
    this._edge(b, 13, 'flapsDown');  // D-pad down: extend one notch
    this._edge(b, 14, 'parkbrake');  // D-pad left
    this._edge(b, 15, 'reset');      // D-pad right (FlySim extra)
    this._edge(b, 3, 'resetview');   // Y
    this._edge(b, 8, 'view');        // View/Back
    this._edge(b, 9, 'pause');       // Menu/Start
    this.prevButtons = b;

    return { aileron, elevator, rudder, throttleDelta, brake, trimDelta, look };
  }

  _edge(b, i, name) {
    const now = (b[i] ?? 0) > 0.5;
    const was = (this.prevButtons[i] ?? 0) > 0.5;
    if (now && !was) this.actions.push(name);
  }

  drainActions() { const a = this.actions; this.actions = []; return a; }
}
