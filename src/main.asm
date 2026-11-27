; SPDX-License-Identifier: GPL-2.0-or-later
; Sleazeburg 64 for the Commodore 64.
;
; Milestone 2, under way: a car to drive around a city with traffic in it, and to get out of and walk. A
; joystick in port 2 does both, the view scrolls smoothly to follow, and a raster split keeps the status panel
; still under the city. Traffic follows the lanes, shown with a sprite multiplexer, and Big Honk wanders The
; Moat. Other people and the game itself come later.
;
; Assemble with 64tass (see the Makefile). Build options, set with -D on the command line:
;   START_X, START_Y   the tile in the top left corner of the view at start; the car starts in its middle
;   AUTOPILOT          1 makes the car drive itself for a while, for the emulator test
;   MUSIC              1 plays a tune in the city viewer: a test build, see music/README.md. The game has
;                      no room for one: its code runs from $e000, where the tune plays from
;   VIEWER             1 has no car and no traffic: the stick moves the view itself, as in milestone 1b, for
;                      testing scrolling
;   CARS               how many traffic cars at most (traffic.asm)
;   SPAWN              0: no traffic appears by itself, for tests that place their own
;   HONK               0 leaves Big Honk out
;   ITEMS              0 leaves the pickups out (pickups.asm), for tests about something else
;   PACKED             1 carries the map and the code that is copied up packed, from PACK_FILE (the Makefile)

        .cpu "6502"
        .include "c64.inc"

                .weak                   ; defaults, overridden by -D
START_X         = 9
START_Y         = 8
AUTOPILOT       = 0
MUSIC           = 0
VIEWER          = 0
HONK            = 1
ITEMS           = 1
CROWD          = 4                     ; passers-by at most at once (people.asm); 0 leaves them out
PACKED          = 0
PACK_FILE       = "packed.bin"
TITLE           = 0                     ; 1: the title page first (title-page.asm), as the game is shipped
                .endweak
WITH_HONK       = VIEWER == 0 && HONK != 0
                .cerror MUSIC != 0 && VIEWER == 0, "only the city viewer can have a tune: the game's code is at $e000"
.if MUSIC != 0
                .include "tune-ingame.inc"
.endif

MAP_SIZE        = 98                    ; tiles per side of the city
MAP_PIXELS      = MAP_SIZE * 16         ; and screen pixels
VIEW_W          = 304                   ; the window onto the city: 38 columns of 8 pixels ...
VIEW_H          = 161                   ; ... by raster lines 55 to 215
MAX_X           = MAP_PIXELS - VIEW_W   ; the furthest the window's top left corner can go
MAX_Y           = MAP_PIXELS - VIEW_H
SPEED           = 2                     ; VIEWER: pixels per frame while the stick is held
FAST            = 4                     ; and while fire is held too. The most the scrolling allows: see video
FOLLOW          = 4                     ; the car: the most the view moves towards it in a frame, each way
WINDOW_STEP     = FOLLOW                ; (the same, for video.asm, where follow is a routine)
CENTRE_X        = VIEW_W / 2            ; where in the window the view keeps the car
CENTRE_Y        = VIEW_H / 2
CAR_FRAMES      = $0840                 ; the car's sprite in 16 directions, 64 bytes each
CAR_SPRITE      = CAR_FRAMES / 64       ; sprite pointer of the first
PICKUP_FRAMES   = CAR_FRAMES + 16 * 64  ; the pickups' sprite in five kinds, after the car's
SCOOTER_FRAMES  = PICKUP_FRAMES + 5 * 64 ; scooter riders' (people.asm): four ways, then lying, after those
SQUARES         = $bf00                 ; quarter squares for multiplying (see car.init), made at start: the
SQUARES_HI      = $c200                 ; low and high bytes of n * n / 4 for n = -255..511, at each + n
SQUARES_START   = SQUARES - 255         ; (1.5K, from here up to the screen copies)
                .cerror SQUARES - 255 + 767 > SQUARES_HI - 255, "the halves of the quarter squares overlap"
HIGH_CODE       = video.COLOUR_END       ; code that runs from just above the colour routines,
IO_CODE         = $d000                 ; under the I/O area: run only through a gate (below), copied at start
MORE_CODE       = $c8e0                 ; from after the screen copies,
TOP_CODE        = $f300                 ; and from the top of memory: all copied there at start
EXTRA_CODE      = $e000                 ; and from under the KERNAL ROM, which is switched out, up to TOP_CODE
PEOPLE_FRAMES   = $2000                 ; the passers-by's sprite, copied there at start: 20 frames
PUNCH_FRAMES    = $0200                 ; the player punching, 8 frames, copied there at start (the KERNAL's
                                        ; pages, which it does not use once it is switched out)
PLAYER_BUFFERS  = $2540                 ; the player on foot's flipped frames, made when needed: two (frames.asm)
BULLET_FRAME    = PLAYER_BUFFERS + 2 * 64 ; a bullet's sprite (gun.asm), made at start after the passers-by's
                                        ; frames are copied up (the page they come in reaches it)
PLAYER_FRAMES   = $2600                 ; the twelve the others are made from, in the program file, then the code
                                        ; that makes them, and more code, up to the screens

; ---------- zero page ----------
                * = $02
                .dsection zp
                .cerror * > $e0, "zero page overflow: from $e0 on is the music test builds' tune's"

                .section zp
cam_lo          .byte ?, ?      ; the window's top left corner in city pixels: [0] across, [1] down
cam_hi          .byte ?, ?
cell            .byte ?, ?      ; the character of the city in the top left corner of the shown screen
step            .byte ?, ?      ; signed movement this frame, in pixels
busy            .byte ?         ; 1 when this frame's time has gone on colour memory: stay in the cell
pace            .byte ?         ; pixels a frame, from the fire button
tmp             .byte ?
                .send

; ---------- BASIC line: 2026 SYS start ----------
                * = $0801
                .word (+), 2026
                .null $9e, format("%d", start)
+               .word 0

; ---------- the car's sprite, where the video chip can see it ----------
                * = CAR_FRAMES
                .binary "car.bin"
; ---------- and the pickups', the same ----------
.if VIEWER == 0
                .cerror * != PICKUP_FRAMES, "the pickups' frames follow the car's"
                .binary "pickups.bin"
.if CROWD != 0
                .cerror * != SCOOTER_FRAMES, "the scooter riders' frames follow the pickups'"
                .binary "scooters.bin"
.endif
.endif

start           sei
                ldx #$ff
                txs
                jsr boot                ; what runs once, before video.init (from where the screens will be, in
                                        ; the game: video.init then draws them over it)
                jsr video.init          ; draws the first picture and sets up the raster interrupts
.if VIEWER == 0
                jsr traffic.init        ; after video.init clears the panel's screen, where its tables are
                jsr police.init
                jsr frames.init         ; and where the player's flipped frames are kept track of
.endif
.if WITH_HONK
                jsr honk.init           ; the same
.endif
.if VIEWER == 0 && CROWD != 0
                jsr people.init
.endif
.if VIEWER == 0
                jsr foot.init
.if ITEMS != 0
                jsr pickups.init        ; after video.init: the window is where it starts
.if CROWD != 0
                jsr gun.init            ; (after the passers-by's frames are copied up)
.endif
.endif
.endif
.if VIEWER != 0
                jsr panel.init
                jsr panel.update
.else
                jsr status.init         ; after foot.init: the car's part of it depends on where the player is
.endif
.if MUSIC != 0
                jsr tune.init
.endif
                cli

; One pass per frame. The interrupt at the bottom of the screen puts in place what the pass before left
; ready; this pass then works out the next frame.
main_loop       jsr frame.wait          ; until the last frame made is on its way to the screen
.if VIEWER != 0
                jsr panel.update        ; the readout for that frame, written well away from the panel's lines
.endif
                jsr video.after_swap    ; colour memory, if that frame brought in the other screen
ready           jsr input.read          ; A = which directions are held
.if VIEWER == 0
                jsr foot.update         ; the player: in the car or on foot
                jsr follow_car
                jsr move_both
                jsr traffic.update      ; after the window has moved: it needs to know whether the screen will
                jsr police.watch        ; (and whether the police are near, before the status panel cools heat)
                jsr water.update        ; move a character this frame; the same for the water ...
.if WITH_HONK
                jsr honk.update         ; ... Big Honk ...
.endif
                jsr status.update       ; ... and the status panel
.if CROWD != 0
                jsr people.update       ; (and the passers-by, in a frame with time to spare)
                jsr gun.update          ; the bullets, after them
.endif
.if ITEMS != 0
                jsr pickups.update
.endif
                jsr foot.show           ; the car, or the player on foot
                jsr traffic.show
.if WITH_HONK
                jsr honk.show           ; after the traffic, which leaves him where a sprite can start
.endif
.if CROWD != 0
                jsr people.show         ; and the passers-by after him
.endif
.if ITEMS != 0
                jsr pickups.show        ; and the pickups
.if CROWD != 0
                jsr gun.show            ; and the bullets
.endif
.endif
                jsr sprites.plan
.else
                jsr move_camera
.endif
                jsr video.follow        ; fine scroll, and the other screen if the view crossed a character
                jsr frame.publish
.if VIEWER == 0
                jsr video.ahead         ; and with the time left, some of what the next pass may need
.endif
                jmp main_loop

ignore          rti

                .section boot
; What start does once, before video.init: the title page and unpacking (in the game), copying code up to
; where it runs, and setting up what video.init needs.
boot            cld
                lda #$7f                ; no timer interrupts from either CIA
                sta CIA1_IRQ
                sta CIA2_IRQ
                lda CIA1_IRQ            ; and forget any that were pending
                lda CIA2_IRQ
                lda #$35                ; BASIC and KERNAL out, I/O in: the program owns the machine
                sta CPU_PORT
.if VIEWER == 0
.if PACKED != 0 && TITLE != 0
                jsr title_page.show     ; first of all, the title page, until fire
.elsif TITLE != 0
                bit title_page.show     ; (the same size, as below)
.endif
.if PACKED != 0
                jsr unpack              ; first: everything after the tiles is still packed
.else
                bit unpack              ; (the same size: both builds put everything in the same place)
.endif
.endif
.if VIEWER == 0
                #raise high_image, HIGH_CODE, HIGH_PAGES   ; the code that runs from higher up, from where it
                #raise more_image, MORE_CODE, MORE_PAGES   ; waits, before anything is written over it there
                #raise top_image, TOP_CODE, TOP_PAGES
                #raise extra_image, EXTRA_CODE, EXTRA_PAGES
                #raise people_image, PEOPLE_FRAMES, (size(people_image) + 255) / 256
                #raise punch_image, PUNCH_FRAMES, 2
                #raise panel_image, PANEL_CODE, 1     ; (before video.init clears round it)
                lda #$34                ; (all RAM, to write under the I/O area)
                sta CPU_PORT
                #raise io_image, IO_CODE, IO_PAGES
                lda #$35
                sta CPU_PORT
                #lay_down stack_image, $0100, stack_end - $0100      ; (last: what waits after the map is all up now)
                #lay_down gap_image, map_end, gap_end - map_end
                #lay_down basic_image, $0800, basic_end - $0800
.endif
                lda #<ignore            ; RESTORE does nothing (after the copy, which can run over the vectors)
                sta $fffa
                lda #>ignore
                sta $fffb

                lda #<(START_X * 16)
                sta cam_lo
                lda #>(START_X * 16)
                sta cam_hi
                lda #<(START_Y * 16)
                sta cam_lo + 1
                lda #>(START_Y * 16)
                sta cam_hi + 1
                lda #0
                sta busy
.if VIEWER == 0
                jsr car.init
                clc                     ; the car in the middle of the window
                lda #<(START_X * 16 + CENTRE_X)
                ldx #>(START_X * 16 + CENTRE_X)
                ldy #>(START_Y * 16 + CENTRE_Y)
                sty car.sum
                ldy #<(START_Y * 16 + CENTRE_Y)
                jsr car.place
.endif
.if MUSIC != 0
                jsr tune.copy           ; out of the way of a colour routine (video.asm) before it is written
.endif
                rts
                .send

.if VIEWER == 0
                .section boot
; Copy whole pages of code from where they wait in the program file to where they run.
raise           .macro image, home, pages
                lda #<(\image)
                sta copy_up.from + 1
                lda #>(\image)
                sta copy_up.from + 2
                lda #<(\home)
                sta copy_up.to + 1
                lda #>(\home)
                sta copy_up.to + 2
                ldx #\pages
                beq +                   ; (nothing to copy in a build that leaves it all out)
                jsr copy_up
+
                .endm
; A gate to `target`, under the I/O area: interrupts off and the I/O area out while it runs (it must touch
; nothing there), and as they were after. X and Y go through; A does not.
io_gate         .macro target
                php
                sei
                lda #$34
                sta CPU_PORT
                jsr \target
                lda #$35
                sta CPU_PORT
                plp
                rts
                .endm
; Copy `size` bytes (1-255; none: nothing) from image to home, by the byte (the stack page's top is in use).
lay_down        .macro image, home, size
.if \size > 0
                ldx #\size
-               lda \image - 1,x
                sta @w \home - 1,x      ; (a full address: $00ff,x in zero page would wrap round in it)
                dex
                bne -
.endif
                .endm
; Move the packed part of the program file up out of the way, to PACK_HOME, and unpack it to where it belongs,
; from city_map up (tools/pack.mjs says how). It runs once, before anything else is set up, so it can use any
; of zero page; it takes about half a second.
unpack          .block
src             = $f8                   ; zero page, as nothing else uses it yet
dst             = $fa
ref             = $fc
                lda #$34                ; all RAM, the I/O area's too, which the packed copy can reach into
                sta CPU_PORT            ; (interrupts are off)
                lda #<packed_start      ; the move: whole pages, then the rest (they do not overlap)
                sta src
                lda #>packed_start
                sta src + 1
                lda #<PACK_HOME
                sta dst
                lda #>PACK_HOME
                sta dst + 1
                ldy #0
                ldx #>(packed_end - packed_start + 255)
-               lda (src),y
                sta (dst),y
                iny
                bne -
                inc src + 1
                inc dst + 1
                dex
                bne -
                lda #<PACK_HOME         ; the unpacking
                sta src
                lda #>PACK_HOME
                sta src + 1
                lda #<city_map
                sta dst
                lda #>city_map
                sta dst + 1
; Unpack from src to dst, with all RAM in ($34): the title page's picture comes here too (title-page.asm).
stream          ldy #0
next            jsr get
                cmp #$ff
                beq done
                cmp #$80
                bcs match
                tax                     ; n + 1 bytes as they are
                inx
-               jsr get
                jsr put
                dex
                bne -
                beq next
match           sbc #$80 - 3            ; (C is set) n - $80 + 3 bytes from earlier
                tax
                jsr get
                sta ref
                jsr get
                sta ref + 1
                sec
                lda dst
                sbc ref
                sta ref
                lda dst + 1
                sbc ref + 1
                sta ref + 1
-               lda (ref),y
                jsr put
                inc ref
                bne +
                inc ref + 1
+               dex
                bne -
                beq next
done            lda #$35
                sta CPU_PORT
                rts
get             lda (src),y
                inc src
                bne +
                inc src + 1
+               rts
put             sta (dst),y
                inc dst
                bne +
                inc dst + 1
+               rts
                .bend

copy_up         .block
                ldy #0
from            lda $ffff,y             ; (both addresses are written by raise)
to              sta $ffff,y
                iny
                bne from
                inc from + 2
                inc to + 2
                dex
                bne from
                rts
                .bend
                .send
.endif

; Move the window by the joystick, keeping it inside the city. In a frame whose time went on colour memory
; there is none left to move the screen a character, so the window stays within its character that frame.
; In: A = joystick bits.
move_camera     .block
                tay
                ldx #SPEED
                and #JOY_FIRE
                beq +
                ldx #FAST
+               stx pace
                tya
                jsr axis_step
                sta step
                tya
                asl                     ; up and down into the left and right bits
                asl
                jsr axis_step
                sta step + 1
                jmp move_both

; In: A with JOY_LEFT and JOY_RIGHT (or the stick shifted down to put up and down there).
; Out: A = -pace, 0 or pace. Both directions at once is no direction.
axis_step       and #JOY_LEFT | JOY_RIGHT
                cmp #JOY_RIGHT
                bne +
                lda pace
                rts
+               cmp #JOY_LEFT
                bne +
                lda #0
                sec
                sbc pace
                rts
+               lda #0
                rts
                .bend

move_both       ldx #0
                jsr move_axis
                ldx #1
                jmp move_axis

.if VIEWER == 0
; After the window has moved: C set if the screen moves a character this frame (video.follow), a frame with no
; time to spare. Then the window is in another character from the one in cell, and no more than one away, so
; the bottom five bits of the two differ.
screen_moves    lda cam_lo
                lsr
                lsr
                lsr
                eor cell
                and #$1f
                bne +
                lda cam_lo + 1
                lsr
                lsr
                lsr
                eor cell + 1
                and #$1f
                beq ++
+               sec
                rts
+               clc
                rts
.endif

.if VIEWER == 0
; Aim the view at the player, in the car or on foot: step = how far to move the window this frame, at most
; FOLLOW each way, to put them at CENTRE_X, CENTRE_Y in it (or as near as the edge of the city lets it).
follow_car      .block
                ldx #0
-               sec                     ; target = where they are - centre, or 0
                ldy offset,x
                lda player_at,y
                sbc centre_lo,x
                sta target
                lda player_at + 1,y
                sbc centre_hi,x
                sta target + 1
                bpl +
                lda #0
                sta target
                sta target + 1
+               lda target              ; no further than MAX
                cmp max_lo,x
                lda target + 1
                sbc max_hi,x
                bcc +
                lda max_lo,x
                sta target
                lda max_hi,x
                sta target + 1
+               sec                     ; how far: target - cam, at most FOLLOW either way
                lda target
                sbc cam_lo,x
                sta target
                lda target + 1
                sbc cam_hi,x
                bmi left
                bne far_right
                lda target
                cmp #FOLLOW + 1
                bcc +
far_right       lda #FOLLOW
                bne +
left            cmp #$ff
                bne far_left
                lda target
                cmp #$100 - FOLLOW
                bcs +
far_left        lda #$100 - FOLLOW
+               sta step,x
                inx
                cpx #2
                bne -
                rts
offset          .byte 0, 2
centre_lo       .byte <CENTRE_X, <CENTRE_Y
centre_hi       .byte >CENTRE_X, >CENTRE_Y
                .section zp
target          .word ?
                .send
                .bend
                .section bss
player_at       .word ?, ?              ; the player's middle in the city, in a car or on foot: x, then y
                .send
.endif

; In: X = 0 across or 1 down, step,x = how far.
move_axis       .block
                lda step,x
                beq stay
                bmi back
                clc                     ; forward, no further than the edge of the city
                adc cam_lo,x
                sta cam_lo,x
                bcc +
                inc cam_hi,x
+               lda cam_lo,x
                cmp max_lo,x
                lda cam_hi,x
                sbc max_hi,x
                bcc stay
                lda max_lo,x
                sta cam_lo,x
                lda max_hi,x
                sta cam_hi,x
                jmp stay
back            clc                     ; back, no further than 0
                adc cam_lo,x
                sta cam_lo,x
                bcs +
                dec cam_hi,x
+               lda cam_hi,x
                bpl stay
                lda #0
                sta cam_lo,x
                sta cam_hi,x
stay            lda busy
                beq done
                jsr char_of
                cmp cell,x
                beq done
                lda #0                  ; back to the edge of the cell it left: cell * 8, plus 7 going forward
                sta cam_hi,x
                bcc +
                lda #7
+               sta tmp
                lda cell,x
                asl
                rol cam_hi,x
                asl
                rol cam_hi,x
                asl
                rol cam_hi,x
                ora tmp
                sta cam_lo,x
done            rts
                .bend

max_lo          .byte <MAX_X, <MAX_Y
max_hi          .byte >MAX_X, >MAX_Y

; A = the character of the city under the window's top left corner on axis X: the position divided by 8.
char_of         lda cam_hi,x
                sta tmp
                lda cam_lo,x
                lsr tmp
                ror
                lsr tmp
                ror
                lsr tmp
                ror
                rts

                .include "irq.asm"
                .include "input.asm"
.if VIEWER != 0
                .include "video.asm"    ; (in the game, it runs from EXTRA_CODE)
                .dsection video_more
.endif
.if VIEWER != 0
                .include "panel.asm"
                .include "digits.asm"
.endif
                .include "sprites.asm"
.if VIEWER == 0
                .include "car.asm"
                .include "pickups.asm"
                .include "police.asm"   ; (its code is with the code copied up: HIGH_CODE)
.if CROWD != 0
                .include "gun.asm"
.endif
.if TITLE != 0
                .include "title-page.asm"
.endif
.endif
.if MUSIC != 0 && VIEWER != 0
                .include "music.asm"
.endif
.if VIEWER != 0
                .dsection boot          ; (in the city viewer, with the rest)
.endif
code_end
.if VIEWER == 0
                .cerror * > PEOPLE_FRAMES, "code has run into the passers-by's frames"

; The player's twelve frames, and the code that makes the rest, then more code: up to the screens.
                * = PLAYER_FRAMES
                .include "frames.asm"
                .dsection low_more
low_end
                .cerror * > SCREEN_A, "the code after the player's frames has run into the screens"

; What start runs once (boot), in the program file where the screens will be: video.init draws them over it.
; Nothing writes there before: the title page's picture goes to $c000, the unpacking from city_map up.
                * = SCREEN_A
                .dsection boot
boot_end
                .cerror * > charset, "what start runs once has run into the character set"
.else
                .cerror * > SCREEN_A, "code has run into the screens"
low_end         = PLAYER_FRAMES         ; (no part from PLAYER_FRAMES: for the title screen, src/title.asm)
boot_end        = PLAYER_FRAMES
.endif

; ---------- variables with no starting value: in the panel's screen, whose rows 0-20 are never shown ----------
                .virtual PANEL_SCREEN
                .dsection bss
bss_end
                .endv
                .cerror bss_end > PANEL_SCREEN + ROWS * 40, "the variables have run into the panel's rows"
.if VIEWER == 0
                .cerror SLOTS <= 6 && bss_end > PANEL_CODE, "the variables have run into the code in the panel's screen"
                                        ; (A test build with more cars, for the multiplexer, has its variables
                                        ; over that code: what is there runs only with heat, which it never has.)
.endif

; ---------- data ----------
                * = $3800
charset         .binary "chars.bin"     ; font in 0-63, tile characters after

; The tables by tile have room for TILE_ROOM tiles (tools/assets.mjs holds the city to it); the rest of each
; table's page holds other things (.section tile_room1-6): the panel's messages, and code.
TILE_ROOM       = 128
room            .macro table, number
                .binary "tiles.bin", \table * 256, TILE_ROOM
                .dsection tile_room\number
                .cerror * > $4000 + (\table + 1) * 256, "too much in tile_room\number"
                .fill $4000 + (\table + 1) * 256 - *, 0
                .endm
                * = $4000
tile_tl         #room 0, 1      ; character for each quarter of a tile ...
tile_tr         #room 1, 2
tile_bl         #room 2, 3
tile_br         #room 3, 4
char_colour     .binary "tiles.bin", 1024, 256  ; ... the colour of each character
tile_kind       #room 5, 5      ; ... what each tile is to a car ...
tile_colour     #room 6, 6      ; ... and its colour, for colour memory
; What waits after the tiles: the map, and the code start copies up and the code it runs once, which video.init
; later writes the colour routines over. A packed build (PACKED, tools/pack.mjs) carries it packed in the
; program file, here, and start unpacks it in place before anything else.
.if PACKED == 0
                .include "waiting.asm"
.else
packed_start    = *
                .virtual
                .include "waiting.asm"  ; (where everything will be, but nothing in the file)
                .endv
packed_bytes    .binary PACK_FILE
packed_end
PACK_HOME       = (program_end + 255) & $ff00 ; where start moves it to unpack it: clear of where it unpacks to, in
                                        ; RAM that is free until the code is copied up after it
                .cerror program_end > PACK_HOME, "what is unpacked runs into the packed copy"
                .cerror PACK_HOME + (packed_end - packed_start) > $fffa, "the packed copy runs into the interrupt vectors"
                                        ; (past $d000 it is in the RAM under the I/O area and the KERNAL, which the
                                        ; code copied up there only takes once it has been unpacked)
                .cerror packed_end > PACK_HOME, "the packed data would be overwritten as it is moved"
                .cerror * - packed_start != size(packed_bytes), "the packed data is not all there"
.if TITLE != 0
packed_title    .binary "title.bin"     ; the title page's picture, packed (title-page.asm): shown, then written over
packed_title_end
                .cerror packed_title_end > PACK_HOME, "the title picture would be overwritten as the rest is moved"
.endif
.endif
.if PACKED == 0 && VIEWER == 0
packed_start    = city_map              ; (not packed: unpack is assembled, the same size, but not called)
packed_end      = city_map
packed_title    = city_map              ; (nor is the title page shown)
PACK_HOME       = $a000
.endif
file_end                                ; (what the program file holds ends here)
