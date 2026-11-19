# SPDX-License-Identifier: GPL-2.0-or-later
# Shared by the emulator tests: running a program in VICE without a display. Source this, do not run it.
#
# VICE packages do not include the Commodore ROMs, which are copyrighted. This uses the open-source
# replacements from the MEGA65 project's Open ROMs instead, downloaded once into .cache/. They are enough to
# start the machine and inject the program; the game itself does not call the ROMs.

ROMS=.cache/open-roms
ROM_URL=https://raw.githubusercontent.com/MEGA65/open-roms/master/bin
ASMFLAGS="--cbm-prg --ascii --quiet -Wall -Wno-implied-reg"
mkdir -p "$ROMS" build
for rom in kernal_generic.rom basic_generic.rom chargen_openroms.rom; do
  [ -s "$ROMS/$rom" ] || curl -fsSL -o "$ROMS/$rom" "$ROM_URL/$rom"
done

# vice_shot <name> <cycles to run> <program> [extra VICE options...]
# Runs the program, saves build/screenshot-<name>.png when the cycles are up, and fails if it looks blank.
vice_shot() {
  local name=$1 cycles=$2 prg=$3
  shift 3
  rm -f "build/screenshot-$name.png"
  # VICE exits with a non-zero status when it stops at the cycle limit, which is how this run always ends.
  xvfb-run -a x64sc -default -kernal "$ROMS/kernal_generic.rom" -basic "$ROMS/basic_generic.rom" \
    -chargen "$ROMS/chargen_openroms.rom" -sounddev dummy -warp "$@" -limitcycles "$cycles" \
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
