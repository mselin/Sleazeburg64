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
// Every tile has one colour, and the program works out colour memory a tile at a time from the map. Two
// tiles of different colours share a character only if it has no pixels of value 3, which is the only value
// the colour shows in, so every character still shows in the colour it was drawn with.
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
// the fountain, where cars flood), 4 a pavement or a plaza (open to a car; where people like to walk). Tiles that look the same share a design, so every
// city tile type behind a design must agree on its kind.
const KIND_OF = { [BLD]: 1, [TREE]: 1, [GRASS]: 2, [WATER]: 3, [FOUNT]: 3, [WALK]: 4, [PLAZA]: 4 };
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

// ---------- Big Honk: a multicolour sprite facing four ways, walking or flapping ----------
// The browser game's design (specs/design.md there): a white goose seen from above, in black sunglasses and a
// gold chain, with a black outline. A multicolour sprite has three colours: white is the sprite's own, black
// and yellow the two all sprites share, so his beak is yellow like his chain (the browser game's is orange),
// and his grey tail and folded wings are white. Each sprite pixel is two screen pixels wide: pixel (m, j) is
// sampled at (2m - 11, j - 10) from his centre, which is where a car's centre is in its sprite. He is drawn a
// pixel further back than the browser game draws him, so that his outline fits the sprite facing any way.
// Frame 2 * dir + flap: dir 0 east, 1 south, 2 west, 3 north, as the traffic counts them; flap 1 has his wings
// out and his beak open. Each pixel pair: 0 transparent, 1 black, 2 white, 3 yellow.
export const HONK_FIRST_CHAR = 184; // his frames start at character 184 of the character set: $3dc0
export const HONK_WALK = 0, HONK_FLAP = 1;
function gooseAt(flap, x, y) {
  const box = (x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1, ay = Math.abs(y);
  let c = 0;
  if (flap && ay >= 4 && ay <= 9 && x >= -4 && x <= 0) c = 2; // wings out
  if (box(-8, -6, -2, 2)) c = 2; // tail
  if (box(-6, 0, -4, 4) && Math.abs(x + 3) / 3 + ay / 4 <= 1.6) c = 2; // body
  if (box(0, 2, -2, 2)) c = 3; // chain
  if (box(2, 4, -2, 2)) c = 2; // neck
  if (box(4, 6, -4, 4)) c = 1; // shades
  if (box(6, 8, -2, 2)) c = 2; // head
  if (box(8, 10, flap ? -3 : -1.5, flap ? 3 : 1.5)) c = 3; // beak, open wide when he flaps
  return c;
}
/** Big Honk facing `dir`, flapping or not, as 12 x 21 pixel pairs (0-3), outline included. */
export function honkPixels(dir, flap) {
  const cs = [1, 0, -1, 0][dir], sn = [0, 1, 0, -1][dir], px = [];
  for (let j = 0; j < 21; j++)
    for (let m = 0; m < 12; m++) {
      const dx = 2 * m - 11, dy = j - 10;
      px.push(gooseAt(flap, cs * dx + sn * dy + 1, -sn * dx + cs * dy));
    }
  const on = (m, j) => m >= 0 && j >= 0 && m < 12 && j < 21 && px[j * 12 + m] !== 0;
  const ring = [];
  for (let j = 0; j < 21; j++)
    for (let m = 0; m < 12; m++) if (!on(m, j) && (on(m - 1, j) || on(m + 1, j) || on(m, j - 1) || on(m, j + 1))) ring.push(j * 12 + m);
  for (const i of ring) px[i] = 1;
  return px;
}
/** His eight frames as sprite data, 64 bytes each. */
export function honkFrames() {
  const frames = [];
  for (let dir = 0; dir < 4; dir++)
    for (const flap of [HONK_WALK, HONK_FLAP]) {
      const px = honkPixels(dir, flap), bytes = new Uint8Array(64);
      px.forEach((c, i) => (bytes[Math.floor(i / 12) * 3 + ((i % 12) >> 2)] |= c << (6 - 2 * (i & 3))));
      frames.push(bytes);
    }
  return frames;
}


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
// white, so text drawn in the city's character mode would show as two-colour text), then each tile's kind,
// then each tile's colour, which is what goes into colour memory.
const tileData = new Uint8Array(7 * 256);
// The program keeps other things in each table by tile after its first TILE_ROOM entries (src/main.asm).
export const TILE_ROOM = 112;
if (tiles.length > TILE_ROOM) throw new Error(`${tiles.length} tiles: the tables by tile have room for ${TILE_ROOM}`);
tiles.forEach((t, n) => {
  tileData[n] = t.tl;
  tileData[256 + n] = t.tr;
  tileData[512 + n] = t.bl;
  tileData[768 + n] = t.br;
});
tileData.fill(1, 1024, 1024 + FIRST_TILE_CHAR);
charColours.forEach((c, n) => (tileData[1024 + FIRST_TILE_CHAR + n] = c));
tileKinds.forEach((k, n) => (tileData[1280 + n] = k));
tiles.forEach((t, n) => (tileData[1536 + n] = t.col));
// The idle graphics the video chip shows between the city and the panel come from the last byte of the
// character set. It has to be empty, so those lines show the background colour.
if (FIRST_TILE_CHAR + chars.length > 255) throw new Error('character 255 is needed empty');
// The characters after the tile characters hold Big Honk's sprite (see below), where the video chip can see it.
if (FIRST_TILE_CHAR + chars.length > HONK_FIRST_CHAR) throw new Error('the tile characters run into Big Honk');
honkFrames().forEach((bytes, n) => charset.set(bytes, HONK_FIRST_CHAR * 8 + n * 64));

// The status panel's bars (src/status.asm), after him: character 247 + n has the bar's left n pixel columns
// filled, n from 1 to 8, in its rows 2-5, where the browser game fills its bars. Row 7 of the last, the last
// byte of the character set, stays empty for the video chip's idle fetches.
export const BAR_FIRST_CHAR = 248;
for (let n = 1; n <= 8; n++) for (let r = 2; r <= 5; r++) charset[(BAR_FIRST_CHAR - 1 + n) * 8 + r] = (0xff00 >> n) & 0xff;

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

// ---------- the player on foot: a multicolour sprite facing eight ways in five walking poses, and swimming ----------
// The browser game's person (specs/design.md there, "People on foot"): square shoulders with the corners cut,
// a round head that pokes out in front, a hand each side and two feet, seen from above and facing east, then
// turned and sampled once in the middle of each 2 x 2 block. A block here is one sprite pixel (two screen
// pixels wide) by two lines. Round that goes a black outline and then a white one, a sprite pixel wide and a
// line tall, which is as thin as a multicolour sprite draws them.
//
// Colours. A multicolour sprite has three: white is the sprite's own, and black and yellow are the two all
// sprites share (as for Big Honk). So the jacket is yellow all over (the browser game shades its back), the
// hair and the feet are black, and the face and the hands are white where the browser game has a skin colour.
//
// Direction d faces d * 45 degrees clockwise from east. Pose p is the browser game's stride p: 0 has the left
// foot a full stride back, 2 stands, 4 has it a full stride forward. The figure's middle is the corner between
// sprite pixels (5, 9) and (6, 10), which is screen pixel (12, 10) of the sprite: where a car's middle is.
// Line 20 is always empty.
//
// Mirror images. Turning a figure over swaps its left and right, so a pose turns into the one with the other
// foot forward: frame (d, p) flipped left to right is frame (4 - d, 4 - p), and flipped top to bottom (within
// lines 0-19) it is frame (-d, 4 - p). So the program file holds only eleven frames, and the program makes
// the other twenty-nine by flipping them when it starts (PLAYER_MADE says how): east and south in poses 0-2,
// and south-east in all five.
export const PLAYER_DIRS = 8, PLAYER_POSES = 5;
const STRIDES = [-1, -0.5, 0, 0.5, 1];
/**
 * A person facing +x with +y on their right: 0 nothing, 1 black, 2 white, 3 yellow. `punch`: the right arm
 * straight out in front, the design's punch, with a bigger fist about 7 pixels ahead of the middle.
 */
function personAt(pose, x, y, punch = false) {
  const s = STRIDES[pose];
  const box = (x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const disc = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const nearLine = (ax, ay, bx, by, r) => {
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    return (x - ax - t * vx) ** 2 + (y - ay - t * vy) ** 2 <= r * r;
  };
  let c = 0;
  for (const side of [-1, 1]) {
    const f = -side * s * 3.4, fy = side * 1.9; // feet, stepping out in front and behind
    if (box(Math.min(0, f) - 1, Math.max(0, f) + 1, fy - 1.1, fy + 1.1)) c = 1;
  }
  if (Math.abs(x) <= 2.4 && Math.abs(y) <= 4.6 && Math.abs(x) / 2.4 + Math.abs(y) / 4.6 <= 1.6) c = 3; // shoulders
  for (const side of [-1, 1]) {
    if (punch && side === 1) {
      if (nearLine(0, 4, 6, 3, 1.1)) c = 3; // the right arm out, the fist at its end
      if (disc(7, 3, 1.7)) c = 2;
      continue;
    }
    const hx = side * s * 2.2, hy = side * 5; // arms: a sleeve and a hand, swinging opposite to the feet
    if (nearLine(0, side * 4, hx * 0.6, hy, 1.1)) c = 3;
    if (disc(hx, hy, 1.3)) c = 2;
  }
  if (disc(0.6, 0, 2.7)) c = x > 1.5 ? 2 : 1; // the head: hair, with the face to the front
  return c;
}
/** A ring a sprite pixel wide round whatever is drawn in a 12 x 21 grid of pixel pairs, in colour c. */
function ring(px, c) {
  const on = (m, j) => m >= 0 && j >= 0 && m < 12 && j < 21 && px[j * 12 + m] !== 0;
  const add = [];
  for (let j = 0; j < 21; j++)
    for (let m = 0; m < 12; m++) if (!on(m, j) && (on(m - 1, j) || on(m + 1, j) || on(m, j - 1) || on(m, j + 1))) add.push(j * 12 + m);
  for (const i of add) px[i] = c;
}
/** The player facing direction `d` in pose `p`, as 12 x 21 pixel pairs (0-3), outlines included. */
export function playerPixels(d, p, punch = false) {
  // Rounded, so that mirror images come out exactly alike.
  const a = (d * Math.PI) / 4, cs = Math.round(Math.cos(a) * 1e9) / 1e9, sn = Math.round(Math.sin(a) * 1e9) / 1e9;
  const px = new Array(12 * 21).fill(0);
  for (let br = 0; br < 10; br++)
    for (let m = 0; m < 12; m++) {
      const dx = 2 * m + 1 - 12, dy = 2 * br + 1 - 10; // the middle of the block
      const c = personAt(p, cs * dx + sn * dy, -sn * dx + cs * dy, punch);
      px[2 * br * 12 + m] = px[(2 * br + 1) * 12 + m] = c;
    }
  ring(px, 1);
  ring(px, 2);
  return px;
}
// ---------- pickups: a square in the kind's colour with a black edge and its letter ----------
// The design's pickups (specs/design.md there, "Pickups"): ammo A, cash $, donut O, bandage +, knife K. A
// multicolour sprite each: the square is the sprite's own colour (set when it is listed), the edge black (the
// shared colour every multicolour sprite has) and the letter yellow or black, the two shared colours. 12 screen
// pixels across, 6 pixel pairs by 12 lines, its middle where a car's is (screen pixel 12, line 10), so that a
// letter of 4 pixel pairs by 8 lines fits inside the edge.
export const PICKUP_KINDS = ['A', '$', 'O', '+', 'K'];
export const PICKUP_LETTER = [3, 3, 3, 1, 1]; // yellow on orange, green and light red; black on white and grey
const PICKUP_GLYPHS = {
  A: ['.##.', '#..#', '#..#', '####', '#..#', '#..#', '#..#', '....'],
  $: ['.##.', '###.', '#.#.', '.##.', '.#.#', '.###', '.##.', '....'],
  O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.', '....'],
  '+': ['....', '.##.', '.##.', '####', '####', '.##.', '.##.', '....'],
  K: ['#..#', '#.#.', '##..', '#...', '##..', '#.#.', '#..#', '....'],
};
export function pickupPixels(k) {
  const px = new Array(12 * 21).fill(0);
  for (let j = 0; j < 12; j++)
    for (let m = 0; m < 6; m++) {
      const edge = j === 0 || j === 11 || m === 0 || m === 5;
      const g = !edge && j >= 2 && j < 10 ? PICKUP_GLYPHS[PICKUP_KINDS[k]][j - 2][m - 1] : '.';
      px[(j + 4) * 12 + m + 3] = edge ? 1 : g === '#' ? PICKUP_LETTER[k] : 2;
    }
  return px;
}
/**
 * The paint shop's marker on the map: the browser game's `marker`, a square with its edge and letter in the
 * sprite's own colour (which flashes) and black inside, in the pickups' square.
 */
export function markerPixels() {
  const P = ['###.', '#..#', '#..#', '###.', '#...', '#...', '#...', '....'];
  const px = new Array(12 * 21).fill(0);
  for (let j = 0; j < 12; j++)
    for (let m = 0; m < 6; m++) {
      const edge = j === 0 || j === 11 || m === 0 || m === 5;
      const g = !edge && j >= 2 && j < 10 ? P[j - 2][m - 1] : '.';
      px[(j + 4) * 12 + m + 3] = edge || g === '#' ? 2 : 1;
    }
  return px;
}
/**
 * The S beside the paint shop's arrow (the browser game's, on black so it reads over the city): a black square of
 * 10 x 10 pixels (5 pairs across) with a cyan S (the sprite's own colour), 3 pairs by 7 lines, inside.
 */
export function signPixels() {
  const S = ['.##', '#..', '#..', '.#.', '..#', '..#', '##.'];
  const px = new Array(12 * 21).fill(0);
  for (let j = 0; j < 10; j++)
    for (let m = 0; m < 5; m++) px[j * 12 + m] = j >= 1 && j < 8 && m >= 1 && m < 4 && S[j - 1][m - 1] === '#' ? 2 : 1;
  return px;
}
/** The browser game's arrow (`ARW` in js/sprites.js): seven by seven, pointing east. */
const ARROW = ['...#...', '...##..', '######.', '#######', '######.', '...##..', '...#...'];
/**
 * The arrow turned to each of 16 ways (way k: k / 16 of a turn clockwise from east), as the browser game's
 * `mkSprite(..., 7, 7, 16, 11)` turns it: 11 lines of 11 hi-res pixels, each line two bytes, the first pixel the
 * top bit.
 */
export function arrowRows(k) {
  const an = (k / 16) * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an), S = 11, rows = [];
  for (let y = 0; y < S; y++) {
    let bits = 0;
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2,
        sx = Math.floor(cs * dx + sn * dy + 7 / 2), sy = Math.floor(-sn * dx + cs * dy + 7 / 2);
      if (sx >= 0 && sy >= 0 && sx < 7 && sy < 7 && ARROW[sy][sx] === '#') bits |= 0x8000 >> x;
    }
    rows.push(bits);
  }
  return rows;
}
/** Way k's whole frame, as it is in the sprite at $2500 once it is copied there. */
export function arrowFrame(k) {
  const bytes = new Uint8Array(64);
  arrowRows(k).forEach((b, y) => ((bytes[y * 3] = b >> 8), (bytes[y * 3 + 1] = b & 255)));
  return bytes;
}
/** Ways 0-8's lines for the program (under the I/O area), 22 bytes each: ways 9-15 are ways 7-1 upside down,
 * which the program copies them as (refused here if that ever stops being so). */
export function arrowBytes() {
  const out = new Uint8Array(22 * 9);
  for (let k = 0; k < 16; k++) {
    const rows = arrowRows(k);
    if (k > 8) {
      const up = arrowRows(16 - k);
      if (rows.some((b, y) => b !== up[10 - y])) throw new Error(`arrow way ${k} is not way ${16 - k} upside down`);
    } else rows.forEach((b, y) => ((out[k * 22 + 2 * y] = b >> 8), (out[k * 22 + 2 * y + 1] = b & 255)));
  }
  return out;
}
export function pickupFrames() {
  return PICKUP_KINDS.map((_, k) => spriteBytes(pickupPixels(k)));
}

/** The player punching, facing each of the eight ways: standing, the right arm out. Copied to $0200 at start. */
export function punchFrames() {
  const frames = [];
  for (let d = 0; d < PLAYER_DIRS; d++) frames.push(spriteBytes(playerPixels(d, 2, true)));
  for (const frame of frames) if (frame.subarray(60).some((b) => b)) throw new Error('a punching frame uses line 20');
  return frames;
}
/**
 * The player swimming: a head above the water, black hair behind a white face, in its two outlines; one arm
 * reaching out, on one side and then the other; and ripples a little way off, which move between the two frames.
 */
export function swimmerPixels(f) {
  const px = new Array(12 * 21).fill(0);
  const set = (m, j, c) => (px[j * 12 + m] = c);
  for (const m of [5, 6]) for (const j of [8, 9, 10, 11]) set(m, j, j < 10 ? 1 : 2);
  ring(px, 1);
  ring(px, 2);
  for (const j of [9, 10]) set(f ? 4 : 7, j, 2); // the arm, across the black outline
  for (const m of [0, 1]) set(m, f ? 11 : 12, 2); // ripples
  for (const m of [10, 11]) set(m, f ? 12 : 11, 2);
  for (const m of [4, 5, 6, 7]) set(m, 15, 2);
  set(f ? 2 : 9, 14, 2);
  return px;
}
const spriteBytes = (px) => {
  const bytes = new Uint8Array(64);
  px.forEach((c, i) => (bytes[Math.floor(i / 12) * 3 + ((i % 12) >> 2)] |= c << (6 - 2 * (i & 3))));
  return bytes;
};
/** Sprite data flipped: left to right (h), or top to bottom within lines 0-19 (v). Line 20 stays. */
export function flipSprite(bytes, h, v) {
  const out = new Uint8Array(64);
  const pairsBack = (b) => ((b & 3) << 6) | ((b & 12) << 2) | ((b & 48) >> 2) | (b >> 6);
  for (let j = 0; j < 21; j++) {
    const from = v && j < 20 ? 19 - j : j;
    for (let k = 0; k < 3; k++) out[j * 3 + k] = h ? pairsBack(bytes[from * 3 + 2 - k]) : bytes[from * 3 + k];
  }
  return out;
}
/** Frame numbers: direction * 5 + pose for the forty walking frames, then the two swimming ones. */
export const PLAYER_SWIM = PLAYER_DIRS * PLAYER_POSES, PLAYER_FRAME_COUNT = PLAYER_SWIM + 2;
/**
 * Everything about the player's frames: all 42 as the program has them once it has started, the 12 the
 * program file holds, and for each of the 42 which of those it is made from and how: stored * 4, plus 1 if
 * flipped left to right and 2 if top to bottom.
 */
export function playerFrames() {
  const all = [];
  for (let d = 0; d < PLAYER_DIRS; d++) for (let p = 0; p < PLAYER_POSES; p++) all.push(spriteBytes(playerPixels(d, p)));
  for (const f of [0, 1]) all.push(spriteBytes(swimmerPixels(f)));
  const kept = [0, 1, 2, 10, 11, 12, 5, 6, 7, 8, 9, PLAYER_SWIM]; // east, south, south-east, and swimming
  const stored = kept.map((n) => all[n]);
  const same = (a, b) => a.every((v, i) => v === b[i]);
  const made = all.map((frame, n) => {
    for (let k = 0; k < stored.length; k++)
      for (const flip of [0, 1, 2, 3]) if (same(flipSprite(stored[k], flip & 1, flip & 2), frame)) return k * 4 + flip;
    throw new Error(`the player's frame ${n} is no mirror image of a frame the program holds`);
  });
  for (const frame of all) if (frame.subarray(60).some((b) => b)) throw new Error("a player's frame uses line 20");
  return { all, stored, made };
}
const player = playerFrames();

// ---------- passers-by: the player's figure in four directions and five poses, in their own colours ----------
// The design's passers-by wear a shirt in one of eight colours, which is the sprite's own; hair, feet and
// the outline are black, and hands and face yellow, the two colours all multicolour sprites share. They have
// no white outline: that is the player's alone. Frame direction * 5 + pose, the directions east, south, west
// and north (the player's 0, 2, 4 and 6).
export const PEOPLE_DIRS = 4, PEOPLE_FRAME_COUNT = PEOPLE_DIRS * PLAYER_POSES;
export function personPixels(d, p) {
  const a = (d * Math.PI) / 2, cs = Math.round(Math.cos(a)), sn = Math.round(Math.sin(a));
  const px = new Array(12 * 21).fill(0);
  for (let br = 0; br < 10; br++)
    for (let m = 0; m < 12; m++) {
      const dx = 2 * m + 1 - 12, dy = 2 * br + 1 - 10;
      const c = [0, 1, 3, 2][personAt(p, cs * dx + sn * dy, -sn * dx + cs * dy)]; // shirt and skin swap places
      px[2 * br * 12 + m] = px[(2 * br + 1) * 12 + m] = c;
    }
  ring(px, 1);
  return px;
}
/**
 * Someone knocked down, by the design: flat on their back, head to the top, arms flung wide, legs out straight
 * below in the trousers' colour (black, as the outline), face up (yellow) with the hair at the crown. One
 * frame, whichever way they were going: frame PEOPLE_FRAME_COUNT.
 */
export function downPixels() {
  const at = (x, y) => {
    const disc = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    const nearLine = (ax, ay, bx, by, r) => {
      const vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
      return (x - ax - t * vx) ** 2 + (y - ay - t * vy) ** 2 <= r * r;
    };
    let c = 0;
    for (const side of [-1, 1]) if (nearLine(side * 1.2, 2, side * 1.6, 8, 1.0)) c = 1; // legs
    if (Math.abs(x) <= 2.6 && y >= -3.6 && y <= 2.4) c = 2; // the shirt
    for (const side of [-1, 1]) {
      if (nearLine(side * 2.4, -2.6, side * 6, -5, 1.0)) c = 2; // sleeves, flung wide ...
      if (disc(side * 6.6, -5.4, 1.3)) c = 3; // ... and hands
    }
    if (disc(0, -6.4, 2.7)) c = y < -7.6 ? 1 : 3; // the head: face up, hair at the crown
    return c;
  };
  const px = new Array(12 * 21).fill(0);
  for (let br = 0; br < 10; br++)
    for (let m = 0; m < 12; m++) {
      const c = at(2 * m + 1 - 12, 2 * br + 1 - 10);
      px[2 * br * 12 + m] = px[(2 * br + 1) * 12 + m] = c;
    }
  ring(px, 1);
  return px;
}
/**
 * A scooter rider, by the design: standing on the deck behind the handlebar, hands on it, facing direction d
 * (east, south, west, north), not walking. The design's scooter is grey, which a multicolour sprite does not
 * have (its own colour is the rider's shirt): here it is black, as the outline. Then, lying, frame 4: someone
 * knocked down, with the scooter on its side beside them.
 */
export const SCOOTER_FRAME_COUNT = 5;
function scooterAt(x, y) {
  const box = (x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const disc = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const nearLine = (ax, ay, bx, by, r) => {
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    return (x - ax - t * vx) ** 2 + (y - ay - t * vy) ** 2 <= r * r;
  };
  let c = 0;
  if (box(-7, 4, -1.2, 1.2) || disc(-7, 0, 1.4) || disc(4.6, 0, 1.4) || box(3, 4.2, -4.8, 4.8)) c = 1; // the scooter
  if (Math.abs(x) <= 2.4 && Math.abs(y) <= 4.6 && Math.abs(x) / 2.4 + Math.abs(y) / 4.6 <= 1.6) c = 2; // shoulders
  for (const side of [-1, 1]) {
    if (nearLine(0, side * 4, 3.6 * 0.6, side * 4.6, 1.1)) c = 2; // arms, to the handlebar
    if (disc(3.6, side * 4.6, 1.3)) c = 3;
  }
  if (disc(0.6, 0, 2.7)) c = x > 1.5 ? 3 : 1; // the head: hair, the face to the front
  return c;
}
export function scooterPixels(d) {
  const a = (d * Math.PI) / 2, cs = Math.round(Math.cos(a)), sn = Math.round(Math.sin(a));
  const px = new Array(12 * 21).fill(0);
  for (let br = 0; br < 10; br++)
    for (let m = 0; m < 12; m++) {
      const dx = 2 * m + 1 - 12, dy = 2 * br + 1 - 10;
      px[2 * br * 12 + m] = px[(2 * br + 1) * 12 + m] = scooterAt(cs * dx + sn * dy, -sn * dx + cs * dy);
    }
  ring(px, 1);
  return px;
}
export function scooterDownPixels() {
  const px = downPixels();
  // The scooter on its side to their right, along them: a black bar with a wheel at each end.
  for (let j = 2; j < 19; j++) px[j * 12 + 10] = px[j * 12 + 10] || 1;
  for (const j of [2, 3, 17, 18]) px[j * 12 + 11] = 1;
  return px;
}
export function scooterFrames() {
  return [0, 1, 2, 3].map((d) => spriteBytes(scooterPixels(d))).concat([spriteBytes(scooterDownPixels())]);
}
/**
 * A skater, by the design: side on across the skateboard, the board along the way they go (east, south,
 * west, north), a foot towards each end, the shoulders along the board and narrower than it, the arms out
 * towards its ends, the face to the right. The design's board is cyan with black wheels, which a multicolour
 * sprite does not have (its own colour is the hoodie): here the board is black, as the scooter is, and its
 * wheels go with it. Then, lying, frame 4: someone knocked down, with the board on its side beside them.
 */
function skaterAt(x, y) {
  const disc = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  let c = 0;
  // The board: along x, its ends rounded.
  if ((Math.abs(x) <= 6.5 && Math.abs(y) <= 3.6) || disc(-6.5, 0, 3.6) || disc(6.5, 0, 3.6)) c = 1;
  if (Math.abs(x) <= 4.6 && Math.abs(y) <= 2.2) c = 2; // the shoulders, along it
  for (const side of [-1, 1]) {
    if (Math.abs(y) <= 1 && side * x >= 4.6 && side * x <= 7) c = 2; // the arms, out towards its ends
    if (disc(side * 8, 0, 1.6)) c = 3; // the hands
  }
  if (disc(0, 0, 2.4)) c = y > 0.8 ? 3 : 1; // the head: hair, the face to the right
  return c;
}
export function skaterPixels(d) {
  const a = (d * Math.PI) / 2, cs = Math.round(Math.cos(a)), sn = Math.round(Math.sin(a));
  const px = new Array(12 * 21).fill(0);
  for (let br = 0; br < 10; br++)
    for (let m = 0; m < 12; m++) {
      const dx = 2 * m + 1 - 12, dy = 2 * br + 1 - 10;
      px[2 * br * 12 + m] = px[(2 * br + 1) * 12 + m] = skaterAt(cs * dx + sn * dy, -sn * dx + cs * dy);
    }
  ring(px, 1);
  return px;
}
export function skaterDownPixels() {
  const px = downPixels();
  // The board on its side to their right, along them: a shorter black bar, a wheel at each end.
  for (let j = 4; j < 17; j++) px[j * 12 + 10] = px[j * 12 + 10] || 1;
  for (const j of [4, 16]) px[j * 12 + 11] = 1;
  return px;
}
export function skaterFrames() {
  return [0, 1, 2, 3].map((d) => spriteBytes(skaterPixels(d))).concat([spriteBytes(skaterDownPixels())]);
}
const people = [];
for (let d = 0; d < PEOPLE_DIRS; d++) for (let p = 0; p < PLAYER_POSES; p++) people.push(spriteBytes(personPixels(d, p)));
people.push(spriteBytes(downPixels()));
writeFileSync(join(dir, 'people.bin'), Buffer.concat(people));
writeFileSync(join(dir, 'punch.bin'), Buffer.concat(punchFrames()));
writeFileSync(join(dir, 'pickups.bin'), Buffer.concat(pickupFrames()));
writeFileSync(join(dir, 'scooters.bin'), Buffer.concat(scooterFrames()));
writeFileSync(join(dir, 'skaters.bin'), Buffer.concat(skaterFrames())); // the classic riders, the default
writeFileSync(join(dir, 'marker.bin'), Buffer.concat([spriteBytes(markerPixels()), spriteBytes(signPixels())])); // the P, then the S
writeFileSync(join(dir, 'arrows.bin'), arrowBytes());
writeFileSync(join(dir, 'player.bin'), Buffer.concat(player.stored)); // what the program file holds
writeFileSync(join(dir, 'player-made.bin'), Uint8Array.from(player.made)); // and how it makes the rest
writeFileSync(join(dir, 'player-all.bin'), Buffer.concat(player.all)); // what it should end up with: for the tests
console.log(`assets: ${tiles.length} tiles, ${chars.length} tile characters, map ${MW}x${MW} (${out.length} bytes)`);
