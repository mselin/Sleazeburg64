; SPDX-License-Identifier: GPL-2.0-or-later
; Music test builds only (MUSIC=1): a tune that plays in the city viewer, and its credits in the panel. (The
; game has no room for one: its code runs from $e000, where the tune plays from.)
; The tune is played by the bottom raster interrupt, once a frame, whatever the main loop is doing.
;
; The tune is someone else's work, is not in this repository and is not covered by this program's licence.
; Its title, author and copyright come from the tune file itself and are always shown: see music/README.md.

tune            .block

PAGES           = (ingame_size + 255) / 256     ; whole pages of tune, as it waits in the program
                                                ; then one more, cleared: tunes read a little past their end
CREDIT_FRAMES   = 200           ; how long each line stays in the bottom row of the panel: four seconds

                .cerror ingame_load + (PAGES + 1) * 256 > $fffa, "the tune would be copied over the interrupt vectors"

                .section zp
from            .word ?
to              .word ?
credit_wait     .byte ?
credit_line     .byte ?
                .send

; Copy the tune to where it plays from.
copy            lda #<tune_data
                sta from
                lda #>tune_data
                sta from + 1
                lda #<ingame_load
                sta to
                lda #>ingame_load
                sta to + 1
                ldx #PAGES
                ldy #0
-               lda (from),y
                sta (to),y
                iny
                bne -
                inc from + 1
                inc to + 1
                dex
                bne -
                txa                     ; and the page after it, empty
-               sta (to),y
                iny
                bne -
                rts

; Start the tune, once it has been copied, and show the first credit.
init            ldx #$18                ; a quiet SID to start from
                lda #0
-               sta SID,x
                dex
                bpl -
                lda #ingame_song
                jsr ingame_init
                lda #0
                sta credit_line
                jmp show_credit

; Once a frame, from the bottom interrupt: play the tune, and change the line in the bottom row of the panel
; when its time is up.
play            jsr ingame_play
.if AUTOPILOT != 0
                rts                     ; the emulator test compares screenshots, so the panel keeps still
.endif
                dec credit_wait
                bne done
                ldx credit_line
                inx
                cpx #size(line_lo)
                bcc +
                ldx #0
+               stx credit_line
show_credit     lda #CREDIT_FRAMES
                sta credit_wait
                ldx credit_line
                lda line_lo,x
                sta from
                lda line_hi,x
                sta from + 1
                ldy #39
-               lda (from),y
                sta PANEL_SCREEN + panel.LINE3,y
                dey
                bpl -
done            rts

lines           = (credit_title, credit_by, panel.text3)
line_lo         .byte <lines
line_hi         .byte >lines

                .enc "screen"
credit_title    .text ingame_credit_title, " " x (40 - len(ingame_credit_title))
credit_by       .text ingame_credit_by, " " x (40 - len(ingame_credit_by))
                .enc "none"

                .bend
