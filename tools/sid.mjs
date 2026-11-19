// SPDX-License-Identifier: GPL-2.0-or-later
// Prepares a tune for a music test build.
//
//   node tools/sid.mjs <role> <output directory> [manifest]
//
// Looks the role up in music/tunes.json, fetches the tune from HVSC into .cache/sid/ if it is not there yet,
// checks it is the file the manifest describes, and writes
//
//   tune-<role>.bin   the tune's code and data, without its load address
//   tune-<role>.inc   its addresses, and its title, author and copyright as text for the screen
//
// The tune files are other people's work and are never committed: see music/README.md.
//
// The tests name a manifest of their own, describing made-up tunes that sit in the same directory as it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT } from './font.mjs';

const hex = (n) => '$' + n.toString(16).padStart(4, '0');

/** Read a PSID or RSID file: header fields, and the tune itself with its real load address. */
export function parseSid(bytes) {
  const text = (at) => {
    const end = bytes.indexOf(0, at);
    return bytes.latin1Slice(at, Math.min(end < 0 ? at + 32 : end, at + 32));
  };
  const format = bytes.latin1Slice(0, 4);
  if (format !== 'PSID' && format !== 'RSID') throw new Error(`not a SID file (starts with "${format}")`);
  const version = bytes.readUInt16BE(4);
  const dataOffset = bytes.readUInt16BE(6);
  let load = bytes.readUInt16BE(8);
  let data = bytes.subarray(dataOffset);
  if (load === 0) {
    load = data.readUInt16LE(0);
    data = data.subarray(2);
  }
  if (load + data.length > 0x10000) throw new Error('the tune runs past the end of memory');
  return {
    format,
    version,
    load,
    init: bytes.readUInt16BE(10) || load,
    play: bytes.readUInt16BE(12),
    songs: bytes.readUInt16BE(14),
    startSong: bytes.readUInt16BE(16),
    title: text(22),
    author: text(54),
    released: text(86),
    data,
  };
}

/** The credit lines shown on screen, in lower case as the assembler's screen encoding wants. Each must fit a 40-column row in the game's font. */
export function creditLines(tune) {
  const lines = { title: `music: ${tune.title}`, by: `${tune.author} (c) ${tune.released}` };
  for (const [name, line] of Object.entries(lines)) {
    if (line.length > 40) throw new Error(`the ${name} credit is ${line.length} characters, more than a row: "${line}"`);
    for (const ch of line.toUpperCase())
      if (ch !== ' ' && !FONT[ch]) throw new Error(`the font has no "${ch}", needed for "${line}"`);
    lines[name] = line.toLowerCase();
  }
  return lines;
}

/** Check a tune file against its manifest entry and return what the build needs. */
export function prepare(entry, bytes) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${entry.hvsc} is not the file the manifest pins (sha256 ${sha256})`);
  const sid = parseSid(bytes);
  for (const field of ['title', 'author', 'released', 'format'])
    if (sid[field] !== entry[field])
      throw new Error(`${entry.hvsc}: the file says ${field} "${sid[field]}", the manifest says "${entry[field]}"`);
  if (entry.subtune < 1 || entry.subtune > sid.songs) throw new Error(`${entry.hvsc} has no subtune ${entry.subtune}`);
  // A tune played during the game is called once a frame, so it needs a play address. RSID tunes run
  // themselves from their own interrupts and only suit the title screen.
  if (entry.role === 'ingame' && (sid.format !== 'PSID' || sid.play === 0))
    throw new Error(`${entry.hvsc} cannot play during the game: it needs to be a PSID tune with a play address`);
  const p = entry.role;
  const credits = creditLines(entry);
  const inc = [
    `; Made by tools/sid.mjs from ${basename(entry.hvsc)}. Do not edit.`,
    `; ${entry.title}, by ${entry.author}. Copyright ${entry.released}. Not covered by this program's licence.`,
    `${p}_load = ${hex(sid.load)}`,
    `${p}_init = ${hex(sid.init)}`,
    `${p}_play = ${hex(sid.play)}`,
    `${p}_size = ${sid.data.length}`,
    `${p}_song = ${entry.subtune - 1}`,
    `${p}_credit_title = "${credits.title}"`,
    `${p}_credit_by = "${credits.by}"`,
    '',
  ].join('\n');
  return { sid, inc, credits };
}

function main([role, dir, ownManifest]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(readFileSync(ownManifest || join(root, 'music/tunes.json'), 'utf8'));
  const entry = manifest.tunes.find((t) => t.role === role);
  if (!entry || !dir) throw new Error(`usage: node tools/sid.mjs <${manifest.tunes.map((t) => t.role).join('|')}> <output directory> [manifest]`);
  const file = join(ownManifest ? dirname(ownManifest) : join(root, '.cache/sid'), basename(entry.hvsc));
  if (!existsSync(file) && !ownManifest) {
    mkdirSync(dirname(file), { recursive: true });
    execFileSync('curl', ['-fsSL', '-o', file, manifest.hvscBase + entry.hvsc], { stdio: 'inherit' });
  }
  const { sid, inc } = prepare(entry, readFileSync(file));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `tune-${role}.bin`), sid.data);
  writeFileSync(join(dir, `tune-${role}.inc`), inc);
  console.log(`tune: ${role} is "${entry.title}" by ${entry.author} (c) ${entry.released}, ${hex(sid.load)}-${hex(sid.load + sid.data.length - 1)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`sid: ${e.message}`);
    process.exit(1);
  }
}
