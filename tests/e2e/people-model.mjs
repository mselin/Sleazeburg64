// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the passers-by (src/people.asm), worked out again here so the tests can hold the program to it
// frame by frame. The rules are the program's: see the comments there for why they are what they are.
import { MAP_PIXELS, VIEW_H, VIEW_W, assets, MAP_SIZE } from './game.mjs';
import { AXIS, direction16 } from './car-model.mjs';
import { LOWEST } from './traffic-model.mjs';

export const P = {
  CROWD: 4, REACH: 9, TREAD: 4, ARRIVE_GAP: 16, FAR: 0x180, BACK_ODDS: 205, SPRITE: 0x2000 / 64,
  RUN_OVER: 154, HIT: 9, NOSE: 8, DOWN_TIME: 200, DOWN_FRAME: 20, JAY_ODDS: 26,
  HALT: 10, TURN_AFTER: 75, PUNCH_WAIT: 18, STAB_WAIT: 14, STAB_REACH: 10, ARM_OUT: 10, PUNCH_REACH: 7, PUNCH_LIM: 7, SCARE: 60, FLEE_TURNS: 50, CAR_LONG: 13, CAR_SHORT: 8, CAR_SQUARE: 10,
  SHIRTS: [4, 8, 3, 2, 10, 9, 5, 1], // purple, orange, cyan, red, light red, brown, green, white
  // Scooter riders: light green (no passer-by's shirt), the scooter's speed, one time in seven or so.
  SCOOTER: 13, SCOOT_ODDS: 36, SCOOT_SPEED: 255, SCOOTER_SPRITE: 0x0d80 / 64,
  // Police officers on foot (police.get_out): light blue, at 47 pixels a second.
  OFFICER: 14, COP_PACE: 241,
};
export const ROADWAY = 0, WALL = 1, GRASS = 2, PAVEMENT = 4; // a tile's kind (tools/assets.mjs)
/** The gun (src/gun.asm). */
export const G = {
  BULLETS: 3, WAIT: 11, LIFE: 27, STRAIGHT: 1229, DIAGONAL: 869, HIT_PERSON: 3, HIT_CAR: 8, SCARE: 110, FLEE: 100,
  SPRITE: (0x2540 + 2 * 64) / 64, COLOUR: 7,
  FROM: [[5, 0], [4, 4], [0, 5], [-4, 4], [-5, 0], [-4, -4], [0, -5], [4, -4]],
};
G.VELOCITY = ((s, d) => [[s, 0], [d, d], [0, s], [-d, d], [-s, 0], [-d, -d], [0, -s], [d, -d]])(G.STRAIGHT, G.DIAGONAL);
const CYCLE = [2, 3, 4, 3, 2, 1, 0, 1];
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const w16 = (v) => v & 0xffff;
const kindAt = (x, y) => assets.tiles[1280 + assets.map[(y >> 4) * MAP_SIZE + (x >> 4)]];

export class Person {
  constructor(fields = {}) {
    // Positions in 1/256 pixel, 24 bits, as the program keeps them.
    // down: frames left lying, once run over; 0 walking.
    // jay: 1 when ready to cross a road.
    // A car in the way: stuck, frames left before they turn another way; stall, frames left standing; aside,
    // the way they step round it + 1.
    Object.assign(this, { on: 0, x: 0, y: 0, way: 0, spd: 0, col: 0, wait: 0, ph: 0, down: 0, jay: 0, stuck: 0, stall: 0, aside: 0, road: 0, ko: 0, flee: 0, officer: 0 }, fields);
  }
  get px() {
    return (this.x >> 8) & 0xffff;
  }
  get py() {
    return (this.y >> 8) & 0xffff;
  }
  /** A scooter rider (shirt light green). */
  get rider() {
    return this.col === P.SCOOTER;
  }
  get pointer() {
    if (this.rider) return P.SCOOTER_SPRITE + (this.down ? 4 : this.way);
    if (this.down) return P.SPRITE + P.DOWN_FRAME;
    return P.SPRITE + this.way * 5 + CYCLE[(this.ph >> 8) & 7];
  }
}

/** people.too_far: a 16-bit difference FAR or more either way (a negative one taken as -d - 1, as the program). */
function tooFar(d) {
  let hi = (d >> 8) & 255, lo = d & 255;
  if (hi & 0x80) [hi, lo] = [hi ^ 0xff, lo ^ 0xff];
  return hi >= 2 || (hi === 1 && lo >= (P.FAR & 255));
}

/** people.in_sight: a 16-bit difference from the window's corner within 12 pixels of it, across or down. */
export function inSight(d, down) {
  const v = w16(d + 12), hi = v >> 8, lo = v & 255;
  if (hi === 0) return down ? lo < VIEW_H + 24 : true;
  return hi === 1 && !down && lo < ((VIEW_W + 24) & 255);
}

export class People {
  /** `arrive` false: nobody appears by themselves (a build with SPAWN=0). */
  constructor({ arrive = true, crowd = P.CROWD } = {}) {
    this.arrive = arrive;
    this.people = Array.from({ length: crowd }, () => new Person());
    // knife: 1 when the player has one (pickups-model.mjs's, set by whoever steps the models).
    Object.assign(this, { seed: 0x5d, lull: 1, crossing: 0, half: 0, punchLeft: 0, knife: 0 });
    // The gun's bullets (ticks: frames left, 0 none; positions and speeds in 1/256 pixel), and the pickups model,
    // which keeps the ammo (set by whoever steps the models; none: no ammo).
    this.bullets = Array.from({ length: G.BULLETS }, () => ({ ticks: 0, x: 0, y: 0, vx: 0, vy: 0 }));
    this.items = null;
  }
  rnd() {
    let a = this.seed << 1;
    if (a > 255) a = (a & 255) ^ 0x1d;
    return (this.seed = a);
  }
  /** The kind of ground at pixel (x, y), or WALL off the city. */
  static kind(x, y) {
    return x >= MAP_PIXELS || y >= MAP_PIXELS ? WALL : kindAt(x, y);
  }
  static point(p, way, d) {
    return [w16(p.px + DX[way] * d), w16(p.py + DY[way] * d)];
  }
  static ahead(p, way, d) {
    return People.kind(...People.point(p, way, d));
  }
  /** Whether (x, y) is within lx across and ly down of (bx, by). */
  static inBody([x, y], bx, by, lx, ly) {
    return w16(x - bx + lx) <= 2 * lx && w16(y - by + ly) <= 2 * ly;
  }
  /**
   * people.car_in_way: the middle of a car whose body takes in the point, unless p is under that car already
   * (then they can walk out), or null. The traffic's cars (traffic-model.mjs) from the last place down, then
   * the player's car `car` while they drive it. A car that flooded is out of the way.
   */
  static carInWay(pt, p, traffic, car) {
    const bodies = [];
    for (let i = (traffic?.cars.length ?? 0) - 1; i >= 0; i--) {
      const c = traffic.cars[i];
      if (!c.on || c.sink) continue;
      bodies.push([c.px, c.py, ...(c.dir & 1 ? [P.CAR_SHORT, P.CAR_LONG] : [P.CAR_LONG, P.CAR_SHORT])]);
    }
    if (car) bodies.push([car.px, car.py, P.CAR_SQUARE, P.CAR_SQUARE]);
    for (const [bx, by, lx, ly] of bodies)
      if (People.inBody(pt, bx, by, lx, ly) && !People.inBody([p.px, p.py], bx, by, lx, ly)) return { x: bx, y: by };
    return null;
  }
  static likes(k, p) {
    return k === PAVEMENT || k === GRASS || (k === ROADWAY && p.jay === 1);
  }
  pick(p) {
    // Ready to cross a road: on one already, or one time in ten.
    p.jay = People.ahead(p, p.way, 0) === ROADWAY || this.rnd() < P.JAY_ODDS ? 1 : 0;
    let t = this.rnd(), chosen = null;
    for (let n = 0; n < 4 && chosen === null; n++, t++) {
      t &= 3;
      if ((t ^ 2) === p.way && this.rnd() < P.BACK_ODDS) continue;
      if (People.likes(People.ahead(p, t, P.REACH), p)) chosen = t;
    }
    for (let n = 0; n < 4 && chosen === null; n++, t++) {
      t &= 3;
      if (People.ahead(p, t, P.REACH) !== WALL) chosen = t;
    }
    if (chosen !== null) p.way = chosen;
    p.wait = (this.rnd() >> 1) | 16;
    p.stuck = p.stall = p.aside = 0;
  }
  static stride(p, way) {
    const d = way < 2 ? p.spd : -p.spd;
    if (way & 1) p.y = (p.y + d) & 0xffffff;
    else p.x = (p.x + d) & 0xffffff;
  }
  /** people.steps: two frames' worth, and whether that leaves them on a road. */
  static steps(p, way) {
    for (let n = p.flee ? 4 : 2; n; n--) People.stride(p, way); // running: twice as far
    p.road = People.kind(p.px, p.py) === ROADWAY ? 1 : 0;
  }
  /** A car in the way, its middle b: true if they stand (or turn another way) this frame, with no step. */
  heldUp(p, b, traffic, car) {
    if (!p.stuck) [p.stuck, p.stall] = [P.TURN_AFTER, P.HALT];
    if (--p.stuck === 0) {
      this.pick(p);
      return true;
    }
    if (p.stall) {
      p.stall--;
      return true;
    }
    // Round its nearer end: away from its middle, decided once.
    if (!p.aside) p.aside = (p.way & 1 ? (p.px >= b.x ? 0 : 2) : (p.py >= b.y ? 1 : 3)) + 1;
    const s = p.aside - 1;
    if (People.ahead(p, s, P.TREAD) === WALL || People.carInWay(People.point(p, s, P.TREAD), p, traffic, car)) {
      this.pick(p);
      return true;
    }
    People.steps(p, s);
    return false;
  }
  walk(p, at, traffic, car) {
    if (p.down) return; // lying: no more walking
    if (tooFar(w16(p.px - at[0])) || tooFar(w16(p.py - at[1]))) {
      p.on = 0;
      return;
    }
    if (p.officer && this.heat?.level) People.chaseWay(p, at);
    else if (p.flee) People.fleeWay(p, at);
    else {
      p.wait = (p.wait - 1) & 255;
      if (p.wait === 0 || !People.likes(People.ahead(p, p.way, P.REACH), p)) this.pick(p);
    }
    if (People.ahead(p, p.way, P.TREAD) !== WALL) {
      const b = People.carInWay(People.point(p, p.way, P.TREAD), p, traffic, car);
      if (!b) {
        p.stuck = p.stall = p.aside = 0;
        People.steps(p, p.way);
      } else if (this.heldUp(p, b, traffic, car)) return;
    }
    const v = (p.spd - ((p.spd >> 3) + (p.spd >> 2))) & 255;
    p.ph = (p.ph + (p.flee ? 4 : 2) * v) & 0xffff;
  }
  /**
   * people.flee_way: a turn of running away from the player at `at`, along the axis they are further from
   * them on (across if neither; the other if that way is a wall), ready to cross roads, without stopping
   * before a car.
   */
  static fleeWay(p, at, turned = 0) {
    if (!turned) p.flee--;
    p.jay = 1;
    p.stall = 0;
    const dx = w16(p.px - at[0]), dy = w16(p.py - at[1]);
    const fx = (dx & 0x8000 ? 2 : 0) ^ turned, fy = (dy & 0x8000 ? 3 : 1) ^ turned;
    const ax = dx & 0x8000 ? w16(-dx) : dx, ay = dy & 0x8000 ? w16(-dy) : dy;
    const [first, other] = ax >= ay ? [fx, fy] : [fy, fx];
    p.way = first;
    if (People.ahead(p, first, P.TREAD) === WALL && People.ahead(p, other, P.TREAD) !== WALL) p.way = other;
  }
  /** people.chase_way: a police officer's turn with heat, the same towards the player, at their own pace. */
  static chaseWay(p, at) {
    p.flee = 0;
    People.fleeWay(p, at, 2);
  }
  /** people.crime: heat for what was done to `p`, a kill (`kill`) or half of one; more for a police officer. */
  crime(p, kill) {
    this.heat?.add(p.officer ? (kill ? 2 * 28 : 2 * 14) : kill ? 2 * 6 : 2 * 3);
  }
  /**
   * people.punch, from the player `player` (foot-model.mjs) pressing fire on foot: unless the last punch was
   * under PUNCH_WAIT frames ago, the first passer-by within PUNCH_LIM of the point PUNCH_REACH ahead of them is
   * knocked down, and anyone within SCARE of them runs.
   */
  /** The same with the knife: a stab, from 10 ahead, killing, even someone knocked down already. */
  punch(player) {
    if (this.punchLeft) return;
    const knife = this.knife;
    this.punchLeft = knife ? P.STAB_WAIT : P.PUNCH_WAIT;
    player.arm = P.ARM_OUT; // the arm goes out, whether it lands or not
    const R = knife
      ? [[10, 0], [7, 7], [0, 10], [-7, 7], [-10, 0], [-7, -7], [0, -10], [7, -7]][player.face]
      : [[7, 0], [5, 5], [0, 7], [-5, 5], [-7, 0], [-5, -5], [0, -7], [5, -5]][player.face];
    const pt = [w16(player.px + R[0]), w16(player.py + R[1])];
    const near = (q, [x, y], lim) => w16(q.px - x + lim) <= 2 * lim && w16(q.py - y + lim) <= 2 * lim;
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (!p.on || (p.down && !(knife && p.ko)) || !near(p, pt, P.PUNCH_LIM)) continue;
      p.down = P.DOWN_TIME;
      p.ko = knife ? 0 : 1;
      if (knife) this.onKill?.(p); // killed: what they drop (pickups-model.mjs)
      this.crime(p, knife); // a kill, or half of one (heat-model.mjs)
      for (const q of this.people) if (q.on && !q.down && near(q, [p.px, p.py], P.SCARE)) q.flee = P.FLEE_TURNS;
      return;
    }
  }
  /**
   * gun.fire: fire on foot out of the water. With ammo left, a shot, unless the last was under WAIT frames ago:
   * a round less, a bullet from just ahead of the player the way they face, and anyone within SCARE of them
   * runs. With none, punch().
   */
  fire(player) {
    if (!this.items?.ammo) return this.punch(player);
    if (this.punchLeft) return;
    this.punchLeft = G.WAIT;
    player.arm = P.ARM_OUT;
    this.items.ammo--;
    const i = this.bullets.map((b) => b.ticks).lastIndexOf(0);
    if (i >= 0) {
      const [fx, fy] = G.FROM[player.face], [vx, vy] = G.VELOCITY[player.face];
      this.bullets[i] = { ticks: G.LIFE, x: ((w16(player.px + fx) << 8) | 0x80), y: ((w16(player.py + fy) << 8) | 0x80), vx, vy };
    }
    const near = (q, lim) => w16(q.px - player.px + lim) <= 2 * lim && w16(q.py - player.py + lim) <= 2 * lim;
    for (const q of this.people) if (q.on && !q.down && near(q, G.SCARE)) q.flee = G.FLEE;
    this.heat?.add(3); // 1.5, for a shot
  }
  /** gun.update: once a frame, after step(): each bullet flies on, and is spent on a wall, a passer-by or a car. */
  shoot(traffic) {
    const near = (x, y, px, py, lim) => w16(x - px + lim) <= 2 * lim && w16(y - py + lim) <= 2 * lim;
    for (let i = G.BULLETS - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b.ticks || --b.ticks === 0) continue;
      b.x = (b.x + b.vx) & 0xffffff;
      b.y = (b.y + b.vy) & 0xffffff;
      const x = (b.x >> 8) & 0xffff, y = (b.y >> 8) & 0xffff;
      if (People.kind(x, y) === WALL) {
        b.ticks = 0;
        continue;
      }
      const p = [...this.people.keys()].reverse().map((k) => this.people[k])
        .find((q) => q.on && (!q.down || q.ko) && near(q.px, q.py, x, y, G.HIT_PERSON));
      if (p) {
        p.down = P.DOWN_TIME;
        p.ko = 0;
        this.crime(p, true);
        this.onKill?.(p);
        b.ticks = 0;
        continue;
      }
      for (let k = (traffic?.n ?? 0) - 1; k >= 0; k--) {
        const c = traffic.cars[k];
        if (c.on && near(c.px, c.py, x, y, G.HIT_CAR)) {
          this.heat?.add(2); // 1, for hitting a car
          b.ticks = 0;
          break;
        }
      }
    }
  }
  /** gun.show: the bullets in sight of the window `cam`, for the multiplexer, after the pickups. */
  shown(cam) {
    const list = [];
    for (let i = G.BULLETS - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (!b.ticks) continue;
      const t = w16(((b.y >> 8) & 0xffff) - (cam.y - 10)), u = w16(((b.x >> 8) & 0xffff) - (cam.x - 11));
      if (t >= LOWEST || u > 326) continue;
      list.push({ y: t + 34, x: u + 8, pointer: G.SPRITE, colour: G.COLOUR });
    }
    return list;
  }
  /** people.arrive: someone new in the highest free place, if the point picked is out of sight on a pavement. */
  arriveOne(at, cam) {
    if (this.heat?.level) return; // (with heat, nobody new: the places are kept for the police)
    const i = this.people.map((p) => p.on).lastIndexOf(0);
    if (i < 0) return;
    const nx = w16(at[0] + 2 * (this.rnd() - 128)), ny = w16(at[1] + 2 * (this.rnd() - 128));
    if (inSight(w16(nx - cam.x), false) && inSight(w16(ny - cam.y), true)) return;
    if (People.kind(nx, ny) !== PAVEMENT) return;
    this.setUp(i, nx, ny);
  }
  /** people.set_up: someone new in place `i`, in the middle of the tile at (nx, ny), walking. */
  setUp(i, nx, ny) {
    let spd = 77 + (this.rnd() & 31), col = P.SHIRTS[this.rnd() & 7];
    const way = this.rnd() & 3;
    if (this.rnd() < P.SCOOT_ODDS) [col, spd] = [P.SCOOTER, P.SCOOT_SPEED];
    return (this.people[i] = new Person({ on: 1, x: ((nx & 0xfff0) | 8) << 8, y: ((ny & 0xfff0) | 8) << 8, spd, col, way, wait: 1, ph: 0, jay: 0 }));
  }
  /**
   * One pass of the main loop, after the window `cam` has moved: `quiet` if the frame neither moves the screen
   * nor works out colour memory; `at` is where the player is, in pixels; `traffic` and the player's car `car`
   * (null when they are on foot, and it is in the traffic's tables) are what can be in their way.
   */
  step(quiet, at, cam, traffic = null, car = null) {
    if (!quiet) return;
    if (this.arrive && --this.lull === 0) {
      this.lull = P.ARRIVE_GAP;
      this.arriveOne(at, cam);
    }
    // Half of them in each such frame, by turns, two frames' worth at once.
    this.half ^= 1;
    for (let i = this.people.length - 1; i >= 0; i--) if (this.people[i].on && (i & 1) === this.half) this.walk(this.people[i], at, traffic, car);
    // How many are on a road as of their last step, for the traffic (traffic-model.mjs), which looks for them only then.
    this.crossing = this.people.filter((p) => p.on && p.road).length;
  }
  /** Whether someone is in sight in the window `cam`, as show lists them. */
  static inSight(p, cam) {
    return w16(p.py - (cam.y - 10)) < LOWEST && w16(p.px - (cam.x - 11)) <= 326;
  }
  /**
   * What people.show does besides listing, every frame: those lying count down and go; anyone walking is run
   * over by the player's car `car` (car-model.mjs) if it is going fast enough and on them.
   */
  tick(cam, car) {
    if (this.punchLeft) this.punchLeft--;
    const fast = Math.abs(car.vx) >= P.RUN_OVER || Math.abs(car.vy) >= P.RUN_OVER;
    const [ax, ay] = AXIS[direction16(car.angle)];
    const points = [[car.px, car.py, P.HIT], [w16(car.px + ax), w16(car.py + ay), P.NOSE]];
    const within = (d, lim) => w16(d + lim) <= 2 * lim;
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (!p.on) continue;
      if (p.down && --p.down === 0) {
        if (!p.ko) {
          p.on = 0; // run over: gone
          continue;
        }
        [p.ko, p.flee] = [0, P.FLEE_TURNS]; // knocked down by a punch: up, and running
        continue;
      }
      if (p.down || !fast) continue; // (anyone the car can run over is in sight)
      if (points.some(([x, y, lim]) => within(p.px - x, lim) && within(p.py - y, lim))) {
        p.down = P.DOWN_TIME;
        this.crime(p, true);
        this.onKill?.(p); // run over by the player: what they drop
      }
    }
  }
  /** What they list for the multiplexer for the window `cam`, after the traffic and Big Honk (after tick). */
  show(cam) {
    const list = [];
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (!p.on || !People.inSight(p, cam)) continue;
      const t = w16(p.py - (cam.y - 10)), u = w16(p.px - (cam.x - 11));
      list.push({ y: t + 34, x: u + 8, pointer: p.pointer, colour: p.col | 0x80 });
    }
    return list;
  }
  /** Everyone's state as the tests compare it. */
  get state() {
    return {
      seed: this.seed, lull: this.lull, half: this.half, punchLeft: this.punchLeft,
      bullets: this.bullets.map((b) => (b.ticks ? { ...b } : { ticks: 0 })),
      people: this.people.map((p) => (p.on ? { on: 1, x: p.x, y: p.y, way: p.way, spd: p.spd, col: p.col, wait: p.wait, ph: p.ph, down: p.down, jay: p.jay, stuck: p.stuck, stall: p.stall, aside: p.aside, road: p.road, ko: p.ko, flee: p.flee, officer: p.officer } : { on: 0 })),
    };
  }
}

/** The same, read from the program. */
export async function readPeople(vice, L, crowd = P.CROWD) {
  const get = async (name, n = crowd) => [...(await vice.read(L[`people.${name}`], n))];
  const [on, xf, xl, xh, yf, yl, yh, way, spd, col, wait, phl, phh, down, jay, stuck, stall, aside, road, ko, flee, officer] = await Promise.all(
    ['on', 'xf', 'xl', 'xh', 'yf', 'yl', 'yh', 'way', 'spd', 'col', 'wait', 'phl', 'phh', 'down', 'jay', 'stuck', 'stall', 'aside', 'road', 'ko', 'flee', 'officer'].map((n) => get(n)));
  const [seed] = await get('seed', 1), [lull] = await get('lull', 1), [half] = await get('half', 1), [punchLeft] = await get('punch_left', 1);
  const gun = async (name) => [...(await vice.read(L[`gun.${name}`], G.BULLETS))];
  const [ticks, bxf, bxl, bxh, byf, byl, byh, vxl, vxh, vyl, vyh] = await Promise.all(['ticks', 'xf', 'xl', 'xh', 'yf', 'yl', 'yh', 'vxl', 'vxh', 'vyl', 'vyh'].map(gun));
  const s16 = (lo, hi) => ((lo | (hi << 8)) << 16) >> 16;
  return {
    seed, lull, half, punchLeft,
    bullets: ticks.map((t, i) => (t ? { ticks: t, x: bxf[i] | (bxl[i] << 8) | (bxh[i] << 16), y: byf[i] | (byl[i] << 8) | (byh[i] << 16), vx: s16(vxl[i], vxh[i]), vy: s16(vyl[i], vyh[i]) } : { ticks: 0 })),
    people: on.map((o, i) => (o ? {
      on: 1, x: xf[i] | (xl[i] << 8) | (xh[i] << 16), y: yf[i] | (yl[i] << 8) | (yh[i] << 16), way: way[i], spd: spd[i], col: col[i], wait: wait[i], ph: phl[i] | (phh[i] << 8), down: down[i], jay: jay[i], stuck: stuck[i], stall: stall[i], aside: aside[i], road: road[i], ko: ko[i], flee: flee[i], officer: officer[i],
    } : { on: 0 })),
  };
}

/** Put someone into place `i`, in the program and the model: { x, y } in pixels, the rest as given or new. */
export async function putPerson(vice, L, people, i, { x, y, way = 0, spd = 90, col = 2, wait = 100, ph = 0, jay = 0, officer = 0 }) {
  const p = new Person({ on: 1, x: x << 8, y: y << 8, way, spd, col, wait, ph, jay, officer });
  people.people[i] = p;
  for (const [name, value] of Object.entries({ on: 1, xf: 0, xl: x & 255, xh: x >> 8, yf: 0, yl: y & 255, yh: y >> 8, way, spd, col, wait, phl: ph & 255, phh: ph >> 8, down: 0, jay, stuck: 0, stall: 0, aside: 0, road: 0, ko: 0, flee: 0, officer }))
    await vice.write(L[`people.${name}`] + i, [value]);
  return p;
}
