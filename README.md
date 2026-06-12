# FlySim — WebGL Fixed-Wing Flight Simulator

A zero-dependency, zero-build browser flight simulator focused on **realistic
6DOF flight dynamics**. Native WebGL2 + ES Modules, no npm, no CDN, no bundler.

## Run

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works. Click or press a key to start; press **H** for the
controls overlay.

## Controls

### Xbox gamepad — MSFS 2020 default layout
| Control | Function |
|---|---|
| Left stick X / Y | Aileron (roll) / Elevator (pull back = nose up) |
| Right stick | Camera look-around (recenters on release) |
| LT / RT | Rudder left / right |
| A (hold) / B (hold) | Throttle increase / decrease |
| X (hold) | Brakes |
| RB (hold) + right stick Y | Pitch trim (pull back = nose-up trim) |
| D-pad Up / Down | Flaps retract / extend one notch (0° / 10° / 25°) |
| D-pad Left | Parking brake toggle |
| Y | Reset camera view |
| View (Back) | Cycle camera |
| Menu (Start) | Pause |
| D-pad Right | Reset to runway (FlySim extra; unbound in MSFS) |

Keyboard `[` / `]` also trims. While RB is held the right stick trims instead
of moving the camera.

Hot-pluggable. Use the input menu in the top-right corner to explicitly choose
the keyboard or one of the connected gamepads; connecting a pad does not
automatically take over the controls. Browsers may hide a gamepad until it has
produced input, so press a button on the pad and use **Refresh** if it is not
listed yet. Run the simulator as a top-level `http://localhost` page. Embedded
preview frames may block the Gamepad API unless they explicitly grant the
`gamepad` permission.

### Keyboard
Arrows = pitch/roll (Down = pull up), A/D = rudder, W/S = throttle,
`[` `]` = trim, F = flaps, B = brakes, C = camera, R = reset, P = pause, H = help.

## Flight model

- Fixed-step **120 Hz semi-implicit Euler** with an accumulator and render
  interpolation. World frame ENU; body frame X-nose, Y-right, Z-down.
- Aerodynamics from coefficients: lift with smooth stall roll-off, induced +
  parasite + flap/gear drag, side force, and full moment set (static stability,
  damping, control power, **aileron adverse yaw**) using nondimensional rates.
- Propeller thrust decaying with airspeed, first-order engine spool (~0.5 s),
  ISA density vs. altitude, IAS vs. TAS.
- Three-point landing gear (spring-damper + rolling/braking/lateral friction,
  steerable nosewheel); takeoff, landing, hard-touchdown crash detection.
- Class Cessna-172 parameters (see `src/sim/aircraft-c172.js`), lightly tuned
  for feel.

## Self-test

```sh
node test/physics-smoke.mjs
```

Pure-sim smoke test (no WebGL/DOM): full-throttle takeoff reaches >55 kt within
a sane roll, trimmed cruise stays bounded for 60 s, CL falls past the stall
angle, and aileron input produces roll with adverse yaw.

## Layout

See `PLAN.md` section 7. Code under `src/` is split into `sim/` (dynamics),
`engine/` (GL), `world/` (terrain/runway/sky), `render/` (scene + aircraft mesh),
`input/` (gamepad/keyboard), and `ui/` (HUD + audio).
