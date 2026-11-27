// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the police (src/police.asm): with heat, police cars come, white, at most the heat's level of
// them, and only they; at a crossing they take the way to the player; near the player, the siren wails, the border
// flashes red and blue and the heat does not cool; boxed in by one, slow, for two seconds, the player is busted. The real program in VICE, the models (traffic-model.mjs, heat-model.mjs) held
// to it frame by frame, as everywhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, readPanel, withProgram } from './game.mjs';
import { BUSTED, HURT, OFFICERS, World, assertPicture, missed, pass, putCar, putOnFoot, putTrafficCar } from './play.mjs';
import { P, putPerson } from './people-model.mjs';
import { DONUT } from './pickups-model.mjs';
import { JOY } from './vice.mjs';
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

test('police cars come to the player; near, the siren wails, the border flashes red and blue every half second, and the heat does not cool', () =>
  run(async (vice, w) => {
    await putOnFoot(vice, L, w, 200, 24, 0);
    await putHeat(vice, L, w.heat, { level: 1, points: 2 * 8, cool: 60000 });
    let i = 0;
    while (!w.traffic.around && i < 3000) await pass(vice, L, w, 0, `waiting for the police, ${++i} frames`);
    assert.equal(w.traffic.around, 1, `a police car came near (${i} frames)`);
    // Near: no cooling, however little time is left; the siren's colours, a half second each.
    await putHeat(vice, L, w.heat, { level: 1, points: 2 * 8, cool: 2 });
    const colours = [], tones = [];
    for (let k = 1; k <= 60 && w.traffic.around; k++) {
      await pass(vice, L, w, 0, `with the police near, ${k} frames`);
      colours.push(await border(vice));
      tones.push(w.traffic.tone); // (the program's, as pass() holds it to the model)
      assert.equal(w.heat.level, 1, 'the heat does not cool');
    }
    // The siren's sound: a wail every 0.7 seconds, 17 frames of the low note, 17 of the high, one of nothing.
    const wail = tones.join('');
    assert.ok(/^1+2{17}01{17}2/.test(wail), `the wail (${wail})`);
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

// ---------- busted ----------
const quiet = assemble('busted', { defs: { HONK: 0, SPAWN: 0 } });
const Q = quiet.labels;
const bcd = (n) => [n % 100, Math.floor(n / 100) % 100, Math.floor(n / 10000)].map((d) => (d / 10 << 4) | d % 10);
const unbcd = (b) => b.reduce((n, d, i) => n + ((d >> 4) * 10 + (d & 15)) * 100 ** i, 0);

/**
 * The player's car standing at the top of the city, facing east, a police car standing `gap` pixels ahead.
 * Four officers lie knocked down out of sight, so that none gets out of the police car (no more than four).
 */
const boxedIn = (gap, body) =>
  withProgram(quiet.prg, async (vice) => {
    await vice.runTo(Q.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, Q, w, 0, 'first');
    await putCar(vice, Q, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
    const cop = await putTrafficCar(vice, Q, w, 0, { x: 200 + gap, y: 24, dir: 2, cruise: 0, col: WHITE });
    cop.cop = 1;
    await vice.write(Q['police.cop'], [1]);
    for (let i = 0; i < 4; i++) {
      const o = await putPerson(vice, Q, w.people, i, { x: 40 + 10 * i, y: 300, spd: P.COP_PACE, col: P.OFFICER, officer: 1 });
      Object.assign(o, { down: 255, ko: 1 });
      await vice.write(Q['people.down'] + i, [255]);
      await vice.write(Q['people.ko'] + i, [1]);
    }
    await putHeat(vice, Q, w.heat, { level: 1, points: 2 * 8, cool: 60000 });
    w.money = 12345;
    await vice.write(Q['status.money'], bcd(w.money));
    await vice.write(Q['status.ammo'], bcd(7));
    await vice.write(Q['status.knife'], [1]);
    Object.assign(w.pickups, { ammo: 7, knife: 1 });
    await body(vice, w, cop);
  });

test('boxed in by a police car for two seconds, the player is busted: on foot at the police station, and what it costs', () =>
  boxedIn(20, async (vice, w) => {
    const late = await missed(vice, Q);
    for (let i = 1; i < BUSTED.AFTER; i++) {
      await pass(vice, Q, w, 0, `boxed in, ${i} frames`);
      assert.equal(w.player.on, 0, 'still in the car');
      assert.equal((await vice.read(Q['police.boxed_for'], 1))[0], i, 'counted');
    }
    assert.equal(await missed(vice, Q) - late, 0, 'no frame was late before');
    await pass(vice, Q, w, 0, 'busted');
    // (That frame draws the screen at the station afresh, as when the tests put the window somewhere, and is late.)
    const after = await missed(vice, Q);
    const [x, y] = BUSTED.STATION;
    assert.equal(w.player.on, 1, 'out of the car');
    assert.deepEqual([w.player.x >> 8, w.player.y >> 8], [x, y], 'at the police station');
    assert.ok(w.traffic.cars.every((c) => !c.cop), 'the police car gone');
    assert.ok(w.traffic.cars.some((c) => c.on && c.wreck), 'the car left where it was');
    assert.deepEqual(w.heat.state.level, 0, 'no heat');
    assert.equal(unbcd([...(await vice.read(Q['status.money'], 3))]), 12345 - 2469, 'a fifth of the money gone');
    assert.equal((await vice.read(Q['status.ammo'], 1))[0], 0, 'no ammo');
    assert.equal((await vice.read(Q['status.knife'], 1))[0], 0, 'no knife');
    assert.equal(await border(vice), 0, 'no siren');
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `at the station, ${i} frames`);
    await assertPicture(vice, Q, w, 'at the police station');
    assert.ok((await readPanel(vice)).includes('BUSTED. YOUR WEAPONS ARE NOW EVIDENCE'), 'and the panel says so');
    assert.equal(await missed(vice, Q) - after, 0, 'no frame was late after it');
  }));

test('not busted: a police car too far, or driving off before two seconds', () =>
  boxedIn(BUSTED.BOXED + 1, async (vice, w, cop) => {
    for (let i = 1; i <= BUSTED.AFTER + 10; i++) await pass(vice, Q, w, 0, `a police car ${BUSTED.BOXED + 1} pixels off, ${i} frames`);
    assert.equal(w.player.on, 0, 'still in the car');
    assert.equal(w.boxed, 0, 'not boxed in');
    // Nearer, then reversing away before the two seconds are up.
    Object.assign(cop, { x: (200 + 16) << 8 });
    await vice.write(Q['traffic.pl'], [216 & 255]);
    for (let i = 1; i <= BUSTED.AFTER - 20; i++) await pass(vice, Q, w, 0, `boxed in, ${i} frames`);
    assert.equal(w.boxed, BUSTED.AFTER - 20);
    let i = 0;
    while (w.boxed && i < 60) await pass(vice, Q, w, JOY.DOWN, `reversing away, ${++i} frames`);
    assert.equal(w.boxed, 0, 'free again');
    for (let k = 1; k <= 40; k++) await pass(vice, Q, w, 0, `rolling on, ${k} frames`);
    assert.equal(w.player.on, 0, 'not busted');
  }));

// ---------- officers on foot ----------
const officers = (w) => w.people.people.filter((p) => p.on && p.officer);

/** A police car standing `gap` pixels east of the player (in their car, or on foot), with heat 1. */
async function copNear(vice, w, gap, { onFoot = false } = {}) {
  if (onFoot) await putOnFoot(vice, Q, w, 200, 24, 0);
  else await putCar(vice, Q, w, 200, 24, 0);
  for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
  const cop = await putTrafficCar(vice, Q, w, 0, { x: 200 + gap, y: 24, dir: 2, cruise: 0, col: WHITE });
  cop.cop = 1;
  await vice.write(Q['police.cop'], [1]);
  await putHeat(vice, Q, w.heat, { level: 1, points: 2 * 8, cool: 60000 });
  return cop;
}
const quietRun = (body) =>
  withProgram(quiet.prg, async (vice) => {
    await vice.runTo(Q.ready);
    const w = new World({ honk: false, traffic: { spawn: false } });
    await pass(vice, Q, w, 0, 'first');
    await body(vice, w);
  });

test('an officer gets out of a slow police car near the player, in light blue, and the car is left empty', () =>
  quietRun(async (vice, w) => {
    const cop = await copNear(vice, w, 30);
    await pass(vice, Q, w, 0, 'the police car stands by');
    const [o] = officers(w);
    assert.ok(o, 'an officer is out');
    assert.equal(o.col, P.OFFICER, 'light blue');
    assert.equal(o.spd, P.COP_PACE, 'at an officer\'s pace');
    assert.equal(cop.wreck, 1, 'the car is left empty');
    assert.equal(w.traffic.around, 1, 'the police are around');
    for (let i = 1; i <= 20; i++) await pass(vice, Q, w, 0, `the officer comes, ${i} frames`);
    assert.equal(officers(w).length, 1, 'one officer from one car');
    // A donut under the car: the heat goes, and the siren stops at once, the police near or not.
    assert.notEqual(await border(vice), 0, 'the siren');
    Object.assign(w.pickups.items[0], { col: 200 >> 4, row: 24 >> 4, kind: DONUT });
    for (const [name, value] of [['col', 200 >> 4], ['row', 24 >> 4], ['kind', DONUT]]) await vice.write(Q[`pickups.${name}`], [value]);
    let k = 0;
    while (w.heat.level && k < 20) await pass(vice, Q, w, 0, `a donut, ${++k} frames`);
    assert.equal(w.heat.level, 0, 'the heat gone');
    assert.equal(await border(vice), 0, 'the siren stops the moment the heat goes, the police near or not');
    await assertPicture(vice, Q, w, 'an officer on foot');
  }));

test('an officer at the window of the player\'s slow car arrests them after 0.7 seconds', () =>
  quietRun(async (vice, w) => {
    // (The officers' check runs from the stack page, copied there at start: the stack never reaches it.)
    assert.ok(Q['police.on_foot'] >= 0x100 && Q['police.on_foot'] < Q.stack_end && Q.stack_end <= 0x1c0);
    const code = await vice.read(0x100, Q.stack_end - 0x100);
    await copNear(vice, w, 30);
    let i = 0;
    while (!w.window && i < 300) await pass(vice, Q, w, 0, `the officer walks up, ${++i} frames`);
    assert.equal(w.window, 1, `at the window (${i} frames)`);
    for (let k = 2; k < OFFICERS.WINDOW_AFTER; k++) {
      await pass(vice, Q, w, 0, `at the window, ${k} frames`);
      assert.equal(w.player.on, 0, 'not yet');
      assert.equal(w.window, k);
    }
    await pass(vice, Q, w, 0, 'arrested');
    assert.equal(w.player.on, 1, 'busted: out of the car');
    assert.deepEqual([w.player.x >> 8, w.player.y >> 8], BUSTED.STATION, 'at the police station');
    assert.equal(officers(w).length, 0, 'the officers gone');
    assert.equal(w.heat.level, 0);
    assert.ok((await vice.read(0x100, Q.stack_end - 0x100)).equals(code), 'the code in the stack page as it was');
  }));

test('on foot, an officer arrests the player when they reach them', () =>
  quietRun(async (vice, w) => {
    await copNear(vice, w, 30, { onFoot: true });
    let i = 0;
    while (w.heat.level && i < 400) await pass(vice, Q, w, 0, `the officer comes, ${++i} frames`);
    assert.equal(w.heat.level, 0, `busted (${i} frames)`);
    assert.deepEqual([w.player.x >> 8, w.player.y >> 8], BUSTED.STATION, 'at the police station');
    assert.ok(w.traffic.cars.every((c) => !c.on || !c.cop), 'the police car gone');
  }));

test('knocking an officer down is 14 heat, killing one 28; one who is down arrests nobody', () =>
  quietRun(async (vice, w) => {
    await putOnFoot(vice, Q, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
    await putHeat(vice, Q, w.heat, { level: 1, points: 2 * 8, cool: 60000 });
    const o = await putPerson(vice, Q, w.people, 3, { x: 210, y: 24, way: 2, spd: P.COP_PACE, col: P.OFFICER, officer: 1 });
    await pass(vice, Q, w, JOY.FIRE, 'a punch');
    assert.equal(o.down, P.DOWN_TIME - 1, 'knocked down');
    assert.equal(w.heat.points, 2 * 8 + 2 * 14, '14 heat');
    for (let i = 1; i <= 60; i++) await pass(vice, Q, w, 0, `lying there, ${i} frames`);
    assert.equal(w.player.on, 1, 'not arrested');
    assert.ok(w.heat.level >= 1);
  }));

// ---------- a stolen police car ----------
test('a police car taken from its driver is 16 heat; driving it near the police at heat 1 puts the heat up to 2; out of it, it is an empty police car', () =>
  quietRun(async (vice, w) => {
    // On foot in the street, a police car coming west at them: it stops for them, and they walk up and get in.
    await putOnFoot(vice, Q, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
    const cop = await putTrafficCar(vice, Q, w, 0, { x: 250, y: 24, dir: 2, cruise: 255, col: WHITE });
    cop.cop = 1;
    await vice.write(Q['police.cop'], [1]);
    let i = 0;
    while (w.player.on && i < 200) {
      const near = Math.abs(cop.px - w.player.px) < 16;
      await pass(vice, Q, w, near ? (i & 1 ? JOY.FIRE : 0) : JOY.RIGHT, `up to the police car and in, ${++i} frames`);
    }
    assert.equal(w.player.on, 0, `in the police car (${i} frames)`);
    assert.equal(w.traffic.stolen, 1, 'a stolen police car');
    assert.deepEqual([w.heat.level, w.heat.points], [1, 2 * 16], '16 heat for taking it from its driver');
    // Another police car comes near (60 pixels off, standing): the heat goes straight up to 2, and the panel says so.
    const other = await putTrafficCar(vice, Q, w, 1, { x: w.car.px + 60, y: 24, dir: 2, cruise: 0, col: WHITE });
    other.cop = 1;
    await vice.write(Q['police.cop'] + 1, [1]);
    await pass(vice, Q, w, 0, 'the police see it');
    assert.deepEqual([w.heat.level, w.heat.points], [2, 2 * 25], 'heat 2, from its start');
    for (let k = 1; k <= 5; k++) await pass(vice, Q, w, 0, `the message, ${k} frames`);
    assert.ok((await readPanel(vice)).some((r) => r.startsWith('THE COPS KNOW THAT CRUISER.')), 'the panel says they know it');
    // Out of it: no longer stolen, and the car is an empty police car.
    i = 0;
    while (!w.player.on && i < 60) await pass(vice, Q, w, i++ & 1 ? JOY.FIRE : 0, `getting out, ${i} frames`);
    assert.equal(w.player.on, 1, 'out');
    assert.equal(w.traffic.stolen, 0);
    const left = w.traffic.cars[w.traffic.mine];
    assert.deepEqual([left.cop, left.wreck, left.col], [1, 1, WHITE], 'an empty police car');
  }));

// ---------- hurt, and wasted ----------
/** On foot in the street, a traffic car put right on them going flat out (cruise 255): it hits them next frame. */
async function carOnThem(vice, w, i = 0) {
  const c = await putTrafficCar(vice, Q, w, i, { x: w.player.px - 4, y: 24, dir: 0, cruise: 255, col: 5 });
  return c;
}
const hp = async (vice) => (await vice.read(Q['status.hp'], 1))[0];

test('a car going fast hurts the player on foot for its speed, and not again for 0.4 seconds', () =>
  quietRun(async (vice, w) => {
    await putOnFoot(vice, Q, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
    assert.equal(await hp(vice), 100);
    await carOnThem(vice, w);
    await pass(vice, Q, w, 0, 'hit');
    assert.equal(w.hp, 100 - ((255 >> 3) - (255 >> 6)), 'its speed * 0.28, in pixels a second');
    assert.equal(await hp(vice), w.hp);
    for (let i = 1; i <= HURT.WAIT; i++) {
      await pass(vice, Q, w, 0, `just hit, ${i} frames`);
      assert.equal(await hp(vice), 72, 'nothing more for 0.4 seconds');
    }
  }));

test('with no health left the player is wasted: at the hospital, healed, billed $500, the weapons kept with no police about', () =>
  quietRun(async (vice, w) => {
    await putOnFoot(vice, Q, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
    w.hp = 20;
    await vice.write(Q['status.hp'], [20]);
    w.money = 1234;
    await vice.write(Q['status.money'], bcd(1234));
    await vice.write(Q['status.ammo'], bcd(7));
    await vice.write(Q['status.knife'], [1]);
    Object.assign(w.pickups, { ammo: 7, knife: 1 });
    await carOnThem(vice, w);
    const late = await missed(vice, Q);
    await pass(vice, Q, w, 0, 'wasted');
    assert.deepEqual([w.player.x >> 8, w.player.y >> 8], HURT.HOSPITAL, 'at the hospital');
    assert.equal(await hp(vice), 100, 'healed');
    assert.equal(unbcd([...(await vice.read(Q['status.money'], 3))]), 734, '$500 billed');
    assert.equal(unbcd([...(await vice.read(Q['status.ammo'], 1)), 0, 0]), 7, 'the ammo kept');
    assert.equal((await vice.read(Q['status.knife'], 1))[0], 1, 'and the knife');
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `at the hospital, ${i} frames`);
    assert.equal(await missed(vice, Q) - late, 1, 'only the frame that draws the screen there afresh is late');
    await assertPicture(vice, Q, w, 'at the hospital');
    assert.ok((await readPanel(vice)).some((r) => r.startsWith('ST. INVOICE HOSPITAL: AMBULANCE RIDE')), 'the bill');
  }));

test('wasted with the police about: the police take the weapons, and go; a bill bigger than the money takes it all', () =>
  quietRun(async (vice, w) => {
    await putOnFoot(vice, Q, w, 200, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, Q, w, 0, `put there, ${i} frames`);
    const cop = await putTrafficCar(vice, Q, w, 1, { x: 300, y: 24, dir: 2, cruise: 0, col: WHITE });
    cop.cop = 1;
    await vice.write(Q['police.cop'] + 1, [1]);
    await putHeat(vice, Q, w.heat, { level: 1, points: 2 * 8, cool: 60000 });
    await pass(vice, Q, w, 0, 'the police about');
    assert.equal(w.traffic.around, 1);
    w.hp = 10;
    await vice.write(Q['status.hp'], [10]);
    w.money = 120;
    await vice.write(Q['status.money'], bcd(120));
    await vice.write(Q['status.ammo'], bcd(7));
    await vice.write(Q['status.knife'], [1]);
    Object.assign(w.pickups, { ammo: 7, knife: 1 });
    await carOnThem(vice, w);
    await pass(vice, Q, w, 0, 'wasted');
    assert.deepEqual([w.player.x >> 8, w.player.y >> 8], HURT.HOSPITAL);
    assert.equal(unbcd([...(await vice.read(Q['status.money'], 3))]), 0, 'all of it');
    assert.equal((await vice.read(Q['status.ammo'], 1))[0], 0, 'the ammo taken');
    assert.equal((await vice.read(Q['status.knife'], 1))[0], 0, 'and the knife');
    assert.equal(w.heat.level, 0, 'no heat');
    assert.ok(w.traffic.cars.every((c) => !c.on || !c.cop), 'the police gone');
    assert.equal(await border(vice), 0, 'no siren');
    for (let i = 1; i <= 5; i++) await pass(vice, Q, w, 0, `at the hospital, ${i} frames`);
    const rows = await readPanel(vice);
    assert.ok(rows.some((r) => r.startsWith('AMBULANCE RIDE BILLED. THE POLICE KEPT')), `the line says so (${rows.join(' | ')})`);
  }));
