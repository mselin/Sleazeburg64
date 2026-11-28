// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the pickups (src/pickups.asm): the real program in VICE, held frame by frame to the
// model (pickups-model.mjs, stepped with everything else by play.mjs), their pictures pixel by pixel, and what
// each kind does to the money, health, ammo, knife and heat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { ARROW_SPRITE, PICKUP_SPRITE, SIGN_SPRITE, arrowFrame, assemble, assets, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar, putOnFoot } from './play.mjs';
import { AMMO, BANDAGE, CASH, DONUT, K, KNIFE } from './pickups-model.mjs';
import { P, People, putPerson } from './people-model.mjs';
import { putHeat } from './heat-model.mjs';
import { kindAt } from './foot-model.mjs';

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
    await putHeat(vice, L, w.heat, { level: 2, points: 2 * 30 });
    await walkOnto(vice, w, DONUT, 'a donut');
    now = await status(vice);
    assert.equal(now.heat, 1, 'a level less');
    assert.deepEqual([...(await vice.read(L['status.points'], 2))], [2 * 8, 0], 'its points to level 1\'s start');
    await putHeat(vice, L, w.heat, { level: 0, points: 0 });
    await walkOnto(vice, w, DONUT, 'a donut with no heat');
    assert.equal((await status(vice)).heat, 0, 'nothing');
  }));

test('the paint shop is marked on the map with a P, flashing cyan and white, heat or not', () =>
  run(async (vice, w) => {
    assert.ok((await vice.read(L.MARKER_FRAMES, 64)).equals(assets.marker), 'its frame, as tools/assets.mjs draws it');
    assert.equal(L.MARKER_FRAMES / 64, K.MARKER);
    assert.ok(!w.pickups.paint && !w.list.some((s) => s.pointer === K.MARKER), 'not near at the start');
    await putOnFoot(vice, L, w, K.PAINT_X, K.PAINT_Y + 40, 6);
    await hold(vice, w, 0, 3, 'by the paint shop');
    assert.ok(w.pickups.paint, 'near');
    const late = await missed(vice, L), colours = new Set();
    for (let i = 1; i <= 40; i++) {
      await pass(vice, L, w, 0, `by the paint shop, ${i} frames`);
      const m = w.list.find((s) => s.pointer === K.MARKER);
      assert.ok(m, `shown, ${i} frames`);
      colours.add(m.colour);
      if (i === 8 || i === 24) await assertPicture(vice, L, w, `the marker, ${i} frames`);
    }
    assert.deepEqual([...colours].sort(), [0x81, 0x83], 'white and cyan');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
    await putOnFoot(vice, L, w, 2 * 16 + 8, 8 * 16 + 30, 6);
    await hold(vice, w, 0, 3, 'far from it');
    assert.ok(!w.pickups.paint && !w.list.some((s) => s.pointer === K.MARKER), 'not shown far from it');
  }));

/** The middle of the road tile nearest pixel (x, y), looking outwards ring by ring. */
function roadNear(x, y) {
  for (let r = 0; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const px = ((x >> 4) + dx) * 16 + 8, py = ((y >> 4) + dy) * 16 + 8;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && px > 0 && py > 0 && kindAt(px, py) === 0) return [px, py];
      }
  throw new Error(`no road near ${x}, ${y}`);
}

test('with heat, at the wheel and the paint shop off screen, an arrow at the edge of the view points to it, an S beside it', () =>
  run(async (vice, w) => {
    assert.equal(L.ARROW_FRAME / 64, ARROW_SPRITE);
    await putHeat(vice, L, w.heat, { level: 2, points: 2 * 25 });
    const ways = new Set();
    for (const [x, y, what] of [[1500, 1200, 'east'], [300, 300, 'north'], [1200, 300, 'north-east'],
      [900, 1540, 'south-east'], [300, 1540, 'south']]) {
      const [px, py] = roadNear(x, y);
      await putCar(vice, L, w, px, py, 0);
      await hold(vice, w, 0, 4, `${what}: put there`);
      const late = await missed(vice, L);
      for (let i = 1; i <= 12; i++) {
        await pass(vice, L, w, 0, `${what}, ${i} frames`);
        const a = w.pickups.arrow;
        assert.ok(a, `${what}: shown, ${i} frames`);
        assert.ok(w.list.some((s) => s.pointer === ARROW_SPRITE) && w.list.some((s) => s.pointer === SIGN_SPRITE),
          `${what}: the arrow and the S are in the list`);
        if (i === 6) {
          assert.deepEqual([...(await vice.read(L.ARROW_FRAME, 63))], [...arrowFrame(a.way)], `${what}: its way, ${a.way}`);
          await assertPicture(vice, L, w, `${what}: the arrow`);
        }
      }
      assert.equal(await missed(vice, L) - late, 0, `${what}: no frame was late`);
      ways.add(w.pickups.arrow.way);
    }
    assert.ok(ways.size >= 4, `it points different ways: ${[...ways]}`);
    // Not on foot, and not with the shop on screen (then the P marks it).
    const [fx, fy] = roadNear(1500, 1200);
    await putOnFoot(vice, L, w, fx, fy, 6);
    await hold(vice, w, 0, 4, 'on foot');
    assert.ok(!w.pickups.arrow && !w.list.some((s) => s.pointer === ARROW_SPRITE || s.pointer === SIGN_SPRITE), 'not on foot');
    const [nx, ny] = roadNear(K.PAINT_X + 60, K.PAINT_Y);
    await putCar(vice, L, w, nx, ny, 0);
    await hold(vice, w, 0, 4, 'by the shop');
    assert.ok(!w.pickups.arrow && !w.list.some((s) => s.pointer === ARROW_SPRITE), 'not by the shop');
    // Not with no heat.
    await putHeat(vice, L, w.heat, { level: 0, points: 0 });
    const [ex, ey] = roadNear(1500, 1200);
    await putCar(vice, L, w, ex, ey, 0);
    await hold(vice, w, 0, 4, 'no heat');
    assert.ok(!w.pickups.arrow && !w.list.some((s) => s.pointer === ARROW_SPRITE), 'not with no heat');
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

/** A seed for the pickups' random numbers whose next byte is at least `lo` and below `hi`. */
function seedFor(lo, hi) {
  for (let seed = 1; ; seed++) {
    let a = seed << 1;
    if (a > 0xffff) a = (a & 0xffff) ^ 0x2d;
    if ((a & 255) >= lo && (a & 255) < hi) return seed;
  }
}
async function putSeed(vice, w, seed) {
  w.pickups.seed = seed;
  await vice.write(L['pickups.seed'], [seed & 255, seed >> 8]);
}
/** With a knife, the player on the pavement facing north stabs someone STAB_REACH ahead, the roll from `seed`. */
async function stab(vice, w, seed) {
  await vice.write(L['status.knife'], [1]);
  w.pickups.knife = 1;
  await putOnFoot(vice, L, w, 40, 150, 6);
  await hold(vice, w, 0, P.STAB_WAIT, 'put on the pavement');
  return stabNow(vice, w, seed);
}
async function stabNow(vice, w, seed) {
  await putSeed(vice, w, seed);
  const p = await putPerson(vice, L, w.people, 3, { x: 40, y: 150 - P.STAB_REACH, way: 1, spd: 0, col: 3, wait: 255 });
  await pass(vice, L, w, JOY.FIRE, 'the stab');
  assert.equal(p.down, P.DOWN_TIME - 1, 'killed');
  assert.equal(p.ko, 0);
  await pass(vice, L, w, 0, 'let go');
  return p;
}
const shown = (w, kind) => w.list.some((s) => s.pointer === PICKUP_SPRITE + kind);

test('someone stabbed may drop cash at their feet: the player, standing within reach, has $10 to $90 at once', () =>
  run(async (vice, w) => {
    await stab(vice, w, seedFor(K.KNIFE_ODDS, 256)); // (put in place, and a stab that drops nothing)
    assert.deepEqual(w.pickups.taken, [], 'nothing dropped');
    await hold(vice, w, 0, P.STAB_WAIT, 'ready to stab again');
    const before = await status(vice), late = await missed(vice, L);
    await stabNow(vice, w, seedFor(0, K.CASH_ODDS));
    assert.deepEqual(w.pickups.taken, [CASH], 'dropped, and picked up');
    const got = (await status(vice)).money - before.money;
    assert.ok(got >= 10 && got <= 90 && got % 10 === 0 && got === w.pickups.lastCash, `${got} dollars`);
    assert.ok(w.pickups.drops.every((x) => x.kind === K.AWAY), 'gone');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
  }));

/** Run over someone in the road at the top of the city, the roll from `seed`, then the car put back west of them. */
async function runOver(vice, w, seed) {
  await putCar(vice, L, w, 200, 24, 0);
  await hold(vice, w, 0, 3, 'put there');
  await putSeed(vice, w, seed);
  const p = await putPerson(vice, L, w.people, 2, { x: 290, y: 24, way: 1, spd: 0, col: 4, wait: 255 });
  for (let i = 1; i <= 120 && !p.down; i++) await pass(vice, L, w, JOY.UP, `driving at them, ${i} frames`);
  assert.equal(p.down, P.DOWN_TIME, 'run over');
  return p;
}

test('what is dropped lies where they fell for 20 seconds, blinking in its last 4; a roll for nothing drops nothing', () =>
  run(async (vice, w) => {
    const p = await runOver(vice, w, seedFor(0, K.CASH_ODDS));
    const d = w.pickups.drops.find((x) => x.kind !== K.AWAY);
    assert.ok(d && d.kind >= 1 && d.kind <= 9, 'cash dropped');
    assert.deepEqual([d.x, d.y], [p.px, p.py], 'where they were hit');
    await putCar(vice, L, w, 230, 24, 0); // (out of its reach, in sight)
    await hold(vice, w, 0, 2, 'put back');
    assert.ok(shown(w, CASH), 'shown as cash');
    await assertPicture(vice, L, w, 'the cash dropped');
    let frames = 0, on = 0, off = 0;
    const late = await missed(vice, L);
    while (d.kind !== K.AWAY && frames < 1100) {
      await pass(vice, L, w, 0, `waiting, ${++frames} frames`);
      if (d.kind === K.AWAY) break;
      if (d.life >= K.BLINK) assert.ok(shown(w, CASH), `shown all the while before its last 4 seconds (${frames})`);
      else if (shown(w, CASH)) on++;
      else off++;
    }
    assert.ok(frames > 900 && frames < K.LIFE, `gone when its 20 seconds are up (${frames} frames more)`);
    assert.ok(on >= 90 && off >= 90, `blinking in its last 4 seconds: shown ${on} frames, hidden ${off}`);
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
    await runOver(vice, w, seedFor(K.KNIFE_ODDS, 256));
    assert.ok(w.pickups.drops.every((x) => x.kind === K.AWAY), 'nothing dropped');
  }));

test('a knife may be dropped only if the player has none: running someone over with none, it is, and the car picks it up', () =>
  run(async (vice, w) => {
    await runOver(vice, w, seedFor(K.CASH_ODDS, K.KNIFE_ODDS));
    const d = w.pickups.drops.find((x) => x.kind !== K.AWAY);
    assert.equal(d?.kind, K.DROP_KNIFE, 'a knife dropped');
    for (let i = 1; i <= 120 && d.kind !== K.AWAY; i++) {
      const bits = w.car.px < d.x - 6 ? JOY.UP : w.car.px > d.x + 6 ? JOY.DOWN : 0;
      await pass(vice, L, w, bits, `back to it, ${i} frames`);
    }
    assert.equal(d.kind, K.AWAY, 'picked up by the car');
    assert.equal((await status(vice)).knife, 1);
    // With a knife now, the same roll drops nothing.
    for (let i = 1; i <= 100 && Math.abs(w.car.vx) > 120; i++) await pass(vice, L, w, JOY.DOWN, `slowing, ${i} frames`);
    await pass(vice, L, w, 0, 'slow enough to get out');
    const taken = w.pickups.taken.length;
    await stab(vice, w, seedFor(K.CASH_ODDS, K.KNIFE_ODDS));
    assert.equal(w.pickups.taken.length, taken, 'no second knife');
  }));
