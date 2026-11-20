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
- State: milestone 1c, a car you can drive. The city in multicolour characters, scrolled smoothly to follow
  a car driven with a joystick in port 2, with the browser game's handling and collisions with buildings and
  trees. A raster split keeps the panel still on black. No traffic, people or sound yet. None of it has been
  tried on real hardware.
- The city comes from the same generator as the browser game (`tools/city.mjs`, checksum-checked).
- `make` builds `build/sleazeburg64.prg`; `make test` runs asset tests and a headless VICE run that saves
  screenshots. `make music` and `make test-music` do the same for the music test builds.
- CI (`.github/workflows/build.yml`) runs `make test` on every pull request and every push to `main`. Its
  actions are pinned to release commits, kept up to date by Dependabot, the same way as in the browser game's
  repository. Branch protection should require the one check "All checks passed", so jobs can be added or
  renamed without changing the repository settings.
- `make test` also runs end-to-end tests (`tests/e2e/`) that drive the program in VICE through its binary
  monitor: joystick in, memory out, one frame at a time. Add to them with every feature.
- Read `README.md` and `docs/ROADMAP.md` first. The issues cover the roadmap.
- Memory: see the table in the README. ROMs are banked out; the program does not call the KERNAL. Three
  raster interrupts a frame (lines 213, 221 and 250); `src/irq.asm` explains the split.
- Build option `VIEWER=1` has no car and lets the stick move the view, as in 1b. The scrolling tests use it.
- Frame budget: the busiest frame (colour memory after a screen swap, plus the car, plus a tune) is done 273
  raster lines after the bottom interrupt, of 312. The tests fail if any frame is late. Anything new that
  runs every frame has to fit in what is left, or move work out of that frame.
- The end-to-end tests compare VICE's actual picture with a model pixel by pixel, which is how the timing of
  the split was got right. Keep that for anything that draws.

## What to do next

Milestone 1 (smooth scrolling, the raster split and the car) is done in the emulator. It decides whether the
port is practical, so the next step is mine: try it on the C64 and the C128D. After that, milestone 2,
starting with traffic and a sprite multiplexer, which is the next hardest part. Sprites steal cycles on the
lines they are on, so the split's timed writes and the frame budget need checking as sprites are added: the
pixel tests and the late-frame tests show both. The issue "Play the C64 version in a browser with a WebAssembly
build of VICE" has been researched: see `docs/BROWSER.md`. It recommends VirtualC64 Web on the Open ROMs
rather than VICE, and the first step is mine: trying the program in it.

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

- Ubuntu's VICE package has no Commodore ROMs (copyrighted). The tests fetch the C64 ones into `.cache/`
  from the VICE project's own repository (https://github.com/VICE-Team/svn-mirror) at a fixed commit and
  check their SHA-256 (`tools/vice-lib.sh`,
  `tests/e2e/vice.mjs`), and run `x64sc` under `xvfb-run`. `VICE_ROMS=open` uses the MEGA65 Open ROMs
  instead. Do not commit ROMs.
- Emulator screenshots can be used to check graphics. An assistant cannot hear the SID or feel the controls,
  and should say so rather than guess.
- Network access may be restricted. The cloud environment allows the HVSC hosts (`hvsc.c64.org`,
  `www.hvsc.c64.org`, needed by `make music`) and `mselin.github.io`, and its setup script installs the
  packages above. GitHub raw files were reachable too; other hosts may not be.

## How I like to work

- Work on a branch and open a pull request. An assistant may merge its own pull request without asking once
  CI has passed on its latest commit. The exceptions, where it says so in the pull request and waits for me:
  a change that can only be judged by eye, ear or on real hardware (how something sounds, feels or looks on
  a real machine), a decision that is mine to make, and anything touching rights or licences.
- Every change comes with tests that would catch it breaking. For the C64 program that means the end-to-end
  tests in `tests/e2e/`, which run it in VICE. A pull request that weakens, skips or deletes a test to get
  CI green is not mergeable without me.
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
- **2026-11-19.** Merging used to wait for my word every time. Changed at my request, now that end-to-end
  tests run in CI: an assistant may merge its own pull request once CI is green, with the exceptions listed
  under "How I like to work".
- **2026-11-20.** The tests used the open-source Open ROMs because the Commodore ones are copyrighted. At
  my request they now fetch the Commodore C64 ROMs at test time, from the VICE project's own repository (the
  same files as in asig/vice-roms, which I suggested first). They stay out of both
  repositories and are never published; a page playing the game in a browser would still use the Open ROMs.

## Open threads

- **Phone audio (browser game):** choppy on my Pixel 10 Pro with GrapheneOS. The likely cause is Vanadium
  running WebAssembly without JIT. The game now has an economy mode and a "SID player" load figure on its
  information page (press I). I have not yet reported what that figure shows on the phone.
- **Balance (browser game):** I am happy with the difficulty. Do not retune it unasked.
- **C64 on real hardware:** the smooth scrolling and the split have only run in VICE (x64sc, cycle exact). I
  have not yet tried them on my C64 and C128D.

## Don't

- Don't commit copyrighted SID tunes or Commodore ROMs to either repository, and don't publish a program or
  recording that contains the tunes (`build/sleazeburg64-music.prg`, `build/sleazeburg64-ingame.prg`,
  `build/sound-*.wav`), or anything that contains the Commodore ROMs (CI's artifacts hold only this program,
  screenshots and logs).
- Don't rename or rebrand the game after any existing commercial game.
- Don't push to `main` in either repo except through a merged pull request.
