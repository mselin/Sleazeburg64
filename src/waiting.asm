; SPDX-License-Identifier: GPL-2.0-or-later
; What waits after the tiles in the program file (main.asm): the city map, then the code start copies up and
; the code it runs once, which video.init later writes the colour routines over. Included once, either as it is
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
                .dsection police_high
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
                .dsection police_extra
extra_end
                .endlogical
people_image    .binary "people.bin"    ; the passers-by's frames, copied to PEOPLE_FRAMES at start
punch_image     .binary "punch.bin"     ; the player punching, copied to PUNCH_FRAMES at start
                .cerror size(punch_image) != 2 * 256, "the punching frames are two pages"
                .cerror PEOPLE_FRAMES + size(people_image) > PLAYER_BUFFERS, "the passers-by's frames reach the player's"
                .cerror PEOPLE_FRAMES + (size(people_image) + 255) / 256 * 256 > PLAYER_FRAMES, "copying them up reaches the player's"
; Code for the panel's screen (PANEL_CODE): in its rows 0-20, never shown, after the variables. A page, copied
; down at start before video.init clears the rest of that screen.
panel_image
                .logical PANEL_CODE
                .dsection panel_code
panel_end
                .endlogical
                .cerror panel_end > PANEL_CLEAR, "the code in the panel's screen is more than a page"
                .cerror PANEL_CLEAR > PANEL_SCREEN + ROWS * 40, "video.init would not clear all the panel's rows"
                .cerror PANEL_CLEAR + PANEL_CLEARED > $0800, "video.init would clear where the BASIC line was"
; Three more places for code, each copied there at start, as the panel's is (main.asm, lay_down), by the byte:
; - the stack page but its top STACK_KEPT bytes (the stack goes 16 deep at most, measured 27 November 2026);
; - from the end of the map to the first colour routine (once what waits from there has been copied up);
; - where the BASIC line was, up to the car's frames.
STACK_KEPT      = 64
stack_image
                .logical $0100
                .dsection stack_code
stack_end
                .endlogical
                .cerror stack_end > $0200 - STACK_KEPT, "the code in the stack page reaches the stack"
gap_image
                .logical map_end
                .dsection gap_code
gap_end
                .endlogical
                .cerror gap_end > video.COLOUR_11, "the code after the map runs into the first colour routine"
basic_image
                .logical $0800
                .dsection basic_code
basic_end
                .endlogical
                .cerror basic_end > CAR_FRAMES, "the code where the BASIC line was runs into the car's frames"
                .cerror stack_image < video.COLOUR_11, "what is copied after the map would be written over"
HIGH_PAGES      = (high_end - HIGH_CODE + 255) / 256
MORE_PAGES      = (more_end - MORE_CODE + 255) / 256
TOP_PAGES       = (top_end - TOP_CODE + 255) / 256
EXTRA_PAGES     = (extra_end - EXTRA_CODE + 255) / 256
                .cerror HIGH_CODE < video.COLOUR_END, "HIGH_CODE is in a colour routine"
                .cerror high_end > SQUARES_START, "the code at HIGH_CODE runs into the table"   ; (the rest of its last
                                        ; page is copied over them too, before car.init makes them)
                .cerror top_end > $fffa, "the code at TOP_CODE runs into the interrupt vectors"
                .cerror MORE_CODE < video.COPIES + 9 * video.COPY_SIZE, "MORE_CODE is in the screen copies"
                .cerror more_end > $d000, "the code at MORE_CODE runs into the I/O area"
                .cerror EXTRA_CODE + EXTRA_PAGES * 256 > TOP_CODE, "the code at EXTRA_CODE runs into TOP_CODE"
once_start
                .cerror once_start < video.COLOUR_11, "car.init would be written over by the code after the map"
                .dsection once          ; car.init runs once, from here, before video.init writes over this
                .cerror * > HIGH_CODE, "what waits after the map (car.init included) reaches where it is copied to"
; The rest of the code under the I/O area waits last, as it may run on past HIGH_CODE: start copies it up first.
more_io_image                           ; (the rest of the code under the I/O area: IO_MORE, main.asm)
                .logical IO_MORE
                .dsection io_more
more_io_end
                .endlogical
                .cerror more_io_end > IO_LATE, "the rest of the code under the I/O area runs into io_late"
MORE_IO_PAGES   = (more_io_end - IO_MORE + 255) / 256
.endif
program_end
