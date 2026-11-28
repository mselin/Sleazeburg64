// SPDX-License-Identifier: GPL-2.0-or-later
// Drives the VICE emulator from a test, through its binary monitor (a socket VICE listens on).
//
// A test starts a program, lets it run to a known address, then reads memory and registers, sets the
// joystick, and steps on a frame at a time. Nothing depends on wall-clock time: the emulated machine only
// moves when the test tells it to, so the tests give the same result on a slow machine as on a fast one.
//
// VICE packages do not include the Commodore ROMs, which are copyrighted. Like the screenshot tests this
// fetches them into .cache/ from a fixed commit of the VICE project's own repository
// (github.com/VICE-Team/svn-mirror) and checks their SHA-256, or
// with VICE_ROMS=open uses the MEGA65 project's open-source Open ROMs. See tools/vice-lib.sh.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ROM_SETS = {
  commodore: {
    dir: '.cache/vice-roms',
    url: 'https://raw.githubusercontent.com/VICE-Team/svn-mirror/83095dcbf3a535167fb864fc4801b0c8ef5be517/vice/data/C64',
    kernal: ['kernal-901227-03.bin', '83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721'],
    basic: ['basic-901226-01.bin', '89878cea0a268734696de11c4bae593eaaa506465d2029d619c0e0cbccdfa62d'],
    chargen: ['chargen-901225-01.bin', 'fd0d53b8480e86163ac98998976c72cc58d5dd8eb824ed7b829774e74213b420'],
  },
  open: {
    dir: '.cache/open-roms',
    url: 'https://raw.githubusercontent.com/MEGA65/open-roms/ad178dbe4d48cd6a317737a8e0e7e662f7e33d32/bin',
    kernal: ['kernal_generic.rom', '88e86ed3d0c710edab8f90ad146faa8de1ead11f43494b176c7b54724ca721c6'],
    basic: ['basic_generic.rom', '54a1464b4b27c9dc61bbd62a818fdd12ec99af9089111005a5add0ad0e6bd5ec'],
    chargen: ['chargen_openroms.rom', '5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7'],
  },
};
const ROM_SET = ROM_SETS[process.env.VICE_ROMS || 'commodore'];
if (!ROM_SET) throw new Error(`VICE_ROMS must be one of ${Object.keys(ROM_SETS).join(', ')}`);
const ROMS = join(ROOT, ROM_SET.dir);
const ROM_FILES = { kernal: ROM_SET.kernal[0], basic: ROM_SET.basic[0], chargen: ROM_SET.chargen[0] };

export const JOY = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16 };

// Binary monitor commands and replies, from the VICE manual ("Binary monitor").
const CMD = { MEM_GET: 0x01, MEM_SET: 0x02, CHECKPOINT_SET: 0x12, CHECKPOINT_DELETE: 0x13, REGISTERS_GET: 0x31, REGISTERS_SET: 0x32,
  REGISTERS_AVAILABLE: 0x83, DISPLAY_GET: 0x84, JOYPORT_SET: 0xa2, EXIT: 0xaa, QUIT: 0xbb, AUTOSTART: 0xdd };
const REPLY = { CHECKPOINT: 0x11, REGISTERS: 0x31, STOPPED: 0x62, RESUMED: 0x63 };
const EVENT = 0xffffffff;

function roms() {
  mkdirSync(ROMS, { recursive: true });
  for (const [file, sha256] of [ROM_SET.kernal, ROM_SET.basic, ROM_SET.chargen]) {
    const path = join(ROMS, file);
    if (!existsSync(path)) execFileSync('curl', ['-fsSL', '-o', path, `${ROM_SET.url}/${file}`], { stdio: 'inherit' });
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256)
      throw new Error(`${path} is not the expected ROM`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function connect(port, child, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) return reject(new Error(`VICE exited with status ${child.exitCode} before the monitor was up`));
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => resolve(socket));
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error('VICE did not open its monitor port'));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

/**
 * Read a labels file 64tass writes, in its own format (`name = $hex`, top level only) or VICE's
 * (`al hex .block:name`, nested ones too, which come back as `block.name`).
 */
export function readLabels(file) {
  const labels = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const own = /^(\w+)\s*=\s*(\$[0-9a-f]+|\d+)\s*$/i.exec(line);
    if (own) labels[own[1]] = own[2][0] === '$' ? parseInt(own[2].slice(1), 16) : Number(own[2]);
    const vice = /^al ([0-9a-f]+) \.([\w:]+)$/i.exec(line);
    if (vice) labels[vice[2].replaceAll(':', '.')] = parseInt(vice[1], 16);
  }
  return labels;
}

export class Vice {
  /**
   * Start VICE and load and run a program (a path relative to the repository). The joystick is let go
   * before the program is loaded, and the machine then waits, stopped, for the first runTo(). `extra`: more
   * of VICE's command-line options (a disk drive, for a disk image).
   */
  static async start(prg, { timeoutMs = 60000, extra = [] } = {}) {
    roms();
    const port = await freePort();
    // Control port 2 gets VICE's "I/O simulation" device, whose five lines the monitor can set: that is the
    // joystick. Port 1 stays empty.
    const args = ['-a', 'x64sc', '-default', '-kernal', join(ROMS, ROM_FILES.kernal), '-basic', join(ROMS, ROM_FILES.basic),
      '-chargen', join(ROMS, ROM_FILES.chargen), '-controlport2device', '37', '-sounddev', 'dummy', '-warp',
      '-autostartprgmode', '1', '-binarymonitor', '-binarymonitoraddress', `ip4://127.0.0.1:${port}`, ...extra];
    // In a process group of its own, so that quitting can stop xvfb-run's virtual display along with VICE.
    const child = spawn('xvfb-run', args, { cwd: ROOT, stdio: 'ignore', detached: true });
    const vice = new Vice(child, await connect(port, child), timeoutMs);
    await vice.joystick(0);
    const name = Buffer.from(prg, 'latin1');
    if (name.length > 255) throw new Error(`the path ${prg} is too long for VICE's autostart command`);
    await vice.#command(CMD.AUTOSTART, Buffer.concat([Buffer.from([1, 0, 0, name.length]), name]));
    return vice;
  }

  constructor(child, socket, timeoutMs) {
    this.child = child;
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.waiting = []; // { match(reply), resolve, reject, timer }
    this.registerIds = null;
    socket.on('data', (chunk) => this.#received(chunk));
    socket.on('error', (e) => this.#fail(e));
    socket.on('close', () => this.#fail(new Error('VICE closed the monitor connection')));
  }

  #fail(error) {
    for (const w of this.waiting.splice(0)) {
      clearTimeout(w.timer);
      w.reject(error);
    }
  }

  #received(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // A reply is: 2, API version, body length (4), type, error, request id (4), body.
    while (this.buffer.length >= 12) {
      const length = this.buffer.readUInt32LE(2);
      if (this.buffer.length < 12 + length) break;
      const reply = { type: this.buffer[6], error: this.buffer[7], id: this.buffer.readUInt32LE(8),
        body: this.buffer.subarray(12, 12 + length) };
      this.buffer = this.buffer.subarray(12 + length);
      const at = this.waiting.findIndex((w) => w.match(reply));
      if (at >= 0) {
        const [w] = this.waiting.splice(at, 1);
        clearTimeout(w.timer);
        w.resolve(reply);
      }
    }
  }

  #wait(match, what) {
    return new Promise((resolve, reject) => {
      const entry = { match, resolve, reject };
      entry.timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        reject(new Error(`timed out waiting for VICE: ${what}`));
      }, this.timeoutMs);
      this.waiting.push(entry);
    });
  }

  /** Send a command and return the reply of the given type that answers it. */
  async #command(command, body = Buffer.alloc(0), replyType = command) {
    const id = this.nextId++;
    const header = Buffer.alloc(11);
    header[0] = 2;
    header[1] = 2;
    header.writeUInt32LE(body.length, 2);
    header.writeUInt32LE(id, 6);
    header[10] = command;
    const answer = this.#wait((r) => r.id === id && (r.type === replyType || r.error !== 0), `command 0x${command.toString(16)}`);
    this.socket.write(Buffer.concat([header, body]));
    const reply = await answer;
    if (reply.error !== 0) throw new Error(`VICE refused command 0x${command.toString(16)} (error 0x${reply.error.toString(16)})`);
    return reply;
  }

  /** Read memory as the processor sees it, from `start` for `length` bytes. */
  async read(start, length = 1) {
    const body = Buffer.alloc(8);
    body[0] = 0; // no side effects: do not clear interrupt flags and the like by looking
    body.writeUInt16LE(start, 1);
    body.writeUInt16LE(start + length - 1, 3);
    const reply = await this.#command(CMD.MEM_GET, body);
    return Buffer.from(reply.body.subarray(2, 2 + reply.body.readUInt16LE(0)));
  }

  async write(start, bytes) {
    const body = Buffer.alloc(8 + bytes.length);
    body.writeUInt16LE(start, 1);
    body.writeUInt16LE(start + bytes.length - 1, 3);
    Buffer.from(bytes).copy(body, 8);
    await this.#command(CMD.MEM_SET, body);
  }

  /** The processor's registers by name: PC, A, X, Y, SP, FL, LIN (raster line), CYC (cycle in the line). */
  async registers() {
    if (!this.registerIds) {
      const reply = await this.#command(CMD.REGISTERS_AVAILABLE, Buffer.from([0]));
      this.registerIds = {};
      let at = 2;
      for (let n = reply.body.readUInt16LE(0); n > 0; n--) {
        const size = reply.body[at];
        const nameLength = reply.body[at + 3];
        this.registerIds[reply.body[at + 1]] = reply.body.latin1Slice(at + 4, at + 4 + nameLength);
        at += size + 1;
      }
    }
    const reply = await this.#command(CMD.REGISTERS_GET, Buffer.from([0]));
    const registers = {};
    let at = 2;
    for (let n = reply.body.readUInt16LE(0); n > 0; n--) {
      const size = reply.body[at];
      registers[this.registerIds[reply.body[at + 1]]] = reply.body.readUInt16LE(at + 2);
      at += size + 1;
    }
    return registers;
  }

  /** Set processor registers by name (as `registers` names them), e.g. { A: 0 }. */
  async setRegisters(values) {
    if (!this.registerIds) await this.registers();
    const ids = Object.fromEntries(Object.entries(this.registerIds).map(([id, name]) => [name, Number(id)]));
    const names = Object.keys(values), body = Buffer.alloc(3 + 4 * names.length);
    body.writeUInt16LE(names.length, 1); // (memory space 0: the main processor's)
    names.forEach((name, i) => {
      if (ids[name] === undefined) throw new Error(`no register ${name}`);
      body[3 + 4 * i] = 3; // the size of what follows
      body[4 + 4 * i] = ids[name];
      body.writeUInt16LE(values[name], 5 + 4 * i);
    });
    await this.#command(CMD.REGISTERS_SET, body, REPLY.REGISTERS);
  }

  /**
   * The picture as the video chip has drawn it so far, one byte per pixel holding its colour (0-15).
   * `at(x, line)` takes the video chip's own coordinates: x 24 and line 51 are the top left corner of the
   * 320 by 200 area inside the borders. Lines the raster has not reached yet still hold the frame before.
   *
   * VICE 3.7 gives the inner area's offset in its buffer one line higher than where line 51 is drawn, so a
   * line is looked up one row further on. The pixel tests would all fail if this were wrong: the top edge of
   * the 24-row window, line 55, is fixed by the video chip itself.
   */
  async display() {
    const reply = await this.#command(CMD.DISPLAY_GET, Buffer.from([1, 0]));
    const b = reply.body;
    const info = b.readUInt32LE(0);
    const width = b.readUInt16LE(4);
    const offsetX = b.readUInt16LE(8);
    const offsetY = b.readUInt16LE(10);
    const pixels = b.subarray(8 + info, 8 + info + b.readUInt32LE(4 + info));
    return { at: (x, line) => pixels[(line - 52 + offsetY) * width + (x - 24 + offsetX)] };
  }

  /** Hold the given directions and fire (JOY bits) on the joystick in port 2. 0 lets go of everything. */
  async joystick(bits) {
    const body = Buffer.alloc(4);
    body.writeUInt16LE(1, 0); // VICE counts the control ports from 0
    body.writeUInt16LE(~bits & 0x1f, 2); // the lines themselves: a closed switch pulls its line low
    await this.#command(CMD.JOYPORT_SET, body);
  }

  /** Let the machine run until it is about to execute the instruction at `address`. */
  async runTo(address) {
    if (this.stopAt !== address) {
      if (this.checkpoint !== undefined) {
        const body = Buffer.alloc(4);
        body.writeUInt32LE(this.checkpoint, 0);
        await this.#command(CMD.CHECKPOINT_DELETE, body);
      }
      const body = Buffer.alloc(8);
      body.writeUInt16LE(address, 0);
      body.writeUInt16LE(address, 2);
      body[4] = 1; // stop when hit
      body[5] = 1; // enabled
      body[6] = 4; // on execution
      body[7] = 0; // not temporary
      const reply = await this.#command(CMD.CHECKPOINT_SET, body, REPLY.CHECKPOINT);
      this.checkpoint = reply.body.readUInt32LE(0);
      this.stopAt = address;
    }
    const stopped = this.#wait((r) => r.id === EVENT && r.type === REPLY.STOPPED, `the program to reach $${address.toString(16)}`);
    await this.#command(CMD.EXIT);
    const pc = (await stopped).body.readUInt16LE(0);
    if (pc !== address) throw new Error(`stopped at $${pc.toString(16)}, not at $${address.toString(16)}`);
  }

  /** Run to `address` the given number of times: with the top of the main loop, that many frames. */
  async frames(address, count) {
    for (let i = 0; i < count; i++) await this.runTo(address);
  }

  async quit() {
    this.socket.removeAllListeners('close');
    this.socket.on('error', () => {});
    try {
      await this.#command(CMD.QUIT);
    } catch {
      // It is going away either way.
    }
    this.socket.destroy();
    try {
      process.kill(-this.child.pid, 'SIGTERM'); // the whole group: xvfb-run, Xvfb and VICE
    } catch {
      // Already gone.
    }
  }
}
