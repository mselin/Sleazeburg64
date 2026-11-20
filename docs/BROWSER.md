# Playing the C64 version in a browser

Research for the issue "Play the C64 version in a browser with a WebAssembly build of VICE": which
in-browser builds exist, their licences, what they do about the Commodore system ROMs, and joystick input
from keyboard and touch. Done on 20 November 2026 from the projects' own repositories; what could not be
checked is said so.

## Recommendation

**Use VirtualC64 Web, not a build of VICE, and run it on the open-source MEGA65 Open ROMs.** It is
maintained, GPL, runs on GitHub Pages as it is, starts a program from a link, has keyboard and touch
joysticks, and needs no Commodore ROMs at all. This program never calls the KERNAL, and the emulator tests
already run it on those same Open ROMs, so nothing copyrighted has to be shipped.

Every VICE build for the browser either is a decade old or carries the Commodore ROMs inside it, which is
the thing this project does not distribute.

The emulator tests now use the Commodore ROMs, fetched at test time from the VICE project's own repository
and never committed or published. That does not change
this: a page in a browser hands its ROMs to every visitor, so it would still use the Open ROMs. (A VICE page
could fetch the Commodore ROMs from a repository like that in the visitor's browser, the way the browser game's
radio streams tunes from HVSC, but that is a rights question for the owner.)

**Tried on 20 November 2026 and it works.** The owner loaded `sleazeburg64.prg` into VirtualC64 Web (on the
Commodore ROMs) and drove the car. The picture was as in VICE: the city in its 38-column window, the car in the
middle, the black band, and the panel on black with the readout following. So VirtualC64 handles the raster
split's cycle-timed writes. Once the page was published the owner tried its play link, which runs on VirtualC64
Web's Open ROMs, and it works there too. (The keyboard and touch links differ only in the on-screen joystick;
the touch one has not been reported on separately.)

One thing to know when trying a `.prg` in it by hand: it puts the program at its load address and types
`run:`. With ROMs that start BASIC somewhere other than `$0801` that fails with `?SYNTAX ERROR` (the start-up
screen then shows fewer than 38911 bytes free); with the standard ROMs or its Open ROMs it works.

## What exists

| | VirtualC64 Web | EmulatorJS with libretro VICE | vice.js | Internet Archive |
|---|---|---|---|---|
| Emulator | VirtualC64 (Dirk W. Hoffmann), compiled to WebAssembly | VICE (`x64sc`) as a libretro core | VICE 2.4 | VICE 3.2 |
| Licence | GPL-3.0 | EmulatorJS GPL-3.0, core GPL-2.0 | GPL-2.0 | — |
| Maintained | Yes: the built site was updated 28 October 2026 | Yes | No: about 2014, asm.js era | Not a reusable project |
| Commodore ROMs | Not needed: MEGA65 Open ROMs built in (`openROMS=true`), or the user's own | **Compiled into the core** | Not documented | — |
| Static hosting | Yes: its service worker adds the cross-origin isolation headers | Not checked (docs site unreachable) | — | — |
| Start a program from a link | Yes | Yes (not checked in detail) | Through `Module.arguments` | — |
| Joystick | Port 1 or 2 from the keyboard or an on-screen touch joystick, chosen in the link | libretro mapping, RetroPad on screen | Keyboard only | — |

### VirtualC64 Web

- **What it is:** <https://github.com/vc64web/virtualc64web> (source) and <https://github.com/vc64web/vc64web.github.io> (the built site served at <https://vc64web.github.io/>). The emulator files are `vc64.wasm` (2.0 MB) and `vc64.js` (196 KB); the rest of the 26 MB site is documentation and images.
- **Licence:** GPL-3.0. Hosting a copy means offering its source, which is a link to the upstream commit.
- **ROMs:** the hosted copy has the MEGA65 Open ROMs built in, chosen with `openROMS=true` in the link. Otherwise it asks the user for their own ROMs.
- **Starting a program:** the part of the address after `#` carries settings and a URL, for example
  `https://vc64web.github.io/#openROMS=true#port2=true#touch=true#https://example.org/sleazeburg64.prg`.
  There is also a JSON form, and an official player script (`js/vc64web_player.js`) that embeds it in an iframe on another page and can pass it a file and ROMs.
- **Cross-origin:** to fetch the program, its host must allow it. GitHub Pages does: it answers with `access-control-allow-origin: *`.
- **Joystick:** `port2=true` puts the joystick in port 2. Without `touch=true` it is played from the keyboard; with it, an on-screen joystick for phones.
- **Static hosting:** it needs cross-origin isolation (for threads and shared memory). Its service worker adds the headers itself, so it works on GitHub Pages, which cannot set them.

### EmulatorJS with the libretro VICE core

- **Projects:** EmulatorJS (<https://github.com/EmulatorJS/EmulatorJS>, GPL-3.0) runs libretro cores in the browser. For the C64 it uses VICE's `x64sc` core from <https://github.com/libretro/vice-libretro> (VICE 3.10, GPL-2.0, Emscripten listed as a platform).
- **The problem is the ROMs.** The core's build includes `include/embedded/`, which holds the C64 KERNAL, BASIC and character ROMs as C headers (`c64kernal.h` and others). So the core carries them. VICE's own notice, quoted in the libretro README, says "The ROM files in the `C64` ... directories are Copyright C by Commodore Business Machines."
- **What that means for us:** hosting the core, or pointing a page at EmulatorJS's public CDN, hands those ROMs to every visitor. Debian and Ubuntu remove the same files from their VICE package (`/usr/share/doc/vice/copyright`: "the ROM files distributed with the version that can be downloaded there have been removed from the Debian source package").
- **Not checked:** EmulatorJS's own documentation site (emulatorjs.org) could not be reached from here, so its C64 options, autostart and touch controls are unchecked.

### Others

- **vice.js** (<https://github.com/rjanicek/vice.js>) is VICE 2.4 through Emscripten, about ten years old: its README lists Firefox 39 and Chrome 43.
- **Internet Archive** compiled VICE 3.2 with Emscripten for its in-browser C64 software in 2018. This comes from news reports only; its own pages could not be reached from here.
- **VICE itself** has no web build: none of its build guides mention Emscripten or WebAssembly.

## MEGA65 Open ROMs

<https://github.com/MEGA65/open-roms>: "unencumbered open-source ROMs". The licence is LGPL-3.0, with an MIT notice from Microsoft on some BASIC files. VirtualC64 Web already ships them, and our VICE tests download them from the same repository.

They follow the KERNAL's public entry points rather than copying it, so programs that call the KERNAL in ways it does not cover may differ. This program switches the KERNAL out and never calls it, so that does not matter here.

## What is done, and what is next

1. **Done: the play page.** After the tests pass on `main`, CI publishes the tested program and a small page
   (`site/index.html`) with GitHub Pages, at <https://mselin.github.io/Sleazeburg64/>. The page links to
   VirtualC64 Web with the program's address in the link, for the keyboard and for touch, and offers the
   `.prg` to download for a real machine.
2. **Done: the link tried.** The page went live on 20 November 2026 and the owner played the game from its link,
   on VirtualC64 Web's Open ROMs.
   The homepage on mselin.github.io and the browser game's information page link to the page and to this
   repository.
3. **Later, if wanted:** host a copy of VirtualC64 Web's built files instead of linking to its site (2.2 MB of
   emulator, plus a link to its source, as GPL-3.0 asks), so the page does not depend on someone else's site
   and can be tested in CI by loading it in Playwright's Chromium and comparing a screenshot, as the VICE tests
   do.
