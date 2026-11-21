// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLD, CITY_CHECKSUM, FOUNT, GRASS, MW, ROAD, TREE, WALK, WATER, checksum, generate } from './city.mjs';

const dir = mkdtempSync(join(tmpdir(), 'sleazeburg-assets-'));
execFileSync(process.execPath, [new URL('./assets.mjs', import.meta.url).pathname, dir]);
const chars = readFileSync(join(dir, 'chars.bin'));
const tiles = readFileSync(join(dir, 'tiles.bin'));
const map = readFileSync(join(dir, 'map.bin'));
const car = readFileSync(join(dir, 'car.bin'));
const player = readFileSync(join(dir, 'player.bin'));
const playerMade = readFileSync(join(dir, 'player-made.bin'));
const playerAll = readFileSync(join(dir, 'player-all.bin'));

test('the city is the same one as in the browser game', () => {
  const city = generate();
  assert.equal(checksum(city.map), CITY_CHECKSUM);
  assert.equal(city.map[0], ROAD, 'the north-west corner is a crossing');
  assert.equal(city.map[2 * MW + 5], WALK);
  assert.equal(city.map[9 * MW + 4 * 12 + 6], WATER, 'the canal');
});

test('the files are the sizes the program expects', () => {
  assert.equal(chars.length, 2048, '256 characters of 8 bytes');
  assert.equal(tiles.length, 7 * 256, 'four characters for each of 256 tiles, a colour for each character, a kind and a colour for each tile');
  assert.equal(car.length, 16 * 64, 'the car in 16 directions, a sprite each');
  assert.equal(map.length, MW * MW);
});

test('every map byte names a tile that exists, and every tile uses real tile characters', () => {
  const used = new Set(map);
  const count = Math.max(...used) + 1;
  assert.equal(used.size, count, 'tile numbers are used without gaps');
  for (const t of used) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const ch = tiles[quarter * 256 + t];
      assert.ok(ch >= 64, `tile ${t} uses character ${ch}, which is in the font`);
      assert.ok(chars.subarray(ch * 8, ch * 8 + 8) !== undefined);
    }
  }
});

test('every tile character has one colour, and it is a multicolour one', () => {
  const used = new Set();
  for (const t of new Set(map)) for (let quarter = 0; quarter < 4; quarter++) used.add(tiles[quarter * 256 + t]);
  for (const ch of used) {
    const colour = tiles[1024 + ch];
    assert.ok(colour >= 8 && colour <= 15, `character ${ch} has colour ${colour}: multicolour needs 8 to 15`);
  }
});

test('colour memory can be worked out a tile at a time: a tile\'s characters that show a colour show its colour', () => {
  for (const t of new Set(map)) {
    const colour = tiles[1536 + t];
    assert.ok(colour >= 8 && colour <= 15, `tile ${t} has colour ${colour}: multicolour needs 8 to 15`);
    for (let quarter = 0; quarter < 4; quarter++) {
      const ch = tiles[quarter * 256 + t];
      const ownColour = [...chars.subarray(ch * 8, ch * 8 + 8)].some((b) => [0, 2, 4, 6].some((s) => ((b >> s) & 3) === 3));
      if (ownColour) assert.equal(tiles[1024 + ch], colour, `tile ${t}, character ${ch}`);
    }
  }
});

test('the last byte of the character set is empty: it is what the video chip shows when idle', () => {
  assert.equal(chars[2047], 0);
});

test('the font is in place: A is character 1 and is not blank', () => {
  const a = chars.subarray(8, 16);
  assert.ok(a.some((b) => b !== 0));
  assert.deepEqual([...chars.subarray(32 * 8, 33 * 8)], [0, 0, 0, 0, 0, 0, 0, 0], 'space is blank');
  // Text is drawn two-colour, so font characters only use whole screen pixels in the left six columns.
  for (let ch = 0; ch < 64; ch++) for (let r = 0; r < 8; r++) assert.equal(chars[ch * 8 + r] & 0x83, 0);
});

test('every tile has the kind its ground has in the city: buildings and trees are walls, grass is grass', () => {
  const city = generate();
  const kindOf = { [BLD]: 1, [TREE]: 1, [GRASS]: 2, [WATER]: 3, [FOUNT]: 3 };
  for (let i = 0; i < map.length; i++) assert.equal(tiles[1280 + map[i]], kindOf[city.map[i]] ?? 0, `tile ${i % MW},${Math.floor(i / MW)}`);
});

test('the car looks the same turned a quarter turn: its 16 directions are one shape rotated', () => {
  const pixel = (k, i, j) => (car[k * 64 + j * 3 + (i >> 3)] >> (7 - (i & 7))) & 1;
  const count = (k) => { let n = 0; for (let j = 0; j < 21; j++) for (let i = 0; i < 24; i++) n += pixel(k, i, j); return n; };
  // Facing east and facing south are the same picture turned about the car's centre, sprite pixel (12, 10).
  for (let j = 0; j < 21; j++)
    for (let i = 0; i < 24; i++) {
      const si = 12 - (j - 10), sj = 10 + (i - 12); // (i, j) turned a quarter turn clockwise
      if (si >= 0 && si < 24 && sj >= 0 && sj < 21) assert.equal(pixel(4, si, sj), pixel(0, i, j), `pixel ${i},${j}`);
    }
  for (let k = 0; k < 16; k++) assert.ok(count(k) > 120 && count(k) < 200, `direction ${k} has a car-sized number of pixels (${count(k)})`);
  for (let k = 0; k < 16; k++) assert.equal(car[k * 64 + 63], 0, 'the 64th byte of each sprite is unused');
});

test('Big Honk: eight multicolour frames after the tile characters, outlined in black, in his colours', () => {
  const FIRST = 184; // his first character: the program's HONK_SPRITE is 64 bytes in from $3800 ... $3dc0
  const lastTileChar = Math.max(...tiles.subarray(0, 1024));
  assert.ok(lastTileChar < FIRST, `the tile characters (to ${lastTileChar}) end before his frames`);
  const pair = (f, m, j) => (chars[FIRST * 8 + f * 64 + j * 3 + (m >> 2)] >> (6 - 2 * (m & 3))) & 3;
  for (let f = 0; f < 8; f++) {
    const counts = [0, 0, 0, 0];
    for (let j = 0; j < 21; j++)
      for (let m = 0; m < 12; m++) {
        const p = pair(f, m, j);
        counts[p]++;
        if (p < 2) continue;
        // White (his own colour) and yellow (beak and chain) never touch the sprite's edge or a clear pixel.
        for (const [dm, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const mm = m + dm, jj = j + dj;
          assert.ok(mm >= 0 && mm < 12 && jj >= 0 && jj < 21 && pair(f, mm, jj) !== 0, `frame ${f}: pixel ${m},${j} is outlined`);
        }
      }
    assert.ok(counts[1] > 20 && counts[2] > 15 && counts[3] >= 4, `frame ${f} has black, white and yellow (${counts})`);
    assert.equal(chars[FIRST * 8 + f * 64 + 63], 0, 'the 64th byte of each sprite is unused');
  }
  // Facing west is facing east turned half round, and north is south; and with his wings out he is wider.
  for (const flap of [0, 1])
    for (let j = 0; j < 21; j++)
      for (let m = 0; m < 12; m++) {
        assert.equal(pair(4 + flap, m, j), pair(flap, 11 - m, 20 - j), `west and east, ${m},${j}`);
        assert.equal(pair(6 + flap, m, j), pair(2 + flap, 11 - m, 20 - j), `north and south, ${m},${j}`);
      }
  const rows = (f) => new Set(Array.from({ length: 252 }, (_, i) => i).filter((i) => pair(f, i % 12, Math.floor(i / 12))).map((i) => Math.floor(i / 12))).size;
  const columns = (f) => new Set(Array.from({ length: 252 }, (_, i) => i).filter((i) => pair(f, i % 12, Math.floor(i / 12))).map((i) => i % 12)).size;
  assert.ok(rows(1) >= rows(0) + 6, 'facing east, his wings out go up and down');
  assert.ok(columns(3) >= columns(2) + 3, 'facing south, out to the sides');
  // After him, characters 248-255 are the status panel's bars.
});

test('the status panel\'s bars: character 247 + n fills the left n pixel columns of rows 2-5', () => {
  for (let n = 1; n <= 8; n++)
    assert.deepEqual([...chars.subarray((247 + n) * 8, (248 + n) * 8)], [0, 0, ...Array(4).fill((0xff00 >> n) & 0xff), 0, 0], `${n} columns`);
  assert.equal(chars[2047], 0, 'the last byte, row 7 of the full bar, is still empty');
});

test('the player on foot: 42 multicolour frames, each one of the twelve the program file holds or its mirror image', () => {
  assert.equal(player.length, 12 * 64, 'twelve frames in the program file');
  assert.equal(playerMade.length, 42, 'and how each of the 42 is made');
  assert.equal(playerAll.length, 42 * 64);
  const pair = (data, f, m, j) => (data[f * 64 + j * 3 + (m >> 2)] >> (6 - 2 * (m & 3))) & 3;
  // Made the way the program makes them: the frame named, flipped left to right (1) and top to bottom
  // within lines 0-19 (2).
  for (let n = 0; n < 42; n++) {
    const from = playerMade[n] >> 2, h = playerMade[n] & 1, v = playerMade[n] & 2;
    assert.ok(from < 12, `frame ${n} is made from one of the twelve`);
    for (let j = 0; j < 21; j++)
      for (let m = 0; m < 12; m++)
        assert.equal(pair(playerAll, n, m, j), pair(player, from, h ? 11 - m : m, v && j < 20 ? 19 - j : j), `frame ${n}, pixel ${m},${j}`);
    assert.ok(playerAll.subarray(n * 64 + 60, n * 64 + 64).every((b) => b === 0), `frame ${n}: line 20 and the 64th byte are empty`);
  }
  // The forty walking frames: yellow jacket, black hair and feet, white face and hands, and round all of it a
  // black outline and then a white one, so no black or yellow touches the outside.
  for (let n = 0; n < 40; n++) {
    const counts = [0, 0, 0, 0];
    for (let j = 0; j < 21; j++)
      for (let m = 0; m < 12; m++) {
        const p = pair(playerAll, n, m, j);
        counts[p]++;
        if (p !== 1 && p !== 3) continue;
        for (const [dm, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const mm = m + dm, jj = j + dj;
          assert.ok(mm >= 0 && mm < 12 && jj >= 0 && jj < 21 && pair(playerAll, n, mm, jj) !== 0, `frame ${n}: pixel ${m},${j} is inside the white outline`);
        }
      }
    assert.ok(counts[3] >= 4 && counts[1] >= 20 && counts[2] >= 30, `frame ${n} has yellow, black and white (${counts})`);
  }
  // Standing looks the same from either side: facing east it is its own mirror image top to bottom.
  for (let j = 0; j < 20; j++) for (let m = 0; m < 12; m++) assert.equal(pair(playerAll, 2, m, j), pair(playerAll, 2, m, 19 - j));
  // The two feet take turns: a full stride with the left foot is the mirror image of one with the right.
  for (let j = 0; j < 20; j++) for (let m = 0; m < 12; m++) assert.equal(pair(playerAll, 0, m, j), pair(playerAll, 4, m, 19 - j));
  // Every way they face is drawn differently, and so is every pose.
  const frames = new Set(Array.from({ length: 42 }, (_, n) => playerAll.subarray(n * 64, n * 64 + 64).toString('hex')));
  assert.equal(frames.size, 42, 'no two frames are the same');
});
