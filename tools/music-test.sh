#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs the music test builds in VICE without a display. Needs `make music` to have been run.
#
# It checks what a machine can check: that the title screen comes up with its credits, that the game the
# title screen starts is the same as the game started directly, and that both tunes make sound. It cannot
# tell whether they sound right. That takes ears, and a real SID.
#
# The recordings in build/sound-*.wav contain the tunes: do not publish them (see music/README.md).
set -euo pipefail
cd "$(dirname "$0")/.."
. tools/vice-lib.sh

# The title screen as it is built for use, waiting for fire.
vice_shot music-title 25000000 build/sleazeburg64-music.prg

# The same, loaded the way a person would: LOAD"*",8,1 and RUN from a disk, through the KERNAL and BASIC,
# though the file runs past the end of BASIC's memory at $a000. (VICE's fast virtual drive needs the original
# KERNAL, so this check is skipped with VICE_ROMS=open.)
if [ "$VICE_ROMS" != open ]; then
  rm -f build/music-title.d64
  c1541 -format "sleazeburg 64,64" d64 build/music-title.d64 -write build/sleazeburg64-music.prg "sleazeburg 64" >/dev/null
  vice_shot music-title-loaded 60000000 build/music-title.d64 +drive8truedrive -virtualdev8
  if ! cmp -s build/screenshot-music-title.png build/screenshot-music-title-loaded.png; then
    echo "the title screen loaded from a disk does not look like the one injected into memory" >&2
    exit 1
  fi
  echo "ok: LOAD and RUN from a disk give the same title screen"
fi

# Autopilot builds: the game with its tune, started directly and by way of the title screen. Once the view
# has stopped moving the two screens must be the same, which shows the game survived being moved in memory
# while the title tune had the machine. Without traffic (SPAWN=0), which would still be moving, and starts at
# a different time in each; the end-to-end tests drive with traffic and a tune.
mkdir -p build/music-test
64tass $ASMFLAGS -I src -I build -D MUSIC=1 -D AUTOPILOT=1 -D SPAWN=0 \
  --labels build/music-test/labels-ingame.txt \
  -o build/music-test/sleazeburg64-ingame.prg src/main.asm
64tass $ASMFLAGS -I src -I build/music-test -I build -D AUTOPILOT=1 -o build/music-test/sleazeburg64-music.prg \
  src/title.asm
vice_shot music-ingame 60000000 build/music-test/sleazeburg64-ingame.prg
vice_shot music-chain 80000000 build/music-test/sleazeburg64-music.prg
if ! cmp -s build/screenshot-music-ingame.png build/screenshot-music-chain.png; then
  echo "the game started from the title screen does not look like the game started directly" >&2
  exit 1
fi
echo "ok: the game looks the same started from the title screen"

# sound <name> <program>: record twelve seconds at normal speed (warp mode records nothing) and check it is
# not silence. The program without a tune records as a flat line.
sound() {
  local name=$1 prg=$2
  rm -f "build/sound-$name.wav"
  xvfb-run -a x64sc -default -kernal "$KERNAL" -basic "$BASIC" \
    -chargen "$CHARGEN" -sounddev wav -soundarg "build/sound-$name.wav" \
    -limitcycles 12000000 -autostartprgmode 1 -autostart "$prg" >"build/vice-sound-$name.log" 2>&1 || true
  node -e '
    const b = require("fs").readFileSync(process.argv[1]);
    const at = b.indexOf("data") + 8;
    let lo = 32767, hi = -32768;
    for (let i = at; i + 1 < b.length; i += 2) { const v = b.readInt16LE(i); if (v < lo) lo = v; if (v > hi) hi = v; }
    const seconds = ((b.length - at) / 2 / b.readUInt32LE(24) / b.readUInt16LE(22)).toFixed(1);
    if (!(hi - lo > 1000)) { console.error(`${process.argv[1]} is silent`); process.exit(1); }
    console.log(`ok: ${process.argv[1]} (${seconds} s of sound, peak to peak ${hi - lo})`);
  ' "build/sound-$name.wav"
}
sound title build/sleazeburg64-music.prg
sound ingame build/sleazeburg64-ingame.prg
