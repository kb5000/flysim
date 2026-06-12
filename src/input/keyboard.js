// Keyboard input. Holds key state and exposes per-frame control contributions
// plus edge-triggered actions (flaps, view, reset, pause, help).

export class Keyboard {
  constructor() {
    this.down = new Set();
    this.actions = [];   // queued edge events: 'flaps','view','reset','pause','help'
    this._onDown = (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.down.add(k);
      // edge actions
      if (k === 'f') this.actions.push('flaps');
      else if (k === 'c') this.actions.push('view');
      else if (k === 'r') this.actions.push('reset');
      else if (k === 'p') this.actions.push('pause');
      else if (k === 'h') this.actions.push('help');
      // prevent scrolling on arrows/space
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
    };
    this._onUp = (e) => this.down.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  // returns {aileron, elevator, rudder, throttleDelta, brake, trimDelta}
  // throttle is adjusted via W/S as a rate; trim via [ and ].
  sample(dt) {
    const d = this.down;
    const ax = (a, b) => (d.has(a) ? -1 : 0) + (d.has(b) ? 1 : 0);
    const aileron = ax('arrowleft', 'arrowright');
    // pull = nose up = elevator positive; Up arrow = nose down? convention:
    // ArrowUp pushes nose down (stick forward), ArrowDown pulls nose up.
    const elevator = (d.has('arrowdown') ? 1 : 0) + (d.has('arrowup') ? -1 : 0);
    const rudder = ax('a', 'd');
    let throttleDelta = 0;
    if (d.has('w')) throttleDelta += dt * 0.5;
    if (d.has('s')) throttleDelta -= dt * 0.5;
    const brake = d.has('b') ? 1 : 0;
    let trimDelta = 0;
    if (d.has('[')) trimDelta -= dt * 0.3;
    if (d.has(']')) trimDelta += dt * 0.3;
    return { aileron, elevator, rudder, throttleDelta, brake, trimDelta };
  }

  drainActions() { const a = this.actions; this.actions = []; return a; }
  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
  }
}
