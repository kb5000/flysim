import assert from 'node:assert/strict';
import { connectedGamepads, mapStandardGamepad } from '../src/input/gamepad.js';

const pad0 = { index: 0, id: 'Xbox compatible', connected: true };
const pad2 = { index: 2, id: 'Flight controls', connected: true };
const disconnected = { index: 3, id: 'Old pad', connected: false };

assert.deepEqual(
  connectedGamepads([pad0, null, pad2, disconnected]),
  [pad0, pad2],
  'Chrome-style null slots and disconnected pads should be filtered'
);
assert.deepEqual(connectedGamepads(null), []);

const axes = [0.8, -0.7, 0.5, 0.9];
const buttons = Array(16).fill(0);
buttons[5] = 1; // RB
const mapped = mapStandardGamepad(axes, buttons, 1);
assert(mapped.aileron > 0.5, 'RB must not disable left-stick aileron');
assert(mapped.elevator < -0.4, 'RB must not disable left-stick elevator');
assert(mapped.trimDelta > 0.2, 'RB + right-stick pull should add nose-up trim');
assert.deepEqual(mapped.look, { x: 0, y: 0 }, 'RB must suppress camera look');

console.log('GAMEPAD TESTS PASSED');
