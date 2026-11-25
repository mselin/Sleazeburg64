// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the car: the real program in VICE, driven through the joystick port, held frame by
// frame to the model in car-model.mjs, and its picture compared pixel by pixel, sprite included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { C, Car, MOST_TURN, SIN, direction16, hits } from './car-model.mjs';
import { Traffic } from './traffic-model.mjs';
import { Player } from './foot-model.mjs';
import { waterStep } from './water-model.mjs';
import {
  CAR_SPRITE, CENTRE_X, CENTRE_Y, Camera, MAX_X, MAX_Y, assemble, assets, camera, pictureMismatches,
  screenMismatches, withProgram,
} from './game.mjs';

// No traffic, no Big Honk and no pickups: these tests are about the car (traffic.test.mjs has the traffic and him, the car
// with them included).
const game = assemble('car', { defs: { SPAWN: 0, HONK: 0, ITEMS: 0 } });
const L = game.labels;
const START = [9 * 16, 8 * 16]; // the window's top left corner; the car is in its middle
const RED = 2;

const run = (body) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    return body(vice);
  });

const signed = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
async function readCar(vice) {
  const b = await vice.read(L['car.pos_x'], 12);
  return {
    x: b[0] | (b[1] << 8) | (b[2] << 16), y: b[3] | (b[4] << 8) | (b[5] << 16),
    vx: signed(b[6], b[7]), vy: signed(b[8], b[9]), angle: b[10] | (b[11] << 8),
  };
}
const state = (car) => ({ x: car.x, y: car.y, vx: car.vx, vy: car.vy, angle: car.angle });

/** The sprite as the model says the program should show it, for the picture model. */
const spriteFor = (car, cam) => ({
  x: car.px - cam.x + 31 - 12, y: car.py - cam.y + 55 - 10 - 1, colour: RED,
  bitmap: assets.car.subarray(direction16(car.angle) * 64, direction16(car.angle) * 64 + 63),
});

/**
 * A model of the car and the window, starting as the program does, with the water (water-model.mjs), which
 * finds out how wet the car is; the player and the traffic's tables are only there for a car that floods.
 */
function models() {
  const car = new Car(START[0] + CENTRE_X, START[1] + CENTRE_Y);
  return { car, player: new Player(car), cam: new Camera(...START), traffic: new Traffic({ spawn: false }) };
}

/** One pass of the main loop in the models, then in the program, and check they agree. */
async function pass(vice, m, bits, what) {
  const cell = [...m.cam.cell];
  m.car.step(bits, null, m.cam.busy);
  m.cam.follow(m.car.px, m.car.py);
  waterStep(m, cell);
  await vice.joystick(bits);
  await vice.runTo(L.ready);
  assert.deepEqual(await readCar(vice), state(m.car), `the car ${what}`);
  assert.deepEqual(await camera(vice, L), [m.cam.x, m.cam.y], `the window ${what}`);
}

/** At the top of a pass: check every pixel of the frame it is shown in. */
async function assertPicture(vice, m, what = '') {
  assert.deepEqual(await screenMismatches(vice, m.cam.x, m.cam.y, L), [], `screen and colour memory ${what}`);
  await vice.runTo(L['frame.bottom']);
  assert.deepEqual(await pictureMismatches(vice, m.cam.x, m.cam.y, spriteFor(m.car, m.cam)), [], `the picture ${what}`);
}

/** Put the car somewhere directly, standing still and facing a direction, with the window on it. */
async function putCar(vice, m, x, y, angle = 0) {
  m.car = new Car(x, y);
  m.car.angle = angle;
  const cx = Math.min(MAX_X, Math.max(0, x - CENTRE_X)), cy = Math.min(MAX_Y, Math.max(0, y - CENTRE_Y));
  m.cam = new Camera(cx, cy);
  await vice.write(L['car.pos_x'], [0, x & 255, x >> 8, 0, y & 255, y >> 8, 0, 0, 0, 0, angle & 255, angle >> 8]);
  await vice.write(L['car.inside'], [1]);
  await vice.write(L.cam_lo, [cx & 255, cy & 255]);
  await vice.write(L.cam_hi, [cx >> 8, cy >> 8]);
  await vice.write(L.busy, [0]);
  await vice.joystick(0);
  for (let i = 0; i < 2; i++) await pass(vice, m, 0, 'after being put there'); // draw, then swap and colour
}

test('the sine table, the car\'s axis, the steering limit and the multiplication tables are the ones the model uses', () =>
  run(async (vice) => {
    // The program keeps the low bytes; car.sine makes the high byte: 1 within two directions of a quarter turn
    // (256, rounded), $ff past half a turn.
    const sinLo = await vice.read(L['car.sin_lo'], 256), sinHi = (a) => (a >= 129 ? 0xff : a >= 62 && a <= 66 ? 1 : 0);
    assert.deepEqual([...sinLo].map((l, a) => signed(l, sinHi(a))), SIN);
    assert.deepEqual([...(await vice.read(L['car.most_turn'], 65))], MOST_TURN, 'the most turn for each speed');
    // Quarter squares, n * n / 4 for n = -255..511: the low bytes at SQUARES + n, the high at SQUARES_HI + n.
    const lo = await vice.read(L.SQUARES - 255, 767), hi = await vice.read(L.SQUARES_HI - 255, 767);
    for (let n = -255; n < 512; n++) assert.equal(lo[n + 255] | (hi[n + 255] << 8), (n * n) >> 2, `quarter square of ${n}`);
  }));

test('the car starts in the middle of the window, standing still and facing east, on a street', () =>
  run(async (vice) => {
    const m = models();
    assert.deepEqual(await readCar(vice), state(m.car));
    assert.equal(hits(m.car.px, m.car.py, 0), false, 'clear of walls');
    await pass(vice, m, 0, 'after a frame');
    await vice.runTo(L['frame.shown']); // the first frame the main loop placed the sprite for
    const vic = await vice.read(0xd000, 0x30);
    assert.equal(vic[0x15] & 1, 1, 'sprite 0 on');
    assert.equal(vic[0x27] & 15, RED);
    assert.equal(vic[0x1c] & 1, 0, 'two-colour');
    assert.equal((await vice.read(0x3000 + 0x3f8, 1))[0], CAR_SPRITE, 'facing east');
    await vice.runTo(L.ready);
    await assertPicture(vice, m, 'at the start');
  }));

for (const [name, script] of [
  ['accelerating east, coasting and braking to a stop', [[JOY.UP, 70], [0, 30], [JOY.DOWN, 40]]],
  ['reversing, then stopping', [[JOY.DOWN, 50], [0, 60]]],
  ['turning at speed slides the car', [[JOY.UP, 40], [JOY.UP | JOY.RIGHT, 20], [JOY.UP | JOY.LEFT, 25], [0, 20]]],
  ['a handbrake turn', [[JOY.UP, 50], [JOY.RIGHT | JOY.FIRE, 30], [JOY.UP, 20]]],
  ['steering while standing still does nothing', [[JOY.LEFT, 10], [JOY.RIGHT, 10]]],
])
  test(`driving: ${name}, frame by frame as the model says`, () =>
    run(async (vice) => {
      const m = models();
      let frame = 0;
      for (const [bits, frames] of script)
        for (let i = 0; i < frames; i++) await pass(vice, m, bits, `after ${++frame} frames`);
      await assertPicture(vice, m, `after ${frame} frames`);
    }));

test('driving off in every direction, and on either side of each straight one, frame by frame as the model says', () =>
  run(async (vice) => {
    // Next to the compass points the sine table holds exactly 256 or -256, which the multiplication treats
    // on its own: every direction a step either side of them is here too.
    const directions = [];
    for (let k = 0; k < 16; k++) directions.push(k * 16);
    for (const d of [0, 64, 128, 192]) directions.push((d + 1) & 255, (d + 255) & 255);
    const m = models();
    for (const d of directions) {
      await putCar(vice, m, 600, 9 * 16 + 9, d << 8); // a crossing, with room every way
      for (let frame = 1; frame <= 24; frame++) await pass(vice, m, JOY.UP, `facing ${d}, after ${frame} frames`);
      for (let frame = 1; frame <= 6; frame++) await pass(vice, m, JOY.UP | JOY.RIGHT, `facing ${d} and turning, after ${frame} frames`);
    }
  }));

test('the car cannot drive through buildings: it bounces off them', () =>
  run(async (vice) => {
    const m = models();
    // Turn north, towards the block across the street, and drive into it.
    let frame = 0;
    for (const [bits, frames] of [[JOY.UP, 15], [JOY.UP | JOY.LEFT, 40], [JOY.UP, 60]])
      for (let i = 0; i < frames; i++) {
        await pass(vice, m, bits, `after ${++frame} frames`);
        assert.equal(hits(m.car.px, m.car.py, m.car.angle >> 8), false, `never inside a wall (${frame})`);
      }
    assert.ok(m.car.py < START[1] + CENTRE_Y - 8, 'it got off the street');
    await assertPicture(vice, m, 'against the wall');
  }));

test('a long random drive: the car and the window follow the model exactly, and every frame is in time', () =>
  run(async (vice) => {
    const m = models();
    let seed = 1987;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16;
    const missed = async () => (await vice.read(L['frame.missed'], 2)).readUInt16LE(0);
    await pass(vice, m, 0, 'first'); // the first frame after start can be missed: count from the second
    const before = await missed();
    let bits = 0;
    for (let frame = 1; frame <= 1500; frame++) {
      if (frame % 12 === 1) bits = [JOY.UP, JOY.UP, JOY.UP | JOY.LEFT, JOY.UP | JOY.RIGHT, JOY.DOWN, 0, JOY.RIGHT | JOY.FIRE, JOY.UP | JOY.FIRE][random() & 7];
      await pass(vice, m, bits, `after ${frame} frames`);
      if (frame % 100 === 0) assert.deepEqual(await screenMismatches(vice, m.cam.x, m.cam.y, L), [], `after ${frame} frames`);
    }
    assert.equal(await missed() - before, 0, 'no frame was late');
    await assertPicture(vice, m, 'at the end');
  }));

test('flat out east along the street: top speed, the window keeps up, and every frame is in time', (t) =>
  run(async (vice) => {
    const m = models();
    const missed = async () => (await vice.read(L['frame.missed'], 2)).readUInt16LE(0);
    await pass(vice, m, 0, 'first'); // the first frame after start can be missed: count from the second
    const before = await missed();
    let latest = 0;
    for (let frame = 1; frame <= 240; frame++) {
      m.car.step(JOY.UP, null, m.cam.busy);
      m.cam.follow(m.car.px, m.car.py);
      await vice.joystick(JOY.UP);
      await vice.runTo(L['frame.publish']);
      latest = Math.max(latest, ((await vice.registers()).LIN - 250 + 312) % 312);
      await vice.runTo(L.ready);
      assert.deepEqual(await readCar(vice), state(m.car), `after ${frame} frames`);
    }
    t.diagnostic(`the busiest pass was ready ${latest} raster lines after the bottom interrupt, of 312`);
    assert.equal(m.car.vx, C.TOP, 'at top speed');
    assert.equal(m.cam.x, m.car.px - CENTRE_X, 'the car is still in the middle of the window');
    assert.equal(await missed() - before, 0, 'no frame was late');
    await assertPicture(vice, m, 'at top speed');
  }));

test('at the south edge of the city the window stops following, and the picture is right with the car low in it', () =>
  run(async (vice) => {
    const m = models();
    // The south edge of the city: the window cannot follow further, so the car comes down towards its bottom.
    // (Not all the way: within the last few pixels the car's sprite would reach the black band, which is an
    // open thread in docs/HANDOVER.md.)
    const street = 97 * 16 - 9; // the bottom row of tiles
    await putCar(vice, m, 600, street - 8, 64);
    assert.equal(m.cam.y, MAX_Y);
    await assertPicture(vice, m, 'at the bottom edge');
  }));

// ---------- the handling's newer rules (the design's "Handling") ----------

test('flat out, steering is held to what the tyres hold: a wider line; the handbrake lets the back go', () =>
  run(async (vice) => {
    const m = models();
    await pass(vice, m, 0, 'first');
    // Along the top street of the city, east, to top speed.
    await putCar(vice, m, 40, 24, 0);
    let frame = 0;
    while (m.car.vx < C.TOP && frame < 300) await pass(vice, m, JOY.UP, `to top speed, ${++frame} frames`);
    assert.equal(m.car.vx, C.TOP, 'flat out');
    // Turning at 4 pixels a frame would ask the tyres for more than their grip: the turn is held to grip / speed,
    // 50 * most_turn[64] / 4 = 500 a frame rather than the 630 it is from 1.1 pixels a frame up.
    const turnFrom = (bits) => {
      const probe = new Car(0, 0);
      Object.assign(probe, { x: m.car.x, y: m.car.y, vx: m.car.vx, vy: m.car.vy, angle: m.car.angle });
      probe.step(bits, null, m.cam.busy);
      return (probe.angle - m.car.angle) & 0xffff;
    };
    assert.equal(turnFrom(JOY.UP | JOY.RIGHT), 500, 'held to the grip');
    assert.equal(turnFrom(JOY.UP | JOY.RIGHT | JOY.FIRE), 630 + (630 >> 2), 'on the handbrake: a quarter more, and no limit');
    const before = m.car.angle;
    await pass(vice, m, JOY.UP | JOY.RIGHT, 'turning flat out');
    assert.equal(m.car.angle - before, 500, 'the program turns the same');
    for (let i = 2; i <= 3; i++) await pass(vice, m, JOY.UP | JOY.RIGHT, `turning flat out, ${i} frames`);
    const speed = Math.hypot(m.car.vx, m.car.vy);
    assert.ok(speed >= 0.97 * C.TOP, `and it keeps its speed round the bend (${Math.round(speed)})`);
    // Slowly, nothing is held: below about 3.2 pixels a frame the turn is the full 630.
    await putCar(vice, m, 40, 24, 0);
    frame = 0;
    while (m.car.vx < 400 && frame < 100) await pass(vice, m, JOY.UP, `slowly, ${++frame} frames`);
    assert.equal(turnFrom(JOY.UP | JOY.RIGHT), 630, 'below the limit');
  }));

test('grass is hard going: on it the car gets up speed more slowly, and it loses speed faster coasting', () =>
  run(async (vice) => {
    const m = models();
    await pass(vice, m, 0, 'first');
    // The longest run of grass in the city: tiles 27-34 of row 3. From its west end, east.
    const x = 27 * 16 + 8, y = 3 * 16 + 8;
    await putCar(vice, m, x, y, 0);
    for (let i = 1; i <= 40; i++) await pass(vice, m, JOY.UP, `on the grass, ${i} frames`);
    assert.ok(m.car.px < 35 * 16, 'still on the grass');
    // The same 40 frames on the road, in the model alone.
    const road = new Car(40, 24);
    for (let i = 0; i < 40; i++) road.step(JOY.UP);
    assert.ok(m.car.vx < road.vx, `slower: ${m.car.vx} on grass against ${road.vx} on the road`);
    // Coasting: the grass takes 1/64 of the speed a frame more than the road.
    const coast = new Car(40, 24);
    Object.assign(coast, { vx: m.car.vx });
    const was = m.car.vx;
    await pass(vice, m, 0, 'coasting on the grass');
    coast.step(0);
    assert.ok(was - m.car.vx > was - coast.vx, `it loses more: ${was - m.car.vx} against ${was - coast.vx}`);
  }));
