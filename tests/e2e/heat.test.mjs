// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of heat (status.add_heat, status.cooling in src/status.asm): the crimes the game has so far
// adding the design's points, the level and its stars from them, the message for a new level, and cooling a
// level every 9 seconds with no police about. The real program in VICE, with the models (play.mjs) held to it
// frame by frame as everywhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { assemble, readPanel, withProgram } from './game.mjs';
import { World, pass, putCar, putOnFoot, putTrafficCar } from './play.mjs';
import { P, putPerson } from './people-model.mjs';

const game = assemble('heat', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const COOL = 9 * 50;

const run = (body) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, L, w, 0, 'first');
    await body(vice, w);
  });
async function hold(vice, w, bits, frames, what) {
  for (let i = 1; i <= frames; i++) await pass(vice, L, w, bits, `${what}, frame ${i}`);
}
/** Heat: points (the program keeps halves), the level, and frames before it cools. */
async function heat(vice) {
  const [lo, hi] = await vice.read(L['status.points'], 2), [level] = await vice.read(L['status.heat'], 1);
  const [cl, ch] = await vice.read(L['status.cool'], 2);
  return { points: (lo | (hi << 8)) / 2, level, cool: cl | (ch << 8) };
}

test('punches that land add 3 heat each; at 8 the first level comes, with its message; then it cools a level in 9 seconds', () =>
  run(async (vice, w) => {
    assert.deepEqual(await heat(vice), { points: 0, level: 0, cool: (await heat(vice)).cool }, 'none at the start');
    await putOnFoot(vice, L, w, 40, 150, 6);
    await hold(vice, w, 0, 3, 'put on the pavement');
    // A miss: the arm goes out, but no heat.
    await pass(vice, L, w, JOY.FIRE, 'a punch at nobody');
    assert.equal((await heat(vice)).points, 0, 'a miss is no crime');
    for (let n = 1; n <= 3; n++) {
      await hold(vice, w, 0, P.PUNCH_WAIT, `waiting, punch ${n}`);
      await putPerson(vice, L, w.people, 3 - n, { x: 40, y: 150 - P.PUNCH_REACH, way: 1, spd: 0, col: 3, wait: 255 });
      await pass(vice, L, w, JOY.FIRE, `punch ${n}`);
      assert.equal((await heat(vice)).points, 3 * n, `${3 * n} heat after ${n} punches`);
    }
    let h = await heat(vice);
    assert.equal(h.level, 1, 'level 1 from 8');
    assert.equal(h.cool, COOL - 1, 'the time to cool counted afresh (and down once in the frame of the punch)');
    await hold(vice, w, 0, 2, 'the message');
    assert.equal((await readPanel(vice))[2], 'A STERN LETTER IS BEING DRAFTED', 'and it says so');
    // Nine seconds on, with nothing more: down a level, to its start (level 0: nothing).
    await hold(vice, w, 0, COOL - 4, 'cooling');
    assert.equal((await heat(vice)).level, 1, 'not yet');
    await pass(vice, L, w, 0, 'cooled');
    h = await heat(vice);
    assert.equal(h.level, 0);
    assert.equal(h.points, 0);
  }));

test('running someone over adds 6 heat, and taking a car from its driver 4; a car left standing, none', () =>
  run(async (vice, w) => {
    // On the street at the top of the city, facing east, someone in the road ahead.
    await putCar(vice, L, w, 200, 24, 0);
    await hold(vice, w, 0, 3, 'put there');
    const p = await putPerson(vice, L, w.people, 2, { x: 290, y: 24, way: 1, spd: 0, col: 4, wait: 255 });
    for (let i = 1; i <= 120 && !p.down; i++) await pass(vice, L, w, JOY.UP, `driving at them, ${i} frames`);
    assert.equal(p.down, P.DOWN_TIME, 'run over');
    await pass(vice, L, w, JOY.DOWN, 'braking');
    assert.equal((await heat(vice)).points, 6, 'a kill: 6');
    // Out, then into a car with its driver, put where they stand (the nearest): 4 more. Then out of it and
    // back in, a car left standing now: none.
    for (let i = 1; i <= 100 && w.car.vx > 120; i++) await pass(vice, L, w, JOY.DOWN, `slowing, ${i} frames`);
    await pass(vice, L, w, 0, 'slow enough to get out');
    await pass(vice, L, w, JOY.FIRE, 'out');
    assert.equal(w.player.on, 1);
    await pass(vice, L, w, 0, 'let go');
    await putTrafficCar(vice, L, w, 1, { x: w.player.px, y: w.player.py, dir: 0, cruise: 150 });
    await pass(vice, L, w, JOY.FIRE, 'into a car with its driver');
    assert.equal(w.player.on, 0, 'in');
    assert.equal((await heat(vice)).points, 10, 'taken from its driver: 4');
    for (let i = 1; i <= 100 && Math.abs(w.car.vx) > 120; i++) await pass(vice, L, w, JOY.DOWN, `slowing, ${i} frames`);
    await pass(vice, L, w, 0, 'slow enough to get out');
    await pass(vice, L, w, JOY.FIRE, 'out of it');
    assert.equal(w.player.on, 1);
    await pass(vice, L, w, 0, 'let go');
    await pass(vice, L, w, JOY.FIRE, 'back into it, left standing');
    assert.equal(w.player.on, 0, 'in');
    assert.equal((await heat(vice)).points, 10, 'nobody to take it from: no heat');
  }));
