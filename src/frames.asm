; SPDX-License-Identifier: GPL-2.0-or-later
; The player on foot's sprite frames, made when the program starts.
;
; tools/assets.mjs draws 42 frames: eight directions in five walking poses, and two swimming. Turning a figure
; over gives another of them, so the program file holds only twelve (player_data), and this makes all 42 at
; PLAYER_FRAMES, where the video chip can see them: each is one of the twelve as it is, or flipped left to
; right, or top to bottom (within lines 0-19: line 20 is empty), or both. player_made has, for each frame,
; the frame it is made from * 4, + 1 if flipped left to right, + 2 if top to bottom.
;
; This runs once, from where it waits after the map, before a colour routine is written over it and the
; frames it reads (video.init). It uses car.mp and car.t16 to point at the frame read and the frame made.

PLAYER_FRAME_COUNT = 42

frames          .block

                .section bss
n               .byte ?                 ; the frame, how it is flipped, the row and where that is from
flips           .byte ?
row             .byte ?
from_row        .byte ?
pairs           .byte ?
out             .byte ?
                .send

make            lda #<PLAYER_FRAMES
                sta car.t16
                lda #>PLAYER_FRAMES
                sta car.t16 + 1
                ldx #0
make_one        stx n
                lda player_made,x
                and #3
                sta flips
                lda player_made,x
                lsr
                lsr
                sta car.mp + 1          ; times 64
                lda #0
                lsr car.mp + 1
                ror
                lsr car.mp + 1
                ror
                clc
                adc #<player_data
                sta car.mp
                lda car.mp + 1
                adc #>player_data
                sta car.mp + 1
                lda #0
                sta row                 ; where the row being made starts: 0, 3 ... 57
make_row        lda row
                ldx flips
                cpx #2
                bcc +
                lda #57                 ; top to bottom: from the row as far from the other end
                sec
                sbc row
+               sta from_row
                ldx #0
make_byte       lda flips
                lsr
                bcc +
                stx out                 ; left to right: from the byte at the other end of the row, its
                lda #2                  ; pixels the other way round
                sec
                sbc out
                clc
                adc from_row
                tay
                lda (car.mp),y
                jsr pairs_back
                jmp ++
+               txa
                clc
                adc from_row
                tay
                lda (car.mp),y
+               pha
                txa
                clc
                adc row
                tay
                pla
                sta (car.t16),y
                inx
                cpx #3
                bne make_byte
                lda row
                clc
                adc #3
                sta row
                cmp #60
                bne make_row
                tay                     ; line 20 and the byte after it are empty
                lda #0
-               sta (car.t16),y
                iny
                cpy #64
                bne -
                clc
                lda car.t16
                adc #64
                sta car.t16
                bcc +
                inc car.t16 + 1
+               ldx n
                inx
                cpx #PLAYER_FRAME_COUNT
                beq +
                jmp make_one
+               rts

; A with its four pixel pairs in the opposite order.
pairs_back      sta pairs
                lda #0
                ldy #4
-               asl
                asl
                sta out
                lda pairs
                and #3
                ora out
                lsr pairs
                lsr pairs
                dey
                bne -
                rts

; The frames the program file holds, and how the rest are made from them.
player_data     .binary "player.bin"
player_made     .binary "player-made.bin"
                .bend
