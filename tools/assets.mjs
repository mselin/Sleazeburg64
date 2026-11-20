// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the binary data the C64 program includes: the character set, the tile definitions and the city map.
//
//   node tools/assets.mjs <output directory>
//
// The screen is in multicolour character mode. Every pixel of a character is two screen pixels wide and has
// one of four values:
//   0  the background colour      (dark grey: asphalt)
//   1  shared multicolour 1       (light grey: pavement, highlights)
//   2  shared multicolour 2       (black: outlines)
//   3  the character's own colour (one of the first eight C64 colours, set per tile)
// A city tile is 16x16 screen pixels, so 8x16 of these wide pixels, and is drawn with four characters.
//
// Every character has exactly one colour, so the program can work out colour memory from the characters on
// screen. Two tiles of different colours share a character only if it has no pixels of value 3, which is
// the only value the colour shows in.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLD, CITY_CHECKSUM, FOUNT, GRASS, LOT, MW, PB, PLAZA, ROAD, TREE, WALK, WATER, checksum, generate, hash } from './city.mjs';
import { FONT } from './font.mjs';

const WHITE = 1, RED = 2, CYAN = 3, PURPLE = 4, GREEN = 5, BLUE = 6, YELLOW = 7;
const FIRST_TILE_CHAR = 64; // characters 0-63 are the font
/** Roof colours of the browser game mapped onto the eight a multicolour character can have. */
const ROOF = { 1: WHITE, 2: RED, 3: CYAN, 4: PURPLE, 6: BLUE, 8: YELLOW, 9: RED, 10: CYAN, 12: WHITE, 14: BLUE, 15: WHITE };

// ---------- characters ----------
const chars = []; // each an array of 8 bytes
const charColours = []; // the colour memory value for each of them
const charIndex = new Map();
function charFor(rows, colour) {
  const bytes = rows.map((r) => r.reduce((b, v) => (b << 2) | v, 0));
  const ownColour = rows.some((r) => r.includes(3));
  const key = bytes.join(',') + (ownColour ? `/${colour}` : '');
  if (!charIndex.has(key)) {
    charIndex.set(key, FIRST_TILE_CHAR + chars.length);
    chars.push(bytes);
    charColours.push(colour | 8); // 8 and up: the character is drawn in multicolour
  }
  return charIndex.get(key);
}

// ---------- tiles ----------
const tiles = []; // { tl, tr, bl, br, col }
const tileIndex = new Map();
/** Register a tile from a function giving the value (0-3) of each of its 8x16 wide pixels. */
function tile(colour, at) {
  const quarter = (x0, y0) =>
    charFor(Array.from({ length: 8 }, (_, y) => Array.from({ length: 4 }, (_, x) => at(x0 + x, y0 + y))), colour);
  const t = { tl: quarter(0, 0), tr: quarter(4, 0), bl: quarter(0, 8), br: quarter(4, 8), col: colour | 8 };
  const key = [t.tl, t.tr, t.bl, t.br, t.col].join(',');
  if (!tileIndex.has(key)) {
    tileIndex.set(key, tiles.length);
    tiles.push(t);
  }
  return tileIndex.get(key);
}

const plaza = (x, y) => (x < 4 === y < 8 ? 1 : 0);
const DESIGN = {
  road: (speck) => tile(WHITE, (x, y) => (speck && ((x === 2 && y === 5) || (x === 5 && y === 12)) ? 2 : 0)),
  // Centre-line dashes sit on the edge shared by the two lanes.
  laneV: () => tile(YELLOW, (x, y) => (x === 7 && y % 8 >= 2 && y % 8 < 7 ? 3 : 0)),
  laneH: () => tile(YELLOW, (x, y) => (y === 15 && x % 4 < 3 ? 3 : 0)),
  zebraV: () => tile(WHITE, (x, y) => (x % 2 === 0 && y >= 3 && y <= 12 ? 3 : 0)),
  zebraH: () => tile(WHITE, (x, y) => (x >= 1 && x <= 6 && (y % 4 === 1 || y % 4 === 2) ? 3 : 0)),
  walk: () => tile(WHITE, (x, y) => (x === 0 || y === 0 ? 0 : 1)),
  /** A roof. `edge` says on which sides the building ends: those get an outline, and a highlight top and left. */
  roof: (colour, edge, unit) =>
    tile(colour, (x, y) => {
      if ((edge.w && x === 0) || (edge.e && x === 7) || (edge.n && y === 0) || (edge.s && y === 15)) return 2;
      if ((edge.w && x === 1) || (edge.n && y === 1)) return 1;
      if (unit && x >= 2 && x <= 5 && y >= 5 && y <= 10) return x === 2 || x === 5 || y === 5 || y === 10 ? 2 : 1;
      return 3;
    }),
  grass: (v) => tile(GREEN, (x, y) => ((x === 1 + v * 3 && y === 4) || (x === 6 - v * 2 && y === 11) ? 2 : 3)),
  tree: () =>
    tile(GREEN, (x, y) => {
      const d = Math.hypot((x - 3.5) * 2, y - 7.5);
      if (d > 7.6) return 3;
      if (d > 5.6) return 2;
      return (x + y) % 3 === 0 ? 1 : 3;
    }),
  water: (v) => tile(BLUE, (x, y) => ((y === 3 + v * 4 && x >= 1 && x <= 2) || (y === 11 - v * 3 && x >= 5 && x <= 6) ? 1 : 3)),
  lot: (bay) => tile(WHITE, (x) => (bay && x === 0 ? 1 : 0)),
  plaza: () => tile(WHITE, plaza),
  /** One quarter of the round fountain pool. qx and qy say which: 0 is the left or upper half. */
  fountain: (qx, qy) =>
    tile(CYAN, (x, y) => {
      const d = Math.hypot((x + 0.5 - (qx ? 0 : 8)) * 2, y + 0.5 - (qy ? 0 : 16));
      if (d > 15) return plaza(x, y);
      if (d > 12.5) return 2;
      return d < 3 ? 1 : 3;
    }),
};

// ---------- the city as tile numbers ----------
const { map, bid, bcol } = generate();
if (checksum(map) !== CITY_CHECKSUM) throw new Error('the city no longer matches the browser game');
const typeAt = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MW ? WATER : map[y * MW + x]);
const sameBuilding = (x, y, id) => x >= 0 && y >= 0 && x < MW && y < MW && bid[y * MW + x] === id;

// What each tile is to a car: 0 open, 1 a wall (buildings and trees), 2 grass (less grip), 3 water (the canal and
// the fountain: open for now; cars flood in it later). Tiles that look the same share a design, so every
// city tile type behind a design must agree on its kind.
const KIND_OF = { [BLD]: 1, [TREE]: 1, [GRASS]: 2, [WATER]: 3, [FOUNT]: 3 };
const tileKinds = [];

const out = new Uint8Array(MW * MW);
for (let y = 0; y < MW; y++)
  for (let x = 0; x < MW; x++) {
    const i = y * MW + x,
      t = map[i],
      h = hash(x, y),
      mx = x % PB,
      my = y % PB;
    let id;
    if (t === ROAD) {
      const v = mx < 2,
        hz = my < 2;
      if (v && !hz) id = my === 2 || my === 11 ? DESIGN.zebraV() : mx === 0 ? DESIGN.laneV() : DESIGN.road(h % 5 === 0);
      else if (hz && !v) id = mx === 2 || mx === 11 ? DESIGN.zebraH() : my === 0 ? DESIGN.laneH() : DESIGN.road(h % 5 === 0);
      else id = DESIGN.road(false);
    } else if (t === WALK) id = DESIGN.walk();
    else if (t === BLD) {
      const b = bid[i];
      const edge = { n: !sameBuilding(x, y - 1, b), s: !sameBuilding(x, y + 1, b), w: !sameBuilding(x - 1, y, b), e: !sameBuilding(x + 1, y, b) };
      const inner = !edge.n && !edge.s && !edge.w && !edge.e;
      id = DESIGN.roof(ROOF[bcol[i]] ?? WHITE, edge, inner && h % 7 === 0);
    } else if (t === GRASS) id = DESIGN.grass(h & 1);
    else if (t === TREE) id = DESIGN.tree();
    else if (t === WATER) id = DESIGN.water(h & 1);
    else if (t === LOT) id = DESIGN.lot(my - 3 < 2 || my - 3 > 5);
    else if (t === PLAZA) id = DESIGN.plaza();
    else if (t === FOUNT) id = DESIGN.fountain(typeAt(x - 1, y) === FOUNT ? 1 : 0, typeAt(x, y - 1) === FOUNT ? 1 : 0);
    out[i] = id;
    const kind = KIND_OF[t] ?? 0;
    if (tileKinds[id] !== undefined && tileKinds[id] !== kind) throw new Error(`tile design ${id} is used for two kinds of ground`);
    tileKinds[id] = kind;
  }
if (tiles.length > 256) throw new Error(`${tiles.length} tiles, but a map byte can only name 256`);
if (FIRST_TILE_CHAR + chars.length > 256) throw new Error(`${chars.length} tile characters do not fit beside the font`);

// ---------- the character set: font first, then the tile characters ----------
const charset = new Uint8Array(2048);
for (let code = 0; code < FIRST_TILE_CHAR; code++) {
  // Screen codes: 0 is @, 1-26 the letters, 32-63 the same as ASCII.
  const ch = code === 0 ? '@' : code <= 26 ? String.fromCharCode(64 + code) : code >= 32 ? String.fromCharCode(code) : '';
  const glyph = FONT[ch];
  if (glyph) glyph.forEach((row, r) => (charset[code * 8 + r] = row << 2));
}
chars.forEach((bytes, n) => charset.set(bytes, (FIRST_TILE_CHAR + n) * 8));

// Four tables of 256 giving each tile's characters, then the colour of each character (font characters are
// white, so text drawn in the city's character mode would show as two-colour text), then each tile's kind.
const tileData = new Uint8Array(6 * 256);
tiles.forEach((t, n) => {
  tileData[n] = t.tl;
  tileData[256 + n] = t.tr;
  tileData[512 + n] = t.bl;
  tileData[768 + n] = t.br;
});
tileData.fill(1, 1024, 1024 + FIRST_TILE_CHAR);
charColours.forEach((c, n) => (tileData[1024 + FIRST_TILE_CHAR + n] = c));
tileKinds.forEach((k, n) => (tileData[1280 + n] = k));
// The idle graphics the video chip shows between the city and the panel come from the last byte of the
// character set. It has to be empty, so those lines show the background colour.
if (FIRST_TILE_CHAR + chars.length > 255) throw new Error('character 255 is needed empty');

const dir = process.argv[2] || 'build';
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'chars.bin'), charset);
writeFileSync(join(dir, 'tiles.bin'), tileData);
writeFileSync(join(dir, 'map.bin'), out);

// ---------- the car: a two-colour sprite in 16 directions ----------
// Sprite pixel (i, j) is the city pixel (x + i - 12, y + j - 10) for a car whose centre is at (x, y). The car
// is 19 pixels long and 10 wide with rounded corners, and the windscreen and rear window are holes through
// it. Direction k points at k * 22.5 degrees clockwise from east, as the program counts angles.
export const CAR = { length: 19, width: 10 };
export function carFrame(k) {
  // Rounded, so that a quarter turn is exactly one and pixels on an edge fall the same way in every direction.
  const a = (k * Math.PI) / 8, c = Math.round(Math.cos(a) * 1e9) / 1e9, s = Math.round(Math.sin(a) * 1e9) / 1e9;
  const bytes = new Uint8Array(64);
  for (let j = 0; j < 21; j++)
    for (let i = 0; i < 24; i++) {
      const rx = i - 12, ry = j - 10;
      const u = rx * c + ry * s, v = -rx * s + ry * c;
      const au = Math.abs(u), av = Math.abs(v);
      let on = au <= CAR.length / 2 && av <= CAR.width / 2;
      if (on && au > 7.5 && av > 3 && Math.hypot(au - 7.5, av - 3) > 2) on = false; // rounded corners
      if ((u >= 2 && u <= 4.5 && av <= 3.5) || (u >= -7.5 && u <= -6 && av <= 3.5)) on = false; // windows
      if (on) bytes[j * 3 + (i >> 3)] |= 0x80 >> (i & 7);
    }
  return bytes;
}
const car = new Uint8Array(16 * 64);
for (let k = 0; k < 16; k++) car.set(carFrame(k), k * 64);
writeFileSync(join(dir, 'car.bin'), car);
console.log(`assets: ${tiles.length} tiles, ${chars.length} tile characters, map ${MW}x${MW} (${out.length} bytes)`);
