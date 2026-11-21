; SPDX-License-Identifier: GPL-2.0-or-later
; Big Honk, Sleazeburg's crime boss: a goose in shades and a gold chain who has the run of The Moat.
;
; The browser game's design (specs/design.md there) has him wander the canal down the middle of the city and
; its two banks, x 800 to 959, the whole length of the city, and nothing can hurt him. Here:
;
; Wandering. He walks one of four ways at 18 pixels a second, and swims just as fast. Every so often, and
; whenever the way he is going stops being one he likes, he picks a way again: he likes the banks and the
; water, and a road (a bridge) only when he is ready to cross one, which he is three times in ten. He tries
; the ways in turn from a random one, the way back last; if he likes none, he goes any way that keeps him on
; The Moat. He looks REACH pixels ahead, so he turns before the edge of it.
;
; Nothing hurts him. A car that runs into him (its middle within HIT pixels of his on both axes, going at
; 0.6 pixels a frame or more) only ruffles him: for FLAP_TIME frames he flaps, wings out and in, and runs
; away from it at 44 pixels a second, along the axis it is further off on, as far as The Moat goes. While he
; flaps nothing ruffles him again. The player's car is looked for in every frame he moves in; traffic only
; while he is near a bridge, the one place a traffic car can reach him. Traffic does not stop for him: the
; cars here do not look out for people yet.
;
; His picture: a multicolour sprite (tools/assets.mjs draws it) in the character set's last free characters,
; white with the black and yellow every multicolour sprite shares (foot.init sets them), one frame for each
; way he faces and another with his wings out. Walking or swimming he sways a pixel from side to side, a step
; every four pixels; flapping, his wings beat every four frames. He is listed for the multiplexer after the
; traffic, and like it only while all of his sprite is above the black band.
;
; Time. A frame that moves the screen a character has no time to spare, so in one of those he stands still:
; he is only listed for the multiplexer, and his counts (wait, flap) wait too. The frame after it never moves
; the screen, so he never misses two in a row, and a car cannot run through him unseen: it takes at least
; five frames to cross him.
;
; This code is copied above the colour routines when the program starts (see HIGH_CODE in main.asm). His
; random numbers are his own, so the traffic's do not depend on what he does.
;
; tests/e2e/honk-model.mjs does the same in JavaScript, and the tests hold the two to each other exactly.

HONK_X0         = 800                   ; The Moat: from here ...
HONK_X1         = 960                   ; ... to here, not included
HONK_START_X    = 808                   ; where a new game finds him: the west bank
HONK_START_Y    = 840
HONK_SPRITE     = (charset + 184 * 8) / 64      ; frames 2 * way + flapping (tools/assets.mjs)
HONK_COLOUR     = WHITE | $80           ; $80: a multicolour sprite (sprites.add)

honk            .block
WALK            = 92                    ; 18 pixels a second, in 1/256 pixel a frame
RUN             = 225                   ; 44
FLAP_TIME       = 60                    ; 1.2 seconds
ROAD_ODDS       = 77                    ; ready to cross a road when his random byte is below this: 0.3
REACH           = 9                     ; how far ahead he looks
HIT             = 10                    ; how near a car's middle hits him, either way on both axes
RUN_OVER        = 154                   ; going at least this fast, in 1/256 pixel a frame, on either axis
TRAFFIC_RUN_OVER = 77                   ; the same for a traffic car's speed, which is in 1/128 pixel a frame

                .section bss
pos             .fill 6                 ; x: fraction, pixel low and high; then y the same
way             .byte ?                 ; the way he faces and goes: 0 east, 1 south, 2 west, 3 north
wait            .byte ?                 ; frames he moves in until he picks a way again
flap            .byte ?                 ; and left flapping
jay             .byte ?                 ; this leg's random byte: below ROAD_ODDS, he will cross a road
seed            .byte ?                 ; his random numbers
try             .byte ?                 ; pick: the way being tried, and how many are left
tries           .byte ?
nx              .word ?                 ; ahead: the point he looks at
ny              .word ?
ox              .word ?                 ; close: what might hit him
oy              .word ?
amount          .byte ?                 ; move
diff            .byte ?                 ; within
bx              .byte ?, ?              ; close: where it is from him, across and down, plus HIT
far             .byte ?                 ; struck
wings           .byte ?                 ; show: 1 with his wings out
                .send

init            ldx #5
-               lda start_pos,x
                sta pos,x
                dex
                bpl -
                lda #1                  ; facing south, picking a way at once
                sta way
                sta wait
                lda #0
                sta flap
                sta jay
                lda #$5a
                sta seed
                rts
start_pos       .byte 0, <HONK_START_X, >HONK_START_X, 0, <HONK_START_Y, >HONK_START_Y

; A random byte: an 8-bit linear feedback shift register, which goes through every value but 0.
rnd             lda seed
                asl
                bcc +
                eor #$1d
+               sta seed
                rts

; Once a pass of the main loop, after the cars and the window have moved.
update          jsr screen_moves        ; the screen moving a character this frame: he stands still
                bcc +
                rts
+               lda flap
                bne flapping
                jsr hits
                lda flap
                bne flapping
                dec wait                ; walking or swimming
                beq +
                lda way
                jsr wants
                bcc ++
+               jsr pick
+               lda #WALK
                jmp move
flapping        dec flap                ; running off, as far as The Moat goes
                lda way
                jsr ahead
                bcs +
                lda #RUN
                jmp move
+               rts

; Move A/256 of a pixel the way he goes.
move            sta amount
                ldy way
                ldx axis,y
                cpy #2
                bcs back
                clc                     ; east or south
                lda pos,x
                adc amount
                sta pos,x
                bcc +
                inc pos + 1,x
                bne +
                inc pos + 2,x
+               rts
back            sec                     ; west or north
                lda pos,x
                sbc amount
                sta pos,x
                bcs moved
                lda pos + 1,x
                bne +
                dec pos + 2,x
+               dec pos + 1,x
moved           rts

; Pick a way to go, and how long until he picks again.
pick            jsr rnd
                sta jay
again           jsr rnd                 ; the four ways in turn from a random one, the way back left for last
                sta try
                lda #4
                sta tries
-               lda try
                and #3
                sta try
                eor #2
                cmp way
                beq +
                lda try
                jsr wants
                bcc chosen
+               inc try
                dec tries
                bne -
                lda way                 ; the way back
                eor #2
                sta try
                jsr wants
                bcc chosen
                lda jay                 ; none he likes: any way that keeps him on The Moat, roads included
                beq +                   ; (if that was so already, he keeps going as he was)
                lda #0
                sta jay
                beq again
chosen          lda try
                sta way
+               jsr rnd
                ora #64                 ; 64-255 frames: 1.3 to 5.1 seconds
                sta wait
                rts

; C clear if he likes the way A: what is REACH pixels ahead is on The Moat, and is a bank or the water, or a
; road when he is ready to cross one.
wants           jsr ahead
                bcs no
                cmp #2
                bcs yes                 ; the banks and the water
                lda jay                 ; a road: a bridge
                cmp #ROAD_ODDS
                bcc yes
no              sec
                rts
yes             clc
                rts

; The point REACH pixels ahead of him the way A, in nx and ny. C set if it is off The Moat or outside the
; city; otherwise C clear and A = its tile row % 12, 0 or 1 on a road (a bridge, across The Moat).
ahead           tay
                clc
                lda pos + 1
                adc reach_x,y
                sta nx
                lda pos + 2
                adc reach_xh,y
                sta nx + 1
                clc
                lda pos + 4
                adc reach_y,y
                sta ny
                lda pos + 5
                adc reach_yh,y
                sta ny + 1
                sec
                lda nx
                sbc #<HONK_X0
                tax
                lda nx + 1
                sbc #>HONK_X0
                bne off
                cpx #HONK_X1 - HONK_X0
                bcs off
; The same for the point ny down only: C set outside the city, else C clear and A = its tile row % 12.
row             lda ny + 1
                asl
                asl
                asl
                asl
                sta diff
                lda ny
                lsr
                lsr
                lsr
                lsr
                ora diff
                cmp #MAP_SIZE
                bcs off
                tay
                lda traffic.mod12,y     ; (the carry is clear)
                rts
off             sec
                rts

; Has a car run into him? The player's car, going fast enough, and near a bridge the traffic. If one has, he
; is struck.
hits            jsr speedy
                bcc traffic_cars
                lda car.pos_x + 1
                sta ox
                lda car.pos_x + 2
                sta ox + 1
                lda car.pos_y + 1
                sta oy
                lda car.pos_y + 2
                sta oy + 1
                jsr close
                bcc struck
traffic_cars    lda pos + 4             ; near a bridge: his tile row % 12 is 11, 0, 1 or 2
                sta ny
                lda pos + 5
                sta ny + 1
                jsr row
                cmp #3
                bcc +
                cmp #11
                bcc none
+               ldx #SLOTS - 1
-               lda traffic.on,x
                beq next
                lda traffic.sp,x
                cmp #TRAFFIC_RUN_OVER
                bcc next
                lda traffic.pl,x
                sta ox
                lda traffic.ph,x
                sta ox + 1
                lda traffic.pl + N1,x
                sta oy
                lda traffic.ph + N1,x
                sta oy + 1
                jsr close
                bcc struck
next            dex
                bpl -
none            rts

; Something hit him from bx across and bx + 1 down: he flaps, and runs away from it along the axis it is
; further off on (across, if it is as far off on both).
struck          lda #FLAP_TIME
                sta flap
                lda bx
                jsr apart
                sta far
                lda bx + 1
                jsr apart
                cmp far
                beq across
                bcs down
across          lda bx
                cmp #HIT + 1            ; east of him: he runs west
                lda #0
                bcc +
                lda #2
+               sta way
                rts
down            lda bx + 1
                cmp #HIT + 1            ; south of him: he runs north
                lda #1
                bcc +
                lda #3
+               sta way
                rts
apart           sec                     ; |A - HIT|
                sbc #HIT
                bcs +
                eor #$ff
                adc #1
+               rts

; C set if the player's car is going at RUN_OVER or more along either axis.
speedy          ldy #2                  ; down, then across
fast_axis       lda car.vel_x + 1,y
                beq forward
                cmp #$ff
                bne fast_yes            ; 256 or more either way
                lda car.vel_x,y         ; -256 to -1
                cmp #256 - RUN_OVER + 1
                bcc fast_yes
                bcs fast_next
forward         lda car.vel_x,y         ; 0 to 255
                cmp #RUN_OVER
                bcs fast_yes
fast_next       dey
                dey
                bpl fast_axis
                clc
                rts
fast_yes        sec
                rts

; C clear if (ox, oy) is within HIT of him on both axes, with bx and bx + 1 the differences plus HIT.
close           sec
                lda ox
                sbc pos + 1
                sta diff
                lda ox + 1
                sbc pos + 2
                jsr within
                bcs +
                sta bx
                sec
                lda oy
                sbc pos + 4
                sta diff
                lda oy + 1
                sbc pos + 5
                jsr within
                sta bx + 1
+               rts

; C clear if the difference A (high byte) and diff (low) is HIT or less either way, and then A = it plus HIT.
within          tay
                clc
                lda diff
                adc #HIT
                bcc +
                iny
+               cpy #0
                bne out
                cmp #2 * HIT + 1
                rts
out             sec
                rts

; List him for the multiplexer, after traffic.show, which leaves the window's corner, moved by where a sprite
; can start, in traffic.cx and cy. Placed as a car is, but shown only down to a line higher, which leaves
; room for his sway.
show            sec                     ; down: 0 to LOWEST - 1 from cy
                lda pos + 4
                sbc traffic.cy
                tay
                lda pos + 5
                sbc traffic.cy + 1
                bne hidden
                cpy #LOWEST
                bcs hidden
                sec                     ; across: 0-326 from cx
                lda pos + 1
                sbc traffic.cx
                sta sprites.sx
                lda pos + 2
                sbc traffic.cx + 1
                beq +
                cmp #1
                bne hidden
                lda sprites.sx
                cmp #326 - 256 + 1
                bcs hidden
                lda #1
+               sta sprites.sx + 1
                tya                     ; the sprite registers, as for a car (traffic.show)
                clc
                adc #55 - 10 - 1 - 10
                sta sprites.sy
                clc
                lda sprites.sx
                adc #31 - 12 - 11
                sta sprites.sx
                bcc +
                inc sprites.sx + 1
+               lda flap                ; the sway, walking or swimming: a pixel every other four pixels along
                bne picture             ; the way he goes, and across it
                ldy way
                ldx axis,y
                lda pos + 1,x
                and #4
                beq picture
                tya
                lsr
                bcs sway_x
                inc sprites.sy          ; going east or west: a line down
                bne picture
sway_x          inc sprites.sx          ; going north or south: a pixel right
                bne picture
                inc sprites.sx + 1
picture         lda flap                ; flapping: wings out every other four frames
                lsr
                lsr
                and #1
                sta wings
                lda way
                asl
                ora wings
                adc #HONK_SPRITE        ; (the carry is clear)
                sta sprites.sp
                lda #HONK_COLOUR
                sta sprites.sc
                jmp sprites.add
hidden          rts

axis            .byte 0, 3, 0, 3        ; each way's axis, as an index into pos
reach_x         .byte <REACH, 0, <-REACH, 0
reach_xh        .byte 0, 0, $ff, 0
reach_y         .byte 0, <REACH, 0, <-REACH
reach_yh        .byte 0, 0, 0, $ff
                .bend
