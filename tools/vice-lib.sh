# SPDX-License-Identifier: GPL-2.0-or-later
# Shared by the emulator tests: running a program in VICE without a display. Source this, do not run it.
#
# VICE packages do not include the Commodore ROMs, which are copyrighted. The tests fetch them at test time
# into .cache/ (which git ignores) from the VICE project's own repository (github.com/VICE-Team/svn-mirror),
# at a fixed commit, and check each file's SHA-256. They are never committed to this repository
# and never published: see the README. VICE_ROMS=open runs the tests on the MEGA65 project's open-source
# Open ROMs instead, which is what a page playing the game in a browser would use (docs/BROWSER.md).

VICE_ROMS=${VICE_ROMS:-commodore}
if [ "$VICE_ROMS" = open ]; then
  ROMS=.cache/open-roms
  ROM_URL=https://raw.githubusercontent.com/MEGA65/open-roms/ad178dbe4d48cd6a317737a8e0e7e662f7e33d32/bin
  ROM_SUMS="88e86ed3d0c710edab8f90ad146faa8de1ead11f43494b176c7b54724ca721c6  kernal_generic.rom
54a1464b4b27c9dc61bbd62a818fdd12ec99af9089111005a5add0ad0e6bd5ec  basic_generic.rom
5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7  chargen_openroms.rom"
  KERNAL=$ROMS/kernal_generic.rom BASIC=$ROMS/basic_generic.rom CHARGEN=$ROMS/chargen_openroms.rom
else
  ROMS=.cache/vice-roms
  ROM_URL=https://raw.githubusercontent.com/VICE-Team/svn-mirror/83095dcbf3a535167fb864fc4801b0c8ef5be517/vice/data/C64
  ROM_SUMS="83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721  kernal-901227-03.bin
89878cea0a268734696de11c4bae593eaaa506465d2029d619c0e0cbccdfa62d  basic-901226-01.bin
fd0d53b8480e86163ac98998976c72cc58d5dd8eb824ed7b829774e74213b420  chargen-901225-01.bin"
  KERNAL=$ROMS/kernal-901227-03.bin BASIC=$ROMS/basic-901226-01.bin CHARGEN=$ROMS/chargen-901225-01.bin
fi
mkdir -p "$ROMS" build
while read -r _ rom; do
  [ -s "$ROMS/$rom" ] || curl -fsSL -o "$ROMS/$rom" "$ROM_URL/$rom"
done <<<"$ROM_SUMS"
(cd "$ROMS" && sha256sum --quiet -c - <<<"$ROM_SUMS") || { echo "the ROMs in $ROMS are not the expected ones" >&2; exit 1; }

ASMFLAGS="--cbm-prg --ascii --quiet -Wall -Wno-implied-reg"

# vice_shot <name> <cycles to run> <program> [extra VICE options...]
# Runs the program, saves build/screenshot-<name>.png when the cycles are up, and fails if it looks blank.
vice_shot() {
  local name=$1 cycles=$2 prg=$3
  shift 3
  rm -f "build/screenshot-$name.png"
  # VICE exits with a non-zero status when it stops at the cycle limit, which is how this run always ends.
  xvfb-run -a x64sc -default -kernal "$KERNAL" -basic "$BASIC" \
    -chargen "$CHARGEN" -sounddev dummy -warp "$@" -limitcycles "$cycles" \
    -exitscreenshot "build/screenshot-$name.png" -autostartprgmode 1 -autostart "$prg" \
    >"build/vice-$name.log" 2>&1 || true
  if [ ! -s "build/screenshot-$name.png" ]; then
    echo "no screenshot for $name; see build/vice-$name.log" >&2
    exit 1
  fi
  # A blank screen compresses to almost nothing. The city does not.
  local size
  size=$(wc -c <"build/screenshot-$name.png")
  if [ "$size" -lt 1500 ]; then
    echo "screenshot for $name looks blank ($size bytes)" >&2
    exit 1
  fi
  echo "ok: build/screenshot-$name.png ($size bytes)"
}
