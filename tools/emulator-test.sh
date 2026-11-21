#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Runs the program in VICE without a display and saves a screenshot of what it draws.
#
#   tools/emulator-test.sh            builds and runs the normal program and an autopilot build
set -euo pipefail
cd "$(dirname "$0")/.."
. tools/vice-lib.sh

# shot <name> <cycles to run> [extra assembler options...]
shot() {
  local name=$1 cycles=$2
  shift 2
  tools/build-game.sh "build/test-$name.prg" "build/test-$name-labels.txt" "$@"
  vice_shot "$name" "$cycles" "build/test-$name.prg"
}

shot start 40000000
shot autopilot 60000000 -D AUTOPILOT=1
