# Sleazeburg 64 for the Commodore 64.
#
#   make            build build/sleazeburg64.prg
#   make run        build and start it in VICE (needs VICE with C64 ROMs installed)
#   make test       check the tools, run the end-to-end tests in a headless emulator, and keep screenshots
#   make e2e        only the end-to-end tests
#   make clean
#
# Music test builds, which play two tunes that are not ours and are not in this repository. They are fetched
# from HVSC into .cache/ and the programs are not for publishing: see music/README.md.
#
#   make music      build build/sleazeburg64-music.prg (title screen with a tune, then the game with a tune)
#                   and build/sleazeburg64-ingame.prg (the game with its tune, no title screen)
#   make test-music run both in a headless emulator: screenshots, and recordings to check they make sound

ASM      ?= 64tass
NODE     ?= node
VICE     ?= x64sc
PRG       = build/sleazeburg64.prg
MUSIC_PRG = build/sleazeburg64-music.prg
INGAME_PRG = build/sleazeburg64-ingame.prg
ASSETS    = build/chars.bin build/tiles.bin build/map.bin build/map-packed.bin
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

build/tune-%.bin build/tune-%.inc &: tools/sid.mjs tools/font.mjs music/tunes.json
	$(NODE) tools/sid.mjs $* build

$(INGAME_PRG): $(SOURCES) $(ASSETS) build/tune-ingame.bin
	$(ASM) $(ASMFLAGS) $(DEFS) -D MUSIC=1 --labels build/labels-ingame.txt -o $@ src/main.asm
	@ls -l $@

$(MUSIC_PRG): $(SOURCES) $(INGAME_PRG) build/tune-title.bin
	$(ASM) $(ASMFLAGS) $(DEFS) -o $@ src/title.asm
	@ls -l $@

music: $(MUSIC_PRG) $(INGAME_PRG)

test-music: music
	tools/music-test.sh

run: $(PRG)
	$(VICE) -autostartprgmode 1 -joydev2 1 $(PRG)

# One emulator at a time: xvfb-run cannot reliably pick displays for several started at once.
e2e: $(ASSETS)
	$(NODE) --test --test-concurrency=1 "tests/e2e/*.test.mjs"

test: $(ASSETS)
	$(NODE) --test "tools/*.test.mjs"
	$(MAKE) e2e
	tools/emulator-test.sh

clean:
	rm -rf build

.PHONY: all run test e2e clean music test-music
