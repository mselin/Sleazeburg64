# Handover: working state

The working state of whatever task is in hand, kept by the short-context workflow (`docs/HANDOVER-PROTOCOL.md`).
Rewrite sections in place; history belongs in git. The project's standing notes (the two games, the memory map,
the environment, the owner's working rules, open threads, don'ts) are in `docs/NOTES.md`; the plan is
`docs/ROADMAP.md`; the rules of the game are the browser game's `specs/design.md` in mselin/gta-c64. Working
agreements for every session are in `.claude/CLAUDE.md`. Never put secrets, tokens or anyone's private details
in it: it is committed and public.

## Task

"continue with implementation" (after #117): the difficulty, CLASSIC or MODERN (mselin/gta-c64#85; ROADMAP
under "Title screen" and the skaters under Pedestrians; Sleazeburg64#11). Design: "Difficulty" under "Title
screen and icon" in `specs/design.md` there; the skater under People on foot ("A skater stands side on ...").

## Plan

Two PRs: the riders by difficulty first (classic, the default, gets skaters), then the title page.

1. DONE (PR A). Riders by difficulty: `people.difficulty`, `rider_col`, `rider_spd` (in `tile_room3`: plain in
   the program file, so the title page can set them before unpacking). Skater 15 at 235 (46 px/s), scooter 13
   at 255. `src/people.asm` (new person, show), `src/pickups.asm` drop_io. Model `P.riders(d)`,
   `setDifficulty`. Check: `tests/e2e/riders.test.mjs` (was scooter.test) 6/6 pass.
2. DONE (PR A). Skater frames: `tools/assets.mjs` `skaterFrames` -> `build/skaters.bin`, in the program file at
   SCOOTER_FRAMES; `build/scooters.bin` kept for modern. Check: `tools/assets.test.mjs` 13/13 pass.
3. DONE (PR B). Title page (TITLE builds): its code moves out of `boot` to a fixed place before PACK_HOME (both
   build passes must have the same labels: `tools/build-game.sh` compares them; in the unpacked pass it can be
   `.virtual`), with the scooter riders' 320 bytes. The line "DIFFICULTY: CLASSIC - PRESS D" in a character
   row (tools/picture.mjs emits both words' bitmap cells), grey 12 / yellow 7 in the screen bytes' high nybble
   (colour 1); D (keyboard column 2, row 2) swaps it, copies the frames, sets the three bytes. Check:
   `tests/e2e/title-page.test.mjs` 3/3 (holds D five frames, D on, off, on; the frame drawn as D is pressed
   shows the old line whole).
4. Docs, HANDOVER; `make e2e`; PR; merge when green, each PR.

## Established

- **Where the rules come from.** The game's rules and look: `specs/design.md` in mselin/gta-c64, read as
  `git show origin/main:specs/design.md` (never changed from here: `.claude/CLAUDE.md`, "Stay in this
  repository"). Unclear or missing there: say so in an issue there. The two opened from here, mselin/gta-c64#108
  (officers' pace and arrest on foot) and #111 (the share of patrol cars), are answered by mselin/gta-c64#116
  (open on 27 November 2026): officers walk at 47 × PERSON and arrest within 7 × PERSON; patrols are 7 % of
  traffic. Check the C64 values against it once it merges.
- **"The design doc" in the protocol.** Its finishing step moves lasting decisions into the design doc, but
  sessions here may not change mselin/gta-c64's `specs/design.md` (`.claude/CLAUDE.md`). Here they go into
  `docs/ROADMAP.md` (how the C64 does it, where it differs) and `docs/NOTES.md` (memory, tools, threads); a
  design gap goes to an issue in mselin/gta-c64.
- **Merging.** Branch, pull request, merge commit once every check passes, without asking; behind `main`: merge
  `main` in and wait again (`.claude/CLAUDE.md`). CI: `.github/workflows/build.yml`, checks `build` and
  `All checks passed`.
- **Testing.** `make test` runs everything in VICE (x64sc) with JavaScript models held to the program frame by
  frame (`tests/e2e/play.mjs` `World`, `pass()`); about 25 minutes. Last full run: 153 pass, tools 25 pass.
- **Memory is the constraint.** The map of it, and what is left where, is in `docs/NOTES.md` ("Commodore 64
  port"). Since 27 November 2026, code that runs now and then lives under the I/O area (`$d000`-`$dfff`) and
  runs through `io_gate` (`src/main.asm`), interrupts off; the panel's messages are there too
  (`status.say` copies one out). Code run every frame must fit the small gaps (`HIGH_CODE`, tile rooms, the
  stack page, `low_code`).
- **Frame time.** One screen test (`tests/e2e/screen.test.mjs`, "whatever is on the screen not shown") fails
  with about 15 more cycles in every frame with no heat: keep such frames as they are.
- **Done on the roadmap** (see `docs/ROADMAP.md` for each): the city, scrolling, the car, the panel, traffic and
  the multiplexer, the player on foot, passers-by and scooter riders, water, Big Honk, pickups and drops, the
  knife and the gun, heat, the police (chase, siren and its sound, busted, officers on foot who shoot, the
  stolen police car, patrol cars, the pavement, the paint shop), hurt and wasted, the BUSTED and FLATLINED
  banners, the title page and the disk loader, the play page.
- **Not tried on real hardware:** everything C64 has run only in VICE. The owner tests on a C64 and a C128D.

## Changes

- PR B (branch `claude/confident-euler-70sqzi`): the title page's difficulty. `src/title-page.asm`
  (`.section title_code`, D, `turn`), `src/main.asm` (TITLE_HOME, PACK_ABOVE), `tools/picture.mjs` (`title()`,
  the line, the stash at `$c800`), `tests/e2e/vice.mjs` (`setRegisters`), `tests/e2e/title-page.test.mjs`;
  ROADMAP, NOTES.
- Merged #118, PR A: riders by difficulty, skaters on classic. `src/people.asm`,
  `src/pickups.asm`, `src/main.asm` (skaters.bin at SCOOTER_FRAMES), `tools/assets.mjs` (+test),
  `tests/e2e/riders.test.mjs` (renamed from scooter.test), `game.mjs` (`assets.riders`), `people-model.mjs`;
  ROADMAP (Pedestrians, Title screen), NOTES, README memory map.
- Merged #117 (d393de7): the slow push aside. Earlier: #116, #115.

## Verification

- Last full `make test` (PR 2, #114): 153 pass, tools 25 pass (28 November 2026).
- PR B: full `make test`: e2e 160/160 (after fixing disk.test, which compared the title page without its line), tools 26, emulator screenshots ok; the 16-car build; loader picture unchanged (cmp).
- Unverified anywhere: the C64 program on real hardware (owner's to try).


## Dead ends

- A store to `$00ff,x` is a zero-page store that wraps round in page 0: it overwrote the CPU port at start.
  Copying into the stack page needs `sta @w` (`src/main.asm`, `lay_down`).
- Code waiting after the map must end before `HIGH_CODE` with `car.init` included: once it did not, and copying
  the code up wrote over `car.init` before it ran (the check in `src/waiting.asm` now covers it).
- Writing the border black in every frame with no heat broke the timing-tight screen test (above).
- 64tass labels are case-insensitive: a constant and a label of the same letters clash (`GET_OUT`/`get_out`,
  `WINDOW`/`window`, `pace`, `down`, `px`). Macros' names clash with labels too (`put`, `gate`).
- The size check for the tile rooms names the table (0-6), not the room (1-6).
- `ARROW_FRAME` at `$2500` (after the passers-by's frames): that is their 21st, lying-down frame, and clearing
  it broke the picture tests. It is at `$0f40` now.
- `paint_near` ends in `arrow_round`, which uses X: the caller in `look_each` set X before the call and
  stored it after, so `turn` became $ff. It now loads X after the call.
- `status.digit` in `HIGH_CODE`: the build with sixteen cars (traffic tests) overflowed it by 18 bytes.
- Code under the I/O area must not call `crime` / `status.add_heat`: that is a second `io_gate`, whose
  return switches the I/O area back in under the caller, and the program hung. Use `status.heat_a`.
- No walls touch the roads (pavement between), and the car cannot be put within 8 px of the map's edge: the
  wall case of the push test is on the pavement by a building (330, 41), wall from y 48.
- The pickups tests ran someone over 10 px ahead of the car's middle, within the reach of their drop (11), so
  the car took it at once; they now hit them at 12 (`tests/e2e/pickups.test.mjs`, `runOver`).

## Next

Open PR B and merge when green. After the difficulty: driver assistance (modern only); jobs are blocked on mselin/gta-c64#117;
check the officers' values against gta-c64#116.


## Subagent files

None.
