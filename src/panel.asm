; SPDX-License-Identifier: GPL-2.0-or-later
; The three-row status panel under the view. Text is ordinary two-colour characters: in multicolour mode a
; character whose colour is one of the first eight is drawn that way.

panel           .block

ROW1            = SCREEN + 22 * 40
ROW2            = SCREEN + 23 * 40
ROW3            = SCREEN + 24 * 40
COLOUR1         = COLOUR_RAM + 22 * 40
TILE_AT         = ROW2 + 5      ; "tile xx,yy"
CROSSING_AT     = ROW2 + 23     ; "crossing a-s"

                .enc "screen"
line1           .text "sleazeburg 64 - the city viewer         "
line2           .text "tile 00,00    crossing 0-0              "
line3           .text "joystick in port 2 moves the view       "
                .enc "none"

init            ldx #39
-               lda line1,x
                sta ROW1,x
                lda line2,x
                sta ROW2,x
                lda line3,x
                sta ROW3,x
                lda #YELLOW
                sta COLOUR1,x
                lda #WHITE
                sta COLOUR1 + 40,x
                lda #CYAN
                sta COLOUR1 + 80,x
                dex
                bpl -
                rts

; Show where the view is: its top left tile, and the crossing nearest its middle, numbered as the game's
; clues number them (avenues from the west, streets from the north, starting at 1).
update          lda cam_x
                ldx #0
                jsr two_digits
                lda cam_y
                ldx #3
                jsr two_digits
                lda cam_x
                clc
                adc #VIEW_W / 2
                jsr crossing
                sta CROSSING_AT
                lda cam_y
                clc
                adc #VIEW_H / 2
                jsr crossing
                sta CROSSING_AT + 2
                rts

; Print A (0-99) as two digits at TILE_AT + X.
two_digits      ldy #'0'
-               cmp #10
                bcc +
                sbc #10
                iny
                bne -
+               ora #'0'
                sta TILE_AT + 1,x
                tya
                sta TILE_AT,x
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
