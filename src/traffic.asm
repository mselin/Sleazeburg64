; SPDX-License-Identifier: GPL-2.0-or-later
; Traffic: a handful of cars driving the streets, by the browser game's rules but fewer of them.
;
; The streets are a grid. Every twelfth pair of tile rows and of tile columns is road, so a road is two tiles
; (32 pixels) wide and a crossing, where two meet, is a 32 by 32 pixel square every 192 pixels. Cars keep to
; the right: each direction has its lane down the middle of one of the road's two tiles, 8 or 24 pixels from
; the road's west or north edge (lanes). A car drives straight along its lane at its own speed and decides
; where to go as it drives into a crossing: on, left or right, never back and never off the city. It goes
; straight on half the time if it can, and otherwise any way it can go, straight on included. It turns all
; at once as it reaches the lane it is turning into; the picture turns after it over a few frames.
;
; Cars slow down and stop for any car in front of them in their lane, the player's included (AHEAD_MIN to
; AHEAD_MAX pixels ahead, at most SIDE to the side), and drive on when it has gone. One held up for
; HELD_LIMIT frames stops looking for GHOST_TIME frames, so that cars waiting for each other at a crossing
; cannot wait forever. Traffic cars do not collide with each other. The player's car bounces off them, and
; one it hits hard becomes a wreck (see bump).
;
; New cars appear on the streets off screen, a little way from the player, while there are fewer than CARS,
; and go when they are more than FAR_X or FAR_Y pixels from the player.
;
; The player's own car is not one of these: it is the car in car.asm. But when the player gets out (foot.asm)
; it goes into these tables as a car with no driver, as a wreck is, and a car the player gets into leaves
; them. So the tables have one more place than there is traffic (SLOTS), and new cars stop appearing once
; CARS places are taken: the car the player is in always has a place to go. The car the player left last
; (mine) stays however far away they go. The player is looked out for in the same way on foot as in a car.
;
; Time. Every car moves every frame. The rest (deciding at a crossing, looking ahead, going, appearing) is
; done in any frame but one that works out colour memory, which has least to spare: two cars a frame look
; ahead and check whether to go, in turn, so each car does every fourth such frame, and there is one try at
; a new car every fourth such frame, and none for SPAWN_GAP of them after one has appeared. Six cars is what
; fits: the busiest frames of a rough drive are done 280 raster lines after the bottom interrupt with them.
; The multiplexer could show more.
;
; Units: pixels, with a byte of 1/256 pixel for the position along the lane; speeds in 1/128 pixel a frame.
; Directions: 0 east, 1 south, 2 west, 3 north, so bit 0 is the axis (0 x, 1 y) and bit 1 the sign.
;
; tests/e2e/traffic-model.mjs does the same in JavaScript, and the tests hold the two to each other exactly.

                .weak
CARS            = 5                     ; traffic cars at most (six before the passers-by: see people.asm)
SPAWN           = 1                     ; 0: no new cars appear (for tests that place their own)
                .endweak
                .cerror CARS > MAX_SPRITES, "more cars than the multiplexer can list"

SLOTS           = CARS + 1              ; places for cars in the tables: one more, for a car the player has left
N1              = SLOTS + 1             ; the position tables hold the cars and then the player, x then y
T_ACCEL         = 4                     ; speeding up: 70 pixels a second a second, as in the browser game
T_BRAKE         = 11                    ; slowing down: 220
CRUISE_MIN      = 120                   ; cruising speed: 120-183, 47-71 pixels a second
SLOW_SPEED      = 8                     ; slower than this (3 pixels a second) is held up
HELD_LIMIT      = 175                   ; 3.5 seconds held up ...
GHOST_TIME      = 80                    ; ... and it drives on without looking for 1.6
AHEAD_MIN       = 4
AHEAD_MAX       = 36
SIDE            = 8
P_AHEAD         = 26                    ; look: someone on foot, from the car's middle (the design's distances)
P_SIDE          = 9
FAR_X           = 400
FAR_Y           = 320
NEAR            = 37                    ; a new car: no car within this on both axes
SPAWN_GAP       = 16
SHOWN_X         = 182                   ; ... nor where it would be on screen, with 30 pixels to spare
SHOWN_Y         = 110
LOWEST          = 160                   ; show: the lowest a car's sprite can be, from 10 above the window

traffic         .block

                .section zp
seed            .word ?                 ; for rnd
tick            .byte ?                 ; passes of the main loop
rot             .byte ?                 ; show: the car listed first
spawn_wait      .byte ?
i               .byte ?                 ; the car being moved
ia              .byte ?                 ; its position on its axis, and across, as indexes into the tables
ic              .byte ?
dl              .byte ?
dh              .byte ?
old             .byte ?
want            .byte ?
t0              .byte ?
t1              .byte ?
ax              .word ?                 ; look: the car's position
ay              .word ?
ka              .byte ?                 ; enter: the crossing's number along the way and the road's across
kc              .byte ?
ix              .byte ?
iy              .byte ?
cnt             .byte ?
straight        .byte ?
ways            .byte ?, ?, ?
r1              .byte ?                 ; try_spawn
sdir            .byte ?
slot            .byte ?
nx              .word ?
ny              .word ?
first           .byte ?                 ; show
turns           .byte ?                 ; frames with time for the rest, counted
n_close         .byte ?                 ; nearby: how many
cx              .word ?                 ; show: the window's corner moved by where a sprite can start
cy              .word ?
                .send

                .section bss
on              .fill N1                ; 1: a car is in this place (and the player always, after them)
pf              .fill 2 * N1            ; position: fraction, pixel low and high; x for 0..SLOTS, then y
pl              .fill 2 * N1
ph              .fill 2 * N1
dir             .fill SLOTS
sp              .fill SLOTS             ; speed
dlo             .fill SLOTS             ; and how far that is in a frame: 1/256 pixel
dhi             .fill SLOTS
entered         .fill SLOTS             ; 1: it has gone into another tile, for enter to look at
cruise          .fill SLOTS             ; the speed it likes
face            .fill SLOTS             ; the way the picture faces, 0-15 clockwise from east
col             .fill SLOTS
turn            .fill SLOTS             ; the direction it is turning into at tal/tah, or $ff
tal             .fill SLOTS
tah             .fill SLOTS
held            .fill SLOTS             ; frames held up
ghost           .fill SLOTS             ; frames left driving without looking
blocked         .fill SLOTS             ; 1: something in front, as it last looked
wreck           .fill SLOTS             ; 1: hit hard by the player's car; it rolls to a stop and stays put
close_by        .fill SLOTS             ; nearby: the cars near the player's car
sink            .fill SLOTS             ; 0, or for a car that flooded the frames since, from 1 (water.asm)
mine            .byte ?                 ; the car the player left last, which stays however far they go; or $ff
                .send

init            ldx #SLOTS - 1
                lda #0
-               sta on,x
                sta sink,x              ; (a car put in its place by the tests is not going down)
                dex
                bpl -
                lda #1
                sta on + SLOTS
                lda #$ff
                sta mine
                lda #$a5
                sta seed
                lda #$3c
                sta seed + 1
                lda #0
                sta tick
                sta turns
                sta rot
                sta spawn_wait
                rts

; A random byte, 16-bit xorshift (7, 9, 8). Out: A, with N set from its top bit.
rnd             lda seed + 1
                lsr
                lda seed
                ror
                eor seed + 1
                sta seed + 1
                ror
                eor seed
                sta seed
                eor seed + 1
                sta seed + 1
                rts

; One frame of traffic, after the player's car and the window have moved. First every car moves; then, in
; any frame but one that works out colour memory (which has the least time to spare), the rest: deciding
; which way to go at a crossing, and, two cars a frame in turn, looking ahead and going when far away; then
; one try at a new car. A frame that works out colour memory always comes straight after one that moves the
; screen and before one that does not, so that never waits more than a frame.
update          inc tick
                lda player_at           ; the player, in a car or on foot, to be looked at like the cars
                sta pl + SLOTS
                lda player_at + 1
                sta ph + SLOTS
                lda player_at + 2
                sta pl + SLOTS + N1
                lda player_at + 3
                sta ph + SLOTS + N1
                ldx #0
each            lda on,x
                bne +
                jmp next_car
+               lda wreck,x             ; a wreck rolls to a stop, and that is all: once it has, and for a
                beq +                   ; car the player left, there is nothing to do but for one that
                lda sp,x                ; flooded to go down
                bne +++
                lda sink,x
                beq stood
                cmp #SINK_DONE
                bcs stood
                inc sink,x
stood           jmp next_car
+               lda ghost,x
                beq +
                dec ghost,x
+               lda blocked,x           ; the speed it wants: none if held up, unless it has stopped looking
                beq cruising
                lda ghost,x
                bne cruising
                lda #0
                beq new_want
+               lda #0                  ; (a wreck still rolling)
                beq new_want
cruising        lda sp,x                ; already at its cruising speed: the usual case, nothing to do
                cmp cruise,x
                beq moving
                lda cruise,x
new_want        sta want
                lda sp,x                ; towards it, as fast as it can
                cmp want
                beq at_speed
                bcs slower
                adc #T_ACCEL            ; (the carry is clear)
                bcs +
                cmp want
                bcc ++
+               lda want
+               jmp new_speed
slower          sbc #T_BRAKE            ; (the carry is set)
                bcc +
                cmp want
                bcs new_speed
+               lda want
new_speed       sta sp,x
                asl                     ; how far that is in a frame, in 1/256 pixel
                sta dlo,x
                lda #0
                rol
                sta dhi,x
                lda wreck,x
                bne moving
at_speed        lda sp,x                ; held up? (Never at cruising speed, which is above SLOW_SPEED.)
                cmp #SLOW_SPEED
                bcs going
                inc held,x
                lda held,x
                cmp #HELD_LIMIT
                bcc moving
                lda #GHOST_TIME
                sta ghost,x
going           lda #0
                sta held,x
moving          lda dir,x               ; along its lane
                beq go_east
                lsr
                bcc to_west             ; 2
                beq to_south            ; 1
                jmp go_north            ; 3
to_west         jmp go_west
to_south        jmp go_south
go_east         #along 0, 0
go_south        #along N1, 0
go_west         #along 0, 1
go_north        #along N1, 1
moved           lda tick                ; the picture turns towards the way it goes, a step every other frame
                lsr
                bcs next_car
                ldy dir,x
                lda aim,y
                sec
                sbc face,x
                and #15
                beq next_car
                cmp #8
                lda face,x
                bcs +
                adc #1                  ; (the carry is clear)
                bcc ++
+               sbc #1                  ; (the carry is set)
+               and #15
                sta face,x
next_car        inx
                cpx #SLOTS
                beq +
                jmp each
+
rest            lda busy                ; colour memory this frame: the rest waits
                beq +
                rts
+               inc turns
                ldx #0
upkeep          stx i
                lda on,x
                beq up_next
                lda wreck,x             ; a wreck neither decides nor looks
                bne +
                lda entered,x           ; into a new tile: a crossing?
                beq +
                lda #0
                sta entered,x
                jsr enter
                ldx i
+               txa                     ; in turn: look ahead, and go if far away
                clc
                adc turns
                and #3
                bne up_next
                lda wreck,x
                ora ghost,x
                bne +
                jsr look
+               jsr far_away
up_next         inx
                cpx #SLOTS
                bne upkeep
.if SPAWN != 0
                lda spawn_wait          ; a new car: not straight after one, and only every fourth of these
                beq +                   ; frames, one in which only one car looks ahead
                dec spawn_wait
                rts
+               lda turns
                and #3
                cmp #2
                bne +
                jmp try_spawn
+
.endif
                rts

; Car X goes if it is more than FAR_X or FAR_Y from the player, unless it is the car the player left last.
; Keeps X.
far_away        cpx mine
                beq kept
                sec
                lda pl,x
                sbc pl + SLOTS
                sta dl
                lda ph,x
                sbc ph + SLOTS
                sta dh
                clc
                lda dl
                adc #<FAR_X
                sta dl
                lda dh
                adc #>FAR_X
                sta dh
                lda dl
                cmp #<(2 * FAR_X + 1)
                lda dh
                sbc #>(2 * FAR_X + 1)
                bcs +
                sec
                lda pl + N1,x
                sbc pl + SLOTS + N1
                sta dl
                lda ph + N1,x
                sbc ph + SLOTS + N1
                sta dh
                clc
                lda dl
                adc #<FAR_Y
                sta dl
                lda dh
                adc #>FAR_Y
                sta dh
                lda dl
                cmp #<(2 * FAR_Y + 1)
                lda dh
                sbc #>(2 * FAR_Y + 1)
                bcc kept
+               lda #0
                sta on,x
kept            rts

; Move car X along its lane by its speed: on the axis whose positions start at off in the tables, backwards
; if back. If it is turning, turn once it reaches the lane it turns into; otherwise note when it goes into
; another tile, for enter.
along           .macro off, back
                lda pl + \off,x
                sta old
.if \back != 0
                sec
                lda pf + \off,x
                sbc dlo,x
                sta pf + \off,x
                lda pl + \off,x
                sbc dhi,x
                sta pl + \off,x
                bcs moved_on
                dec ph + \off,x
moved_on        lda turn,x
                bmi tile
                lda tal,x               ; at or before where it turns?
                cmp pl + \off,x
                lda tah,x
                sbc ph + \off,x
.else
                clc
                lda pf + \off,x
                adc dlo,x
                sta pf + \off,x
                lda pl + \off,x
                adc dhi,x
                sta pl + \off,x
                bcc moved_on
                inc ph + \off,x
moved_on        lda turn,x
                bmi tile
                lda pl + \off,x         ; at or past where it turns?
                cmp tal,x
                lda ph + \off,x
                sbc tah,x
.endif
                bcs snap
                jmp moved
snap            lda tal,x               ; turn: onto the new lane, all at once
                sta pl + \off,x
                lda tah,x
                sta ph + \off,x
                lda #0
                sta pf + \off,x
                lda turn,x
                sta dir,x
                lda #$ff
                sta turn,x
                jmp moved
tile            lda pl + \off,x         ; into another tile?
                eor old
                and #$f0
                bne entered_one
                jmp moved
entered_one     lda #1
                sta entered,x
                jmp moved
                .endm

; Look ahead for car X: blocked,x = 1 if a car, the player's included, is AHEAD_MIN to AHEAD_MAX pixels in
; front of it and at most SIDE to the side. A loop for each direction, which keeps it short. Keeps X.
look            lda pl,x
                sta ax
                lda ph,x
                sta ax + 1
                lda pl + N1,x
                sta ay
                lda ph + N1,x
                sta ay + 1
                lda dir,x
                beq look_e
                lsr
                bcc to_look_w           ; 2
                beq to_look_s           ; 1
                jmp look_n              ; 3
to_look_w       jmp look_w
to_look_s       jmp look_s
look_e          #ahead 0, N1, 0, ax, ay
look_s          #ahead N1, 0, 0, ay, ax
look_w          #ahead 0, N1, 1, ax, ay
look_n          #ahead N1, 0, 1, ay, ax

; The loop for one direction: along the axis whose positions start at oa in the tables, backwards if back,
; from the car at (ma, mc) along and across.
ahead           .macro oa, oc, back, ma, mc
                ldy #SLOTS              ; the player's car, then the others
loop            cpy i
                beq next
                lda on,y
                beq next
                sec                     ; how far in front
.if \back != 0
                lda \ma
                sbc pl + \oa,y
                tax
                lda \ma + 1
                sbc ph + \oa,y
.else
                lda pl + \oa,y
                sbc \ma
                tax
                lda ph + \oa,y
                sbc \ma + 1
.endif
                bne next                ; behind, or 256 or more in front
                cpx #AHEAD_MIN
                bcc next
                cpx #AHEAD_MAX + 1
                bcs next
                sec                     ; and to the side
                lda pl + \oc,y
                sbc \mc
                tax
                lda ph + \oc,y
                sbc \mc + 1
                sta t1
                txa
                clc
                adc #SIDE
                bcc +
                inc t1
+               ldx t1
                bne next
                cmp #2 * SIDE + 1
                bcs next
                ldx i
                lda #1
                sta blocked,x
                rts
next            dey
                bpl loop
.if CROWD != 0                          ; and the passers-by on a road, nearer: up to P_AHEAD in front, P_SIDE
                lda people.crossing     ; to the side (only if anyone is on a road, which is seldom)
                beq p_none
                ldy #CROWD - 1
p_loop          lda people.on,y
                beq p_next
                sec
.if \oa == 0 && \back == 0
                lda people.xl,y
                sbc \ma
                tax
                lda people.xh,y
                sbc \ma + 1
.elsif \oa == 0
                lda \ma
                sbc people.xl,y
                tax
                lda \ma + 1
                sbc people.xh,y
.elsif \back == 0
                lda people.yl,y
                sbc \ma
                tax
                lda people.yh,y
                sbc \ma + 1
.else
                lda \ma
                sbc people.yl,y
                tax
                lda \ma + 1
                sbc people.yh,y
.endif
                bne p_next
                cpx #1
                bcc p_next
                cpx #P_AHEAD + 1
                bcs p_next
                sec
.if \oa == 0
                lda people.yl,y
                sbc \mc
                tax
                lda people.yh,y
.else
                lda people.xl,y
                sbc \mc
                tax
                lda people.xh,y
.endif
                sbc \mc + 1
                sta t1
                txa
                clc
                adc #P_SIDE
                bcc +
                inc t1
+               ldx t1
                bne p_next
                cmp #2 * P_SIDE + 1
                bcs p_next
                ldx i
                lda #1
                sta blocked,x
                rts
p_next          dey
                bpl p_loop
p_none
.endif
                ldx i
                lda #0
                sta blocked,x
                rts
                .endm

; A = the tile of position Y in the tables: the pixel / 16.
tile_at         lda pl,y
                lsr
                lsr
                lsr
                lsr
                sta t0
                lda ph,y
                asl
                asl
                asl
                asl
                ora t0
                rts

; Car i has moved into another tile on its way. If that is the first tile of a crossing, decide which way to
; go from it.
enter           ldx i                   ; the tables' indexes for its axis and the other
                txa
                sta ia
                clc
                adc #N1
                sta ic
                lda dir,x
                lsr
                bcc +
                lda ia                  ; along y: the other way round
                ldy ic
                sta ic
                sty ia
+               ldy ia
                jsr tile_at
                tax
                ldy i
                lda dir,y
                and #2
                beq +
                lda mod12,x             ; backwards: a crossing's second tile is the first it comes to
                cmp #1
                beq ++
                rts
+               lda mod12,x
                beq +
                rts
+               lda div12,x
                sta ka
                ldy ic
                jsr tile_at
                tax
                lda div12,x
                sta kc
                ldy i                   ; which crossing, across and down
                lda dir,y
                lsr
                lda ka
                ldx kc
                bcc +
                stx ix
                sta iy
                bcs ++
+               sta ix
                stx iy
+               lda #0                  ; the ways it can go (east, south, west, north): not back, nor off
                                        ; the city
                sta cnt
                sta straight
                ldx #0
way             txa
                eor #2
                cmp dir,y
                beq no_way
                txa
                lsr
                lda ix
                bcc +
                lda iy
+               cpx #2
                bcs +
                cmp #8                  ; east or south: not from the last crossing
                bcs no_way
                bcc ++
+               cmp #0                  ; west or north: not from the first
                beq no_way
+               txa
                ldy cnt
                sta ways,y
                inc cnt
                ldy i
                cmp dir,y
                bne no_way
                lda #1
                sta straight
no_way          inx
                cpx #4
                bne way
                ldy i                   ; a police car chasing takes the way to the player (police.asm)
                jsr police.chasing
                bcs chosen
                lda straight            ; straight on half the time if it can ...
                beq +
                jsr rnd
                bpl go_on
+               jsr rnd                 ; ... otherwise any way it can: ways[rnd * cnt / 256]
                sta t0
                lda #0
                sta t1
                ldx cnt
                lda #0
-               clc
                adc t0
                bcc +
                inc t1
+               dex
                bne -
                ldx t1
                lda ways,x
chosen          ldy i
                cmp dir,y
                beq go_on
                sta turn,y              ; turning: where the lane it turns into is
                tax
                lda lanes,x
                ldx ka
                clc
                adc road_lo,x
                sta tal,y
                lda road_hi,x
                adc #0
                sta tah,y
go_on           rts

.if SPAWN != 0
; One try at a new car somewhere off screen, a little way from the player, if there is room for one.
try_spawn       jsr police.allowed      ; (with heat, only a police car, when one is due: police.asm)
                bcs +
                rts
+               ldx #SLOTS - 1          ; with CARS cars about, the cars the player has left among them, there
                ldy #0                  ; are enough: that leaves a place free for the car the player is in
-               lda on,x
                beq +
                iny
+               dex
                bpl -
                cpy #CARS
                bcs full
                ldx #CARS - 1           ; a new car never takes the last place: the first car left goes there
-               lda on,x
                beq +
                dex
                bpl -
full            rts
+               stx slot
                jsr rnd
                sta r1
                and #3                  ; bit 0: along y, bit 1: backwards
                sta sdir
                lsr                     ; the road: the nearest to the player across, (where + 80) / 192, or
                ldy #SLOTS + N1         ; the one before or after it
                bcc +
                ldy #SLOTS
+               clc
                lda pl,y
                adc #80
                sta t0
                lda ph,y
                adc #0
                asl
                asl
                asl
                asl
                sta t1
                lda t0
                lsr
                lsr
                lsr
                lsr
                ora t1
                tax
                lda r1
                lsr
                lsr
                and #3
                tay
                lda div12,x
                clc
                adc koff,y
                bpl +
                lda #0
+               cmp #9
                bcc +
                lda #8
+               tax
                ldy sdir                ; its lane
                lda lanes,y
                clc
                adc road_lo,x
                sta t0
                lda road_hi,x
                adc #0
                sta t1
                jsr rnd                 ; along it: within 384 pixels of the player, either way
                sta dl
                ldx #0
                cmp #$80
                bcc +
                dex
+               stx dh
                asl
                sta old
                txa
                rol
                tax                     ; x:old = rnd * 2
                clc
                lda old
                adc dl
                sta dl
                txa
                adc dh
                sta dh                  ; dh:dl = rnd * 3
                lda sdir
                lsr
                ldy #SLOTS
                bcc +
                ldy #SLOTS + N1
+               clc
                lda pl,y
                adc dl
                sta dl
                lda ph,y
                adc dh
                sta dh                  ; dh:dl = where along
                lda sdir                ; as x and y
                lsr
                bcs +
                lda dl
                sta nx
                lda dh
                sta nx + 1
                lda t0
                sta ny
                lda t1
                sta ny + 1
                jmp ++
+               lda dl
                sta ny
                lda dh
                sta ny + 1
                lda t0
                sta nx
                lda t1
                sta nx + 1
+               sec                     ; inside the city, 40 pixels from its edges?
                lda dl
                sbc #40
                sta t0
                lda dh
                sbc #0
                sta t1
                lda t0
                cmp #<(MAP_PIXELS - 80 + 1)
                lda t1
                sbc #>(MAP_PIXELS - 80 + 1)
                bcc +
                rts
+               lda dh                  ; not near a crossing: 48-175 pixels into a block
                sta t1
                lda dl
                lsr t1
                ror
                lsr t1
                ror
                lsr t1
                ror
                lsr t1
                ror
                tax
                lda mod12,x
                sec
                sbc #3
                cmp #8
                bcc +
                rts
+               sec                     ; not on screen
                lda nx
                sbc cam_lo
                sta t0
                lda nx + 1
                sbc cam_hi
                sta t1
                lda t0                  ; x - window - 152 + 181: on screen if 0-362
                clc
                adc #<(SHOWN_X - 1 - CENTRE_X)
                sta t0
                lda t1
                adc #>(SHOWN_X - 1 - CENTRE_X)
                sta t1
                lda t0
                cmp #<(2 * SHOWN_X - 1)
                lda t1
                sbc #>(2 * SHOWN_X - 1)
                bcs off_screen
                sec
                lda ny
                sbc cam_lo + 1
                sta t0
                lda ny + 1
                sbc cam_hi + 1
                sta t1
                lda t0
                clc
                adc #<(SHOWN_Y - 1 - CENTRE_Y)
                sta t0
                lda t1
                adc #>(SHOWN_Y - 1 - CENTRE_Y)
                sta t1
                lda t0
                cmp #<(2 * SHOWN_Y - 1)
                lda t1
                sbc #>(2 * SHOWN_Y - 1)
                bcs off_screen
                rts
off_screen      ldy #SLOTS              ; and no car near
-               lda on,y
                beq near_next
                sec
                lda pl,y
                sbc nx
                sta t0
                lda ph,y
                sbc nx + 1
                tax
                lda t0
                clc
                adc #NEAR
                bcc +
                inx
+               cpx #0
                bne near_next
                cmp #2 * NEAR + 1
                bcs near_next
                sec
                lda pl + N1,y
                sbc ny
                sta t0
                lda ph + N1,y
                sbc ny + 1
                tax
                lda t0
                clc
                adc #NEAR
                bcc +
                inx
+               cpx #0
                bne near_next
                cmp #2 * NEAR + 1
                bcs near_next
                rts                     ; too near
near_next       dey
                bpl -
                ldx slot                ; a new car
                lda #1
                sta on,x
                lda sdir
                sta dir,x
                asl
                asl
                sta face,x
                lda #$ff
                sta turn,x
                lda #0
                sta held,x
                sta ghost,x
                sta blocked,x
                sta wreck,x
                sta pf,x
                sta pf + N1,x
                lda nx
                sta pl,x
                lda nx + 1
                sta ph,x
                lda ny
                sta pl + N1,x
                lda ny + 1
                sta ph + N1,x
                lda r1
                lsr
                lsr
                lsr
                lsr
                and #7
                tay
                lda colours,y
                sta col,x
                lda #0
                sta sink,x
                sta entered,x
                jsr rnd
                jsr police.new_car      ; (its cruising speed from that; a police car with heat, or on patrol)
                sta cruise,x
                sta sp,x
                asl
                sta dlo,x
                lda #0
                rol
                sta dhi,x
                lda #SPAWN_GAP
                sta spawn_wait
                rts
.endif

; ---------- the player's car running into traffic ----------
;
; As in the browser game, a traffic car is solid and does not give way: the player's car bounces off it as
; off a wall (car.axis_move asks bump), and one hit hard (HARD or faster on the axis that hits) becomes a
; wreck that rolls to a stop and stays put. A traffic car is a box BOX_LONG pixels from its centre along its
; lane and BOX_SHORT across; the player's car is its three points with a 9 by 9 box each, as against walls.
; Only a move that takes the player's car nearer counts, so where traffic has driven into it, it can always
; drive out.

HARD            = 180                   ; 0.7 pixels a frame
BOX_LONG        = 10
BOX_SHORT       = 5
NEAR_BOX        = 31                    ; nearby: within this either way

; Before the player's car moves: list the cars near it, so bump has few or none to look at.
nearby          ldy #0
                ldx #0
-               lda on,x
                beq ++
                lda sink,x              ; a car that flooded is out of the way
                bne ++
                sec
                lda pl,x
                sbc car.pos_x + 1
                sta t0
                lda ph,x
                sbc car.pos_x + 2
                jsr within
                bcs ++
                sec
                lda pl + N1,x
                sbc car.pos_y + 1
                sta t0
                lda ph + N1,x
                sbc car.pos_y + 2
                jsr within
                bcs +
                txa
                sta close_by,y
                iny
+
+               inx
                cpx #SLOTS
                bne -
                sty n_close
                rts

; C clear if the 16-bit difference in A (high) and t0 (low) is NEAR_BOX or less either way.
within          sta t1
                clc
                lda t0
                adc #NEAR_BOX
                lda t1
                adc #0
                bne +
                lda t0
                clc
                adc #NEAR_BOX
                cmp #2 * NEAR_BOX + 1
                rts
+               sec
                rts

; In car.axis_move, once lead has found no wall: C set if the move runs the player's car into a traffic car,
; which is then in X. Uses lead's along, across, mo, mn and oth.
bump            lda n_close
                bne +
                clc
                rts
+               lda #0
                sta dh                  ; which of the list
bump_each       ldy dh
                ldx close_by,y
                lda dir,x               ; how far it reaches along the axis moving and across it
                ldy car.pos_off
                beq +
                eor #1
+               and #1
                tay
                lda reach_a,y
                sta want
                lda reach_c,y
                sta old
                ldy car.pos_off         ; its centre on the axis moving (ka), and across (kc)
                beq +
                lda pl + N1,x
                sta ka
                lda pl,x
                sta kc
                jmp ++
+               lda pl,x
                sta ka
                lda pl + N1,x
                sta kc
+               sec                     ; nearer? (8 bits are enough this near)
                lda ka
                sbc car.mn
                sta dl                  ; from where the player's car goes ...
                jsr abs8
                sta ix
                sec
                lda ka
                sbc car.mo              ; ... and from where it is
                jsr abs8
                cmp ix
                beq bump_next
                bcc bump_next
                sec
                lda kc
                sbc car.oth
                sta iy                  ; across
                ldy #2
-               lda dl                  ; any of the three boxes touching?
                sec
                sbc car.along,y
                jsr abs8
                cmp want
                beq +
                bcs ++
+               lda iy
                sec
                sbc car.across,y
                jsr abs8
                cmp old
                beq bumped
                bcc bumped
+               dey
                bpl -
bump_next       inc dh
                lda dh
                cmp n_close
                beq +
                jmp bump_each
+               clc
                rts
bumped          sec
                rts

abs8            bpl +
                eor #$ff
                clc
                adc #1
+               rts

reach_a         .byte 4 + BOX_LONG, 4 + BOX_SHORT       ; lying along the axis moving, or across it
reach_c         .byte 4 + BOX_SHORT, 4 + BOX_LONG

; The player's car has run into car X at velocity (vel_off) Y: a wreck if that was hard.
hit             lda car.vel_x + 1,y
                bpl +
                lda car.vel_x,y         ; |v|
                eor #$ff
                clc
                adc #1
                sta t0
                lda car.vel_x + 1,y
                eor #$ff
                adc #0
                jmp ++
+               lda car.vel_x,y
                sta t0
                lda car.vel_x + 1,y
+               sta t1
                lda t0
                cmp #<HARD
                lda t1
                sbc #>HARD
                bcc +
                lda #1
                sta wreck,x
                lda #$ff
                sta turn,x
                lda #0
                sta ghost,x
                sta blocked,x
+               rts

; List the cars on screen for the multiplexer, starting with a different one each frame. After the window
; has moved for the next frame. A car shows if any of its sprite is inside the window, its centre from 11
; pixels left of it to 315 right and from 10 above, but only while all of its sprite is above the black band
; under the city: its centre at most 150 below the window's top. The video chip cannot cut a sprite off part
; way down (switching it off only stops it starting), so it would carry on over the band and the panel; and
; a sprite fetched for the lines below the city takes cycles that the split's timed writes cannot spare. So
; a car going off the bottom of the window goes as its sprite reaches the edge.
show            sec
                lda cam_lo
                sbc #11
                sta cx
                lda cam_hi
                sbc #0
                sta cx + 1
                sec
                lda cam_lo + 1
                sbc #10
                sta cy
                lda cam_hi + 1
                sbc #0
                sta cy + 1
                ldx rot
                stx first
each_shown      lda on,x
                beq not_shown
                sec                     ; down: 0-160 from cy
                lda pl + N1,x
                sbc cy
                tay
                lda ph + N1,x
                sbc cy + 1
                bne not_shown
                cpy #LOWEST + 1
                bcs not_shown
                sec                     ; across: 0-326 from cx
                lda pl,x
                sbc cx
                sta t0
                lda ph,x
                sbc cx + 1
                beq +
                cmp #1
                bne not_shown
                lda t0
                cmp #326 - 256 + 1
                bcs not_shown
                lda #1
+               sta t1
                tya                     ; listed: y and x as the sprite registers want them, with the sprite's
                ldy sprites.n           ; top left corner 10 lines and 12 pixels from the car's centre, the
                clc                     ; window starting at line 55 and pixel 31, and a sprite showing from
                adc #55 - 10 - 1 - 10   ; the line after its y
                sta sprites.u_y,y
                lda t0
                adc #31 - 12 - 11       ; (the carry is clear)
                sta sprites.u_xl,y
                lda t1
                adc #0
                sta sprites.u_xh,y
                lda face,x
                adc #CAR_SPRITE         ; (the carry is clear)
                sta sprites.u_p,y
                jsr water.shade         ; its colour, or how far down it is
                sta sprites.u_c,y
                inc sprites.n
not_shown       inx
                cpx #SLOTS
                bcc +
                ldx #0
+               cpx first
                bne each_shown
                inx                     ; next frame, from the next one
                cpx #SLOTS
                bcc +
                ldx #0
+               stx rot
                rts

div12           .byte range(104) / 12   ; tile / 12 and tile % 12: which block of the grid, and where in it
mod12           .byte range(98) % 12
road_lo         .byte <(range(9) * 192) ; where each road starts
road_hi         .byte >(range(9) * 192)
lanes           .byte 24, 8, 8, 24      ; each direction's lane, from the road's edge
aim             .byte 0, 4, 8, 12       ; the picture for each direction
koff            .char -1, 0, 1, 0
colours         .byte PURPLE, GREEN, ORANGE, LIGHT_RED, LIGHT_GREEN, LIGHT_BLUE, CYAN, YELLOW

                .bend
