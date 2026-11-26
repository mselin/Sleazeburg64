// SPDX-License-Identifier: GPL-2.0-or-later
// A model of heat (status.add_heat and status.cooling in src/status.asm), worked out again here so that the tests
// hold the program to it frame by frame, as everything else: the points (in halves, as the program keeps them),
// the level, and the frames before it cools a level. Whoever models a crime adds its points here.

export const H = { COOL: 9 * 50, MOST: 2 * 230, LEVELS: [0, 8, 25, 60, 110, 180].map((p) => 2 * p) };

export class Heat {
  constructor() {
    Object.assign(this, { points: 0, level: 0, cool: 0 });
  }
  /** status.add_heat: `halves` more (at most MOST), the time to cool counted afresh, and a level higher if they reach one. */
  add(halves) {
    this.points = Math.min(H.MOST, this.points + halves);
    this.cool = H.COOL;
    let level = 5;
    while (level > 0 && this.points < H.LEVELS[level]) level--;
    if (level > this.level) this.level = level;
  }
  /** status.cooling, once a frame (status.update) while there is heat: a level less every COOL frames. */
  tick() {
    if (!this.level) return;
    this.cool = (this.cool - 1) & 0xffff;
    if (this.cool) return;
    this.cool = H.COOL;
    this.level--;
    this.points = H.LEVELS[this.level];
  }
  /** A donut (pickups.asm): a level less, its points to that level's start. */
  donut() {
    if (!this.level) return;
    this.level--;
    this.points = H.LEVELS[this.level];
  }
  /** As the tests compare it: the time to cool means nothing with no heat (the program leaves it as it was). */
  get state() {
    return { points: this.points, level: this.level, cool: this.level ? this.cool : 0 };
  }
}

/** Put heat into the program and the model `heat`: { level, points (halves), cool (frames) }. */
export async function putHeat(vice, L, heat, { level, points, cool = H.COOL }) {
  Object.assign(heat, { level, points, cool });
  await vice.write(L['status.heat'], [level]);
  await vice.write(L['status.points'], [points & 255, points >> 8]);
  await vice.write(L['status.cool'], [cool & 255, cool >> 8]);
}

/** The same, read from the program. */
export async function readHeat(vice, L) {
  const [lo, hi] = await vice.read(L['status.points'], 2), [level] = await vice.read(L['status.heat'], 1);
  const [cl, ch] = await vice.read(L['status.cool'], 2);
  return { points: lo | (hi << 8), level, cool: level ? cl | (ch << 8) : 0 };
}
