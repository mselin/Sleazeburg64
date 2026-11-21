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
import {
  OUT, assemble, assets, camera, expectedReadout, pictureMismatches, readPanel, screenMismatches, screenText, withProgram,
} from './game.mjs';

const TUNES = `${OUT}/tunes`;
const manifest = writeTestTunes(join(ROOT, TUNES));
for (const role of ['title', 'ingame'])
  execFileSync(process.execPath, ['tools/sid.mjs', role, TUNES, manifest], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });

// The game with a tune. Its labels and program go where the title screen's source looks for them.
const GAME_DIR = `${OUT}/music`;
// VIEWER: the stick moves the window itself, so these tests can scroll exactly as they need.
const game = assemble('music/sleazeburg64-ingame', { defs: { MUSIC: 1, VIEWER: 1 }, include: [TUNES] });
execFileSync('cp', [game.labelFile, `${GAME_DIR}/labels-ingame.txt`], { cwd: ROOT });
const title = assemble('music/title', { source: 'src/title.asm', include: [GAME_DIR, TUNES] });
const G = game.labels;
const T = title.labels;

const CREDIT_FRAMES = 200;
const TITLE_SCREEN = 0x0400;
const HINT = 'JOYSTICK IN PORT 2. FIRE GOES FASTER';
const counter = async (vice) => (await vice.read(INGAME.counter, 2)).readUInt16LE(0);

test('the tune is copied to its own address and started with the subtune the manifest names', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.ready);
    const code = Buffer.from(INGAME.code);
    const fixed = INGAME.song - INGAME.load; // the bytes before the ones init and play change
    assert.ok((await vice.read(INGAME.load, fixed)).equals(code.subarray(0, fixed)), 'the tune is at $e000');
    assert.equal((await vice.read(INGAME.song, 1))[0], INGAME.subtune - 1, 'init was given the subtune, counted from 0');
    assert.equal(await counter(vice), 0, 'play has not been called yet');
    const after = await vice.read(INGAME.load + code.length, 256);
    assert.ok(after.every((b) => b === 0), 'the page after the tune is cleared, for tunes that read past their end');
  }));

test('the tune is played exactly once a frame, by the interrupt, moving or not', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.ready);
    const start = await counter(vice);
    await vice.frames(G['frame.shown'], 100);
    assert.equal(await counter(vice) - start, 100);
    await vice.joystick(JOY.RIGHT | JOY.DOWN | JOY.FIRE); // moving the screens must not cost the tune a call
    await vice.frames(G['frame.shown'], 200);
    assert.equal(await counter(vice) - start, 300);
    await vice.joystick(0);
    await vice.frames(G['frame.shown'], 100);
    assert.equal(await counter(vice) - start, 400);
  }));

test('with the tune\'s load the game still makes every frame in time, and every frame is right', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.ready);
    const missed = async () => (await vice.read(G['frame.missed'], 2)).readUInt16LE(0);
    const before = await missed();
    await vice.joystick(JOY.RIGHT | JOY.DOWN | JOY.FIRE); // the most work there is: a new screen every other frame
    for (let pass = 1; pass <= 40; pass++) {
      await vice.runTo(G.ready);
      const [x, y] = await camera(vice, G);
      assert.deepEqual([x, y], [144 + 4 * pass, 128 + 4 * pass]);
      assert.deepEqual(await screenMismatches(vice, x, y, G), [], `screen and colours after ${pass} frames`);
      await vice.runTo(G['frame.bottom']);
      assert.deepEqual(await pictureMismatches(vice, x, y), [], `the picture after ${pass} frames`);
    }
    assert.equal(await missed() - before, 0, 'no frame was late');
  }));

test('driving the car flat out with the tune playing: the car follows the model and no frame is late', async (t) => {
  const withCar = assemble('music/car', { defs: { MUSIC: 1 }, include: [TUNES] });
  const { Car } = await import('./car-model.mjs');
  const { Camera, CENTRE_X, CENTRE_Y } = await import('./game.mjs');
  const C = withCar.labels;
  return withProgram(withCar.prg, async (vice) => {
    await vice.runTo(C.ready);
    const car = new Car(144 + CENTRE_X, 128 + CENTRE_Y), cam = new Camera(144, 128);
    const missed = async () => (await vice.read(C['frame.missed'], 2)).readUInt16LE(0);
    // The first frame after start can be missed: setting up can end too near the bottom of the screen for
    // the first pass to make it. Count from the second.
    car.step(0);
    cam.follow(car.px, car.py);
    await vice.runTo(C.ready);
    const before = await missed();
    let latest = 0;
    await vice.joystick(JOY.UP);
    for (let frame = 1; frame <= 240; frame++) {
      car.step(JOY.UP);
      cam.follow(car.px, car.py);
      await vice.runTo(C['frame.publish']);
      latest = Math.max(latest, ((await vice.registers()).LIN - 250 + 312) % 312);
      await vice.runTo(C.ready);
      assert.deepEqual(await camera(vice, C), [cam.x, cam.y], `the window after ${frame} frames`);
    }
    t.diagnostic(`with the tune, the busiest pass was ready ${latest} raster lines after the bottom interrupt, of 312`);
    assert.equal(await missed() - before, 0, 'no frame was late');
  });
});

test('with the car, the panel\'s messages come first, and the credits take turns, in light blue, when there is none', () => {
  const withCar = assemble('music/car', { defs: { MUSIC: 1 }, include: [TUNES] });
  const C = withCar.labels;
  const IN_CAR = 'FIRE: HANDBRAKE. STANDING STILL: GET OUT', ON_FOOT = 'STAND BY A CAR AND PRESS FIRE TO GET IN';
  const CREDITS = ['MUSIC: TEST TUNE', 'NOBODY (C) 2026 THE TESTS'];
  const LIGHT_BLUE = 14;
  const message = (text) => Math.max(200, text.length * 7 + 75); // frames it is up (status.asm)
  return withProgram(withCar.prg, async (vice) => {
    await vice.runTo(C.ready);
    /** Every line the bottom row shows, every 20 frames for `frames`. */
    const lines = async (frames) => {
      const seen = [];
      for (let frame = 0; frame < frames; frame += 20) {
        await vice.frames(C.ready, 20);
        const row = (await readPanel(vice))[2];
        if (seen[seen.length - 1] !== row) seen.push(row);
      }
      return seen;
    };
    const first = await lines(message(IN_CAR) + 2 * CREDIT_FRAMES + 40);
    assert.equal(first[0], IN_CAR, 'the message first');
    assert.deepEqual(new Set(first.slice(1)), new Set(CREDITS), 'then the credits, both, in turn');
    assert.ok(first.length >= 4, `taking turns: ${first}`);
    const colours = await vice.read(0xd800 + 23 * 40, 40);
    assert.deepEqual([...colours].map((c) => c & 15), Array(40).fill(LIGHT_BLUE));
    await vice.joystick(JOY.FIRE); // with the stick centred and the car standing: out
    await vice.frames(C.ready, 2);
    await vice.joystick(0);
    assert.equal((await vice.read(C['foot.on'], 1))[0], 1, 'the player is out of the car');
    const after = await lines(message(ON_FOOT) + 2 * CREDIT_FRAMES + 40);
    assert.equal(after[0], ON_FOOT, 'on foot: its message, and then ...');
    assert.deepEqual(new Set(after.slice(1)), new Set(CREDITS), '... the credits again');
  });
});

test('the panel credits the tune: title, then author and copyright, then the hint, and round again', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(G.ready);
    const bottomRow = async () => (await readPanel(vice))[2];
    const lines = ['MUSIC: TEST TUNE', 'NOBODY (C) 2026 THE TESTS', HINT];
    assert.equal(await bottomRow(), lines[0], 'the title is up from the start');
    // Find the frame where it first changes, then each line must stay exactly its time.
    let waited = 0;
    while ((await bottomRow()) === lines[0]) {
      await vice.frames(G['frame.shown'], 1);
      assert.ok(++waited <= CREDIT_FRAMES, 'the title changes within its time');
    }
    for (let turn = 1; turn <= 4; turn++) {
      assert.equal(await bottomRow(), lines[turn % 3]);
      await vice.frames(G['frame.shown'], CREDIT_FRAMES - 1);
      assert.equal(await bottomRow(), lines[turn % 3], 'each line stays its full time');
      await vice.frames(G['frame.shown'], 1);
    }
    assert.deepEqual((await readPanel(vice)).slice(0, 2), ['SLEAZEBURG 64 - THE CITY VIEWER', expectedReadout(144, 128)], 'the other rows are left alone');
  }));

test('the title screen credits both tunes, says the build is not for distribution, and starts its tune', () =>
  withProgram(title.prg, async (vice) => {
    await vice.runTo(T.wait_fire);
    const rows = screenText(await vice.read(TITLE_SCREEN, 1000)).match(/.{40}/g).map((row) => row.trim());
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
    // The file goes past the end of BASIC's memory, and BASIC still ran it: its end-of-program pointer, set
    // as LOAD sets it, is where the file ends.
    const end = (await vice.read(0x2d, 2)).readUInt16LE(0);
    assert.equal(end, 0x0801 + title.bytes.length - 2, 'BASIC knows where the program ends');
    assert.ok(end > 0xa000 && end <= 0xd000, `the program ends at ${end.toString(16)}, past a000 and before d000`);
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
    assert.ok(TITLE.irqCount >= G.code_end && TITLE.irqCount < 0x3000, 'the counters are out of the way of the move');
    await vice.runTo(T.move_game);
    const stoppedAt = await vice.read(TITLE.irqCount, 2);
    await vice.runTo(G.start);
    await vice.joystick(0);
    assert.deepEqual(await vice.read(TITLE.irqCount, 2), stoppedAt, 'no interrupt of the title tune ran during the move');

    // Every byte of the game is where the game built on its own has it: code after its BASIC line, then the
    // data from the character set to the end. (The gap between them, the screens, holds nothing and is not
    // carried.) This is checked as the game starts, before it changes any of its own code.
    const codeSize = G.code_end - 0x080d;
    assert.ok((await vice.read(0x080d, codeSize)).equals(game.bytes.subarray(2 + 12, 2 + 12 + codeSize)), 'code');
    const dataAt = 2 + G.charset - 0x0801;
    // The tune's waiting copy is part of the data and nothing writes to it, so it compares too.
    assert.ok((await vice.read(G.charset, G.program_end - G.charset)).equals(game.bytes.subarray(dataAt)), 'data');
    assert.ok((await vice.read(G.charset, 2048)).equals(assets.chars));
    assert.equal((await vice.read(0xd01a, 1))[0] & 15, 0, 'the title tune\'s raster interrupt is off');
    assert.equal((await vice.read(0xdd0e, 1))[0] & 1, 1, 'the title tune did have its timer going');

    // The machine is the game's: it draws, keeps its frames, and plays its own tune.
    await vice.runTo(G.ready);
    assert.equal((await vice.read(0x01, 1))[0] & 7, 5);
    assert.deepEqual(await screenMismatches(vice, 144, 128, G), [], 'the city is drawn');
    assert.equal((await readPanel(vice))[2], 'MUSIC: TEST TUNE');
    const start = await counter(vice);
    await vice.frames(G['frame.shown'], 50);
    assert.equal(await counter(vice) - start, 50, 'the game tune is playing');
    await vice.runTo(G.ready);
    await vice.runTo(G['frame.bottom']);
    assert.deepEqual(await pictureMismatches(vice, 144, 128), [], 'the picture, split and panel included');
  }));
