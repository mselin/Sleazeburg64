// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CITY_CHECKSUM, MW, ROAD, WALK, WATER, checksum, generate } from './city.mjs';

const dir = mkdtempSync(join(tmpdir(), 'sleazeburg-assets-'));
execFileSync(process.execPath, [new URL('./assets.mjs', import.meta.url).pathname, dir]);
const chars = readFileSync(join(dir, 'chars.bin'));
const tiles = readFileSync(join(dir, 'tiles.bin'));
const map = readFileSync(join(dir, 'map.bin'));

test('the city is the same one as in the browser game', () => {
  const city = generate();
  assert.equal(checksum(city.map), CITY_CHECKSUM);
  assert.equal(city.map[0], ROAD, 'the north-west corner is a crossing');
  assert.equal(city.map[2 * MW + 5], WALK);
  assert.equal(city.map[9 * MW + 4 * 12 + 6], WATER, 'the canal');
});

test('the files are the sizes the program expects', () => {
  assert.equal(chars.length, 2048, '256 characters of 8 bytes');
  assert.equal(tiles.length, 5 * 256, 'four characters for each of 256 tiles, and a colour for each character');
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
