// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the player on foot and of getting in and out of cars (src/foot.asm), worked out again here so
// the tests can hold the program to it frame by frame. The rules are the program's: see the comments there
// for why they are what they are.
import { MAP_PIXELS, MAP_SIZE, PUNCH_SPRITE, assets, spriteData } from './game.mjs';
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
    // arm: frames left with the arm out after a punch (people-model.mjs sets it).
    Object.assign(this, { car, on: 0, x: 0, y: 0, face: 0, phase: 0, swim: 0, fireWas: 1, arm: 0 });
    // The picture (frames.asm): the frames the two buffers hold (-1: none), the one shown from last, and the 63
    // bytes drawn this pass (null in the car).
    Object.assign(this, { held: [-1, -1], shown: 0, drawn: null });
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
    if (this.arm) this.arm--;
    const fire = bits & 16 ? 1 : 0;
    const press = fire && !this.fireWas; // just pressed
    const use = press && !(bits & 15); // with the stick centred
    this.fireWas = fire;
    if (this.on) {
      this.walk(bits);
      if (use) this.enter(traffic);
      // Else fire is a punch (people-model.mjs): no ammo, no knife, and nobody fights in the water.
      if (this.on && press && !this.swim) people?.fire(this);
    } else {
      // Out first if they can be, the car left where it is; else its frame.
      if (use) this.leave(traffic);
      if (!this.on) this.car.step(bits, traffic, busy);
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
    traffic.stolen = c.cop ? 1 : 0; // a police car: a stolen one (police.cruiser)
    if (c.cruise) this.heat?.add(c.cop ? 2 * 16 : 2 * 4); // taken from its driver (heat-model.mjs)
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
    // (A police car the player drove is one still, empty; and getting out ends its being stolen.)
    traffic.cars[slot] = new TrafficCar({ x: car.x, y: car.y, dir: ((k + 2) >> 2) & 3, sp: 0, cruise: 0, face: k, col: car.colour, wreck: 1, sink, cop: traffic.stolen ?? 0 });
    traffic.stolen = 0;
    traffic.mine = slot;
    car.vx = car.vy = 0;
  }
  /** Which of the 42 frames (tools/assets.mjs) the player on foot is drawn with, or -1 punching: `tick` is the traffic's, after its step. */
  frame(tick) {
    if (this.swim) return 40 + ((tick >> 4) & 1);
    if (this.arm) return -1;
    return this.face * 5 + CYCLE[(this.phase >> 8) & 7];
  }
  /** The picture they should be drawn with: its 63 bytes. */
  bitmap(tick) {
    const f = this.frame(tick);
    return f < 0 ? spriteData(PUNCH_SPRITE + this.face) : assets.player.subarray(f * 64, f * 64 + 63);
  }
  /**
   * foot.show, as frames.point picks the picture (`quiet`: a pass with no colour memory to work out and the
   * screen not moving a character). A frame flipped from one of the twelve is made into a buffer, which takes
   * time, so only in a quiet pass; in another the picture stays as it was, or after the car is the frame it is
   * made from, as it is.
   */
  draw(tick, quiet) {
    const f = this.frame(tick), before = this.drawn;
    this.drawn = this.bitmap(tick);
    if (f < 0 || !(assets.playerMade[f] & 3)) return;
    let b = this.held.indexOf(f);
    if (b < 0) {
      if (!quiet) {
        if (!before) this.drawn = Player.stored(assets.playerMade[f] >> 2);
        else this.drawn = before;
        return;
      }
      b = this.shown ^ 1;
      this.held[b] = f;
    }
    this.shown = b;
  }
  /** One of the twelve frames the program file holds. */
  static stored(n) {
    const f = [...assets.playerMade].indexOf(n * 4);
    return assets.player.subarray(f * 64, f * 64 + 63);
  }
  /** Their state as the tests compare it. In a car, where they are on foot means nothing. */
  get state() {
    if (!this.on) return { on: 0, fireWas: this.fireWas };
    return { on: 1, x: this.x, y: this.y, face: this.face, phase: this.phase, swim: this.swim, fireWas: this.fireWas, arm: this.arm };
  }
}

/** The same, read from the program. */
export async function readPlayer(vice, L) {
  if (L['foot.fire_was'] - L['foot.on'] !== 11) throw new Error('readPlayer expects on, pos, face, phase, swim and fire_was in a row');
  const b = await vice.read(L['foot.on'], 12);
  if (!b[0]) return { on: 0, fireWas: b[11] };
  const [arm] = await vice.read(L['foot.arm'], 1);
  return { on: b[0], x: b[1] | (b[2] << 8) | (b[3] << 16), y: b[4] | (b[5] << 8) | (b[6] << 16), face: b[7], phase: b[8] | (b[9] << 8), swim: b[10], fireWas: b[11], arm };
}
