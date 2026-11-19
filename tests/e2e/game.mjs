// SPDX-License-Identifier: GPL-2.0-or-later
// What the end-to-end tests share: assembling a build to test, and working out from the asset files what
// the screen ought to show, independently of the 6502 code that draws it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, Vice, readLabels } from './vice.mjs';

export const SCREEN = 0x0400;
export const COLOUR_RAM = 0xd800;
export const MAP_SIZE = 98;
export const VIEW_W = 20;
export const VIEW_H = 11;
export const MOVE_EVERY = 3; // passes of the main loop between steps while the stick is held
export const MAX_X = MAP_SIZE - VIEW_W;
export const MAX_Y = MAP_SIZE - VIEW_H;
export const OUT = 'build/e2e';

const ASMFLAGS = ['--cbm-prg', '--ascii', '--quiet', '-Wall', '-Wno-implied-reg'];

if (!existsSync(join(ROOT, 'build/map.bin'))) execFileSync(process.execPath, ['tools/assets.mjs', 'build'], { cwd: ROOT });
export const assets = {
  chars: readFileSync(join(ROOT, 'build/chars.bin')),
  tiles: readFileSync(join(ROOT, 'build/tiles.bin')),
  map: readFileSync(join(ROOT, 'build/map.bin')),
};

/**
 * Assemble a program for a test. `defs` become -D options and `include` directories are searched before
 * src/ and build/. Returns its path (relative to the repository), its labels and its bytes.
 */
export function assemble(name, { source = 'src/main.asm', defs = {}, include = [] } = {}) {
  const prg = `${OUT}/${name}.prg`;
  mkdirSync(dirname(join(ROOT, prg)), { recursive: true });
  const labelFile = `${OUT}/${name}.labels.txt`;
  const args = [...ASMFLAGS];
  for (const dir of [...include, 'src', 'build']) args.push('-I', dir);
  for (const [key, value] of Object.entries(defs)) args.push('-D', `${key}=${value}`);
  execFileSync('64tass', [...args, '--labels', labelFile, '-o', prg, source], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  return { prg, labelFile, labels: readLabels(join(ROOT, labelFile)), bytes: readFileSync(join(ROOT, prg)) };
}

/** Run `body(vice)` against a freshly started program, and always shut VICE down afterwards. */
export async function withProgram(prg, body) {
  const vice = await Vice.start(prg);
  try {
    return await body(vice);
  } finally {
    await vice.quit();
  }
}

/** The 22 rows of characters and colours the city view should hold with its top left corner at a tile. */
export function expectedView(camX, camY) {
  const { tiles, map } = assets;
  const chars = Buffer.alloc(VIEW_H * 2 * 40);
  const colours = Buffer.alloc(VIEW_H * 2 * 40);
  for (let row = 0; row < VIEW_H; row++)
    for (let col = 0; col < VIEW_W; col++) {
      const tile = map[(camY + row) * MAP_SIZE + camX + col];
      const at = row * 80 + col * 2;
      chars[at] = tiles[tile];
      chars[at + 1] = tiles[256 + tile];
      chars[at + 40] = tiles[512 + tile];
      chars[at + 41] = tiles[768 + tile];
      for (const offset of [0, 1, 40, 41]) colours[at + offset] = tiles[1024 + tile] & 15;
    }
  return { chars, colours };
}

/** What the city view holds now. Colour memory is four bits wide: the rest of each byte is noise. */
export async function readView(vice) {
  const chars = await vice.read(SCREEN, VIEW_H * 2 * 40);
  const colours = (await vice.read(COLOUR_RAM, VIEW_H * 2 * 40)).map((b) => b & 15);
  return { chars, colours: Buffer.from(colours) };
}

/** Screen codes to text, for the font's range: @, letters, then the same as ASCII. */
export function screenText(codes) {
  return [...codes].map((c) => (c === 0 ? '@' : c <= 26 ? String.fromCharCode(64 + c) : c >= 32 && c < 64 ? String.fromCharCode(c) : '?')).join('');
}

/** The three rows of the status panel, as text without trailing spaces. */
export async function readPanel(vice) {
  const codes = await vice.read(SCREEN + 22 * 40, 120);
  return [0, 40, 80].map((at) => screenText(codes.subarray(at, at + 40)).trimEnd());
}

/** The second panel row for a view position, as the clues number crossings: streets are 12 tiles apart. */
export function expectedReadout(camX, camY) {
  const two = (n) => String(n).padStart(2, '0');
  const crossing = (tile) => Math.floor((tile + 5) / 12) + 1;
  return `TILE ${two(camX)},${two(camY)}    CROSSING ${crossing(camX + VIEW_W / 2)}-${crossing(camY + VIEW_H / 2)}`;
}
