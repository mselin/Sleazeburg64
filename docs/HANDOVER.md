# Handover: working state

The working state of whatever task is in hand, kept by the short-context workflow (`docs/HANDOVER-PROTOCOL.md`).
Rewrite sections in place; history belongs in git. The project's standing notes (the two games, the memory map,
the environment, the owner's working rules, open threads, don'ts) are in `docs/NOTES.md`; the plan is
`docs/ROADMAP.md`; the rules of the game are the browser game's `specs/design.md` in mselin/gta-c64. Working
agreements for every session are in `.claude/CLAUDE.md`. Never put secrets, tokens or anyone's private details
in it: it is committed and public.

## Task

Bootstrap only: create the handover docs in Sleazeburg64 from the design doc, roadmap and git log. No code changes. Open a PR.

## Plan

1. Move the old `docs/HANDOVER.md` (project notes, 324 lines) unchanged to `docs/NOTES.md`, and point its one
   reference at it. Check: `git diff -M` shows a rename only; `grep -rn HANDOVER` finds no stale pointer. Done.
2. Write `docs/HANDOVER-PROTOCOL.md`: sections 2-5 of the short-context skill, verbatim. Done.
3. Write this file from the design doc, the roadmap and the git log, under about 150 lines. Done.
4. Open the pull request; merge when its checks pass (`.claude/CLAUDE.md`). In progress.

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

- Sleazeburg64, branch `claude/confident-euler-70sqzi`: `docs/HANDOVER.md` renamed to `docs/NOTES.md`; this
  file and `docs/HANDOVER-PROTOCOL.md` new; the pointer in `tests/e2e/car.test.mjs` (a comment) updated. No
  code changes. Pull request: (this one).
- Recent merged work (git log, newest first): #111 the banners; #109 the paint shop and the messages under
  the I/O area; #108 the pavement; #107 patrol cars; #106 officers shoot; #105 code under the I/O area, hurt
  and wasted; #104 the stolen police car; #103 more room and the siren's sound; #101 officers on foot.

## Verification

- This change is documents only (and a comment). The pull request's CI run is the check; nothing else to run.
- Unverified anywhere: the C64 program on real hardware (owner's to try), how the siren sounds, how the banner
  and the walk look on a real screen.

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

Candidate tasks, the first one first (each needs room found before it starts: see `docs/NOTES.md`):

1. The job banners and the jobs themselves, starting with deliveries (ROADMAP, "Jobs").
2. The paint shop's P on the map and the arrow to it with heat (ROADMAP, the paint shop).
3. Cars that push people aside below 30 px/s, and running over by the whole body (ROADMAP, mselin/gta-c64#110).
4. The police helicopter at heat 5 (ROADMAP).

## Subagent files

None.
