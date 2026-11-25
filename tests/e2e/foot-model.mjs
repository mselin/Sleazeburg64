// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the player on foot and of getting in and out of cars (src/foot.asm), worked out again here so
// the tests can hold the program to it frame by frame. The rules are the program's: see the comments there
// for why they are what they are.
import { MAP_PIXELS, MAP_SIZE, PLAYER_SPRITE, assets } from './game.mjs';
import { direction16 } from './car-model.mjs';
import { TrafficCar } from './traffic-model.mjs';

export const F = {
  WALK: 297, WALK_DIAGONAL: 210, SWIM: 113, SWIM_DIAGONAL: 80, STRIDE: 184, SLOW: 230, REACH: 90,
  SOUTH: MAP_PIXELS - 11, COLOUR: 1 | 0x80, // white, multicolour
};
/** The way the stick points, by its four direction bits (up 1, down 2, left 4, right 8): 0 east, clockwise in eighths. */
export const WAY_OF = [-1, 6, 2, -1, 4, 5, 3, 4, 0, 7, 1, 0, -1, 6, 2, -1];
export const WAY_X = [1, 1, 0, -1, -1, -1, 0, 1], WAY_Y = [0, 1, 1, 1, 0, -1, -1, -1];
/** The walk: the pose for each part of its cycle. */
export const CYCLE = [2, 3, 4, 3, 2, 1, 0, 1];
const WALL = 1, WATER = 3; // a tile's kind (tools/assets.mjs)

/** What kind of ground pixel (x, y) of the city is. */
export const kindAt = (x, y) => assets.tiles[1280 + assets.map[(y >> 4) * MAP_SIZE + (x >> 4)]];

/**
 * foot.blocked: the player does not fit with their middle at pixel (x, y): one of the four corners 3 pixels
 * from it is in a wall or off the city, or it is further south than they go.
 */
export function blocked(x, y) {
  if (x - 3 < 0 || x + 3 >= MAP_PIXELS || y - 3 < 0 || y > F.SOUTH) return true;
  for (const cy of [y - 3, y + 3]) for (const cx of [x - 3, x + 3]) if (kindAt(cx, cy) === WALL) return true;
  return false;
}

export class Player {
  /** The player starts in `car` (car-model.mjs), with fire counted as held. */
  constructor(car) {
    // On foot: positions in 1/256 pixel, 24 bits, as the program keeps them.
    Object.assign(this, { car, on: 0, x: 0, y: 0, face: 0, phase: 0, swim: 0, fireWas: 1 });
  }
  /** Where the player is, in pixels: on foot, or their car. */
  get px() {
    return this.on ? this.x >> 8 : this.car.px;
  }
  get py() {
    return this.on ? this.y >> 8 : this.car.py;
  }
  /** One pass of the main loop with the joystick held as given (JOY bits). */
  step(bits, traffic, busy = false, people = null) {
    const fire = bits & 16 ? 1 : 0;
    const press = fire && !this.fireWas; // just pressed
    const use = press && !(bits & 15); // with the stick centred
    this.fireWas = fire;
    if (this.on) {
      this.walk(bits);
      if (use) this.enter(traffic);
      // Else fire is a punch (people-model.mjs): no ammo, no knife, and nobody fights in the water.
      if (this.on && press && !this.swim) people?.punch(this);
    } else {
      this.car.step(bits, traffic, busy);
      if (use) this.leave(traffic);
    }
  }
  walk(bits) {
    this.swim = kindAt(this.px, this.py) === WATER ? 1 : 0;
    const way = WAY_OF[bits & 15];
    if (way < 0) {
      this.phase = 0;
      return;
    }
    this.face = way;
    this.phase = (this.phase + F.STRIDE) & 0xffff;
    const amount = [F.WALK, F.WALK_DIAGONAL, F.SWIM, F.SWIM_DIAGONAL][(way & 1) | (this.swim << 1)];
    const stuck = blocked(this.px, this.py); // inside a wall: free to walk, or they could never leave
    if (WAY_X[way]) {
      const next = (this.x + WAY_X[way] * amount) & 0xffffff;
      if (stuck || !blocked(next >> 8, this.py)) this.x = next;
    }
    if (WAY_Y[way]) {
      const next = (this.y + WAY_Y[way] * amount) & 0xffffff;
      if (stuck || !blocked(this.px, next >> 8)) this.y = next;
    }
  }
  /** The car within reach that is nearest, as its place in the traffic's tables, or -1. */
  reach(traffic) {
    let best = -1, bestQ = F.REACH;
    for (let i = traffic.n - 1; i >= 0; i--) {
      const c = traffic.cars[i];
      if (!c.on || c.sink) continue; // nobody can get into a car that flooded
      const dx = Math.abs(c.px - this.px), dy = Math.abs(c.py - this.py);
      if (dx >= 20 || dy >= 20) continue;
      const q = ((dx * dx) >> 2) + ((dy * dy) >> 2);
      if (q >= bestQ) continue;
      bestQ = q;
      best = i;
    }
    return best;
  }
  enter(traffic) {
    const i = this.reach(traffic);
    if (i < 0) return;
    const c = traffic.cars[i], car = this.car;
    const v = (c.dir & 2 ? -c.sp * 2 : c.sp * 2) || 0; // (never -0)
    Object.assign(car, { x: c.x, y: c.y, angle: c.face << 12, vx: c.dir & 1 ? 0 : v, vy: c.dir & 1 ? v : 0, colour: c.col });
    traffic.cars[i] = new TrafficCar({ on: 0 });
    if (traffic.mine === i) traffic.mine = 0xff;
    this.on = 0;
  }
  /** Where the player would stand getting out of the car: [x, y] in pixels, or null if there is nowhere. */
  spot() {
    const car = this.car, k = direction16(car.angle);
    for (const [turn, away] of [[4, 12], [12, 12], [8, 18], [0, 18]]) { // right, left, behind, in front
      const a = (((k + turn) & 15) * Math.PI) / 8;
      const x = (car.px + Math.round(away * Math.cos(a))) & 0xffff, y = (car.py + Math.round(away * Math.sin(a))) & 0xffff;
      if (!blocked(x, y)) return [x, y];
    }
    return null;
  }
  leave(traffic) {
    const car = this.car;
    if (Math.abs(car.vx) > F.SLOW || Math.abs(car.vy) > F.SLOW) return;
    const slot = Player.place(traffic);
    if (slot < 0) return;
    const at = this.spot();
    if (!at) return;
    this.out(traffic, slot, at, 0);
  }
  /** A free place in the traffic's tables for a car the player leaves: the last one free, or -1. */
  static place(traffic) {
    for (let i = traffic.n - 1; i >= 0; i--) if (!traffic.cars[i].on) return i;
    return -1;
  }
  /**
   * foot.out_here: the player out at pixel `at`, facing as the car does, and the car in place `slot` of the
   * traffic's tables, where it is, with no driver, lying along whichever axis is nearer; `sink` 1 if it flooded.
   */
  out(traffic, slot, at, sink) {
    const car = this.car, k = direction16(car.angle);
    Object.assign(this, { on: 1, x: at[0] << 8, y: at[1] << 8, phase: 0, face: ((k + 1) >> 1) & 7 });
    traffic.cars[slot] = new TrafficCar({ x: car.x, y: car.y, dir: ((k + 2) >> 2) & 3, sp: 0, cruise: 0, face: k, col: car.colour, wreck: 1, sink });
    traffic.mine = slot;
    car.vx = car.vy = 0;
  }
  /** The pointer of the frame the player on foot is drawn with: `tick` is the traffic's, after its step. */
  pointer(tick) {
    if (this.swim) return PLAYER_SPRITE + 40 + ((tick >> 4) & 1);
    return PLAYER_SPRITE + this.face * 5 + CYCLE[(this.phase >> 8) & 7];
  }
  /** Their state as the tests compare it. In a car, where they are on foot means nothing. */
  get state() {
    if (!this.on) return { on: 0, fireWas: this.fireWas };
    return { on: 1, x: this.x, y: this.y, face: this.face, phase: this.phase, swim: this.swim, fireWas: this.fireWas };
  }
}

/** The same, read from the program. */
export async function readPlayer(vice, L) {
  if (L['foot.fire_was'] - L['foot.on'] !== 11) throw new Error('readPlayer expects on, pos, face, phase, swim and fire_was in a row');
  const b = await vice.read(L['foot.on'], 12);
  if (!b[0]) return { on: 0, fireWas: b[11] };
  return { on: b[0], x: b[1] | (b[2] << 8) | (b[3] << 16), y: b[4] | (b[5] << 8) | (b[6] << 16), face: b[7], phase: b[8] | (b[9] << 8), swim: b[10], fireWas: b[11] };
}
