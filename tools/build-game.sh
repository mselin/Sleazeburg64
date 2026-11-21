#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the game packed: assembles it once as it runs, packs what waits after the tiles (tools/pack.mjs),
# and assembles it again carrying that packed (PACKED=1 in src/main.asm). The labels are the same both times.
#
# The packed bytes are found in the program's own directory first, so builds in other directories never pick
# up another build's.
#
# Usage: tools/build-game.sh <program.prg> <labels.txt> [64tass options, such as -D SPAWN=0]
set -euo pipefail
cd "$(dirname "$0")/.."
out=$1 labels=$2
shift 2
flags=(--cbm-prg --ascii --quiet -Wall -Wno-implied-reg -I src -I build)
base=${out%.prg}
64tass "${flags[@]}" "$@" --labels "$base-unpacked-labels.txt" -o "$base-unpacked.prg" src/main.asm
node tools/pack.mjs "$base-unpacked.prg" "$base-unpacked-labels.txt" "$base-packed.bin"
64tass -I "$(dirname "$out")" "${flags[@]}" "$@" -D PACKED=1 -D "PACK_FILE=\"$(basename "$base")-packed.bin\"" \
  --labels "$labels" -o "$out" src/main.asm
# Both builds must put everything in the same place, or what was packed would not fit the program around it.
same() { grep -v -E '^(packed_|PACK|file_end)' "$1" | sort; }
if ! diff -q <(same "$base-unpacked-labels.txt") <(same "$labels") >/dev/null; then
  echo "build-game: the packed build puts things in other places than the build that was packed" >&2
  diff <(same "$base-unpacked-labels.txt") <(same "$labels") | head >&2
  exit 1
fi
