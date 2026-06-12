// Cessna-172-like single-engine trainer parameters.
// Values are derived from public C172 stability data, lightly tuned for feel.
// Body frame: +X nose, +Y right wing, +Z down.

export const C172 = {
  // mass / geometry
  mass: 1100,          // kg
  S: 16.2,             // wing area m^2
  b: 11.0,             // wing span m
  cbar: 1.49,          // mean aero chord m
  AR: 7.46,            // aspect ratio b^2/S
  e: 0.75,             // Oswald efficiency

  // inertia (kg m^2), diagonal tensor
  Ixx: 1285,
  Iyy: 1825,
  Izz: 2667,

  // ---- lift ----
  CL0: 0.31,
  CLa: 5.1,            // per rad
  alphaStall: 15 * Math.PI / 180,   // rad
  CLmax: 1.5,
  CLflap: [0.0, 0.35, 0.7],         // additional CL0 per flap detent (0/10/25 deg)

  // ---- drag ----
  CD0: 0.025,
  CDflap: [0.0, 0.012, 0.045],      // additional parasite drag per flap detent
  CDgear: 0.012,                    // fixed gear drag (always present on a 172)

  // ---- side force ----
  CYb: -0.31,          // per rad

  // ---- pitch moment ----
  Cm0: 0.04,
  Cma: -0.89,          // per rad (static stability) -- tuned
  Cmq: -12.4,          // per rad (pitch damping, nondim)
  Cmde: -1.12,         // per rad elevator
  Cmflap: [0.0, -0.06, -0.12],      // pitch change with flaps (nose down)

  // ---- roll moment ----
  Clb: -0.089,         // dihedral effect per rad
  Clp: -0.47,          // roll damping
  Clr: 0.096,          // roll due yaw rate
  Clda: 0.178,         // aileron power per rad
  Cldr: 0.008,

  // ---- yaw moment ----
  Cnb: 0.065,          // weathercock stability per rad
  Cnr: -0.099,         // yaw damping
  Cnp: -0.03,          // yaw due roll rate
  Cndr: 0.042,         // softened rudder authority for less abrupt yaw response
  Cnda: -0.053,        // adverse yaw from aileron per rad

  // ---- control surface deflection limits (rad) ----
  elevMax: 25 * Math.PI / 180,
  ailMax: 20 * Math.PI / 180,
  rudMax: 22 * Math.PI / 180,
  trimRange: 12 * Math.PI / 180,    // total elevator-equivalent trim authority

  // ---- propulsion ----
  Tstatic: 3000,       // N static thrust at full throttle
  Vmax: 120,           // m/s extrapolated zero-thrust speed for prop efficiency
  thrustTau: 0.5,      // s spool-up time constant
  propTorqueFactor: 0.0008,  // slight yaw/roll from slipstream/torque

  // ---- landing gear (3-point), positions in body frame (m) ----
  // nose gear forward, mains aft, all below CG (+Z down)
  gear: [
    { name: 'nose', pos: [1.1, 0.0, 0.85], k: 38000, c: 6500, steer: true, brake: false, maxSteer: 30 * Math.PI / 180 },
    { name: 'left', pos: [-0.4, -1.3, 0.85], k: 55000, c: 9000, steer: false, brake: true, maxSteer: 0 },
    { name: 'right', pos: [-0.4, 1.3, 0.85], k: 55000, c: 9000, steer: false, brake: true, maxSteer: 0 },
  ],
  muRoll: 0.04,        // rolling resistance
  muBrake: 0.55,       // braking friction
  muSideStatic: 0.85,  // tire lateral grip
  crashVerticalSpeed: 4.5,  // m/s vertical touchdown speed -> crash
};
