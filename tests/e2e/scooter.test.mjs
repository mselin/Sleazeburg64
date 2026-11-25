// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of scooter riders (src/people.asm): passers-by in light green, at the scooter's speed,
// standing on the deck the way they go, lying beside it when knocked down, and dropping nothing when killed.
// The real program in VICE, the models held to it frame by frame (people-model.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { SCOOTER_SPRITE, assemble, assets, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar, putOnFoot } from './play.mjs';
import { P, putPerson } from './people-model.mjs';
import { K } from './pickups-model.mjs';

const game = assemble('scooter', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;

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
const rider = (vice, w, i, fields) => putPerson(vice, L, w.people, i, { col: P.SCOOTER, spd: P.SCOOT_SPEED, ...fields });

test('their frames: four ways on the deck, and lying beside the scooter, as tools/assets.mjs draws them', () =>
  run(async (vice) => {
    assert.equal(L.SCOOTER_FRAMES / 64, SCOOTER_SPRITE);
    assert.ok((await vice.read(L.SCOOTER_FRAMES, 5 * 64)).equals(assets.scooters));
    assert.ok(!P.SHIRTS.includes(P.SCOOTER), 'no passer-by wears light green');
  }));

test('a rider goes at the scooter\'s speed, standing on the deck the way they go, and the picture is right', () =>
  run(async (vice, w) => {
    // On the pavement down the west side of the first block, going south, the player standing by.
    await putOnFoot(vice, L, w, 60, 100, 6);
    await hold(vice, w, 0, 3, 'put on foot');
    const p = await rider(vice, w, 3, { x: 40, y: 120, way: 1, wait: 255 });
    const late = await missed(vice, L), y0 = p.y;
    for (let i = 1; i <= 20; i++) {
      await pass(vice, L, w, 0, `riding, ${i} frames`);
      assert.equal(p.pointer, SCOOTER_SPRITE + 1, 'on the deck, facing south');
    }
    assert.ok(p.y - y0 >= 18 * P.SCOOT_SPEED, `about a pixel a frame (${(p.y - y0) / 256} in 20 frames)`);
    assert.ok(w.list.some((s) => s.pointer === SCOOTER_SPRITE + 1 && s.colour === (P.SCOOTER | 0x80)), 'listed, in light green');
    await assertPicture(vice, L, w, 'a scooter rider');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
  }));

test('run over, a rider lies beside the scooter, and drops nothing, even on a roll for cash', () =>
  run(async (vice, w) => {
    // The street at the top of the city, facing east, a rider in the road ahead, standing still.
    await putCar(vice, L, w, 200, 24, 0);
    await hold(vice, w, 0, 3, 'put there');
    w.pickups.seed = 1; // (its first byte, 2, is a roll for cash)
    await vice.write(L['pickups.seed'], [1, 0]);
    const p = await rider(vice, w, 2, { x: 290, y: 24, way: 1, spd: 0, wait: 255 });
    for (let i = 1; i <= 120 && !p.down; i++) await pass(vice, L, w, JOY.UP, `driving at them, ${i} frames`);
    assert.equal(p.down, P.DOWN_TIME, 'run over');
    assert.equal(p.pointer, SCOOTER_SPRITE + 4, 'lying beside the scooter');
    assert.ok(w.pickups.drops.every((d) => d.kind === K.AWAY), 'nothing dropped');
    assert.equal(w.pickups.seed, 1, 'and no roll for it');
    await pass(vice, L, w, JOY.DOWN, 'braking');
    await assertPicture(vice, L, w, 'a rider lying', JOY.DOWN);
  }));
