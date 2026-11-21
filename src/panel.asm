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
text3           .text "fire: handbrake. standing still: get out"
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
; the game's clues number them (avenues from the west, streets from the north, starting at 1). Written only
; when it has changed. Worked out from the window's corner in characters, and with tables (digits.asm): this
; runs every frame, before colour memory is worked out.
update          lda cell                ; a tile is two characters
                lsr
                sta now
                lda cell + 1
                lsr
                sta now + 1
                lda cell                ; the window's middle is 152 pixels across and 80 down from its corner:
                clc                     ; 19 characters and 10
                adc #VIEW_W / 16
                lsr
                sta now + 2
                lda cell + 1
                clc
                adc #VIEW_H / 16
                lsr
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
                ldx now
                ldy #0
                jsr two_digits
                ldx now + 1
                ldy #3
                jsr two_digits
                ldx now + 2
                lda crossing_digit,x
                sta PANEL_SCREEN + CROSSING_AT
                ldx now + 3
                lda crossing_digit,x
                sta PANEL_SCREEN + CROSSING_AT + 2
                rts
now             .byte 0, 0, 0, 0        ; tile across and down, and the tiles the crossings are worked out from
shown           .byte $ff, $ff, $ff, $ff ; what the panel shows: nothing yet

; Print tile X as two digits at TILE_AT + Y.
two_digits      lda tens_ones,x
                lsr
                lsr
                lsr
                lsr
                ora #'0'
                sta PANEL_SCREEN + TILE_AT,y
                lda tens_ones,x
                and #15
                ora #'0'
                sta PANEL_SCREEN + TILE_AT + 1,y
                rts

                .bend
