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

One thing is not known yet and decides it: **whether VirtualC64 shows the raster split exactly as VICE
does.** VirtualC64 is a cycle-exact emulator too, but a different one, and the split has writes timed to the
cycle (see `src/irq.asm`). That needs trying before building a page around it; see "Next steps".

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

## Next steps

1. **Try it.** `VICE_ROMS=open make test` already shows the program runs the same in VICE on the Open ROMs. To
   see it in VirtualC64, open <https://vc64web.github.io/>, pick the Open ROMs when asked, and drop `sleazeburg64.prg` on it (from `make`, or the `sleazeburg64` artifact of any CI run). Set port 2 to the keyboard joystick. Then check two things: that the black band and the panel sit still while the car drives, and that the car drives. I could not do this here: running the downloaded site locally was refused by this session's permissions.
2. **If it works, publish the program.** CI on `main` builds `sleazeburg64.prg`; publish it with GitHub Pages so it has a fixed address.
3. **Add a page:** either a link to `vc64web.github.io` with that address in it, or a copy of VirtualC64 Web's built files hosted next to the browser game on mselin.github.io (2.2 MB of emulator, plus a link to the source). The link is less work. The copy does not depend on someone else's site and can be tested in CI.
4. **Test it.** If it is self-hosted, an end-to-end test can load the page in Playwright's Chromium with the program and compare a screenshot, as the VICE tests do.
