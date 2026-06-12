// ISA-simplified atmosphere. Altitude h in meters above sea level (ENU +Z up).
export const RHO0 = 1.225; // kg/m^3 sea level

export function density(h) {
  // valid for troposphere; clamp to avoid negatives at extreme altitude
  const base = 1 - 2.2558e-5 * h;
  if (base <= 0) return 0.0;
  return RHO0 * Math.pow(base, 4.2559);
}

// indicated airspeed (sea-level-equivalent) from true airspeed and local density
export function tasToIas(tas, rho) {
  return tas * Math.sqrt(rho / RHO0);
}
