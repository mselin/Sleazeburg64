// SPDX-License-Identifier: GPL-2.0-or-later
// What the end-to-end tests share: assembling a build to test, and a model of what the screen ought to show,
// worked out from the asset files independently of the 6502 code that draws it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, Vice, readLabels } from './vice.mjs';
import { pack, region } from '../../tools/pack.mjs';

export const SCREEN_A = 0x3000;
export const SCREEN_B = 0x3400;
export const PANEL_SCREEN = 0x0400; // only its rows 21-23 are shown, under the city
export const COLOUR_RAM = 0xd800;
export const ROWS = 21; // rows of city in a screen; the panel is rows 21-23
export const MAP_SIZE = 98;
export const MAP_PIXELS = MAP_SIZE * 16;
export const VIEW_W = 304;
export const VIEW_H = 161;
export const MAX_X = MAP_PIXELS - VIEW_W;
export const MAX_Y = MAP_PIXELS - VIEW_H;
export const SPEED = 2;
export const FAST = 4;
export const FOLLOW = 4;
export const CENTRE_X = VIEW_W >> 1;
export const CENTRE_Y = VIEW_H >> 1;
export const CAR_SPRITE = 0x0840 / 64;
export const CHARSET = 0x3800;
export const HONK_SPRITE = (CHARSET + 184 * 8) / 64; // Big Honk's frames, in the character set's last characters
export const PLAYER_FRAMES = 0x2600; // the twelve frames of the player on foot the program file holds (the rest are made)
export const PLAYER_SPRITE = PLAYER_FRAMES / 64;
export const PLAYER_BUFFERS = 0x2540; // and the two it makes the others in
export const PLAYER_FRAME_COUNT = 42;
export const OUT = 'build/e2e';

// Colours
const BLACK = 0, DARK_GREY = 11, LIGHT_GREY = 15, YELLOW = 7;
/** The colours every multicolour sprite shares for pixel pairs 01 and 11 (honk.init sets them). */
export const SPRITE_MULTI = [BLACK, YELLOW];

const ASMFLAGS = ['--cbm-prg', '--ascii', '--quiet', '-Wall', '-Wno-implied-reg'];

if (!existsSync(join(ROOT, 'build/player-all.bin'))) execFileSync(process.execPath, ['tools/assets.mjs', 'build'], { cwd: ROOT });
export const assets = {
  chars: readFileSync(join(ROOT, 'build/chars.bin')),
  tiles: readFileSync(join(ROOT, 'build/tiles.bin')),
  map: readFileSync(join(ROOT, 'build/map.bin')),
};
assets.car = readFileSync(join(ROOT, 'build/car.bin'));
assets.player = readFileSync(join(ROOT, 'build/player-all.bin')); // all 42 frames, as the program should show them
assets.playerMade = readFileSync(join(ROOT, 'build/player-made.bin')); // for each, the stored frame * 4 + how it is flipped
assets.people = readFileSync(join(ROOT, 'build/people.bin')); // the passers-by's 20 frames
assets.punch = readFileSync(join(ROOT, 'build/punch.bin')); // the player punching, 8 frames
assets.pickups = readFileSync(join(ROOT, 'build/pickups.bin')); // the five pickups
assets.scooters = readFileSync(join(ROOT, 'build/scooters.bin')); // scooter riders: four ways, then lying
assets.skaters = readFileSync(join(ROOT, 'build/skaters.bin')); // skaters, the same (classic's: in the program file)
assets.riders = assets.skaters; // what is at SCOOTER_SPRITE: a test that sets modern (setDifficulty) changes it
const marker = readFileSync(join(ROOT, 'build/marker.bin'));
assets.marker = marker.subarray(0, 64); // the paint shop's marker, a P
assets.sign = marker.subarray(64, 128); // the S beside the arrow to it
assets.arrows = readFileSync(join(ROOT, 'build/arrows.bin')); // the arrow's ways 0-8: 11 lines of 2 bytes each
/** The arrow's way k, as the program copies it into its sprite (at $2500): 11 lines of two bytes; ways 9-15
 * are ways 7-1 upside down (tools/assets.mjs checks that they are, drawn as the browser game turns it). */
export function arrowFrame(k) {
  const f = new Uint8Array(63), w = k > 8 ? 16 - k : k;
  for (let y = 0; y < 11; y++)
    for (let b = 0; b < 2; b++) f[(k > 8 ? 10 - y : y) * 3 + b] = assets.arrows[w * 22 + 2 * y + b];
  return f;
}
export const PICKUP_SPRITE = 0x0c40 / 64;
export const SCOOTER_SPRITE = 0x0d80 / 64; // riders: four ways, then lying (skaters in the program file, classic's)
export const MARKER_SPRITE = 0x0ec0 / 64; // the paint shop's marker
export const SIGN_SPRITE = 0x0f00 / 64; // the S beside the arrow
export const ARROW_SPRITE = 0x0f40 / 64; // the arrow, its way copied in (after the S)
export const BULLET_SPRITE = (0x2540 + 2 * 64) / 64; // a bullet (src/gun.asm): a 2 x 2 square at pixels 12-13 of lines 10-11
assets.bullet = new Uint8Array(63);
assets.bullet[10 * 3 + 1] = assets.bullet[11 * 3 + 1] = 0x0c;
export const PUNCH_SPRITE = 0x0200 / 64;
export const PEOPLE_SPRITE = 0x2000 / 64;

/** The 63 bytes of the sprite a pointer names: one of the car's frames, the pickups', the passers-by's, the punching or Big Honk's. */
export function spriteData(pointer) {
  if (pointer === MARKER_SPRITE) return assets.marker.subarray(0, 63);
  if (pointer === SIGN_SPRITE) return assets.sign.subarray(0, 63);
  if (pointer >= SCOOTER_SPRITE && pointer < SCOOTER_SPRITE + 5) return assets.riders.subarray((pointer - SCOOTER_SPRITE) * 64, (pointer - SCOOTER_SPRITE) * 64 + 63);
  if (pointer === BULLET_SPRITE) return assets.bullet;
  if (pointer >= HONK_SPRITE) return assets.chars.subarray(pointer * 64 - CHARSET, pointer * 64 - CHARSET + 63);
  if (pointer >= PEOPLE_SPRITE) return assets.people.subarray((pointer - PEOPLE_SPRITE) * 64, (pointer - PEOPLE_SPRITE) * 64 + 63);
  if (pointer >= PICKUP_SPRITE) return assets.pickups.subarray((pointer - PICKUP_SPRITE) * 64, (pointer - PICKUP_SPRITE) * 64 + 63);
  if (pointer >= CAR_SPRITE) return assets.car.subarray((pointer - CAR_SPRITE) * 64, (pointer - CAR_SPRITE) * 64 + 63);
  return assets.punch.subarray((pointer - PUNCH_SPRITE) * 64, (pointer - PUNCH_SPRITE) * 64 + 63);
}

/**
 * A sprite as the multiplexer's plan puts it on the screen (traffic-model.mjs), for the picture model: bit 7 of
 * its colour makes it a multicolour sprite (sprites.put).
 */
export const planned = (s) => ({ x: s.x, y: s.y, colour: s.colour & 15, multicolour: s.colour >= 0x80, bitmap: s.bitmap ?? spriteData(s.pointer) });

/**
 * Assemble a program for a test. `defs` become -D options and `include` directories are searched before
 * src/ and build/. Returns its path (relative to the repository), its labels and its bytes.
 */
export function assemble(name, { source = 'src/main.asm', defs = {}, include = [] } = {}) {
  const prg = `${OUT}/${name}.prg`;
  mkdirSync(dirname(join(ROOT, prg)), { recursive: true });
  const labelFile = `${OUT}/${name}.labels.txt`; // 64tass's own format, which other sources can include
  const viceLabelFile = `${OUT}/${name}.vice-labels.txt`; // with the labels inside blocks too
  const args = [...ASMFLAGS];
  for (const dir of [...include, 'src', 'build']) args.push('-I', dir);
  for (const [key, value] of Object.entries(defs)) args.push('-D', `${key}=${value}`);
  const run = (extra) => execFileSync('64tass', [...extra, ...args, '-l', labelFile, '--vice-labels', '-l', viceLabelFile, '-o', prg, source],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  run([]);
  let labels = { ...readLabels(join(ROOT, labelFile)), ...readLabels(join(ROOT, viceLabelFile)) };
  // The game is built packed, as the Makefile builds it (tools/build-game.sh): once as it runs, then again
  // carrying what waits after the tiles packed. `unpacked` is the first, for tests of the unpacking.
  let unpacked = null;
  if (source === 'src/main.asm' && labels.high_image !== undefined && !('PACKED' in defs)) {
    unpacked = readFileSync(join(ROOT, prg));
    const packFile = `${name.split('/').pop()}.packed.bin`;
    writeFileSync(join(ROOT, OUT, dirname(name), packFile), pack(region(unpacked, labels.city_map, labels.program_end)));
    run(['-I', join(OUT, dirname(name)), '-D', 'PACKED=1', '-D', `PACK_FILE="${packFile}"`]);
    const before = labels;
    labels = { ...readLabels(join(ROOT, labelFile)), ...readLabels(join(ROOT, viceLabelFile)) };
    for (const [key, value] of Object.entries(before))
      if (!/^(packed_|PACK|file_end)/.test(key) && labels[key] !== value) throw new Error(`${name}: ${key} moved when packed`);
  }
  return { prg, labelFile, labels, bytes: readFileSync(join(ROOT, prg)), unpacked };
}

/** Run `body(vice)` against a freshly started program, and always shut VICE down afterwards. */
export async function withProgram(prg, body, options = {}) {
  const vice = await Vice.start(prg, options);
  try {
    return await body(vice);
  } finally {
    await vice.quit();
  }
}

/** The character the city has at a character position (each tile is two by two characters). */
export function cityChar(col, row) {
  const tile = assets.map[(row >> 1) * MAP_SIZE + (col >> 1)];
  return assets.tiles[((row & 1) * 2 + (col & 1)) * 256 + tile];
}

/** What colour memory should hold at a character position: the colour of the tile it is part of. */
export function cityColour(col, row) {
  return assets.tiles[1536 + assets.map[(row >> 1) * MAP_SIZE + (col >> 1)]];
}

/**
 * What a screen's city rows should hold with the window's top left corner at pixel (x, y): characters, and
 * the colours colour memory should have for them. Columns that are off the east edge of the city are never
 * visible, so they are left out (null) and not compared.
 */
export function expectedScreen(x, y) {
  const col0 = x >> 3, row0 = y >> 3;
  const chars = [], colours = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < 40; c++) {
      const inside = col0 + c < MAP_SIZE * 2;
      const ch = inside ? cityChar(col0 + c, row0 + r) : null;
      chars.push(ch);
      colours.push(inside ? cityColour(col0 + c, row0 + r) : null);
    }
  return { chars, colours };
}

/**
 * The city's screen in front, from what the bottom interrupt last gave the video chip (the chip's own
 * register points at the panel's screen from line 222 to the bottom of the frame).
 */
export async function frontScreen(vice, labels) {
  return ((await vice.read(labels['frame.cur_d018'], 1))[0] >> 4) * 0x400;
}

/** Compare a screen's city rows and colour memory with what they should be for a window position. */
export async function screenMismatches(vice, x, y, labels) {
  const wanted = expectedScreen(x, y);
  const chars = await vice.read(await frontScreen(vice, labels), ROWS * 40);
  const colours = await vice.read(COLOUR_RAM, ROWS * 40);
  const wrong = [];
  for (let i = 0; i < ROWS * 40; i++) {
    if (wanted.chars[i] === null) continue;
    if (chars[i] !== wanted.chars[i]) wrong.push(`character at row ${Math.floor(i / 40)} column ${i % 40}`);
    else if ((colours[i] & 15) !== wanted.colours[i]) wrong.push(`colour at row ${Math.floor(i / 40)} column ${i % 40}`);
  }
  return wrong;
}

/** Screen codes to text, for the font's range: @, letters, then the same as ASCII. */
export function screenText(codes) {
  return [...codes].map((c) => (c === 0 ? '@' : c <= 26 ? String.fromCharCode(64 + c) : c >= 32 && c < 64 ? String.fromCharCode(c) : '?')).join('');
}

/** The three rows of the status panel, as text without trailing spaces. */
export async function readPanel(vice) {
  const a = await vice.read(PANEL_SCREEN + ROWS * 40, 120);
  return [0, 40, 80].map((at) => screenText(a.subarray(at, at + 40)).trimEnd());
}

/** The second panel row for a window position. */
export function expectedReadout(x, y) {
  const two = (n) => String(n).padStart(2, '0');
  const crossing = (tile) => Math.floor((tile + 5) / 12) + 1;
  return `TILE ${two(x >> 4)},${two(y >> 4)}    CROSSING ${crossing((x + VIEW_W / 2) >> 4)}-${crossing((y + (VIEW_H >> 1)) >> 4)}`;
}

/**
 * The colour of every pixel inside the borders (x 24-343, lines 51-249) for a window position. The city is
 * drawn from the map and the character set, pixel by pixel: it does not care how the program got it there.
 * The panel is drawn from what is in its rows of screen and colour memory, so this checks where and how it
 * is shown; what it says is checked separately. `sprites` is one sprite or a list, the one in front first:
 * each { x, y, colour, bitmap }, with multicolour true for a multicolour one.
 */
export function expectedPicture(x, y, panelCodes, panelColours, sprites = []) {
  const { chars } = assets;
  const list = sprites === null ? [] : Array.isArray(sprites) ? sprites : [sprites];
  return (px, line) => {
    if (line < 55 || line > 246 || (line > 215 && line < 223)) return BLACK; // borders, and the black band
    if (line <= 215) {
      if (px < 31 || px > 334) return BLACK; // 38-column mode
      for (const sprite of list) {
        // In front of the city, and only over it: the borders hide it, and it is switched off below.
        const i = px - sprite.x, j = line - sprite.y - 1;
        if (i < 0 || i >= 24 || j < 0 || j >= 21) continue;
        const byte = sprite.bitmap[j * 3 + (i >> 3)];
        if (sprite.multicolour) {
          const pair = (byte >> (6 - 2 * ((i & 7) >> 1))) & 3; // pixel pairs from the sprite's left edge
          if (pair) return [0, SPRITE_MULTI[0], sprite.colour, SPRITE_MULTI[1]][pair];
        } else if ((byte >> (7 - (i & 7))) & 1) return sprite.colour;
      }
      const wx = x + px - 31, wy = y + line - 55;
      const ch = cityChar(wx >> 3, wy >> 3);
      const pair = (chars[ch * 8 + (wy & 7)] >> (6 - 2 * ((wx & 7) >> 1))) & 3;
      return [DARK_GREY, LIGHT_GREY, BLACK, cityColour(wx >> 3, wy >> 3) & 7][pair];
    }
    const at = ((line - 223) >> 3) * 40 + ((px - 24) >> 3);
    const bit = (chars[panelCodes[at] * 8 + ((line - 223) & 7)] >> (7 - ((px - 24) & 7))) & 1;
    return bit ? panelColours[at] & 15 : BLACK;
  };
}

/** The pixels that differ between what VICE drew and the model, as up to five descriptions and a count. */
export async function pictureMismatches(vice, x, y, sprites = []) {
  const panelCodes = await vice.read(PANEL_SCREEN + ROWS * 40, 120);
  const panelColours = await vice.read(COLOUR_RAM + ROWS * 40, 120);
  const wanted = expectedPicture(x, y, panelCodes, panelColours, sprites);
  const shown = await vice.display();
  const wrong = [];
  let count = 0;
  for (let line = 51; line <= 249; line++) // line 250 is still being drawn when the bottom interrupt starts
    for (let px = 24; px <= 343; px++) {
      const got = shown.at(px, line), want = wanted(px, line);
      if (got !== want && count++ < 5) wrong.push(`x ${px} line ${line}: colour ${got}, not ${want}`);
    }
  return count ? [`${count} pixels wrong`, ...wrong] : [];
}

/**
 * A model of how the window moves, the same rules as move_camera in src/main.asm, kept here as a second
 * opinion. step(bits) is one pass of the main loop with the joystick held as given.
 */
export class Camera {
  constructor(x, y) {
    this.pos = [x, y];
    this.cell = [x >> 3, y >> 3];
    this.busy = false; // the pass after a swap goes on colour memory
  }
  get x() {
    return this.pos[0];
  }
  get y() {
    return this.pos[1];
  }
  step(bits) {
    const pace = bits & 16 ? FAST : SPEED;
    const way = (minus, plus) => (bits & plus && !(bits & minus) ? pace : bits & minus && !(bits & plus) ? -pace : 0);
    this.move([way(4, 8), way(1, 2)]);
  }
  /** One pass of the main loop following the car at pixel (x, y), as follow_car in src/main.asm does. */
  follow(x, y) {
    const target = [Math.min(MAX_X, Math.max(0, x - CENTRE_X)), Math.min(MAX_Y, Math.max(0, y - CENTRE_Y))];
    this.move([0, 1].map((a) => Math.max(-FOLLOW, Math.min(FOLLOW, target[a] - this.pos[a]))));
  }
  move(steps) {
    const max = [MAX_X, MAX_Y];
    let swapped = false;
    for (const a of [0, 1]) {
      let v = Math.min(max[a], Math.max(0, this.pos[a] + steps[a]));
      if (this.busy && v >> 3 !== this.cell[a]) v = v >> 3 > this.cell[a] ? this.cell[a] * 8 + 7 : this.cell[a] * 8;
      this.pos[a] = v;
    }
    for (const a of [0, 1]) {
      if (this.pos[a] >> 3 !== this.cell[a]) swapped = true;
      this.cell[a] = this.pos[a] >> 3;
    }
    this.busy = swapped;
  }
}

/** Where the program's window is, from its variables. */
export async function camera(vice, labels) {
  const lo = await vice.read(labels.cam_lo, 2);
  const hi = await vice.read(labels.cam_hi, 2);
  return [lo[0] + 256 * hi[0], lo[1] + 256 * hi[1]];
}
