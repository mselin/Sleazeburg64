// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the traffic: the real program in VICE, with its cars held frame by frame to the model
// in traffic-model.mjs, the player's car and the window to the models the car tests use, Big Honk to his in
// honk-model.mjs, and the picture, every sprite included, compared pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { C, Car, direction16 } from './car-model.mjs';
import { CENTRE_X, CENTRE_Y, Camera, assemble, assets, camera, pictureMismatches, planned, withProgram } from './game.mjs';
import { LOWEST, T, Traffic, TrafficCar, plan } from './traffic-model.mjs';
import { Honk, readHonk } from './honk-model.mjs';

const START = [9 * 16, 8 * 16];
const RED = 2;
const LANE = { 0: 24, 1: 8, 2: 8, 3: 24 }; // each direction's lane, from the road's edge

/** Read the program's traffic: every car, and the counters and random seed that decide what comes next. */
async function readTraffic(vice, L, n) {
  const n1 = n + 1;
  const get = (name, length) => vice.read(L[`traffic.${name}`], length);
  const [on, pf, pl, ph] = await Promise.all([get('on', n), get('pf', 2 * n1), get('pl', 2 * n1), get('ph', 2 * n1)]);
  const fields = {};
  for (const f of ['dir', 'sp', 'cruise', 'face', 'col', 'turn', 'tal', 'tah', 'held', 'ghost', 'blocked', 'entered', 'wreck']) fields[f] = await get(f, n);
  const cars = [];
  for (let i = 0; i < n; i++) {
    if (!on[i]) {
      cars.push({ on: 0 });
      continue;
    }
    const car = { on: 1, x: (ph[i] << 16) | (pl[i] << 8) | pf[i], y: (ph[n1 + i] << 16) | (pl[n1 + i] << 8) | pf[n1 + i] };
    for (const f of ['dir', 'sp', 'cruise', 'face', 'col', 'turn', 'held', 'ghost', 'blocked', 'entered', 'wreck']) car[f] = fields[f][i];
    car.ta = car.turn === 0xff ? null : fields.tal[i] | (fields.tah[i] << 8);
    cars.push(car);
  }
  const seed = await get('seed', 2);
  const [tick, rot, wait, turns] = await Promise.all([get('tick', 1), get('rot', 1), get('spawn_wait', 1), get('turns', 1)]);
  return { cars, seed: [seed[0], seed[1]], tick: tick[0], turns: turns[0], rot: rot[0], spawnWait: wait[0] };
}

/** The same, from the model. */
function modelTraffic(t) {
  const cars = t.cars.map((c) => {
    if (!c.on) return { on: 0 };
    const car = { on: 1, x: c.x, y: c.y };
    for (const f of ['dir', 'sp', 'cruise', 'face', 'col', 'turn', 'held', 'ghost', 'blocked', 'entered', 'wreck']) car[f] = c[f];
    car.ta = c.turn === 0xff ? null : c.ta;
    return car;
  });
  return { cars, seed: [t.rnd.lo, t.rnd.hi], tick: t.tick, turns: t.turns, rot: t.rot, spawnWait: t.spawnWait };
}

/** Every sprite the model says is on screen, the one in front first: the player's car, then sprites 1-7. */
function spritesFor(car, cam, list) {
  const bitmap = (frame) => assets.car.subarray(frame * 64, frame * 64 + 63);
  const player = { x: car.px - cam.x + 31 - 12, y: car.py - cam.y + 55 - 10 - 1, colour: RED, bitmap: bitmap(direction16(car.angle)) };
  const shown = plan(list).sort((a, b) => a.hw - b.hw);
  return [player, ...shown.map(planned)];
}

/** The models of everything that moves, starting as the program does. */
function models(traffic) {
  return { car: new Car(START[0] + CENTRE_X, START[1] + CENTRE_Y), cam: new Camera(...START), traffic, honk: new Honk(), list: [] };
}

/** One pass of the main loop in the models, with the joystick held as given. */
function step(m, bits) {
  const busy = m.cam.busy; // this pass works out colour memory if the last one swapped the screens
  const cell = [...m.cam.cell]; // the character the window is in before it moves
  m.car.step(bits, m.traffic);
  m.cam.follow(m.car.px, m.car.py);
  m.traffic.step(m.car.px, m.car.py, m.cam, busy);
  m.honk.step(m.car, m.traffic, m.cam, cell);
  m.list = [...m.traffic.show(m.cam), ...m.honk.show(m.cam)].slice(0, 16); // the multiplexer lists sixteen
}

const signed = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
async function readCar(vice, L) {
  const b = await vice.read(L['car.pos_x'], 12);
  return { x: b[0] | (b[1] << 8) | (b[2] << 16), y: b[3] | (b[4] << 8) | (b[5] << 16), vx: signed(b[6], b[7]), vy: signed(b[8], b[9]), angle: b[10] | (b[11] << 8) };
}
const carState = (c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, angle: c.angle });

/** A pass in the models and in the program, and check they agree. */
async function pass(vice, L, m, bits, what) {
  step(m, bits);
  await vice.joystick(bits);
  await vice.runTo(L.ready);
  assert.deepEqual(await readCar(vice, L), carState(m.car), `the player's car ${what}`);
  assert.deepEqual(await camera(vice, L), [m.cam.x, m.cam.y], `the window ${what}`);
  assert.deepEqual(await readTraffic(vice, L, m.traffic.n), modelTraffic(m.traffic), `the traffic ${what}`);
  assert.deepEqual(await readHonk(vice, L), m.honk.state, `Big Honk ${what}`);
}

/** At the top of a pass: the whole picture of the frame being shown, every sprite included. */
async function assertPicture(vice, L, m, what) {
  await vice.runTo(L['frame.bottom']);
  assert.deepEqual(await pictureMismatches(vice, m.cam.x, m.cam.y, spritesFor(m.car, m.cam, m.list)), [], `the picture ${what}`);
}

/** Every car on its lane: its position across its road is its direction's lane line. */
function assertInLanes(traffic, what) {
  for (const c of traffic.cars) {
    if (!c.on) continue;
    const across = c.dir & 1 ? c.px : c.py;
    assert.equal(across % 192, LANE[c.dir], `a car going ${c.dir} keeps to its lane ${what}`);
    assert.equal((c.dir & 1 ? c.x : c.y) & 255, 0, `exactly on the lane line ${what}`);
  }
}

const game = assemble('traffic');
const G = game.labels;

test('a long drive with traffic: every car as the model says every frame, on its lane, the picture right, no frame late', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.ready);
    const m = models(new Traffic());
    const missed = async () => (await vice.read(G['frame.missed'], 2)).readUInt16LE(0);
    await pass(vice, G, m, 0, 'first'); // the first frame after start can be missed: count from the second
    const before = await missed();
    let seed = 1987, bits = 0, most = 0;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16;
    for (let frame = 1; frame <= 1500; frame++) {
      if (frame % 12 === 1) bits = [JOY.UP, JOY.UP, JOY.UP | JOY.LEFT, JOY.UP | JOY.RIGHT, JOY.DOWN, 0, JOY.RIGHT | JOY.FIRE, JOY.UP | JOY.FIRE][random() & 7];
      if (frame % 50 === 0) {
        await vice.joystick(bits);
        await assertPicture(vice, G, m, `after ${frame - 1} frames`);
      }
      await pass(vice, G, m, bits, `after ${frame} frames`);
      assertInLanes(m.traffic, `after ${frame} frames`);
      most = Math.max(most, m.traffic.cars.filter((c) => c.on).length);
    }
    assert.equal(most, 6, 'there were six cars at once');
    assert.equal(await missed() - before, 0, 'no frame was late');
  }));

test('flat out east with traffic: the window keeps up and every frame is in time', (t) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.ready);
    const m = models(new Traffic());
    const missed = async () => (await vice.read(G['frame.missed'], 2)).readUInt16LE(0);
    await pass(vice, G, m, 0, 'first');
    const before = await missed();
    let latest = 0;
    for (let frame = 1; frame <= 240; frame++) {
      step(m, JOY.UP);
      await vice.joystick(JOY.UP);
      await vice.runTo(G['frame.publish']);
      latest = Math.max(latest, ((await vice.registers()).LIN - 250 + 312) % 312);
      await vice.runTo(G.ready);
      assert.deepEqual(await readTraffic(vice, G, 6), modelTraffic(m.traffic), `the traffic after ${frame} frames`);
    }
    t.diagnostic(`with traffic, the busiest pass was ready ${latest} raster lines after the bottom interrupt, of 312`);
    assert.equal(m.car.vx, C.TOP, 'at top speed');
    assert.equal(await missed() - before, 0, 'no frame was late');
  }));

// With no traffic of its own the tests can put cars where they like.
const placed = assemble('traffic-placed', { defs: { SPAWN: 0 } });
const P = placed.labels;

/** Put traffic cars into the program and the model. Each is { x, y, dir, cruise } in pixels; the rest as new. */
async function putTraffic(vice, m, cars, L = P) {
  const n = m.traffic.n, n1 = n + 1;
  const write = (name, at, bytes) => vice.write(L[`traffic.${name}`] + at, bytes);
  for (let i = 0; i < n; i++) {
    const c = cars[i];
    if (!c) {
      await write('on', i, [0]);
      m.traffic.cars[i] = new TrafficCar({ on: 0 });
      continue;
    }
    const car = new TrafficCar({ x: c.x << 8, y: c.y << 8, dir: c.dir, sp: c.sp ?? c.cruise, cruise: c.cruise, face: c.dir * 4, col: c.col ?? 5 });
    m.traffic.cars[i] = car;
    await write('on', i, [1]);
    await write('pf', i, [0]);
    await write('pf', n1 + i, [0]);
    await write('pl', i, [c.x & 255]);
    await write('ph', i, [c.x >> 8]);
    await write('pl', n1 + i, [c.y & 255]);
    await write('ph', n1 + i, [c.y >> 8]);
    for (const [name, value] of Object.entries({ dir: car.dir, sp: car.sp, cruise: car.cruise, face: car.face, col: car.col, turn: 0xff, held: 0, ghost: 0, blocked: 0, entered: 0, wreck: 0 }))
      await write(name, i, [value]);
    await write('dlo', i, [(car.sp * 2) & 255]);
    await write('dhi', i, [(car.sp * 2) >> 8]);
  }
}

test('a car stops behind the player\'s car in its lane, waits, then gives up waiting and drives on', () =>
  withProgram(placed.prg, async (vice) => {
    await vice.runTo(P.ready);
    const m = models(new Traffic({ spawn: false }));
    await pass(vice, P, m, 0, 'first');
    // The player's car stands on the road from the start; a car comes up behind it in the eastbound lane, 8
    // pixels to one side of the player's.
    assert.equal(m.car.py - 192, 16);
    await putTraffic(vice, m, [{ x: m.car.px - 120, y: 192 + LANE[0], dir: 0, cruise: 150 }]);
    const c = m.traffic.cars[0];
    let stoppedAt = null, waited = 0;
    for (let frame = 1; frame <= 400 && c.px < m.car.px + 40; frame++) {
      await pass(vice, P, m, 0, `after ${frame} frames`);
      if (c.sp === 0) {
        stoppedAt ??= m.car.px - c.px;
        waited++;
      }
      if (frame === 150) await assertPicture(vice, P, m, 'with the car waiting');
    }
    assert.ok(stoppedAt >= T.AHEAD_MIN && stoppedAt <= T.AHEAD_MAX, `it stopped ${stoppedAt} pixels behind`);
    assert.ok(waited >= T.HELD - 10, `it waited ${waited} frames before giving up`);
    assert.ok(c.px >= m.car.px + 40, 'and then drove on past');
  }));

// ---------- the player's car running into traffic ----------

test('running into a car hard: the player\'s car bounces off, and the car is a wreck that rolls to a stop', () =>
  withProgram(placed.prg, async (vice) => {
    await vice.runTo(P.ready);
    const m = models(new Traffic({ spawn: false }));
    await pass(vice, P, m, 0, 'first');
    // A car driving east 40 pixels ahead in the next lane over, close enough to hit, slower than the player.
    await putTraffic(vice, m, [{ x: m.car.px + 40, y: 192 + LANE[0], dir: 0, cruise: 120 }]);
    const c = m.traffic.cars[0];
    let frame = 0;
    while (!c.wreck && frame < 200) await pass(vice, P, m, JOY.UP, `after ${++frame} frames`);
    assert.equal(c.wreck, 1, 'hit hard, it is a wreck');
    assert.ok(m.car.vx < 0, 'and the player\'s car bounced back');
    for (let k = 1; k <= 20; k++) await pass(vice, P, m, 0, `${k} frames after the crash`);
    assert.equal(c.sp, 0, 'the wreck has rolled to a stop');
    await assertPicture(vice, P, m, 'after the crash');
  }));

test('nudging a car slowly: the player\'s car bounces off, and the car is no wreck', () =>
  withProgram(placed.prg, async (vice) => {
    await vice.runTo(P.ready);
    const m = models(new Traffic({ spawn: false }));
    await pass(vice, P, m, 0, 'first');
    await putTraffic(vice, m, [{ x: m.car.px + 22, y: 192 + LANE[0], dir: 0, cruise: 0 }]); // standing
    let frame = 0;
    while (m.car.vx >= 0 && frame < 60) await pass(vice, P, m, JOY.UP, `after ${++frame} frames`);
    assert.ok(m.car.vx < 0, 'it bounced');
    assert.equal(m.traffic.cars[0].wreck, 0, 'too slowly to wreck it');
    for (let k = 1; k <= 30; k++) await pass(vice, P, m, JOY.UP, `pushing on, ${k} frames`);
    assert.ok(m.car.px < m.traffic.cars[0].px - 12, 'and it cannot push through');
  }));

test('a car that has driven into the player\'s car does not hold it: it drives out', () =>
  withProgram(placed.prg, async (vice) => {
    await vice.runTo(P.ready);
    const m = models(new Traffic({ spawn: false }));
    await pass(vice, P, m, 0, 'first');
    // Standing right behind and against the player's car, as if it had driven into it.
    await putTraffic(vice, m, [{ x: m.car.px - 3, y: 192 + LANE[0], dir: 0, cruise: 0 }]);
    const x0 = m.car.px;
    for (let frame = 1; frame <= 30; frame++) await pass(vice, P, m, JOY.UP, `after ${frame} frames`);
    assert.ok(m.car.px > x0 + 20, `it drove out (${m.car.px - x0} pixels)`);
    assert.ok(m.car.vx > 0, 'without bouncing');
  }));

// ---------- the multiplexer ----------
// Sixteen cars, standing where the tests put them, so that sprites have to be shared.
const many = assemble('traffic-many', { defs: { SPAWN: 0, CARS: 16 } });
const M = many.labels;

/** Put the player's car standing still at pixel (x, y), with the window on it, in the program and the models. */
async function putPlayer(vice, m, x, y) {
  m.car = new Car(x, y);
  const cx = x - CENTRE_X, cy = y - CENTRE_Y;
  const cell = m.cam.cell;
  m.cam = new Camera(cx, cy);
  m.cam.cell = cell; // the program finds the window in another character and draws a new screen, as this will
  await vice.write(M['car.pos_x'], [0, x & 255, x >> 8, 0, y & 255, y >> 8, 0, 0, 0, 0, 0, 0]);
  await vice.write(M['car.inside'], [1]);
  await vice.write(M.cam_lo, [cx & 255, cy & 255]);
  await vice.write(M.cam_hi, [cx >> 8, cy >> 8]);
  await vice.write(M.busy, [0]);
}

/** Cars standing still (cruise 0) at pixel positions relative to the window's top left corner. */
const standing = (m, list) => list.map(([dx, dy, dir, col]) => ({ x: m.cam.x + dx, y: m.cam.y + dy, dir, cruise: 0, col }));

async function settle(vice, m, frames = 3) {
  for (let i = 0; i < frames; i++) await pass(vice, M, m, 0, `after setting up (${i + 1})`);
}

test('sixteen cars down the screen share sprites 1-7: every pixel is right', () =>
  withProgram(many.prg, async (vice) => {
    await vice.runTo(M.ready);
    const m = models(new Traffic({ cars: 16, spawn: false }));
    await pass(vice, M, m, 0, 'first');
    await putPlayer(vice, m, 296, 208);
    // Five rows of three, 30 lines apart, and one more: never more than seven in any 21 lines, but sixteen in
    // all, so the multiplexer's interrupts reuse sprites as they go down. Some partly off the left and right
    // edges, and one partly above the top, which the borders hide.
    const at = [];
    for (let row = 0; row < 5; row++) for (let k = 0; k < 3; k++) at.push([-4 + k * 140 + row * 7, 2 + row * 30, (row + k) & 3, [3, 4, 5, 7, 8, 10, 13, 14][(row * 3 + k) & 7]]);
    at.push([200, -6, 1, 13]);
    await putTraffic(vice, m, standing(m, at), M);
    await settle(vice, m);
    assert.equal(plan(m.list).length, 16, 'all sixteen shown');
    for (let frame = 0; frame < 3; frame++) {
      await vice.joystick(0);
      await assertPicture(vice, M, m, `frame ${frame + 1}`);
      await pass(vice, M, m, 0, `frame ${frame + 1}`);
    }
  }));

test('when more than seven are level with each other, the ones left out take turns', () =>
  withProgram(many.prg, async (vice) => {
    await vice.runTo(M.ready);
    const m = models(new Traffic({ cars: 16, spawn: false }));
    await pass(vice, M, m, 0, 'first');
    await putPlayer(vice, m, 296, 208);
    // Ten in a row across the top of the window: seven sprites for ten cars.
    await putTraffic(vice, m, standing(m, Array.from({ length: 10 }, (_, k) => [14 + k * 30, 30, 0, [3, 4, 5, 7, 8, 10, 13, 14, 3, 4][k]])), M);
    await settle(vice, m);
    const seen = new Set();
    for (let frame = 0; frame < 12; frame++) {
      const shown = plan(m.list);
      assert.equal(shown.length, 7, 'seven of the ten');
      shown.forEach((s) => seen.add(s.x));
      await vice.joystick(0);
      await assertPicture(vice, M, m, `frame ${frame + 1}`);
      await pass(vice, M, m, 0, `frame ${frame + 1}`);
    }
    assert.equal(seen.size, 10, 'every one of the ten was shown in some frame');
  }));

for (let scroll = 0; scroll < 8; scroll++)
  test(`at the bottom of the city with fine scroll ${scroll}: cars go before their sprites reach the black band`, () =>
    withProgram(many.prg, async (vice) => {
      await vice.runTo(M.ready);
      const m = models(new Traffic({ cars: 16, spawn: false }));
      await pass(vice, M, m, 0, 'first');
      await putPlayer(vice, m, 296, 200 + scroll); // on the road; the window's fine scroll follows
      // Each way the car can face, once as low as it can be shown and once a line lower, which must not show.
      const at = [];
      [0, 1, 2, 3].forEach((dir, k) => {
        const lowest = LOWEST - 10; // from the window's top: LOWEST counts from 10 above it
        at.push([30 + k * 70, lowest, dir, [3, 5, 7, 14][k]], [62 + k * 70, lowest + 1, dir, [4, 8, 10, 13][k]]);
      });
      await putTraffic(vice, m, standing(m, at), M);
      await settle(vice, m);
      assert.equal(plan(m.list).length, 4, 'the four as low as they go are shown, the four below them are not');
      await vice.joystick(0);
      await assertPicture(vice, M, m, `with fine scroll ${scroll}`);
    }));
