; SPDX-License-Identifier: GPL-2.0-or-later
; The three-row status panel under the city. It has a screen of its own, PANEL_SCREEN, of which only rows
; 21-23 are shown: the raster split switches to it for the panel, gives it a black background and
; two-colour characters, and the bottom interrupt switches back to the city's.

panel           .block

ROW             = ROWS            ; the first of its rows
LINE1           = ROW * 40
LINE2           = LINE1 + 40
LINE3           = LINE2 + 40
TILE_AT         = LINE2 + 5             ; "tile xx,yy"
CROSSING_AT     = LINE2 + 23            ; "crossing a-s"

                .enc "screen"
.if VIEWER != 0
text1           .text "sleazeburg 64 - the city viewer         "
.else
text1           .text "sleazeburg 64 - drive                   "
.endif
text2           .text "tile 00,00    crossing 0-0              "
.if VIEWER != 0
text3           .text "joystick in port 2. fire goes faster    "
.else
text3           .text "up go, down brake, fire handbrake       "
.endif
                .enc "none"

init            ldx #39
-               lda text1,x
                sta PANEL_SCREEN + LINE1,x
                lda text2,x
                sta PANEL_SCREEN + LINE2,x
                lda text3,x
                sta PANEL_SCREEN + LINE3,x
                lda #YELLOW
                sta COLOUR_RAM + LINE1,x
                lda #WHITE
                sta COLOUR_RAM + LINE2,x
                lda #CYAN
                sta COLOUR_RAM + LINE3,x
                dex
                bpl -
                rts

; Show where the view is: the tile in its top left corner, and the crossing nearest its middle, numbered as
; the game's clues number them (avenues from the west, streets from the north, starting at 1).
; Only when it has changed: writing it costs ten raster lines.
update          ldx #0
                lda #0
                jsr tile_under
                sta now
                ldx #1
                lda #0
                jsr tile_under
                sta now + 1
                ldx #0
                lda #VIEW_W / 2
                jsr tile_under
                sta now + 2
                ldx #1
                lda #VIEW_H / 2
                jsr tile_under
                sta now + 3
                ldx #3
-               lda now,x
                cmp shown,x
                bne changed
                dex
                bpl -
                rts
changed         ldx #3
-               lda now,x
                sta shown,x
                dex
                bpl -
                lda now
                ldy #0
                jsr two_digits
                lda now + 1
                ldy #3
                jsr two_digits
                lda now + 2
                jsr crossing
                sta PANEL_SCREEN + CROSSING_AT
                lda now + 3
                jsr crossing
                sta PANEL_SCREEN + CROSSING_AT + 2
                rts
now             .byte 0, 0, 0, 0        ; tile across and down, and the tiles the crossings are worked out from
shown           .byte $ff, $ff, $ff, $ff ; what the panel shows: nothing yet

; A = the tile under the point A pixels into the window on axis X.
tile_under         clc
                adc cam_lo,x
                sta tmp
                lda cam_hi,x
                adc #0
                ldy #4
-               lsr
                ror tmp
                dey
                bne -
                lda tmp
                rts

; Print A (0-99) as two digits at TILE_AT + Y.
two_digits      ldx #'0'
-               cmp #10
                bcc +
                sbc #10
                inx
                bne -
+               ora #'0'
                sta PANEL_SCREEN + TILE_AT + 1,y
                txa
                sta PANEL_SCREEN + TILE_AT,y
                rts

; In: A = a tile coordinate. Out: A = the digit of the nearest crossing on that axis.
; Streets are 12 tiles apart and two tiles wide, so the nearest one is (tile + 5) / 12, counted from 1.
crossing        clc
                adc #5
                ldy #'1'
-               cmp #12
                bcc +
                sbc #12
                iny
                bne -
+               tya
                rts

                .bend
