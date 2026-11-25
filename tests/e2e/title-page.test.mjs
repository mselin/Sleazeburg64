// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the title page (src/title-page.asm, TITLE=1, as the game is shipped): the sunset picture,
// pixel by pixel as tools/picture.mjs makes it, PRESS FIRE ... blinking under it, and fire starting the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOY, ROOT } from './vice.mjs';
import { assemble, readPanel, withProgram } from './game.mjs';
import { HEIGHT, TEXT_ROW, WIDTH, bitmap, colours, layout, readPng, text } from '../../tools/picture.mjs';
import { pack } from '../../tools/pack.mjs';

// The picture as the build makes it (Makefile), made afresh here.
const picture = bitmap(text(colours(readPng(readFileSync(join(ROOT, 'assets/title-sunset.png'))))));
writeFileSync(join(ROOT, 'build/title.bin'), Buffer.from(pack(layout(picture.koala))));
const game = assemble('title-page', { defs: { TITLE: 1 } });
const L = game.labels;
const FIRST = 51, LEFT = 24; // the screen's first line and pixel (vice.mjs's display)

/** Pixels of the picture shown wrong, with the text in its row shown (`lit`) or not. */
async function wrong(vice, lit) {
  const d = await vice.display(), out = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let want = picture.shown[y * WIDTH + x];
      if (!lit && y >= TEXT_ROW * 8) want = 0;
      for (const half of [0, 1]) {
        const got = d.at(LEFT + 2 * x + half, FIRST + y);
        if (got !== want) out.push(`x ${2 * x + half} line ${y}: colour ${got}, not ${want}`);
      }
    }
  }
  return out.length ? [`${out.length} pixels wrong`, ...out.slice(0, 5)] : [];
}
/**
 * Run on `n` lines of the title page (each_frame is passed once a line), then on to the top border: there the
 * picture VICE holds is all of the frame before, never part of two (the text blinks at line 251, after the
 * text is drawn).
 */
async function frames(vice, n) {
  for (let i = 0; i < n; i++) await vice.runTo(L['title_page.each_frame']);
  do await vice.runTo(L['title_page.each_frame']);
  while ((await vice.registers()).LIN > 40);
}

test('the title page: the sunset picture, pixel by pixel, PRESS FIRE ... blinking under it twice a second', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L['title_page.each_frame']);
    await frames(vice, 3 * 312);
    assert.deepEqual(await wrong(vice, true), [], 'the picture, the text lit');
    let changes = 0, was = null;
    for (let i = 0; i < 30; i++) {
      await frames(vice, 312 * 5); // (each_frame is passed on every line: a frame is 312 of them)
      const lit = !(await wrong(vice, true)).length, dark = !(await wrong(vice, false)).length;
      assert.ok(lit || dark, 'one or the other');
      if (was !== null && lit !== was) changes++;
      was = lit;
    }
    assert.ok(changes >= 4, `the text blinks (${changes} changes in 150 frames)`);
  }));

test('directions do not start the game; fire does, held since the start only once it has been let go', () =>
  withProgram(game.prg, async (vice) => {
    await vice.joystick(JOY.FIRE); // (held from when the program was started)
    await vice.runTo(L['title_page.each_frame']);
    await frames(vice, 312 * 20);
    assert.equal((await vice.registers()).PC, L['title_page.each_frame'], 'fire held from the start: still the title page');
    await vice.joystick(JOY.UP | JOY.LEFT);
    await frames(vice, 312 * 20);
    assert.equal((await vice.registers()).PC, L['title_page.each_frame'], 'still the title page');
    await vice.joystick(JOY.FIRE);
    await vice.runTo(L.ready);
    await vice.joystick(0);
    await vice.runTo(L.ready);
    assert.equal((await readPanel(vice))[0], '$000000 HEAT ***** HP????? CAR???   FIST', 'the game, running');
  }));
