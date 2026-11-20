// SPDX-License-Identifier: GPL-2.0-or-later
// The Sleazeburg city generator. This is the same code as the browser game's (js/world.js in
// mselin/gta-c64), kept identical on purpose so both versions have the same streets.
// CITY_CHECKSUM below is the browser game's value; assets.mjs refuses to build if this copy drifts from it.

export const MW = 98; // tiles per side
export const NB = 8; // blocks per side
export const PB = 12; // tiles from one block to the next
export const ROAD = 0, WALK = 1, BLD = 2, GRASS = 3, WATER = 4, LOT = 5, PLAZA = 6, TREE = 7, FOUNT = 8;
export const CITY_CHECKSUM = 42367120;

const SPECIAL = {
  '1,1': { col: 1, txt: 'ST. INVOICE' },
  '6,2': { col: 6, txt: 'PRECINCT 64' },
  '2,5': { col: 15, txt: 'CITY HALL' },
  '6,6': { col: 9, txt: 'CHOP SHOP' },
  '1,6': { col: 4, txt: 'PAINT & PRAY' },
};

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (x, y) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;

/** Generate the city. Returns the tile type, building id and building colour of every tile, plus the signs. */
export function generate() {
  const map = new Uint8Array(MW * MW),
    bid = new Uint16Array(MW * MW),
    bcol = new Uint8Array(MW * MW),
    signs = [];
  const rnd = mulberry(64064);
  let nb = 1;
  const BC = [2, 4, 8, 9, 10, 12, 14, 3, 6];
  const fill = (x0, y0, w, h, t, col) => {
    const id = t === BLD ? nb++ : 0;
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = y * MW + x;
        map[i] = t;
        bid[i] = id;
        bcol[i] = col || 0;
      }
  };
  const bld = (x0, y0, w, h) => {
    const col = BC[Math.floor(rnd() * BC.length)];
    fill(x0, y0, w, h, BLD, col);
    if (w === 8 && rnd() < 0.75) signs.push({ x: x0, y: y0, w, h });
  };
  for (let y = 0; y < MW; y++)
    for (let x = 0; x < MW; x++) {
      const mx = x % PB,
        my = y % PB;
      map[y * MW + x] = mx < 2 || my < 2 ? ROAD : mx === 2 || mx === 11 || my === 2 || my === 11 ? WALK : GRASS;
    }
  for (let by = 0; by < NB; by++)
    for (let bx = 0; bx < NB; bx++) {
      const ox = bx * PB + 3,
        oy = by * PB + 3,
        sp = SPECIAL[bx + ',' + by];
      if (bx === 4) {
        fill(ox, oy, 8, 8, WATER);
        continue;
      }
      if (sp) {
        fill(ox, oy, 8, 8, BLD, sp.col);
        signs.push({ x: ox, y: oy, w: 8, h: 8, txt: sp.txt });
        continue;
      }
      const r = rnd();
      if (r < 0.13) {
        fill(ox, oy, 8, 8, GRASS);
        for (let y = oy; y < oy + 8; y++) for (let x = ox; x < ox + 8; x++) if (rnd() < 0.16) map[y * MW + x] = TREE;
      } else if (r < 0.25) {
        fill(ox, oy, 8, 8, LOT);
        // The browser game draws two random numbers per bay here, for its parked cars.
        for (let i = 0; i < 8; i++) {
          rnd();
          rnd();
        }
      } else if (r < 0.32) {
        fill(ox, oy, 8, 8, PLAZA);
        fill(ox + 3, oy + 3, 2, 2, FOUNT);
      } else {
        const q = rnd();
        if (q < 0.3) bld(ox, oy, 8, 8);
        else if (q < 0.5) {
          bld(ox, oy, 8, 4);
          bld(ox, oy + 4, 8, 4);
        } else if (q < 0.65) {
          bld(ox, oy, 4, 8);
          bld(ox + 4, oy, 4, 8);
        } else
          for (let j = 0; j < 2; j++)
            for (let i = 0; i < 2; i++) {
              const z = rnd();
              if (z < 0.14) {
                fill(ox + i * 4, oy + j * 4, 4, 4, GRASS);
                map[(oy + j * 4 + 1) * MW + ox + i * 4 + 2] = TREE;
              } else if (z < 0.24) fill(ox + i * 4, oy + j * 4, 4, 4, PLAZA);
              else bld(ox + i * 4, oy + j * 4, 4, 4);
            }
      }
    }
  return { map, bid, bcol, signs };
}
export function checksum(map) {
  let s = 0;
  for (const t of map) s = (s * 31 + t) >>> 0;
  return s;
}
