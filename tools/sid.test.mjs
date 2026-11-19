// SPDX-License-Identifier: GPL-2.0-or-later
// These tests use a made-up tune, so they need no download and no one else's music.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { creditLines, parseSid, prepare } from './sid.mjs';

/** A minimal version 2 SID file: an RTS at $e000 for init and another at $e001 for play. */
function fakeSid({ format = 'PSID', title = 'Test Tune', author = 'Nobody', released = '2026 Nobody', play = 0xe001 } = {}) {
  const b = Buffer.alloc(124 + 4);
  b.write(format, 0, 'latin1');
  b.writeUInt16BE(2, 4);
  b.writeUInt16BE(124, 6);
  b.writeUInt16BE(0, 8); // load address comes from the data
  b.writeUInt16BE(0xe000, 10);
  b.writeUInt16BE(play, 12);
  b.writeUInt16BE(3, 14);
  b.writeUInt16BE(1, 16);
  b.write(title, 22, 'latin1');
  b.write(author, 54, 'latin1');
  b.write(released, 86, 'latin1');
  b.writeUInt16LE(0xe000, 124);
  b[126] = 0x60;
  b[127] = 0x60;
  return b;
}
const entryFor = (bytes, more = {}) => ({
  role: 'ingame',
  title: 'Test Tune',
  author: 'Nobody',
  released: '2026 Nobody',
  hvsc: '/TEST/Test_Tune.sid',
  format: 'PSID',
  subtune: 2,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  ...more,
});

test('a SID header is read, and the load address taken from the data when the header has none', () => {
  const sid = parseSid(fakeSid());
  assert.equal(sid.load, 0xe000);
  assert.equal(sid.init, 0xe000);
  assert.equal(sid.play, 0xe001);
  assert.equal(sid.songs, 3);
  assert.equal(sid.title, 'Test Tune');
  assert.deepEqual([...sid.data], [0x60, 0x60]);
});

test('the build gets addresses, the subtune counted from zero, and both credit lines', () => {
  const bytes = fakeSid();
  const { inc } = prepare(entryFor(bytes), bytes);
  assert.match(inc, /ingame_load = \$e000/);
  assert.match(inc, /ingame_play = \$e001/);
  assert.match(inc, /ingame_song = 1\n/);
  assert.match(inc, /ingame_credit_title = "music: test tune"/);
  assert.match(inc, /ingame_credit_by = "nobody \(c\) 2026 nobody"/);
});

test('a file that is not the pinned one is refused', () => {
  const bytes = fakeSid();
  assert.throws(() => prepare(entryFor(bytes, { sha256: '0'.repeat(64) }), bytes), /not the file the manifest pins/);
});

test('credits in the manifest must match the tune file', () => {
  const bytes = fakeSid();
  assert.throws(() => prepare(entryFor(bytes, { author: 'Somebody Else' }), bytes), /the file says author "Nobody"/);
  assert.throws(() => prepare(entryFor(bytes, { released: '1999 Nobody' }), bytes), /released/);
});

test('only a PSID tune with a play address may play during the game', () => {
  const rsid = fakeSid({ format: 'RSID', play: 0 });
  assert.throws(() => prepare(entryFor(rsid, { format: 'RSID' }), rsid), /cannot play during the game/);
  assert.ok(prepare(entryFor(rsid, { format: 'RSID', role: 'title' }), rsid));
});

test('a credit must fit a row and use characters the font has', () => {
  assert.throws(() => creditLines({ title: 'x'.repeat(40), author: 'a', released: 'b' }), /more than a row/);
  assert.throws(() => creditLines({ title: 'Café', author: 'a', released: 'b' }), /font has no/);
});

test('every tune in the manifest names its title, author, copyright and source, and fits the screen', () => {
  const manifest = JSON.parse(readFileSync(new URL('../music/tunes.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../music/README.md', import.meta.url), 'utf8');
  assert.ok(manifest.tunes.length > 0);
  for (const t of manifest.tunes) {
    for (const field of ['role', 'title', 'author', 'released', 'hvsc', 'format'])
      assert.equal(typeof t[field], 'string', `${t.title || t.hvsc}: ${field}`);
    assert.match(t.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(t.id));
    creditLines(t);
    // The credits in music/README.md are kept in step with the manifest.
    assert.ok(readme.includes(`| ${t.title} | ${t.author} | ${t.released} |`), `music/README.md credits ${t.title}`);
    assert.ok(readme.includes(`sid=${t.id}`), `music/README.md links ${t.title}`);
  }
});
