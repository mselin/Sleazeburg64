// SPDX-License-Identifier: GPL-2.0-or-later
// The title picture, as the C64 shows it: a multicolour bitmap made from the browser game's picture.
//
//   node tools/picture.mjs assets/title-sunset.png build/title.bin [preview.png] [TEXT]
//
// TEXT in place of PRESS FIRE TO COMMIT CRIMES: the loader's picture says LOADING (src/loader.asm).
//
// The browser game's picture (mselin/gta-c64, assets/title-sunset.png) is 320 x 180 in the 16 C64 colours,
// its pixels two wide: a multicolour bitmap's pixels, but with no care for what a character cell may hold.
// Here it goes 10 lines down a 160 x 200 bitmap, black above and below, and each 4 x 8 cell keeps black (the
// background, shared by them all) and the three colours it uses most; a pixel in any other colour takes the
// nearest of those four. Under it, in the last character row, PRESS FIRE TO COMMIT CRIMES in white, in the
// font (tools/font.mjs) with its pixels two wide: colour 1 of those cells, which the title screen blinks.
//
// Out, packed (tools/pack.mjs): the picture as it goes from $c000, which src/title-page.asm unpacks it to
// and shows: 1000 bytes of screen (colours 1 and 2 of each cell, high and low nybble), 1000 of what goes in
// colour memory (colour 3), nothing up to $e000, then the 8000 bytes of the bitmap.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { FONT } from './font.mjs';
import { pack } from './pack.mjs';

/** The C64's colours (as the browser game has them: specs/design.md there). */
export const PALETTE = ['000000', 'ffffff', '68372b', '70a4b2', '6f3d86', '588d43', '352879', 'b8c76f',
  '6f4f25', '433900', '9a6759', '444444', '6c6c6c', '9ad284', '6c5eb5', '959595'].map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
export const WIDTH = 160, HEIGHT = 200, TOP = 10, BACKGROUND = 0, TEXT_COLOUR = 1;
export const TEXT = 'PRESS FIRE TO COMMIT CRIMES', LOADING = 'LOADING', TEXT_ROW = 24;
const SPACE = 4; // a space's width in pixels: with a whole glyph's, the text would be wider than the screen

/** An 8-bit RGB or RGBA PNG with no interlace: { width, height, pixel(x, y) → [r, g, b] }. */
export function readPng(bytes) {
  let at = 8, width, height, depth, type, interlace;
  const data = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at), name = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') [width, height, depth, type, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    if (name === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const channels = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error('only 8-bit RGB or RGBA PNGs with no interlace');
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0, b = y ? out[(y - 1) * stride + i] : 0;
      const c = i >= channels && y ? out[(y - 1) * stride + i - channels] : 0;
      const paeth = () => {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      };
      const add = [0, a, b, (a + b) >> 1, paeth()][filter];
      out[y * stride + i] = (line[i] + add) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [...out.subarray(y * stride + x * channels, y * stride + x * channels + 3)] };
}

/** An RGB PNG of `rgb` (width x height x 3 bytes), for looking at. */
export function writePng(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length);
    head.write(name, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const distance = (a, b) => PALETTE[a].reduce((sum, v, i) => sum + (v - PALETTE[b][i]) ** 2 * [3, 4, 2][i], 0);

/**
 * The picture's colours, 160 x 200 (0-15 each), from the browser game's PNG: each pixel pair's colour,
 * 10 lines down, black round it.
 */
export function colours(png) {
  if (png.width !== 2 * WIDTH || png.height > HEIGHT - TOP) throw new Error(`expected 320 x at most ${HEIGHT - TOP}`);
  const index = new Map(PALETTE.map((rgb, i) => [rgb.join(), i]));
  const out = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const k = index.get(png.pixel(2 * x, y).join());
      if (k === undefined) throw new Error(`a colour that is not a C64 one at ${2 * x}, ${y}`);
      out[(y + TOP) * WIDTH + x] = k;
    }
  }
  return out;
}

/** `words` written into `pixels` across the last character row, in the middle. */
export function text(pixels, words = TEXT) {
  const width = [...words].reduce((w, ch) => w + (ch === ' ' ? SPACE : 6), -1);
  if (width > WIDTH) throw new Error('the text is wider than the screen');
  let x = (WIDTH - width) >> 1;
  for (const ch of words) {
    if (ch === ' ') {
      x += SPACE;
      continue;
    }
    FONT[ch].forEach((bits, y) => {
      for (let i = 0; i < 5; i++) if (bits & (16 >> i)) pixels[(TEXT_ROW * 8 + y) * WIDTH + x + i] = TEXT_COLOUR;
    });
    x += 6;
  }
  return pixels;
}

/** What goes from $c000: screen, colour memory, nothing, then the bitmap at $e000. */
export function layout(koala) {
  const out = Buffer.alloc(0x2000 + 8000);
  koala.copy(out, 0, 8000, 9000);
  koala.copy(out, 1000, 9000, 10000);
  koala.copy(out, 0x2000, 0, 8000);
  return out;
}

/**
 * The bitmap: { koala (10001 bytes), shown (the 160 x 200 colours it shows), changed (pixels that had to
 * take another colour) }.
 */
export function bitmap(pixels) {
  const koala = Buffer.alloc(10001), shown = new Uint8Array(WIDTH * HEIGHT);
  let changed = 0;
  for (let row = 0; row < 25; row++) {
    for (let col = 0; col < 40; col++) {
      const cell = row * 40 + col, count = new Map();
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
        const k = pixels[(row * 8 + y) * WIDTH + col * 4 + x];
        if (k !== BACKGROUND) count.set(k, (count.get(k) ?? 0) + 1);
      }
      // The three it uses most (ties to the lower colour, so that it is always the same), as bit pairs 1-3.
      const kept = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([k]) => k);
      while (kept.length < 3) kept.push(BACKGROUND);
      const choices = [BACKGROUND, ...kept];
      koala[8000 + cell] = (kept[0] << 4) | kept[1];
      koala[9000 + cell] = kept[2];
      for (let y = 0; y < 8; y++) {
        let byte = 0;
        for (let x = 0; x < 4; x++) {
          const at = (row * 8 + y) * WIDTH + col * 4 + x, k = pixels[at];
          let bits = choices.indexOf(k);
          if (bits < 0) {
            changed++;
            bits = choices.reduce((best, c, i) => (distance(k, c) < distance(k, choices[best]) ? i : best), 0);
          }
          shown[at] = choices[bits];
          byte |= bits << (6 - 2 * x);
        }
        koala[cell * 8 + y] = byte;
      }
    }
  }
  koala[10000] = BACKGROUND;
  return { koala, shown, changed };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))) {
  const [source, out, preview, words = TEXT] = process.argv.slice(2);
  const { koala, shown, changed } = bitmap(text(colours(readPng(readFileSync(source))), words));
  const packed = Buffer.from(pack(layout(koala)));
  writeFileSync(out, packed);
  if (preview) {
    const rgb = Buffer.alloc(WIDTH * 2 * HEIGHT * 3);
    for (let i = 0; i < WIDTH * HEIGHT; i++) for (const half of [0, 1]) rgb.set(PALETTE[shown[i]], (i * 2 + half) * 3);
    writeFileSync(preview, writePng(WIDTH * 2, HEIGHT, rgb));
  }
  console.log(`${out}: ${packed.length} bytes packed; ${changed} of ${WIDTH * HEIGHT} pixels took another colour to fit their cell`);
}
