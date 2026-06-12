// Shared control-conditioning helpers: dead zone + exponential curve.
import { clamp } from '../math.js';

export const DEADZONE = 0.12;
export const EXPO = 0.4;

// apply radial-ish dead zone then expo curve to a -1..1 axis value.
export function conditionAxis(x) {
  const s = Math.sign(x);
  let a = Math.abs(x);
  if (a < DEADZONE) return 0;
  a = (a - DEADZONE) / (1 - DEADZONE); // rescale to 0..1
  // expo: blend linear and cubic
  a = (1 - EXPO) * a + EXPO * a * a * a;
  return clamp(s * a, -1, 1);
}
