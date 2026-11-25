// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the gun (src/gun.asm): with ammo, fire on foot shoots; the bullets fly, kill, stop on walls
// and cars; the heat, the ammo and the panel; and fists again once it runs out. The real program in VICE, with
// the models (people-model.mjs's bullets among them) held to it frame by frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { BULLET_SPRITE, assemble, readPanel, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putOnFoot, putTrafficCar } from './play.mjs';
import { G, P, putPerson } from './people-model.mjs';

const game = assemble('gun', { defs: { SPAWN: 0, HONK: 0 } });
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
const bcd = (n) => ((n / 10) << 4) | n % 10;
/** `n` rounds, in the program and the model. */
async function ammo(vice, w, n) {
  await vice.write(L['status.ammo'], [bcd(n)]);
  w.pickups.ammo = n;
}
async function heat(vice) {
  const [lo, hi] = await vice.read(L['status.points'], 2);
  return (lo | (hi << 8)) / 2;
}
/** The player on the pavement down the west side of the first block, facing north, with `n` rounds. */
async function armed(vice, w, n) {
  await putOnFoot(vice, L, w, 40, 150, 6);
  await hold(vice, w, 0, 3, 'put on the pavement');
  await ammo(vice, w, n);
  await pass(vice, L, w, 0, 'armed');
}

test('a shot: a round less, 1.5 heat, the bullet flies north and kills someone 40 pixels on, for 6 more', () =>
  run(async (vice, w) => {
    await armed(vice, w, 3);
    const p = await putPerson(vice, L, w.people, 3, { x: 40, y: 110, way: 1, spd: 0, col: 3, wait: 255 });
    const late = await missed(vice, L);
    await pass(vice, L, w, JOY.FIRE, 'the shot');
    assert.equal(w.player.arm, P.ARM_OUT, 'the arm out');
    assert.equal(w.pickups.ammo, 2, 'a round less');
    assert.equal(await heat(vice), 1.5, '1.5 heat for the shot');
    const b = w.people.bullets.find((x) => x.ticks);
    assert.ok(b, 'a bullet');
    assert.equal(b.ticks, G.LIFE - 1);
    await pass(vice, L, w, 0, 'it flies');
    assert.ok(w.list.some((s) => s.pointer === BULLET_SPRITE), 'shown');
    await assertPicture(vice, L, w, 'the bullet in flight');
    for (let i = 1; i <= 20 && !p.down; i++) await pass(vice, L, w, 0, `flying, ${i} frames`);
    assert.ok(p.down, 'hit');
    assert.equal(p.ko, 0, 'killed');
    assert.ok(w.people.bullets.every((x) => !x.ticks), 'and the bullet spent');
    assert.equal(await heat(vice), 1.5 + 6, 'and 6 heat for the kill');
    await hold(vice, w, 0, 2, 'the panel');
    assert.match((await readPanel(vice))[0], /AMMO02$/, 'the panel counts it');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
  }));

test('a bullet flies 27 frames at most, stops on a wall, and anyone within 110 runs from the shot', () =>
  run(async (vice, w) => {
    await armed(vice, w, 5);
    const q = await putPerson(vice, L, w.people, 2, { x: 40, y: 230, way: 3, spd: 90, col: 4, wait: 255 });
    const far = await putPerson(vice, L, w.people, 1, { x: 40, y: 300, way: 3, spd: 90, col: 5, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'a shot north');
    assert.ok(q.flee >= G.FLEE - 1, 'someone 80 away runs, 4 seconds (counted down once already in their turn)');
    assert.equal(far.flee, 0, 'someone 150 away does not');
    let frames = 1;
    while (w.people.bullets.some((x) => x.ticks)) {
      await pass(vice, L, w, 0, `flying, ${++frames} frames`);
      assert.ok(frames <= G.LIFE, 'no longer than 27 frames');
    }
    // East, at a building 24 pixels away: spent long before its time is up.
    await putOnFoot(vice, L, w, 280, 56, 0);
    await hold(vice, w, 0, G.WAIT, 'put by a building');
    await pass(vice, L, w, JOY.FIRE, 'a shot east');
    frames = 1;
    while (w.people.bullets.some((x) => x.ticks)) await pass(vice, L, w, 0, `flying, ${++frames} frames`);
    assert.ok(frames < 10, `stopped by the building (${frames} frames)`);
  }));

test('a bullet stops on a car, for 1 heat; and with the ammo gone, fire is a punch again', () =>
  run(async (vice, w) => {
    await armed(vice, w, 1);
    await putTrafficCar(vice, L, w, 1, { x: 40, y: 100, dir: 3, cruise: 0, wreck: 1 });
    await pass(vice, L, w, 0, 'a car standing to the north');
    await pass(vice, L, w, JOY.FIRE, 'the shot');
    let frames = 1;
    while (w.people.bullets.some((x) => x.ticks)) await pass(vice, L, w, 0, `flying, ${++frames} frames`);
    assert.ok(frames < 12, `stopped by the car (${frames} frames)`);
    assert.equal(await heat(vice), 1.5 + 1, '1 heat for hitting it');
    assert.equal(w.pickups.ammo, 0);
    await hold(vice, w, 0, G.WAIT, 'waiting');
    const p = await putPerson(vice, L, w.people, 3, { x: 40, y: 150 - P.PUNCH_REACH, way: 1, spd: 0, col: 3, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'fire with no ammo');
    assert.ok(w.people.bullets.every((x) => !x.ticks), 'no shot');
    assert.equal(p.ko, 1, 'a punch');
    await hold(vice, w, 0, 2, 'the panel');
    assert.match((await readPanel(vice))[0], /FIST$/);
  }));
