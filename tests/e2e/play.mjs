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

export const START = [9 * 16, 8 * 16]; // the window's top left corner at start; the car is in its middle
const TRAFFIC_FIELDS = ['dir', 'sp', 'cruise', 'face', 'col', 'turn', 'held', 'ghost', 'blocked', 'entered', 'wreck'];

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
  return { cars, seed: [seed[0], seed[1]], tick: tick[0], turns: turns[0], rot: rot[0], spawnWait: wait[0], mine: mine[0] };
}

/** The same, from the model. */
export function modelTraffic(t) {
  const cars = t.cars.map((c) => {
    if (!c.on) return { on: 0 };
    const car = { on: 1, x: c.x, y: c.y };
    for (const f of TRAFFIC_FIELDS) car[f] = c[f];
    car.ta = c.turn === 0xff ? null : c.ta;
    return car;
  });
  return { cars, seed: [t.rnd.lo, t.rnd.hi], tick: t.tick, turns: t.turns, rot: t.rot, spawnWait: t.spawnWait, mine: t.mine };
}

const signed = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
/** The player's car in the program: where it is, how it moves, the way it faces, and its colour. */
export async function readCar(vice, L) {
  if (L['car.colour'] - L['car.pos_x'] !== 13) throw new Error('readCar expects pos, vel, angle, inside and colour in a row');
  const b = await vice.read(L['car.pos_x'], 14);
  return {
    x: b[0] | (b[1] << 8) | (b[2] << 16), y: b[3] | (b[4] << 8) | (b[5] << 16),
    vx: signed(b[6], b[7]), vy: signed(b[8], b[9]), angle: b[10] | (b[11] << 8), colour: b[13],
  };
}
export const carState = (c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, angle: c.angle, colour: c.colour });

/**
 * The models of everything that moves, starting as the program does. `honk` false leaves Big Honk out (a
 * build with HONK=0); `traffic` are the traffic model's options.
 */
export class World {
  constructor({ honk = true, traffic = {} } = {}) {
    this.car = new Car(START[0] + CENTRE_X, START[1] + CENTRE_Y);
    this.player = new Player(this.car);
    this.cam = new Camera(...START);
    this.traffic = new Traffic(traffic);
    this.honk = honk ? new Honk() : null;
    this.list = [];
  }
  /** One pass of the main loop with the joystick held as given. */
  step(bits) {
    const cell = [...this.cam.cell]; // the character the window is in before it moves
    const busy = this.cam.busy; // this pass works out colour memory if the last one swapped the screens
    this.player.step(bits, this.traffic);
    this.cam.follow(this.player.px, this.player.py);
    this.traffic.step(this.player.px, this.player.py, this.cam, busy);
    if (this.honk) this.honk.step(this.car, this.traffic, this.cam, cell);
    this.list = [...this.traffic.show(this.cam), ...(this.honk ? this.honk.show(this.cam) : [])].slice(0, 16); // the multiplexer lists sixteen
  }
  /** Every sprite that should be on screen, the one in front first: sprite 0, then sprites 1-7 as shared out. */
  sprites() {
    const { car, cam, player } = this;
    const zero = player.on
      ? { x: player.px - cam.x + 31 - 12, y: player.py - cam.y + 55 - 10 - 1, colour: F.COLOUR & 15, multicolour: true, bitmap: spriteData(player.pointer(this.traffic.tick)) }
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
export async function putTrafficCar(vice, L, w, i, { x, y, dir, cruise, col = 5, face = dir * 4, wreck = 0 }) {
  const n1 = w.traffic.n + 1;
  const car = new TrafficCar({ x: x << 8, y: y << 8, dir, sp: cruise, cruise, face, col, wreck });
  w.traffic.cars[i] = car;
  const write = (name, at, bytes) => vice.write(L[`traffic.${name}`] + at, bytes);
  await write('on', i, [1]);
  for (const [name, at, value] of [['pf', i, 0], ['pf', n1 + i, 0], ['pl', i, x & 255], ['ph', i, x >> 8], ['pl', n1 + i, y & 255], ['ph', n1 + i, y >> 8]])
    await write(name, at, [value]);
  for (const [name, value] of Object.entries({ dir, sp: cruise, cruise, face, col, turn: 0xff, held: 0, ghost: 0, blocked: 0, entered: 0, wreck }))
    await write(name, i, [value]);
  await write('dlo', i, [(cruise * 2) & 255]);
  await write('dhi', i, [(cruise * 2) >> 8]);
  return car;
}
