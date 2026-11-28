// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the pickups (src/pickups.asm), worked out again here so the tests can hold the program to it frame
// by frame: where they are, which kind, which are away and for how long, and what is shown. The rules are the
// program's: see the comments there for why they are what they are.
import { assets, MAP_SIZE, arrowFrame, ARROW_SPRITE, SIGN_SPRITE } from './game.mjs';

export const K = {
  COUNT: 12, REACH: 11, TURN_EACH: 2, NEAR_TILES: 5, BACK_MIN: 83, BACK_SPREAD: 63, CLEAR: 2,
  START_COL: 18, START_ROW: 13, SPRITE: 0x0c40 / 64, AWAY: 0xff,
  SHARES: [87, 159, 205, 241], // a random byte at or above each: cash, donut, bandage, knife (below the first: ammo)
  COLOURS: [8, 5, 10, 1, 15], // orange, green, light red, white, light grey
  // What someone the player kills drops: DROPS at once, for LIFE frames, blinking in the last BLINK; a random
  // byte below CASH_ODDS is cash, else below KNIFE_ODDS a knife (if the player has none).
  DROPS: 3, LIFE: 1000, BLINK: 200, CASH_ODDS: 102, KNIFE_ODDS: 123, DROP_KNIFE: 10,
  // The paint shop's marker (show_paint): where (police.PAINT_X, PAINT_Y), its frame, flashing cyan and white.
  PAINT_X: 304, PAINT_Y: 1192, MARKER: 0x0ec0 / 64, FLASH: [1, 3],
  // The arrow to it (arrow_round, arrow_axes): the view's size; r from which the offset along the smaller
  // distance is 255; bounds by place (the arrow's x, the S's x, the arrow's y, the S's y), as sprite positions;
  // from the view to the arrow's sprite, by axis; the colour, cyan.
  VIEW: [304, 161], A_CAP: 53, A_LOW: [36, 31, 59, 54], A_HIGH: [320, 325, 200, 205], A_K: [26, 49], CYAN: 3,
};
// 400 r / sqrt(1 + r * r), r = i / 64; and the S's offsets, 12 / sqrt(1 + r * r) by 16 and 12 r / sqrt(1 + r * r), r = i / 32.
const A_OFF = Array.from({ length: K.A_CAP }, (_, i) => Math.round((400 * i) / 64 / Math.sqrt(1 + (i / 64) ** 2)));
const A_S = Array.from({ length: 32 }, (_, i) => Math.round(12 / Math.sqrt(1 + (i / 32) ** 2)) * 16 + Math.round((12 * i) / 32 / Math.sqrt(1 + (i / 32) ** 2)));
export const AMMO = 0, CASH = 1, DONUT = 2, BANDAGE = 3, KNIFE = 4;
const PAVEMENT = 4, GRASS = 2;
const kindOfTile = (col, row) => assets.tiles[1280 + assets.map[row * MAP_SIZE + col]];
const w16 = (v) => v & 0xffff;

export class Pickups {
  /** `cam`: the window as it is at start (game.mjs's Camera). */
  constructor(cam) {
    Object.assign(this, { seed: 0xa7e1, clock: 0, turn: 0, rounds: 0, lastCol: 0, lastRow: 0 });
    this.list = []; // the near ones, in the order the program keeps them (near_list)
    this.items = Array.from({ length: K.COUNT }, () => ({ col: 0, row: 0, kind: 0, back: 0, near: 0 }));
    for (let i = K.COUNT - 1; i >= 0; i--) this.place(i);
    [this.lastCol, this.lastRow] = Pickups.tileOf(cam);
    this.allNear(cam);
    /** What picking them up did, for the tests: kinds in the order taken; and whether the player has a knife. */
    this.taken = [];
    this.knife = 0;
    this.ammo = 0; // (the gun takes it: people-model.mjs)
    /** Dropped: kind 1-9 (cash, that many tens of dollars), DROP_KNIFE, or AWAY; where, in pixels; frames left. */
    this.drops = Array.from({ length: K.DROPS }, () => ({ kind: K.AWAY, x: 0, y: 0, life: 0 }));
  }
  /** pickups.drop: someone the player kills, at pixel (x, y), drops cash, a knife, or nothing. */
  drop(x, y) {
    const r = this.rnd();
    let kind;
    if (r < K.CASH_ODDS) kind = (this.rnd() % 9) + 1;
    else if (r < K.KNIFE_ODDS && !this.knife) kind = K.DROP_KNIFE;
    else return;
    for (let i = K.DROPS - 1; i >= 0; i--) {
      if (this.drops[i].kind !== K.AWAY) continue;
      Object.assign(this.drops[i], { kind, x, y, life: K.LIFE });
      return;
    }
  }
  /** A 16-bit shift register (x^16 + x^5 + x^3 + x^2 + 1): its low byte. */
  rnd() {
    let a = this.seed << 1;
    if (a > 0xffff) a = (a & 0xffff) ^ 0x2d;
    this.seed = a;
    return a & 255;
  }
  static tileOf(cam) {
    return [(cam.x >> 4) & 255, (cam.y >> 4) & 255];
  }
  place(i) {
    for (;;) {
      let col, row;
      while ((col = this.rnd()) >= MAP_SIZE);
      while ((row = this.rnd()) >= MAP_SIZE);
      const near = (v, at) => ((v - (at - K.CLEAR)) & 255) <= 2 * K.CLEAR;
      if (near(col, K.START_COL) && near(row, K.START_ROW)) continue;
      const k = kindOfTile(col, row);
      if (k !== PAVEMENT && k !== GRASS) continue;
      const r = this.rnd();
      Object.assign(this.items[i], { col, row, kind: K.SHARES.filter((t) => r >= t).length });
      return;
    }
  }
  /** Nearness, and the list to match: one that comes near goes on its end; one no longer near is taken off, the last in its place. */
  nearOne(i) {
    const p = this.items[i], within = (d, span) => ((d + K.NEAR_TILES) & 255) <= span + 2 * K.NEAR_TILES;
    const near = within(p.col - this.lastCol, 19) && within(p.row - this.lastRow, 10) ? 1 : 0;
    if (near && !p.near) this.list.push(i);
    if (!near && p.near) {
      const j = this.list.indexOf(i), last = this.list.pop();
      if (j < this.list.length) this.list[j] = last;
    }
    p.near = near;
  }
  allNear(cam) {
    for (const p of this.items) p.near = 0;
    this.list = [];
    for (let i = K.COUNT - 1; i >= 0; i--) this.nearOne(i);
    this.paintNear(cam);
  }
  /** pickups.paint_near: whether the paint shop is near the window, as for a pickup; then it is shown. Then the arrow. */
  paintNear(cam) {
    const within = (d, span) => ((d + K.NEAR_TILES) & 255) <= span + 2 * K.NEAR_TILES;
    this.paint = within((K.PAINT_X >> 4) - this.lastCol, 19) && within((K.PAINT_Y >> 4) - this.lastRow, 10);
    this.arrowRound(cam);
  }
  /**
   * pickups.arrow_round and arrow_axes: with heat, at the wheel (`this.at`, `this.onFoot` as step was given
   * them), and the shop not 12 pixels inside the view, the arrow's way and where it and the S go; else none.
   */
  arrowRound(cam) {
    this.arrow = null;
    if (!this.heat?.level || this.onFoot || !this.at) return;
    const c = [cam.x, cam.y], shop = [K.PAINT_X, K.PAINT_Y];
    if ([0, 1].every((x) => w16(shop[x] - 13 - c[x]) < K.VIEW[x] - 25)) return;
    const d = [0, 1].map((x) => w16(shop[x] - this.at[x])), neg = d.map((v) => v >= 0x8000);
    for (let x = 0; x < 2; x++) if (neg[x]) d[x] = w16(-d[x]);
    while (d[0] > 255 || d[1] > 255) for (let x = 0; x < 2; x++) d[x] >>= 1;
    const swap = d[0] >= d[1] ? 0 : 1, big = d[swap];
    let a = d[1 - swap], q = 0;
    for (let n = 0; n < 6; n++) {
      const carry = a >> 7;
      a = (a << 1) & 255;
      const bit = carry || a >= big ? 1 : 0;
      if (bit) a = (a - big) & 255;
      q = (q << 1) | bit;
    }
    const r = q & 63;
    let way = r < 13 ? 0 : r < 43 ? 1 : 2;
    if (swap) way = 4 - way;
    if (neg[0]) way = 8 - way;
    if (neg[1]) way = (16 - way) & 15;
    const off = r >= K.A_CAP ? 255 : A_OFF[r], so = A_S[r >> 1], at = [0, 0, 0, 0];
    const clamp = (t, i) => {
      const lo = K.A_LOW[i], hi = K.A_HIGH[i];
      return (at[i] = t >= 0x8000 || t < lo ? lo : t > hi ? hi : t);
    };
    for (let x = 1; x >= 0; x--) {
      let t;
      if (x === swap) t = clamp(neg[x] ? 0xff00 : 0x0400, 2 * x); // (past the edge, either way)
      else t = clamp(w16(this.at[x] - c[x] + K.A_K[x] + (neg[x] ? -off : off)), 2 * x);
      const s = (x === swap ? so >> 4 : so) & 15;
      clamp(w16(t + (neg[x] ? s : -s)), 2 * x + 1); // (the S: back towards the player)
    }
    this.arrow = { way, at };
  }
  static middle(p) {
    return [p.col * 16 + 8, p.row * 16 + 8];
  }
  /**
   * pickups.update: once a pass, after the window `cam` has moved; nothing more in a frame that is not `quiet`
   * (one that works out colour memory or moves the screen a character).
   */
  step(cam, quiet = true, at = null, onFoot = false) {
    Object.assign(this, { at, onFoot }); // (for the arrow, worked out with the nearness: arrowRound)
    this.clock = (this.clock + 1) & 255;
    for (const d of this.drops) if (d.kind !== K.AWAY && --d.life === 0) d.kind = K.AWAY;
    if (!quiet) return;
    const [col, row] = Pickups.tileOf(cam);
    const jumped = (v, last) => ((v - last + 1) & 255) >= 3;
    if (jumped(col, this.lastCol) || jumped(row, this.lastRow)) {
      [this.lastCol, this.lastRow] = [col, row];
      this.allNear(cam);
      return;
    }
    [this.lastCol, this.lastRow] = [col, row];
    for (let n = 0; n < K.TURN_EACH; n++) {
      const p = this.items[this.turn];
      if (p.kind === K.AWAY && (this.rounds & 3) === 0) {
        p.back = (p.back - 1) & 255;
        if (!p.back) this.place(this.turn);
      }
      this.nearOne(this.turn);
      this.turn = (this.turn + 1) % K.COUNT;
      if (!this.turn) {
        this.rounds = (this.rounds + 1) & 255;
        this.paintNear(cam);
      }
    }
  }
  take(i) {
    const p = this.items[i];
    this.taken.push(p.kind);
    const kind = p.kind;
    if (kind === KNIFE) this.knife = 1; // (a spare one is pawned)
    if (kind === AMMO) this.ammo = Math.min(99, this.ammo + 12);
    if (kind === DONUT) this.heat?.donut(); // (heat-model.mjs)
    p.kind = K.AWAY;
    p.back = (this.rnd() % K.BACK_SPREAD) + K.BACK_MIN;
    if (kind === CASH) this.lastCash = 50 * ((this.rnd() % 6) + 1);
  }
  /**
   * pickups.show, after the passers-by: each near one is picked up if the player is on it (`at`, in pixels);
   * else listed for the multiplexer for the window `cam` if in sight.
   */
  show(cam, at, busy = false) {
    const list = [];
    const within = (d) => w16(d + K.REACH) <= 2 * K.REACH;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const i = this.list[k], p = this.items[i];
      if (p.kind === K.AWAY) continue;
      const [x, y] = Pickups.middle(p);
      if (!busy && within(x - at[0]) && within(y - at[1])) {
        this.take(i);
        continue;
      }
      const t = w16(y - (cam.y - 10)), u = w16(x - (cam.x - 11));
      if (t >= 160 || u > 326) continue;
      list.push(this.sprite(t, u, p.kind));
    }
    for (let i = K.DROPS - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.kind === K.AWAY) continue;
      if (!busy && within(d.x - at[0]) && within(d.y - at[1])) {
        this.takeDrop(d);
        continue;
      }
      if (d.life < K.BLINK && this.clock & 8) continue; // blinking off
      const t = w16(d.y - (cam.y - 10)), u = w16(d.x - (cam.x - 11));
      if (t >= 160 || u > 326) continue;
      list.push(this.sprite(t, u, d.kind === K.DROP_KNIFE ? KNIFE : CASH));
    }
    if (this.paint) {
      const t = w16(K.PAINT_Y - (cam.y - 10)), u = w16(K.PAINT_X - (cam.x - 11));
      if (t < 160 && u <= 326) list.push({ y: t + 34, x: u + 8, pointer: K.MARKER, colour: K.FLASH[(this.clock >> 4) & 1] | 0x80 });
    }
    if (this.arrow) { // (show_arrow: the S, then the arrow)
      const a = this.arrow.at;
      list.push({ x: a[1], y: a[3], pointer: SIGN_SPRITE, colour: K.CYAN | 0x80 });
      list.push({ x: a[0], y: a[2], pointer: ARROW_SPRITE, colour: K.CYAN, bitmap: arrowFrame(this.arrow.way) });
    }
    return list;
  }
  sprite(t, u, kind) {
    return { y: t + 34 + ((this.clock >> 4) & 1), x: u + 8, pointer: K.SPRITE + kind, colour: K.COLOURS[kind] | 0x80 };
  }
  takeDrop(d) {
    const kind = d.kind;
    d.kind = K.AWAY;
    if (kind === K.DROP_KNIFE) {
      this.taken.push(KNIFE);
      this.knife = 1;
    } else {
      this.taken.push(CASH);
      this.lastCash = kind * 10;
    }
  }
  get state() {
    return {
      seed: this.seed, clock: this.clock, turn: this.turn, rounds: this.rounds, lastCol: this.lastCol, lastRow: this.lastRow, list: [...this.list],
      paint: this.paint, arrow: this.arrow ? { way: this.arrow.way, at: [...this.arrow.at] } : null,
      items: this.items.map((p) => ({ ...p, back: p.kind === K.AWAY ? p.back : 0 })),
      drops: this.drops.map((d) => (d.kind === K.AWAY ? { kind: K.AWAY } : { ...d })),
    };
  }
}

/** The same, read from the program. */
export async function readPickups(vice, L) {
  const get = async (name, n = K.COUNT) => [...(await vice.read(L[`pickups.${name}`], n))];
  const [col, row, kind, back, near] = await Promise.all(['col', 'row', 'kind', 'back', 'close'].map((n) => get(n)));
  const [lo, hi] = await get('seed', 2), seed = lo | (hi << 8), [clock] = await get('clock', 1), [turn] = await get('turn', 1);
  const [rounds] = await get('rounds', 1), [lastCol] = await get('last_col', 1), [lastRow] = await get('last_row', 1), [listed] = await get('listed', 1);
  const list = listed ? await get('near_list', listed) : [];
  const [skip] = await get('paint_skip', 1), paint = skip === 0x2c; // (bit: near; jmp, past the marker: not)
  const [tail] = await get('paint_tail', 1), [way] = await get('a_way', 1);
  const [lo4, hi4] = [await get('a_at_lo', 4), await get('a_at_hi', 4)];
  const arrow = tail === 0x4c ? { way, at: lo4.map((v, i) => v | (hi4[i] << 8)) } : null; // (jmp: shown)
  const [dk, dxl, dxh, dyl, dyh, dll, dlh] = await Promise.all(['dkind', 'dx_lo', 'dx_hi', 'dy_lo', 'dy_hi', 'dlife_lo', 'dlife_hi'].map((n) => get(n, K.DROPS)));
  const drops = dk.map((kind, i) => (kind === K.AWAY ? { kind } : { kind, x: dxl[i] | (dxh[i] << 8), y: dyl[i] | (dyh[i] << 8), life: dll[i] | (dlh[i] << 8) }));
  return {
    drops,
    seed, clock, turn, rounds, lastCol, lastRow, list, paint, arrow,
    items: col.map((c, i) => ({ col: c, row: row[i], kind: kind[i], back: kind[i] === K.AWAY ? back[i] : 0, near: near[i] })),
  };
}
