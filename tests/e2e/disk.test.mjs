// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end test of the disk (`make disk`: src/loader.asm, then the game): booted in VICE from the disk image,
// the loader shows the sunset picture saying LOADING while the KERNAL loads the game from the drive, then the
// game's title page shows it saying PRESS FIRE ..., and fire starts the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { JOY, ROOT } from './vice.mjs';
import { assemble, readPanel, withProgram } from './game.mjs';
import { HEIGHT, LOADING, WIDTH, bitmap, colours, difficulty, readPng, text } from '../../tools/picture.mjs';

execFileSync('make', ['--quiet', 'build/sleazeburg64.d64'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
// The disk's two files, read back out of it; and a folder holding them, as VICE's drive 8. (VICE's own drive
// can only load the first file of a disk image here: a 1541 needs its ROM, which is not here, and VICE's
// virtual drive answers only its autostart. A folder it serves as a drive, file by file, as a 1541 would.)
const DIR = 'build/disk';
mkdirSync(join(ROOT, DIR), { recursive: true });
const files = { 'loader.prg': 'sleazeburg 64', game: 'game' }; // (the folder's names: VICE finds GAME as game)
for (const [as, name] of Object.entries(files)) {
  rmSync(join(ROOT, DIR, as), { force: true });
  execFileSync('c1541', ['-silent', '-attach', 'build/sleazeburg64.d64', '-read', name, `${DIR}/${as}`], { cwd: ROOT, stdio: 'ignore' });
}
const G = assemble('disk-game', { defs: { TITLE: 1 } }).labels; // the game on the disk: its labels, all of them
const loader = assemble('loader', { source: 'src/loader.asm' });
const png = readPng(readFileSync(join(ROOT, 'assets/title-sunset.png')));
const shown = (words) => bitmap(text(colours(png), words)).shown;
const titled = (words) => bitmap(difficulty(text(colours(png), words), 0)).shown; // (the title page: classic's line too)
const FIRST = 51, LEFT = 24; // the screen's first line and pixel (vice.mjs's display)

async function wrong(vice, want) {
  const d = await vice.display();
  let n = 0;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) for (const half of [0, 1]) if (d.at(LEFT + 2 * x + half, FIRST + y) !== want[y * WIDTH + x]) n++;
  return n;
}

test('the disk holds the loader first, then the game, as they were built', () => {
  assert.ok(readFileSync(join(ROOT, DIR, 'loader.prg')).equals(readFileSync(join(ROOT, 'build/loader.prg'))), 'the loader');
  assert.ok(readFileSync(join(ROOT, DIR, 'game')).equals(readFileSync(join(ROOT, 'build/sleazeburg64.prg'))), 'the game');
  const list = execFileSync('c1541', ['-attach', 'build/sleazeburg64.d64', '-list'], { cwd: ROOT, encoding: 'latin1' });
  assert.match(list, /"sleazeburg 64"\s+prg[^\n]*\n[^\n]*"game"\s+prg/, 'in that order');
});

test('the loader: the picture says LOADING while the game loads, then PRESS FIRE ..., and fire starts the game', () =>
  withProgram(`${DIR}/loader.prg`, async (vice) => {
    // (Its code runs at $be00, where the BASIC ROM is too, which BASIC runs as the disk is started: so its start
    // first, which is in RAM, and only then its points up there.)
    await vice.runTo(loader.labels.start);
    await vice.runTo(loader.labels.loading);
    for (let i = 0; i < 60; i++) await vice.runTo(0xea31); // (a second: the KERNAL's interrupt is once a frame, and in
    // warp VICE draws only some frames)
    assert.equal(await wrong(vice, shown(LOADING)), 0, 'the picture saying LOADING, as the game is loaded');
    await vice.runTo(loader.labels.loaded);
    const file = readFileSync(join(ROOT, 'build/sleazeburg64.prg'));
    assert.ok((await vice.read(0x0801, file.length - 2)).equals(file.subarray(2)), 'the game loaded, byte for byte');
    for (let i = 0; i < 312 * 3; i++) await vice.runTo(G['title_page.each_frame']);
    do await vice.runTo(G['title_page.each_frame']); // (on to the top border: the picture is all of one frame)
    while ((await vice.registers()).LIN > 40);
    const lit = await wrong(vice, titled());
    const dark = await wrong(vice, titled(''));
    assert.ok(lit === 0 || dark === 0, `then the game's title page (${lit}, ${dark} pixels wrong)`);
    await vice.joystick(JOY.FIRE);
    await vice.runTo(G.ready);
    await vice.joystick(0);
    await vice.runTo(G.ready);
    assert.equal((await readPanel(vice))[0], '$000000 HEAT ***** HP????? CAR???   FIST', 'the game, running');
  }, { extra: ['-iecdevice8', '-device8', '1', '-fs8', DIR] }));
