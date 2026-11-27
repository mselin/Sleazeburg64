// SPDX-License-Identifier: GPL-2.0-or-later
// End-to-end tests of the packed program file (tools/pack.mjs, unpack in src/main.asm): start unpacks what
// waits after the tiles exactly as the build that was packed has it, before anything else runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, withProgram } from './game.mjs';
import { region } from '../../tools/pack.mjs';

const game = assemble('pack');
const L = game.labels;

test('the program file carries the map and the code that is copied up packed, and is the smaller for it', () => {
  assert.ok(game.unpacked, 'the game is built packed');
  assert.equal(L.packed_start, L.city_map, 'the packed data is where the map would be');
  assert.ok(L.file_end < L.program_end, 'the file ends before what is unpacked does');
  const saved = game.unpacked.length - game.bytes.length;
  assert.ok(saved > 6000, `${saved} bytes smaller`);
  assert.equal(game.bytes.length - 2, L.file_end - 0x0801, 'and holds nothing past the packed data');
});

test('start unpacks it in place, byte for byte, before anything else is set up', () =>
  withProgram(game.prg, async (vice) => {
    // The first thing after the unpacking and the copies up. (Run to the unpacker first: car.init runs from the
    // waiting area, which reaches into the BASIC ROM's addresses, which run as the program loads.)
    await vice.runTo(L.unpack);
    await vice.runTo(L['car.init']);
    // (Bar the code copied in after the map by then, from its place further on, which is checked after.)
    const wanted = region(game.unpacked, L.city_map, L.program_end);
    const got = await vice.read(L.city_map, wanted.length);
    const copied = (i) => L.city_map + i >= L.map_end && L.city_map + i < L.gap_end;
    let first = -1;
    for (let i = 0; i < wanted.length && first < 0; i++) if (!copied(i) && got[i] !== wanted[i]) first = i;
    assert.equal(first, -1, `the first difference at $${(L.city_map + first).toString(16)}`);
    const gap = region(game.unpacked, L.gap_image, L.gap_image + (L.gap_end - L.map_end));
    assert.ok((await vice.read(L.map_end, gap.length)).equals(gap), 'the code after the map, copied in');
    // And the code copied up from it is the same as the build that was not packed would copy.
    const top = region(game.unpacked, L.top_image, L.top_image + 64);
    assert.ok((await vice.read(L.TOP_CODE, 64)).equals(top), 'the traffic\'s code, copied to $f300');
    await vice.runTo(L.ready);
  }));
