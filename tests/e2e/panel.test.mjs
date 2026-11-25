// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the status panel (src/status.asm): what each row says and in what colours, how long a
// message stays and how a long one scrolls, the bars, and what changing the money, heat, health and ammo
// shows; with the rest of the game held to the models frame by frame (play.mjs) and no frame late.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { COLOUR_RAM, PANEL_SCREEN, ROWS, assemble, readPanel, withProgram } from './game.mjs';
import { World, assertPicture, missed, pass, putCar } from './play.mjs';

// No traffic of its own and no Big Honk, except where a test says.
const game = assemble('panel', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const full = assemble('panel-full');
const BLACK = 0, WHITE = 1, RED = 2, CYAN = 3, GREEN = 5, YELLOW = 7, LIGHT_RED = 10, DARK_GREY = 11, GREY = 12;
const LIGHT_GREEN = 13, LIGHT_GREY = 15;
const BAR = 255, BAR_PART = (n) => 247 + n; // a whole character of bar, and one with its left n columns
const MESSAGE = {
  CAR: 'FIRE: HANDBRAKE. STANDING STILL: GET OUT',
  FOOT: 'STAND BY A CAR AND PRESS FIRE TO GET IN',
  SUNK: 'THE CAR IS GONE. SWIM FOR IT. THE WARRANTY DOES NOT COVER THIS.',
};
/** How many passes a message is up: 50 frames a second, at least 4 seconds or 0.14 s a character + 1.5. */
const frames = (text) => Math.max(200, text.length * 7 + 75);
const NO_JOB = 'NO JOB. FOLLOW THE ARROW TO A "J".';
const fund = (money) => `ELECTION FUND: $${money} / $25000`;

const run = (body, prg = game, options = { honk: false, traffic: { spawn: false } }) =>
  withProgram(prg.prg, async (vice) => {
    await vice.runTo(prg.labels.ready);
    const w = new World(options);
    await pass(vice, prg.labels, w, 0, 'first'); // the first frame after start can be missed: count from the second
    await body(vice, w);
  });

async function hold(vice, w, bits, frames, what, labels = L) {
  for (let i = 1; i <= frames; i++) await pass(vice, labels, w, bits, `${what}, frame ${i}`);
}

/** The panel's three rows: screen codes and colours, 40 of each. */
async function readRows(vice) {
  const codes = await vice.read(PANEL_SCREEN + ROWS * 40, 120), colours = await vice.read(COLOUR_RAM + ROWS * 40, 120);
  return [0, 1, 2].map((r) => ({ codes: [...codes.subarray(r * 40, r * 40 + 40)], colours: [...colours.subarray(r * 40, r * 40 + 40)].map((c) => c & 15) }));
}
const columns = (row, from, to) => ({ codes: row.codes.slice(from, to + 1), colours: row.colours.slice(from, to + 1) });

/** Set what row 1 shows, as the game will when something changes it, and give it a pass to be drawn. */
async function set(vice, w, values, what) {
  for (const [name, bytes] of Object.entries(values)) await vice.write(L[`status.${name}`], bytes);
  await vice.write(L['status.changed'], [1]);
  await pass(vice, L, w, 0, what);
}

test('at the start: no money, no heat, full health, the car, no ammo yet (fists); no job; and what fire does', () =>
  run(async (vice, w) => {
    const [one, two, three] = await readPanel(vice);
    assert.equal(one, '$000000 HEAT ***** HP????? CAR???   FIST');
    assert.equal(two, NO_JOB);
    assert.equal(three, MESSAGE.CAR);
    const [r1, r2, r3] = await readRows(vice);
    const ink = (from, to) => r1.colours.slice(from, to + 1);
    assert.deepEqual(ink(0, 6), Array(7).fill(LIGHT_GREEN), 'the money');
    assert.deepEqual(ink(8, 11), Array(4).fill(LIGHT_GREY), 'HEAT');
    assert.deepEqual(ink(13, 17), Array(5).fill(DARK_GREY), 'no stars lit');
    assert.deepEqual(ink(19, 20), Array(2).fill(LIGHT_GREY), 'HP');
    assert.deepEqual(columns(r1, 21, 25), { codes: Array(5).fill(BAR), colours: Array(5).fill(GREEN) }, 'a full health bar');
    assert.deepEqual(ink(27, 29), Array(3).fill(LIGHT_GREY), 'CAR');
    assert.deepEqual(columns(r1, 30, 32), { codes: Array(3).fill(BAR), colours: Array(3).fill(CYAN) }, 'a full car bar');
    assert.deepEqual(ink(36, 39), Array(4).fill(LIGHT_RED), 'fists: no ammo until there is a gun');
    assert.deepEqual(r2.colours.slice(0, NO_JOB.length), Array(NO_JOB.length).fill(GREY), 'no job, in grey');
    assert.deepEqual(r3.colours, Array(40).fill(WHITE), 'the message in white');
    await assertPicture(vice, L, w, 'with the panel');
  }));

test('a message stays for its time, then the election fund shows; getting out hides the car\'s part, getting in shows it', () =>
  run(async (vice, w) => {
    const before = await missed(vice, L);
    await pass(vice, L, w, 0, 'before fire');
    await pass(vice, L, w, JOY.FIRE, 'out of the car');
    assert.equal(w.player.on, 1);
    let [one, , three] = await readPanel(vice);
    assert.equal(one, '$000000 HEAT ***** HP?????          FIST', 'no car, so no CAR and no bar');
    assert.equal(three, MESSAGE.FOOT);
    let shown = 0; // passes it was up in, the one it was said in included
    while ((await readPanel(vice))[2] === MESSAGE.FOOT) {
      assert.ok(++shown <= 1000);
      await pass(vice, L, w, 0, `the message up, ${shown} passes`);
    }
    assert.equal(shown, frames(MESSAGE.FOOT), 'it stayed its time');
    assert.equal((await readPanel(vice))[2], fund(0));
    await pass(vice, L, w, 0, 'the fund up'); // (a new colour comes a frame after the text)
    assert.deepEqual((await readRows(vice))[2].colours, Array(40).fill(DARK_GREY), 'in dark grey');
    await hold(vice, w, 0, 20, 'with the fund up');
    assert.equal((await readPanel(vice))[2], fund(0), 'and it stays');
    await pass(vice, L, w, JOY.FIRE, 'back in');
    assert.equal(w.player.on, 0);
    [one, , three] = await readPanel(vice);
    assert.equal(one, '$000000 HEAT ***** HP????? CAR???   FIST', 'the car\'s part again');
    assert.equal(three, MESSAGE.CAR);
    // White again from the next frame with the time (the window moves to the car first, which can take one).
    for (let i = 1; i <= 4 && (await readRows(vice))[2].colours[0] !== WHITE; i++) await pass(vice, L, w, 0, `in the car, ${i}`);
    assert.deepEqual((await readRows(vice))[2].colours, Array(40).fill(WHITE), 'white again');
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('the flooded car\'s message: up a second, then a character every 6 frames to its end, where it stops', () =>
  run(async (vice, w) => {
    await putCar(vice, L, w, 784, 870); // west of The Moat, facing east, with the canal ahead
    await hold(vice, w, 0, 3, 'after the car was put there');
    let frame = 0;
    while (!w.player.on && frame < 150) await pass(vice, L, w, JOY.UP, `driving in, ${++frame} frames`);
    assert.equal(w.player.on, 1, 'flooded');
    // (The pass it floods in can be one that moves the screen, which writes nothing: start from the next.)
    const seen = [];
    for (let i = 2; i <= frames(MESSAGE.SUNK) + 5; i++) {
      await pass(vice, L, w, 0, `swimming, ${i} passes`);
      seen.push((await readPanel(vice))[2]);
    }
    // Pass by pass, the row from the one it was said in: 50 unscrolled, then a character every 6.
    const most = MESSAGE.SUNK.length - 40;
    const wanted = [];
    for (let i = 1; i < frames(MESSAGE.SUNK); i++) {
      const offset = i < 50 ? 0 : Math.min(most, Math.floor((i - 50) / 6) + 1);
      wanted.push(MESSAGE.SUNK.slice(offset, offset + 40).trimEnd());
    }
    while (wanted.length < seen.length) wanted.push(fund(0));
    assert.deepEqual(seen, wanted);
  }));

test('the money, heat, health and ammo as they change: digits, lit stars that flash, the bars and what fire does', () =>
  run(async (vice, w) => {
    const before = await missed(vice, L);
    await set(vice, w, { money: [0x34, 0x12, 0x00], ammo: [0x07] }, 'money and ammo');
    let [r1] = await readRows(vice);
    assert.equal((await readPanel(vice))[0], '$001234 HEAT ***** HP????? CAR??? AMMO07');
    // The health bar: a pixel column for each 2.5, to the nearest, and red at 30 or below.
    for (const [hp, codes, colour] of [
      [100, [BAR, BAR, BAR, BAR, BAR], GREEN],
      [31, [BAR, BAR_PART(4), BAR, BAR, BAR], GREEN],
      [30, [BAR, BAR_PART(4), BAR, BAR, BAR], RED],
      [3, [BAR_PART(1), BAR, BAR, BAR, BAR], RED],
      [1, [BAR, BAR, BAR, BAR, BAR], RED],
      [0, [BAR, BAR, BAR, BAR, BAR], RED],
    ]) {
      await set(vice, w, { hp: [hp] }, `health ${hp}`);
      [r1] = await readRows(vice);
      const filled = Math.round((hp * 40) / 100), lit = Math.ceil(filled / 8);
      const colours = codes.map((_, i) => (i < lit ? colour : DARK_GREY));
      assert.deepEqual(columns(r1, 21, 25), { codes, colours }, `the health bar at ${hp} (${filled} pixels)`);
    }
    // The car's: 24 pixels, red under 40.
    for (const [hp, codes, colours] of [
      [40, [BAR, BAR_PART(2), BAR], [CYAN, CYAN, DARK_GREY]],
      [39, [BAR, BAR_PART(1), BAR], [RED, RED, DARK_GREY]],
      [100, [BAR, BAR, BAR], [CYAN, CYAN, CYAN]],
    ]) {
      await set(vice, w, { car_hp: [hp] }, `the car at ${hp}`);
      assert.deepEqual(columns((await readRows(vice))[0], 30, 32), { codes, colours }, `the car's bar at ${hp}`);
    }
    // Out of ammo: the knife, or fists.
    await set(vice, w, { ammo: [0], knife: [1] }, 'a knife');
    [r1] = await readRows(vice);
    assert.equal((await readPanel(vice))[0].slice(34), ' KNIFE');
    assert.deepEqual(r1.colours.slice(35, 40), Array(5).fill(LIGHT_GREY));
    await set(vice, w, { knife: [0] }, 'fists');
    [r1] = await readRows(vice);
    assert.equal((await readPanel(vice))[0].slice(34), '  FIST');
    assert.deepEqual(r1.colours.slice(36, 40), Array(4).fill(LIGHT_RED));
    // Heat 3: three stars flash yellow and red, twelve frames each; the other two stay dark grey.
    await set(vice, w, { heat: [3] }, 'heat 3');
    const lit = [];
    for (let i = 0; i < 60; i++) {
      const stars = (await readRows(vice))[0].colours.slice(13, 18);
      assert.deepEqual(stars.slice(3), [DARK_GREY, DARK_GREY]);
      assert.ok(stars[0] === stars[1] && stars[1] === stars[2] && (stars[0] === YELLOW || stars[0] === RED), `the lit ones together: ${stars}`);
      lit.push(stars[0]);
      await pass(vice, L, w, 0, `heat 3, ${i} passes`);
    }
    const runs = [];
    for (const c of lit) if (runs.length && runs[runs.length - 1].c === c) runs[runs.length - 1].n++; else runs.push({ c, n: 1 });
    assert.ok(runs.length >= 4, 'it flashes');
    for (const r of runs.slice(1, -1)) assert.equal(r.n, 12, 'twelve frames a colour');
    // The election fund shows the money without leading zeros once the message has gone.
    await hold(vice, w, 0, frames(MESSAGE.CAR), 'until the first message has gone');
    assert.equal((await readPanel(vice))[2], fund(1234));
    await set(vice, w, { money: [0x00, 0x00, 0x00] }, 'no money');
    assert.equal((await readPanel(vice))[2], fund(0), 'and follows the money');
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('flat out east with traffic and Big Honk while the first message goes: no frame is late', () =>
  withProgram(full.prg, async (vice) => {
    const F = full.labels;
    await vice.runTo(F.ready);
    const w = new World();
    await pass(vice, F, w, 0, 'first');
    const before = await missed(vice, F);
    // Standing until a little before the message goes, then flat out east, past when it does.
    await hold(vice, w, 0, frames(MESSAGE.CAR) - 120, 'standing', F);
    let changedAt = 0;
    for (let frame = 1; frame <= 240; frame++) {
      await pass(vice, F, w, JOY.UP, `flat out, ${frame} frames`);
      if (!changedAt && (await readPanel(vice))[2] !== MESSAGE.CAR) changedAt = frame;
    }
    assert.ok(changedAt > 60, `the message went at full speed (${changedAt} frames in, at ${w.car.vx})`);
    assert.equal((await readPanel(vice))[2], fund(0));
    assert.equal(await missed(vice, F) - before, 0, 'no frame was late');
  }));
