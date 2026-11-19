# Sleazeburg 64

A top-down crime satire for the **Commodore 64**, written in 6502 assembly. It is the real-hardware version of
the [browser game of the same name](https://mselin.github.io/gta-c64/), which only pretends to be a C64 game.

![The city viewer running in VICE](docs/city-viewer.png)

## Status

Early. This is **milestone 1a, the city viewer**: the program draws the city of Sleazeburg in multicolour
character mode and a joystick in port 2 moves the view around it, one tile at a time. There is no smooth
scrolling, no car, no traffic, no sound and no game yet. See [docs/ROADMAP.md](docs/ROADMAP.md) and the
[issues](https://github.com/mselin/Sleazeburg64/issues) for what comes next.

The streets are the same ones as in the browser game: both versions generate the city from the same code and
the build checks that they still agree.

## Build

You need [64tass](https://tass64.sourceforge.net/), Node.js 20 or later, and `make`.

```bash
make
```

That writes `build/sleazeburg64.prg`.

## Run

On a real C64 or C128 in 64 mode: copy the `.prg` to a disk, SD card or cartridge of your choice, plug a
joystick into **port 2**, then `LOAD` and `RUN` it. The program is for PAL machines; it has not been tried on
NTSC.

In [VICE](https://vice-emu.sourceforge.io/), if it is installed with C64 ROMs:

```bash
make run
```

## Test

```bash
make test
```

This checks the asset tools, then runs the program in VICE without a display and saves screenshots to
`build/`. It needs `x64sc`, `xvfb-run` and `curl`. VICE packages come without the Commodore ROMs, so the test
downloads the open-source [Open ROMs](https://github.com/MEGA65/open-roms) once into `.cache/`. They are used
only to start the emulated machine; nothing from them is part of this program or this repository.

## How it is put together

| Path | What it holds |
|---|---|
| `src/main.asm` | Start-up, memory layout, the main loop and moving the view. |
| `src/video.asm` | Screen set-up and drawing the city. |
| `src/panel.asm` | The three-row status panel. |
| `src/input.asm` | The joystick. |
| `src/c64.inc` | Hardware addresses and colour names. |
| `tools/city.mjs` | The city generator, identical to the browser game's. |
| `tools/assets.mjs` | Builds the character set, tile definitions and map that the program includes. |
| `tools/emulator-test.sh` | Runs the program in VICE and takes screenshots. |

**Graphics.** The screen is in multicolour character mode: every character pixel is two screen pixels wide and
is one of four colours, three shared by the whole screen (asphalt, pavement, outline) and one that each tile
picks from the first eight C64 colours. A city tile is 16 by 16 screen pixels, drawn as two characters by two.
The city is 98 by 98 tiles and is stored as one byte per tile naming one of 78 tile designs, so the whole map
is under 10 KB. The view shows 20 by 11 tiles, the same area as the browser game.

**Memory.**

| Address | Contents |
|---|---|
| `$0801` | BASIC line that starts the program |
| `$080d` | Code |
| `$3800` | Character set: font in 0–63, tile characters after |
| `$4000` | Tile definitions |
| `$4500` | City map |

The program switches BASIC and the KERNAL out and does not call them.

## Licence

Copyright (C) 2026 mselin.

Sleazeburg 64 is free software: you can redistribute it and/or modify it under the terms of the GNU General
Public License as published by the Free Software Foundation, either version 2 of the License, or (at your
option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY.
See [LICENSE](LICENSE).
