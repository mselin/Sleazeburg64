// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the city viewer: the real program, running in VICE, driven through the joystick port.
// Each test starts its own emulator, so they do not depend on one another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import {
  MAX_X, MAX_Y, MOVE_EVERY, assemble, assets, expectedReadout, expectedView, readPanel, readView, withProgram,
} from './game.mjs';

const game = assemble('city-viewer');
const L = game.labels;
const run = (body) => withProgram(game.prg, async (vice) => {
  await vice.runTo(L.main_loop);
  return body(vice);
});
const camera = async (vice) => [...(await vice.read(L.cam_x, 2))];

/** Check the whole picture: the 880 characters of the view, their colours, and the readout under it. */
async function assertShows(vice, x, y) {
  assert.deepEqual(await camera(vice), [x, y], 'where the view is');
  const shown = await readView(vice);
  const wanted = expectedView(x, y);
  assert.ok(shown.chars.equals(wanted.chars), `the characters on screen are the city at ${x},${y}`);
  assert.ok(shown.colours.equals(wanted.colours), `the colours on screen are the city at ${x},${y}`);
  assert.equal((await readPanel(vice))[1], expectedReadout(x, y));
}

/** Put the view somewhere and let the program settle there, as if it had been steered. */
async function place(vice, x, y) {
  await vice.write(L.cam_x, [x, y]);
  await vice.write(L.move_wait, [0]);
}

test('it starts on the city at the starting tile, with the panel under it', () =>
  run(async (vice) => {
    await assertShows(vice, 9, 8);
    assert.deepEqual(await readPanel(vice), [
      'SLEAZEBURG 64 - THE CITY VIEWER',
      'TILE 09,08    CROSSING 3-2',
      'JOYSTICK IN PORT 2 MOVES THE VIEW',
    ]);
  }));

test('the video chip is set up for multicolour characters from the program\'s own character set', () =>
  run(async (vice) => {
    const vic = await vice.read(0xd000, 0x30);
    assert.equal(vic[0x11] & 0x7f, 0x1b, 'screen on, 25 rows, text mode, no vertical scroll');
    assert.equal(vic[0x16] & 0x1f, 0x18, 'multicolour, 40 columns, no horizontal scroll');
    assert.equal(vic[0x18] & 0xfe, 0x1e, 'screen at $0400, characters at $3800');
    assert.deepEqual([vic[0x20], vic[0x21], vic[0x22], vic[0x23]].map((c) => c & 15), [0, 11, 15, 0], 'border and the three shared colours');
    assert.equal(vic[0x15], 0, 'no sprites yet');
    assert.equal((await vice.read(0xdd00, 1))[0] & 3, 3, 'the video chip looks at the first 16K');
  }));

test('the program owns the machine: ROMs out, interrupts off, stack empty at the top of the loop', () =>
  run(async (vice) => {
    assert.equal((await vice.read(0x01, 1))[0] & 7, 5, 'BASIC and KERNAL switched out, I/O in');
    const r = await vice.registers();
    assert.equal(r.SP, 0xff);
    assert.equal(r.FL & 4, 4, 'interrupts are masked');
    assert.equal(r.PC, L.main_loop);
  }));

test('the character set, tiles and map are in memory where the program expects them', () =>
  run(async (vice) => {
    assert.ok((await vice.read(L.charset, 2048)).equals(assets.chars), 'character set');
    assert.ok((await vice.read(L.tile_tl, 5 * 256)).equals(assets.tiles), 'tile definitions');
    assert.ok((await vice.read(L.city_map, assets.map.length)).equals(assets.map), 'map');
  }));

for (const [name, bits, dx, dy] of [
  ['right', JOY.RIGHT, 1, 0], ['left', JOY.LEFT, -1, 0], ['down', JOY.DOWN, 0, 1], ['up', JOY.UP, 0, -1],
  ['up and right', JOY.UP | JOY.RIGHT, 1, -1], ['down and left', JOY.DOWN | JOY.LEFT, -1, 1],
])
  test(`holding the stick ${name} moves the view a tile at a time and redraws it`, () =>
    run(async (vice) => {
      await place(vice, 40, 40);
      await vice.joystick(bits);
      await vice.frames(L.main_loop, 1);
      await assertShows(vice, 40 + dx, 40 + dy);
      // Held, it steps again every MOVE_EVERY passes of the main loop and not before.
      await vice.frames(L.main_loop, MOVE_EVERY - 1);
      assert.deepEqual(await camera(vice), [40 + dx, 40 + dy], 'no second step yet');
      await vice.frames(L.main_loop, 1);
      await assertShows(vice, 40 + 2 * dx, 40 + 2 * dy);
      await vice.joystick(0);
      await vice.frames(L.main_loop, 10);
      await assertShows(vice, 40 + 2 * dx, 40 + 2 * dy);
    }));

test('fire, and opposite directions together, move nothing', () =>
  run(async (vice) => {
    for (const bits of [JOY.FIRE, JOY.LEFT | JOY.RIGHT, JOY.UP | JOY.DOWN]) {
      await vice.joystick(bits);
      await vice.frames(L.main_loop, 8);
      await assertShows(vice, 9, 8);
    }
  }));

for (const [corner, x, y, bits] of [
  ['north-west', 0, 0, JOY.UP | JOY.LEFT], ['south-east', MAX_X, MAX_Y, JOY.DOWN | JOY.RIGHT],
  ['north-east', MAX_X, 0, JOY.UP | JOY.RIGHT], ['south-west', 0, MAX_Y, JOY.DOWN | JOY.LEFT],
])
  test(`the view stops at the ${corner} corner of the city`, () =>
    run(async (vice) => {
      // One tile short of the corner: the first step arrives, and pushing on goes no further.
      await place(vice, x === 0 ? 1 : x - 1, y === 0 ? 1 : y - 1);
      await vice.joystick(bits);
      await vice.frames(L.main_loop, 1);
      await assertShows(vice, x, y);
      await vice.frames(L.main_loop, 20);
      await assertShows(vice, x, y);
    }));

test('the starting tile can be chosen at build time', () => {
  const elsewhere = assemble('city-viewer-elsewhere', { defs: { START_X: 40, START_Y: 60 } });
  return withProgram(elsewhere.prg, async (vice) => {
    await vice.runTo(elsewhere.labels.main_loop);
    await assertShows(vice, 40, 60);
  });
});

test('a long wander: the view follows the stick exactly, and the screen is right at the end', () =>
  run(async (vice) => {
    // The same rules as move_view in src/main.asm, kept here as a second opinion.
    let x = 9, y = 8, wait = 0, seed = 64;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16;
    let bits = 0;
    for (let pass = 0; pass < 1500; pass++) {
      if (pass % 7 === 0) {
        bits = random() & 31;
        await vice.joystick(bits);
      }
      await vice.frames(L.main_loop, 1);
      if (wait > 0) wait--;
      else {
        const fromX = x, fromY = y;
        if (bits & JOY.LEFT && x > 0) x--;
        if (bits & JOY.RIGHT && x < MAX_X) x++;
        if (bits & JOY.UP && y > 0) y--;
        if (bits & JOY.DOWN && y < MAX_Y) y++;
        if (x !== fromX || y !== fromY) wait = MOVE_EVERY - 1;
      }
      assert.deepEqual(await camera(vice), [x, y], `after ${pass + 1} passes`);
    }
    assert.equal((await vice.registers()).SP, 0xff, 'the stack is where it started');
    await assertShows(vice, x, y);
  }));
