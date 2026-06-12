// Aerodynamic force and moment model in the body frame.
// Body frame: +X nose, +Y right wing, +Z down (aviation convention).
//
// Given the body-frame airspeed vector (relative wind seen by the aircraft),
// we compute angle of attack alpha, sideslip beta, dynamic pressure, then the
// aerodynamic coefficients and the resulting body-frame force & moment.
//
// Stall is modeled by blending the linear lift curve into a flat-plate model
// past alphaStall, giving CL roll-off (lift loss) and a large drag rise.

import { C172 } from './aircraft-c172.js';
import { clamp } from '../math.js';

// Smoothly blend linear lift and flat-plate lift around the stall angle so the
// transition (and recovery) is continuous. sigma in [0,1]: 0 = fully attached.
function stallBlend(alpha) {
  const a0 = C172.alphaStall;
  const width = 4 * Math.PI / 180; // blend band half-width
  // symmetric in +/- alpha
  const a = Math.abs(alpha);
  return clamp((a - a0) / width, 0, 1);
}

// Compute aero result. Inputs:
//   vBody: body-frame velocity of the aircraft through the air (m/s)
//   omega: body angular velocity [p,q,r] (rad/s)
//   rho:   air density (kg/m^3)
//   ctrl:  { elevator, aileron, rudder, pitchTrim } normalized -1..1
//   flapDetent: index
// Returns { force:[Fx,Fy,Fz] body N, moment:[L,M,N] body N·m, alpha, beta, V, Q, CL }
export function aero(vBody, omega, rho, ctrl, flapDetent) {
  const u = vBody[0]; // along nose
  const v = vBody[1]; // along right wing
  const w = vBody[2]; // along belly (+Z down)

  const V = Math.hypot(u, v, w);
  const Q = 0.5 * rho * V * V; // dynamic pressure

  // angles. alpha = atan2(w, u): positive when relative wind comes from below
  // (nose up relative to airflow). beta = asin(v / V).
  let alpha = 0, beta = 0;
  if (V > 0.5) {
    alpha = Math.atan2(w, u);
    beta = Math.asin(clamp(v / V, -1, 1));
  }

  const S = C172.S, b = C172.b, c = C172.cbar;

  // nondimensional angular rates  p̂ = p b /(2V), q̂ = q c /(2V), r̂ = r b /(2V)
  const denom = (V > 1) ? (2 * V) : 2; // avoid blow-up at very low speed
  const pHat = omega[0] * b / denom;
  const qHat = omega[1] * c / denom;
  const rHat = omega[2] * b / denom;

  // control deflections (rad).
  // Convention: ctrl.elevator > 0 means "pull" = nose up. Cmde is negative, so a
  // pull must map to a negative surface deflection to produce a nose-up moment.
  const de = -(clamp(ctrl.elevator, -1, 1) * C172.elevMax
    + clamp(ctrl.pitchTrim, -1, 1) * C172.trimRange);
  const da = clamp(ctrl.aileron, -1, 1) * C172.ailMax;
  const dr = clamp(ctrl.rudder, -1, 1) * C172.rudMax;

  // ---- lift coefficient with stall ----
  const flapCL = C172.CLflap[flapDetent] || 0;
  // attached (linear) lift
  let CLlin = C172.CL0 + flapCL + C172.CLa * alpha;
  CLlin = clamp(CLlin, -C172.CLmax - flapCL, C172.CLmax + flapCL);
  // flat-plate (fully separated) lift: ~2 sin a cos a, scaled to a modest peak
  const CLplate = 1.0 * Math.sin(2 * alpha);
  const sigma = stallBlend(alpha);
  let CL = (1 - sigma) * CLlin + sigma * CLplate;

  // ---- drag ----
  const flapCD = C172.CDflap[flapDetent] || 0;
  // induced drag uses the linear (circulation) lift so it doesn't vanish in stall
  const CDi = (CLlin * CLlin) / (Math.PI * C172.e * C172.AR);
  // separated flow adds large form drag in stall
  const CDsep = sigma * 1.0 * Math.abs(Math.sin(alpha));
  let CD = C172.CD0 + C172.CDgear + flapCD + CDi + CDsep;

  // ---- side force ----
  const CY = C172.CYb * beta + 0.0;

  // ---- moments (nondimensional coefficients) ----
  const flapCm = C172.Cmflap[flapDetent] || 0;
  const Cm = C172.Cm0 + flapCm + C172.Cma * alpha + C172.Cmq * qHat + C172.Cmde * de;
  const Cl = C172.Clb * beta + C172.Clp * pHat + C172.Clr * rHat + C172.Clda * da + C172.Cldr * dr;
  const Cn = C172.Cnb * beta + C172.Cnr * rHat + C172.Cnp * pHat + C172.Cndr * dr + C172.Cnda * da;

  // ---- assemble forces in stability/wind sense, rotate into body axes ----
  // Lift acts perpendicular to relative wind in the x-z plane; drag opposes it.
  // Work in the body x-z plane using alpha, then add side force on +Y.
  const L = Q * S * CL;   // lift magnitude
  const D = Q * S * CD;   // drag magnitude
  const Yf = Q * S * CY;  // side force (body +Y)

  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  // Drag is along -relativeWind (in x-z): wind dir in body = (u, w)/Vxz.
  // Express lift & drag in body axes. Standard result:
  //   Fx = L sin(a) - D cos(a)
  //   Fz = -L cos(a) - D sin(a)
  const Fx = L * sa - D * ca;
  const Fz = -L * ca - D * sa;
  const Fy = Yf;

  const Mx = Q * S * b * Cl;  // roll moment
  const My = Q * S * c * Cm;  // pitch moment
  const Mz = Q * S * b * Cn;  // yaw moment

  return {
    force: [Fx, Fy, Fz],
    moment: [Mx, My, Mz],
    alpha, beta, V, Q, CL, CD,
  };
}
