// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the screen copy made ahead (video.ahead in src/video.asm): when the window is about to
// cross into the next character, the frame before copies what it has time for onto the screen not shown, and
// the pass that crosses does only the rest. The picture must be just as it would be with the whole copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { assemble, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar } from './play.mjs';

// No traffic and no Big Honk: nothing but the car and the window.
const game = assemble('screen', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const EAST = 5; // the copy for the window moving one character right: (0 + 1) * 3 + 1 + 1

test('driving slowly east, the copy for each crossing is made ahead, and the picture is right after it', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, L, w, 0, 'first');
    // The long street at the top of the city, facing east.
    await putCar(vice, L, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, L, w, 0, `put there, ${i} frames`);
    const before = await missed(vice, L);
    let crossings = 0, ready = 0, crossed = false;
    for (let i = 1; i <= 240; i++) {
      // About a pixel a frame: the window crosses a character every eight or so.
      const bits = w.car.vx < 240 ? JOY.UP : 0;
      if (crossed) await assertPicture(vice, L, w, `after a crossing, ${i - 1} frames`, bits);
      const [way] = await vice.read(L['video.pre_way'], 1), [front] = await vice.read(L['video.front'], 1);
      const cell = w.cam.x >> 3;
      await pass(vice, L, w, bits, `driving east, ${i} frames`);
      crossed = (w.cam.x >> 3) !== cell;
      if (crossed) {
        crossings++;
        if (way === EAST + 9 * front) ready++;
        assert.equal((await vice.read(L['video.pre_way'], 1))[0], 0xff, 'and what was made ahead is used up');
      }
    }
    assert.ok(crossings >= 15, `the window crossed into the next character (${crossings} times)`);
    assert.ok(ready >= crossings - 1, `the copy was begun ahead for all but the first of them (${ready})`);
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('whatever is on the screen not shown, and whatever copy is said to be begun, a crossing leaves the picture right', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, L, w, 0, 'first');
    await putCar(vice, L, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, L, w, 0, `put there, ${i} frames`);
    // Rubbish on the screen not shown, and a copy for the window moving down said to be begun on it, most of
    // its columns done: the window moves east, so none of that may be used.
    const [front] = await vice.read(L['video.front'], 1);
    await vice.write(front ? L.SCREEN_A : L.SCREEN_B, Array(21 * 40).fill(1));
    await vice.write(L['video.pre_way'], [7 + 9 * front]);
    await vice.write(L['video.pre_next'], [10]);
    let crossings = 0;
    for (let i = 1; i <= 60 && crossings < 3; i++) {
      const cell = w.cam.x >> 3;
      await pass(vice, L, w, JOY.UP, `driving east, ${i} frames`);
      if ((w.cam.x >> 3) !== cell) {
        crossings++;
        await assertPicture(vice, L, w, `after crossing ${crossings}`, JOY.UP);
      }
    }
    assert.equal(crossings, 3);
  }));
