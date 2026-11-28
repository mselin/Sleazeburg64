# Handover: working state

The working state of whatever task is in hand, kept by the short-context workflow (`docs/HANDOVER-PROTOCOL.md`).
Rewrite sections in place; history belongs in git. The project's standing notes (the two games, the memory map,
the environment, the owner's working rules, open threads, don'ts) are in `docs/NOTES.md`; the plan is
`docs/ROADMAP.md`; the rules of the game are the browser game's `specs/design.md` in mselin/gta-c64. Working
agreements for every session are in `.claude/CLAUDE.md`. Never put secrets, tokens or anyone's private details
in it: it is committed and public.

## Task

"continue with implementation" (after #119): cursed driver assistance, modern only (Sleazeburg64#61; ROADMAP
"Cursed driver assistance (#61)", which already plans the C64 way). Design: "Cursed driver assistance" in
`specs/design.md` in mselin/gta-c64, and "Difficulty" (going to classic, every car loses its assistance).

## Plan

Room first (the owner's choice, 28 November 2026, asked when it did not fit): about 240 bytes are free, in a
dozen small gaps (io_code 19, io_more 19, texts 56, HIGH_CODE 28 to `$be00`, EXTRA 23, MORE 8, TOP 4, bss 7,
stack page about 75); anti-theft alone needs about 190.

0. PR R, two colour routines in place of four: measured and shelved (the owner's choice, 28 November 2026):
   about 20 raster lines more in the worst frame, 3 late frames on the long drive with traffic. Status: done.

Then three PRs, each merged when green:

1. PR C (anti-theft first, the owner's choice). Which cars (three bits a car, from `rnd` as it appears, modern only; never the hospital car; a police car
   always has anti-theft and never the other two, by the design now, not the ROADMAP) and anti-theft: the time while
   driving, stopped for good, the two messages, the bits travelling with the car. Check: a test where a car
   with anti-theft stops after its time and will not go again. Status: merged (#120).
2. PR D. Lane assist. Check: a test of the swerve and its message. Status: code and tests done
   (`tests/e2e/assist.test.mjs`, 4 pass; both builds fit); full `make test` and the PR next.
3. PR E. Emergency braking. Check: tests stopping for a person and a car.
(The alarm's sound waits for sound, milestone 4; its lights flash the car's sprite yellow.)
Difficulty done: #118 (riders), #119 (title page, D).

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

- PR D (branch, not merged): lane assist. `TILE_ROOM` 96 (`src/main.asm`, `tools/assets.mjs` + test);
  `src/car.asm` (`wait`/`swerve`/`pull`; `anti` goes to `lane` for bit 7 and lane comes back to `a_back`;
  `lane` in pieces over rooms 1, 2, 4, 5, 6; `update` starts `turn` from `pull`, $40/$c0), `src/police.asm` (`fit`: bit 7), `src/foot.asm` (`park` clears it, `got`
  masks), `src/status.asm` (MSG_LANE in room 1); models car (`lane`), traffic (roll; `Rnd.carry`), foot,
  `play.mjs` (reads wait/swerve/pull); `tests/e2e/assist.test.mjs`; ROADMAP, NOTES.
- Merged #120, PR C: anti-theft (`car.anti`, `police.fit`, `traffic.assist`, `foot.park`/`got`).
- Merged #119, PR B: the title page's difficulty. `src/title-page.asm`
  (`.section title_code`, D, `turn`), `src/main.asm` (TITLE_HOME, PACK_ABOVE), `tools/picture.mjs` (`title()`,
  the line, the stash at `$c800`), `tests/e2e/vice.mjs` (`setRegisters`), `tests/e2e/title-page.test.mjs`;
  ROADMAP, NOTES.
- Merged #118, PR A: riders by difficulty, skaters on classic. `src/people.asm`,
  `src/pickups.asm`, `src/main.asm` (skaters.bin at SCOOTER_FRAMES), `tools/assets.mjs` (+test),
  `tests/e2e/riders.test.mjs` (renamed from scooter.test), `game.mjs` (`assets.riders`), `people-model.mjs`;
  ROADMAP (Pedestrians, Title screen), NOTES, README memory map.
- Merged #117 (d393de7): the slow push aside. Earlier: #116, #115.

## Verification

- Last full `make test` (PR 2, #114): 153 pass, tools 25 pass (28 November 2026). PR D's first run: 163/164, the long traffic drive's frame 355 late (lane assist's 27 cycles a frame; main had 17 to spare there). Fixed (no cost without assist). Second full run: e2e 164/164, tools 26, but the autopilot screenshot build ran 13 bytes into the passers-by's frames (`low_code`); `l_hold` moved to room 6: screenshots ok, assist + traffic + car tests 37/37.
- PR B: full `make test`: e2e 160/160 (after fixing disk.test, which compared the title page without its line), tools 26, emulator screenshots ok; the 16-car build; loader picture unchanged (cmp).
- Unverified anywhere: the C64 program on real hardware (owner's to try).


## Dead ends

- Two colour routines (3c1fa91): 20 raster lines too slow, 3 late frames. Do not retry for room.
- `low_code` holds only about 6 bytes in the default build and fewer in the autopilot one (`tools/emulator-test.sh`, last step of `make test`): do not put code there.
- Lane assist as a detour in every frame (`wheel` round steer, `lane` round anti): 27 cycles, a late frame.
- `TOP` really has 4 bytes (a 400-byte fill test overflowed it); zero page is full to `$df`. Branches cannot
  cross between sections in different rooms: glue pieces with `jmp`.

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

Full `make test` for PR D, open the PR (refs #61), merge when green. Then PR E (emergency braking): room in
NOTES (rooms 5-32 bytes; room 6 1); time is the harder part: the long traffic drive's frame 355 has about 13 cycles left
(NOTES, frame budget), so emergency braking must cost nothing in a car without it, as lane assist does.

## Subagent files

None.
