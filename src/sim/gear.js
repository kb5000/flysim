// Three-point landing gear contact model.
// Each gear is a point in the body frame (+X nose, +Y right, +Z down).
// World frame is ENU (+Z up), ground at world z = 0.
//
// For each gear we find its world position, and if it has penetrated the
// ground we apply a spring-damper normal force plus tire friction (rolling /
// braking longitudinal, and lateral grip). The nose wheel steers with rudder.
//
// Returns accumulated world-frame force and body-frame moment to add to the
// rigid body, plus contact bookkeeping for crash / on-ground detection.

import { C172 } from './aircraft-c172.js';
import { quat, vec3, clamp } from '../math.js';

// Compute ground reaction. Inputs:
//   s: state (pos world, vel world, q body->world, omega body)
//   ctrl: controls (brake 0..1, steer -1..1)
//   groundHeight(x,y): world ground elevation at a horizontal position
// Mutates nothing; returns { force (world), moment (body), nContact, maxVerticalImpact }
export function gearForces(s, ctrl, groundHeight) {
  let F = [0, 0, 0];          // accumulated world force
  let Mbody = [0, 0, 0];      // accumulated body moment
  let nContact = 0;
  let maxDownSpeed = 0;       // for crash detection (downward speed at contact)

  // body axes expressed in world
  const fwdW = quat.rotate(s.q, [1, 0, 0]);  // nose
  // world up
  const up = [0, 0, 1];

  for (const g of C172.gear) {
    // gear world position: pos + R*bodyPos
    const rW = quat.rotate(s.q, g.pos);     // body offset rotated to world
    const gw = vec3.add(s.pos, rW);
    const gh = groundHeight(gw[0], gw[1]);
    const pen = gh - gw[2];                  // penetration depth (>0 if below ground)
    if (pen <= 0) continue;

    nContact++;

    // velocity of contact point in world: v + omega(world) x rW
    const omegaW = quat.rotate(s.q, s.omega);
    const vPoint = vec3.add(s.vel, vec3.cross(omegaW, rW));
    const vDown = -vPoint[2]; // downward speed (penetration rate, +)
    if (vDown > maxDownSpeed) maxDownSpeed = vDown;

    // ---- normal force (spring-damper), along world +Z ----
    let Fn = g.k * pen - g.c * vPoint[2];    // -c*vz: vz<0 (descending) adds force
    if (Fn < 0) Fn = 0;                       // gear can't pull down
    const normalForce = [0, 0, Fn];

    // ---- friction in ground plane ----
    // build wheel rolling direction. For mains it is the aircraft heading
    // projected to ground; nose wheel steers about world up.
    let rollDir = [fwdW[0], fwdW[1], 0];
    if (vec3.len(rollDir) < 1e-4) rollDir = [1, 0, 0];
    rollDir = vec3.normalize(rollDir);
    if (g.steer) {
      // Heading increases clockwise in ENU, opposite a +Z mathematical rotation.
      const steerAng = -clamp(ctrl.steer, -1, 1) * g.maxSteer;
      const cs = Math.cos(steerAng), sn = Math.sin(steerAng);
      rollDir = [
        rollDir[0] * cs - rollDir[1] * sn,
        rollDir[0] * sn + rollDir[1] * cs,
        0,
      ];
    }
    // lateral direction = up x roll
    const sideDir = vec3.normalize(vec3.cross(up, rollDir));

    // ground-plane velocity of the contact point
    const vGround = [vPoint[0], vPoint[1], 0];
    const vRoll = vec3.dot(vGround, rollDir);
    const vSide = vec3.dot(vGround, sideDir);

    // longitudinal friction: rolling resistance + braking
    const muLong = C172.muRoll + (g.brake ? clamp(ctrl.brake, 0, 1) * C172.muBrake : 0);
    const maxLong = muLong * Fn;
    // oppose rolling motion, but cap so it can't reverse the aircraft
    let fRoll = -Math.sign(vRoll) * Math.min(maxLong, Math.abs(vRoll) * C172.mass * 3);

    // lateral friction: strong grip resisting side slip (keeps rollout straight)
    const maxSide = C172.muSideStatic * Fn;
    let fSide = -clamp(vSide * C172.mass * 4, -maxSide, maxSide);

    const friction = vec3.addScaled(
      vec3.scale(rollDir, fRoll), sideDir, fSide
    );

    const total = vec3.add(normalForce, friction);
    F = vec3.add(F, total);

    // moment about CG, in body frame: r_body x F_body
    const Fbody = quat.rotateInv(s.q, total);
    Mbody = vec3.add(Mbody, vec3.cross(g.pos, Fbody));
  }

  return { force: F, moment: Mbody, nContact, maxDownSpeed };
}
