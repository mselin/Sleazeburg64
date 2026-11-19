; SPDX-License-Identifier: GPL-2.0-or-later
; Sleazeburg 64 for the Commodore 64.
;
; Milestone 1a: the city viewer. Draws the city in multicolour character mode and moves the view one tile
; at a time with a joystick in port 2. Smooth scrolling, the car and everything else come later.
;
; Assemble with 64tass (see the Makefile). Build options, set with -D on the command line:
;   START_X, START_Y   the tile in the top left corner of the view at start
;   AUTOPILOT          1 makes the view drive itself for a while, for the emulator test

        .cpu "6502"
        .include "c64.inc"

                .weak                   ; defaults, overridden by -D
START_X         = 9
START_Y         = 8
AUTOPILOT       = 0
                .endweak

MAP_SIZE        = 98            ; tiles per side of the city
VIEW_W          = 20            ; tiles shown across (40 characters)
VIEW_H          = 11            ; tiles shown down (22 character rows; the last three are the status panel)
MOVE_EVERY      = 3             ; frames between steps while the stick is held

; ---------- zero page ----------
                * = $02
                .dsection zp
                .cerror * > $90, "zero page overflow"

                .section zp
cam_x           .byte ?         ; tile in the top left corner of the view
cam_y           .byte ?
move_wait       .byte ?         ; frames until the view may step again
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
                lda #<ignore            ; RESTORE and stray interrupts do nothing
                sta $fffa
                sta $fffe
                lda #>ignore
                sta $fffb
                sta $ffff

                jsr video.init
                jsr panel.init
                lda #START_X
                sta cam_x
                lda #START_Y
                sta cam_y
                lda #0
                sta move_wait
                jsr video.draw
                jsr panel.update

main_loop       jsr video.wait_frame
                jsr input.read          ; A = which directions are held
                jsr move_view
                jmp main_loop

ignore          rti

; Step the view by one tile in each held direction, no more often than every MOVE_EVERY frames.
; In: A = joystick bits.
move_view       .block
                sta held
                lda move_wait
                beq ready
                dec move_wait
                rts
ready           lda cam_x
                sta old_x
                lda cam_y
                sta old_y
                lda held
                and #JOY_LEFT
                beq +
                lda cam_x
                beq +
                dec cam_x
+               lda held
                and #JOY_RIGHT
                beq +
                lda cam_x
                cmp #MAP_SIZE - VIEW_W
                bcs +
                inc cam_x
+               lda held
                and #JOY_UP
                beq +
                lda cam_y
                beq +
                dec cam_y
+               lda held
                and #JOY_DOWN
                beq +
                lda cam_y
                cmp #MAP_SIZE - VIEW_H
                bcs +
                inc cam_y
+               lda cam_x
                cmp old_x
                bne moved
                lda cam_y
                cmp old_y
                bne moved
                rts
moved           lda #MOVE_EVERY - 1
                sta move_wait
                jsr video.draw
                jmp panel.update
                .section zp
held            .byte ?
old_x           .byte ?
old_y           .byte ?
                .send
                .bend

                .include "input.asm"
                .include "video.asm"
                .include "panel.asm"
                .cerror * > charset, "code has run into the character set"

; ---------- data ----------
                * = $3800
charset         .binary "chars.bin"     ; font in 0-63, tile characters after

                * = $4000
tile_tl         .binary "tiles.bin", 0, 256     ; character for each quarter of a tile ...
tile_tr         .binary "tiles.bin", 256, 256
tile_bl         .binary "tiles.bin", 512, 256
tile_br         .binary "tiles.bin", 768, 256
tile_colour     .binary "tiles.bin", 1024, 256  ; ... and the colour all four share
city_map        .binary "map.bin"               ; one tile number per tile, row by row
