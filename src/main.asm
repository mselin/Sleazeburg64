; SPDX-License-Identifier: GPL-2.0-or-later
; Sleazeburg 64 for the Commodore 64.
;
; Milestone 2, started: a car to drive around a city with traffic in it. A joystick in port 2 drives it, the
; view scrolls smoothly to follow it, and a raster split keeps the status panel still under the city. Traffic
; follows the lanes, shown with a sprite multiplexer. People and the game itself come later.
;
; Assemble with 64tass (see the Makefile). Build options, set with -D on the command line:
;   START_X, START_Y   the tile in the top left corner of the view at start; the car starts in its middle
;   AUTOPILOT          1 makes the car drive itself for a while, for the emulator test
;   MUSIC              1 plays a tune during the game: a test build, see music/README.md
;   VIEWER             1 has no car and no traffic: the stick moves the view itself, as in milestone 1b, for
;                      testing scrolling
;   CARS               how many traffic cars at most (traffic.asm)
;   SPAWN              0: no traffic appears by itself, for tests that place their own

        .cpu "6502"
        .include "c64.inc"

                .weak                   ; defaults, overridden by -D
START_X         = 9
START_Y         = 8
AUTOPILOT       = 0
MUSIC           = 0
VIEWER          = 0
                .endweak
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
CENTRE_X        = VIEW_W / 2            ; where in the window the view keeps the car
CENTRE_Y        = VIEW_H / 2
CAR_FRAMES      = $0840                 ; the car's sprite in 16 directions, 64 bytes each
CAR_SPRITE      = CAR_FRAMES / 64       ; sprite pointer of the first
SQUARES         = $c000                 ; quarter squares for multiplying (see car.init): 1K, made at start
SQUARES2        = $bc00                 ; and the same moved along, for the other half of a multiplication: 1K

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

start           sei
                cld
                ldx #$ff
                txs
                lda #$7f                ; no timer interrupts from either CIA
                sta CIA1_IRQ
                sta CIA2_IRQ
                lda CIA1_IRQ            ; and forget any that were pending
                lda CIA2_IRQ
                lda #$35                ; BASIC and KERNAL out, I/O in: the program owns the machine
                sta CPU_PORT
                lda #<ignore            ; RESTORE does nothing
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
                jsr video.init          ; draws the first picture and sets up the raster interrupts
.if VIEWER == 0
                jsr traffic.init        ; after video.init clears the panel's screen, where its tables are
.endif
                jsr panel.init
                jsr panel.update
.if MUSIC != 0
                jsr tune.init
.endif
                cli

; One pass per frame. The interrupt at the bottom of the screen puts in place what the pass before left
; ready; this pass then works out the next frame.
main_loop       jsr frame.wait          ; until the last frame made is on its way to the screen
                jsr panel.update        ; the readout for that frame, written well away from the panel's lines
                jsr video.after_swap    ; colour memory, if that frame brought in the other screen
ready           jsr input.read          ; A = which directions are held
.if VIEWER == 0
                jsr car.update
                jsr follow_car
                jsr move_both
                jsr traffic.update      ; after the window has moved: it needs to know whether the screen will
                jsr car.show            ; move a character this frame
                jsr traffic.show
                jsr sprites.plan
.else
                jsr move_camera
.endif
                jsr video.follow        ; fine scroll, and the other screen if the view crossed a character
                jsr frame.publish
                jmp main_loop

ignore          rti

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
; Aim the view at the car: step = how far to move the window this frame, at most FOLLOW each way, to put the
; car at CENTRE_X, CENTRE_Y in it (or as near as the edge of the city lets it).
follow_car      .block
                ldx #0
-               sec                     ; target = car - centre, or 0
                .cerror car.pos_y - car.pos_x != 3, "follow_car expects pos_y three bytes after pos_x"
                ldy offset,x
                lda car.pos_x + 1,y
                sbc centre_lo,x
                sta target
                lda car.pos_x + 2,y
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
offset          .byte 0, 3
centre_lo       .byte <CENTRE_X, <CENTRE_Y
centre_hi       .byte >CENTRE_X, >CENTRE_Y
                .section zp
target          .word ?
                .send
                .bend
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
                .include "video.asm"
                .include "panel.asm"
                .include "sprites.asm"
.if VIEWER == 0
                .include "car.asm"
                .include "traffic.asm"
.endif
.if MUSIC != 0
                .include "music.asm"
.endif
code_end
                .cerror * > SCREEN_A, "code has run into the screens"

; ---------- variables with no starting value: in the panel's screen, whose rows 0-20 are never shown ----------
                .virtual PANEL_SCREEN
                .dsection bss
bss_end
                .endv
                .cerror bss_end > PANEL_SCREEN + ROWS * 40, "the variables have run into the panel's rows"

; ---------- data ----------
                * = $3800
charset         .binary "chars.bin"     ; font in 0-63, tile characters after

                * = $4000
tile_tl         .binary "tiles.bin", 0, 256     ; character for each quarter of a tile ...
tile_tr         .binary "tiles.bin", 256, 256
tile_bl         .binary "tiles.bin", 512, 256
tile_br         .binary "tiles.bin", 768, 256
char_colour     .binary "tiles.bin", 1024, 256  ; ... the colour of each character
tile_kind       .binary "tiles.bin", 1280, 256  ; ... what each tile is to a car ...
tile_colour     .binary "tiles.bin", 1536, 256  ; ... and its colour, for colour memory
city_map        .binary "map.bin"               ; one tile number per tile, row by row
map_end
.if MUSIC != 0
; The tune waits here and is copied to the address it was written for when the program starts. Padded with
; zeroes to a whole page, because the copy works in pages.
tune_data       .binary "tune-ingame.bin"
                .fill tune.PAGES * 256 - ingame_size, 0
                .cerror * > ingame_load, "the program has run into where the tune plays from"
.endif
program_end
