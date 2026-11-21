// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the water (src/water.asm): how wet the player's car is, and its flooding, worked out again here so
// the tests can hold the program to it frame by frame. The car's wading is in car-model.mjs (WADE), and a
// flooded car's sinking in traffic-model.mjs (SINK). The rules are the program's: see the comments there.
import { AXIS, direction16 } from './car-model.mjs';
import { kindAt } from './foot-model.mjs';

const WATER = 3; // a tile's kind

/** Thirds of the car in the water: its middle and the points 6 pixels ahead of and behind it. */
export function wetness(car) {
  const [ox, oy] = AXIS[direction16(car.angle)];
  let n = 0;
  for (const t of [0, 1, -1]) if (kindAt(car.px + t * ox, car.py + t * oy) === WATER) n++;
  return n;
}

/**
 * water.update, after the traffic has moved: on foot there is no car; in a frame that moves the screen nothing
 * is looked at; otherwise the car's wetness, and if it is wholly in the water it floods. `cell` is the
 * character the window was in before it moved.
 */
export function waterStep(world, cell) {
  const { player, car, traffic, cam } = world;
  player.car = car; // (a test may have put a new car in the world's place)
  if (player.on) {
    car.wet = 0;
    return;
  }
  if (((cam.x >> 3) ^ cell[0]) & 31 || ((cam.y >> 3) ^ cell[1]) & 31) return;
  car.wet = wetness(car);
  if (car.wet < 3) return;
  const slot = player.constructor.place(traffic);
  if (slot < 0) return;
  // Out at its middle, swimming, and the car going down where it is.
  player.swim = 1;
  car.wet = 0;
  player.out(traffic, slot, [car.px, car.py], 1);
}
