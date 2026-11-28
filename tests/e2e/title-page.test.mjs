// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the title page (src/title-page.asm, TITLE=1, as the game is shipped): the sunset picture,
// pixel by pixel as tools/picture.mjs makes it, PRESS FIRE ... blinking under it, the difficulty's line above it
// and D changing it, and fire starting the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOY, ROOT } from './vice.mjs';
import { assemble, assets, readPanel, withProgram } from './game.mjs';
import { P } from './people-model.mjs';
import { HEIGHT, LINE_ROW, TEXT_ROW, WIDTH, bitmap, difficulty, readPng, title } from '../../tools/picture.mjs';

// The picture as the build makes it (Makefile), made afresh here, and the top row as modern has it.
const made = title(readPng(readFileSync(join(ROOT, 'assets/title-sunset.png'))));
const picture = made.picture;
writeFileSync(join(ROOT, 'build/title.bin'), made.bin);
const modern = bitmap(difficulty(new Uint8Array(WIDTH * HEIGHT), 1)).shown;
const game = assemble('title-page', { defs: { TITLE: 1 } });
const L = game.labels;
const FIRST = 51, LEFT = 24; // the screen's first line and pixel (vice.mjs's display)

/**
 * Pixels of the picture shown wrong, with the text in its row shown (`lit`) or not, and the difficulty's line
 * the one of setting `d` (0 classic, 1 modern).
 */
async function wrong(vice, lit, d = 0) {
  const shown = await vice.display(), out = [];
  for (let y = 0; y < HEIGHT; y++) {
    const line = y >> 3 === LINE_ROW;
    for (let x = 0; x < WIDTH; x++) {
      let want = (line && d ? modern : picture.shown)[y * WIDTH + x];
      if (!lit && y >= TEXT_ROW * 8) want = 0;
      for (const half of [0, 1]) {
        const got = shown.at(LEFT + 2 * x + half, FIRST + y);
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

/**
 * Hold D for `n` frames (the emulator has no keys to press, so where the title page has looked at the keyboard,
 * A is set to say row 2 is low), or let go of it (`n` 0, the keyboard as it is), and run on to the top border.
 * The picture VICE holds then is of the frame after the last.
 */
async function d(vice, n) {
  for (let i = 0; i < Math.max(n, 1); i++) {
    await vice.runTo(L['title_page.read_keys']); // (stopped at got_keys, VICE stops there again at once)
    await vice.runTo(L['title_page.got_keys']);
    if (n) await vice.setRegisters({ A: 0 });
  }
  await frames(vice, 0);
}

test('the difficulty: classic at first, grey above the picture; D turns it to modern, yellow, with the scooter riders, and back', () =>
  withProgram(game.prg, async (vice) => {
    const setting = async () => [...(await vice.read(L['people.difficulty'], 3))];
    await vice.runTo(L['title_page.each_frame']);
    await frames(vice, 3 * 312);
    assert.equal(picture.shown.slice(0, 8 * WIDTH).filter((k) => k === 12).length > 300, true, 'the line, in grey');
    assert.equal(modern.slice(0, 8 * WIDTH).filter((k) => k === 7).length > 300, true, 'and modern\'s in yellow');
    assert.deepEqual(await setting(), [0, P.SKATER, P.SKATE_SPEED], 'classic');
    const lineShown = async (d) => !(await wrong(vice, true, d)).length || !(await wrong(vice, false, d)).length;
    assert.ok(await lineShown(0), 'DIFFICULTY: CLASSIC - PRESS D');
    for (const want of [1, 0, 1]) {
      await d(vice, 0);
      await vice.runTo(L['title_page.got_keys']); // (D pressed)
      await vice.setRegisters({ A: 0 });
      await vice.runTo(L['title_page.line_turns']);
      assert.ok(await lineShown(1 - want), 'the frame drawn as D is pressed: the line as it was, whole');
      await d(vice, 4); // (held on for four frames: it changes once)
      assert.deepEqual(await setting(), [want, ...P.riders(want)], want ? 'modern' : 'classic again');
      assert.ok(await lineShown(want), want ? 'DIFFICULTY: MODERN - PRESS D, in yellow' : 'the classic line, in grey');
      assert.ok((await vice.read(L.SCOOTER_FRAMES, 5 * 64)).equals(want ? assets.scooters : assets.skaters), 'the riders\' frames');
    }
    await d(vice, 0);
    await vice.joystick(JOY.FIRE); // modern, into the game
    await vice.runTo(L.ready);
    await vice.joystick(0);
    await vice.runTo(L.ready);
    assert.equal((await readPanel(vice))[0], '$000000 HEAT ***** HP????? CAR???   FIST', 'the game, running');
    assert.deepEqual(await setting(), [1, ...P.riders(1)], 'on modern');
    assert.ok((await vice.read(L.SCOOTER_FRAMES, 5 * 64)).equals(assets.scooters), 'with the scooter riders');
  }));
