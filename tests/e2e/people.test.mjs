// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the passers-by (src/people.asm): the real program in VICE, held frame by frame to the
// models (people-model.mjs, stepped with everything else by play.mjs), and their pictures pixel by pixel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOY } from './vice.mjs';
import { PEOPLE_SPRITE, assemble, assets, withProgram } from './game.mjs';
import { Car } from './car-model.mjs';
import { World, assertPicture, missed, pass, putCar, putOnFoot } from './play.mjs';
import { P, PAVEMENT, People, WALL, putPerson } from './people-model.mjs';

// Nobody arrives by themselves and no Big Honk: the tests put people where they want them.
const game = assemble('people', { defs: { SPAWN: 0, HONK: 0 } });
const L = game.labels;
const full = assemble('people-full');
const F = full.labels;
const YELLOW = 7;

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

test('their twenty frames are copied into place at start: four ways, five poses, in the shirt\'s colour', () =>
  withProgram(game.prg, async (vice) => {
    await vice.runTo(L.ready);
    assert.equal(L.PEOPLE_FRAMES / 64, PEOPLE_SPRITE);
    assert.ok((await vice.read(L.PEOPLE_FRAMES, 21 * 64)).equals(assets.people), 'as tools/assets.mjs draws them, and the one lying');
    assert.ok(L.code_end <= L.PEOPLE_FRAMES, 'the code ends before them');
    // Shirts: the design's eight passers-by's colours, never the player's yellow.
    assert.deepEqual(P.SHIRTS, [4, 8, 3, 2, 10, 9, 5, 1]);
    assert.ok(!P.SHIRTS.includes(YELLOW));
  }));

test('the shirts the game picks from are the design\'s', () =>
  withProgram(full.prg, async (vice) => {
    await vice.runTo(F.ready);
    assert.deepEqual([...(await vice.read(F['people.shirts'], 8))], P.SHIRTS);
  }));

test('someone put on a pavement walks it, at their pace, choosing ways as the model does, through the five poses', () =>
  run(async (vice, w) => {
    // The pavement down the west side of the first block, with the player standing on it further south.
    assert.equal(People.kind(40, 100), PAVEMENT);
    assert.equal(People.kind(40, 140), PAVEMENT);
    await putOnFoot(vice, L, w, 40, 140, 6);
    await hold(vice, w, 0, 3, 'put on the pavement');
    const before = await missed(vice, L); // (a new screen to draw makes a frame late: count from here)
    const p = await putPerson(vice, L, w.people, 3, { x: 40, y: 100, way: 3, spd: 90, col: 3 });
    const poses = new Set(), ways = new Set();
    const [x0, y0] = [p.px, p.py];
    let furthest = 0;
    for (let i = 1; i <= 300; i++) {
      await pass(vice, L, w, 0, `walking, ${i} frames`);
      poses.add(p.pointer - PEOPLE_SPRITE - p.way * 5);
      ways.add(p.way);
      assert.notEqual(People.kind(p.px, p.py), WALL, 'never in a wall');
      furthest = Math.max(furthest, Math.abs(p.px - x0) + Math.abs(p.py - y0));
      if (i === 60) await assertPicture(vice, L, w, 'someone walking, the player standing by');
    }
    assert.deepEqual([...poses].sort(), [0, 1, 2, 3, 4], 'all five poses');
    assert.ok(furthest > 30, `they got somewhere (${furthest} pixels from where they started, at most)`);
    assert.equal(await missed(vice, L) - before, 0, 'no frame was late');
  }));

test('they stand still in a frame that moves the screen or works out colour memory, and are shown in it', () =>
  run(async (vice, w) => {
    // The car on the long street at the top of the city, where the window follows it east, someone on the
    // pavement beside it, then flat out.
    await putCar(vice, L, w, 200, 24, 0);
    await hold(vice, w, 0, 3, 'put there');
    assert.equal(People.kind(280, 40), PAVEMENT);
    const p = await putPerson(vice, L, w.people, 0, { x: 280, y: 40, way: 0, spd: 108, col: 2 });
    let stood = 0, shownWhileBusy = 0;
    for (let i = 1; i <= 120; i++) {
      const was = [p.x, p.y], busy = w.cam.busy, cell = [...w.cam.cell];
      await pass(vice, L, w, JOY.UP, `driving past, ${i} frames`);
      const moved = ((w.cam.x >> 3) ^ cell[0]) & 31 || ((w.cam.y >> 3) ^ cell[1]) & 31;
      if (busy || moved) {
        assert.deepEqual([p.x, p.y], was, `standing in frame ${i}`);
        stood++;
        if (w.people.show(w.cam).length) shownWhileBusy++;
      }
    }
    assert.ok(stood > 10, `there were such frames (${stood})`);
    assert.ok(shownWhileBusy > 0, 'and they were listed for the multiplexer in them, not left out');
  }));

test('in the game, people arrive by themselves out of sight on pavements, walk, and go once far away', () =>
  run(async (vice, w) => {
    const before = await missed(vice, F);
    let most = 0;
    const arrivals = [];
    for (let i = 1; i <= 600; i++) {
      const on = w.people.people.map((p) => p.on);
      await pass(vice, F, w, 0, `standing, ${i} frames`);
      w.people.people.forEach((p, k) => {
        if (p.on && !on[k]) arrivals.push({ x: p.px, y: p.py, cam: [w.cam.x, w.cam.y] });
      });
      most = Math.max(most, w.people.people.filter((p) => p.on).length);
    }
    assert.ok(arrivals.length >= 2, `people arrived (${arrivals.length})`);
    for (const a of arrivals) {
      assert.equal(People.kind(a.x, a.y), PAVEMENT, 'on a pavement or a plaza');
      // In the middle of its tile, and a first step (under a pixel) taken in the frame they arrive in.
      assert.ok(Math.abs((a.x & 15) - 8) <= 1 && Math.abs((a.y & 15) - 8) <= 1, `in the middle of its tile (${a.x},${a.y})`);
      const inSight = a.x >= a.cam[0] - 12 && a.x < a.cam[0] + 304 + 12 && a.y >= a.cam[1] - 12 && a.y < a.cam[1] + 161 + 12;
      assert.ok(!inSight, `out of sight (${a.x},${a.y})`);
    }
    assert.equal(await missed(vice, F) - before, 0, 'no frame was late');
    // Far off: driving east along the top street leaves them behind, and they go.
    await putCar(vice, F, w, 40, 24, 0);
    for (let i = 1; i <= 3; i++) await pass(vice, F, w, 0, `after the car was put there, ${i} frames`);
    const again = await missed(vice, F); // (a new screen to draw makes a frame late: count from here)
    for (let i = 1; i <= 300; i++) await pass(vice, F, w, JOY.UP, `driving away, ${i} frames`);
    for (const p of w.people.people) if (p.on) assert.ok(Math.abs(p.px - w.car.px) < 0x180 + 8 && Math.abs(p.py - w.car.py) < 0x180 + 8, 'nobody far off stays');
    assert.equal(await missed(vice, F) - again, 0, 'no frame was late');
    assert.ok(most <= P.CROWD);
  }, full, {}));

test('the player\'s car going fast runs someone over: they lie flat for 4 seconds, then are gone; slowly, it does not', () =>
  run(async (vice, w) => {
    // On the street at the top of the city, facing east, someone standing in the road ahead (they cannot
    // get there by themselves: people keep off the roads, so the test puts them there).
    await putCar(vice, L, w, 200, 24, 0);
    await hold(vice, w, 0, 3, 'put there');
    const late = await missed(vice, L);
    const p = await putPerson(vice, L, w.people, 2, { x: 290, y: 24, way: 1, spd: 0, col: 4, wait: 255 });
    let frame = 0;
    while (!p.down && frame < 120) await pass(vice, L, w, JOY.UP, `driving at them, ${++frame} frames`);
    assert.equal(p.down, P.DOWN_TIME, 'run over');
    assert.ok(Math.abs(w.car.vx) >= P.RUN_OVER, 'going fast enough');
    assert.ok(Math.abs(p.px - w.car.px) <= P.BODY_LONG / 64, 'by the car');
    await hold(vice, w, JOY.DOWN, 30, 'braking');
    assert.equal(p.pointer, PEOPLE_SPRITE + P.DOWN_FRAME, 'lying');
    await assertPicture(vice, L, w, 'someone run over, lying in the road', JOY.DOWN);
    await hold(vice, w, JOY.DOWN, P.DOWN_TIME - 32, 'lying there');
    assert.equal(p.on, 1, 'still there');
    await hold(vice, w, 0, 2, 'the last of it');
    assert.equal(w.people.people[2].on, 0, 'gone');
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
    // Slowly into someone: they are not knocked down (and the car passes through them, as nothing stops it).
    await putCar(vice, L, w, 200, 24, 0);
    await hold(vice, w, 0, 3, 'put back, standing');
    const q = await putPerson(vice, L, w.people, 1, { x: 230, y: 24, way: 1, spd: 0, col: 5, wait: 255 });
    for (let i = 1; i <= 60; i++) {
      const bits = Math.abs(w.car.vx) < P.RUN_OVER - 40 ? JOY.UP : 0;
      await pass(vice, L, w, bits, `creeping, ${i} frames`);
      assert.ok(Math.abs(w.car.vx) < P.RUN_OVER, 'slowly');
    }
    assert.equal(q.down, 0, 'not run over');
  }));

test('the whole car runs people over, to its back corners, at any turn; just beside it, they are missed', () =>
  run(async (vice, w) => {
    // Going at 300/256 of a pixel a frame, for one frame, the car turned k sixteenths of a turn; one passer-by
    // by each back corner of the body and one by a front corner (u along it, v across, in pixels from where its
    // middle will be after the frame, as the model has it), and one just past its side. (Two points with a
    // square round each, as the program had before, miss the back corners.)
    for (const k of [0, 2, 3, 5, 8, 11, 14]) {
      const angle = k * 16 * 256, a = (k * Math.PI) / 8, c = Math.cos(a), s = Math.sin(a);
      await putCar(vice, L, w, 216, 24, angle);
      const vx = Math.round(300 * c), vy = Math.round(300 * s);
      Object.assign(w.car, { vx, vy });
      await vice.write(L['car.pos_x'] + 6, [vx & 255, (vx >> 8) & 255, vy & 255, (vy >> 8) & 255]);
      const next = Object.assign(new Car(0, 0), w.car);
      next.step(JOY.UP);
      const at = (u, v) => ({ x: Math.round(next.px + u * c - v * s), y: Math.round(next.py + u * s + v * c) });
      for (const [i, u, v] of [[0, -11, 6], [1, -11, -6], [2, 11, 6], [3, -6, 10]])
        await putPerson(vice, L, w.people, i, { ...at(u, v), way: 1, spd: 0, col: 4, wait: 255 });
      await pass(vice, L, w, JOY.UP, `turned ${k}, the frame`);
      const down = w.people.people.slice(0, 4).map((p) => p.down !== 0);
      assert.deepEqual(down, [true, true, true, false], `turned ${k}: the back corners and a front one, not beside it`);
      for (let i = 0; i < 4; i++) {
        w.people.people[i].on = 0;
        await vice.write(L['people.on'] + i, [0]);
      }
      await hold(vice, w, JOY.DOWN, 2, `turned ${k}, after`);
    }
  }));

test('fire on foot is a punch: it knocks down the passer-by in front, who gets up after 4 seconds and runs, as does anyone near', () =>
  run(async (vice, w) => {
    // The pavement down the west side of the first block, the player facing north up it (no car in reach).
    await putOnFoot(vice, L, w, 40, 150, 6);
    await hold(vice, w, 0, 3, 'put on the pavement');
    const late = await missed(vice, L);
    const p = await putPerson(vice, L, w.people, 3, { x: 40, y: 150 - P.PUNCH_REACH, way: 1, spd: 90, col: 3, wait: 255 });
    const q = await putPerson(vice, L, w.people, 2, { x: 40, y: 100, way: 3, spd: 90, col: 4, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'the punch');
    assert.equal(w.player.on, 1, 'still on foot: no car to get into');
    assert.equal(w.player.arm, P.ARM_OUT, 'the arm out');
    assert.deepEqual([w.player.frame(0), w.player.face], [-1, 6], 'in the picture punching north');
    assert.ok((await vice.read(L.PUNCH_FRAMES, 8 * 64)).equals(assets.punch), 'its eight frames copied into place at start');
    assert.equal(p.down, P.DOWN_TIME - 1, 'knocked down');
    assert.equal(p.ko, 1, 'by a punch: they will get up');
    assert.equal(q.flee, P.FLEE_TURNS, 'and the one near them runs');
    await hold(vice, w, JOY.FIRE, 5, 'fire held: no more punches');
    await assertPicture(vice, L, w, 'someone knocked down in front of the player, the arm still out');
    await hold(vice, w, 0, 5, 'the arm back');
    assert.equal(w.player.arm, 0);
    // Lying their four seconds, then up and running away from the player, north.
    await hold(vice, w, 0, P.DOWN_TIME - 12, 'lying there');
    assert.equal(p.down, 1);
    await pass(vice, L, w, 0, 'getting up');
    assert.equal(p.down, 0);
    assert.equal(p.on, 1, 'still there');
    assert.equal(p.flee, P.FLEE_TURNS, 'and running');
    const y0 = p.py;
    await hold(vice, w, 0, 60, 'running');
    assert.ok(y0 - p.py > 20, `away from the player, twice as fast as walking (${y0 - p.py} pixels in 60 frames)`);
    assert.equal(await missed(vice, L) - late, 0, 'no frame was late');
  }));

test('punches come no faster than one every 0.35 seconds, and none in the water', () =>
  run(async (vice, w) => {
    await putOnFoot(vice, L, w, 40, 150, 6);
    await hold(vice, w, 0, 3, 'put on the pavement');
    const a = await putPerson(vice, L, w.people, 3, { x: 40, y: 150 - P.PUNCH_REACH, way: 1, spd: 0, col: 3, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'the first punch');
    assert.equal(a.ko, 1);
    // Someone else in front at once: fire again too soon does nothing.
    const b = await putPerson(vice, L, w.people, 1, { x: 41, y: 150 - P.PUNCH_REACH, way: 1, spd: 0, col: 5, wait: 255 });
    await pass(vice, L, w, 0, 'let go');
    await pass(vice, L, w, JOY.FIRE, 'too soon');
    assert.equal(b.down, 0, 'not knocked down');
    await hold(vice, w, 0, P.PUNCH_WAIT, 'waiting');
    await pass(vice, L, w, JOY.FIRE, 'again, in time');
    assert.equal(b.ko, 1, 'knocked down');
    // In the fountain in the plaza near the start, swimming, someone in front: no punch.
    await hold(vice, w, 0, P.PUNCH_WAIT, 'waiting again');
    await putOnFoot(vice, L, w, 100, 112, 0);
    await hold(vice, w, 0, 3, 'put in the fountain');
    assert.equal(w.player.swim, 1, 'swimming');
    const c = await putPerson(vice, L, w.people, 0, { x: 100 + P.PUNCH_REACH, y: 112, way: 1, spd: 0, col: 2, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'fire in the water');
    assert.equal(c.down, 0, 'nobody fights in the water');
  }));

test('with a knife, fire is a stab: it kills, from further ahead, even someone knocked down already, for 6 heat', () =>
  run(async (vice, w) => {
    await putOnFoot(vice, L, w, 40, 150, 6);
    await hold(vice, w, 0, 3, 'put on the pavement');
    // A punch first, with no knife: knocked down.
    const p = await putPerson(vice, L, w.people, 3, { x: 40, y: 150 - P.PUNCH_REACH, way: 1, spd: 0, col: 3, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'a punch');
    assert.equal(p.ko, 1, 'knocked down');
    // Then a knife (as a pickup gives it): someone knocked down already is killed by a stab.
    await vice.write(L['status.knife'], [1]);
    w.pickups.knife = 1;
    await hold(vice, w, 0, P.PUNCH_WAIT, 'waiting');
    await pass(vice, L, w, JOY.FIRE, 'a stab');
    assert.equal(p.ko, 0, 'killed: they will not get up');
    assert.equal(p.down, P.DOWN_TIME - 1);
    const [lo] = await vice.read(L['status.points'], 1);
    assert.equal(lo, 2 * (3 + 6), 'heat: 3 for the punch, 6 for the kill');
    // From further ahead: someone 10 pixels in front, beyond a punch's reach, and a stab only 0.28 seconds on.
    await hold(vice, w, 0, P.STAB_WAIT - 1, 'waiting less');
    const q = await putPerson(vice, L, w.people, 2, { x: 41, y: 150 - P.STAB_REACH, way: 1, spd: 0, col: 5, wait: 255 });
    await pass(vice, L, w, JOY.FIRE, 'a second stab');
    assert.equal(q.down, P.DOWN_TIME - 1, 'killed too');
    // They lie their time, then are gone.
    await hold(vice, w, 0, P.DOWN_TIME, 'lying there');
    assert.equal(w.people.people[2].on, 0, 'gone');
  }));
