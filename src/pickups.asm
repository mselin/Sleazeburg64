; SPDX-License-Identifier: GPL-2.0-or-later
; Pickups, by the browser game's design (specs/design.md there, "Pickups"): COUNT at once, each in the middle
; of a pavement, grass or plaza tile picked at random, never within 32 pixels of where the player starts.
; Ammo (A, a third of them), cash ($), a donut (O), a bandage (+) and a knife (K), in the design's shares.
; The player picks one up within REACH of its middle, on foot or in the car, and it comes back 40 to 70
; seconds later somewhere else.
;
; What they do: ammo, 12 more, to at most 99 (there is no gun yet, so fire on foot is still a punch); cash,
; $50 to $300 in steps of $50; a donut, a level of heat less; a bandage, 40 health back, to at most 100, for
; $20; a knife, the panel shows KNIFE (a spare one is pawned for $10).
;
; How they look: a multicolour sprite each, listed for the multiplexer when in sight (tools/assets.mjs draws
; the five, at PICKUP_FRAMES): a square in the kind's colour, its edge black and its letter in one of the
; shared colours, yellow or black, as a sprite has no other. It bobs up and down a pixel.
;
; Time. In a frame of colour memory they are only shown: neither looked at for nearness nor picked up; in one
; that moves the screen a character, not looked at for nearness. Looking at
; all of them every frame costs too much, so each frame looks at TURN_EACH of them, by turns,
; for whether they are near the window (within NEAR_TILES tiles of it): what the window can reach before their
; turn comes round again. Only the near ones are looked at for being picked up and shown. When the window
; jumps, all of them are looked at at once.
;
; tests/e2e/pickups-model.mjs does the same in JavaScript, and the tests hold the two to each other.

pickups         .block

COUNT           = 12                    ; (the design has 34: on the C64 a third as many, for the frame time)
REACH           = 11                    ; how near the player's middle comes to one's to pick it up, either way
TURN_EACH       = 2                     ; looked at for nearness each frame: each every 6 frames
NEAR_TILES      = 5                     ; tiles round the window (19 by 10 of them) to be looked at closely: the
                                        ; window moves at most 4 pixels a frame, 68 before a pickup's turn again
BACK_MIN        = 83                    ; back after this many of every fourth round of turns, 24 frames (40 seconds)
BACK_SPREAD     = 63                    ; ... and up to this many more (70)
START_COL       = (START_X * 16 + CENTRE_X) / 16        ; the tile the player starts on
START_ROW       = (START_Y * 16 + CENTRE_Y) / 16
CLEAR           = 2                     ; none within this many tiles of it, either way (32 pixels)
PAVEMENT        = 4                     ; a tile's kind (tools/assets.mjs): pavements and plazas ...
GRASS           = 2                     ; ... and grass
AWAY            = $ff                   ; kind: taken, and coming back
KIND_AMMO       = 0
KIND_CASH       = 1
KIND_DONUT      = 2
KIND_BANDAGE    = 3
KIND_KNIFE      = 4
PICKUP_SPRITE   = PICKUP_FRAMES / 64

; Place them all, at start.
init            ldx #COUNT - 1
-               stx who
                jsr place
                ldx who
                dex
                bpl -
                lda #0
                sta turn
                sta clock
                jsr window_tile
                sta last_col
                sty last_row
                jmp all_near

; Pickup who somewhere new: a pavement, grass or plaza tile, not by the start, its kind by the shares.
place           jsr rnd
                cmp #MAP_SIZE
                bcs place
                sta col_now
-               jsr rnd
                cmp #MAP_SIZE
                bcs -
                sta row_now
                sec                     ; not within CLEAR tiles of the start
                lda col_now
                sbc #START_COL - CLEAR
                cmp #2 * CLEAR + 1
                bcs +
                sec
                lda row_now
                sbc #START_ROW - CLEAR
                cmp #2 * CLEAR + 1
                bcc place
+               ldx row_now             ; the tile's kind
                lda video.row_lo,x
                sta car.mp
                lda video.row_hi,x
                sta car.mp + 1
                ldy col_now
                lda (car.mp),y
                tax
                lda tile_kind,x
                cmp #PAVEMENT
                beq +
                cmp #GRASS
                bne place
+               jsr rnd                 ; which: 34 %, 28 %, 18 %, 14 % and 6 %
                ldy #KIND_KNIFE
-               cmp share - 1,y
                bcs +
                dey
                bne -
+               ldx who
                tya
                sta kind,x
                lda col_now
                sta col,x
                lda row_now
                sta row,x
                rts
share           .byte 87, 159, 205, 241 ; a random byte below these: ammo, cash, donut, bandage; else a knife

; A = the window's top left tile across, Y = down: its position over 16 (under 1568, so it fits a byte).
window_tile     lda cam_lo + 1
                lsr
                lsr
                lsr
                lsr
                sta row_now
                lda cam_hi + 1
                asl
                asl
                asl
                asl
                ora row_now
                tay
                lda cam_lo
                lsr
                lsr
                lsr
                lsr
                sta col_now
                lda cam_hi
                asl
                asl
                asl
                asl
                ora col_now
                rts

; Once a pass, after the window has moved: those taken come back in time; TURN_EACH of them are looked at for
; nearness (all of them if the window jumped); and the near ones are picked up if the player is on them.
update          inc clock
                lda busy                ; colour memory this frame, or the screen moving a character: nothing
                bne +                   ; more (show still lists them)
                jsr screen_moves
                bcc ++
+               rts
+               jsr window_tile         ; the window jumped (more than a tile either way): all of them now
                tax
                sec
                sbc last_col
                stx last_col
                clc
                adc #1
                cmp #3
                bcs jumped
                tya
                sec
                sbc last_row
                sty last_row
                clc
                adc #1
                cmp #3
                bcs all_now
                lda #TURN_EACH          ; else TURN_EACH of them: one taken counts down to coming back, then
                sta looks               ; how near
look_each       ldx turn
                lda kind,x
                cmp #AWAY
                bne +
                lda rounds              ; (one taken: its time, every fourth round)
                and #3
                bne +
                dec back,x
                bne +
                stx who
                jsr place
                ldx who
+               jsr near_one
                inx
                cpx #COUNT
                bcc +
                ldx #0
                inc rounds
+               stx turn
                dec looks
                bne look_each
                rts
jumped          sty last_row
all_now         jmp all_near

; C set if pickup X is picked up, the player on it (show): then away, having done what it does. X kept.
taking          jsr middle
                sec
                lda mid_x
                sbc player_at
                tay
                lda mid_x + 1
                sbc player_at + 1
                jsr within
                bcs +
                sec
                lda mid_y
                sbc player_at + 2
                tay
                lda mid_y + 1
                sbc player_at + 3
                jsr within
                bcs +
                stx who
                jsr take
                ldx who
                sec                     ; (picked up)
                rts
+               clc                     ; (not)
                rts

; C clear if the difference A (high), Y (low) is REACH or less either way.
within          sta mid_hi
                tya
                clc
                adc #REACH
                tay
                lda mid_hi
                adc #0
                bne +
                cpy #2 * REACH + 1
                rts
+               sec
                rts

; Nearness for all of them, and the list of the near ones afresh.
all_near        lda #0
                sta listed
                ldx #COUNT - 1
-               sta close,x
                dex
                bpl -
                ldx #COUNT - 1
-               jsr near_one
                dex
                bpl -
                rts

; close,x = 1 if pickup X is within NEAR_TILES tiles of the window's tiles (from last_col, last_row), and the
; list of the near ones (near_list, listed of them) to match: one that comes near goes on its end; one that is
; no longer near is taken off, the last in its place. X kept.
near_one        sec
                lda col,x
                sbc last_col
                clc
                adc #NEAR_TILES
                cmp #19 + 2 * NEAR_TILES + 1    ; (the window is 19 tiles across ...
                bcs far
                sec
                lda row,x
                sbc last_row
                clc
                adc #NEAR_TILES
                cmp #10 + 2 * NEAR_TILES + 1    ; ... and 10 down)
                bcs far
                lda close,x             ; near
                bne +
                inc close,x
                txa
                ldy listed
                sta near_list,y
                inc listed
+               rts
far             lda close,x             ; not near
                beq done
                lda #0
                sta close,x
                ldy listed              ; off the list: find it (it is there), and the last in its place
find            dey
                txa
                cmp near_list,y
                bne find
                dec listed
                stx keep_x
                ldx listed
                lda near_list,x
                sta near_list,y
                ldx keep_x
done            rts

; mid_x, mid_y = the middle of pickup X's tile, in pixels. X kept.
middle          lda col,x
                asl
                asl
                asl
                asl
                ora #8
                sta mid_x
                lda col,x
                lsr
                lsr
                lsr
                lsr
                sta mid_x + 1
                lda row,x
                asl
                asl
                asl
                asl
                ora #8
                sta mid_y
                lda row,x
                lsr
                lsr
                lsr
                lsr
                sta mid_y + 1
                rts

; Pickup who is picked up: what it does, then away for 40 to 70 seconds.
take            ldx who
                lda kind,x
                pha
                lda #AWAY
                sta kind,x
                jsr rnd
-               cmp #BACK_SPREAD        ; (less than BACK_SPREAD: a byte, less it until it is)
                bcc +
                sbc #BACK_SPREAD
                bcs -
+               adc #BACK_MIN           ; (the carry is clear)
                ldx who
                sta back,x
                lda #1
                sta status.changed
                pla
                beq ammo
                cmp #KIND_CASH
                beq cash
                cmp #KIND_DONUT
                beq donut
                cmp #KIND_BANDAGE
                beq bandage
                lda status.knife        ; a knife: kept, or a spare one pawned for $10
                bne +
                inc status.knife
                rts
+               lda #$10
                ldy #0
                jmp pay
ammo            sed                     ; 12 more, to at most 99
                clc
                lda status.ammo
                adc #$12
                bcc +
                lda #$99
+               sta status.ammo
                cld
                rts
cash            jsr rnd                 ; $50 to $300, in steps of $50
-               cmp #6
                bcc +
                sbc #6
                bcs -
+               tax
                lda cash_lo,x
                ldy cash_hi,x
                jmp pay
cash_lo         .byte $50, $00, $50, $00, $50, $00
cash_hi         .byte $00, $01, $01, $02, $02, $03
donut           ldx status.heat         ; a level of heat less, its points to that level's start
                beq +
                dex
                stx status.heat
                lda status.level_lo,x
                sta status.points
                lda status.level_hi,x
                sta status.points + 1
                lda #1
                sta status.stars_shown
+               rts
bandage         lda status.hp           ; 40 health back, to at most 100, for $20 (as far as the money goes)
                clc
                adc #40
                cmp #100
                bcc +
                lda #100
+               sta status.hp
                sed
                sec
                lda status.money
                sbc #$20
                sta status.money
                lda status.money + 1
                sbc #0
                sta status.money + 1
                lda status.money + 2
                sbc #0
                sta status.money + 2
                cld
                bcs +
                lda #0                  ; less than $20: none left
                sta status.money
                sta status.money + 1
                sta status.money + 2
+               rts

; Money += A (low two digits) and Y (the next two), in binary-coded decimal.
pay             sty mid_hi
                sed
                clc
                adc status.money
                sta status.money
                lda status.money + 1
                adc mid_hi
                sta status.money + 1
                lda status.money + 2
                adc #0
                sta status.money + 2
                cld
                rts

                .section pickups_more   ; (where there is room: waiting.asm)
; The near ones: picked up if the player is on one; else listed for the multiplexer if in sight, after the
; passers-by, as a car's sprite (traffic.show), a pixel lower every other quarter second.
show            lda player_at           ; the player's tile, for a quick look at whether they can be on one
                lsr
                lsr
                lsr
                lsr
                sta p_col
                lda player_at + 1
                asl
                asl
                asl
                asl
                ora p_col
                sta p_col
                lda player_at + 2
                lsr
                lsr
                lsr
                lsr
                sta p_row
                lda player_at + 3
                asl
                asl
                asl
                asl
                ora p_row
                sta p_row
                ldy listed              ; (the near ones, from the end of their list)
                beq +
-               dey
                sty list_at
                ldx near_list,y
                jsr one
                ldy list_at
                bne -
+               rts
; Near one X: picked up, or listed if in sight. X kept.
one             ldy kind,x
                cpy #AWAY
                bne +
                rts
+
                sec                     ; first, quickly: its tile in the window's, or one round it? (All that can
                lda col,x               ; be seen or picked up is: the player is always in sight.)
                sbc last_col
                clc
                adc #1
                cmp #19 + 2 + 1
                bcc +
                rts
+               sec
                lda row,x
                sbc last_row
                clc
                adc #1
                cmp #10 + 2 + 1
                bcc +
                rts
+
                lda busy                ; (not in a frame of colour memory: the next does it)
                bne +
                sec                     ; the player's tile or one next to it: picked up? (not shown then)
                lda col,x
                sbc p_col
                clc
                adc #1
                cmp #3
                bcs +
                sec
                lda row,x
                sbc p_row
                clc
                adc #1
                cmp #3
                bcs +
                jsr taking
                bcc ++
                jmp hidden
+               jsr middle
+               ldy kind,x
                sec                     ; down: 0 to LOWEST - 1 from cy
                lda mid_y
                sbc traffic.cy
                tay
                lda mid_y + 1
                sbc traffic.cy + 1
                bne hidden
                cpy #LOWEST
                bcs hidden
                sec                     ; across: 0-326 from cx
                lda mid_x
                sbc traffic.cx
                sta sprites.sx
                lda mid_x + 1
                sbc traffic.cx + 1
                beq +
                cmp #1
                bne hidden
                lda sprites.sx
                cmp #326 - 256 + 1
                bcs hidden
                lda #1
+               sta sprites.sx + 1
                lda clock               ; the bob
                lsr
                lsr
                lsr
                lsr
                and #1
                sta mid_hi
                tya
                clc
                adc mid_hi
                adc #55 - 10 - 1 - 10   ; (the carry is clear)
                sta sprites.sy
                clc
                lda sprites.sx
                adc #31 - 12 - 11
                sta sprites.sx
                bcc +
                inc sprites.sx + 1
+               lda kind,x
                tay
                clc
                adc #PICKUP_SPRITE
                sta sprites.sp
                lda colour,y
                sta sprites.sc
                stx who
                jsr sprites.add
                ldx who
hidden          rts
colour          .byte ORANGE | $80, GREEN | $80, LIGHT_RED | $80, WHITE | $80, LIGHT_GREY | $80
                .send

; Their own random numbers, 16 bits (a shift register of 65535 steps: the passers-by's 8 bits would place them
; in pairs, as placing one takes three numbers): A = its low byte.
rnd             asl seed
                rol seed + 1
                bcc +
                lda seed
                eor #$2d
                sta seed
+               lda seed
                rts

col             .fill COUNT, 0          ; the tile, across ...
row             .fill COUNT, 0          ; ... and down
kind            .fill COUNT, 0          ; KIND_*, or AWAY
back            .fill COUNT, 0          ; taken: every fourth round of turns until it comes back
close           .fill COUNT, 0          ; 1: near the window (near_one) ...
near_list       .fill COUNT, 0          ; ... and those, listed
listed          .byte 0                 ; how many
list_at         .byte 0
keep_x          .byte 0
p_col           .byte 0                 ; show: the player's tile
p_row           .byte 0
seed            .word $a7e1
clock           .byte 0
turn            .byte 0
looks           .byte 0
rounds          .byte 0                 ; of turns, all of them looked at once each
who             .byte 0
last_col        .byte 0
last_row        .byte 0
col_now         .byte 0
row_now         .byte 0
mid_x           .word 0
mid_y           .word 0
mid_hi          .byte 0
                .bend
