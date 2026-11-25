# Handover: Sleazeburg 64 (browser game and Commodore 64 port)

A briefing for whoever picks this project up next, person or assistant. Written by the repository owner
(GitHub user `mselin`) in the first person. Read it fully before acting.

## The two games

**1. Browser game (finished, live, in maintenance)**

- Repo: `mselin/gta-c64` (until 20 November 2026 the `gta-c64/` folder of `mselin/mselin.github.io`, the
  homepage's repository; it moved with its history). Live at https://mselin.github.io/gta-c64/, published by
  its own CI.
- A top-down crime satire styled as a C64 game. Original game, not a recreation of any existing one: keep it
  that way.
- Plain ES modules under `js/`, no build step, published with GitHub Pages after CI passes on `main`.
- Radio streams SID tunes from HVSC (https://www.hvsc.c64.org), played by USBSID-Player (WebAssembly,
  GPL-2.0-or-later, vendored in `usbsid-player/`). Playlist in `radio/stations.json`.
- Tests: `npm install && npm test` (66 unit tests including a headless soak test, 25 Playwright
  browser tests). A CI workflow runs them on pull requests.
- Licence GPL-2.0-or-later. Its `README.md` describes the layout, and `specs/design.md` the game's rules and look.

**2. Commodore 64 port (just started, the active work)**

- Repo: `mselin/Sleazeburg64` (this one). 6502 assembly in 64tass syntax.
- State: milestone 2 under way: traffic, the player on foot, Big Honk. The city in multicolour characters,
  scrolled smoothly to follow a car driven with a joystick in port 2, with the browser game's handling and
  collisions with buildings and trees. Up to six traffic cars follow the lanes and stop for what is in front
  of them, shown with a sprite multiplexer; the player's car bounces off them and wrecks one it hits hard.
  The player can get out, walk and swim, and get into any car, a passing one included. A raster split keeps
  the panel still on black. Big Honk, the goose crime boss from the new logos, wanders The Moat as a
  multicolour sprite, and a car that runs into him only makes him flap and run off. There are no other
  people and no sound yet. None of it has been tried on real hardware.
- The city comes from the same generator as the browser game (`tools/city.mjs`, checksum-checked).
- `make` builds `build/sleazeburg64.prg`; `make test` runs asset tests and a headless VICE run that saves
  screenshots. `make music` and `make test-music` do the same for the music test builds.
- CI (`.github/workflows/build.yml`) runs `make test` on every pull request and every push to `main`, and on
  `main` then publishes the tested `.prg` and `site/index.html` with GitHub Pages (the repository's Pages
  source is "GitHub Actions"). That `pages` job is the only thing that deploys the site: don't add another
  Pages workflow, such as GitHub's suggested Jekyll one, because two deploys race and the other lacks the
  built `.prg`. Its deploy step gets three tries, with a wait between them: GitHub's deploy action sometimes
  cannot find the page it was handed a moment before, and finds it a little later (seen on 21 November 2026
  in both repositories). The workflow's actions are pinned to release commits, kept up to date by Dependabot,
  the same way as in the browser game's repository. Branch protection should require the one check "All checks
  passed", so jobs can be added or renamed without changing the repository settings.
- `make test` also runs end-to-end tests (`tests/e2e/`) that drive the program in VICE through its binary
  monitor: joystick in, memory out, one frame at a time. Add to them with every feature.
- Read `README.md` and `docs/ROADMAP.md` first. The issues cover the roadmap.
- Memory: see the table in the README. ROMs are banked out; the program does not call the KERNAL. Three
  raster interrupts a frame (lines 213, 221 and 250); `src/irq.asm` explains the split.
- Build options: `VIEWER=1` has no car and no traffic and lets the stick move the view, as in 1b (the
  scrolling tests use it); `CARS` sets how many traffic cars (6); `SPAWN=0` stops traffic appearing by
  itself, for tests that place their own; `HONK=0` leaves Big Honk out (the car tests use it).
- Frame budget: with traffic, the tests' drives are done at worst 235 raster lines after the bottom
  interrupt with the car flat out, 266 with a tune too, of 312; the tests fail if any frame is late in
  their drives. A frame that moves the screen a character and the one after it, which works out colour
  memory, are the busy ones. Anything new that runs every frame has to fit in what is left, or move work out
  of those frames: traffic only moves its cars in a colour memory frame, and Big Honk stands still in a frame
  that moves the screen. Five cars and four passers-by is what fits (six cars before the passers-by).
  - Measured on the traffic tests' long random drive (2026-11-21, with the player on foot's code in): a frame
    that moves the screen is done at worst 306 lines after the bottom interrupt, a colour memory frame 290,
    and any other frame under 180. The late-frame checks catch it when something new does not fit.
  - Where the busiest frame's time goes: moving the screen about 145 lines, the car up to 100 on a rough
    drive (35 flat out in a straight line), the traffic 15 and then up to 25 more for deciding, looking ahead
    and new cars, the sprites 10. In the car's 100, steering takes up to 28 when the car's picture turns a
    step, which is when it looks whether the turn would put it into a wall. Those are the places to look for
    time.
  - Steering held to the grip (`car.hold_turn`) costs about 85-130 cycles a turning frame, and nothing at full
    grip below 52 sixteenths of a pixel a frame, where it cannot hold.
  - What made room for the passers-by (21 November 2026): one traffic car fewer (the owner's choice); the 3 by 3
    tiles round the car's middle surveyed once a tile and kept (`car.survey`), so the car's wall test and the
    water's look are next to free on open streets away from water; in a frame of colour memory a turn that would
    turn the car's picture a step waits a frame (it is when that turn has to be looked at); the status panel
    writes a new colour a frame after the new text; and the passers-by move only in a frame that neither moves
    the screen nor works out colour memory. With them, the long drive with traffic has its busiest frame ready
    310 lines after the bottom interrupt, of 312: the busiest frames still have almost no time left.
  - The speed-up pass (22 November 2026), all of it exact (the models did not change): the car's sine, cosine
    and multiplication tables are set only when its direction changes; update uses again the forward speed
    steer worked out when the turn leaves the direction as it was; the drag's and grip's shifts take two or
    three steps; nothing is multiplied by 0; and `car.lead` looks at a point's tiles only if its edge leaves
    its tile in the move (where it is in the tile, plus the move, says so). And the screen copy is made partly
    ahead (`video.ahead`): after `frame.publish`, a frame with time left guesses whether the next pass will
    cross a character, and which way, from where the car's speed (a little more, and either way when it is
    slow) takes the window, and copies as many columns of that as the raster says there is time for (6 lines
    a column is allowed 8, done by line 228) onto the screen not shown, carrying on over frames; the pass that
    crosses does only the rest (`pre_way`, `pre_next`), or the whole copy if it crosses some other way. The
    copy routines stop at a column given each run (`cpx`) for that, 2 bytes and 2 cycles a column more. A
    wrong guess costs only time a frame had spare. On the long drive with traffic (without jaywalking), the
    pass that was 25 lines late is in time, and the busiest frame is ready 299 lines after the bottom
    interrupt (13 to spare): a colour memory frame with the car moving by walls. Where a frame's time goes in
    the visible part of the screen, a cycle of work takes about 1.5 cycles, with the video chip's bad lines,
    the sprites' fetches and the multiplexer's interrupts.
  - The passers-by (25 November 2026): each walks every other frame (half of them a frame, by turns), two
    frames' worth at a time, and knows whether they are on a road from their last step, as a walk with the
    car test came to about 25 lines each. With four of them, jaywalking and cars solid for them, the long
    drive with traffic has no late frame and its busiest is ready 293 lines after the bottom interrupt.
  - The status panel (`src/status.asm`) writes only what changed, and only in a frame that does not move the
    screen: row 3 about 8 lines, 16 when its colour changes, and row 1 whole about 25, which also waits for a
    frame with no colour memory. The city viewer keeps the old readout (`src/panel.asm`, `src/digits.asm`).
- Room is short everywhere, and where things are is decided by what the video chip must see:
  - Below the screens (`$0d80`-`$1fff`, after the car's and the pickups' sprites) there are about 130 bytes of
    code left (the car's wall test moved to `MORE_CODE` for the pickups, and the car's sine table keeps only
    its low bytes: `car.sine` makes the high one). From `$2540` to the screens
    are the player on foot's sprite (`src/frames.asm`): two buffers, then from `$2600` the twelve frames the
    program file holds, the tables and code that make the other 30 (mirror images) into a buffer when the
    picture turns to one, and then code (the section `low_more`: what people drop, `src/pickups.asm`) with about 850 bytes free. Making one costs about
    30 raster lines, so it is done only in a frame with no colour memory and no screen copy; in another the
    picture stays as it was a frame longer. To leave time for that in the busiest pass, getting out of the car
    no longer works out the car's frame first (25 November 2026).
  - Four blocks of code are copied up at start. `EXTRA_CODE` (`$e000`-`$f2ff`, under the KERNAL ROM, which is
    switched out) took the status panel and the steering limit on 21 November 2026, when the owner chose to
    give the game the room the in-game test tune had, then drawing the city (`src/video.asm`, which left room
    for the passers-by's frames at `$2000`) and the passers-by: about 250 bytes are left there (the
    steering limit and grip moved to `TOP_CODE` when jaywalking came in). `HIGH_CODE`
    (`$aef2`-`$bbff`, right after the colour routines: Big Honk, the player on foot, the passers-by's test for a car in their way, their arriving, punches and running) has about 330 left
    since the colour routines were packed end to end (25 November 2026: each had had room for the longest,
    and the one after the map 600 bytes more);
    `MORE_CODE` (`$c8e0`-`$cfff`, after the screen copies: the water, and the screen copy's helpers and
    variables, and more of the passers-by's car test) about 1180, since the screen copies were halved
    (25 November 2026: nine, one for each way, from screen A to B, each turned round in place, 42 high
    bytes 4 pages either way, when it is next used the other way round, about 950 cycles; measured, the
    tightest scrolling frame went from 55 to 51 lines spare driving and from 64 to 45 on foot, flat out from
    86 to 68); `TOP_CODE` (`$f300`-`$fff9`:
    the traffic, the car's grip and steering limit) about 100; and below the screens, up to the passers-by's frames at `$2000`, about 220
    (`car.init`, which makes the multiplication tables, runs once from where it waits in the program file, as
    `src/frames.asm` does).
    All four are assembled with `.logical` and wait after the map in the program file; start copies them up
    before `video.init` writes the colour routines over where they waited.
    `src/frames.asm` and the twelve frames it reads wait there too and run once from there.
  - Zero page is full: it is used up to `$d7`, and up to `$df` in the city viewer's music build, whose tune
    has `$e0` on.
    New variables go in the panel screen's rows 0-20 (`$0400`-`$0747`, `.section bss`), which the video chip
    never shows and `video.init` clears: about 270 bytes are left there, 6 in a build with sixteen cars
    (which is why the status panel's money, heat, health and ammo are kept with its code, at `EXTRA_CODE`).
  - The program file is packed (the owner's choice, with `$e000`): `tools/build-game.sh` assembles the game,
    packs what waits after the tiles (`src/waiting.asm`: the map, the code start copies up, the player's
    frames) with `tools/pack.mjs`, an LZ of literal runs and copies, and assembles it again with
    `PACKED=1`, where that part is assembled only for its labels and the packed bytes take its place. Both
    builds must put everything in the same place, which the script and the tests' `assemble` check: so the
    unpacker is assembled in both, and called only in the packed one. At start it moves the packed bytes to
    just past where they unpack to (`PACK_HOME`) and unpacks them from `city_map` up, in about half a second;
    while it does, all of memory is RAM, as the packed copy can reach into the I/O area's (up to `$e000`).
    The game file went from 33K to 25K (28K with the passers-by),
    and the music title build, which carries it, from 45K to 39K, well below the `$d000` it must LOAD under.
    The tests build the game packed too (`tests/e2e/game.mjs`), and `tests/e2e/pack.test.mjs` checks the
    unpacking byte for byte.
- Sprite data must be where the video chip can see it, in the first 16K and not `$1000`-`$1fff`. Big Honk's
  eight frames are in the character set's characters 184-247 (`$3dc0`), after the tile characters, which
  `tools/assets.mjs` checks; there is no more room there for tiles without moving him. The player on foot's
  frames took the place of code, which moved up (see above); more sprites (police, people, an arm held out)
  will need more code moved the same way, or fewer frames.
- Bit 7 of a colour listed with `sprites.add`, or of sprite 0's (`frame.next_sc`), makes that sprite
  multicolour. All multicolour sprites share black and yellow (`foot.init` sets them), so a police officer's
  light blue, or skin, has to be a sprite's own colour.
- Getting in and out is one press of fire with the stick centred (`src/foot.asm` has the rule). That is my
  decision to confirm or change: the browser game has a key for it, and a C64 joystick has one button. It
  leaves fire with a direction, and fire held, free for the handbrake now and for fists and weapons later,
  but standing still by a car it will always mean "get in".
- Sprites cannot be cut off part way down: switching one off only stops it starting, so a sprite carries on
  over the black band and the panel, and its fetches take cycles the split's timed writes need. So traffic is
  only shown while all of its sprite is above the band.
- 64tass counts anonymous labels (`+`, `-`) in the branch of an `.if`/`.else` that is not assembled. Don't let
  an anonymous branch cross an `.else`; use named labels (a macro called with a label has its own scope).
- The end-to-end tests compare VICE's actual picture with a model pixel by pixel, which is how the timing of
  the split was got right. Keep that for anything that draws.

## What to do next

Milestone 1 (smooth scrolling, the raster split and the car) is done in the emulator. It decides whether the
port is practical, so trying it on the C64 and the C128D is still mine to do. Milestone 2 has started with
traffic, the sprite multiplexer and the player's car running into traffic. Next: the player on foot, and
getting in and out of cars. Sprites steal cycles on the lines they are on, so the split's timed writes and the
frame budget need checking as sprites are added: the pixel tests and the late-frame tests show both. The
issue "Play the C64 version in a browser with a WebAssembly build of VICE" is done in its first form:
VirtualC64 Web runs the program correctly, and CI publishes the tested program and a play page with GitHub
Pages after every merge to `main`, at
<https://mselin.github.io/Sleazeburg64/>; I have played it from there, on VirtualC64 Web's Open ROMs. See
`docs/BROWSER.md`.

### The two SID tunes: in test builds only

Decided: the two Rob Hubbard tunes are used in **test builds**, not in the published program.

- *Skate or Die (intro)*, 1987 Electronic Arts (https://www.hvsc.c64.org/search?sid=139169), on the title
  screen. *Nemesis the Warlock*, 1987 Martech (https://www.hvsc.c64.org/search?sid=130260), in the game until
  21 November 2026, when the game took `$e000`-`$f2ff`, where it plays from, for code (the owner's choice, to
  make room for pedestrians). The end-to-end tests still build a made-up tune into the city viewer.
- `make music` builds them; `make test-music` runs them in the emulator. See the README and `music/README.md`.
- **Rights.** The tune files are fetched from HVSC into `.cache/` at build time and are never committed. The
  programs built with them are for my own machines and are not published; CI does not build them. Title,
  author and copyright are kept for every tune, both in `music/tunes.json` and on screen. The same goes for
  any tune that is ever stored in the repository as an asset.
- **Skate or Die (intro)** is an RSID tune with sampled sound. It takes over the interrupts and loads at
  `$1000`–`$5150`, right across the game, so the title screen is a separate program (`src/title.asm`) that
  moves the game into place on fire.
- **Nemesis the Warlock** is an ordinary PSID tune at `$e000`, called once a frame, about 27 raster lines at
  worst. It uses all three SID voices. The game no longer has room for it (above); a tune in the game again
  would need a smaller one, somewhere else, and frame time the game no longer has.
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
- **The player's car at the south edge of the city:** within a few pixels of it, the car's sprite can reach
  below the city, over the black band (see the note on sprites above). Found while adding traffic; not fixed
  yet. The test that meant to check it never puts the car low enough. The player on foot does not have this:
  they stop 11 pixels short of the south edge, which is what the car needs too.
- **Getting in and out with one button (C64):** fire with the stick centred. Mine to try and to confirm or
  change; see "Commodore 64 port" above.
- **The walk (C64):** the player's legs follow the browser game's nine steps a second, a new pose almost every
  frame. Whether that reads as walking or as a blur on a real screen is for me to see.

## Don't

- Don't commit copyrighted SID tunes or Commodore ROMs to either repository, and don't publish a program or
  recording that contains the tunes (`build/sleazeburg64-music.prg`, `build/sleazeburg64-ingame.prg`,
  `build/sound-*.wav`), or anything that contains the Commodore ROMs (CI's artifacts hold only this program,
  screenshots and logs).
- Don't rename or rebrand the game after any existing commercial game.
- Don't push to `main` in either repo except through a merged pull request.
