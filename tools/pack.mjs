// SPDX-License-Identifier: GPL-2.0-or-later
// Packs the part of the game that waits after the character set and tiles in the program file: the city map,
// the code that start copies up and the player's frames (src/main.asm, PACKED). start unpacks it in place
// (unpack in src/main.asm) before anything else, so the rest of the program never knows.
//
// The packed stream is a run of tokens:
//   $00-$7f  n + 1 bytes as they are follow;
//   $80-$fe  copy n - $80 + 3 bytes (3 to 129) from earlier in what has been unpacked: the two bytes after
//            the token say how far back, low byte first;
//   $ff      the end.
//
// Usage: node tools/pack.mjs <program.prg> <labels.txt> <packed.bin>
//   packs the program's bytes from city_map up to program_end, as the labels file (64tass -l) gives them.
import { readFileSync, writeFileSync } from 'node:fs';

const MIN = 3, MAX = 129, FAR = 0xffff;

/** Pack bytes into the token stream described above. */
export function pack(bytes) {
  const out = [], heads = new Map(), prev = new Int32Array(bytes.length).fill(-1);
  let literal = [];
  const flush = () => {
    for (let i = 0; i < literal.length; i += 128) {
      const run = literal.slice(i, i + 128);
      out.push(run.length - 1, ...run);
    }
    literal = [];
  };
  const key = (i) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const remember = (i) => {
    if (i + MIN > bytes.length) return;
    const k = key(i);
    prev[i] = heads.has(k) ? heads.get(k) : -1;
    heads.set(k, i);
  };
  let i = 0;
  while (i < bytes.length) {
    let best = 0, from = 0;
    if (i + MIN <= bytes.length) {
      for (let j = heads.has(key(i)) ? heads.get(key(i)) : -1, tries = 0; j >= 0 && i - j <= FAR && tries < 256; j = prev[j], tries++) {
        let n = 0;
        while (n < MAX && i + n < bytes.length && bytes[j + n] === bytes[i + n]) n++;
        if (n > best) [best, from] = [n, j];
        if (best === MAX) break;
      }
    }
    if (best >= MIN) {
      flush();
      const back = i - from;
      out.push(0x80 + best - MIN, back & 255, back >> 8);
      for (let k = 0; k < best; k++) remember(i + k);
      i += best;
    } else {
      literal.push(bytes[i]);
      remember(i);
      i++;
    }
  }
  flush();
  out.push(0xff);
  return Uint8Array.from(out);
}

/** Unpack a token stream: what start does, in JavaScript, for the tests. */
export function unpack(packed) {
  const out = [];
  for (let at = 0; ; ) {
    const t = packed[at++];
    if (t === 0xff) return Uint8Array.from(out);
    if (t < 0x80) for (let n = t + 1; n > 0; n--) out.push(packed[at++]);
    else {
      const back = packed[at] | (packed[at + 1] << 8);
      at += 2;
      for (let n = t - 0x80 + MIN; n > 0; n--) out.push(out[out.length - back]);
    }
  }
}

/** The labels a 64tass labels file (-l) gives, by name. */
export function readLabelFile(path) {
  const labels = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][\w.]*)\s*=\s*\$([0-9a-fA-F]+)/);
    if (m) labels[m[1]] = parseInt(m[2], 16);
  }
  return labels;
}

/** The bytes of a program file (load address first) from address `from` up to `to`. */
export function region(prg, from, to) {
  const load = prg[0] | (prg[1] << 8);
  return prg.subarray(2 + from - load, 2 + to - load);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [prgPath, labelPath, outPath] = process.argv.slice(2);
  const labels = readLabelFile(labelPath);
  if (labels.city_map === undefined || labels.program_end === undefined) throw new Error(`${labelPath}: no city_map or program_end`);
  const bytes = region(readFileSync(prgPath), labels.city_map, labels.program_end);
  const packed = pack(bytes);
  const back = unpack(packed);
  if (back.length !== bytes.length || back.some((b, k) => b !== bytes[k])) throw new Error('packing does not unpack to the same bytes');
  writeFileSync(outPath, packed);
  console.log(`pack: ${bytes.length} bytes from $${labels.city_map.toString(16)} to ${packed.length}`);
}
