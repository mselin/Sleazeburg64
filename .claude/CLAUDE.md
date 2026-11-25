# Notes for Claude

Working agreements from the owner, for every Claude Code session in this repository.

- **Always merge when green.** Make every change on a branch and open a pull request. As soon as all of its
  checks pass, merge it (a merge commit) without asking first. Never merge a pull request with a failing or
  unfinished check, never push to `main`, and never get round a required check: if something fails, fix it on
  the branch and wait again, or say what is wrong.
- **A branch that falls behind `main`.** The ruleset here merges a branch only when it is up to date with `main`,
  and other sessions merge too, so a green pull request can still be refused. Then merge `main` into its branch
  (a merge commit), push, and wait for the checks again. Don't rebase and force-push.
- Every item in `docs/ROADMAP.md` has an issue here.
- The game's rules and look come from the browser game's design document, `specs/design.md` in
  mselin/gta-c64.
- **Stay in this repository.** Sessions on the Commodore 64 version make no code or spec changes in
  mselin/gta-c64: not the browser game, its tests, tools or CI, and not `specs/design.md`. Where the design
  document is unclear, wrong, or hard to follow on a C64, say so in an issue there, and the browser game's
  sessions change it.
  - The one exception the other way: when the owner asks, the browser game's sessions add short notes to
    `docs/ROADMAP.md` here on what changed in the browser game, with links. How the C64 version does it is for
    the sessions here to decide and to write down.
