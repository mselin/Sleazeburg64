# Handover: Sleazeburg 64 (browser game and Commodore 64 port)

A briefing for whoever picks this project up next, person or assistant. Written by the repository owner
(GitHub user `mselin`) in the first person. Read it fully before acting.

## The two games

**1. Browser game (finished, live, in maintenance)**

- Repo: `mselin/mselin.github.io`, folder `gta-c64/`. Live at https://mselin.github.io/gta-c64/
- A top-down crime satire styled as a C64 game. Original game, not a recreation of any existing one: keep it
  that way.
- Plain ES modules under `gta-c64/js/`, no build step, served by GitHub Pages from `main`.
- Radio streams SID tunes from HVSC (https://www.hvsc.c64.org), played by USBSID-Player (WebAssembly,
  GPL-2.0-or-later, vendored in `gta-c64/usbsid-player/`). Playlist in `gta-c64/radio/stations.json`.
- Tests: `cd gta-c64 && npm install && npm test` (66 unit tests including a headless soak test, 25 Playwright
  browser tests). A CI workflow runs them on pull requests.
- Licence GPL-2.0-or-later. `gta-c64/README.md` describes the layout.

**2. Commodore 64 port (just started, the active work)**

- Repo: `mselin/Sleazeburg64` (this one). 6502 assembly in 64tass syntax.
- State: milestone 1a, a city viewer. Draws the city in multicolour character mode; a joystick in port 2 moves
  the view one tile at a time. No smooth scrolling, car, traffic or sound yet.
- The city comes from the same generator as the browser game (`tools/city.mjs`, checksum-checked).
- `make` builds `build/sleazeburg64.prg`; `make test` runs asset tests and a headless VICE run that saves
  screenshots.
- Read `README.md` and `docs/ROADMAP.md` first. The issues cover the roadmap.
- Memory: code from `$080d`, character set `$3800`, tile definitions `$4000`, map `$4500`. ROMs are banked out;
  the program does not call the KERNAL.

## What to do next

Start on the issue "1b: Smooth eight-way scrolling", then "1c: A car you can drive". These two decide whether
the port is practical. I also want the issue "Play the C64 version in a browser with a WebAssembly build of
VICE" looked into at some point: find which builds exist, their licence, and how they handle system ROMs.

### Let's still build two original SID tunes into the game

- Tunes in question:
- https://www.hvsc.c64.org/search?sid=139169 # Skate or Die intro
- https://www.hvsc.c64.org/search?sid=130260 # Nemesis the Warlock

Things to settle before doing it:

- **Rights.** Both are Rob Hubbard tunes published commercially (Electronic Arts, 1987; Martech, 1987). Putting
  them in this public repository or in a distributed `.prg` is redistribution. The browser game avoids that by
  streaming from HVSC and storing nothing. Decide how to handle this first: permission, keeping the tune files
  out of the repository and adding them at build time from a local copy, or something else.
- **Skate or Die (intro)** is an RSID tune that plays sampled sound. It takes over the machine's timing and
  most of the CPU while it plays, so it suits a title screen far better than gameplay.
- **Nemesis the Warlock** is an ordinary PSID tune and could play during the game, but it uses all three SID
  voices, so sound effects would have to interrupt a voice or wait.
- **Memory.** Each tune comes with its own player code at a fixed address (see the load, init and play
  addresses in its HVSC entry). Those addresses have to stay free in this program's memory map, or the tune has
  to be relocated.

## Setting up the environment

```bash
apt-get update && apt-get install -y 64tass vice xvfb
```

- Ubuntu's VICE package has no Commodore ROMs (copyrighted). `tools/emulator-test.sh` downloads the
  open-source MEGA65 Open ROMs into `.cache/` and runs `x64sc` under `xvfb-run` with `-autostartprgmode 1`.
  Do not commit ROMs.
- Emulator screenshots can be used to check graphics. An assistant cannot hear the SID or feel the controls,
  and should say so rather than guess.
- Network access may be restricted. HVSC hosts (`hvsc.c64.org`, `www.hvsc.c64.org`) and GitHub raw files were
  reachable in the previous session; other hosts may not be.

## How I like to work

- Work on a branch, open a pull request, and merge only when I say so (or when I have asked for "PR and merge
  when tests pass" for that task). Wait for CI to pass before merging.
- Report honestly: what was tested, what was not, and what could not be verified. Do not claim something works
  on real hardware or sounds right without it having been tried there.
- Lead with the result, keep it short, and flag decisions that are mine to make.
- Commit messages and pull request descriptions should explain what changed and why. No AI model names in
  commits or code.
- I own a C64 and a C128D and will test `.prg` files on real hardware. Target PAL.
- I care about security and tidy DevOps: CI on every repo, no secrets in repos, pinned or minimal dependencies.

## Open threads

- **Phone audio (browser game):** choppy on my Pixel 10 Pro with GrapheneOS. The likely cause is Vanadium
  running WebAssembly without JIT. The game now has an economy mode and a "SID player" load figure on its
  information page (press I). I have not yet reported what that figure shows on the phone.
- **Balance (browser game):** I am happy with the difficulty. Do not retune it unasked.
- **C64 status panel** is dark grey, not black, until the raster split issue is done.

## Don't

- Don't commit copyrighted SID tunes or Commodore ROMs to either repository without the rights question above
  being settled.
- Don't rename or rebrand the game after any existing commercial game.
- Don't push to `main` in either repo except through a merged pull request.
