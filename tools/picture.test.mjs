// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of the title page's picture (tools/picture.mjs): what the C64 shows keeps to what a multicolour bitmap
// can show, stays close to the browser game's picture, and unpacks to the layout the title page expects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BACKGROUND, HEIGHT, TEXT_ROW, TOP, WIDTH, bitmap, colours, layout, readPng, text } from './picture.mjs';
import { pack, unpack } from './pack.mjs';

const png = readPng(readFileSync(new URL('../assets/title-sunset.png', import.meta.url)));
const source = colours(png);
const { koala, shown, changed } = bitmap(text(colours(png)));

test('each 4 x 8 cell shows the background and at most three colours of its own, as the bitmap says', () => {
  for (let row = 0; row < 25; row++) {
    for (let col = 0; col < 40; col++) {
      const cell = row * 40 + col;
      const choices = [BACKGROUND, koala[8000 + cell] >> 4, koala[8000 + cell] & 15, koala[9000 + cell]];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 4; x++) {
          const bits = (koala[cell * 8 + y] >> (6 - 2 * x)) & 3;
          assert.equal(shown[(row * 8 + y) * WIDTH + col * 4 + x], choices[bits], `cell ${col}, ${row}`);
        }
      }
    }
  }
});

test('the picture is the browser game\'s, 10 lines down, with no more than 5 % of its pixels in another colour', () => {
  assert.deepEqual([png.width, png.height], [320, 180]);
  let differ = 0;
  for (let y = 0; y < TEXT_ROW * 8; y++) for (let x = 0; x < WIDTH; x++) if (shown[y * WIDTH + x] !== source[y * WIDTH + x]) differ++;
  assert.ok(differ <= 0.05 * WIDTH * 180, `${differ} pixels differ`);
  assert.ok(changed >= differ);
  for (let y = 0; y < TOP; y++) for (let x = 0; x < WIDTH; x++) assert.equal(shown[y * WIDTH + x], BACKGROUND, 'black above');
});

test('PRESS FIRE ... is in the last row, in colour 1 of its cells (which the title page blinks), and nothing else is', () => {
  let lit = 0;
  for (let y = TEXT_ROW * 8; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const k = shown[y * WIDTH + x];
      assert.ok(k === BACKGROUND || k === 1, 'white on black');
      if (k) {
        lit++;
        const cell = TEXT_ROW * 40 + (x >> 2);
        assert.equal(koala[8000 + cell] >> 4, 1, 'in colour 1');
        assert.equal((koala[cell * 8 + y - TEXT_ROW * 8] >> (6 - 2 * (x & 3))) & 3, 1);
      }
    }
  }
  assert.ok(lit > 300, `the text is there (${lit} pixels)`);
});

test('packed, it unpacks to the screen at $c000, colour memory\'s at $c3e8 and the bitmap at $e000', () => {
  const out = Buffer.from(unpack(pack(layout(koala))));
  assert.equal(out.length, 0x2000 + 8000);
  assert.ok(out.subarray(0, 1000).equals(koala.subarray(8000, 9000)), 'screen');
  assert.ok(out.subarray(1000, 2000).equals(koala.subarray(9000, 10000)), 'colour memory');
  assert.ok(out.subarray(0x2000).equals(koala.subarray(0, 8000)), 'bitmap');
});
