// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of Big Honk: the real program in VICE, with him held frame by frame to the model in
// honk-model.mjs (the player's car and the traffic to theirs), and his picture compared pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { Car, direction16 } from './car-model.mjs';
import {
  CENTRE_X, CENTRE_Y, Camera, MAP_SIZE, assemble, assets, camera, pictureMismatches, planned, withProgram,
} from './game.mjs';
import { Traffic, TrafficCar, plan } from './traffic-model.mjs';
import { H, Honk, putHonk, readHonk, rowMod12 } from './honk-model.mjs';

// No traffic of its own: the tests put a car where they want one.
const game = assemble('honk', { defs: { SPAWN: 0 } });
const L = game.labels;
const START = [9 * 16, 8 * 16];
const RED = 2;
const WATER = 3; // a tile's kind (tools/assets.mjs)
const kindAt = (x, y) => assets.tiles[1280 + assets.map[(y >> 4) * MAP_SIZE + (x >> 4)]];

const signed = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
async function readCar(vice) {
  const b = await vice.read(L['car.pos_x'], 12);
  return { x: b[0] | (b[1] << 8) | (b[2] << 16), y: b[3] | (b[4] << 8) | (b[5] << 16), vx: signed(b[6], b[7]), vy: signed(b[8], b[9]), angle: b[10] | (b[11] << 8) };
}
const carState = (c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, angle: c.angle });

/** The models of everything that moves, starting as the program does. */
function models() {
  return { car: new Car(START[0] + CENTRE_X, START[1] + CENTRE_Y), cam: new Camera(...START), traffic: new Traffic({ spawn: false }), honk: new Honk(), list: [] };
}

/** One pass of the main loop in the models. */
function step(m, bits) {
  const busy = m.cam.busy; // this pass works out colour memory if the last one swapped the screens
  const cell = [...m.cam.cell]; // the character the window is in before it moves
  m.car.step(bits, m.traffic);
  m.cam.follow(m.car.px, m.car.py);
  m.traffic.step(m.car.px, m.car.py, m.cam, busy);
  m.honk.step(m.car, m.traffic, m.cam, cell);
  m.list = [...m.traffic.show(m.cam), ...m.honk.show(m.cam)];
}

/** One pass in the models, then in the program, and check they agree. */
async function pass(vice, m, bits, what) {
  step(m, bits);
  await vice.joystick(bits);
  await vice.runTo(L.ready);
  assert.deepEqual(await readHonk(vice, L), m.honk.state, `Big Honk ${what}`);
  assert.deepEqual(await readCar(vice), carState(m.car), `the player's car ${what}`);
  assert.deepEqual(await camera(vice, L), [m.cam.x, m.cam.y], `the window ${what}`);
}

/** At the top of a pass: the whole picture of the frame being shown, every sprite included. */
async function assertPicture(vice, m, what) {
  await vice.runTo(L['frame.bottom']);
  const car = m.car, cam = m.cam, frame = direction16(car.angle);
  const player = { x: car.px - cam.x + 31 - 12, y: car.py - cam.y + 55 - 10 - 1, colour: RED, bitmap: assets.car.subarray(frame * 64, frame * 64 + 63) };
  const shown = plan(m.list).sort((a, b) => a.hw - b.hw).map(planned);
  assert.deepEqual(await pictureMismatches(vice, cam.x, cam.y, [player, ...shown]), [], `the picture ${what}`);
}

/** Put the player's car somewhere, standing still and facing a direction, with the window on it. */
async function putCar(vice, m, x, y, angle = 0) {
  m.car = new Car(x, y);
  m.car.angle = angle;
  const cx = x - CENTRE_X, cy = y - CENTRE_Y;
  const cell = m.cam.cell;
  m.cam = new Camera(cx, cy);
  m.cam.cell = cell; // the program finds the window in another character and draws a new screen, as this will
  await vice.write(L['car.pos_x'], [0, x & 255, x >> 8, 0, y & 255, y >> 8, 0, 0, 0, 0, angle & 255, angle >> 8]);
  await vice.write(L['car.inside'], [1]);
  await vice.write(L.cam_lo, [cx & 255, cy & 255]);
  await vice.write(L.cam_hi, [cx >> 8, cy >> 8]);
  await vice.write(L.busy, [0]);
}

/** Put a traffic car into the program and the model: { x, y, dir, cruise }, in place `i`. */
async function putTrafficCar(vice, m, i, { x, y, dir, cruise, col = 5 }) {
  const n1 = m.traffic.n + 1;
  const car = new TrafficCar({ x: x << 8, y: y << 8, dir, sp: cruise, cruise, face: dir * 4, col });
  m.traffic.cars[i] = car;
  const write = (name, at, bytes) => vice.write(L[`traffic.${name}`] + at, bytes);
  await write('on', i, [1]);
  for (const [name, at, value] of [['pf', i, 0], ['pf', n1 + i, 0], ['pl', i, x & 255], ['ph', i, x >> 8], ['pl', n1 + i, y & 255], ['ph', n1 + i, y >> 8]])
    await write(name, at, [value]);
  for (const [name, value] of Object.entries({ dir, sp: cruise, cruise, face: car.face, col, turn: 0xff, held: 0, ghost: 0, blocked: 0, entered: 0, wreck: 0 }))
    await write(name, i, [value]);
  await write('dlo', i, [(cruise * 2) & 255]);
  await write('dhi', i, [(cruise * 2) >> 8]);
  return car;
}

const missed = async (vice) => (await vice.read(L['frame.missed'], 2)).readUInt16LE(0);
/** From now on: a function that says how many frames have been late since. */
async function lateFrom(vice) {
  const before = await missed(vice);
  return async () => (await missed(vice)) - before;
}
const run = (body) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const m = models();
    await pass(vice, m, 0, 'first'); // the first frame after start can be missed: count from the second
    await body(vice, m);
  });

/**
 * Put the player's car somewhere, then give the program the passes it needs to draw the new window and work
 * out its colours (the first of which can be late: a whole new screen). Then count the late frames.
 */
async function settleAt(vice, m, x, y, angle = 0) {
  await putCar(vice, m, x, y, angle);
  for (let i = 0; i < 3; i++) await pass(vice, m, 0, `after the car was put there (${i + 1})`);
  return lateFrom(vice);
}

test('a new game finds Big Honk on the west bank of The Moat, by the water, in his own colours', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    assert.deepEqual(await readHonk(vice, L), new Honk().state, 'as the model starts him, before he has moved');
    assert.equal(kindAt(H.X, H.Y), 0, 'on open ground ...');
    assert.equal(rowMod12(H.Y) >= 2 && H.X >> 4 === 50, true, '... the bank, not a bridge');
    assert.equal(kindAt(H.X + 16, H.Y), WATER, 'with the canal beside him');
    const [multi1, multi2] = await vice.read(0xd025, 2);
    assert.deepEqual([multi1 & 15, multi2 & 15], [0, 7], 'black outline and shades, yellow beak and chain');
    const mc = (await vice.read(0xd01c, 1))[0];
    assert.equal(mc & 1, 0, 'the player\'s car stays a two-colour sprite');
  }));

test('he wanders The Moat as the model says, frame by frame: the banks, the water and over a bridge, never off it', () =>
  run(async (vice, m) => {
    const late = await lateFrom(vice);
    const seen = { bank: false, water: false, bridge: false };
    let minY = m.honk.py, maxY = m.honk.py;
    for (let frame = 1; frame <= 5000; frame++) {
      // Every frame at first, then every 25th: the program and the model only agree then if they did all along.
      if (frame <= 600 || frame % 25 === 0) await pass(vice, m, 0, `after ${frame} frames`);
      else {
        step(m, 0);
        await vice.runTo(L.ready);
      }
      const h = m.honk;
      assert.ok(h.px >= H.X0 && h.px < H.X1, `on The Moat after ${frame} frames (x ${h.px})`);
      const mod = rowMod12(h.py);
      if (mod < 2) seen.bridge = true;
      else if (kindAt(h.px, h.py) === WATER) seen.water = true;
      else seen.bank = true;
      minY = Math.min(minY, h.py);
      maxY = Math.max(maxY, h.py);
    }
    assert.deepEqual(seen, { bank: true, water: true, bridge: true }, 'on the banks, in the water and on a bridge');
    assert.ok(maxY - minY > 192, `along the canal past a bridge (${minY}-${maxY})`);
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('drawn as tools/assets.mjs draws him: facing each way, swaying, flapping, on a bank, in the water and on a bridge', () =>
  run(async (vice, m) => {
    // The player's car on the street beside The Moat, the window on it: the canal, its banks and a bridge.
    const late = await settleAt(vice, m, 784, 840);
    const cases = [
      ['facing east on the bank', { x: 808, y: 860, way: 0, sway: 0 }],
      ['facing east, a step on: swayed a line down', { x: 812, y: 860, way: 0, sway: 1 }],
      ['facing south on the bank', { x: 808, y: 864, way: 1, sway: 0 }],
      ['facing south, a step on: swayed a pixel across', { x: 808, y: 868, way: 1, sway: 1 }],
      ['facing west in the water', { x: 880, y: 880, way: 2 }],
      ['facing north in the water', { x: 900, y: 850, way: 3 }],
      ['on the bridge', { x: 860, y: 784, way: 0, jay: 0 }],
      ['flapping, wings in', { x: 880, y: 880, way: 1, flap: 50 }],
      ['flapping, wings out', { x: 880, y: 880, way: 1, flap: 46 }],
      ['flapping facing east, wings out', { x: 880, y: 880, way: 0, flap: 46 }],
    ];
    for (const [what, at] of cases) {
      await putHonk(vice, L, m.honk, { x: at.x << 8, y: at.y << 8, way: at.way, wait: 200, flap: at.flap ?? 0, jay: at.jay ?? 200 });
      await pass(vice, m, 0, what);
      const [shown] = m.honk.show(m.cam);
      assert.ok(shown, `on screen: ${what}`);
      if (at.sway !== undefined) assert.equal(m.honk.sway, at.sway);
      await assertPicture(vice, m, what);
      await pass(vice, m, 0, `after ${what}`); // back to the top of a pass, where he can be put somewhere else
    }
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('run over by the player\'s car he only flaps, wings beating, and runs off; nothing ruffles him again until he stops', () =>
  run(async (vice, m) => {
    // The car on the street west of The Moat, facing east, and Big Honk on the bank in front of it.
    const late = await settleAt(vice, m, 776, 860);
    await putHonk(vice, L, m.honk, { x: 812 << 8, y: 860 << 8, way: 0, wait: 250, flap: 0, jay: 200 });
    let frame = 0;
    while (!m.honk.flap && frame < 80) await pass(vice, m, JOY.UP, `driving at him, ${++frame} frames`);
    assert.equal(m.honk.flap, H.FLAP - 1, 'he flaps');
    assert.equal(m.honk.way, 0, 'running east, away from the car that came from the west');
    assert.ok(m.car.vx >= H.RUN_OVER, 'and the car did not stop for him: nothing hurts it either');
    // Flapping: the car keeps driving into him, and he does not start again until he has stopped. (In a frame
    // that moves the screen he stands still, flapping included.)
    const pointers = new Set();
    let frames = 0, last = m.honk.flap;
    while (m.honk.flap) {
      frames++;
      await pass(vice, m, frames < 30 ? JOY.UP : JOY.DOWN, `flapping, ${frames} frames on`);
      assert.ok(m.honk.flap === last || m.honk.flap === last - 1, 'counting down, never starting again');
      last = m.honk.flap;
      pointers.add(m.honk.pointer);
      if (frames === 12 || frames === 16) await assertPicture(vice, m, `flapping, ${frames} frames on`);
    }
    assert.deepEqual([...pointers].sort(), [H.SPRITE, H.SPRITE + 1], 'facing east, his wings beat: out, and in');
    assert.ok(frames < 2 * H.FLAP, `and he stopped (${frames} frames)`);
    assert.ok(m.honk.px > 812 + 40, `and he ran (${m.honk.px - 812} pixels)`);
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('a traffic car that runs into him on a bridge ruffles him too, and drives on', () =>
  run(async (vice, m) => {
    // The window on the bridge across The Moat at tile rows 48-49; the player's car stands on the street.
    const late = await settleAt(vice, m, 784, 840);
    // Big Honk crossing the bridge in the eastbound lane, and a car coming up behind him in it.
    await putHonk(vice, L, m.honk, { x: 860 << 8, y: 792 << 8, way: 0, wait: 250, flap: 0, jay: 0 });
    const c = await putTrafficCar(vice, m, 0, { x: 806, y: 792, dir: 0, cruise: 150 });
    let frame = 0;
    while (!m.honk.flap && frame < 120) await pass(vice, m, 0, `the car coming, ${++frame} frames`);
    assert.equal(m.honk.flap, H.FLAP - 1, 'he flaps');
    assert.equal(m.honk.way, 0, 'and runs on east, away from it');
    assert.ok(c.sp >= H.TRAFFIC_RUN_OVER, 'the car did not stop');
    for (let k = 1; k <= 8; k++) await pass(vice, m, 0, `${k} frames on`);
    assert.equal(plan(m.list).length, 2, 'both shown');
    await assertPicture(vice, m, 'the car and Big Honk, each in its own colours');
    while (m.honk.flap) await pass(vice, m, 0, 'flapping');
    assert.ok(c.px > m.honk.px, 'the car has driven on past him');
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('driven into flat out while the screen scrolls, he still flaps, and no frame is late', () =>
  run(async (vice, m) => {
    // The car on the road that crosses The Moat at tile rows 48-49, facing east, far enough back to reach top
    // speed; Big Honk on the bridge in its lane, crossing it.
    const late = await settleAt(vice, m, 400, 784);
    await putHonk(vice, L, m.honk, { x: 860 << 8, y: 784 << 8, way: 0, wait: 250, flap: 0, jay: 0 });
    let frame = 0, standing = 0;
    while (!m.honk.flap && frame < 250) {
      const before = m.honk.x;
      await pass(vice, m, JOY.UP, `driving at him, ${++frame} frames`);
      if (m.honk.x === before) standing++;
    }
    assert.ok(m.honk.flap > 0, 'he flaps');
    assert.ok(m.car.vx >= 1000, `the car was flat out (${m.car.vx})`);
    assert.ok(standing > 20, `he stood still in the frames that moved the screen (${standing})`);
    for (let k = 1; k <= 20; k++) await pass(vice, m, JOY.UP, `${k} frames after`);
    assert.equal(await late(), 0, 'no frame was late');
  }));
