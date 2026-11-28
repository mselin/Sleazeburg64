// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the cars' driver assistance (the design's "Cursed driver assistance"), on modern only.
// Anti-theft: every police car has it, and one car in five else; 10 to 25 seconds after the player takes one it
// stops the car for good, with its message, and getting back in, the immobiliser says no. Lane assist: one car
// in five that is not a police car; driven forward fast enough, every 5 to 15 seconds it takes the wheel for
// 40 frames, with its message. The real program in VICE, the models held to it frame by frame (play.mjs;
// car.anti and car.lane in car-model.mjs, police.fit in traffic-model.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { assemble, assets, readPanel, withProgram } from './game.mjs';
import { World, missed, pass, putTrafficCar } from './play.mjs';
import { setDifficulty } from './people-model.mjs';
import { C } from './car-model.mjs';

const THEFT = 'ANTI-THEFT ENGAGED: ENGINE IMMOBILISED', NO = 'THE IMMOBILISER SAYS NO', LANE = 'CURSED LANE ASSIST TOOK OVER';
const HINT_CAR = 'FIRE: HANDBRAKE. STANDING STILL: GET OUT';
const quiet = assemble('assist', { defs: { SPAWN: 0, HONK: 0 } });
const busy = assemble('assist-traffic', { defs: { HONK: 0 } });
const hint = async (vice) => (await readPanel(vice))[2];

/** Run `body` on a freshly started game on modern, as the title page sets it, with its models. */
const run = (prg, spawn, body) =>
  withProgram(prg.prg, async (vice) => {
    const L = prg.labels;
    await vice.runTo(L.ready);
    await setDifficulty(1, vice, L, assets.scooters);
    assets.riders = assets.scooters;
    try {
      const w = new World({ honk: false, traffic: { spawn, modern: true } });
      await pass(vice, L, w, 0, 'first');
      await body(vice, w, L);
    } finally {
      await setDifficulty(0);
      assets.riders = assets.skaters;
    }
  });

async function hold(vice, L, w, bits, frames, what) {
  for (let i = 1; i <= frames; i++) await pass(vice, L, w, bits, `${what}, frame ${i}`);
}
async function press(vice, L, w, what) {
  await pass(vice, L, w, 0, `before ${what}`);
  await pass(vice, L, w, JOY.FIRE, what);
}
/** The forward speed of the player's car, along the way it faces west. */
const westward = (w) => -w.car.vx;

test('anti-theft: the car stops for good at its last step, braking, never backing; the throttle does nothing, and getting back in the immobiliser says no', () =>
  run(quiet, false, async (vice, w, L) => {
    await press(vice, L, w, 'getting out');
    await hold(vice, L, w, JOY.LEFT, 60, 'west, away from their own car');
    const { px, py } = w.player;
    // A car left standing, facing west, two steps from stopping: the next step is the last.
    await putTrafficCar(vice, L, w, 1, { x: px - 9, y: py - 8, dir: 2, cruise: 0, col: 3, wreck: 1, assist: 2 });
    await press(vice, L, w, 'getting in');
    assert.equal(w.player.on, 0, 'in');
    assert.equal(w.car.assist, 2, 'its anti-theft came with it');
    await pass(vice, L, w, 0, 'in');
    assert.equal(await hint(vice), HINT_CAR, 'the usual message, the pass after');
    const before = await missed(vice, L);
    let frame = 0;
    while (w.car.assist > 1 && frame++ < 40) await pass(vice, L, w, JOY.UP, `driving west, ${frame}`);
    assert.equal(w.car.assist, 1, `stopped for good, ${frame} frames in`);
    assert.equal(w.car.said, 'THEFT');
    assert.ok(westward(w) > C.BRAKING, `going faster than BRAKING then (${westward(w)})`);
    await pass(vice, L, w, JOY.UP, 'up held');
    assert.equal(await hint(vice), THEFT, 'its message');
    let braking = 0;
    for (frame = 1; frame <= 60; frame++) {
      const was = westward(w);
      await pass(vice, L, w, JOY.UP, `up held, stopped, ${frame}`);
      assert.ok(westward(w) >= 0 && w.car.vy === 0, `never backing (${w.car.vx}, ${w.car.vy})`);
      if (was > C.BRAKING) braking++, assert.ok(westward(w) < was, 'braking');
    }
    assert.ok(braking > 1, `it braked (${braking} frames)`);
    await hold(vice, L, w, JOY.DOWN, 20, 'down held');
    assert.deepEqual([w.car.vx, w.car.vy], [0, 0], 'down does nothing either');
    await press(vice, L, w, 'getting out');
    assert.equal(w.player.on, 1, 'out');
    assert.equal(w.traffic.cars[w.traffic.mine].assist, 1, 'the car left still stopped for good');
    await press(vice, L, w, 'getting back in');
    assert.equal(w.player.on, 0, 'in again');
    await pass(vice, L, w, 0, 'in again');
    assert.equal(await hint(vice), NO, 'the immobiliser says no');
    await hold(vice, L, w, JOY.UP, 50, 'up held, back in');
    assert.deepEqual([w.car.vx, w.car.vy], [0, 0], 'it still will not go');
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('a clean car, on modern, drives as ever; a car counting down keeps its count when left and taken again', () =>
  run(quiet, false, async (vice, w, L) => {
    assert.equal(w.car.assist, 0, 'the first car is clean');
    await hold(vice, L, w, JOY.UP, 100, 'driving');
    assert.equal(w.car.assist, 0);
    await hold(vice, L, w, JOY.DOWN, 60, 'stopping');
    await hold(vice, L, w, 0, 30, 'standing');
    await press(vice, L, w, 'getting out');
    await hold(vice, L, w, JOY.LEFT, 30, 'west');
    const { px, py } = w.player;
    await putTrafficCar(vice, L, w, 1, { x: px - 9, y: py - 8, dir: 2, cruise: 0, col: 3, wreck: 1, assist: 30 });
    await press(vice, L, w, 'getting in');
    await hold(vice, L, w, 0, 70, 'sitting in it');
    const left = w.car.assist;
    assert.ok(left < 30 && left > 1, `counting down while the player is in it (${left})`);
    await press(vice, L, w, 'getting out');
    assert.equal(w.traffic.cars[w.traffic.mine].assist, left, 'the count stays with the car');
    await hold(vice, L, w, 0, 70, 'standing by it');
    assert.equal(w.traffic.cars[w.traffic.mine].assist, left, 'and does not count while nobody drives it');
    await press(vice, L, w, 'getting back in');
    assert.equal(w.car.assist, left, 'taken again, as it was');
  }));

test('lane assist: driven fast, it takes the wheel for 40 frames with its message, whatever the stick says, and rolls the steps to the next time afresh; getting out ends it', () =>
  run(quiet, false, async (vice, w, L) => {
    await press(vice, L, w, 'getting out');
    await hold(vice, L, w, JOY.RIGHT, 60, 'east, away from their own car');
    const { px, py } = w.player;
    await putTrafficCar(vice, L, w, 1, { x: px + 9, y: py - 8, dir: 0, cruise: 0, col: 3, wreck: 1, assist: 0x80 });
    await press(vice, L, w, 'getting in');
    assert.equal(w.player.on, 0, 'in');
    assert.equal(w.car.assist, 0x80, 'lane assist and no anti-theft');
    await pass(vice, L, w, 0, 'in');
    // Two steps left: it takes the wheel at the second step of 16 frames going fast enough.
    await vice.write(L['car.wait'], [2]);
    w.car.wait = 2;
    const before = await missed(vice, L);
    let frame = 0;
    while (!w.car.swerve && frame++ < 200) await pass(vice, L, w, JOY.UP, `driving east, ${frame}`);
    assert.equal(w.car.swerve, 40, `it took the wheel, ${frame} frames in`);
    assert.equal(w.car.said, 'LANE');
    assert.ok(w.car.vx >= 256, `going at 256 or more (${w.car.vx})`);
    assert.ok(w.car.pull, 'one way or the other');
    await pass(vice, L, w, JOY.UP | JOY.RIGHT, 'right held');
    assert.equal(await hint(vice), LANE, 'its message');
    const angle = w.car.angle;
    for (frame = 1; w.car.swerve; frame++) {
      await pass(vice, L, w, JOY.UP | (frame & 16 ? JOY.LEFT : JOY.RIGHT), `the stick fighting it, ${frame}`);
    }
    assert.equal(frame, 40, 'it held the wheel for 40 frames');
    assert.equal(w.car.pull, 0, 'and let go');
    assert.notEqual(w.car.angle, angle, 'the car turned');
    // The stick steers again, and at the next step going fast enough the steps to the next time are rolled.
    assert.equal(w.car.wait, 0, 'no steps left');
    for (frame = 1; !w.car.wait && frame <= 100; frame++) await pass(vice, L, w, JOY.UP, `driving on, ${frame}`);
    assert.ok(w.car.wait >= 15 && w.car.wait <= 47, `16 to 48 steps rolled, one gone (${w.car.wait})`);
    for (frame = 1; Math.abs(w.car.vx) + Math.abs(w.car.vy) > 64 && frame <= 150; frame++) await pass(vice, L, w, JOY.DOWN, `stopping, ${frame}`);
    await hold(vice, L, w, 0, 60, 'standing');
    await press(vice, L, w, 'getting out');
    assert.equal(w.player.on, 1, 'out');
    assert.deepEqual([w.car.wait, w.car.swerve, w.car.pull], [0, 0, 0], 'lane assist starts afresh in the next car');
    assert.equal(w.traffic.cars[w.traffic.mine].assist, 0x80, 'the car left keeps it');
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('the traffic on modern: every patrol car has anti-theft, and about one car in five else, 17 to 39 steps; lane assist in about one car in five, never a police car', () =>
  run(busy, true, async (vice, w, L) => {
    const seen = new Map(); // each car that came, by the frame it came, with its anti-theft
    let seed = 1987, bits = 0;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 16;
    for (let frame = 1; frame <= 3000; frame++) {
      if (frame % 12 === 1) bits = [JOY.UP, JOY.UP, JOY.UP | JOY.LEFT, JOY.UP | JOY.RIGHT, JOY.DOWN, 0, JOY.UP, JOY.UP | JOY.FIRE][random() & 7];
      const was = w.traffic.cars.map((c) => c.on && c);
      await pass(vice, L, w, bits, `after ${frame} frames`);
      w.traffic.cars.forEach((c, i) => c.on && c !== was[i] && !c.wreck && seen.set(`${frame}:${i}`, c));
    }
    const cars = [...seen.values()];
    const armed = cars.filter((c) => c.assist & 0x7f), patrols = cars.filter((c) => c.patrol || c.cop);
    assert.ok(cars.length >= 20, `enough cars came (${cars.length})`);
    for (const c of armed) assert.ok((c.assist & 0x7f) >= 17 && (c.assist & 0x7f) <= 39, `10-25 seconds (${c.assist & 0x7f} steps)`);
    for (const c of patrols) assert.ok(c.assist & 0x7f, 'every police car has it');
    for (const c of patrols) assert.ok(!(c.assist & 0x80), 'no police car has lane assist');
    const others = cars.filter((c) => !c.patrol && !c.cop);
    const share = others.filter((c) => c.assist & 0x7f).length / others.length;
    assert.ok(share > 0 && share < 0.5, `some other cars have it, not most (${armed.length} of ${cars.length}, ${patrols.length} police)`);
    const lane = others.filter((c) => c.assist & 0x80).length / others.length;
    assert.ok(lane > 0 && lane < 0.5, `some other cars have lane assist, not most (${lane.toFixed(2)})`);
  }));
