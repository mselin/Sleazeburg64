// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the music builds, in VICE, with made-up tunes in place of the real ones (see
// test-tunes.mjs). They cover the code this project wrote around a tune: putting it where it plays from,
// calling it, crediting it on screen, and handing over from the title screen to the game. Whether a real
// tune sounds right is not something a test can tell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { JOY, ROOT } from './vice.mjs';
import { INGAME, TITLE, writeTestTunes } from './test-tunes.mjs';
import { OUT, SCREEN, assemble, assets, expectedView, readPanel, readView, screenText, withProgram } from './game.mjs';

const TUNES = `${OUT}/tunes`;
const manifest = writeTestTunes(join(ROOT, TUNES));
for (const role of ['title', 'ingame'])
  execFileSync(process.execPath, ['tools/sid.mjs', role, TUNES, manifest], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });

// The game with a tune. Its labels and program go where the title screen's source looks for them.
const GAME_DIR = `${OUT}/music`;
const game = assemble('music/sleazeburg64-ingame', { defs: { MUSIC: 1 }, include: [TUNES] });
execFileSync('cp', [game.labelFile, `${GAME_DIR}/labels-ingame.txt`], { cwd: ROOT });
const title = assemble('music/title', { source: 'src/title.asm', include: [GAME_DIR, TUNES] });
const G = game.labels;
const T = title.labels;

const CREDIT_FRAMES = 200;
const counter = async (vice) => (await vice.read(INGAME.counter, 2)).readUInt16LE(0);

test('the tune is copied to its own address and started with the subtune the manifest names', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.main_loop);
    const code = Buffer.from(INGAME.code);
    const fixed = INGAME.song - INGAME.load; // the bytes before the ones init and play change
    assert.ok((await vice.read(INGAME.load, fixed)).equals(code.subarray(0, fixed)), 'the tune is at $e000');
    assert.equal((await vice.read(INGAME.song, 1))[0], INGAME.subtune - 1, 'init was given the subtune, counted from 0');
    assert.equal(await counter(vice), 0, 'play has not been called yet');
    const after = await vice.read(INGAME.load + code.length, 256);
    assert.ok(after.every((b) => b === 0), 'the page after the tune is cleared, for tunes that read past their end');
  }));

test('the tune is played exactly once for every pass of the main loop, moving or not', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.main_loop);
    await vice.frames(G.main_loop, 100);
    assert.equal(await counter(vice), 100);
    await vice.joystick(JOY.RIGHT | JOY.DOWN); // redrawing the view must not cost the tune a call
    await vice.frames(G.main_loop, 200);
    assert.equal(await counter(vice), 300);
    await vice.joystick(0);
    await vice.frames(G.main_loop, 100);
    assert.equal(await counter(vice), 400);
    assert.equal((await vice.registers()).SP, 0xff);
  }));

test('the tune has not disturbed the game: the view still follows the stick and draws the city', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.main_loop);
    await vice.joystick(JOY.RIGHT);
    await vice.frames(G.main_loop, 30);
    await vice.joystick(0);
    await vice.frames(G.main_loop, 3);
    const [x, y] = await vice.read(G.cam_x, 2);
    assert.deepEqual([x, y], [19, 8]);
    const shown = await readView(vice);
    const wanted = expectedView(x, y);
    assert.ok(shown.chars.equals(wanted.chars) && shown.colours.equals(wanted.colours));
  }));

test('the panel credits the tune: title, then author and copyright, then the hint, and round again', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.main_loop);
    const bottomRow = async () => (await readPanel(vice))[2];
    const lines = ['MUSIC: TEST TUNE', 'NOBODY (C) 2026 THE TESTS', 'JOYSTICK IN PORT 2 MOVES THE VIEW'];
    assert.equal(await bottomRow(), lines[0], 'the title is up from the first frame');
    for (let turn = 1; turn <= 4; turn++) {
      await vice.frames(G.main_loop, CREDIT_FRAMES - 1);
      assert.equal(await bottomRow(), lines[(turn - 1) % 3], 'each line stays its full time');
      await vice.frames(G.main_loop, 1);
      assert.equal(await bottomRow(), lines[turn % 3]);
    }
    assert.deepEqual((await readPanel(vice)).slice(0, 2), ['SLEAZEBURG 64 - THE CITY VIEWER', 'TILE 09,08    CROSSING 3-2'], 'the other rows are left alone');
  }));

test('the title screen credits both tunes, says the build is not for distribution, and starts its tune', () =>
  withProgram(title.prg, async (vice) => {
    await vice.runTo(T.wait_fire);
    const rows = screenText(await vice.read(SCREEN, 1000)).match(/.{40}/g).map((row) => row.trim());
    const shown = rows.filter((row) => row !== '');
    assert.deepEqual(shown, [
      'SLEAZEBURG 64',
      'MUSIC TEST BUILD - NOT FOR DISTRIBUTION',
      'MUSIC: TEST FANFARE',
      'NOBODY (C) 2026 THE TESTS',
      'THEN, IN THE GAME',
      'MUSIC: TEST TUNE',
      'NOBODY (C) 2026 THE TESTS',
      'PRESS FIRE - JOYSTICK IN PORT 2',
    ]);
    assert.equal((await vice.read(TITLE.mark, 1))[0], 42, 'the title tune was started');
    assert.equal((await vice.read(0xdc02, 1))[0], 0, 'the joystick lines are inputs');
  }));

test('the title screen waits for fire while its tune runs from interrupts: directions do not start the game', () =>
  withProgram(title.prg, async (vice) => {
    await vice.runTo(T.wait_fire);
    await vice.joystick(JOY.UP | JOY.DOWN | JOY.LEFT | JOY.RIGHT);
    await vice.frames(T.wait_fire, 4000); // would time out if the program had left the title screen
    assert.equal((await vice.registers()).PC, T.wait_fire);
    const [irqs, nmis] = await vice.read(TITLE.irqCount, 2);
    assert.ok(irqs > 0 && nmis > 0, `the tune's interrupts are running (${irqs} raster, ${nmis} timer)`);
  }));

test('fire on the title screen starts the game, moved into place whole and playing its tune', () =>
  withProgram(title.prg, async (vice) => {
    await vice.runTo(T.wait_fire);
    await vice.frames(T.wait_fire, 4000); // long enough for the title tune's interrupts to be going
    assert.ok((await vice.read(TITLE.irqCount, 2)).every((count) => count > 0));
    await vice.joystick(JOY.FIRE);
    // Before the game is moved the title tune must be stopped for good: its code is about to be overwritten.
    // The counters sit in the gap the move leaves alone, so they can be read again afterwards.
    await vice.runTo(T.move_game);
    const stoppedAt = await vice.read(TITLE.irqCount, 2);
    await vice.runTo(G.main_loop);
    await vice.joystick(0);
    assert.deepEqual(await vice.read(TITLE.irqCount, 2), stoppedAt, 'no interrupt of the title tune ran during the move');

    // Every byte of the game is where the game built on its own has it: code, then the data from the
    // character set to the end. (The gap between them holds nothing and is not carried.)
    const codeSize = G.code_end - 0x0801;
    assert.ok((await vice.read(0x0801, codeSize)).equals(game.bytes.subarray(2, 2 + codeSize)), 'code');
    const dataAt = 2 + G.charset - 0x0801;
    // The tune's waiting copy is part of the data and nothing writes to it, so it compares too.
    assert.ok((await vice.read(G.charset, G.program_end - G.charset)).equals(game.bytes.subarray(dataAt)), 'data');
    assert.ok((await vice.read(G.charset, 2048)).equals(assets.chars));

    // The machine is the game's: the title tune's interrupts are off and the game draws and plays.
    assert.equal((await vice.read(0x01, 1))[0] & 7, 5);
    assert.equal((await vice.read(0xd01a, 1))[0] & 15, 0, 'no raster interrupts left on');
    assert.equal((await vice.read(0xdd0e, 1))[0] & 1, 1, 'the title tune did have its timer going');
    const shown = await readView(vice);
    const wanted = expectedView(9, 8);
    assert.ok(shown.chars.equals(wanted.chars) && shown.colours.equals(wanted.colours), 'the city is drawn');
    assert.equal((await readPanel(vice))[2], 'MUSIC: TEST TUNE');
    await vice.frames(G.main_loop, 50);
    assert.equal(await counter(vice), 50, 'the game tune is playing');
    assert.equal((await vice.registers()).SP, 0xff);
  }));
