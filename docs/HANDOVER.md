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

1. Room: move what a pickup does when taken (`pickups.take` .. `pay`, `take_drop`) under the I/O area, run
   through gates (now and then only); `police.quiet` (SID, border) stays outside. Check: build passes its
   size checks; `low_code` has 128 bytes more than the two new frames need. Done: `code_end` $1f07 from
   $1fd0.
2. The P marker (PR 1): a multicolour frame after the scooter riders' (edge and letter in the sprite's own
   colour, flashing cyan/white, inside black), listed after the drops when the shop is near the window
   (a hook written by the nearness check: no cost in other frames). Model in `pickups-model.mjs`. Check:
   pickups, screen and play tests pass; the screen test with no heat still passes. Done in the working tree
   (frame `MARKER_FRAMES` = $0ec0, `pickups.show_paint`, `paint_near`, `paint_hook`; `code_end` $1f93);
   the new pickups test passes; `make test` running.
3. PR 1 opened, green, merged.
4. The arrow and the S (PR 2): with heat at the wheel and the shop 12 px inside the view's edge or beyond,
   a cyan hi-res arrow (16 frames from `ARW`, kept under the I/O area, copied into the frame at `$2500` when
   the direction changes) and the S on black beside it. Check: model and tests; frame time with heat.
5. PR 2 opened, green, merged; ROADMAP and NOTES updated.

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

- Sleazeburg64, branch `claude/confident-euler-70sqzi` (not yet committed): `src/pickups.asm` (take and
  take_drop under the I/O area; the marker), `src/main.asm` (`MARKER_FRAMES`), `tools/assets.mjs`
  (`markerPixels`, `build/marker.bin`), `tests/e2e/pickups-model.mjs`, `game.mjs`, `pickups.test.mjs`.
- Recent merged work: #112 the handover docs; #111 the banners; #109 the paint shop.

## Verification

- `tests/e2e/pickups.test.mjs`: 8 pass, the new marker test included (frame, listed, cyan and white, the
  picture, no late frame, gone when far). Full `make test`: running.
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

## Next

Wait for `make test`; then commit, push, open PR 1 (closes nothing: the paint shop's issue stays open for the
arrow), subscribe, a send_later check-in; merge when green; then step 4.

## Subagent files

None.
