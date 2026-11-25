# Sleazeburg 64 for the Commodore 64.
#
#   make            build build/sleazeburg64.prg, and build/sleazeburg64.d64: a disk with a loader that shows
#                   the title picture while it loads the game (needs VICE's c1541)
#   make run        build and start it in VICE (needs VICE with C64 ROMs installed)
#   make test       check the tools, run the end-to-end tests in a headless emulator, and keep screenshots
#   make e2e        only the end-to-end tests
#   make clean
#
# Music test builds, which play a tune that is not ours and are not in this repository. They are fetched
# from HVSC into .cache/ and the programs are not for publishing: see music/README.md.
#
#   make music      build build/sleazeburg64-music.prg (title screen with a tune, then the game)
#                   and build/sleazeburg64-ingame.prg (the game it starts, which has no room for a tune)
#   make test-music run both in a headless emulator: screenshots, and recordings to check they make sound

ASM      ?= 64tass
NODE     ?= node
VICE     ?= x64sc
PRG       = build/sleazeburg64.prg
MUSIC_PRG = build/sleazeburg64-music.prg
INGAME_PRG = build/sleazeburg64-ingame.prg
ASSETS    = build/chars.bin build/tiles.bin build/map.bin
TITLE_PIC = build/title.bin
DISK      = build/sleazeburg64.d64
LOADER    = build/loader.prg
SOURCES   = $(wildcard src/*.asm src/*.inc)
ASMFLAGS  = --cbm-prg --ascii --quiet -Wall -Wno-implied-reg -I src -I build
# Extra -D options, for example: make DEFS="-D START_X=40 -D START_Y=60"
DEFS     ?=

all: $(PRG) $(DISK)

$(ASSETS) &: tools/assets.mjs tools/city.mjs tools/font.mjs
	$(NODE) tools/assets.mjs build

# The title page's picture (src/title-page.asm): the browser game's, made a C64 multicolour bitmap, packed.
$(TITLE_PIC): assets/title-sunset.png tools/picture.mjs tools/pack.mjs tools/font.mjs
	$(NODE) tools/picture.mjs $< $@

build/loading.bin: assets/title-sunset.png tools/picture.mjs tools/pack.mjs tools/font.mjs
	$(NODE) tools/picture.mjs $< $@ '' LOADING

# The disk: the loader first, which LOAD"*",8,1 takes, then the game, which it loads by name.
$(LOADER): src/loader.asm src/c64.inc build/loading.bin $(PRG)
	$(ASM) $(ASMFLAGS) -o $@ src/loader.asm
	@ls -l $@

$(DISK): $(LOADER) $(PRG)
	rm -f $@
	c1541 -silent -format "sleazeburg 64,sb" d64 $@ -write $(LOADER) "sleazeburg 64" -write $(PRG) "game" >/dev/null
	@ls -l $@

disk: $(DISK)

# The game as it is shipped starts with the title page.
$(PRG): $(SOURCES) $(ASSETS) $(TITLE_PIC) tools/pack.mjs tools/build-game.sh
	tools/build-game.sh $@ build/labels.txt -D TITLE=1 $(DEFS)
	@ls -l $@

build/tune-%.bin build/tune-%.inc &: tools/sid.mjs tools/font.mjs music/tunes.json
	$(NODE) tools/sid.mjs $* build

$(INGAME_PRG): $(SOURCES) $(ASSETS) tools/pack.mjs tools/build-game.sh
	tools/build-game.sh $@ build/labels-ingame.txt $(DEFS)
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

test: $(ASSETS) $(TITLE_PIC)
	$(NODE) --test "tools/*.test.mjs"
	$(MAKE) e2e
	tools/emulator-test.sh

clean:
	rm -rf build

.PHONY: all run test e2e clean music test-music disk
