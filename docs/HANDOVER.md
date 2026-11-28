# Handover: working state

The working state of whatever task is in hand, kept by the short-context workflow (`docs/HANDOVER-PROTOCOL.md`).
Rewrite sections in place; history belongs in git. The project's standing notes (the two games, the memory map,
the environment, the owner's working rules, open threads, don'ts) are in `docs/NOTES.md`; the plan is
`docs/ROADMAP.md`; the rules of the game are the browser game's `specs/design.md` in mselin/gta-c64. Working
agreements for every session are in `.claude/CLAUDE.md`. Never put secrets, tokens or anyone's private details
in it: it is committed and public.

## Task

"merge when green, then continue": the next roadmap item, running over by the car's whole body and a slow
car pushing people aside (mselin/gta-c64#110; ROADMAP, Pedestrians; Sleazeburg64#6; `specs/design.md` there,
"Running over" and "Cars are solid").


## Plan

1. Study the C64 run-over (`src/people.asm` `hunting`, `struck`, `beside`, `within`, `under`, `in_body`) and the
   design's rules. Done.
2. Whole-body run-over: someone's shoulders (2.5 px) touching the player's car's turned body (its length and
   width, corners included), at RUN_OVER or more; the same body test for a fast car hurting the player.
   Check: people tests pass with a new test at several turns. Done for the player's car running people over
   (#115, merged); the traffic hurting the player by its body (this PR, `police.hits`): done.
3. Push-aside below RUN_OVER: out to the nearer side, just clear; the other side if a wall or car is there;
   else knocked down (a crime for the player's car only); Big Honk only ruffled. Check: new tests pass.
4. Models (`tests/e2e/people-model.mjs`), ROADMAP, NOTES; `make test`; PR; merge when green.


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

- Sleazeburg64, branch `claude/confident-euler-70sqzi` (new PR): traffic hurts the player on foot by its body,
  12 along and 7 across, by the axis it faces nearer (`src/police.asm` `hits`, `HURT_LONG`/`HURT_SHORT`;
  `police.gate_shoot` moved to `police_extra` for room); `tests/e2e/play.mjs` `hits()`; a new test in
  `tests/e2e/police.test.mjs` ("a car hurts the player on foot by its body").
- Recent merged work: #115 the whole-body run-over; #114 the paint shop arrow and S; #113 the P marker.


## Verification

- Last full `make test` (PR 2, #114): 153 pass, tools 25 pass (28 November 2026).
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
- The pickups tests ran someone over 10 px ahead of the car's middle, within the reach of their drop (11), so
  the car took it at once; they now hit them at 12 (`tests/e2e/pickups.test.mjs`, `runOver`).

## Next

Wait for CI on the PR for the traffic's body hurting the player, merge when green. Then plan step 3, the push
aside below RUN_OVER (design: "Cars are solid for anyone on foot").


## Subagent files

None.
