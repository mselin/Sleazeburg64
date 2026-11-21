// SPDX-License-Identifier: GPL-2.0-or-later
// The car's handling, as src/car.asm does it, in JavaScript: the same integer sums in the same order, so the
// tests can hold the program to it frame by frame. See src/car.asm for what the numbers mean.
import { MAP_PIXELS, MAP_SIZE, assets } from './game.mjs';

export const C = {
  ACCEL: 18, BRAKE: 40, REVERSE: 11, HANDBRAKE: 22, COAST: 5, TOP: 1024, TOP_BACK: 410, BRAKING: 26,
  GRIP: 50, GRIP_BRAKING: 30, GRIP_HAND: 14, TURN_SPEED: 280, EDGE: 8, WALL: 1, GRASS: 2,
};
export const SIN = Array.from({ length: 256 }, (_, a) => Math.round(256 * Math.sin((a * Math.PI) / 128)));
const COS = (a) => SIN[(a + 64) & 255];
const AXIS = Array.from({ length: 16 }, (_, k) => [Math.round(6 * Math.cos((k * Math.PI) / 8)), Math.round(6 * Math.sin((k * Math.PI) / 8))]);
const mul = (v, s) => Math.trunc((v * s) / 256) | 0; // | 0: no -0
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const shrink = (v, k) => v - sign(v) * Math.min(Math.abs(v), k);
const kindAt = (x, y) => assets.tiles[1280 + assets.map[(y >> 4) * MAP_SIZE + (x >> 4)]];
export const direction16 = (angle) => (((angle >> 8) + 8) >> 4) & 15;

/** Whether a car centred at pixel (x, y) facing direction a (0-255) touches a wall or the edge. */
export function hits(x, y, a) {
  const [ox, oy] = AXIS[(((a + 8) & 255) >> 4) & 15];
  for (const t of [0, -1, 1]) {
    const qx = x + t * ox, qy = y + t * oy;
    for (const [dx, dy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const px = qx + dx, py = qy + dy;
      if (px < 0 || py < 0 || px >= MAP_PIXELS || py >= MAP_PIXELS) return true;
      if (kindAt(px, py) === C.WALL) return true;
    }
  }
  return false;
}

export class Car {
  /** A car at pixel (x, y), facing east, standing still. */
  constructor(x, y) {
    Object.assign(this, { x: x * 256, y: y * 256, vx: 0, vy: 0, angle: 0, colour: 2 }); // red
  }
  get px() {
    return this.x >> 8;
  }
  get py() {
    return this.y >> 8;
  }
  /**
   * One frame with the joystick held as given (JOY bits). `traffic`, if given, is the traffic model, which the
   * car can run into (traffic-model.mjs).
   */
  step(bits, traffic = null) {
    const thr = (bits & 1 && !(bits & 2) ? 1 : 0) - (bits & 2 && !(bits & 1) ? 1 : 0);
    const turn = (bits & 8 && !(bits & 4) ? 1 : 0) - (bits & 4 && !(bits & 8) ? 1 : 0);
    const hand = !!(bits & 16);
    const inside = hits(this.px, this.py, this.angle >> 8);
    let c = COS(this.angle >> 8), s = SIN[this.angle >> 8];
    if (turn) {
      let f0 = mul(this.vx, c) + mul(this.vy, s);
      if (f0 !== 0) {
        const m = Math.min(Math.abs(f0), C.TURN_SPEED);
        let rate = 2 * m + (m >> 2);
        if (hand) rate += rate >> 2;
        const next = (this.angle + turn * sign(f0) * rate) & 0xffff;
        if (inside || !hits(this.px, this.py, next >> 8)) this.angle = next;
      }
      c = COS(this.angle >> 8);
      s = SIN[this.angle >> 8];
    }
    const fwd = mul(this.vx, c) + mul(this.vy, s);
    const lat = mul(this.vy, c) - mul(this.vx, s);
    let nf = fwd;
    if (thr > 0) nf += C.ACCEL;
    else if (thr < 0) nf -= fwd > C.BRAKING ? C.BRAKE : C.REVERSE;
    if (hand) nf = shrink(nf, C.HANDBRAKE);
    nf -= nf >> 7;
    if (!thr) nf = shrink(nf, C.COAST);
    nf = Math.max(-C.TOP_BACK, Math.min(C.TOP, nf));
    let grip = hand ? C.GRIP_HAND : thr < 0 && fwd > C.BRAKING ? C.GRIP_BRAKING : C.GRIP;
    if (kindAt(this.px, this.py) === C.GRASS) grip = (grip * 9) >> 4;
    let nl = shrink(lat, grip);
    nl -= nl >> 6;
    const dF = nf - fwd, dL = nl - lat;
    this.vx += mul(dF, c) - mul(dL, s);
    this.vy += mul(dF, s) + mul(dL, c);
    traffic?.nearby(this.px, this.py);
    const [ox, oy] = AXIS[(((this.angle >> 8) + 8) & 255) >> 4];
    for (const [p, v, isX] of [['x', 'vx', true], ['y', 'vy', false]]) {
      const n = this[p] + this[v];
      const nx = isX ? n >> 8 : this.px, ny = isX ? this.py : n >> 8;
      let bounce = !inside && hits(nx, ny, this.angle >> 8);
      if (!inside && !bounce && traffic) {
        // The three points' offsets along the axis moving and across it: middle, back, front.
        const along = [0, -(isX ? ox : oy), isX ? ox : oy], across = [0, -(isX ? oy : ox), isX ? oy : ox];
        const hit = traffic.bump(isX, isX ? this.px : this.py, isX ? nx : ny, isX ? this.py : this.px, along, across);
        if (hit >= 0) {
          traffic.hit(hit, this[v]);
          bounce = true;
        }
      }
      if (bounce) this[v] = -(this[v] >> 2) | 0;
      else {
        const pixel = n >> 8;
        this[p] = pixel < C.EDGE ? C.EDGE * 256 : pixel >= MAP_PIXELS - C.EDGE ? (MAP_PIXELS - C.EDGE) * 256 : n;
      }
    }
  }
}
