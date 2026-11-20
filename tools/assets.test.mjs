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
