// SPDX-License-Identifier: GPL-2.0-or-later
// Drives the VICE emulator from a test, through its binary monitor (a socket VICE listens on).
//
// A test starts a program, lets it run to a known address, then reads memory and registers, sets the
// joystick, and steps on a frame at a time. Nothing depends on wall-clock time: the emulated machine only
// moves when the test tells it to, so the tests give the same result on a slow machine as on a fast one.
//
// VICE packages do not include the Commodore ROMs, which are copyrighted. Like the screenshot tests this
// uses the open-source Open ROMs from the MEGA65 project, downloaded once into .cache/.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ROMS = join(ROOT, '.cache/open-roms');
const ROM_URL = 'https://raw.githubusercontent.com/MEGA65/open-roms/master/bin';
const ROM_FILES = { kernal: 'kernal_generic.rom', basic: 'basic_generic.rom', chargen: 'chargen_openroms.rom' };

export const JOY = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16 };

// Binary monitor commands and replies, from the VICE manual ("Binary monitor").
const CMD = { MEM_GET: 0x01, MEM_SET: 0x02, CHECKPOINT_SET: 0x12, CHECKPOINT_DELETE: 0x13, REGISTERS_GET: 0x31,
  REGISTERS_AVAILABLE: 0x83, JOYPORT_SET: 0xa2, EXIT: 0xaa, QUIT: 0xbb, AUTOSTART: 0xdd };
const REPLY = { CHECKPOINT: 0x11, REGISTERS: 0x31, STOPPED: 0x62, RESUMED: 0x63 };
const EVENT = 0xffffffff;

function roms() {
  mkdirSync(ROMS, { recursive: true });
  for (const file of Object.values(ROM_FILES))
    if (!existsSync(join(ROMS, file)))
      execFileSync('curl', ['-fsSL', '-o', join(ROMS, file), `${ROM_URL}/${file}`], { stdio: 'inherit' });
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

/** Read the labels file 64tass writes: `name = $hex` or `name = decimal`, one per line. */
export function readLabels(file) {
  const labels = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^(\w+)\s*=\s*(\$[0-9a-f]+|\d+)\s*$/i.exec(line);
    if (m) labels[m[1]] = m[2][0] === '$' ? parseInt(m[2].slice(1), 16) : Number(m[2]);
  }
  return labels;
}

export class Vice {
  /**
   * Start VICE and load and run a program (a path relative to the repository). The joystick is let go
   * before the program is loaded, and the machine then waits, stopped, for the first runTo().
   */
  static async start(prg, { timeoutMs = 60000 } = {}) {
    roms();
    const port = await freePort();
    // Control port 2 gets VICE's "I/O simulation" device, whose five lines the monitor can set: that is the
    // joystick. Port 1 stays empty.
    const args = ['-a', 'x64sc', '-default', '-kernal', join(ROMS, ROM_FILES.kernal), '-basic', join(ROMS, ROM_FILES.basic),
      '-chargen', join(ROMS, ROM_FILES.chargen), '-controlport2device', '37', '-sounddev', 'dummy', '-warp',
      '-autostartprgmode', '1', '-binarymonitor', '-binarymonitoraddress', `ip4://127.0.0.1:${port}`];
    const child = spawn('xvfb-run', args, { cwd: ROOT, stdio: 'ignore' });
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
    this.child.kill();
  }
}
