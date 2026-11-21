// SPDX-License-Identifier: GPL-2.0-or-later
// A model of Big Honk (src/honk.asm), worked out again here so the tests can hold the program to it frame by
// frame. The rules are the program's: see the comments there for why they are what they are.
import { HONK_SPRITE, MAP_SIZE } from './game.mjs';
import { LOWEST } from './traffic-model.mjs';

export const H = {
  X0: 800, X1: 960, X: 808, Y: 840, WALK: 92, RUN: 225, FLAP: 60, ROAD_ODDS: 77, REACH: 9, HIT: 10,
  RUN_OVER: 154, TRAFFIC_RUN_OVER: 77, SPRITE: HONK_SPRITE, COLOUR: 1 | 0x80, // white, multicolour
};
/** Each way: 0 east, 1 south, 2 west, 3 north. */
export const WAYS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const w16 = (v) => v & 0xffff;

/** The tile row % 12 at pixel y (16 bits), 0 and 1 being a road; null outside the city. As honk.row works it out. */
export function rowMod12(y) {
  const row = ((y >> 8) << 4 | (y & 255) >> 4) & 255;
  return row >= MAP_SIZE ? null : row % 12;
}

export class Honk {
  constructor() {
    // Positions in 1/256 pixel, 24 bits, as the program keeps them.
    Object.assign(this, { x: H.X << 8, y: H.Y << 8, way: 1, wait: 1, flap: 0, jay: 0, seed: 0x5a });
  }
  get px() {
    return (this.x >> 8) & 0xffff;
  }
  get py() {
    return (this.y >> 8) & 0xffff;
  }
  /** honk.rnd: an 8-bit linear feedback shift register. */
  rnd() {
    let a = this.seed << 1;
    if (a > 255) a = (a & 255) ^ 0x1d;
    return (this.seed = a);
  }
  /** What is REACH pixels ahead the way given: null off The Moat or outside the city, else its tile row % 12. */
  ahead(way) {
    const nx = w16(this.px + WAYS[way][0] * H.REACH), ny = w16(this.py + WAYS[way][1] * H.REACH);
    if (w16(nx - H.X0) >= H.X1 - H.X0) return null;
    return rowMod12(ny);
  }
  wants(way) {
    const m = this.ahead(way);
    return m !== null && (m >= 2 || this.jay < H.ROAD_ODDS);
  }
  pick() {
    this.jay = this.rnd();
    for (;;) {
      let t = this.rnd(), chosen = null;
      for (let k = 0; k < 4 && chosen === null; k++, t++) {
        t &= 3;
        if ((t ^ 2) !== this.way && this.wants(t)) chosen = t;
      }
      if (chosen === null && this.wants(this.way ^ 2)) chosen = this.way ^ 2;
      if (chosen !== null) {
        this.way = chosen;
        break;
      }
      if (this.jay === 0) break; // nothing at all: he keeps going as he was
      this.jay = 0;
    }
    this.wait = this.rnd() | 64;
  }
  move(amount) {
    const d = this.way < 2 ? amount : -amount;
    if (this.way & 1) this.y = (this.y + d) & 0xffffff;
    else this.x = (this.x + d) & 0xffffff;
  }
  /** Within HIT of him either way: the difference plus HIT (0 to 2 * HIT), else null. */
  static within(d) {
    const v = w16(d + H.HIT);
    return v <= 2 * H.HIT ? v : null;
  }
  close(ox, oy) {
    const bx = Honk.within(ox - this.px);
    if (bx === null) return null;
    const by = Honk.within(oy - this.py);
    return by === null ? null : [bx, by];
  }
  struck([bx, by]) {
    this.flap = H.FLAP;
    const fx = Math.abs(bx - H.HIT), fy = Math.abs(by - H.HIT);
    this.way = fy > fx ? (by > H.HIT ? 3 : 1) : bx > H.HIT ? 2 : 0;
  }
  /** Has a car run into him: the player's car (car-model.mjs) going fast enough, or near a bridge the traffic? */
  hits(car, traffic) {
    if (Math.abs(car.vx) >= H.RUN_OVER || Math.abs(car.vy) >= H.RUN_OVER) {
      const b = this.close(car.px & 0xffff, car.py & 0xffff);
      if (b) return this.struck(b);
    }
    const m = rowMod12(this.py);
    if (m >= 3 && m < 11) return;
    if (!traffic) return;
    for (let i = traffic.n - 1; i >= 0; i--) {
      const c = traffic.cars[i];
      if (!c.on || c.sp < H.TRAFFIC_RUN_OVER) continue;
      const b = this.close(c.px & 0xffff, c.py & 0xffff);
      if (b) return this.struck(b);
    }
  }
  /**
   * One pass of the main loop, after the player's car, the traffic and the window `cam` have moved (the window
   * models in game.mjs). `cell` is the character the window was in before it moved: if it is in another one
   * now, the screen moves this frame, and he stands still.
   */
  step(car, traffic, cam, cell) {
    if (((cam.x >> 3) ^ cell[0]) & 31 || ((cam.y >> 3) ^ cell[1]) & 31) return;
    if (!this.flap) this.hits(car, traffic);
    if (this.flap) {
      this.flap--;
      if (this.ahead(this.way) !== null) this.move(H.RUN);
      return;
    }
    this.wait = (this.wait - 1) & 255;
    if (this.wait === 0 || !this.wants(this.way)) this.pick();
    this.move(H.WALK);
  }
  /** The sway, 0 or 1 pixel across the way he goes, and the frame he is drawn with. */
  get sway() {
    return this.flap ? 0 : ((this.way & 1 ? this.py : this.px) >> 2) & 1;
  }
  get pointer() {
    return H.SPRITE + this.way * 2 + ((this.flap >> 2) & 1);
  }
  /** What he lists for the multiplexer for the window `cam` (after the traffic): him, or nothing. */
  show(cam) {
    const t = w16(this.py - (cam.y - 10)), u = w16(this.px - (cam.x - 11));
    if (t >= LOWEST || u > 326) return [];
    const across = this.way & 1 ? this.sway : 0, down = this.way & 1 ? 0 : this.sway;
    return [{ y: t + 34 + down, x: u + 8 + across, pointer: this.pointer, colour: H.COLOUR }];
  }
  /** His state as the tests compare it. */
  get state() {
    return { x: this.x, y: this.y, way: this.way, wait: this.wait, flap: this.flap, jay: this.jay, seed: this.seed };
  }
}

/** The same, read from the program. */
export async function readHonk(vice, L) {
  if (L['honk.seed'] - L['honk.pos'] !== 10) throw new Error('readHonk expects pos, way, wait, flap, jay and seed in a row');
  const b = await vice.read(L['honk.pos'], 11);
  return { x: b[0] | (b[1] << 8) | (b[2] << 16), y: b[3] | (b[4] << 8) | (b[5] << 16), way: b[6], wait: b[7], flap: b[8], jay: b[9], seed: b[10] };
}

/** Put him somewhere, in the program and the model, with the rest of his state as given. */
export async function putHonk(vice, L, honk, fields) {
  Object.assign(honk, fields);
  await vice.write(L['honk.pos'], [honk.x & 255, (honk.x >> 8) & 255, honk.x >> 16, honk.y & 255, (honk.y >> 8) & 255, honk.y >> 16]);
  for (const f of ['way', 'wait', 'flap', 'jay', 'seed']) await vice.write(L[`honk.${f}`], [honk[f]]);
}
