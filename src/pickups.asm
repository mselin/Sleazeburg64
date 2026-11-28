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
; Someone the player kills may drop cash or a knife where they fell (drop, at the end): it lies 20 seconds.
;
; tests/e2e/pickups-model.mjs does the same in JavaScript, and the tests hold the two to each other.

pickups         .block

COUNT           = 12                    ; (the design has 34: on the C64 a third as many, for the frame time)
REACH           = 11                    ; how near the player's middle comes to one's to pick it up, either way
TURN_EACH       = 2                     ; looked at for nearness each frame: each every 6 frames
PAINT_COL       = police.PAINT_X / 16   ; the paint shop's tile
PAINT_ROW       = police.PAINT_Y / 16
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

A_CAP           = 53                    ; r from which the arrow's offset along the smaller distance is 255
; The arrow's working (arrow_round), in zero page the music test builds' tune has (they have no pickups).
                .virtual $e0
a_t             .word ?                 ; a value worked on (and the bigger distance, shifted)
a_big           = a_t
a_in            .byte ?                 ; the shop in the view: a bit clear by axis
a_d             .byte ?, ?              ; how far to the shop, x then y: low ...
a_dh            .byte ?, ?              ; ... and high
a_neg           .byte ?, ?              ; bit 7: it is the other way (left, up)
a_swap          .byte ?                 ; 0: x is the bigger; 1: y
a_r             .byte ?
a_way           .byte ?                 ; 0-15: clockwise from east
a_shown         .byte ?                 ; the way in ARROW_FRAME
a_off           .byte ?                 ; along the smaller
a_so            .byte ?                 ; the S's two offsets
a_i             .byte ?
a_at_lo         .byte ?, ?, ?, ?        ; where: the arrow's x, the S's x, the arrow's y, the S's y
a_at_hi         .byte ?, ?, ?, ?
                .cerror * > $f8, "the arrow's working runs into src (main.asm)"
                .endv

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
                ldx #$ff                ; no way in the arrow's frame yet
                stx a_shown
                jsr window_tile
                sta last_col
                sty last_row
                jmp all_near

; Pickup who somewhere new: a pavement, grass or plaza tile, not by the start, its kind by the shares
; (place_io, under the I/O area).
place           #io_gate place_io
                .section io_more
place_io        jsr rnd
                cmp #MAP_SIZE
                bcs place_io
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
                bcc place_io
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
                bne place_io
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
                .send

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
                jsr age                 ; (what has been dropped, every frame)
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
                inc rounds
                jsr paint_near          ; (and the paint shop and the arrow, once a round: X not kept)
                ldx #0
+               stx turn
                dec looks
                bne look_each
                rts
jumped          sty last_row
all_now         jmp all_near

; C set if pickup X is picked up, the player on it (show): then away, having done what it does. X kept.
taking          jsr middle
                jsr reached
                bcs +
                stx who
                jsr take
                ldx who
                sec                     ; (picked up)
                rts
+               clc                     ; (not)
                rts

; C clear if the player's middle is within REACH of mid_x, mid_y either way.
reached         sec
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
                jmp within
+               rts

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
                jmp paint_near

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

; Pickup who is picked up: what it does (take_io, under the I/O area: it happens now and then), then away
; for 40 to 70 seconds. A donut that takes the last of the heat away quiets the police here, outside: that
; writes the SID and the border.
take            lda status.heat
                pha
                jsr gate_take
                pla
                beq +
                lda status.heat
                bne +
                jmp police.quiet
+               rts
gate_take       #io_gate take_io

                .section io_code        ; (under the I/O area: main.asm, run through a gate there)
take_io         ldx who
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
knife           lda status.knife        ; a knife: kept, or a spare one pawned for $10
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
                sta status.stars_shown  ; (none left: take quiets the police, near or not)
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
                .send

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
+               jmp show_drops          ; and what has been dropped
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
+               lda kind,x
; Listed if in sight: one of kind A, its middle at mid_x, mid_y, bobbing. X kept.
sight           sta seen
                tay
                clc
                adc #PICKUP_SPRITE
                sta sprites.sp
                lda colour,y
                sta sprites.sc
                lda clock               ; the bob
                lsr
                lsr
                lsr
                lsr
                and #1
; in_view: listed if in sight: sprites.sp and sprites.sc, its middle at mid_x, mid_y, A pixels lower (gun.show too). X
; kept.
in_view         sta mid_hi
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
+               stx who
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
seen            .byte 0                 ; sight: the kind

; ---------- what someone the player kills drops ----------
; The design: cash 40 % of the time, $10 to $90 in steps of $10, or a knife 8 % if the player has none. It
; lies where they were killed for 20 seconds, blinking in the last 4, and is picked up as a pickup is (but
; does not come back). DROPS at once: one more, with none free, is not dropped. The kinds: 1-9, cash of that
; many tens of dollars; DROP_KNIFE; AWAY, none.

DROPS           = 3
DROP_LIFE       = 20 * 50               ; frames
BLINK           = 4 * 50                ; the last frames, hidden every other 8 of them
DROP_KNIFE      = 10
DROP_CASH_ODDS  = 102                   ; a random byte below this, cash: 40 %
DROP_KNIFE_ODDS = 123                   ; ... else below this, a knife: 8 %

                .section low_more       ; (where there is room: main.asm)
; Person X (people.asm), killed by the player: what they drop, if anything (drop_io, under the I/O area). X kept.
drop            #io_gate drop_io
                .section io_code
drop_io         lda people.col,x        ; a scooter rider: nothing (the design: they pay $0)
                cmp #LIGHT_GREEN
                beq no_drop
                jsr rnd
                cmp #DROP_CASH_ODDS
                bcc drop_cash
                cmp #DROP_KNIFE_ODDS
                bcs no_drop
                lda status.knife
                bne no_drop
                lda #DROP_KNIFE
                bne drop_it
drop_cash       jsr rnd                 ; $10 to $90
-               cmp #9
                bcc +
                sbc #9
                bcs -
+               adc #1                  ; (the carry is clear)
drop_it         ldy #DROPS - 1          ; a place for it
-               pha
                lda dkind,y
                cmp #AWAY
                beq +
                pla
                dey
                bpl -
no_drop         rts
+               pla
                sta dkind,y
                lda people.xl,x
                sta dx_lo,y
                lda people.xh,x
                sta dx_hi,y
                lda people.yl,x
                sta dy_lo,y
                lda people.yh,x
                sta dy_hi,y
                lda #<DROP_LIFE
                sta dlife_lo,y
                lda #>DROP_LIFE
                sta dlife_hi,y
                rts
                .send

; Once a frame: the time each has left, and gone when it is up.
age             ldx #DROPS - 1
-               lda dkind,x
                cmp #AWAY
                beq next_age
                lda dlife_lo,x
                bne +
                dec dlife_hi,x
+               dec dlife_lo,x
                bne next_age
                lda dlife_hi,x
                bne next_age
                lda #AWAY
                sta dkind,x
next_age        dex
                bpl -
                rts

; After the near ones: each dropped one picked up if the player is on it (not in a frame of colour memory);
; else listed if in sight, unless blinking off.
show_drops      ldx #DROPS - 1
-               lda dkind,x
                cmp #AWAY
                beq next_drop
                lda dx_lo,x
                sta mid_x
                lda dx_hi,x
                sta mid_x + 1
                lda dy_lo,x
                sta mid_y
                lda dy_hi,x
                sta mid_y + 1
                lda busy
                bne +
                jsr reached
                bcs +
                jsr take_drop
                jmp next_drop
+               lda dlife_hi,x          ; its last BLINK frames: hidden every other 8
                bne +
                lda dlife_lo,x
                cmp #BLINK
                bcs +
                lda clock
                and #8
                bne next_drop
+               lda dkind,x
                cmp #DROP_KNIFE
                lda #KIND_KNIFE
                bcs +
                lda #KIND_CASH
+               jsr sight
next_drop       dex
                bpl -
paint_hook      rts                     ; then the paint shop's marker: written JMP when it is near (paint_near),
                .word show_paint        ; so it costs nothing while it is not
                .send
                .section low_code       ; (where there is room: main.asm)

; The paint shop's marker (the browser game's `marker`): a P, flashing cyan and white each 16 frames, at the
; shop's middle; always shown, heat or not.
show_paint
paint_skip      bit show_arrow          ; written JMP when the shop is not near (paint_near): then only the arrow
                lda #MARKER_FRAMES / 64
                sta sprites.sp
                lda clock
                and #16
                beq +
                lda #CYAN | $80
                .byte $2c               ; (bit: past the next)
+               lda #WHITE | $80
                sta sprites.sc
                lda #<police.PAINT_X
                sta mid_x
                lda #>police.PAINT_X
                sta mid_x + 1
                lda #<police.PAINT_Y
                sta mid_y
                lda #>police.PAINT_Y
                sta mid_y + 1
                lda #0
                jsr in_view
paint_tail      rts                     ; then the arrow to it: written JMP when it is shown (arrow_round)
                .word show_arrow

; Whether the paint shop is near the window (as near_one has it for a pickup): show_drops then shows it.
paint_near      sec
                lda #(PAINT_COL + NEAR_TILES) & 255
                sbc last_col
                cmp #19 + 2 * NEAR_TILES + 1
                bcs +
                sec
                lda #(PAINT_ROW + NEAR_TILES) & 255
                sbc last_row
                cmp #10 + 2 * NEAR_TILES + 1
                lda #$2c                ; (near: bit, past the jump to the arrow; and show_paint, jmp)
                ldy #$4c
                bcc ++
+               lda #$4c                ; (not: jmp to the arrow; and rts, unless arrow_round has it)
                ldy #$60
+               sta paint_skip
                sty paint_hook
                jmp arrow_round
                .send
                .section low_more
; ---------- the arrow to the paint shop ----------
; With heat, at the wheel, and the shop not on the screen (12 pixels in from its edges), the browser game's
; `edgeArrow`: a cyan arrow at the edge of the view towards the shop, and an S on black beside it. Worked out
; once a round, here (from paint_near): the way to the shop from the player, as r = 64 * small / big of the
; two distances (shifted under 256) and which is which: one of 16 ways (11.25 and 33.75 degrees: r 13, 43),
; its frame copied to ARROW_FRAME when it changes; the arrow 400 pixels that way, along the bigger distance
; (past the edge) and A_OFF[r] along the smaller, kept 10 pixels inside the view; the S 12 pixels back
; towards the player (A_S[r / 2]), kept 1 pixel inside. Shown each frame from those (show_arrow).
arrow_round     lda status.heat
                beq arrow_off
                lda foot.on
                bne arrow_off
                ldx #1                  ; y, then x
-               txa
                asl
                tay
                sec                     ; the shop in the view, less 13: in it if under SPAN
                lda a_pm_lo,x
                sbc cam_lo,x
                sta a_t
                lda a_pm_hi,x
                sbc cam_hi,x
                sta a_t + 1
                lda a_t
                cmp a_span_lo,x
                lda a_t + 1
                sbc a_span_hi,x
                rol a_in                ; (C clear: in)
                sec                     ; the way to it from the player, and its sign
                lda a_paint_lo,x
                sbc player_at,y
                sta a_d,x
                lda a_paint_hi,x
                sbc player_at + 1,y
                sta a_dh,x
                sta a_neg,x
                bpl +
                lda #0
                sec
                sbc a_d,x
                sta a_d,x
                lda #0
                sbc a_dh,x
                sta a_dh,x
+               dex
                bpl -
                lda a_in
                and #3
                bne +
arrow_off       lda #$60                ; (rts: no arrow)
                sta paint_tail
                rts
+
-               lda a_dh                ; both under 256
                ora a_dh + 1
                beq +
                lsr a_dh
                ror a_d
                lsr a_dh + 1
                ror a_d + 1
                jmp -
+               ldx #0                  ; which is bigger: x (0, or the same), or y (1)
                lda a_d
                cmp a_d + 1
                bcs +
                inx
+               stx a_swap
                lda a_d,x
                sta a_big
                txa
                eor #1
                tax
                lda a_d,x               ; r = 64 * small / big, 0-63
                ldx #6
                stx a_r                 ; (its top two bits shifted out)
-               asl
                bcs +
                cmp a_big
                bcc ++
+               sbc a_big
                sec
+               rol a_r
                dex
                bne -
                lda a_r
                and #63
                sta a_r
                ldy #0                  ; the way
                cmp #13
                bcc +
                iny
                cmp #43
                bcc +
                iny
+               sty a_way
                lda a_swap
                beq +
                lda #4
                jsr from_way
+               bit a_neg
                bpl +
                lda #8
                jsr from_way
+               bit a_neg + 1
                bpl +
                lda #16
                jsr from_way
                and #15
                sta a_way
+               ldx a_r                 ; the offset along the smaller
                lda #255
                cpx #A_CAP
                bcs +
                lda a_off_at,x
+               sta a_off
                txa
                lsr
                tax
                lda a_s_at,x
                sta a_so
                jmp arrow_axes
from_way        sec
                sbc a_way
                sta a_way
                rts
                .send
                .section tile_room4     ; (where there is room: main.asm)
; Where the arrow and the S go, on each axis X, from player_at, the way and the offsets (arrow_round).
arrow_axes      ldx #1
-               txa
                asl
                sta a_i                 ; the arrow's bounds and place: 2 * X, the S's after
                cpx a_swap
                bne +
                lda a_neg,x             ; the bigger: past the edge, either way
                ora #4
                sta a_t + 1
                bne ++
+               tay
                sec                     ; the smaller: from the player, A_OFF that way
                lda player_at,y
                sbc cam_lo,x
                sta a_t
                lda player_at + 1,y
                sbc cam_hi,x
                sta a_t + 1
                lda a_k,x
                jsr a_add
                lda a_off
                jsr a_move
+               jsr a_clamp
                lda a_so                ; the S: back towards the player, its offset on this axis
                cpx a_swap
                bne +
                lsr
                lsr
                lsr
                lsr
+               and #15
                jsr a_back
                inc a_i
                jsr a_clamp
                dex
                bpl -
                lda a_way
                cmp a_shown
                beq +
                sta a_shown
                jsr arrow_copy
+               lda #$4c                ; (jmp: shown)
                sta paint_tail
                sta paint_hook
                rts
                .send
                .section stack_code
; a_t (16 bits) to the bounds a_i (A_LOW to A_HIGH), and kept at that place in a_at. X kept.
a_clamp         ldy a_i
                lda a_t + 1
                bmi a_low
                bne +
                lda a_t
                cmp a_low_at,y
                bcc a_low
+               lda a_high_lo,y
                cmp a_t
                lda a_high_hi,y
                sbc a_t + 1
                bcs a_put
                lda a_high_lo,y
                sta a_t
                lda a_high_hi,y
                sta a_t + 1
                bcc a_put
a_low           lda a_low_at,y
                sta a_t
                lda #0
                sta a_t + 1
a_put           lda a_t
                sta a_at_lo,y
                lda a_t + 1
                sta a_at_hi,y
                rts
                .send
                .section car_extra      ; (where there is room: TOP_CODE, waiting.asm)
; a_t less A the way the shop is on axis X (a_back), or more (a_move), or more (a_add). X kept.
a_back          ldy a_neg,x
                bpl a_sub
                bmi a_add
a_move          ldy a_neg,x
                bmi a_sub
a_add           clc
                adc a_t
                sta a_t
                bcc +
                inc a_t + 1
+               rts
a_sub           eor #$ff
                sec
                adc a_t
                sta a_t
                bcs +
                dec a_t + 1
+               rts
                .send
                .section gap_code
a_off_at                                ; 400 r / sqrt(1 + r * r), r = i / 64: under 256 up to A_CAP
                .for i = 0, i < A_CAP, i += 1
                .byte round(400.0 * i / 64 / sqrt(1 + (i / 64.0) ** 2))
                .next
; Bounds, as sprite positions, by place (the arrow's x, the S's x, the arrow's y, the S's y): the arrow's
; middle 10 pixels inside the view, the S's black square 1 inside (lx - 1 at 0; its sprite 30 and 53 on)
a_low_at        .byte 10 + 26, 1 + 30, 10 + 49, 1 + 53
a_high_lo       .byte <(VIEW_W - 10 + 26), <(VIEW_W - 9 + 30), VIEW_H - 10 + 49, VIEW_H - 9 + 53
a_high_hi       .byte >(VIEW_W - 10 + 26), >(VIEW_W - 9 + 30), 0, 0
                .send
                .section police_extra   ; (where there is room: EXTRA_CODE, waiting.asm)
a_frame         .byte ARROW_FRAME / 64, SIGN_FRAME / 64
a_colour        .byte CYAN, CYAN | $80  ; (the arrow hi-res, the S multicolour)
a_s_at                                  ; 12 / sqrt(1 + r * r) by 16, and 12 r / sqrt(1 + r * r), r = i / 32
                .for i = 0, i < 32, i += 1
                .byte round(12 / sqrt(1 + (i / 32.0) ** 2)) * 16 + round(12.0 * i / 32 / sqrt(1 + (i / 32.0) ** 2))
                .next
; By axis (x, y): the shop, and less 13; how far in from that it is in the view (12 pixels in from each edge)
a_paint_lo      .byte <police.PAINT_X, <police.PAINT_Y
a_paint_hi      .byte >police.PAINT_X, >police.PAINT_Y
a_pm_lo         .byte <(police.PAINT_X - 13), <(police.PAINT_Y - 13)
a_pm_hi         .byte >(police.PAINT_X - 13), >(police.PAINT_Y - 13)
a_span_lo       .byte <(VIEW_W - 25), <(VIEW_H - 25)
a_span_hi       .byte >(VIEW_W - 25), >(VIEW_H - 25)
a_k             .byte 26, 49            ; from the view to the arrow's sprite: its middle at its pixel 5, line 5
                .send
                .section low_more
; Each frame, after the drops (or the shop's marker), with the arrow on: the S, then the arrow. X kept.
show_arrow      stx who
                ldx #1
-               lda a_at_lo,x
                sta sprites.sx
                lda a_at_hi,x
                sta sprites.sx + 1
                lda a_at_lo + 2,x
                sta sprites.sy
                lda a_frame,x
                sta sprites.sp
                lda a_colour,x
                sta sprites.sc
                txa
                pha
                jsr sprites.add
                pla
                tax
                dex
                bpl -
                ldx who
                rts
                .send
; The arrow's frame for way a_way, into ARROW_FRAME (arrow_copy_io, under the I/O area).
arrow_copy      #io_gate arrow_copy_io
                .section io_late
arrow_copy_io   lda a_way
                ldy #0                  ; ways 0-8: their lines from the top down
                ldx #3
                cmp #9
                bcc +
                eor #$ff                ; ways 9-15: way 16 less, upside down (the same, as tools/assets.mjs checks)
                adc #16                 ; (C set)
                ldy #10 * 3
                ldx #256 - 3
+               stx a_t                 ; from line to line
                tax
                lda #0
                clc
-               dex                     ; 22 bytes a way
                bmi +
                adc #22
                bcc -                   ; (always)
+               tax
                lda #11
                sta a_t + 1
-               lda arrow_ways,x
                sta ARROW_FRAME,y
                lda arrow_ways + 1,x
                sta ARROW_FRAME + 1,y
                inx
                inx
                tya
                clc
                adc a_t
                tay
                dec a_t + 1
                bne -
                rts
arrow_ways      .binary "arrows.bin"    ; ways 0-8, each its 11 lines of 2 bytes (tools/assets.mjs)
                .send

                .section low_more

; Dropped one X picked up (take_drop_io, under the I/O area). X kept.
take_drop       #io_gate take_drop_io
                .section io_code
take_drop_io    lda dkind,x
                pha
                lda #AWAY
                sta dkind,x
                lda #1
                sta status.changed
                pla
                cmp #DROP_KNIFE
                bne +
                jmp knife
+               asl                     ; that many tens of dollars
                asl
                asl
                asl
                ldy #0
                jmp pay
                .send

dkind           .fill DROPS, AWAY
dx_lo           .fill DROPS, 0          ; where, in pixels: where the one who dropped it was
dx_hi           .fill DROPS, 0
dy_lo           .fill DROPS, 0
dy_hi           .fill DROPS, 0
dlife_lo        .fill DROPS, 0          ; frames left
dlife_hi        .fill DROPS, 0
                .send
                .bend
