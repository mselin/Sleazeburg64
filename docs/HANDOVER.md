# Handover: working state

The working state of whatever task is in hand, kept by the short-context workflow (`docs/HANDOVER-PROTOCOL.md`).
Rewrite sections in place; history belongs in git. The project's standing notes (the two games, the memory map,
the environment, the owner's working rules, open threads, don'ts) are in `docs/NOTES.md`; the plan is
`docs/ROADMAP.md`; the rules of the game are the browser game's `specs/design.md` in mselin/gta-c64. Working
agreements for every session are in `.claude/CLAUDE.md`. Never put secrets, tokens or anyone's private details
in it: it is committed and public.

## Task

"merge when green, then continue": the next roadmap item, the paint shop's P on the map and the arrow to it
with heat (ROADMAP, the paint shop; `specs/design.md` there, "The paint shop", and `js/render.js` `marker`,
`edgeArrow`, `drawWorld`).

## Plan

1. Room for the P (PR 1): what a pickup does when taken moved under the I/O area. Done.
2. The P marker: mselin/Sleazeburg64#113, merged 28 November 2026. Done.
3. The arrow and the S (PR 2): `pickups.arrow_round` (once a round, from `paint_near`), `show_arrow`, the 16
   ways copied into `ARROW_FRAME` ($0f40) by `arrow_copy` (I/O area), hooks `paint_skip`/`paint_hook`/
   `paint_tail`; model `arrowRound` in `tests/e2e/pickups-model.mjs`; test "with heat, at the wheel ...".
   Done in the working tree; pickups tests pass. Check: `make test` passes.
4. PR 2: mselin/Sleazeburg64#114, opened 28 November 2026; merge when green. Check: merged on GitHub.

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
  frame (`tests/e2e/play.mjs` `World`, `pass()`); about 25 minutes. Last full run: 151 pass, tools 25 pass.
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

- Sleazeburg64, branch `claude/confident-euler-70sqzi` (PR 2, #114): the arrow and S as in plan step 3;
  `pickups.drop` and `place` under the I/O area; `tools/assets.mjs` `signPixels`, `arrowRows`; the pack test
  checks only up to `HIGH_CODE` (what waits past it, the rest of `io_more`, is copied up first, then written
  over); `play.mjs` and `traffic.test.mjs` pass the player's place and on-foot flag to the pickups model.
- Recent merged work: #113 the P marker; #112 the handover docs; #111 the banners.

## Verification

- `tests/e2e/pickups.test.mjs`: 9 pass with the arrow test (28 November 2026). `make test` running for PR 2.
  Last full `make test` (PR 1): 152 pass, tools 25 pass.
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

## Next

Wait for #114's checks (and the local `make test`), then merge it (a merge commit). The send_later safety
net trig_01HLGhD4SsTPKBUAk8znAE8d is set: delete it after the merge. Then the next roadmap item (jobs, mselin/gta-c64#117; push-aside, #110).

## Subagent files

None.
