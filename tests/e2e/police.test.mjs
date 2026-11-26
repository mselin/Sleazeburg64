// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the police (src/police.asm): with heat, police cars come, white, at most the heat's level of
// them, and only they; at a crossing they take the way to the player; near the player, the border flashes red and
// blue and the heat does not cool. The real program in VICE, the models (traffic-model.mjs, heat-model.mjs) held
// to it frame by frame, as everywhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, withProgram } from './game.mjs';
import { World, missed, pass, putOnFoot } from './play.mjs';
import { putHeat } from './heat-model.mjs';

const game = assemble('police', { defs: { HONK: 0 } });
const L = game.labels;
const RED = 2, BLUE = 6, WHITE = 1;

const run = (body) =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const w = new World({ honk: false });
    await pass(vice, L, w, 0, 'first');
    await body(vice, w);
  });
const cops = (w) => w.traffic.cars.filter((c) => c.on && c.cop);
const border = async (vice) => (await vice.read(0xd020, 1))[0] & 15;

test('with heat 2, police cars come: white, no more than two, and no other traffic while there is heat', () =>
  run(async (vice, w) => {
    // On foot in the middle of a street, heat 2 that will not cool in the test (a long time to go).
    await putOnFoot(vice, L, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, L, w, 0, `put there, ${i} frames`); // (the window jumped)
    await putHeat(vice, L, w.heat, { level: 2, points: 2 * 25, cool: 60000 });
    const late = await missed(vice, L);
    let most = 0, seen = 0;
    for (let i = 1; i <= 1500 && seen < 2; i++) {
      const before = w.traffic.cars.map((c) => c.on), was = w.traffic.cars.map((c) => c.on && !c.cop);
      await pass(vice, L, w, 0, `heat 2, ${i} frames`);
      w.traffic.cars.forEach((c, k) => {
        if (!c.on || before[k]) return;
        assert.equal(c.cop, 1, `only police cars appear with heat (place ${k}, ${i} frames)`);
        assert.equal(c.col, WHITE, 'white');
        assert.equal(c.cruise, 255, 'at the fastest a traffic car goes');
        seen++;
      });
      most = Math.max(most, cops(w).length);
      w.traffic.cars.forEach((c, k) => was[k] && c.on && assert.equal(c.cop, 0, 'a car already about does not become one'));
    }
    assert.equal(seen, 2, 'two came');
    assert.ok(most <= 2, 'no more than the heat');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
  }));

test('police cars come to the player; near, the border flashes red and blue every half second, and the heat does not cool', () =>
  run(async (vice, w) => {
    await putOnFoot(vice, L, w, 200, 24, 0);
    await putHeat(vice, L, w.heat, { level: 1, points: 2 * 8, cool: 60000 });
    let i = 0;
    while (!w.traffic.around && i < 3000) await pass(vice, L, w, 0, `waiting for the police, ${++i} frames`);
    assert.equal(w.traffic.around, 1, `a police car came near (${i} frames)`);
    // Near: no cooling, however little time is left; the siren's colours, a half second each.
    await putHeat(vice, L, w.heat, { level: 1, points: 2 * 8, cool: 2 });
    const colours = [];
    for (let k = 1; k <= 60 && w.traffic.around; k++) {
      await pass(vice, L, w, 0, `with the police near, ${k} frames`);
      colours.push(await border(vice));
      assert.equal(w.heat.level, 1, 'the heat does not cool');
    }
    assert.ok(colours.length >= 30, `near for a while (${colours.length} frames)`);
    assert.ok(colours.every((c) => c === RED || c === BLUE), 'red and blue');
    const runs = [];
    for (const c of colours) if (runs.length && runs[runs.length - 1].c === c) runs[runs.length - 1].n++; else runs.push({ c, n: 1 });
    for (const r of runs.slice(1, -1)) assert.equal(r.n, 25, 'half a second each');
  }));

test('with no heat, no siren, and new cars are traffic again', () =>
  run(async (vice, w) => {
    for (let i = 1; i <= 200; i++) {
      await pass(vice, L, w, 0, `no heat, ${i} frames`);
      assert.equal(await border(vice), 0, 'the border black');
    }
    assert.ok(w.traffic.cars.every((c) => !c.on || !c.cop), 'no police cars');
  }));
