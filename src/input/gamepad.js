// Xbox gamepad (Gamepad API standard mapping). Hot-pluggable. Produces the same
// shape as the keyboard sampler plus edge actions, and reports connection state.
//
// Bindings follow the MSFS 2020 default Xbox controller profile:
//   Left stick   = aileron / elevator (pull back = nose up)
//   Right stick  = camera look-around
//   LT / RT      = rudder left / right
//   A / B (hold) = throttle increase / decrease
//   X (hold)     = brakes
//   RB (hold)    = modifier: right stick Y becomes pitch trim (pull = nose-up trim)
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

export function connectedGamepads(pads) {
  return Array.from(pads || []).filter((p) => p != null && p.connected !== false);
}

export function mapStandardGamepad(axes, buttonValues, dt) {
  const a = axes, b = buttonValues;
  const rbHeld = (b[5] ?? 0) > 0.5;
  const aileron = conditionAxis(a[0] ?? 0);
  const elevator = conditionAxis(a[1] ?? 0);
  const trimDelta = rbHeld ? conditionAxis(a[3] ?? 0) * dt * 0.3 : 0;

  const lt = b[6] ?? 0, rt = b[7] ?? 0;
  const rudder = clamp(rt - lt, -1, 1);

  let throttleDelta = 0;
  if ((b[0] ?? 0) > 0.5) throttleDelta += dt * THROTTLE_RATE;
  if ((b[1] ?? 0) > 0.5) throttleDelta -= dt * THROTTLE_RATE;

  return {
    aileron,
    elevator,
    rudder,
    throttleDelta,
    brake: b[2] ?? 0,
    trimDelta,
    look: {
      x: rbHeld ? 0 : conditionAxis(a[2] ?? 0),
      y: rbHeld ? 0 : conditionAxis(a[3] ?? 0),
    },
  };
}

export class Gamepad {
  constructor(onDevicesChanged = null, onStatusChanged = null) {
    this.index = null;
    this.connected = false;
    this.id = '';
    this.prevButtons = [];
    this.actions = [];
    this.onDevicesChanged = onDevicesChanged;
    this.onStatusChanged = onStatusChanged;
    this._signature = '';
    this.knownPads = new Map();
    this.lastError = '';
    this.eventSeen = false;
    window.addEventListener('gamepadconnected', (e) => {
      this.eventSeen = true;
      this.knownPads.set(e.gamepad.index, {
        index: e.gamepad.index,
        id: e.gamepad.id,
      });
      this._notifyDevices();
      // Chromium can update navigator.getGamepads() one frame after the event.
      requestAnimationFrame(() => this.refreshDevices(true));
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      this.knownPads.delete(e.gamepad.index);
      if (e.gamepad.index === this.index) {
        this.connected = false; this.index = null;
        this.id = '';
      }
      this._notifyDevices();
    });
  }

  devices() {
    const getPads = navigator.getGamepads?.bind(navigator)
      || navigator.webkitGetGamepads?.bind(navigator);
    if (!getPads) {
      this.lastError = 'This browser does not provide the Gamepad API.';
      return [];
    }
    let pads;
    try {
      pads = getPads() || [];
      this.lastError = '';
    } catch (error) {
      this.lastError = `${error.name || 'Gamepad error'}: ${error.message || error}`;
      return [];
    }
    for (const p of connectedGamepads(pads)) {
      this.knownPads.set(p.index, { index: p.index, id: p.id });
    }
    return [...this.knownPads.values()].sort((a, b) => a.index - b.index);
  }

  select(index) {
    this.index = Number.isInteger(index) ? index : null;
    this.connected = false;
    this.id = '';
    this.prevButtons = [];
    this.actions = [];
  }

  refreshDevices(force = false) {
    const devices = this.devices();
    const signature = devices.map((p) => `${p.index}:${p.id}`).join('|');
    if (force || signature !== this._signature) {
      this._signature = signature;
      this.onDevicesChanged?.(devices);
    }
    this.onStatusChanged?.(this.status(devices));
    return devices;
  }

  status(devices = this.devices()) {
    const policy = document.permissionsPolicy || document.featurePolicy;
    let allowed = true;
    try {
      if (policy?.allowsFeature) allowed = policy.allowsFeature('gamepad');
    } catch {
      // Some browsers expose the policy object without the gamepad feature.
    }
    if (this.lastError) return this.lastError;
    if (!allowed) return 'Gamepad blocked by this embedded page. Open the localhost URL in a normal browser tab.';
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      return `Insecure page (${location.protocol}). Open through http://localhost, not file:// or a LAN IP.`;
    }
    if (devices.length > 0) return `${devices.length} gamepad(s) detected. Select one above.`;
    const context = window.top === window.self ? 'top-level page' : 'embedded preview';
    return `API available, 0 devices (${context}). Focus this page, press a gamepad button, then Refresh.`;
  }

  _notifyDevices() {
    this._signature = '';
    this.refreshDevices();
  }

  _pad() {
    if (this.index == null) return null;
    const getPads = navigator.getGamepads?.bind(navigator)
      || navigator.webkitGetGamepads?.bind(navigator);
    const pads = getPads ? getPads() : [];
    return pads[this.index] || null;
  }

  // returns null if no pad, else same control contributions as keyboard.sample
  sample(dt) {
    const p = this._pad();
    if (!p) { this.connected = false; return null; }
    this.connected = true;
    this.id = p.id;
    const a = p.axes, b = p.buttons.map((x) => x.value);
    const mapped = mapStandardGamepad(a, b, dt);

    // edge actions
    this._edge(b, 12, 'flapsUp');    // D-pad up: retract one notch
    this._edge(b, 13, 'flapsDown');  // D-pad down: extend one notch
    this._edge(b, 14, 'parkbrake');  // D-pad left
    this._edge(b, 15, 'reset');      // D-pad right (FlySim extra)
    this._edge(b, 3, 'resetview');   // Y
    this._edge(b, 8, 'view');        // View/Back
    this._edge(b, 9, 'pause');       // Menu/Start
    this.prevButtons = b;

    return mapped;
  }

  _edge(b, i, name) {
    const now = (b[i] ?? 0) > 0.5;
    const was = (this.prevButtons[i] ?? 0) > 0.5;
    if (now && !was) this.actions.push(name);
  }

  drainActions() { const a = this.actions; this.actions = []; return a; }
}
