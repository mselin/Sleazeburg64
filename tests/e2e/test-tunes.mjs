// SPDX-License-Identifier: GPL-2.0-or-later
// Two made-up tunes for the tests, so the music code can be exercised without anyone else's music. They
// are not music at all: each is a few instructions that leave marks in memory for a test to read.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function sidFile({ format, title, author, released, load, init, play, songs, code }) {
  const b = Buffer.alloc(124 + 2 + code.length);
  b.write(format, 0, 'latin1');
  b.writeUInt16BE(2, 4); // version
  b.writeUInt16BE(124, 6); // where the data starts
  b.writeUInt16BE(0, 8); // load address: taken from the data
  b.writeUInt16BE(init, 10);
  b.writeUInt16BE(play, 12);
  b.writeUInt16BE(songs, 14);
  b.writeUInt16BE(1, 16);
  b.write(title, 22, 'latin1');
  b.write(author, 54, 'latin1');
  b.write(released, 86, 'latin1');
  b.writeUInt16LE(load, 124);
  Buffer.from(code).copy(b, 126);
  return b;
}

// Plays during the game, from $e000 like the real one. init keeps the subtune it was asked for and clears a
// counter; play adds one to the counter, puts its low byte in a SID register, and then takes about as long
// as the real tune's busiest frames (some 1700 cycles, 27 raster lines), so the tests see the game cope with
// a tune's load.
export const INGAME = {
  load: 0xe000,
  song: 0xe040, // the value init was called with
  counter: 0xe041, // 16 bits: how many times play has been called
  subtune: 2,
  // prettier-ignore
  code: [
    0x8d, 0x40, 0xe0,       // e000 init: sta $e040
    0xa9, 0x00,             //            lda #0
    0x8d, 0x41, 0xe0,       //            sta $e041
    0x8d, 0x42, 0xe0,       //            sta $e042
    0x60,                   //            rts
    0xee, 0x41, 0xe0,       // e00c play: inc $e041
    0xd0, 0x03,             //            bne +
    0xee, 0x42, 0xe0,       //            inc $e042
    0xad, 0x41, 0xe0,       // e014 +     lda $e041
    0x8d, 0x00, 0xd4,       //            sta $d400
    0xa0, 0x02,             //            ldy #2
    0xa2, 0xaa,             // e01c --    ldx #170
    0xca,                   // e01e -     dex
    0xd0, 0xfd,             //            bne -
    0x88,                   //            dey
    0xd0, 0xf8,             //            bne --
    0x60,                   // e024       rts
    ...new Array(0x1b).fill(0),
    0xff, 0xff, 0xff,       // e040 song, counter: overwritten by init
  ],
};

// Plays on the title screen, from $1000 like the real one, and like it is an RSID with no play address.
// Like the real one it switches the ROMs out and runs from interrupts of its own: a raster interrupt, and
// timer interrupts on the NMI line, which cannot be masked and which the title screen must stop before it
// moves the game over this code. Each handler only counts.
export const TITLE = (() => {
  const load = 0x1000;
  // The marks sit where moving the game in leaves memory alone: after its code, before its screens.
  const mark = 0x2f80; // 42 once init has run
  const irqCount = 0x2f81;
  const nmiCount = 0x2f82;
  const lo = (n) => n & 255, hi = (n) => n >> 8;
  const abs = (n) => [lo(n), hi(n)];
  const init = (irq, nmi) => [
    0x78,                               // sei
    0xa9, 0x35, 0x85, 0x01,             // lda #$35 / sta $01: all RAM but I/O
    0xa9, lo(irq), 0x8d, 0xfe, 0xff,    // the interrupt vectors, in the RAM under the KERNAL
    0xa9, hi(irq), 0x8d, 0xff, 0xff,
    0xa9, lo(nmi), 0x8d, 0xfa, 0xff,
    0xa9, hi(nmi), 0x8d, 0xfb, 0xff,
    0xa9, 0x7f, 0x8d, 0x0d, 0xdc,       // no timer interrupts from CIA 1
    0xad, 0x0d, 0xdc,
    0xa9, 0x64, 0x8d, 0x12, 0xd0,       // a raster interrupt at line 100
    0xa9, 0x1b, 0x8d, 0x11, 0xd0,
    0xa9, 0x01, 0x8d, 0x1a, 0xd0,
    0xa9, 0x00, 0x8d, 0x04, 0xdd,       // CIA 2 timer A every $2000 cycles, on the NMI line
    0xa9, 0x20, 0x8d, 0x05, 0xdd,
    0xa9, 0x81, 0x8d, 0x0d, 0xdd,
    0xa9, 0x11, 0x8d, 0x0e, 0xdd,
    0xa9, 0x2a, 0x8d, ...abs(mark),     // lda #42 / sta mark
    0x58,                               // cli
    0x60,                               // rts
  ];
  const irqAt = load + init(0, 0).length;
  const irq = [0x48, 0xee, ...abs(irqCount), 0xa9, 0xff, 0x8d, 0x19, 0xd0, 0x68, 0x40]; // pha / inc / ack / pla / rti
  const nmi = [0x48, 0xee, ...abs(nmiCount), 0xad, 0x0d, 0xdd, 0x68, 0x40];
  // Padded to about the real one's size, because the title screen keeps the game behind its tune and
  // checks at build time that the game can be moved down from there.
  const code = Object.assign(new Array(0x4000).fill(0), [...init(irqAt, irqAt + irq.length), ...irq, ...nmi]);
  return { load, mark, irqCount, nmiCount, code };
})();

/** Write both tunes and a manifest for them into a directory, and return the manifest's path. */
export function writeTestTunes(dir) {
  mkdirSync(dir, { recursive: true });
  const tunes = [
    { role: 'title', title: 'Test Fanfare', author: 'Nobody', released: '2026 The Tests', format: 'RSID', subtune: 1,
      hvsc: '/TESTS/Test_Fanfare.sid', id: 1,
      bytes: sidFile({ format: 'RSID', title: 'Test Fanfare', author: 'Nobody', released: '2026 The Tests',
        load: TITLE.load, init: TITLE.load, play: 0, songs: 1, code: TITLE.code }) },
    { role: 'ingame', title: 'Test Tune', author: 'Nobody', released: '2026 The Tests', format: 'PSID', subtune: INGAME.subtune,
      hvsc: '/TESTS/Test_Tune.sid', id: 2,
      bytes: sidFile({ format: 'PSID', title: 'Test Tune', author: 'Nobody', released: '2026 The Tests',
        load: INGAME.load, init: INGAME.load, play: INGAME.load + 12, songs: 3, code: INGAME.code }) },
  ];
  for (const t of tunes) {
    writeFileSync(join(dir, t.hvsc.split('/').pop()), t.bytes);
    t.sha256 = createHash('sha256').update(t.bytes).digest('hex');
    delete t.bytes;
  }
  const manifest = join(dir, 'tunes.json');
  writeFileSync(manifest, JSON.stringify({ about: 'Made-up tunes for the tests.', tunes }, null, 2));
  return manifest;
}
