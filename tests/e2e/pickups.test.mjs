// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the pickups (src/pickups.asm): the real program in VICE, held frame by frame to the
// model (pickups-model.mjs, stepped with everything else by play.mjs), their pictures pixel by pixel, and what
// each kind does to the money, health, ammo, knife and heat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { PICKUP_SPRITE, assemble, assets, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putOnFoot } from './play.mjs';
import { AMMO, BANDAGE, CASH, DONUT, K, KNIFE } from './pickups-model.mjs';
import { People } from './people-model.mjs';

const game = assemble('pickups', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const PAVEMENT = 4, GRASS = 2;

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
const bcd = (b) => (b >> 4) * 10 + (b & 15);
async function status(vice) {
  const m = await vice.read(L['status.money'], 3);
  const [hp] = await vice.read(L['status.hp'], 1), [ammo] = await vice.read(L['status.ammo'], 1);
  const [knife] = await vice.read(L['status.knife'], 1), [heat] = await vice.read(L['status.heat'], 1);
  return { money: bcd(m[0]) + 100 * bcd(m[1]) + 10000 * bcd(m[2]), hp, ammo: bcd(ammo), knife, heat };
}
/** Put pickup `i` on tile (col, row), of `kind`, in the program and the model. */
async function putPickup(vice, w, i, col, row, kind) {
  Object.assign(w.pickups.items[i], { col, row, kind });
  for (const [name, value] of [['col', col], ['row', row], ['kind', kind]]) await vice.write(L[`pickups.${name}`] + i, [value]);
}
/**
 * A pickup of `kind` on the pavement down the west side of the first block, the player put 14 pixels south of it
 * (so the window jumps there and every pickup is looked at afresh), walking north onto it.
 */
async function walkOnto(vice, w, kind, what) {
  const col = 2, row = 8, x = col * 16 + 8, y = row * 16 + 8;
  assert.equal(People.kind(x, y), PAVEMENT);
  await putPickup(vice, w, 0, col, row, kind);
  await putOnFoot(vice, L, w, x, y + 14, 6);
  await hold(vice, w, 0, 3, `${what}: put there`);
  const p = w.pickups.items[0];
  assert.equal(p.kind, kind, `${what}: there`);
  for (let i = 1; i <= 20 && p.kind !== K.AWAY; i++) await pass(vice, L, w, JOY.UP, `${what}: walking onto it, ${i} frames`);
  assert.equal(p.kind, K.AWAY, `${what}: picked up`);
}

test('at the start: twelve on pavements, plazas and grass, none by the start, in their five frames', () =>
  run(async (vice, w) => {
    assert.ok((await vice.read(L.PICKUP_FRAMES, 5 * 64)).equals(assets.pickups), 'their frames, as tools/assets.mjs draws them');
    assert.equal(L.PICKUP_FRAMES / 64, PICKUP_SPRITE);
    assert.equal(w.pickups.items.length, 12);
    for (const p of w.pickups.items) {
      assert.ok([PAVEMENT, GRASS].includes(People.kind(p.col * 16 + 8, p.row * 16 + 8)), `on a pavement, plaza or grass (${p.col},${p.row})`);
      assert.ok(Math.abs(p.col - K.START_COL) > K.CLEAR || Math.abs(p.row - K.START_ROW) > K.CLEAR, 'not by the start');
      assert.ok(p.kind <= KNIFE);
    }
  }));

test('walking onto one picks it up; until then it is shown, bobbing a pixel, in its colour with its letter', () =>
  run(async (vice, w) => {
    const col = 2, row = 8, x = col * 16 + 8, y = row * 16 + 8;
    await putPickup(vice, w, 0, col, row, AMMO);
    await putOnFoot(vice, L, w, x, y + 30, 6);
    await hold(vice, w, 0, 3, 'put there');
    const late = await missed(vice, L);
    let shown = 0;
    for (let i = 1; i <= 40; i++) {
      await pass(vice, L, w, 0, `standing by it, ${i} frames`);
      if (w.list.some((s) => s.pointer === PICKUP_SPRITE + AMMO)) shown++;
      if (i === 8 || i === 24) await assertPicture(vice, L, w, `the ammo pickup, ${i} frames`);
    }
    assert.equal(shown, 40, 'shown all the while');
    for (let i = 1; i <= 20 && w.pickups.items[0].kind !== K.AWAY; i++) await pass(vice, L, w, JOY.UP, `walking onto it, ${i} frames`);
    assert.equal(w.pickups.items[0].kind, K.AWAY, 'picked up');
    assert.ok(!w.list.some((s) => s.pointer === PICKUP_SPRITE + AMMO), 'and gone');
    await assertPicture(vice, L, w, 'with it gone');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
  }));

test('what each does: ammo, cash, a donut, a bandage, a knife and a spare knife', () =>
  run(async (vice, w) => {
    let before = await status(vice);
    assert.deepEqual(before, { money: 0, hp: 100, ammo: 0, knife: 0, heat: 0 });
    await walkOnto(vice, w, AMMO, 'ammo');
    assert.equal((await status(vice)).ammo, 12, '12 more');
    for (let n = 2; n <= 9; n++) await walkOnto(vice, w, AMMO, `ammo ${n}`);
    assert.equal((await status(vice)).ammo, 99, 'no more than 99');
    before = await status(vice);
    await walkOnto(vice, w, CASH, 'cash');
    let got = (await status(vice)).money - before.money;
    assert.ok(got >= 50 && got <= 300 && got % 50 === 0, `$50 to $300 in steps of $50 (${got})`);
    // A bandage: 40 health back to at most 100 (full already), for $20.
    before = await status(vice);
    await vice.write(L['status.hp'], [50]);
    await walkOnto(vice, w, BANDAGE, 'a bandage');
    let now = await status(vice);
    assert.equal(now.hp, 90, '40 health back');
    assert.equal(now.money, before.money - 20, 'for $20');
    await walkOnto(vice, w, BANDAGE, 'another');
    assert.equal((await status(vice)).hp, 100, 'to at most 100');
    // A knife, then a spare one, pawned for $10.
    await walkOnto(vice, w, KNIFE, 'a knife');
    assert.equal((await status(vice)).knife, 1);
    before = await status(vice);
    await walkOnto(vice, w, KNIFE, 'a spare knife');
    now = await status(vice);
    assert.equal(now.knife, 1);
    assert.equal(now.money, before.money + 10, 'pawned for $10');
    // A donut: a level of heat less, its points to that level's start; nothing with none.
    await vice.write(L['status.heat'], [2]);
    await vice.write(L['status.points'], [2 * 30, 0]);
    await walkOnto(vice, w, DONUT, 'a donut');
    now = await status(vice);
    assert.equal(now.heat, 1, 'a level less');
    assert.deepEqual([...(await vice.read(L['status.points'], 2))], [2 * 8, 0], 'its points to level 1\'s start');
    await vice.write(L['status.heat'], [0]);
    await vice.write(L['status.points'], [0, 0]);
    await walkOnto(vice, w, DONUT, 'a donut with no heat');
    assert.equal((await status(vice)).heat, 0, 'nothing');
  }));

test('one picked up comes back 40 to 70 seconds later, somewhere else', () =>
  run(async (vice, w) => {
    await walkOnto(vice, w, CASH, 'cash');
    const p = w.pickups.items[0];
    let frames = 0;
    while (p.kind === K.AWAY && frames < 71 * 50) {
      await pass(vice, L, w, 0, `waiting, ${++frames} frames`);
    }
    assert.ok(frames >= 40 * 50 && frames <= 70 * 50, `back after ${frames} frames`);
    assert.notDeepEqual([p.col, p.row], [2, 8], 'somewhere else');
    assert.ok([PAVEMENT, GRASS].includes(People.kind(p.col * 16 + 8, p.row * 16 + 8)));
  }));
