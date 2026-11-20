; SPDX-License-Identifier: GPL-2.0-or-later
; The raster interrupts, and the handshake with the main loop.
;
; Two interrupts a frame:
;
;   line 213  The split. The city ends after line 215 whatever its fine scroll and lines 216-222 are black.
;   line 221  The panel starts on line 223 in its own mode, colours and scroll.
;   line 250  In the bottom border. Puts in place the city's mode, fine scroll and screen for the next
;             frame, and plays the music.
;
; How the split works. The video chip fetches a row of characters on a "bad line", a line whose low three
; bits equal the vertical fine scroll, and shows the row for eight lines. The city's last row (20) has its bad
; line somewhere in 208-215. The panel must start on line 223 for every fine scroll, so 223 has to be a bad
; line and 216-222 must not be: one there would start the panel early, or show row 20 again. So the fine
; scroll is set to 6 early in line 215 (unless it is 7, when 215 is row 20's own bad line), and to 7 once
; line 216 has begun, which leaves 223 as the next bad line. From line 216 the mode is extended colour plus
; bitmap, which is invalid and shows black whatever the multicolour bit says: that hides what is left of
; row 20, so the city has a fixed edge, and lets the panel's character mode be set while it is black.
;
; Two writes are timed to the cycle, and both are aimed at the right border and the start of the next line,
; after one line's picture and before the next one's: the black mode for line 216 at the end of line 215,
; and the panel's mode at the end of line 222. That window is about twenty cycles wide, and the loops that
; wait for a line land anywhere in seven, so each wait is followed by a fixed delay that puts the write in
; the middle of it. With fine scroll 7, line 215 is a bad line, which holds the processor until cycle 55
; whenever it reaches it: that lines the write up just as well.
;
; The interrupt comes on line 213, two lines early: when the line it comes on is a bad line (fine scroll 5),
; the processor only gets to it at cycle 55, and it must still be waiting before line 215 begins.

SPLIT_LINE      = 213
BLACK_LINE      = 216
PANEL_LINE      = 223
PANEL_IRQ_LINE  = 221
BOTTOM_LINE     = 250
CITY_D011       = %00010000     ; screen on, 24 rows; the fine scroll goes in bits 0-2
CITY_D016       = %00010000     ; multicolour, 38 columns; the fine scroll goes in bits 0-2
BLACK_D011      = %01110111     ; extended colour and bitmap modes as well: invalid, so black
PANEL_D011      = %00010111     ; fine scroll 7: a bad line on 223
PANEL_D016      = %00001000     ; two-colour characters, 40 columns, no scroll

frame           .block

                .section zp
commit          .byte ?         ; 1 when next_ holds a frame for the bottom interrupt to put in place
next_d011       .byte ?
next_d016       .byte ?
next_d018       .byte ?
next_sx         .byte ?         ; the car's sprite: x (low 8 bits), x bit 8, y, pointer, and whether it is on
next_sxh        .byte ?
next_sy         .byte ?
next_sp         .byte ?
next_d015       .byte ?
cur_d011        .byte ?         ; what the city is shown with this frame
cur_d016        .byte ?
cur_d018        .byte ?
cur_sx          .byte ?
cur_sxh         .byte ?
cur_sy          .byte ?
cur_sp          .byte ?
cur_d015        .byte ?
count           .word ?         ; frames shown
missed          .word ?         ; frames shown again because the main loop had not finished the next one
                .send

; Start the interrupts with the city shown as cur_ says. The caller clears the interrupt mask.
init            lda #0
                sta cur_d015            ; no sprite until the main loop places one
                sta next_d015
                sta SPRITE_MC
                sta SPRITE_EXPAND_X
                sta SPRITE_EXPAND_Y
                sta SPRITE_BEHIND
                lda #RED
                sta SPRITE_COLOUR
                lda #0
                sta commit
                sta count
                sta count + 1
                sta missed
                sta missed + 1
                lda #<split
                sta $fffe
                lda #>split
                sta $ffff
                lda #SPLIT_LINE
                sta VIC_RASTER
                lda cur_d011            ; bit 7 clear: the interrupt lines are below 256
                sta VIC_CTRL1
                lda cur_d016
                sta VIC_CTRL2
                lda cur_d018
                sta VIC_MEMORY
                lda #1
                sta VIC_IRQ_MASK
                sta VIC_IRQ             ; forget one that may be waiting
                rts

; Wait until the frame published last is taken by the bottom interrupt.
wait            lda commit
                bne wait
                rts

; next_ holds the next frame.
publish         lda #1
                sta commit
                rts

split           pha
                txa
                pha
                tya
                pha
                lda cur_d011
                and #7
                cmp #7
                beq scroll7
                lda #BLACK_LINE - 1     ; scrolls 0-6: line 215 is no bad line
-               cmp VIC_RASTER
                bne -
                lda #CITY_D011 | 6      ; so that 216 is no bad line with scroll 0
                sta VIC_CTRL1
                ldy #9                  ; 44 cycles: to the end of line 215's picture
-               dey
                bne -
                lda #BLACK_D011 & ~1    ; black, still with scroll 6. The write lands in cycles 60-66
black_6         sta VIC_CTRL1
                jmp band
scroll7         lda #BLACK_LINE - 1     ; scroll 7: line 215 is row 20's bad line
-               cmp VIC_RASTER
                bne -
                nop                     ; into the bad line, which holds the processor to cycle 55
                nop
                nop
                nop
                nop
                nop
                lda #BLACK_D011
black_7         sta VIC_CTRL1
band            lda #0                  ; no sprites below the city
                sta SPRITE_ON
                lda #BLACK
                sta VIC_BACKGROUND
                lda #PANEL_D016
                sta VIC_CTRL2
                lda #BLACK_D011         ; scroll 7, for the panel's bad line on 223, once on line 216
                ldx #BLACK_LINE
-               cpx VIC_RASTER
                bne -
                sta VIC_CTRL1
                lda #PANEL_IRQ_LINE     ; the panel's own interrupt next, rather than waiting here
                sta VIC_RASTER
                lda #<panel_irq
                sta $fffe
                lda #>panel_irq
                sta $ffff
                lda #1
                sta VIC_IRQ
                pla
                tay
                pla
                tax
                pla
                rti

; Line 221, in the black band, where no bad line can hold it up.
panel_irq       pha
                txa
                pha
                tya
                pha
                ldx #PANEL_D011
                lda #PANEL_LINE - 1
-               cmp VIC_RASTER
                bne -
                lda #D018_PANEL         ; the panel's screen, before its bad line reads it
                sta VIC_MEMORY
                ldy #9                  ; 44 cycles + the 6 above: to the end of line 222's picture
-               dey
                bne -
panel_on        stx VIC_CTRL1           ; lands in cycles 57-63 of line 222
                lda #BOTTOM_LINE
                sta VIC_RASTER
                lda #<bottom
                sta $fffe
                lda #>bottom
                sta $ffff
                lda #1
                sta VIC_IRQ
                pla
                tay
                pla
                tax
                pla
                rti

bottom          pha
                txa
                pha
                tya
                pha
                lda commit
                beq late
                lda next_d011
                sta cur_d011
                lda next_d016
                sta cur_d016
                lda next_d018
                sta cur_d018
                ldx #4
-               lda next_sx,x
                sta cur_sx,x
                dex
                bpl -
                .cerror next_d015 - next_sx != 4 || cur_d015 - cur_sx != 4, "the sprite registers are copied as five"
                lda #0
                sta commit
                beq +
late            inc missed
                bne +
                inc missed + 1
+               lda cur_d011
                sta VIC_CTRL1
                lda cur_d016
                sta VIC_CTRL2
                lda cur_d018
                sta VIC_MEMORY
                lda #DARK_GREY
                sta VIC_BACKGROUND
                lda cur_sx
                sta SPRITE_X
                lda cur_sxh
                sta SPRITE_X_HIGH
                lda cur_sy
                sta SPRITE_Y
                lda cur_sp
                sta SCREEN_A + $3f8
                sta SCREEN_B + $3f8
                lda cur_d015
                sta SPRITE_ON
                inc count
                bne +
                inc count + 1
+               lda #SPLIT_LINE
                sta VIC_RASTER
                lda #<split
                sta $fffe
                lda #>split
                sta $ffff
                lda #1
                sta VIC_IRQ
.if MUSIC != 0
                jsr tune.play
.endif
shown           pla                     ; (the tests stop here: a frame is in place)
                tay
                pla
                tax
                pla
                rti

                .bend
