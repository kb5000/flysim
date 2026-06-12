// Xbox gamepad (Gamepad API standard mapping). Hot-pluggable. Produces the same
// shape as the keyboard sampler plus edge actions, and reports connection state.
//
// Standard mapping reference:
//   axes[0] LX, axes[1] LY, axes[2] RX, axes[3] RY
//   buttons: 0 A,1 B,2 X,3 Y,4 LB,5 RB,6 LT,7 RT,8 Back,9 Start,
//            12 DpadUp,13 DpadDown,14 DpadLeft,15 DpadRight
import { conditionAxis } from './controls.js';
import { clamp } from '../math.js';

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

    const aileron = conditionAxis(a[0] ?? 0);
    const elevator = conditionAxis(a[1] ?? 0); // stick forward (negative) -> nose down? LY up is -1
    // LY: pushing forward gives negative; we want forward = nose down = elevator negative.
    // a[1] forward = -1 -> elevator should be -1 (push). So elevator = conditionAxis(a[1]) gives
    // forward(-1) -> -1 (nose down). Pull back (+1) -> +1 (nose up). Correct.

    // rudder from triggers LT(6)/RT(7): right positive
    const lt = b[6] ?? 0, rt = b[7] ?? 0;
    const rudder = clamp(rt - lt, -1, 1);

    // throttle increment from right stick Y (forward = add throttle)
    const ry = conditionAxis(a[3] ?? 0);
    let throttleDelta = -ry * dt * 0.8; // push forward (negative) -> increase
    // LB/RB quick throttle
    if (b[4] > 0.5) throttleDelta -= dt * 1.5;
    if (b[5] > 0.5) throttleDelta += dt * 1.5;

    const brake = (b[0] ?? 0); // A
    // pitch trim from dpad up/down
    let trimDelta = 0;
    if ((b[12] ?? 0) > 0.5) trimDelta += dt * 0.3; // up -> nose up trim
    if ((b[13] ?? 0) > 0.5) trimDelta -= dt * 0.3;

    // edge actions
    this._edge(b, 1, 'flaps');  // B
    this._edge(b, 2, 'reset');  // X
    this._edge(b, 3, 'view');   // Y
    this._edge(b, 9, 'pause');  // Start
    this.prevButtons = b;

    return { aileron, elevator, rudder, throttleDelta, brake, trimDelta };
  }

  _edge(b, i, name) {
    const now = (b[i] ?? 0) > 0.5;
    const was = (this.prevButtons[i] ?? 0) > 0.5;
    if (now && !was) this.actions.push(name);
  }

  drainActions() { const a = this.actions; this.actions = []; return a; }
}
