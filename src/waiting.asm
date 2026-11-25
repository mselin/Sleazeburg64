; SPDX-License-Identifier: GPL-2.0-or-later
; What waits after the tiles in the program file (main.asm): the city map, then the code start copies up and
; the player's frames, which video.init later writes the colour routines over. Included once, either as it is
; or, in a packed build, only for where everything will be.

city_map        .binary "map.bin"               ; one tile number per tile, row by row
map_end
.if MUSIC != 0
; The tune waits here and is copied to the address it was written for when the program starts. Padded with
; zeroes to a whole page, because the copy works in pages.
tune_data       .binary "tune-ingame.bin"
                .fill tune.PAGES * 256 - ingame_size, 0
                .cerror * > ingame_load, "the program has run into where the tune plays from"
.endif
.if VIEWER == 0
; Code that runs from higher up, where there is room: above the colour routines (HIGH_CODE) and at the top of
; memory (TOP_CODE). It waits here, and start copies it up before the colour routines are written over this.
; Lower down, the video chip needs what room there is for sprites: it sees only the first 16K.
high_image
                .logical HIGH_CODE
.if HONK != 0
                .include "honk.asm"
.endif
                .include "foot.asm"
                .dsection status_high
.if CROWD != 0
                .dsection people_high
.endif
high_end
                .endlogical
more_image
                .logical MORE_CODE
                .include "water.asm"
                .dsection video_more
                .dsection car_more
                .dsection pickups_more
.if CROWD != 0
                .dsection people_more
.endif
more_end
                .endlogical
top_image
                .logical TOP_CODE
                .include "traffic.asm"
                .dsection car_extra     ; (where there is room: the passers-by's jaywalking filled EXTRA_CODE)
top_end
                .endlogical
extra_image
                .logical EXTRA_CODE
                .include "video.asm"    ; (up here to leave room for the passers-by's frames lower down)
                .include "status.asm"
.if CROWD != 0
                .include "people.asm"
.endif
                .dsection status
extra_end
                .endlogical
people_image    .binary "people.bin"    ; the passers-by's frames, copied to PEOPLE_FRAMES at start
punch_image     .binary "punch.bin"     ; the player punching, copied to PUNCH_FRAMES at start
                .cerror size(punch_image) != 2 * 256, "the punching frames are two pages"
                .cerror PEOPLE_FRAMES + size(people_image) > PLAYER_FRAMES, "the passers-by's frames reach the player's"
HIGH_PAGES      = (high_end - HIGH_CODE + 255) / 256
MORE_PAGES      = (more_end - MORE_CODE + 255) / 256
TOP_PAGES       = (top_end - TOP_CODE + 255) / 256
EXTRA_PAGES     = (extra_end - EXTRA_CODE + 255) / 256
                .cerror HIGH_CODE < video.COLOUR_END, "HIGH_CODE is in a colour routine"
                .cerror high_end > SQUARES2, "the code at HIGH_CODE runs into the tables"   ; (the rest of its last
                                        ; page is copied over them too, before car.init makes them)
                .cerror top_end > $fffa, "the code at TOP_CODE runs into the interrupt vectors"
                .cerror MORE_CODE < video.COPIES + 9 * video.COPY_SIZE, "MORE_CODE is in the screen copies"
                .cerror more_end > $d000, "the code at MORE_CODE runs into the I/O area"
                .cerror EXTRA_CODE + EXTRA_PAGES * 256 > TOP_CODE, "the code at EXTRA_CODE runs into TOP_CODE"
                .cerror * > HIGH_CODE, "what waits after the map reaches where it is copied to"
                .include "frames.asm"   ; runs once, from here
                .dsection once          ; and so does car.init, before video.init writes over this
.endif
program_end
