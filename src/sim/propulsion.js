// Propeller thrust model with first-order engine spool response.
import { C172 } from './aircraft-c172.js';
import { clamp } from '../math.js';

// Advance spooled thrust fraction toward commanded throttle (first order).
export function updateEngine(s, dt) {
  const cmd = clamp(s.throttle, 0, 1);
  const tau = C172.thrustTau;
  // exact discrete first-order step
  const a = 1 - Math.exp(-dt / tau);
  s.thrustState += (cmd - s.thrustState) * a;
  return s.thrustState;
}

// Thrust force (N) along body +X. V is true airspeed (m/s).
export function thrust(s, V) {
  const frac = clamp(1 - V / C172.Vmax, 0, 1);
  return C172.Tstatic * frac * s.thrustState;
}
