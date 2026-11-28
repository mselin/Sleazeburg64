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
export const AXIS = Array.from({ length: 16 }, (_, k) => [Math.round(6 * Math.cos((k * Math.PI) / 8)), Math.round(6 * Math.sin((k * Math.PI) / 8))]);
const mul = (v, s) => Math.trunc((v * s) / 256) | 0; // | 0: no -0
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const shrink = (v, k) => v - sign(v) * Math.min(Math.abs(v), k);
const kindAt = (x, y) => assets.tiles[1280 + assets.map[(y >> 4) * MAP_SIZE + (x >> 4)]];
/** In the water (water.asm): by thirds of the car in it, acceleration, top speed and top speed backwards. */
export const WADE = { ACCEL: [18, 14, 11, 7], TOP: [1024, 785, 546, 307] };
WADE.BACK = WADE.TOP.map((t) => Math.floor((t * 2) / 5));
export const direction16 = (angle) => (((angle >> 8) + 8) >> 4) & 15;
/** The most turn for a unit of grip, by the speed in sixteenths of a pixel a frame (car.most_turn), times 4. */
export const MOST_TURN = Array.from({ length: 65 }, (_, s) => Math.min(255, Math.trunc((4 * 10430.378) / (16 * s + 8) + 0.5)));

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
  /** What the tyres hold sideways at forward speed f: less on the handbrake, braking, on grass, in the water. */
  grip(f, thr, hand) {
    let grip = hand ? C.GRIP_HAND : thr < 0 && f > C.BRAKING ? C.GRIP_BRAKING : C.GRIP;
    if (kindAt(this.px, this.py) === C.GRASS) grip = (grip * 9) >> 4;
    return grip - this.wet * Math.floor(grip / 6);
  }
  /** A car at pixel (x, y), facing east, standing still. */
  constructor(x, y) {
    // wet: thirds of it in the water, as water-model.mjs last found (water.wet).
    // assist: its driver assistance (car.assist): bit 7 lane assist; the rest anti-theft, 0 none, 1 stopped for
    // good, else the 32-frame steps left until it is. wait, swerve, pull: lane assist's (car.lane).
    Object.assign(this, { x: x * 256, y: y * 256, vx: 0, vy: 0, angle: 0, colour: 2, wet: 0, assist: 0, wait: 0, swerve: 0, pull: 0 }); // red
  }
  get px() {
    return this.x >> 8;
  }
  get py() {
    return this.y >> 8;
  }
  /**
   * car.anti, before the engine: the steps counted down on the traffic's `tick` (from before its step), and the
   * message as the last one goes (`said`); once stopped, the throttle does nothing and the car brakes while its
   * forward speed `fwd` is more than BRAKING.
   */
  anti(thr, fwd, tick) {
    const left = this.assist & 0x7f;
    if (!left) return thr;
    if (left > 1) {
      if (!(tick & 31) && (--this.assist & 0x7f) === 1) this.said = 'THEFT';
      return thr;
    }
    return fwd > C.BRAKING ? -1 : 0;
  }
  /**
   * car.lane, before anti: while it holds the wheel (`swerve` frames left, `pull` the way, by its sign), every 8
   * frames it changes its mind 2 times in 3; else, in a car with it, going forward at 256 or more, a step every 16
   * frames of `tick`, the steps (`wait`, 16 to 48) rolled when there are none, and at the last it takes the wheel
   * for 40 frames, a random way, with its message. `rnd`: the traffic's random numbers (traffic.rnd).
   */
  lane(fwd, tick, rnd) {
    if (this.swerve) {
      if (!--this.swerve) this.pull = 0;
      else if (!(this.swerve & 7) && rnd.next() < 171) this.pull ^= 0xfe;
      return;
    }
    if (!(this.assist & 0x80) || fwd < 256 || tick & 15) return;
    if (!this.wait) this.wait = 16 + (rnd.next() & 31) + rnd.carry;
    if (--this.wait) return;
    this.swerve = 40;
    this.said = 'LANE';
    this.pull = (rnd.next() & 0x80) | 0x40; // ($40 or $c0: the stick leaves its sign)
  }
  /**
   * One frame with the joystick held as given (JOY bits). `traffic`, if given, is the traffic model, which the
   * car can run into (traffic-model.mjs). `busy`: the frame works out colour memory (the window's `busy` before
   * it moves), and then the car's picture does not turn a step.
   */
  step(bits, traffic = null, busy = false) {
    let thr = (bits & 1 && !(bits & 2) ? 1 : 0) - (bits & 2 && !(bits & 1) ? 1 : 0);
    let turn = (bits & 8 && !(bits & 4) ? 1 : 0) - (bits & 4 && !(bits & 8) ? 1 : 0);
    if (this.pull) turn = this.pull & 0x80 ? -1 : 1; // car.wheel: lane assist has the wheel
    const hand = !!(bits & 16);
    const inside = hits(this.px, this.py, this.angle >> 8);
    this.ground = kindAt(this.px, this.py); // (car.ground: what it is on this frame)
    let c = COS(this.angle >> 8), s = SIN[this.angle >> 8];
    let grip = null; // what the tyres hold: from the speed before turning if the car turns, as the design
    if (turn) {
      let f0 = mul(this.vx, c) + mul(this.vy, s);
      if (f0 !== 0) {
        grip = this.grip(f0, thr, hand);
        const m = Math.min(Math.abs(f0), C.TURN_SPEED);
        let rate = 2 * m + (m >> 2);
        if (hand) rate += rate >> 2;
        // Never sharper than the tyres hold (not on the handbrake): rate <= grip * 10430 / speed, by the table.
        else rate = Math.min(rate, (grip * MOST_TURN[Math.min(Math.abs(f0) >> 4, 64)]) >> 2);
        const next = (this.angle + turn * sign(f0) * rate) & 0xffff;
        const same = direction16(next) === direction16(this.angle); // the same picture: still clear
        if (inside || same || (!busy && !hits(this.px, this.py, next >> 8))) this.angle = next;
      }
      c = COS(this.angle >> 8);
      s = SIN[this.angle >> 8];
    }
    const fwd = mul(this.vx, c) + mul(this.vy, s);
    const lat = mul(this.vy, c) - mul(this.vx, s);
    this.said = null;
    if (traffic) this.lane(fwd, traffic.tick, traffic.rnd); // (after the steering, which had the stick's or its)
    thr = this.anti(thr, fwd, traffic?.tick ?? 0);
    let nf = fwd;
    const wet = this.wet;
    if (thr > 0) nf += WADE.ACCEL[wet];
    else if (thr < 0) nf -= fwd > C.BRAKING ? C.BRAKE : C.REVERSE;
    if (hand) nf = shrink(nf, C.HANDBRAKE);
    nf -= nf >> 7;
    if (!thr) nf = shrink(nf, C.COAST);
    nf -= wet * (nf >> 5);
    if (kindAt(this.px, this.py) === C.GRASS) nf -= nf >> 6; // grass is hard going
    nf = Math.max(-WADE.BACK[wet], Math.min(WADE.TOP[wet], nf));
    let nl = shrink(lat, grip ?? this.grip(fwd, thr, hand));
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
