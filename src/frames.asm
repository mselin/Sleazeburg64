; SPDX-License-Identifier: GPL-2.0-or-later
; The player on foot's sprite frames.
;
; tools/assets.mjs draws 42 frames: eight directions in five walking poses, and two swimming. Turning a figure
; over gives another of them, so the program file holds only twelve (player_data, at PLAYER_FRAMES, where the
; video chip sees them), and the rest are made from them when they are needed: each is one of the twelve as it
; is, or flipped left to right, or top to bottom (within lines 0-19: line 20 is empty), or both. player_made
; has, for each frame, the frame it is made from * 4, + 1 if flipped left to right, + 2 if top to bottom.
;
; A frame that is one of the twelve as it is is shown from where it is. One that is flipped is made into one
; of two buffers (PLAYER_BUFFERS), the one the sprite was not last shown from, so the picture being shown is
; never written over; and a frame made already is shown again from its buffer. Making one takes about 30
; raster lines, so it is done only in a frame with time to spare (as pickups.update is): in another, the
; picture stays as it was for a frame longer.
;
; It all lives here, from PLAYER_FRAMES up: the twelve frames, then the table of byte pairs turned round, the
; order to read a frame's bytes in for each way of flipping it, and the code. What is left, up to the screens,
; is for code that runs from low down (the section low_more).

PLAYER_FRAME_COUNT = 42
BUFFER_SPRITE   = PLAYER_BUFFERS / 64

frames          .block
; The twelve frames the program file holds.
player_data     .binary "player.bin"
; A byte of four pixel pairs with them in the opposite order.
pairs_back
.for i = 0, i < 256, i += 1
                .byte (i & 3) << 6 | (i & 12) << 2 | (i & 48) >> 2 | i >> 6
.next
; For each way of flipping a frame (1: left to right, 2: top to bottom, 3: both), where in the frame it is
; made from each byte of it is read from: lines 0-19 turned over, three bytes a line, and line 20 as it is.
order
.for f = 1, f < 4, f += 1
.for i = 0, i < 63, i += 1
                .byte i >= 60 ? i : ((f & 2) != 0 ? 19 - i / 3 : i / 3) * 3 + ((f & 1) != 0 ? 2 - i % 3 : i % 3)
.next
.next
                .cerror (order & 255) + 3 * 63 > 256, "the reading orders cross a page"
order_lo        .byte <order, <(order + 63), <(order + 126)


                .section bss
held            .byte ?, ?              ; the frame each buffer holds ($ff: none yet)
shown           .byte ?                 ; the buffer the sprite was last shown from: 0 or 1
                .send

; Nothing made yet.
init            lda #$ff
                sta held
                sta held + 1
                lda #0
                sta shown
                rts

; In: A = a frame, 0-41. Out: A = the sprite pointer to show it from. Uses X and Y.
point           tax
                lda player_made,x
                and #3
                bne +
                lda player_made,x       ; one of the twelve, as it is
                lsr
                lsr                     ; (the carry is clear: bit 1 was)
                adc #PLAYER_SPRITE
                rts
+               txa
                ldy #1
-               cmp held,y              ; made already?
                beq +
                dey
                bpl -
                lda busy                ; no: made only in a frame with time to spare, with no colour memory
                bne late                ; to work out and the screen not moving a character
                jsr screen_moves
                bcs late
                lda shown               ; into the buffer not shown
                eor #1
                tay
                txa
                sta held,y
                jsr make
                lda shown
                eor #1
                tay
+               sty shown
                tya
                clc
                adc #BUFFER_SPRITE
                rts
late            lda frame.next_sp       ; else what was shown stays a frame longer: unless it was the car, when
                cmp #CAR_SPRITE         ; it is the frame this one is made from, as it is
                bcc +
                cmp #CAR_SPRITE + 16
                bcs +
                lda player_made,x
                and #$fc
                lsr
                lsr                     ; (the carry is clear)
                adc #PLAYER_SPRITE
+               rts

; Make frame X in buffer Y. Uses A, X and Y.
make            lda player_made,x
                pha
                and #3                  ; how it is flipped: 1-3
                tax
                lda order_lo - 1,x
                sta get + 1
                sta get2 + 1
                pla
                lsr
                lsr                     ; the frame it is made from: 0-11, 64 bytes each
                pha
                lsr
                lsr
                clc
                adc #>PLAYER_FRAMES
                sta from + 2
                sta from2 + 2
                pla
                and #3
                lsr
                ror
                ror
                ora #<PLAYER_FRAMES
                sta from + 1
                sta from2 + 1
                lda buffer_lo,y
                sta to + 1
                sta to2 + 1
                txa
                lsr
                ldx #62                 ; line 20 too: empty in all of them
                bcc only_down
get             ldy order,x             ; left to right: each byte's pixels turned round too
from            lda $ffff,y
                tay
                lda pairs_back,y
to              sta PLAYER_BUFFERS,x
                dex
                bpl get
                rts
only_down
get2            ldy order,x
from2           lda $ffff,y
to2             sta PLAYER_BUFFERS,x
                dex
                bpl get2
                rts

buffer_lo       .byte <PLAYER_BUFFERS, <(PLAYER_BUFFERS + 64)
                .cerror (PLAYER_BUFFERS & $ff) > $80, "the buffers cross a page"
                .cerror (PLAYER_FRAMES & 255) != 0, "the player's frames start on a page"

; How each frame is made from the twelve.
player_made     .binary "player-made.bin"
                .bend
