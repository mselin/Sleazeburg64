// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the traffic (src/traffic.asm) and of how the sprite multiplexer (src/sprites.asm) shows it,
// worked out again here so the tests can hold the program to it frame by frame. The rules are the
// program's: see the comments there for why they are what they are.
import { CAR_SPRITE, MAP_PIXELS } from './game.mjs';

export const T = {
  ACCEL: 4, BRAKE: 11, CRUISE_MIN: 120, SLOW: 8, HELD: 175, GHOST: 80, AHEAD_MIN: 4, AHEAD_MAX: 36, SIDE: 8,
  FAR_X: 400, FAR_Y: 320, NEAR: 37, SPAWN_GAP: 16, SHOWN_X: 182, SHOWN_Y: 110,
};
const LANES = [24, 8, 8, 24];
const KOFF = [-1, 0, 1, 0];
const COLOURS = [4, 5, 8, 10, 13, 14, 3, 7]; // purple, green, orange, light red, light green, light blue, cyan, yellow
const div12 = (t) => Math.floor(t / 12);
const road = (k) => k * 192;
const w16 = (v) => v & 0xffff;
/** The lowest a car's sprite can be listed (traffic.LOWEST): all of it above the black band under the city. */
export const LOWEST = 160;

/** The 16-bit xorshift (7, 9, 8) of traffic.rnd, step by step as the 6502 does it. */
export class Rnd {
  constructor(lo = 0xa5, hi = 0x3c) {
    this.lo = lo;
    this.hi = hi;
  }
  next() {
    let c = this.hi & 1; // lda seed + 1 : lsr
    let a = this.lo; //     lda seed
    let c2 = a & 1;
    a = (a >> 1) | (c << 7); // ror
    c = c2;
    a ^= this.hi; //        eor seed + 1
    this.hi = a; //         sta seed + 1
    c2 = a & 1;
    a = (a >> 1) | (c << 7); // ror
    a ^= this.lo; //        eor seed
    this.lo = a; //         sta seed
    a ^= this.hi; //        eor seed + 1
    this.hi = a; //         sta seed + 1
    return a;
  }
}

/** One traffic car. Positions are in 1/256 pixel along both axes; only the axis it moves on has a fraction. */
export class TrafficCar {
  constructor(fields) {
    Object.assign(this, { on: 1, x: 0, y: 0, dir: 0, sp: 0, cruise: 0, face: 0, col: 0, turn: 0xff, ta: 0, held: 0, ghost: 0, blocked: 0, entered: 0 }, fields);
  }
  get px() {
    return this.x >> 8;
  }
  get py() {
    return this.y >> 8;
  }
}

export class Traffic {
  constructor({ cars = 6, spawn = true } = {}) {
    this.n = cars;
    this.spawn = spawn;
    this.cars = Array.from({ length: cars }, () => new TrafficCar({ on: 0 }));
    this.rnd = new Rnd();
    this.tick = 0;
    this.turns = 0;
    this.rot = 0;
    this.spawnWait = 0;
  }

  /**
   * One frame, after the player's car (at pixel px, py) and the window (cam) have moved. busy: this frame
   * works out colour memory, so only the moving is done.
   */
  step(px, py, cam, busy) {
    this.tick = (this.tick + 1) & 255;
    this.player = { px, py };
    for (const c of this.cars) if (c.on) this.move(c);
    if (busy) return;
    this.turns = (this.turns + 1) & 255;
    this.cars.forEach((c, i) => {
      if (!c.on) return;
      if (c.entered) {
        c.entered = 0;
        this.enter(c);
      }
      if (((i + this.turns) & 3) === 0) {
        if (!c.ghost) this.look(c);
        this.farAway(c);
      }
    });
    if (!this.spawn) return;
    if (this.spawnWait) {
      this.spawnWait--;
      return;
    }
    if ((this.turns & 3) === 2) this.trySpawn(cam);
  }

  move(c) {
    if (c.ghost) c.ghost--;
    let want = null;
    if (c.blocked && !c.ghost) want = 0;
    else if (c.sp !== c.cruise) want = c.cruise;
    if (want !== null) {
      if (c.sp < want) {
        const n = c.sp + T.ACCEL;
        c.sp = n > 255 || n >= want ? want : n;
      } else if (c.sp > want) {
        const n = c.sp - T.BRAKE;
        c.sp = n < 0 || n < want ? want : n;
      }
      if (c.sp < T.SLOW) {
        c.held = (c.held + 1) & 255;
        if (c.held >= T.HELD) {
          c.ghost = T.GHOST;
          c.held = 0;
        }
      } else c.held = 0;
    }
    const axis = c.dir & 1 ? 'y' : 'x';
    const back = c.dir & 2;
    const old = (c[axis] >> 8) & 255;
    c[axis] = (c[axis] + (back ? -1 : 1) * c.sp * 2) & 0xffffff;
    const pixel = c[axis] >> 8;
    if (c.turn !== 0xff) {
      if (back ? c.ta >= pixel : pixel >= c.ta) {
        c[axis] = c.ta << 8;
        c.dir = c.turn;
        c.turn = 0xff;
      }
    } else if (((pixel & 255) ^ old) & 0xf0) c.entered = 1;
    if (!(this.tick & 1)) {
      const diff = (c.dir * 4 - c.face) & 15;
      if (diff) c.face = (diff < 8 ? c.face + 1 : c.face - 1) & 15;
    }
  }

  /** Every car the program looks at: the traffic cars that are on, then the player's car. */
  others(c) {
    const list = this.cars.filter((o) => o.on && o !== c).map((o) => ({ px: o.px, py: o.py }));
    list.push(this.player);
    return list;
  }

  look(c) {
    const along = c.dir & 1 ? 'py' : 'px', across = c.dir & 1 ? 'px' : 'py', back = c.dir & 2;
    c.blocked = 0;
    for (const o of this.others(c)) {
      const f = w16(back ? c[along] - o[along] : o[along] - c[along]);
      if (f < T.AHEAD_MIN || f > T.AHEAD_MAX) continue;
      if (w16(o[across] - c[across] + T.SIDE) > 2 * T.SIDE) continue;
      c.blocked = 1;
      return;
    }
  }

  farAway(c) {
    const { px, py } = this.player;
    if (w16(c.px - px + T.FAR_X) > 2 * T.FAR_X || w16(c.py - py + T.FAR_Y) > 2 * T.FAR_Y) c.on = 0;
  }

  enter(c) {
    const vertical = c.dir & 1, back = c.dir & 2;
    const tile = (vertical ? c.py : c.px) >> 4;
    if (tile % 12 !== (back ? 1 : 0)) return;
    const ka = div12(tile), kc = div12((vertical ? c.px : c.py) >> 4);
    const ix = vertical ? kc : ka, iy = vertical ? ka : kc;
    const ways = [];
    for (let d = 0; d < 4; d++) {
      if (d === (c.dir ^ 2)) continue;
      const k = d & 1 ? iy : ix;
      if (d < 2 ? k >= 8 : k === 0) continue;
      ways.push(d);
    }
    if (ways.includes(c.dir) && this.rnd.next() < 128) return; // straight on
    const nd = ways[(this.rnd.next() * ways.length) >> 8];
    if (nd === c.dir) return;
    c.turn = nd;
    c.ta = road(ka) + LANES[nd];
  }

  trySpawn(cam) {
    let slot = -1;
    for (let i = this.n - 1; i >= 0; i--)
      if (!this.cars[i].on) {
        slot = i;
        break;
      }
    if (slot < 0) return;
    const r1 = this.rnd.next();
    const dir = r1 & 3, vertical = dir & 1;
    const { px, py } = this.player;
    let k = div12(((vertical ? px : py) + 80) >> 4) + KOFF[(r1 >> 2) & 3];
    k = Math.max(0, Math.min(8, k));
    const across = road(k) + LANES[dir];
    const r2 = this.rnd.next();
    const along = w16((vertical ? py : px) + ((r2 << 24) >> 24) * 3);
    const nx = vertical ? across : along, ny = vertical ? along : across;
    if (w16(along - 40) > MAP_PIXELS - 80) return; // inside the city
    if (((((along >> 4) & 255) % 12) - 3 & 255) >= 8) return; // not near a crossing
    if (w16(nx - cam.x + T.SHOWN_X - 1 - 152) < 2 * T.SHOWN_X - 1 && w16(ny - cam.y + T.SHOWN_Y - 1 - 80) < 2 * T.SHOWN_Y - 1) return;
    for (const o of [...this.cars.filter((c) => c.on), this.player]) {
      if (w16(o.px - nx + T.NEAR) <= 2 * T.NEAR && w16(o.py - ny + T.NEAR) <= 2 * T.NEAR) return; // too near
    }
    const r3 = this.rnd.next();
    const cruise = T.CRUISE_MIN + (r3 & 63);
    this.cars[slot] = new TrafficCar({ x: nx << 8, y: ny << 8, dir, sp: cruise, cruise, face: dir * 4, col: COLOURS[(r1 >> 4) & 7] });
    this.spawnWait = T.SPAWN_GAP;
  }

  /** The sprites listed for the next frame, in the order the program lists them, and the next one to start from. */
  show(cam) {
    const list = [];
    for (let k = 0; k < this.n; k++) {
      const c = this.cars[(this.rot + k) % this.n];
      if (!c.on) continue;
      const t = w16(c.py - (cam.y - 10)), u = w16(c.px - (cam.x - 11));
      if (t > LOWEST || u > 326) continue;
      list.push({ y: t + 34, x: u + 8, pointer: CAR_SPRITE + c.face, colour: c.col });
    }
    this.rot = (this.rot + 1) % this.n;
    return list;
  }
}

export const MUX = { FREE: 22, LATE: 2, LAST_WRITE: 210 };

/**
 * What the multiplexer makes of a list (sprites.plan): sorted by y, keeping the listed order among equals,
 * the first seven on sprites 1-7, and each later one on the sprite of the one seven before it if its writes
 * can be done in time; the rest left out. Returns the ones shown, each with its hardware sprite.
 */
export function plan(list) {
  const order = list.map((s, i) => ({ ...s, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const kept = [];
  let w = 0;
  for (const s of order) {
    const k = kept.length;
    if (k < 7) {
      kept.push({ ...s, hw: k + 1 });
      continue;
    }
    const free = kept[k - 7].y + MUX.FREE;
    const done = Math.max(free, w) + MUX.LATE;
    if (done > MUX.LAST_WRITE || done >= s.y) continue;
    w = done;
    kept.push({ ...s, hw: kept[k - 7].hw });
  }
  return kept;
}
