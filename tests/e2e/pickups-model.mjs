// SPDX-License-Identifier: GPL-2.0-or-later
// A model of the pickups (src/pickups.asm), worked out again here so the tests can hold the program to it frame
// by frame: where they are, which kind, which are away and for how long, and what is shown. The rules are the
// program's: see the comments there for why they are what they are.
import { assets, MAP_SIZE } from './game.mjs';

export const K = {
  COUNT: 12, REACH: 11, TURN_EACH: 2, NEAR_TILES: 5, BACK_MIN: 83, BACK_SPREAD: 63, CLEAR: 2,
  START_COL: 18, START_ROW: 13, SPRITE: 0x0c40 / 64, AWAY: 0xff,
  SHARES: [87, 159, 205, 241], // a random byte at or above each: cash, donut, bandage, knife (below the first: ammo)
  COLOURS: [8, 5, 10, 1, 15], // orange, green, light red, white, light grey
  // What someone the player kills drops: DROPS at once, for LIFE frames, blinking in the last BLINK; a random
  // byte below CASH_ODDS is cash, else below KNIFE_ODDS a knife (if the player has none).
  DROPS: 3, LIFE: 1000, BLINK: 200, CASH_ODDS: 102, KNIFE_ODDS: 123, DROP_KNIFE: 10,
};
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
    this.allNear();
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
  allNear() {
    for (const p of this.items) p.near = 0;
    this.list = [];
    for (let i = K.COUNT - 1; i >= 0; i--) this.nearOne(i);
  }
  static middle(p) {
    return [p.col * 16 + 8, p.row * 16 + 8];
  }
  /**
   * pickups.update: once a pass, after the window `cam` has moved; nothing more in a frame that is not `quiet`
   * (one that works out colour memory or moves the screen a character).
   */
  step(cam, quiet = true) {
    this.clock = (this.clock + 1) & 255;
    for (const d of this.drops) if (d.kind !== K.AWAY && --d.life === 0) d.kind = K.AWAY;
    if (!quiet) return;
    const [col, row] = Pickups.tileOf(cam);
    const jumped = (v, last) => ((v - last + 1) & 255) >= 3;
    if (jumped(col, this.lastCol) || jumped(row, this.lastRow)) {
      [this.lastCol, this.lastRow] = [col, row];
      this.allNear();
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
      if (!this.turn) this.rounds = (this.rounds + 1) & 255;
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
  const [dk, dxl, dxh, dyl, dyh, dll, dlh] = await Promise.all(['dkind', 'dx_lo', 'dx_hi', 'dy_lo', 'dy_hi', 'dlife_lo', 'dlife_hi'].map((n) => get(n, K.DROPS)));
  const drops = dk.map((kind, i) => (kind === K.AWAY ? { kind } : { kind, x: dxl[i] | (dxh[i] << 8), y: dyl[i] | (dyh[i] << 8), life: dll[i] | (dlh[i] << 8) }));
  return {
    drops,
    seed, clock, turn, rounds, lastCol, lastRow, list,
    items: col.map((c, i) => ({ col: c, row: row[i], kind: kind[i], back: kind[i] === K.AWAY ? back[i] : 0, near: near[i] })),
  };
}
