# Sleazeburg 64 for the Commodore 64.
#
#   make            build build/sleazeburg64.prg
#   make run        build and start it in VICE (needs VICE with C64 ROMs installed)
#   make test       check the tools, then run the program in a headless emulator and keep a screenshot
#   make clean

ASM      ?= 64tass
NODE     ?= node
VICE     ?= x64sc
PRG       = build/sleazeburg64.prg
ASSETS    = build/chars.bin build/tiles.bin build/map.bin
SOURCES   = $(wildcard src/*.asm src/*.inc)
ASMFLAGS  = --cbm-prg --ascii --quiet -Wall -Wno-implied-reg -I src -I build
# Extra -D options, for example: make DEFS="-D START_X=40 -D START_Y=60"
DEFS     ?=

all: $(PRG)

$(ASSETS) &: tools/assets.mjs tools/city.mjs tools/font.mjs
	$(NODE) tools/assets.mjs build

$(PRG): $(SOURCES) $(ASSETS)
	$(ASM) $(ASMFLAGS) $(DEFS) --labels build/labels.txt -o $@ src/main.asm
	@ls -l $@

run: $(PRG)
	$(VICE) -autostartprgmode 1 -joydev2 1 $(PRG)

test: $(ASSETS)
	$(NODE) --test "tools/*.test.mjs"
	tools/emulator-test.sh

clean:
	rm -rf build

.PHONY: all run test clean
