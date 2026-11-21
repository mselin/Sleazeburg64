// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the player on foot and of getting in and out of cars: the real program in VICE, held
// frame by frame to the models (play.mjs steps them all together), and its picture compared pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { MAP_PIXELS, MAX_Y, PLAYER_FRAMES, PLAYER_FRAME_COUNT, PLAYER_SPRITE, assemble, assets, expectedReadout, readPanel, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar, putOnFoot, putTrafficCar } from './play.mjs';
import { F, blocked, kindAt } from './foot-model.mjs';
import { T } from './traffic-model.mjs';

// No traffic of its own and no Big Honk: the tests put cars where they want them.
const game = assemble('foot', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const WATER = 3; // a tile's kind
const HINT_CAR = 'FIRE: HANDBRAKE. STANDING STILL: GET OUT', HINT_FOOT = 'STAND BY A CAR AND PRESS FIRE TO GET IN';
const hint = async (vice) => (await readPanel(vice))[2];

/** Run `body` on a freshly started game with its models, having checked the first pass. */
const run = (body, prg = game, options = { honk: false, traffic: { spawn: false } }) =>
  withProgram(prg.prg, async (vice) => {
    await vice.runTo(prg.labels.ready);
    const w = new World(options);
    await pass(vice, prg.labels, w, 0, 'first'); // the first frame after start can be missed: count from the second
    await body(vice, w);
  });

/** Passes with the stick held one way. */
async function hold(vice, w, bits, frames, what, labels = L) {
  for (let i = 1; i <= frames; i++) await pass(vice, labels, w, bits, `${what}, frame ${i}`);
}

/** Press fire with the stick centred: a pass with it up, one with it down. */
async function press(vice, w, what, labels = L) {
  await pass(vice, labels, w, 0, `before ${what}`);
  await pass(vice, labels, w, JOY.FIRE, what);
}

/** Give the program the passes it needs to draw a window it was moved to, then count late frames from there. */
async function settle(vice, w) {
  await hold(vice, w, 0, 3, 'settling');
  const before = await missed(vice, L);
  return async () => (await missed(vice, L)) - before;
}

test('the player\'s 42 frames are made at start from the twelve in the program file, as tools/assets.mjs draws them', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const made = await vice.read(PLAYER_FRAMES, PLAYER_FRAME_COUNT * 64);
    for (let n = 0; n < PLAYER_FRAME_COUNT; n++)
      assert.deepEqual([...made.subarray(n * 64, n * 64 + 64)], [...assets.player.subarray(n * 64, n * 64 + 64)], `frame ${n}`);
    assert.ok(L.code_end <= PLAYER_FRAMES, 'the code ends before them');
    const stored = L['frames.player_made'] - L['frames.player_data'];
    assert.equal(stored, 12 * 64, 'twelve frames in the file');
  }));

test('fire with the stick centred gets out of a slow car and back in; held from the start, held on, or with a direction, it does not', () =>
  run(async (vice, w) => {
    const before = await missed(vice, L);
    assert.equal(await hint(vice), HINT_CAR);
    // With a direction it is the handbrake.
    await hold(vice, w, JOY.FIRE | JOY.LEFT, 2, 'fire and left');
    await hold(vice, w, 0, 2, 'nothing');
    assert.equal(w.player.on, 0, 'still in the car');
    await pass(vice, L, w, JOY.FIRE, 'fire');
    assert.equal(w.player.on, 1, 'out');
    assert.deepEqual([w.player.px, w.player.py], [w.car.px, w.car.py + 12], '12 pixels to the right of a car facing east');
    assert.equal(w.player.face, 0, 'facing as the car does');
    const place = w.traffic.n - 1;
    assert.equal(w.traffic.mine, place, 'the car is in the place kept for it');
    const left = w.traffic.cars[place];
    assert.deepEqual([left.on, left.px, left.py, left.wreck, left.sp, left.col, left.face], [1, w.car.px, w.car.py, 1, 0, 2, 0], 'standing where it was, red, with no driver');
    assert.equal(await hint(vice), HINT_FOOT);
    await assertPicture(vice, L, w, 'out of the car', JOY.FIRE);
    await hold(vice, w, JOY.FIRE, 5, 'fire still held');
    assert.equal(w.player.on, 1, 'held on, it does nothing more');
    await press(vice, w, 'fire again');
    assert.equal(w.player.on, 0, 'back in');
    assert.equal(w.traffic.mine, 0xff);
    assert.equal(w.traffic.cars.some((c) => c.on), false, 'and the car is the player\'s again, out of the traffic\'s tables');
    assert.equal(await hint(vice), HINT_CAR);
    await assertPicture(vice, L, w, 'back in the car', JOY.UP);
    await hold(vice, w, JOY.UP, 30, 'driving off');
    assert.ok(w.car.vx > 400, 'and it drives');
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('fire held when the game starts, as when it was started with fire, does nothing until it is let go', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    for (let i = 1; i <= 6; i++) await pass(vice, L, w, JOY.FIRE, `fire held from the start, frame ${i}`);
    assert.equal(w.player.on, 0, 'still in the car');
    await press(vice, w, 'let go and pressed');
    assert.equal(w.player.on, 1, 'out');
  }));

test('a car going faster than 0.9 pixels a frame cannot be left: fire is only the handbrake until it has slowed', () =>
  run(async (vice, w) => {
    await hold(vice, w, JOY.UP, 40, 'speeding up');
    assert.ok(w.car.vx > 600);
    let tooFast = 0, frame = 0;
    while (!w.player.on && frame++ < 200) {
      const speed = Math.max(Math.abs(w.car.vx), Math.abs(w.car.vy));
      await press(vice, w, `fire at speed ${speed}`);
      if (!w.player.on) tooFast++;
    }
    assert.equal(w.player.on, 1, 'out in the end');
    assert.ok(tooFast > 3, `fire did nothing while it was too fast (${tooFast} times)`);
    const left = w.traffic.cars[w.traffic.mine];
    assert.equal(left.px, w.car.px, 'the car stopped where the player left it');
  }));

test('walking eight ways: the model\'s pace frame by frame, every pose of the walk, and every picture right', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    const before = await missed(vice, L);
    const ways = [[JOY.RIGHT, 0], [JOY.RIGHT | JOY.DOWN, 1], [JOY.DOWN, 2], [JOY.DOWN | JOY.LEFT, 3], [JOY.LEFT, 4], [JOY.LEFT | JOY.UP, 5], [JOY.UP, 6], [JOY.UP | JOY.RIGHT, 7]];
    // North first, to the middle of the street, where there is room to walk every way.
    await hold(vice, w, JOY.UP, 20, 'north');
    for (const [bits, face] of ways) {
      const x0 = w.player.x, y0 = w.player.y, poses = new Set();
      for (let i = 1; i <= 12; i++) {
        await pass(vice, L, w, bits, `way ${face}, frame ${i}`);
        poses.add((w.player.pointer(0) - PLAYER_SPRITE) % 5);
        assert.equal(Math.floor((w.player.pointer(0) - PLAYER_SPRITE) / 5), face, 'drawn facing the way they walk');
        if (i === 3 || i === 9) await assertPicture(vice, L, w, `way ${face}, frame ${i}`, bits);
      }
      const far = face & 1 ? F.WALK_DIAGONAL : F.WALK;
      assert.deepEqual([Math.abs(w.player.x - x0), Math.abs(w.player.y - y0)].sort((a, b) => b - a), [12 * far, face & 1 ? 12 * far : 0], `58 pixels a second, way ${face}`);
      assert.deepEqual([...poses].sort(), [0, 1, 2, 3, 4], `all five poses, way ${face}`);
      await pass(vice, L, w, 0, 'standing');
      assert.equal(w.player.pointer(0), PLAYER_SPRITE + face * 5 + 2, 'standing still is the middle pose, still facing that way');
    }
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('opposite directions together are no direction, and three are the odd one out', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    const at = () => [w.player.x, w.player.y];
    const start = at();
    await hold(vice, w, JOY.LEFT | JOY.RIGHT, 5, 'left and right');
    await hold(vice, w, JOY.UP | JOY.DOWN, 5, 'up and down');
    assert.deepEqual(at(), start, 'nowhere');
    await hold(vice, w, JOY.UP | JOY.LEFT | JOY.RIGHT, 5, 'up, left and right');
    assert.deepEqual(at(), [start[0], start[1] - 5 * F.WALK], 'north');
  }));

test('walls stop the player one axis at a time: they slide along a building, and cannot walk into it', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    await hold(vice, w, JOY.DOWN, 40, 'south, to the building');
    const y = w.player.py;
    assert.equal(blocked(w.player.px, y + 1), true, 'as near the wall as they fit');
    assert.equal(blocked(w.player.px, y), false);
    const x = w.player.px;
    await hold(vice, w, JOY.DOWN | JOY.RIGHT, 30, 'south-east, along it');
    assert.equal(w.player.py, y, 'no nearer');
    assert.equal(w.player.x - (x << 8) >= 30 * F.WALK_DIAGONAL - 256, true, 'but along it, at the diagonal\'s pace');
    await assertPicture(vice, L, w, 'against the wall');
  }));

test('the edges of the city: the corner, the east edge, and the south edge 11 pixels short, with the picture right there', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    await pass(vice, L, w, 0, 'out');
    await putOnFoot(vice, L, w, 20, 20, 5);
    let late = await settle(vice, w);
    await hold(vice, w, JOY.UP | JOY.LEFT, 40, 'north-west, into the corner');
    assert.deepEqual([w.player.px, w.player.py], [3, 3], 'three pixels from each edge: their footprint');
    await assertPicture(vice, L, w, 'in the north-west corner');
    assert.equal(await late(), 0, 'no frame was late');
    await pass(vice, L, w, 0, 'standing');
    await putOnFoot(vice, L, w, MAP_PIXELS - 20, 300, 0);
    late = await settle(vice, w);
    await hold(vice, w, JOY.RIGHT, 30, 'east');
    assert.equal(w.player.px, MAP_PIXELS - 4);
    await assertPicture(vice, L, w, 'at the east edge');
    await pass(vice, L, w, 0, 'standing');
    await putOnFoot(vice, L, w, 600, MAP_PIXELS - 30, 2);
    late = await settle(vice, w);
    await hold(vice, w, JOY.DOWN, 40, 'south');
    assert.equal(w.player.py, F.SOUTH, 'as far south as they go');
    assert.equal(w.cam.y, MAX_Y, 'with the window as far south as it goes');
    assert.equal(w.player.py - w.cam.y + 55 - 10 + 21, 216, 'their sprite ends on the city\'s last line, above the black band');
    await assertPicture(vice, L, w, 'at the south edge', JOY.DOWN | JOY.LEFT);
    await hold(vice, w, JOY.DOWN | JOY.LEFT, 20, 'south-west, along the edge');
    assert.equal(w.player.py, F.SOUTH);
    await assertPicture(vice, L, w, 'walking along the south edge');
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('in the water the player swims: slower, and drawn as a swimmer, in two pictures that take turns', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    await pass(vice, L, w, 0, 'out');
    // West of the fountain in the plaza near the start.
    await putOnFoot(vice, L, w, 88, 112, 0);
    const late = await settle(vice, w);
    assert.equal(kindAt(88, 112), 0);
    assert.equal(kindAt(100, 112), WATER, 'the fountain');
    await hold(vice, w, JOY.RIGHT, 12, 'east, into it');
    assert.equal(w.player.swim, 1, 'swimming');
    const x0 = w.player.x;
    await hold(vice, w, JOY.RIGHT, 10, 'swimming east');
    assert.equal(w.player.x - x0, 10 * F.SWIM, '22 pixels a second');
    const y0 = w.player.y;
    await hold(vice, w, JOY.RIGHT | JOY.DOWN, 10, 'swimming south-east');
    assert.equal(w.player.y - y0, 10 * F.SWIM_DIAGONAL);
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      seen.add(w.player.pointer(w.traffic.tick));
      await assertPicture(vice, L, w, `swimming, picture ${i + 1}`);
      await hold(vice, w, 0, 16, 'treading water');
    }
    assert.deepEqual([...seen].sort(), [PLAYER_SPRITE + 40, PLAYER_SPRITE + 41], 'both pictures');
    await hold(vice, w, JOY.LEFT, 80, 'back out west');
    assert.equal(w.player.swim, 0, 'on land again');
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('getting into a passing car: only within reach, and then it is the player\'s as it was: place, facing, speed and colour', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    // Away from their own car, to stand by the eastbound lane, 12 pixels north of its line.
    await hold(vice, w, JOY.LEFT, 52, 'west');
    await hold(vice, w, JOY.UP, 13, 'north');
    const lane = 192 + 24;
    assert.equal(w.player.py, lane - 12);
    const before = await missed(vice, L);
    const c = await putTrafficCar(vice, L, w, 0, { x: w.player.px - 90, y: lane, dir: 0, cruise: 150, col: 5 });
    await hold(vice, w, 0, 20, 'the car coming');
    assert.equal(w.player.reach(w.traffic), -1, 'out of reach');
    await press(vice, w, 'fire, too soon');
    assert.equal(w.player.on, 1, 'nothing happens');
    let frame = 0;
    while (w.player.reach(w.traffic) < 0 && frame++ < 100) await pass(vice, L, w, 0, `waiting for it, ${frame}`);
    assert.equal(w.player.reach(w.traffic), 0, 'within reach');
    assert.equal(c.sp, 150, 'it did not stop for someone beside its lane');
    const [x, y] = [c.x, c.y];
    await pass(vice, L, w, JOY.FIRE, 'fire');
    assert.equal(w.player.on, 0, 'in');
    assert.equal(w.traffic.cars[0].on, 0, 'out of the traffic\'s tables');
    assert.equal(w.car.colour, 5, 'green, as it was');
    assert.equal(w.car.angle, 0, 'facing east');
    assert.ok(w.car.x >= x && w.car.y === y && w.car.vx === 300, `where it was, at its speed (${w.car.vx})`);
    assert.equal(w.traffic.mine, w.traffic.n - 1, 'the car they left is still theirs');
    await assertPicture(vice, L, w, 'in the green car, the red one left behind', JOY.UP);
    await hold(vice, w, JOY.UP, 20, 'driving on');
    assert.ok(w.car.vx > 300, 'it drives, from the speed it had');
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('of two cars within reach the nearer is taken', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    await hold(vice, w, JOY.LEFT, 60, 'west, away from their own car');
    const { px, py } = w.player;
    await putTrafficCar(vice, L, w, 0, { x: px + 12, y: py - 8, dir: 0, cruise: 0, col: 7, wreck: 1 });
    await putTrafficCar(vice, L, w, 1, { x: px - 9, y: py - 8, dir: 2, cruise: 0, col: 3, wreck: 1 });
    await putTrafficCar(vice, L, w, 2, { x: px + 19, y: py, dir: 0, cruise: 0, col: 4, wreck: 1 });
    assert.equal(w.player.reach(w.traffic), 1);
    await press(vice, w, 'fire');
    assert.equal(w.player.on, 0);
    assert.equal(w.car.colour, 3, 'the cyan one, 12 pixels away, not the yellow one at 14 or the purple one at 19');
    assert.equal(w.car.angle, 0x8000, 'facing west as it did');
    await assertPicture(vice, L, w, 'in the cyan car');
  }));

test('getting out by a wall: to the left when the right is blocked, behind or in front when both are, and not at all with nowhere to stand', () =>
  run(async (vice, w) => {
    const cases = [
      ['to the left', 301, 40, 0, [0, -12]],
      ['behind', 541, 132, 0, [-18, 0]],
      ['in front, facing west', 685, 276, 0x8000, [-18, 0]],
    ];
    for (const [what, x, y, angle, [dx, dy]] of cases) {
      await putCar(vice, L, w, x, y, angle);
      await hold(vice, w, 0, 3, `the car put ${what}`);
      await press(vice, w, `fire, ${what}`);
      assert.equal(w.player.on, 1, `out ${what}`);
      assert.deepEqual([w.player.px, w.player.py], [x + dx, y + dy], what);
      await assertPicture(vice, L, w, `out ${what}`);
      await press(vice, w, 'back in');
      assert.equal(w.player.on, 0);
    }
    // In the middle of a building, where the tests can put it and driving cannot: nowhere to stand.
    await putCar(vice, L, w, 319, 57, 0);
    await hold(vice, w, 0, 3, 'the car put in a building');
    assert.equal(w.player.spot(), null);
    await press(vice, w, 'fire');
    assert.equal(w.player.on, 0, 'they stay in');
  }));

test('a car left at an angle stays at that angle, and the player faces the way it did, to the nearest eighth of a turn', () =>
  run(async (vice, w) => {
    // In the middle of the crossing west of the start, where there is room, facing south-south-east.
    await putCar(vice, L, w, 208, 208, 0x2400);
    await hold(vice, w, 0, 3, 'the car put at an angle');
    await press(vice, w, 'getting out');
    assert.equal(w.player.on, 1);
    const left = w.traffic.cars[w.traffic.mine];
    assert.equal(left.face, 2, 'the car\'s picture: south-east');
    assert.equal(w.player.face, 1, 'the player: south-east');
    assert.deepEqual([w.player.px - 208, w.player.py - 208], [-8, 8], '12 pixels to its right');
    await hold(vice, w, 0, 20, 'standing by it');
    assert.equal(left.face, 2, 'it has not turned');
    await assertPicture(vice, L, w, 'beside the car at an angle');
  }));

test('someone inside a wall may always walk, so that they can leave it', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    await pass(vice, L, w, 0, 'out');
    await putOnFoot(vice, L, w, 319, 160, 0); // in a building, where the tests can put them and walking cannot
    await hold(vice, w, 0, 3, 'put in a building');
    assert.equal(blocked(w.player.px, w.player.py), true);
    let frames = 0;
    while (blocked(w.player.px, w.player.py) && frames++ < 100) await pass(vice, L, w, JOY.DOWN, `walking out, frame ${frames}`);
    assert.equal(blocked(w.player.px, w.player.py), false, `out after ${frames} frames`);
    const y = w.player.py;
    await hold(vice, w, JOY.UP, 10, 'back at the wall');
    assert.ok(w.player.py >= y - 1, 'and not back in');
  }));

test('with every place in the traffic\'s tables taken, which play never does, the player stays in the car', () =>
  run(async (vice, w) => {
    for (let i = 0; i < w.traffic.n; i++) await putTrafficCar(vice, L, w, i, { x: 200 + 30 * i, y: 300, dir: 0, cruise: 0, wreck: 1 });
    await press(vice, w, 'fire');
    assert.equal(w.traffic.cars.every((c) => c.on), true, 'all seven places taken');
    assert.equal(w.player.on, 0);
  }));

test('the car left last stays however far the player goes; one left before it goes when it is far away', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out of the red car');
    const red = w.traffic.mine;
    await pass(vice, L, w, 0, 'out');
    await putOnFoot(vice, L, w, 296 + 520, 208, 0); // along the street, further than cars are kept
    await hold(vice, w, 0, 12, 'far away');
    assert.equal(w.traffic.cars[red].on, 1, 'it is still there');
    // Another car, left here by nobody: get in, drive a little, get out.
    await putTrafficCar(vice, L, w, 0, { x: w.player.px + 10, y: w.player.py, dir: 0, cruise: 0, col: 14, wreck: 1 });
    await press(vice, w, 'getting into the blue car');
    assert.equal(w.car.colour, 14);
    assert.equal(w.traffic.mine, red, 'the red car is still the one left last');
    await hold(vice, w, JOY.UP, 12, 'driving');
    await hold(vice, w, 0, 2, 'coasting');
    await hold(vice, w, JOY.FIRE | JOY.LEFT, 30, 'stopping, on the handbrake');
    await press(vice, w, 'getting out of the blue car');
    assert.equal(w.player.on, 1);
    const blue = w.traffic.mine;
    assert.notEqual(blue, red);
    assert.equal(w.traffic.cars[blue].col, 14, 'the blue car is the one left last now');
    await hold(vice, w, 0, 12, 'standing by it');
    assert.equal(w.traffic.cars[red].on, 0, 'and the red one, far away, has gone');
    assert.equal(w.traffic.cars[blue].on, 1);
  }));

test('traffic stops for the player standing in its lane, waits, then gives up waiting and drives on', () =>
  run(async (vice, w) => {
    await press(vice, w, 'getting out');
    await hold(vice, w, JOY.LEFT, 52, 'west');
    await hold(vice, w, JOY.UP, 3, 'north, onto the lane');
    const lane = 192 + 24;
    assert.ok(Math.abs(w.player.py - lane) <= T.SIDE, 'in the eastbound lane');
    const c = await putTrafficCar(vice, L, w, 0, { x: w.player.px - 120, y: lane, dir: 0, cruise: 150 });
    let stoppedAt = null, waited = 0;
    for (let frame = 1; frame <= 400 && c.px < w.player.px + 30; frame++) {
      await pass(vice, L, w, 0, `after ${frame} frames`);
      if (c.sp === 0) {
        stoppedAt ??= w.player.px - c.px;
        waited++;
      }
      if (frame === 150) await assertPicture(vice, L, w, 'with the car waiting');
    }
    assert.ok(stoppedAt >= T.AHEAD_MIN && stoppedAt <= T.AHEAD_MAX, `it stopped ${stoppedAt} pixels short`);
    assert.ok(waited >= T.HELD - 10, `it waited ${waited} frames`);
    assert.ok(c.px >= w.player.px + 30, 'and then drove on');
  }));

test('the panel says where the window is in a build with the car too', () =>
  run(async (vice, w) => {
    assert.equal((await readPanel(vice))[1], expectedReadout(w.cam.x, w.cam.y));
    const seen = new Set();
    for (let frame = 1; frame <= 120; frame++) {
      await pass(vice, L, w, frame < 60 ? JOY.UP : JOY.UP | JOY.RIGHT, `driving, frame ${frame}`);
      const row = (await readPanel(vice))[1];
      assert.equal(row, expectedReadout(w.cam.x, w.cam.y), `after ${frame} frames`);
      seen.add(row);
    }
    assert.ok(seen.size > 8, `it changed as the window moved (${seen.size} readouts)`);
  }));

// ---------- everything at once ----------
// The whole game as built: traffic that comes and goes, and Big Honk.
const whole = assemble('foot-whole');
const W = whole.labels;

test('a long session with traffic and Big Honk: driving, stopping, getting out, wandering, coming back, getting in', (t) =>
  run(async (vice, w) => {
    const before = await missed(vice, W);
    let seed = 2026, frame = 0, outs = 0, ins = 0, most = 0, pick = 0;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16;
    const go = async (bits, what) => {
      frame++;
      if (frame % 50 === 0) await assertPicture(vice, W, w, `after ${frame - 1} frames`, bits);
      const was = w.player.on;
      await pass(vice, W, w, bits, `${what}, frame ${frame}`);
      if (w.player.on && !was) outs++;
      if (was && !w.player.on) ins++;
      const on = w.traffic.cars.filter((c) => c.on).length;
      most = Math.max(most, on);
      if (!w.player.on) assert.ok(on < w.traffic.n, 'in a car, a place in the tables is free for it');
    };
    const DRIVE = [JOY.UP, JOY.UP, JOY.UP | JOY.LEFT, JOY.UP | JOY.RIGHT, JOY.DOWN, 0, JOY.RIGHT | JOY.FIRE, JOY.UP | JOY.FIRE];
    const WALK = [JOY.UP, JOY.DOWN, JOY.LEFT, JOY.RIGHT, JOY.UP | JOY.LEFT, JOY.DOWN | JOY.RIGHT, 0, JOY.FIRE];
    for (let round = 1; round <= 5; round++) {
      for (let i = 0; i < 130; i++) {
        if (i % 12 === 0) pick = random();
        await go(DRIVE[pick & 7], `round ${round}, driving`);
      }
      // Handbrake to a stop (the press that starts it finds the car too fast, or lets them out at once), then out.
      for (let i = 0; i < 60 && !w.player.on; i++) await go(JOY.FIRE, `round ${round}, stopping`);
      for (let i = 0; i < 6 && !w.player.on; i++) await go(i & 1 ? JOY.FIRE : 0, `round ${round}, getting out`);
      assert.equal(w.player.on, 1, `round ${round}: out of the car`);
      const mine = w.traffic.mine;
      for (let i = 0; i < 70; i++) {
        if (i % 10 === 0) pick = random();
        await go(WALK[pick & 7], `round ${round}, wandering`);
      }
      if (!w.player.on) continue; // a press of fire by a car while wandering: back in already
      // Back to the car they left, steering by where it is, and in.
      const car = w.traffic.cars[w.traffic.mine];
      assert.equal(w.traffic.mine, mine);
      for (let i = 0; i < 400 && w.player.reach(w.traffic) < 0; i++) {
        const dx = car.px - w.player.px, dy = car.py - w.player.py;
        const bits = (dx > 2 ? JOY.RIGHT : dx < -2 ? JOY.LEFT : 0) | (dy > 2 ? JOY.DOWN : dy < -2 ? JOY.UP : 0);
        await go(bits, `round ${round}, walking back`);
      }
      for (let i = 0; i < 4 && w.player.on; i++) await go(i & 1 ? JOY.FIRE : 0, `round ${round}, getting in`);
      assert.equal(w.player.on, 0, `round ${round}: back in a car`);
    }
    assert.ok(outs >= 5 && ins >= 5, `out ${outs} times and in ${ins}`);
    assert.ok(most >= w.traffic.limit, `there was traffic: ${most} cars at once at most, the one left among them`);
    assert.equal(await missed(vice, W) - before, 0, 'no frame was late');
    t.diagnostic(`${frame} frames, out of the car ${outs} times and in ${ins}, ${most} cars at once at most`);
  }, whole, {}));
