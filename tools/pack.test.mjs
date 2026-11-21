// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack } from './pack.mjs';

const same = (bytes) => assert.deepEqual([...unpack(pack(bytes))], [...bytes]);

test('packing unpacks to the same bytes: empty, one byte, runs, and long stretches of nothing alike', () => {
  same(new Uint8Array(0));
  same(Uint8Array.of(42));
  same(new Uint8Array(1000).fill(7)); // a copy that overlaps what it copies, over and over
  let seed = 1;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 23;
  same(Uint8Array.from({ length: 5000 }, random)); // literal runs past 128
  same(Uint8Array.from({ length: 70000 }, (_, i) => (i % 300 < 150 ? random() : i & 255))); // further back than 65535
});

test('the token stream: 128 bytes as they are at most, 3 to 129 copied, two bytes back, and $ff to end', () => {
  const packed = pack(Uint8Array.from({ length: 200 }, (_, i) => (i * 7919) & 255));
  assert.equal(packed[0], 127, 'the first 128 as they are');
  assert.equal(packed[packed.length - 1], 0xff);
  const runs = pack(new Uint8Array(300).fill(9));
  // One byte as it is, then copies of 129 from one back, then the rest.
  assert.deepEqual([...runs.subarray(0, 8)], [0, 9, 0xfe, 1, 0, 0xfe, 1, 0]);
  assert.ok(pack(new Uint8Array(20000)).length < 500, 'nothing but zeroes packs small');
});
