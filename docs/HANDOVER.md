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
  screenshots. `make music` and `make test-music` do the same for the music test builds.
- Read `README.md` and `docs/ROADMAP.md` first. The issues cover the roadmap.
- Memory: code from `$080d`, character set `$3800`, tile definitions `$4000`, map `$4500`. ROMs are banked out;
  the program does not call the KERNAL.

## What to do next

Start on the issue "1b: Smooth eight-way scrolling", then "1c: A car you can drive". These two decide whether
the port is practical. I also want the issue "Play the C64 version in a browser with a WebAssembly build of
VICE" looked into at some point: find which builds exist, their licence, and how they handle system ROMs.

### The two SID tunes: in test builds only

Decided: the two Rob Hubbard tunes are used in **test builds**, not in the published program.

- *Skate or Die (intro)*, 1987 Electronic Arts (https://www.hvsc.c64.org/search?sid=139169), on the title
  screen. *Nemesis the Warlock*, 1987 Martech (https://www.hvsc.c64.org/search?sid=130260), in the game.
- `make music` builds them; `make test-music` runs them in the emulator. See the README and `music/README.md`.
- **Rights.** The tune files are fetched from HVSC into `.cache/` at build time and are never committed. The
  programs built with them are for my own machines and are not published; CI does not build them. Title,
  author and copyright are kept for every tune, both in `music/tunes.json` and on screen. The same goes for
  any tune that is ever stored in the repository as an asset.
- **Skate or Die (intro)** is an RSID tune with sampled sound. It takes over the interrupts and loads at
  `$1000`–`$5150`, right across the game, so the title screen is a separate program (`src/title.asm`) that
  moves the game into place on fire.
- **Nemesis the Warlock** is an ordinary PSID tune at `$e000`, called once a frame, about 27 raster lines at
  worst. It uses all three SID voices, so sound effects will have to interrupt a voice or wait. It is called
  from the main loop for now and should move to the raster interrupt once there is one.
- **Not yet heard by anyone.** The emulator test only shows that both tunes produce sound. How they sound,
  and how the sampled drums in the title tune come out on a real 6581, is for me to check on hardware.

## Setting up the environment

```bash
apt-get update && apt-get install -y 64tass vice xvfb
```

- Ubuntu's VICE package has no Commodore ROMs (copyrighted). `tools/emulator-test.sh` downloads the
  open-source MEGA65 Open ROMs into `.cache/` and runs `x64sc` under `xvfb-run` with `-autostartprgmode 1`.
  Do not commit ROMs.
- Emulator screenshots can be used to check graphics. An assistant cannot hear the SID or feel the controls,
  and should say so rather than guess.
- Network access may be restricted. The cloud environment allows the HVSC hosts (`hvsc.c64.org`,
  `www.hvsc.c64.org`, needed by `make music`) and `mselin.github.io`, and its setup script installs the
  packages above. GitHub raw files were reachable too; other hosts may not be.

## How I like to work

- Work on a branch, open a pull request, and merge only when I say so (or when I have asked for "PR and merge
  when tests pass" for that task). Wait for CI to pass before merging.
- Report honestly: what was tested, what was not, and what could not be verified. Do not claim something works
  on real hardware or sounds right without it having been tried there.
- Lead with the result, keep it short, and flag decisions that are mine to make.
- Commit messages and pull request descriptions should explain what changed and why. A commit an assistant
  helped with ends with a `Co-Authored-By:` line that names the model. That line is the only place for it: no
  AI model names in the rest of the message, in pull request descriptions, or in code.
- I own a C64 and a C128D and will test `.prg` files on real hardware. Target PAL.
- I care about security and tidy DevOps: CI on every repo, no secrets in repos, pinned or minimal dependencies.

## Changes to these rules

- **2026-11-19.** The commit rule used to say "No AI model names in commits or code". Changed at my request:
  the `Co-Authored-By:` line of a commit now names the model, and the ban covers everything else.

## Open threads

- **Phone audio (browser game):** choppy on my Pixel 10 Pro with GrapheneOS. The likely cause is Vanadium
  running WebAssembly without JIT. The game now has an economy mode and a "SID player" load figure on its
  information page (press I). I have not yet reported what that figure shows on the phone.
- **Balance (browser game):** I am happy with the difficulty. Do not retune it unasked.
- **C64 status panel** is dark grey, not black, until the raster split issue is done.

## Don't

- Don't commit copyrighted SID tunes or Commodore ROMs to either repository, and don't publish a program or
  recording that contains the tunes (`build/sleazeburg64-music.prg`, `build/sleazeburg64-ingame.prg`,
  `build/sound-*.wav`).
- Don't rename or rebrand the game after any existing commercial game.
- Don't push to `main` in either repo except through a merged pull request.
