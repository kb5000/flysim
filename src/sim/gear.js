// Three-point landing gear contact model.
// Each gear is a point in the body frame (+X nose, +Y right, +Z down).
// World frame is ENU (+Z up). Ground may be an arbitrary heightfield.
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
  for (const g of C172.gear) {
    // gear world position: pos + R*bodyPos
    const rW = quat.rotate(s.q, g.pos);     // body offset rotated to world
    const gw = vec3.add(s.pos, rW);
    const gh = groundHeight(gw[0], gw[1]);
    const normal = groundNormal(groundHeight, gw[0], gw[1], gh);
    // Convert vertical heightfield overlap to distance along the local normal.
    const pen = (gh - gw[2]) * normal[2];
    if (pen <= 0) continue;

    nContact++;

    // velocity of contact point in world: v + omega(world) x rW
    const omegaW = quat.rotate(s.q, s.omega);
    const vPoint = vec3.add(s.vel, vec3.cross(omegaW, rW));
    const vNormal = vec3.dot(vPoint, normal);
    const vDown = -vNormal; // speed into the slope normal, positive on impact
    if (vDown > maxDownSpeed) maxDownSpeed = vDown;

    // ---- normal force (spring-damper), along the terrain normal ----
    let Fn = g.k * pen - g.c * vNormal;
    if (Fn < 0) Fn = 0;                       // gear can't pull down
    const normalForce = vec3.scale(normal, Fn);

    // ---- friction in the local terrain tangent plane ----
    // build wheel rolling direction. For mains it is the aircraft heading
    // projected onto the slope; nose wheel steers about the slope normal.
    let rollDir = vec3.addScaled(fwdW, normal, -vec3.dot(fwdW, normal));
    if (vec3.len(rollDir) < 1e-4) rollDir = [1, 0, 0];
    rollDir = vec3.normalize(rollDir);
    if (g.steer) {
      // Positive steering is clockwise when viewed along the terrain normal.
      const steerAng = -clamp(ctrl.steer, -1, 1) * g.maxSteer;
      rollDir = rotateAroundAxis(rollDir, normal, steerAng);
    }
    const sideDir = vec3.normalize(vec3.cross(normal, rollDir));

    const vGround = vec3.addScaled(vPoint, normal, -vNormal);
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

function groundNormal(groundHeight, x, y, centerHeight) {
  const sample = 1.5;
  const dhdx = (groundHeight(x + sample, y) - centerHeight) / sample;
  const dhdy = (groundHeight(x, y + sample) - centerHeight) / sample;
  return vec3.normalize([-dhdx, -dhdy, 1]);
}

function rotateAroundAxis(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const cross = vec3.cross(axis, v);
  const dot = vec3.dot(axis, v);
  return [
    v[0] * c + cross[0] * s + axis[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + axis[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + axis[2] * dot * (1 - c),
  ];
}
