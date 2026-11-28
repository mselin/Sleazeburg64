// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the riders (src/people.asm), by the difficulty: on classic, where a visit starts, skaters
// in a light grey hoodie at 46 pixels a second; on modern, scooter riders in light green at the scooter's speed.
// Either stands on the board or the deck the way they go, lies beside it when knocked down, and drops nothing
// when killed. The real program in VICE, the models held to it frame by frame (people-model.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { SCOOTER_SPRITE, assemble, assets, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar, putOnFoot } from './play.mjs';
import { P, putPerson, setDifficulty } from './people-model.mjs';
import { K } from './pickups-model.mjs';

const game = assemble('riders', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;

// On `modern`, the program set as the title page sets it.
const run = (modern, body) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    await setDifficulty(modern ? 1 : 0, modern && vice, L, assets.scooters);
    assets.riders = modern ? assets.scooters : assets.skaters;
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, L, w, 0, 'first');
    await body(vice, w);
  });
async function hold(vice, w, bits, frames, what) {
  for (let i = 1; i <= frames; i++) await pass(vice, L, w, bits, `${what}, frame ${i}`);
}
const rider = (vice, w, i, modern, fields) => {
  const [col, spd] = P.riders(modern ? 1 : 0);
  return putPerson(vice, L, w.people, i, { col, spd, ...fields });
};

test('classic, as the program file starts: skaters, their frames four ways on the board and lying beside it', () =>
  run(false, async (vice) => {
    assert.equal(L.SCOOTER_FRAMES / 64, SCOOTER_SPRITE);
    assert.ok((await vice.read(L.SCOOTER_FRAMES, 5 * 64)).equals(assets.skaters));
    assert.deepEqual([...(await vice.read(L['people.difficulty'], 3))], [0, P.SKATER, P.SKATE_SPEED]);
    assert.deepEqual(P.riders(0), [P.SKATER, P.SKATE_SPEED]);
    assert.deepEqual(P.riders(1), [P.SCOOTER, P.SCOOT_SPEED]);
    for (const c of [P.SKATER, P.SCOOTER]) assert.ok(!P.SHIRTS.includes(c), `no passer-by wears colour ${c}`);
    assert.equal(assets.skaters.length, 5 * 64);
    assert.ok(!assets.skaters.equals(assets.scooters), 'not the scooter riders');
  }));

for (const modern of [false, true]) {
  const who = modern ? 'a scooter rider' : 'a skater';
  test(`${modern ? 'modern' : 'classic'}: ${who} goes at their speed, on the ${modern ? 'deck' : 'board'} the way they go, and the picture is right`, () =>
    run(modern, async (vice, w) => {
      // On the pavement down the west side of the first block, going south, the player standing by.
      await putOnFoot(vice, L, w, 60, 100, 6);
      await hold(vice, w, 0, 3, 'put on foot');
      const p = await rider(vice, w, 3, modern, { x: 40, y: 120, way: 1, wait: 255 });
      const late = await missed(vice, L), y0 = p.y, spd = P.riders(modern ? 1 : 0)[1];
      for (let i = 1; i <= 20; i++) {
        await pass(vice, L, w, 0, `riding, ${i} frames`);
        assert.equal(p.pointer, SCOOTER_SPRITE + 1, 'facing south');
      }
      assert.ok(p.y - y0 >= 18 * spd && p.y - y0 <= 21 * spd, `their speed (${(p.y - y0) / 256} pixels in 20 frames)`);
      assert.ok(w.list.some((s) => s.pointer === SCOOTER_SPRITE + 1 && s.colour === (p.col | 0x80)), 'listed, in their colour');
      await assertPicture(vice, L, w, who);
      assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
    }));

  test(`${modern ? 'modern' : 'classic'}: run over, ${who} lies beside the ${modern ? 'scooter' : 'board'}, and drops nothing, even on a roll for cash`, () =>
    run(modern, async (vice, w) => {
      // The street at the top of the city, facing east, a rider in the road ahead, standing still.
      await putCar(vice, L, w, 200, 24, 0);
      await hold(vice, w, 0, 3, 'put there');
      w.pickups.seed = 1; // (its first byte, 2, is a roll for cash)
      await vice.write(L['pickups.seed'], [1, 0]);
      const p = await rider(vice, w, 2, modern, { x: 290, y: 24, way: 1, spd: 0, wait: 255 });
      for (let i = 1; i <= 120 && !p.down; i++) await pass(vice, L, w, JOY.UP, `driving at them, ${i} frames`);
      assert.equal(p.down, P.DOWN_TIME, 'run over');
      assert.equal(p.pointer, SCOOTER_SPRITE + 4, 'lying beside it');
      assert.ok(w.pickups.drops.every((d) => d.kind === K.AWAY), 'nothing dropped');
      assert.equal(w.pickups.seed, 1, 'and no roll for it');
      await pass(vice, L, w, JOY.DOWN, 'braking');
      await assertPicture(vice, L, w, `${who} lying`, JOY.DOWN);
    }));
}

test('modern: someone in the classic riders\' colour is no rider, and drops what a passer-by drops', () =>
  run(true, async (vice, w) => {
    await putCar(vice, L, w, 200, 24, 0);
    await hold(vice, w, 0, 3, 'put there');
    w.pickups.seed = 1;
    await vice.write(L['pickups.seed'], [1, 0]);
    const p = await putPerson(vice, L, w.people, 2, { col: P.SKATER, spd: 0, x: 290, y: 24, way: 1, wait: 255 });
    for (let i = 1; i <= 120 && !p.down; i++) await pass(vice, L, w, JOY.UP, `driving at them, ${i} frames`);
    assert.equal(p.pointer, P.SPRITE + P.DOWN_FRAME, 'lying as a passer-by does');
    assert.notEqual(w.pickups.seed, 1, 'a roll for a drop');
  }));
