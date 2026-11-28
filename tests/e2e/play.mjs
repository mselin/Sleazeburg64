// SPDX-License-Identifier: GPL-2.0-or-later
// For the tests of the whole game: the models of everything that moves, stepped together as the program's main
// loop does, and what the tests need to read the same things from the program and to put things where they
// want them.
import assert from 'node:assert/strict';
import { Car, direction16 } from './car-model.mjs';
import { CENTRE_X, CENTRE_Y, Camera, MAX_X, MAX_Y, assets, camera, pictureMismatches, planned, spriteData } from './game.mjs';
import { Traffic, TrafficCar, plan } from './traffic-model.mjs';
import { Honk, readHonk } from './honk-model.mjs';
import { F, Player, readPlayer } from './foot-model.mjs';
import { waterStep } from './water-model.mjs';
import { G, P, People, inSight, readPeople, WALL } from './people-model.mjs';
import { Pickups, readPickups } from './pickups-model.mjs';
import { H, Heat, readHeat } from './heat-model.mjs';

export const START = [9 * 16, 8 * 16]; // the window's top left corner at start; the car is in its middle
/** Busted (police.boxed_in, police.busted): slower than SLOW, a police car within BOXED, for AFTER frames. */
export const BUSTED = { DOWN: 160, SLOW: 61, BOXED: 24, AFTER: 100, STATION: [(6 * 12 + 7) * 16, (2 * 12 + 2) * 16 + 8] };
/** The siren's sound (police.wailing): a wail every WAIL frames, two notes of NOTE frames; `tone` 1 low, 2 high. */
export const SIREN = { WAIL: 35, NOTE: 17 };
/** The paint shop (police.paint_look): where, how near, frames between. */
export const PAINT = { AT: [(1 * 12 + 7) * 16, (6 * 12 + 2) * 16 + 8], NEAR: 16, AGAIN: 200 };
const TRAFFIC_COLOURS = [4, 5, 8, 10, 13, 14, 3, 7]; // (traffic.colours)
/** The police and the pavement (police.pave_look): a tile's kind, the speed (1/256 pixel a frame), frames between. */
export const PAVE = { KIND: 4, FAST: 77, AGAIN: 150 };
/** Hurt, and wasted (police.hits, police.wasted). */
export const HURT = { FAST: 115, LONG: 12, SHORT: 7, WAIT: 20, HOSPITAL: [(1 * 12 + 7) * 16, (1 * 12 + 2) * 16 + 8] };
/** Officers on foot (police.get_out, police.on_foot). */
export const OFFICERS = {
  NEAR: 36, CAR_STILL: 77, STILL: 154, MOST: 4, BESIDE: 12, NOTICE: 120, ARREST: 7, WINDOW: 13, WINDOW_SLOW: 113, WINDOW_AFTER: 35,
  SHOOT_HEAT: 3, SHOOT_RANGE: 95, AIM_MIN: 55, SHOT_HURT: 11, // (police.may_shoot, shoot_io, cop_bullet)
};
const TRAFFIC_FIELDS = ['dir', 'sp', 'cruise', 'face', 'col', 'turn', 'held', 'ghost', 'blocked', 'entered', 'wreck', 'sink'];

/** Read the program's traffic: every car, and the counters and random seed that decide what comes next. */
export async function readTraffic(vice, L, n) {
  const n1 = n + 1;
  const get = (name, length) => vice.read(L[`traffic.${name}`], length);
  const [on, pf, pl, ph] = await Promise.all([get('on', n), get('pf', 2 * n1), get('pl', 2 * n1), get('ph', 2 * n1)]);
  const fields = {};
  for (const f of [...TRAFFIC_FIELDS, 'tal', 'tah']) fields[f] = await get(f, n);
  const cars = [];
  for (let i = 0; i < n; i++) {
    if (!on[i]) {
      cars.push({ on: 0 });
      continue;
    }
    const car = { on: 1, x: (ph[i] << 16) | (pl[i] << 8) | pf[i], y: (ph[n1 + i] << 16) | (pl[n1 + i] << 8) | pf[n1 + i] };
    for (const f of TRAFFIC_FIELDS) car[f] = fields[f][i];
    car.ta = car.turn === 0xff ? null : fields.tal[i] | (fields.tah[i] << 8);
    cars.push(car);
  }
  const seed = await get('seed', 2);
  const [tick, rot, wait, turns, mine] = await Promise.all([get('tick', 1), get('rot', 1), get('spawn_wait', 1), get('turns', 1), get('mine', 1)]);
  const cop = await vice.read(L['police.cop'], n), [chaseWait] = await vice.read(L['police.chase_wait'], 1), [around] = await vice.read(L['police.around'], 1);
  const [wail] = await vice.read(L['police.wail'], 1), [tone] = await vice.read(L['police.tone'], 1), [stolen] = await vice.read(L['police.stolen'], 1);
  const patrol = await vice.read(L['police.patrol'], n), [patrolNear] = await vice.read(L['police.patrol_near'], 1);
  cars.forEach((c, i) => c.on && Object.assign(c, { cop: cop[i], patrol: patrol[i] }));
  return { cars, seed: [seed[0], seed[1]], tick: tick[0], turns: turns[0], rot: rot[0], spawnWait: wait[0], mine: mine[0], chaseWait, around, wail, tone, stolen, patrolNear };
}

/** The same, from the model. */
export function modelTraffic(t) {
  const cars = t.cars.map((c) => {
    if (!c.on) return { on: 0 };
    const car = { on: 1, x: c.x, y: c.y };
    for (const f of TRAFFIC_FIELDS) car[f] = c[f];
    car.ta = c.turn === 0xff ? null : c.ta;
    car.cop = c.cop;
    car.patrol = c.patrol;
    return car;
  });
  return { cars, seed: [t.rnd.lo, t.rnd.hi], tick: t.tick, turns: t.turns, rot: t.rot, spawnWait: t.spawnWait, mine: t.mine, chaseWait: t.chaseWait, around: t.around, wail: t.wail, tone: t.tone, stolen: t.stolen, patrolNear: t.patrolNear };
}

const signed = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
/** The player's car in the program: where it is, how it moves, the way it faces, and its colour. */
export async function readCar(vice, L) {
  if (L['car.colour'] - L['car.pos_x'] !== 13) throw new Error('readCar expects pos, vel, angle, inside and colour in a row');
  const b = await vice.read(L['car.pos_x'], 14);
  return {
    x: b[0] | (b[1] << 8) | (b[2] << 16), y: b[3] | (b[4] << 8) | (b[5] << 16),
    vx: signed(b[6], b[7]), vy: signed(b[8], b[9]), angle: b[10] | (b[11] << 8), colour: b[13],
    wet: (await vice.read(L['water.wet'], 1))[0],
  };
}
export const carState = (c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, angle: c.angle, colour: c.colour, wet: c.wet });

/**
 * The models of everything that moves, starting as the program does. `honk` false leaves Big Honk out (a
 * build with HONK=0); `traffic` are the traffic model's options; nobody walks by in a build with SPAWN=0;
 * `pickups` false leaves the pickups out (a build with ITEMS=0).
 */
export class World {
  constructor({ honk = true, traffic = {}, pickups = true } = {}) {
    this.people = new People({ arrive: traffic.spawn !== false });
    this.car = new Car(START[0] + CENTRE_X, START[1] + CENTRE_Y);
    this.player = new Player(this.car);
    this.cam = new Camera(...START);
    this.traffic = new Traffic(traffic);
    this.traffic.people = this.people; // (which traffic stops for)
    this.honk = honk ? new Honk() : null;
    this.pickups = pickups ? new Pickups(this.cam) : null;
    if (this.pickups) this.people.onKill = (p) => p.rider || this.pickups.drop(p.px, p.py); // (a rider: nothing)
    this.people.items = this.pickups; // (the ammo, for the gun)
    this.people.playerAt = () => this.at; // (officers' bullets hit the player)
    this.people.onShot = () => this.harm(OFFICERS.SHOT_HURT, true);
    // Heat, which the crimes in the models add to (heat-model.mjs).
    this.heat = this.people.heat = this.player.heat = this.traffic.heat = new Heat();
    if (this.pickups) this.pickups.heat = this.heat;
    this.list = [];
    this.boxed = 0; // frames boxed in by the police
    this.window = 0; // frames with an officer at the window
    this.hp = 100; // (status.hp: only hits and wasted change it here)
    this.aim = [0, 0, 0, 0]; // (police.aim: an officer's frames before they can shoot again)
    this.hitWait = 0;
    this.paveWait = 0; // (police.pave_wait)
    this.paintWait = 0; // (police.paint_wait)
    this.paused = 0; // (police.paused: frames of the pause, busted or wasted)
    this.downKind = null;
    this.money = 0; // (only for busted's fine: the tests that use it put it in)
  }
  /** One pass of the main loop with the joystick held as given. */
  step(bits) {
    if (this.paused && --this.paused) return; // (busted or wasted: the pause, everything still)
    if (this.downKind && !this.paused) {
      this.back();
      this.downKind = null;
    }
    const cell = [...this.cam.cell]; // the character the window is in before it moves
    const busy = this.cam.busy; // this pass works out colour memory if the last one swapped the screens
    this.people.knife = this.pickups?.knife ?? 0;
    this.player.step(bits, this.traffic, busy, this.people);
    if (this.player.on) this.hits();
    this.cam.follow(this.player.px, this.player.py);
    this.traffic.step(this.player.px, this.player.py, this.cam, busy);
    this.policeWatch();
    waterStep(this, cell);
    if (this.honk) this.honk.step(this.car, this.traffic, this.cam, cell);
    this.heat.tick(this.traffic.around); // (status.update)
    const moves = ((this.cam.x >> 3) ^ cell[0]) & 31 || ((this.cam.y >> 3) ^ cell[1]) & 31;
    this.people.step(!moves && !busy, [this.player.px, this.player.py], this.cam, this.traffic, this.player.on ? null : this.car);
    this.people.shoot(this.traffic);
    const level = this.heat.level;
    // (Shot dead, the window has jumped since: pickups.update looks at it afresh.)
    const movesNow = ((this.cam.x >> 3) ^ cell[0]) & 31 || ((this.cam.y >> 3) ^ cell[1]) & 31;
    this.pickups?.step(this.cam, !movesNow && !busy, [this.player.px, this.player.py], this.player.on);
    if (this.player.on) this.player.draw(this.traffic.tick, !moves && !busy);
    else this.player.drawn = null;
    this.people.tick(this.cam, this.car);
    this.list = [...this.traffic.show(this.cam), ...(this.honk ? this.honk.show(this.cam) : []), ...this.people.show(this.cam),
      ...(this.pickups ? this.pickups.show(this.cam, [this.player.px, this.player.py], busy) : []), ...this.people.shown(this.cam)].slice(0, 16); // the multiplexer lists sixteen
    if (level && !this.heat.level) this.quiet(); // (a donut: police.quiet)
  }
  /**
   * police.watch, after the traffic has moved: with heat, an officer gets out of each police car that may; the
   * wait for the next police car and whether one is near; the officers on foot; and boxed in.
   */
  policeWatch() {
    const t = this.traffic;
    if (!this.heat.level) {
      t.watch();
      // (But for a patrol car that sees a stolen police car, or driving on the pavement: car.ground is the last
      // the car was on.)
      if (t.stolen || this.car.ground === PAVE.KIND) {
        t.patrols();
        this.cruiser();
        this.paveLook();
      }
      return;
    }
    t.patrols();
    for (let k = t.n - 1; k >= 0; k--) {
      const c = t.cars[k];
      if (c.on && c.cop && !c.wreck) this.getOut(c);
    }
    t.watch();
    if (!this.onFoot() && this.heat.level) { // (unless busted)
      this.boxedIn();
      this.cruiser();
      this.paveLook();
      this.paintLook();
    }
    // The siren's sound (police.wailing): the low note, the high, a frame of nothing; with the siren off, quiet.
    if (this.heat.level && t.around) {
      t.wail = (t.wail + 1) % SIREN.WAIL;
      t.tone = t.wail >= 2 * SIREN.NOTE ? 0 : t.wail >= SIREN.NOTE ? 2 : 1;
    } else this.quiet();
  }
  /** police.quiet: no siren, and the counts to an arrest start again. */
  quiet() {
    this.traffic.wail = this.traffic.tone = 0;
    this.boxed = this.window = 0;
  }
  /**
   * police.pave_look: driving faster than PAVE.FAST either way on a pavement or plaza, the police around or a
   * patrol car near, is 4 heat (pave_io), no sooner than PAVE.AGAIN frames after the last; a line of the police's
   * (from the passers-by's random numbers) unless the heat goes up a level.
   */
  paveLook() {
    if (this.paveWait) return void this.paveWait--;
    const { car, player, traffic: t } = this;
    if (player.on || car.ground !== PAVE.KIND || !(t.around || t.patrolNear)) return;
    if (Math.abs(car.vx) < PAVE.FAST && Math.abs(car.vy) < PAVE.FAST) return;
    this.paveWait = PAVE.AGAIN;
    const level = this.heat.level;
    this.heat.add(2 * 4);
    if (this.heat.level === level) this.people.rnd();
  }
  /**
   * police.paint_look and paint_io, with heat: at the wheel within PAINT.NEAR of the paint shop, no sooner than
   * PAINT.AGAIN frames after the last time: with $200, $200 less, no heat, and a new colour (from the passers-by's
   * random numbers: not the one it has) unless it is a police car; else only the line that says so.
   */
  paintLook() {
    if (this.paintWait) return void this.paintWait--;
    const [x, y] = this.at, near = World.near;
    if (this.player.on || !near(x - PAINT.AT[0], PAINT.NEAR) || !near(y - PAINT.AT[1], PAINT.NEAR)) return;
    this.paintWait = PAINT.AGAIN;
    if (this.money < 200) return;
    this.money -= 200;
    Object.assign(this.heat, { level: 0, points: 0 });
    if (this.traffic.stolen) return;
    let i = this.people.rnd() & 7;
    if (TRAFFIC_COLOURS[i] === this.car.colour) i = (i + 1) & 7;
    this.car.colour = TRAFFIC_COLOURS[i];
  }
  /** police.cruiser: a stolen police car, the police around or a patrol car near, heat below 2: level 2's start. */
  cruiser() {
    const t = this.traffic;
    if (t.stolen && (t.around || t.patrolNear) && this.heat.level < 2) this.heat.add(H.LEVELS[2] - this.heat.points);
  }
  /** C clear in the program: |d| (16 bits) no more than `lim`. */
  static near(d, lim) {
    return ((d + lim) & 0xffff) <= 2 * lim;
  }
  /** Where the program has the player: their middle, in the car or on foot. */
  get at() {
    return [this.player.px, this.player.py];
  }
  /** police.get_out: police car `c` slow, and near the player, also slow: an officer gets out beside it. */
  getOut(c) {
    const { car, player, people } = this, O = OFFICERS, near = World.near;
    if (c.sp >= O.CAR_STILL) return;
    if (!player.on && !(Math.abs(car.vx) < O.STILL && Math.abs(car.vy) < O.STILL)) return;
    const [x, y] = this.at;
    if (!near(c.px - x, O.NEAR) || !near(c.py - y, O.NEAR)) return;
    const all = people.people;
    let i = -1;
    for (let k = all.length - 1; k >= 0 && i < 0; k--) if (!all[k].on) i = k;
    if (i < 0) {
      if (all.filter((p) => p.officer).length >= O.MOST) return;
      for (let k = all.length - 1; k >= 0 && i < 0; k--) {
        const p = all[k];
        if (!p.officer && !p.down && !(inSight((p.px - this.cam.x) & 0xffff, false) && inSight((p.py - this.cam.y) & 0xffff, true))) i = k;
      }
      if (i < 0) return;
    }
    const at = [c.px, c.py], a = c.dir & 1 ? 0 : 1; // across its way
    at[a] = (at[a] + O.BESIDE) & 0xffff;
    if (People.kind(...at) === WALL) {
      at[a] = (at[a] - 2 * O.BESIDE) & 0xffff;
      if (People.kind(...at) === WALL) return;
    }
    Object.assign(people.setUp(i, ...at), { col: P.OFFICER, spd: P.COP_PACE, officer: 1 });
    this.aim[i] = 0; // (ready to shoot)
    Object.assign(c, { wreck: 1, sp: 0, cruise: 0 });
  }
  /** police.on_foot: the officers on foot who are not down: near, and arresting. True if the player is busted. */
  onFoot() {
    const { car, player } = this, O = OFFICERS, near = World.near, [x, y] = this.at;
    const slow = !player.on && Math.abs(car.vx) < O.WINDOW_SLOW && Math.abs(car.vy) < O.WINDOW_SLOW;
    let windowed = false;
    for (let k = this.people.people.length - 1; k >= 0; k--) {
      const p = this.people.people[k], by = (lim) => near(p.px - x, lim) && near(p.py - y, lim);
      if (!p.on || !p.officer || p.down) continue;
      if (this.aim[k]) this.aim[k]--;
      if (!by(O.NOTICE)) continue;
      this.traffic.around = 1;
      if (this.heat.level >= O.SHOOT_HEAT && !this.aim[k] && by(O.SHOOT_RANGE)) this.shootAt(k);
      if (player.on) {
        if (by(O.ARREST)) return this.busted(), true;
      } else if (slow && by(O.WINDOW)) windowed = true;
    }
    if (!windowed) this.window = 0;
    else if (++this.window >= O.WINDOW_AFTER) return this.busted(), true;
    return false;
  }
  /**
   * police.shoot_io: officer `k` shoots, unless in the water: a bullet of theirs (own) from their middle, the one
   * of eight ways nearest the player's, at the gun's speed; the next shot in AIM_MIN to AIM_MIN + 31 frames. With
   * all the gun's bullets flying, nothing.
   */
  shootAt(k) {
    const p = this.people.people[k], ppl = this.people;
    if (People.kind(p.px, p.py) === 3) return; // (water)
    const i = ppl.bullets.map((b) => b.ticks).lastIndexOf(0);
    if (i < 0) return;
    const [x, y] = this.at, dx = ((x - p.px) << 16) >> 16, dy = ((y - p.py) << 16) >> 16;
    const ax = Math.abs(dx) & 0xff, ay = Math.abs(dy) & 0xff;
    let way;
    if (2 * ay < 256 && 2 * ay < ax) way = dx < 0 ? 4 : 0;
    else if (2 * ax < 256 && 2 * ax < ay) way = dy < 0 ? 6 : 2;
    else way = (dx < 0 ? 3 : 1) ^ (dy < 0 ? 6 : 0);
    const [vx, vy] = G.VELOCITY[way];
    ppl.bullets[i] = { ticks: G.LIFE, x: (p.px << 8) | 0x80, y: (p.py << 8) | 0x80, vx, vy, own: 1 };
    this.aim[k] = OFFICERS.AIM_MIN + (ppl.rnd() & 31);
  }
  /** police.harm: `n` health less; at none left, wasted (`shot`: by an officer). */
  harm(n, shot = false) {
    const hp = this.hp - n;
    if (hp <= 0) return this.wasted(shot);
    this.hp = hp;
  }
  /** police.boxed_in, with heat: in a car, slow, a police car near, AFTER frames on end, and the player is busted. */
  boxedIn() {
    const { car, player, traffic } = this, { SLOW, BOXED, AFTER } = BUSTED;
    const near = (d) => Math.abs(((d + 0x8000) & 0xffff) - 0x8000) <= BOXED;
    const boxed = !player.on && Math.abs(car.vx) < SLOW && Math.abs(car.vy) < SLOW &&
      traffic.cars.some((c) => c.on && c.cop && !c.wreck && near(c.px - car.px) && near(c.py - car.py));
    this.boxed = boxed ? this.boxed + 1 : 0;
    if (this.boxed >= AFTER) this.busted();
  }
  /**
   * police.busted: the police cars go, and the heat, the ammo, the knife and a fifth of the money; the car stays
   * where it is, as when the player gets out; and the player is on foot at the police station, the window there,
   * the program drawing the screen afresh.
   */
  busted() {
    this.goDown('busted', true);
  }
  /**
   * police.go_down and down_io: busted, or wasted; the weapons taken if `seized`; the police and the heat gone; no
   * siren; and DOWN frames with everything still (police.downed), the banner over it all, then back().
   */
  goDown(kind, seized) {
    if (seized && this.pickups) Object.assign(this.pickups, { ammo: 0, knife: 0 });
    this.calm();
    this.quiet();
    Object.assign(this, { downKind: kind, paused: BUSTED.DOWN });
  }
  /**
   * police.back_io, at the start of the pass the pause ends in (before foot.update): busted, a fifth of the
   * money and out of the car where it is, at the police station; wasted, full health and the hospital's bill, at
   * the hospital.
   */
  back() {
    const { traffic, player, car } = this;
    if (this.downKind === 'busted') {
      this.money -= Math.floor(this.money / 5);
      if (!player.on) player.out(traffic, Player.place(traffic), [car.px, car.py], 0);
      return this.putAt(BUSTED.STATION, true);
    }
    this.hp = 100;
    this.money = Math.max(0, this.money - 500);
    this.putAt(HURT.HOSPITAL, true);
  }
  /** police.calm: busted or wasted, the police go, and the heat, and the count to being boxed in. */
  calm() {
    this.boxed = 0;
    for (const c of this.traffic.cars) if (c.on && c.cop) Object.assign(c, { on: 0, cop: 0 });
    for (const p of this.people.people) if (p.officer) p.on = 0; // the officers on foot go too
    Object.assign(this.heat, { level: 0, points: 0 });
  }
  /** police.put_at: the player on foot at pixel (x, y), the window there, the program drawing the screen afresh. */
  putAt([x, y], early = false) {
    Object.assign(this.player, { x: x << 8, y: y << 8 });
    const { cell, busy } = this.cam;
    this.cam = new Camera(x - CENTRE_X, y - CENTRE_Y);
    // The program draws the new screen at the end of this pass, and the next goes on colour memory. Put there
    // early in a pass (wasted, from foot.update), the window then follows them as ever, from the character it
    // was in: as putWindow has it.
    if (early) Object.assign(this.cam, { cell, busy });
    else this.cam.busy = true;
  }
  /**
   * police.hits, on foot after the rest of foot.update: a car going faster than HURT.FAST with its body near the
   * player's middle (HURT.LONG along the axis it faces nearer, HURT.SHORT across) hurts them, its speed / 8 - its
   * speed / 64, unless one has in the last HURT.WAIT frames; at no health left, wasted.
   */
  hits() {
    if (this.hitWait) return void this.hitWait--;
    const near = World.near, [x, y] = this.at, t = this.traffic;
    for (let k = t.n - 1; k >= 0; k--) {
      const c = t.cars[k];
      const ns = ((c.face + 2) & 4) !== 0, rx = ns ? HURT.SHORT : HURT.LONG, ry = ns ? HURT.LONG : HURT.SHORT;
      if (!c.on || c.sp <= HURT.FAST || !near(c.px - x, rx) || !near(c.py - y, ry)) continue;
      this.hitWait = HURT.WAIT;
      return this.harm((c.sp >> 3) - (c.sp >> 6));
    }
  }
  /**
   * police.wasted: the police take the weapons if they are about (as of the last frame's police.watch); the
   * police and the heat go; full health; the hospital bills up to $500; the player is at the hospital; no siren.
   */
  wasted(shot = false) {
    this.goDown('wasted', !!(this.traffic.around || this.traffic.patrolNear || shot));
  }
  /** Every sprite that should be on screen, the one in front first: sprite 0, then sprites 1-7 as shared out. */
  sprites() {
    const { car, cam, player } = this;
    const zero = player.on
      ? { x: player.px - cam.x + 31 - 12, y: player.py - cam.y + 55 - 10 - 1, colour: F.COLOUR & 15, multicolour: true, bitmap: player.drawn }
      : { x: car.px - cam.x + 31 - 12, y: car.py - cam.y + 55 - 10 - 1, colour: car.colour, bitmap: assets.car.subarray(direction16(car.angle) * 64, direction16(car.angle) * 64 + 63) };
    return [zero, ...plan(this.list).sort((a, b) => a.hw - b.hw).map(planned)];
  }
}

/** A pass in the models and in the program, and check they agree about everything. */
export async function pass(vice, L, w, bits, what) {
  w.step(bits);
  await vice.joystick(bits);
  await vice.runTo(L.ready);
  assert.deepEqual(await readPlayer(vice, L), w.player.state, `the player ${what}`);
  assert.deepEqual(await readCar(vice, L), carState(w.car), `the player's car ${what}`);
  assert.deepEqual(await camera(vice, L), [w.cam.x, w.cam.y], `the window ${what}`);
  assert.deepEqual(await readTraffic(vice, L, w.traffic.n), modelTraffic(w.traffic), `the traffic ${what}`);
  if (w.honk) assert.deepEqual(await readHonk(vice, L), w.honk.state, `Big Honk ${what}`);
  assert.deepEqual(await readPeople(vice, L), w.people.state, `the passers-by ${what}`);
  if (w.pickups) assert.deepEqual(await readPickups(vice, L), w.pickups.state, `the pickups ${what}`);
  assert.deepEqual(await readHeat(vice, L), w.heat.state, `the heat ${what}`);
}

/**
 * At the top of a pass: the whole picture of the frame being shown, every sprite included. Getting to where the
 * picture is whole runs the program on into the next pass, past where it reads the joystick, so `next` is
 * what that pass will be given: the same as the pass() that follows.
 */
export async function assertPicture(vice, L, w, what, next = 0) {
  await vice.joystick(next);
  await vice.runTo(L['frame.bottom']);
  assert.deepEqual(await pictureMismatches(vice, w.cam.x, w.cam.y, w.sprites()), [], `the picture ${what}`);
}

/** How many frames have been late so far. */
export const missed = async (vice, L) => (await vice.read(L['frame.missed'], 2)).readUInt16LE(0);

/** Put the window where it would settle for a player at pixel (x, y), in the program and the model. */
async function putWindow(vice, L, w, x, y) {
  const cx = Math.min(MAX_X, Math.max(0, x - CENTRE_X)), cy = Math.min(MAX_Y, Math.max(0, y - CENTRE_Y));
  const cell = w.cam.cell;
  w.cam = new Camera(cx, cy);
  w.cam.cell = cell; // the program finds the window in another character and draws a new screen, as this will
  await vice.write(L.cam_lo, [cx & 255, cy & 255]);
  await vice.write(L.cam_hi, [cx >> 8, cy >> 8]);
  await vice.write(L.busy, [0]);
}

/** Put the player's car somewhere, standing still and facing an angle (1/65536 of a turn), with the window on it. */
export async function putCar(vice, L, w, x, y, angle = 0) {
  Object.assign(w.car, { x: x << 8, y: y << 8, vx: 0, vy: 0, angle });
  await vice.write(L['car.pos_x'], [0, x & 255, x >> 8, 0, y & 255, y >> 8, 0, 0, 0, 0, angle & 255, angle >> 8]);
  await vice.write(L['car.inside'], [1]);
  if (!w.player.on) await putWindow(vice, L, w, x, y);
}

/** Put the player on foot at pixel (x, y), facing `face`, with the window on them. Their car stays where it is. */
export async function putOnFoot(vice, L, w, x, y, face = 0) {
  Object.assign(w.player, { on: 1, x: x << 8, y: y << 8, face, phase: 0, swim: 0 });
  await vice.write(L['foot.on'], [1, 0, x & 255, x >> 8, 0, y & 255, y >> 8, face, 0, 0, 0]);
  await putWindow(vice, L, w, x, y);
}

/**
 * Put a car into place `i` of the traffic's tables, in the program and the model: { x, y, dir, cruise } in
 * pixels, driving at its cruising speed, with the rest as new. `wreck: 1` and cruise 0 make it a car with no
 * driver, as the player leaves one.
 */
export async function putTrafficCar(vice, L, w, i, { x, y, dir, cruise, col = 5, face = dir * 4, wreck = 0, sink = 0 }) {
  const n1 = w.traffic.n + 1;
  const car = new TrafficCar({ x: x << 8, y: y << 8, dir, sp: cruise, cruise, face, col, wreck, sink });
  w.traffic.cars[i] = car;
  const write = (name, at, bytes) => vice.write(L[`traffic.${name}`] + at, bytes);
  await write('on', i, [1]);
  for (const [name, at, value] of [['pf', i, 0], ['pf', n1 + i, 0], ['pl', i, x & 255], ['ph', i, x >> 8], ['pl', n1 + i, y & 255], ['ph', n1 + i, y >> 8]])
    await write(name, at, [value]);
  for (const [name, value] of Object.entries({ dir, sp: cruise, cruise, face, col, turn: 0xff, held: 0, ghost: 0, blocked: 0, entered: 0, wreck, sink }))
    await write(name, i, [value]);
  await write('dlo', i, [(cruise * 2) & 255]);
  await write('dhi', i, [(cruise * 2) >> 8]);
  return car;
}
