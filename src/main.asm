; SPDX-License-Identifier: GPL-2.0-or-later
; Sleazeburg 64 for the Commodore 64.
;
; Milestone 1b: the city viewer with smooth scrolling. A joystick in port 2 moves the view a pixel at a time
; in eight directions, and a raster split keeps the status panel still under it. The car and everything
; else come later.
;
; Assemble with 64tass (see the Makefile). Build options, set with -D on the command line:
;   START_X, START_Y   the tile in the top left corner of the view at start
;   AUTOPILOT          1 makes the view drive itself for a while, for the emulator test
;   MUSIC              1 plays a tune during the game: a test build, see music/README.md

        .cpu "6502"
        .include "c64.inc"

                .weak                   ; defaults, overridden by -D
START_X         = 9
START_Y         = 8
AUTOPILOT       = 0
MUSIC           = 0
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
SPEED           = 2                     ; pixels per frame while the stick is held
FAST            = 4                     ; and while fire is held too. The most the scrolling allows: see video

; ---------- zero page ----------
                * = $02
                .dsection zp
                .cerror * > $90, "zero page overflow"

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
                jsr video.init          ; draws the first picture and sets up the raster interrupts
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
                jsr move_camera
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
                ldx #0
                jsr move_axis
                ldx #1
                jmp move_axis

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

; In: X = 0 across or 1 down.
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
.if MUSIC != 0
                .include "music.asm"
.endif
code_end
                .cerror * > SCREEN_A, "code has run into the screens"

; ---------- data ----------
                * = $3800
charset         .binary "chars.bin"     ; font in 0-63, tile characters after

                * = $4000
tile_tl         .binary "tiles.bin", 0, 256     ; character for each quarter of a tile ...
tile_tr         .binary "tiles.bin", 256, 256
tile_bl         .binary "tiles.bin", 512, 256
tile_br         .binary "tiles.bin", 768, 256
char_colour     .binary "tiles.bin", 1024, 256  ; ... and the colour of each character
city_map        .binary "map.bin"               ; one tile number per tile, row by row
.if MUSIC != 0
; The tune waits here and is copied to the address it was written for when the program starts. Padded with
; zeroes to a whole page, because the copy works in pages.
tune_data       .binary "tune-ingame.bin"
                .fill tune.PAGES * 256 - ingame_size, 0
                .cerror * > ingame_load, "the program has run into where the tune plays from"
.endif
program_end
