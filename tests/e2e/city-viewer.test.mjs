// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the city viewer: the real program, running in VICE, driven through the joystick port.
// Most checks compare what VICE actually drew, pixel by pixel, with a model of what the city looks like at
// the window's position. Each test starts its own emulator, so they do not depend on one another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import {
  Camera, FAST, MAX_X, MAX_Y, ROWS, SCREEN_A, SCREEN_B, SPEED, assemble, assets, camera, expectedReadout,
  frontScreen, pictureMismatches, readPanel, screenMismatches, withProgram,
} from './game.mjs';

const game = assemble('city-viewer', { defs: { VIEWER: 1 } });
const L = game.labels;
const START = [9 * 16, 8 * 16];

/** Start the program and stop at the top of the main loop's first pass, with the first picture up. */
const run = (body, program = game) =>
  withProgram(program.prg, async (vice) => {
    await vice.runTo(program.labels.ready);
    return body(vice);
  });

/**
 * From the top of a pass (`ready`), check the frame that pass is shown in: the window position in the
 * program's variables, then, at the bottom interrupt that ends the frame, every pixel VICE drew.
 */
async function assertFrame(vice, x, y, what = '') {
  assert.deepEqual(await camera(vice, L), [x, y], `where the window is ${what}`);
  assert.equal((await readPanel(vice))[1], expectedReadout(x, y), `the readout ${what}`);
  assert.deepEqual(await screenMismatches(vice, x, y, L), [], `screen and colour memory at ${x},${y} ${what}`);
  await vice.runTo(L['frame.bottom']);
  assert.deepEqual(await pictureMismatches(vice, x, y), [], `the picture at ${x},${y} ${what}`);
}

/** Put the window somewhere directly, as the game will on a respawn, and wait until it is on screen. */
async function teleport(vice, x, y) {
  await vice.write(L.cam_lo, [x & 255, y & 255]);
  await vice.write(L.cam_hi, [x >> 8, y >> 8]);
  await vice.write(L.busy, [0]);
  await vice.frames(L.ready, 2); // a pass to draw the other screen, then one to swap and colour it
}

test('it starts with the city at the starting tile, and the panel under it', () =>
  run(async (vice) => {
    await vice.frames(L.ready, 1); // the first frame may have been part drawn before the program set up
    assert.deepEqual(await readPanel(vice), [
      'SLEAZEBURG 64 - THE CITY VIEWER',
      expectedReadout(...START),
      'JOYSTICK IN PORT 2. FIRE GOES FASTER',
    ]);
    assert.equal(expectedReadout(...START), 'TILE 09,08    CROSSING 2-2');
    await assertFrame(vice, ...START);
  }));

test('the picture is right at every one of the 64 fine scroll positions, panel and black band included', () =>
  run(async (vice) => {
    for (let fy = 0; fy < 8; fy++)
      for (let fx = 0; fx < 8; fx++) {
        const x = 600 + fx, y = 400 + fy;
        await teleport(vice, x, y);
        await assertFrame(vice, x, y, `(fine scroll ${7 - fx},${7 - fy})`);
        await vice.runTo(L['frame.shown']); // the city's registers, as put in place for the next frame
        const [d011, d016] = await vice.read(0xd011, 6).then((r) => [r[0], r[5]]);
        assert.equal(d011 & 0x7f, 0x10 | (7 - fy), 'screen on, 24 rows, fine scroll');
        assert.equal(d016 & 0x1f, 0x10 | (7 - fx), 'multicolour, 38 columns, fine scroll');
      }
  }));

test('the video chip is set up for the city from the program\'s own screens and character set', () =>
  run(async (vice) => {
    await vice.runTo(L['frame.shown']);
    const vic = await vice.read(0xd000, 0x30);
    assert.ok([0xce, 0xde].includes(vic[0x18] & 0xfe), 'one of the two screens, characters at $3800');
    assert.deepEqual([vic[0x20], vic[0x21], vic[0x22], vic[0x23]].map((c) => c & 15), [0, 11, 15, 0], 'border and the city\'s three shared colours');
    assert.equal(vic[0x1a] & 15, 1, 'raster interrupts only');
    assert.equal(vic[0x15], 0, 'no sprites yet');
    assert.equal((await vice.read(0xdd00, 1))[0] & 3, 3, 'the video chip looks at the first 16K');
  }));

test('the program owns the machine: ROMs out, the stack empty at the top of the loop', () =>
  run(async (vice) => {
    assert.equal((await vice.read(0x01, 1))[0] & 7, 5, 'BASIC and KERNAL switched out, I/O in');
    const r = await vice.registers();
    assert.equal(r.SP, 0xff);
    assert.equal(r.PC, L.ready);
    assert.equal(r.FL & 4, 0, 'interrupts are on');
  }));

test('the character set, tiles and map are in memory where the program expects them', () =>
  run(async (vice) => {
    assert.ok((await vice.read(L.charset, 2048)).equals(assets.chars), 'character set');
    assert.ok((await vice.read(L.tile_tl, assets.tiles.length)).equals(assets.tiles), 'tile definitions, character colours, tile kinds and colours');
    assert.ok((await vice.read(L.city_map, assets.map.length)).equals(assets.map), 'map');
  }));

for (const [name, bits] of [
  ['right', JOY.RIGHT], ['left', JOY.LEFT], ['down', JOY.DOWN], ['up', JOY.UP],
  ['up and right', JOY.UP | JOY.RIGHT], ['down and left', JOY.DOWN | JOY.LEFT],
  ['down and right, fast', JOY.DOWN | JOY.RIGHT | JOY.FIRE], ['up and left, fast', JOY.UP | JOY.LEFT | JOY.FIRE],
])
  test(`holding the stick ${name} scrolls smoothly: every frame is right`, () =>
    run(async (vice) => {
      const model = new Camera(...START);
      await vice.joystick(bits);
      for (let pass = 0; pass < 24; pass++) {
        model.step(bits);
        await vice.runTo(L.ready);
        await assertFrame(vice, model.x, model.y, `after ${pass + 1} frames`);
      }
      // At full speed the window never has to wait in its character after a swap, and in a straight line
      // it never meets that frame at a character edge, so it keeps its speed exactly. (Slowly on a diagonal
      // it sometimes waits a frame: the model above does the same.)
      const moved = [model.x - START[0], model.y - START[1]].map(Math.abs);
      const pace = bits & JOY.FIRE ? FAST : SPEED;
      const straight = moved.includes(0);
      if (straight || pace === FAST)
        for (const d of moved) assert.ok(d === 0 || d === 24 * pace, `${pace} pixels a frame, every frame (moved ${moved})`);
    }));

test('fire alone, and opposite directions together, move nothing', () =>
  run(async (vice) => {
    for (const bits of [JOY.FIRE, JOY.LEFT | JOY.RIGHT, JOY.UP | JOY.DOWN, JOY.LEFT | JOY.RIGHT | JOY.UP | JOY.DOWN]) {
      await vice.joystick(bits);
      await vice.frames(L.ready, 5);
      assert.deepEqual(await camera(vice, L), START);
    }
  }));

for (const [corner, x, y, bits] of [
  ['north-west', 0, 0, JOY.UP | JOY.LEFT], ['south-east', MAX_X, MAX_Y, JOY.DOWN | JOY.RIGHT],
  ['north-east', MAX_X, 0, JOY.UP | JOY.RIGHT], ['south-west', 0, MAX_Y, JOY.DOWN | JOY.LEFT],
])
  test(`the window stops at the ${corner} corner of the city`, () =>
    run(async (vice) => {
      // A little short of the corner, then pushing on into it at full speed.
      const nearX = x === 0 ? 5 : x - 5, nearY = y === 0 ? 5 : y - 5;
      await teleport(vice, nearX, nearY);
      const model = new Camera(nearX, nearY);
      await vice.joystick(bits | JOY.FIRE);
      for (let pass = 0; pass < 6; pass++) {
        model.step(bits | JOY.FIRE);
        await vice.runTo(L.ready);
      }
      assert.deepEqual([model.x, model.y], [x, y], 'the model agrees it is in the corner');
      await assertFrame(vice, x, y);
    }));

test('the starting tile can be chosen at build time', () => {
  const elsewhere = assemble('city-viewer-elsewhere', { defs: { VIEWER: 1, START_X: 40, START_Y: 60 } });
  return run(async (vice) => {
    assert.deepEqual(await camera(vice, elsewhere.labels), [640, 960]);
    assert.deepEqual(await screenMismatches(vice, 640, 960, elsewhere.labels), []);
  }, elsewhere);
});

test('a long wander: the window follows the stick exactly, both screens stay right, and no frame is late', () =>
  run(async (vice) => {
    const model = new Camera(...START);
    let seed = 64;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16;
    model.step(0); // the first frame after start can be missed: count from the second
    await vice.runTo(L.ready);
    const missedBefore = (await vice.read(L['frame.missed'], 2)).readUInt16LE(0);
    let bits = 0;
    for (let pass = 0; pass < 1200; pass++) {
      if (pass % 9 === 0) {
        bits = random() & 31;
        await vice.joystick(bits);
      }
      model.step(bits);
      await vice.runTo(L.ready);
      assert.deepEqual(await camera(vice, L), [model.x, model.y], `after ${pass + 1} passes`);
      if (pass % 50 === 0) assert.deepEqual(await screenMismatches(vice, model.x, model.y, L), [], `after ${pass + 1} passes`);
    }
    assert.equal((await vice.registers()).SP, 0xff, 'the stack is where it started');
    const missed = (await vice.read(L['frame.missed'], 2)).readUInt16LE(0) - missedBefore;
    assert.equal(missed, 0, 'every frame had a new picture ready in time');
    await assertFrame(vice, model.x, model.y, 'at the end');
  }));

test('at full speed diagonally for ten seconds, every frame is ready in time', (t) =>
  run(async (vice) => {
    await teleport(vice, 0, 0);
    const before = await vice.read(L['frame.count'], 4);
    await vice.joystick(JOY.DOWN | JOY.RIGHT | JOY.FIRE);
    // 1200 pixels: almost the whole city. Note how far past the bottom interrupt each pass gets before it
    // has the next frame ready: the bottom interrupt comes again 312 lines on.
    let latest = 0;
    for (let pass = 0; pass < 300; pass++) {
      await vice.runTo(L['frame.publish']);
      latest = Math.max(latest, ((await vice.registers()).LIN - 250 + 312) % 312);
      await vice.runTo(L.ready);
    }
    t.diagnostic(`the busiest pass was ready ${latest} raster lines after the bottom interrupt, of 312`);
    const after = await vice.read(L['frame.count'], 4);
    const frames = after.readUInt16LE(0) - before.readUInt16LE(0);
    const missed = after.readUInt16LE(2) - before.readUInt16LE(2);
    assert.equal(missed, 0, `no late frames (${missed} of ${frames})`);
    assert.equal(frames, 300, 'one pass of the main loop per frame');
    assert.deepEqual(await camera(vice, L), [1200, 1200]);
    // How much of the frame the busiest passes leave over: the raster line where the main loop is done.
    await assertFrame(vice, 1200, 1200);
  }));

test('the hidden screen is not shown while it is being drawn: the shown one never changes under the beam', () =>
  run(async (vice) => {
    await vice.joystick(JOY.RIGHT | JOY.FIRE);
    for (let pass = 0; pass < 12; pass++) {
      await vice.runTo(L.ready);
      const shown = await frontScreen(vice, L);
      const before = await vice.read(shown, ROWS * 40);
      await vice.runTo(L['frame.bottom']); // the pass draws whatever it draws
      assert.ok((await vice.read(shown, ROWS * 40)).equals(before), `the shown screen stayed as it was (pass ${pass + 1})`);
      assert.ok([SCREEN_A, SCREEN_B].includes(shown));
    }
  }));
