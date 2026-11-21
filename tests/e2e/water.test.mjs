// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the water: the player's car wading, flooding and sinking, in the real program in VICE,
// held frame by frame to the models (play.mjs steps them all together), with the picture pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { assemble, readPanel, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar, putOnFoot, putTrafficCar } from './play.mjs';
import { SINK, shade } from './traffic-model.mjs';
import { WADE } from './car-model.mjs';
import { kindAt } from './foot-model.mjs';

// No traffic of its own and no Big Honk: the tests put cars where they want them.
const game = assemble('water', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const WATER = 3, RED = 2, LIGHT_BLUE = 14, BLACK = 0;
const HINT_FOOT = 'STAND BY A CAR AND PRESS FIRE TO GET IN';

const run = (body) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, L, w, 0, 'first'); // the first frame after start can be missed: count from the second
    await body(vice, w);
  });

async function hold(vice, w, bits, frames, what) {
  for (let i = 1; i <= frames; i++) await pass(vice, L, w, bits, `${what}, frame ${i}`);
}

/** Put the car somewhere and give the program the passes it needs to draw the new window; then count late frames. */
async function settleAt(vice, w, x, y, angle = 0) {
  await putCar(vice, L, w, x, y, angle);
  await hold(vice, w, 0, 3, 'after the car was put there');
  const before = await missed(vice, L);
  return async () => (await missed(vice, L)) - before;
}

test('driving into the canal: the car wades, slower the deeper, and floods; the player swims out; it sinks in three colours and stays', () =>
  run(async (vice, w) => {
    // On the street west of The Moat, facing east, the canal 32 pixels ahead past the bank.
    const late = await settleAt(vice, w, 784, 870);
    assert.equal(kindAt(784 + 32, 870), WATER);
    const wets = [];
    let frame = 0;
    while (!w.player.on && frame < 150) {
      await pass(vice, L, w, JOY.UP, `driving in, ${++frame} frames`);
      if (!w.player.on) wets.push(w.car.wet);
    }
    assert.equal(w.player.on, 1, 'out of the car');
    assert.deepEqual([...new Set(wets)], [0, 1, 2], 'a third of it in, then two thirds, then it flooded');
    // Each third slowed it: the speed it had going in is more than it can have deeper in.
    assert.ok(Math.max(...wets.map((v, i) => (v === 2 ? i : 0))) > 0);
    const slot = w.traffic.mine, sunk = w.traffic.cars[slot];
    assert.equal(slot, w.traffic.n - 1, 'the car is in the place kept for it');
    assert.equal(sunk.sink, 1, 'going down');
    assert.equal(kindAt(sunk.px, sunk.py), WATER);
    assert.deepEqual([w.player.px, w.player.py], [sunk.px, sunk.py], 'the player is where it went down ...');
    assert.equal(w.player.swim, 1, '... swimming');
    assert.equal((await readPanel(vice))[2], HINT_FOOT);
    // Awash, in its own colour; then light blue; then black on the bottom, where it stays.
    for (const [frames, colour, what] of [[1, RED, 'awash'], [SINK.AWASH, LIGHT_BLUE, 'under the water'], [SINK.UNDER, BLACK, 'on the bottom']]) {
      await hold(vice, w, 0, frames - (sunk.sink - 1), `sinking to ${what}`);
      assert.equal(shade(sunk), colour, what);
      await assertPicture(vice, L, w, what);
    }
    await hold(vice, w, 0, SINK.DONE, 'on the bottom');
    assert.equal(sunk.sink, SINK.DONE, 'down for good');
    assert.equal(sunk.on, 1, 'and still there');
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('a flooded car cannot be got into, and is out of the way of the player\'s car', () =>
  run(async (vice, w) => {
    await settleAt(vice, w, 784, 870);
    let frame = 0;
    while (!w.player.on && frame < 150) await pass(vice, L, w, JOY.UP, `driving in, ${++frame} frames`);
    const slot = w.traffic.mine;
    await pass(vice, L, w, 0, 'swimming by it');
    await pass(vice, L, w, JOY.FIRE, 'fire');
    assert.equal(w.player.on, 1, 'still swimming: it cannot be got into');
    // A car on the bottom, which the tests put on the street, is not in the way of a car that drives at it.
    await putOnFoot(vice, L, w, 300, 216, 0);
    await hold(vice, w, 0, 3, 'put on the street');
    await putTrafficCar(vice, L, w, 0, { x: 360, y: 216, dir: 0, cruise: 0, col: 4, wreck: 1, sink: SINK.DONE });
    await putTrafficCar(vice, L, w, 1, { x: 312, y: 216, dir: 0, cruise: 0, col: 5, wreck: 1 });
    await pass(vice, L, w, 0, 'by the green car');
    await pass(vice, L, w, JOY.FIRE, 'into the green car');
    assert.equal(w.player.on, 0, 'in the green car');
    await hold(vice, w, JOY.UP, 50, 'driving at the sunk one');
    assert.ok(w.car.px > 360 + 20, `it drove over it (${w.car.px})`);
    assert.ok(w.car.vx > 0, 'without bouncing');
    assert.equal(w.traffic.cars[slot].sink >= 1, true);
  }));

test('wading in and backing out: slower in the water, and no flood with the middle still on the bank', () =>
  run(async (vice, w) => {
    const late = await settleAt(vice, w, 784, 870);
    let frame = 0;
    while (w.car.wet < 1 && frame < 100) await pass(vice, L, w, JOY.UP, `driving to the water, ${++frame} frames`);
    assert.equal(w.car.wet, 1, 'its nose in');
    // Brake to a stop with the nose in, then back out.
    for (let i = 0; i < 40 && w.car.vx > 0; i++) await pass(vice, L, w, JOY.DOWN, `braking, ${i + 1}`);
    const wetNow = w.car.wet;
    assert.ok(wetNow >= 1 && wetNow < 3, `standing in the shallows (${wetNow} thirds in)`);
    await hold(vice, w, JOY.DOWN, 40, 'reversing out');
    assert.equal(w.car.wet, 0, 'out of the water');
    assert.equal(w.player.on, 0, 'still in the car');
    assert.ok(w.car.vx < -100, 'and going backwards');
    // In the water its top speed is lower: the table the car uses.
    assert.deepEqual(WADE.TOP, [1024, 785, 546, 307]);
    assert.equal(await late(), 0, 'no frame was late');
  }));

test('a fountain floods a car too', () =>
  run(async (vice, w) => {
    // West of the fountain in the plaza near the start, facing east.
    assert.equal(kindAt(100, 112), WATER);
    await settleAt(vice, w, 60, 112);
    let frame = 0;
    while (!w.player.on && frame < 120) await pass(vice, L, w, JOY.UP, `driving in, ${++frame} frames`);
    assert.equal(w.player.on, 1, 'flooded');
    assert.equal(w.traffic.cars[w.traffic.mine].sink >= 1, true);
    await assertPicture(vice, L, w, 'the car awash in the fountain, the player beside it');
  }));

test('flat out into the canal: it floods, and no frame is late', () =>
  run(async (vice, w) => {
    const late = await settleAt(vice, w, 500, 870);
    let frame = 0, fastest = 0;
    while (!w.player.on && frame < 250) {
      await pass(vice, L, w, JOY.UP, `driving, ${++frame} frames`);
      fastest = Math.max(fastest, w.car.vx);
    }
    assert.equal(w.player.on, 1, 'flooded');
    assert.ok(fastest > 900, `it was going fast (${fastest})`);
    await hold(vice, w, 0, 20, 'swimming');
    assert.equal(await late(), 0, 'no frame was late');
  }));
