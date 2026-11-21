# Music

The music test builds (`make music`) play a tune that is **not part of this repository and not covered by its
licence**. They remain the property of their copyright holders.

| Where it plays | Title | Author | Copyright | Source |
|---|---|---|---|---|
| Title screen | Skate or Die (intro) | Rob Hubbard | 1987 Electronic Arts | [HVSC 139169](https://www.hvsc.c64.org/search?sid=139169) |
| In the game, until 21 November 2026 | Nemesis the Warlock | Rob Hubbard | 1987 Martech | [HVSC 130260](https://www.hvsc.c64.org/search?sid=130260) |

The game no longer plays a tune: its code now runs from `$e000`, where the in-game tune played from. Only the
end-to-end tests still build a tune into the game's city viewer, with a made-up tune of their own.

## The rules this project keeps

- **The tune files are never committed.** `make music` downloads them from the
  [High Voltage SID Collection](https://www.hvsc.c64.org) into `.cache/sid/`, which git ignores.
- **Programs built with them are test builds.** `build/sleazeburg64-music.prg` contains the title tune, so they are for trying things out on your own machine and
  are not to be published. CI does not build or upload them.
- **Title, author and copyright always travel with the tune.** They are recorded in `tunes.json`, the build
  refuses a tune file whose own header says something different, and the program shows them on screen: on the
  title screen, and in the city viewer's panel while a tune plays there.
- **Any tune file that is ever stored here as an asset** gets a row in the table above and an entry in
  `tunes.json` with the same fields, and is shown on screen the same way.

`tunes.json` also pins each file's SHA-256, so a build always uses exactly the tune that was checked.
