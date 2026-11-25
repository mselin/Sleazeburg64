; SPDX-License-Identifier: GPL-2.0-or-later
; Passers-by: a few people walking the pavements, the plazas and the grass, by the browser game's design
; (specs/design.md there, "People on foot", and js/peds.js).
;
; Who. Up to CROWD at once (main.asm; -D CROWD=0 leaves them out), each a multicolour sprite shared through the multiplexer like the traffic: the
; player's figure in four directions and five walking poses (tools/assets.mjs), in a shirt of one of the
; design's eight colours, which is the sprite's own; hair, feet and outline black and hands and face yellow,
; the colours all multicolour sprites share. No white outline, which is the player's alone.
;
; Where they come from. In a frame with time to spare, every ARRIVE_GAP frames, a free place looks at a point
; at random within 256 pixels of the player each way and out of sight; on a pavement or a plaza, someone
; starts walking there, in the middle of its tile. Someone further than 384 pixels from the player on either
; axis goes. (The browser game keeps 24 within 400 pixels; four is what the frame time allows here.)
;
; Walking. At 15 to 21 pixels a second (77 to 108 in 1/256 pixel a frame), one of four ways. Every so often,
; and whenever what is REACH pixels ahead is not a pavement, a plaza or grass (or a road, for someone ready to
; cross one), they pick a way again. Each time, they are ready to cross a road if they are on one, or else one
; time in ten, as the browser game's jaywalkers. Then: the four
; in turn from a random one, the way back usually last, the first that leads somewhere they like; if none
; does, any way that is not into a wall. They step forward only if what is TREAD pixels ahead is not a wall.
; The walk goes through the poses 2, 3, 4, 3, 2, 1, 0, 1, a pose every 1.6 pixels walked (the design's 0.15
; steps a pixel, four poses a step). Traffic stops for someone in its lane up to 26 pixels ahead and 9 to the
; side (traffic.look, the design's distances), as it does for a car.
;
; Run over. The player's car, going at least 30 pixels a second on either axis, runs someone over when its
; middle comes within HIT of theirs on both axes or the point ahead of it within NOSE (the design's 10 and 9,
; distances, taken here as squares). It is looked at in every frame (show), so a fast car never crosses
; someone unseen. They lie flat for 4 seconds in the
; design's picture of someone knocked down, then are gone (the browser game leaves a stain, which the city's
; characters cannot show here). Nothing else follows yet: no heat, no pickup. Traffic does not run anyone over:
; people keep off the roads.
;
; Time. They move, and new ones appear, only in a frame that neither moves the screen nor works out colour
; memory, which have no time to spare; in those they stand still for a frame. And only half of them walk in
; such a frame, by turns, two frames' worth at once: a step with the look ahead and the test for a car in the
; way costs about 25 raster lines. Listing them for the multiplexer
; (about 300 cycles a frame for someone in sight) happens every frame, as it must.
;
; This code runs from EXTRA_CODE (main.asm), with its tables. Its random numbers are its own.
;
; tests/e2e/people-model.mjs does the same in JavaScript, and the tests hold the two to each other exactly.

PEOPLE_SPRITE   = PEOPLE_FRAMES / 64    ; frames way * 5 + pose (tools/assets.mjs)
PAVEMENT        = 4                     ; a tile's kind (tools/assets.mjs): pavements and plazas

people          .block
REACH           = 9                     ; how far ahead they look to choose a way
RUN_OVER        = 154                   ; the player's car runs someone over going this fast on either axis,
HIT             = 9                     ; in 1/256 pixel a frame (30 pixels a second), with its middle within
NOSE            = 8                     ; HIT of theirs on both axes, or the point ahead of it within NOSE
DOWN_TIME       = 200                   ; frames they lie, 4 seconds, then gone
DOWN_FRAME      = 20                    ; their picture lying (tools/assets.mjs)
TREAD            = 4                     ; and to take a step
ARRIVE_GAP       = 16                    ; frames with time to spare between looking for a place for someone
FAR             = $180                  ; 384: further than this from the player, they go
BACK_ODDS       = 205                   ; the way back is left for last when a random byte is below this: 0.8
JAY_ODDS        = 26                    ; ready to cross a road when a random byte is below this: 0.1
PUNCH_WAIT      = 18                    ; frames between punches (0.35 seconds)
PUNCH_REACH     = 7                     ; a punch: the first passer-by within PUNCH_LIM of the point this far
PUNCH_LIM       = 7                     ; ahead of the player is knocked down
SCARE           = 60                    ; and anyone this near them runs
FLEE_TURNS      = 50                    ; for 2 seconds (in their turns, every other frame), twice as fast
HALT            = 10                    ; a car in the way: they stand this many of their turns (0.4 seconds) ...
TURN_AFTER      = 75                    ; ... then step round it, and turn another way after 3 seconds in all
CAR_LONG        = 13                    ; a traffic car's body, as traffic.bump has it, and their 3 pixels: along
CAR_SHORT       = 8                     ; its way, and across
CAR_SQUARE      = 10                    ; the player's car, which turns any way: this far either way
ROADWAY         = 0                     ; a tile's kind: a road or a car park (tools/assets.mjs)


init            lda #0
                ldx #CROWD - 1
-               sta on,x
                dex
                bpl -
                lda #$5d
                sta seed
                lda #1
                sta lull
                rts

; A random byte: an 8-bit linear feedback shift register, as honk.rnd.
rnd             lda seed
                asl
                bcc +
                eor #$1d
+               sta seed
                rts

; Once a pass, after the window has moved: in a frame with time to spare, a new face, and everyone walks.
update          lda busy                ; (the cheaper test first: a frame of colour memory is the busiest)
                bne +
                jsr screen_moves
                bcc quiet
+               rts
quiet
.if SPAWN != 0
                dec lull
                bne +
                lda #ARRIVE_GAP
                sta lull
                jsr arrive
+
.endif
                lda half                ; half of them in each such frame, by turns, two frames' worth at once
                eor #1
                sta half
                ldx #CROWD - 1
-               lda on,x
                beq +
                txa
                and #1
                cmp half
                bne +
                stx who
                jsr walk
                ldx who
+               dex
                bpl -
                lda #0                  ; how many are on a road, for the traffic, which looks for them only then
                sta crossing
                ldx #CROWD - 1
-               lda on,x
                beq +
                lda road,x
                beq +
                inc crossing
+               dex
                bpl -
                rts

; Person X: gone if far off; else pick a way if it is time or what is ahead is not to their liking, a step
; if they can, and on through the walk.
walk            lda down,x              ; lying: no more walking
                beq +
                rts
+               jsr far_off
                bcc +
                lda #0
                sta on,x
                rts
+               lda flee,x              ; running: away from the player (flee_way)
                beq +
                jmp flee_way
+               dec wait,x
                beq +
                lda way,x
                ldy #REACH
                jsr ahead
                jsr likes
                bcc ++
+               jsr pick
step_on
+               ldx who
                lda way,x
                ldy #TREAD
                jsr ahead
                cmp #WALL
                beq phase
                jsr car_in_way          ; a car's body there (not one they are under already)?
                bcs held_up
                ldx who                 ; no: on, and no longer held up
                lda #0
                sta stuck,x
                sta stall,x
                sta aside,x
                jsr steps
phase           ldx who                 ; phase += spd * 5/8, a pose every 1.6 pixels, for each of the two frames
                lda spd,x
                lsr
                lsr
                sta try                 ; (spare: spd / 4)
                lsr
                clc
                adc try                 ; spd * 3/8
                eor #$ff                ; spd - that
                sec
                adc spd,x
                sta try
                ldy #2
                lda flee,x              ; (running: twice that)
                beq +
                ldy #4
+
-               clc
                lda try
                adc phl,x
                sta phl,x
                bcc +
                inc phh,x
+               dey
                bne -
                rts

; Two frames' steps for person who the way X has, and whether that leaves them on a road.
steps           jsr stride
                ldx who
                jsr stride
                ldx who                 ; running: as far again
                lda flee,x
                beq +
                jsr stride
                ldx who
                jsr stride
+               lda #0
                ldy #0
                jsr ahead
                ldx who
                ldy #0
                cmp #ROADWAY
                bne +
                iny
+               tya
                sta road,x
                rts

; A car in the way: they stand HALT frames, then step to the side away from its middle, so round its nearer
; end, until their way is clear; with no way round, or after TURN_AFTER frames, they turn another way.
held_up         ldx who
                lda stuck,x
                bne +
                lda #TURN_AFTER         ; just come up to it
                sta stuck,x
                lda #HALT
                sta stall,x
+               dec stuck,x
                beq give_up
                lda stall,x
                beq +
                dec stall,x             ; standing
                rts
+               lda aside,x              ; which way round: decided once
                bne ++
                lda way,x
                and #1
                bne +
                sec                     ; going across: down if they are no higher than its middle, else up
                lda yl,x
                sbc by
                lda yh,x
                sbc by + 1
                lda #1 + 1
                bcs side_set
                lda #3 + 1
                bne side_set
+               sec                     ; going up or down: right if they are no further left, else left
                lda xl,x
                sbc bx
                lda xh,x
                sbc bx + 1
                lda #0 + 1
                bcs side_set
                lda #2 + 1
side_set        sta aside,x
+               sec
                sbc #1
                ldy #TREAD
                jsr ahead
                cmp #WALL
                beq give_up             ; no way round
                jsr car_in_way
                bcs give_up
                ldx who                 ; a step that way
                lda way,x
                pha
                lda aside,x
                sec
                sbc #1
                sta way,x
                jsr steps
                ldx who
                pla
                sta way,x
                jmp phase
give_up         jmp pick                ; (which starts them afresh)

; C set if person X is further than FAR from the player on either axis.
far_off         sec
                lda xl,x
                sbc player_at
                tay
                lda xh,x
                sbc player_at + 1
                jsr too_far
                bcs +
                sec
                lda yl,x
                sbc player_at + 2
                tay
                lda yh,x
                sbc player_at + 3
                jmp too_far
+               rts
; C set if the difference A (high), Y (low) is FAR or more either way.
too_far         bpl +
                eor #$ff                ; -d - 1, near enough
                pha
                tya
                eor #$ff
                tay
                pla
+               cmp #>FAR
                bcc +                   ; under $100
                bne ++
                cpy #<FAR
                rts                     ; C set if $1xx >= $180
+               clc
                rts
+               sec
                rts

; Step person X spd/256 of a pixel the way they go.
stride          lda way,x
                cmp #2
                bcs back
                and #1
                bne south
                clc                     ; east
                lda xf,x
                adc spd,x
                sta xf,x
                bcc +
                inc xl,x
                bne +
                inc xh,x
+               rts
south           clc
                lda yf,x
                adc spd,x
                sta yf,x
                bcc +
                inc yl,x
                bne +
                inc yh,x
+               rts
back            and #1
                bne north
                sec                     ; west
                lda xf,x
                sbc spd,x
                sta xf,x
                bcs ++
                lda xl,x
                bne +
                dec xh,x
+               dec xl,x
+               rts
north           sec
                lda yf,x
                sbc spd,x
                sta yf,x
                bcs ++
                lda yl,x
                bne +
                dec yh,x
+               dec yl,x
+               rts

; Pick a way for person who, and how long until they pick again.
pick            ldx who                 ; ready to cross a road: on one already, or one time in ten
                lda way,x
                ldy #0
                jsr ahead               ; (the ground where they are)
                ldy #1
                cmp #ROADWAY
                beq +
                jsr rnd
                ldy #1
                cmp #JAY_ODDS
                bcc +
                dey
+               ldx who
                tya
                sta jay,x
                jsr rnd                 ; the four ways in turn from a random one ...
                sta try
                lda #4
                sta tries
-               lda try
                and #3
                sta try
                ldx who
                eor #2                  ; ... the way back, mostly, left for last
                cmp way,x
                bne +
                jsr rnd
                cmp #BACK_ODDS
                bcc next
+               lda try
                ldy #REACH
                jsr ahead
                jsr likes
                bcc chosen
next            inc try
                dec tries
                bne -
                lda #4                  ; none they like: the first that is not into a wall
                sta tries
-               lda try
                and #3
                sta try
                ldy #REACH
                jsr ahead
                cmp #WALL
                bne chosen
                inc try
                dec tries
                bne -
                beq +                   ; walled in: as they were
chosen          ldx who
                lda try
                sta way,x
+               jsr rnd
                lsr                     ; 16-127 of their turns, every other frame: 0.6 to 5.1 seconds
                ora #16
                ldx who
                sta wait,x
                lda #0                  ; and not held up by a car
                sta stuck,x
                sta stall,x
                sta aside,x
                rts

; C clear if person who likes ground of kind A: a pavement, a plaza or grass, or a road when ready to cross one.
likes           cmp #PAVEMENT
                beq +
                cmp #GRASS
                beq +
                cmp #ROADWAY
                bne no_liking
                ldx who
                lda jay,x
                bne +
no_liking       sec
                rts
+               clc
                rts

; A = the kind of ground Y pixels ahead of person who the way A, or WALL off the city; nx, ny the point.
ahead           sty first               ; (spare: the distance)
                tay
                ldx who
                lda xl,x
                sta nx
                lda xh,x
                sta nx + 1
                lda yl,x
                sta ny
                lda yh,x
                sta ny + 1
                ldx axis_of,y
                cpy #2
                bcs minus
                clc
                lda nx,x
                adc first
                sta nx,x
                bcc kind
                inc nx + 1,x
                bcs kind                ; (always)
minus           sec
                lda nx,x
                sbc first
                sta nx,x
                bcs kind
                dec nx + 1,x
; A = the kind of ground at nx, ny, or WALL off the city.
kind            lda nx
                cmp #<MAP_PIXELS
                lda nx + 1
                sbc #>MAP_PIXELS
                bcs off_city
                lda ny
                cmp #<MAP_PIXELS
                lda ny + 1
                sbc #>MAP_PIXELS
                bcs off_city
                lda nx
                sta car.px
                lda nx + 1
                sta car.px + 1
                lda ny
                sta car.py
                lda ny + 1
                sta car.py + 1
                jmp car.kind_at
off_city        lda #WALL
                rts
axis_of         .byte 0, 2, 0, 2        ; nx or ny, by way
                .cerror ny - nx != 2, "ahead expects ny two bytes after nx"

.if SPAWN != 0
                .section people_high    ; (where there is room: waiting.asm)
; Someone new in a free place, if the point picked at random is out of sight and on a pavement or a plaza.
arrive           ldx #CROWD - 1
-               lda on,x
                beq +
                dex
                bpl -
                rts
+               stx who
                jsr rnd                 ; 2 * (random - 128) from the player each way
                ldx #0
                jsr offset
                jsr rnd
                ldx #2
                jsr offset
                sec                     ; out of sight: not within 12 pixels of the window
                lda nx
                sbc cam_lo
                tay
                lda nx + 1
                sbc cam_hi
                ldx #0
                jsr in_sight
                bcs +                   ; off to one side: out of sight
                sec
                lda ny
                sbc cam_lo + 1
                tay
                lda ny + 1
                sbc cam_hi + 1
                ldx #1
                jsr in_sight
                bcc nobody              ; in sight
+               jsr kind
                cmp #PAVEMENT
                bne nobody
                ldx who                 ; in the middle of its tile
                lda #0
                sta xf,x
                sta yf,x
                sta phl,x
                sta phh,x
                lda nx
                and #$f0
                ora #8
                sta xl,x
                lda nx + 1
                sta xh,x
                lda ny
                and #$f0
                ora #8
                sta yl,x
                lda ny + 1
                sta yh,x
                jsr rnd
                and #31
                clc
                adc #77                 ; 15 to 21 pixels a second
                sta spd,x
                jsr rnd
                and #7
                tay
                lda shirts,y
                sta col,x
                jsr rnd
                and #3
                sta way,x
                lda #0
                sta jay,x
                sta road,x
                sta ko,x
                sta flee,x
                lda #1                  ; and they pick a way at once
                sta wait,x
                sta on,x
nobody          rts
; nx (X = 0) or ny (X = 2) = the player's position + 2 * (A - 128).
offset          sec
                sbc #128
                ldy #0
                cmp #$80
                bcc +
                dey
+               asl
                sta first
                tya
                rol
                tay
                clc
                lda first
                adc player_at,x
                sta nx,x
                tya
                adc player_at + 1,x
                sta nx + 1,x
                rts
; C clear if the difference A (high), Y (low) from the window's corner is within 12 pixels of the window across
; (X = 0) or down (X = 1).
in_sight        sta first
                tya
                clc
                adc #12
                tay
                lda first
                adc #0                  ; (below -12 it is a big number: out of sight)
                bne +
                cpx #0                  ; under 256: across, in sight; down, if under VIEW_H + 24
                beq seen
                cpy #VIEW_H + 24
                rts
+               cmp #1
                bne unseen
                cpx #0
                bne unseen
                cpy #<(VIEW_W + 24)     ; across, 256 to VIEW_W + 23
                rts
seen            clc
                rts
unseen          sec
                rts
shirts          .byte PURPLE, ORANGE, CYAN, RED, LIGHT_RED, BROWN, GREEN, WHITE
                .send
.endif

; List everyone in sight for the multiplexer, after traffic.show (which leaves the window's corner, moved by
; where a sprite can start, in traffic.cx and cy) and Big Honk, as he is listed.
show            lda punch_left          ; (the time until the player can punch again)
                beq +
                dec punch_left
+               jsr hunting             ; the player's car, if it is going fast enough to run someone over
                ldx #CROWD - 1
each            lda on,x
                bne +
                jmp hidden
+               lda down,x              ; lying: for DOWN_TIME frames, then gone, or up and running if knocked
                beq +                   ; down by a punch (got_up)
                dec down,x
                bne listed
                jsr got_up
                bcc listed
                jmp hidden
+               lda chasing             ; walking: run over? Only if within 15 pixels of the car down (its
                beq listed              ; middle and the point ahead of it are at most HIT and 6 away), which
                sec                     ; most are not, so that is looked at first
                lda yl,x
                sbc car.pos_y + 1
                sta d
                lda yh,x
                sbc car.pos_y + 2
                sta d + 1
                clc
                lda d
                adc #15
                sta d
                lda d + 1
                adc #0
                bne listed
                lda d
                cmp #31
                bcs listed
                jsr struck
                bcs listed
                lda #DOWN_TIME
                sta down,x
                jsr killed
listed          sec                     ; down: 0 to LOWEST - 1 from cy
                lda yl,x
                sbc traffic.cy
                tay
                lda yh,x
                sbc traffic.cy + 1
                beq +
                jmp hidden
+               cpy #LOWEST
                bcs hidden
                sec                     ; across: 0-326 from cx
                lda xl,x
                sbc traffic.cx
                sta sprites.sx
                lda xh,x
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
+               lda down,x
                beq walking
                lda #PEOPLE_SPRITE + DOWN_FRAME
                bne picture
walking         lda phh,x               ; the pose, through the walk
                and #7
                tay
                lda way,x
                asl
                asl
                adc way,x               ; way * 5 (the carry is clear)
                adc cycle,y
                adc #PEOPLE_SPRITE
picture         sta sprites.sp
                lda col,x
                ora #$80                ; multicolour
                sta sprites.sc
                stx who
                jsr sprites.add
                ldx who
hidden          dex
                bmi +
                jmp each
+               rts
cycle           .byte 2, 3, 4, 3, 2, 1, 0, 1

; chasing = 1 if the player's car is going RUN_OVER or more along either axis (as Big Honk's speedy).
hunting         lda #0
                sta chasing
                ldy #2                  ; down, then across
-               lda car.vel_x + 1,y
                beq forward
                cmp #$ff
                bne quick               ; 256 or more either way
                lda car.vel_x,y         ; -256 to -1
                cmp #256 - RUN_OVER + 1
                bcc quick
                bcs slow
forward         lda car.vel_x,y         ; 0 to 255
                cmp #RUN_OVER
                bcs quick
slow            dey
                dey
                bpl -
                rts
quick           inc chasing             ; (the points only when someone in sight is to be looked at: points)
                rts

; The points that run someone over, worked out once a frame, the first time they are needed: the car's middle
; (cx, cy) and the point ahead of it (fx, fy). chasing goes from 1 to 2.
points          inc chasing
                stx who                 ; (X is the person being looked at)
                lda car.angle + 1       ; the car's sprite direction, and its axis that way
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                tay
                lda car.pos_x + 1
                sta cx
                lda car.pos_x + 2
                sta cx + 1
                lda car.pos_y + 1
                sta cy
                lda car.pos_y + 2
                sta cy + 1
                ldx #0
                lda car.axis_x,y
                jsr ahead_of
                ldx #2
                lda car.axis_y,y
                jsr ahead_of
                ldx who
                rts
; fx (X = 0) or fy (X = 2) = cx or cy + the signed byte A.
ahead_of        sta lim                 ; (spare)
                and #$80
                beq +
                lda #$ff
+               sta lim + 1
                clc
                lda cx,x
                adc lim
                sta fx,x
                lda cx + 1,x
                adc lim + 1
                sta fx + 1,x
                rts

; C clear if person X is run over: within HIT of the car's middle on both axes, or within NOSE of the point
; ahead of it.
struck          lda chasing
                cmp #2
                beq +
                jsr points
+               lda #HIT
                ldy #0
                jsr beside
                bcc +
                lda #NOSE
                ldy #4
                jsr beside
+               rts
; C clear if person X is within A of the point at cx + Y (cx, cy, or fx, fy) on both axes.
beside          sta lim
                sec
                lda xl,x
                sbc cx,y
                sta d
                lda xh,x
                sbc cx + 1,y
                jsr within
                bcs +
                sec
                lda yl,x
                sbc cy,y
                sta d
                lda yh,x
                sbc cy + 1,y
                jmp within
+               rts
; C clear if the difference A (high), d (low) is lim or less either way.
within          sta d + 1
                clc
                lda d
                adc lim
                sta d
                lda d + 1
                adc #0
                bne far_from
                lda lim
                asl
                cmp d                   ; C set if 2 * lim >= d
                bcc far_from
                clc
                rts
far_from        sec
                rts

                .section people_high    ; (where there is room: waiting.asm)
; C set if a car's body takes in the point nx, ny (as ahead leaves it), unless person who is under that car
; already (then they can walk out); bx, by its middle. A car that flooded is out of the way.
car_in_way      lda nx
                sta qx
                lda nx + 1
                sta qx + 1
                lda ny
                sta qy
                lda ny + 1
                sta qy + 1
                ldx #SLOTS - 1
next_car        stx car_no
                lda traffic.on,x
                beq no_car
                lda traffic.sink,x
                bne no_car
                sec                     ; (most are far: more than CAR_LONG away either way, which is quick
                lda qx                  ; to see)
                sbc traffic.pl,x
                tay
                lda qx + 1
                sbc traffic.ph,x
                jsr far_car
                bcs no_car
                sec
                lda qy
                sbc traffic.pl + N1,x
                tay
                lda qy + 1
                sbc traffic.ph + N1,x
                jsr far_car
                bcs no_car
                lda traffic.pl,x
                sta bx
                lda traffic.ph,x
                sta bx + 1
                lda traffic.pl + N1,x
                sta by
                lda traffic.ph + N1,x
                sta by + 1
                lda #CAR_LONG           ; its body along its way
                ldy #CAR_SHORT
                lda traffic.dir,x
                lsr
                lda #CAR_LONG
                bcc +
                lda #CAR_SHORT
                ldy #CAR_LONG
+               jsr in_body
                bcc in_way
no_car          ldx car_no
                dex
                bpl next_car
                lda foot.on             ; and the player's car, while they drive it
                bne clear_way
                lda car.pos_x + 1
                sta bx
                lda car.pos_x + 2
                sta bx + 1
                lda car.pos_y + 1
                sta by
                lda car.pos_y + 2
                sta by + 1
                lda #CAR_SQUARE
                tay
                jsr in_body
                bcs clear_way
                jsr under
                bcs blocked_way
clear_way       clc
                rts
in_way          jsr under               ; under this one: it is not in the way
                bcc no_car
blocked_way     sec
                rts
                .send
                .section people_more    ; (and here: waiting.asm)
; C set if the difference A (high), Y (low) is more than CAR_LONG either way.
far_car         sta body_x              ; (spare)
                tya
                clc
                adc #CAR_LONG
                tay
                lda body_x
                adc #0
                bne +
                cpy #2 * CAR_LONG + 1
                rts
+               sec
                rts
; C set if person who is not within the same body as the point was (limits in body_x, body_y).
under           ldx who
                lda xl,x
                sta qx
                lda xh,x
                sta qx + 1
                lda yl,x
                sta qy
                lda yh,x
                sta qy + 1
                lda body_x
                ldy body_y
                jsr in_body
                php                     ; and the point back, for the next car
                lda nx
                sta qx
                lda nx + 1
                sta qx + 1
                lda ny
                sta qy
                lda ny + 1
                sta qy + 1
                plp
                rts
; C clear if qx, qy is within A across and Y down of bx, by.
in_body         sta body_x
                sty body_y
                sta lim
                sec
                lda qx
                sbc bx
                sta d
                lda qx + 1
                sbc bx + 1
                jsr within
                bcs +
                lda body_y
                sta lim
                sec
                lda qy
                sbc by
                sta d
                lda qy + 1
                sbc by + 1
                jmp within
+               rts
qx              .word 0
qy              .word 0
bx              .word 0
by              .word 0
body_x          .byte 0
body_y          .byte 0
car_no          .byte 0
                .send

                .section people_high
; Fire on foot with no ammo and no knife (foot.update): a punch, unless the last was under PUNCH_WAIT frames
; ago. It knocks down the first passer-by within PUNCH_LIM of the point PUNCH_REACH ahead of the player:
; they lie DOWN_TIME frames, then get up and run (got_up), and anyone within SCARE of them runs now.
punch           lda punch_left
                bne +
                lda #PUNCH_WAIT
                sta punch_left
                lda #ARM_OUT            ; the arm goes out, whether it lands or not
                sta foot.arm
                ldx foot.face           ; the point
                ldy #0
                lda reach_x,x
                jsr nudge_point
                ldy #2
                lda reach_y,x
                jsr nudge_point
                ldx #CROWD - 1
-               lda on,x
                beq next_one
                lda down,x
                bne next_one
                lda #PUNCH_LIM
                ldy #0
                jsr beside
                bcc knock
next_one        dex
                bpl -
+               rts
knock           lda #DOWN_TIME
                sta down,x
                lda #1
                sta ko,x
                lda xl,x                ; who is near them runs
                sta cx
                lda xh,x
                sta cx + 1
                lda yl,x
                sta cy
                lda yh,x
                sta cy + 1
                ldx #CROWD - 1
-               lda on,x
                beq +
                lda down,x
                bne +
                lda #SCARE
                ldy #0
                jsr beside
                bcs +
                lda #FLEE_TURNS
                sta flee,x
+               dex
                bpl -
                lda #2 * 3              ; heat: 3, half a kill
                jmp status.add_heat
; cx (Y = 0) or cy (Y = 2) = the player's position on that axis + A, a signed byte.
nudge_point     sta d
                ldx foot.face
                and #$80
                beq +
                lda #$ff
+               sta d + 1
                lda #0
                cpy #0
                beq +
                lda #3
+               tax
                clc
                lda foot.pos + 1,x
                adc d
                sta cx,y
                lda foot.pos + 2,x
                adc d + 1
                sta cx + 1,y
                ldx foot.face
                rts
reach_x         .char PUNCH_REACH, 5, 0, -5, -PUNCH_REACH, -5, 0, 5             ; by the way they face: east first,
reach_y         .char 0, 5, PUNCH_REACH, 5, 0, -5, -PUNCH_REACH, -5             ; clockwise
                .cerror cy - cx != 2, "punch expects cy two bytes after cx"

; Person X has been run over, a kill: heat 6. X kept.
killed          txa
                pha
                lda #2 * 6
                jsr status.add_heat
                pla
                tax
                rts

; Person X's DOWN_TIME is up: C set if they are gone (run over), else (knocked down by a punch) up and running.
got_up          lda ko,x
                bne +
                sta on,x
                sec
                rts
+               lda #0
                sta ko,x
                lda #FLEE_TURNS
                sta flee,x
                clc
                rts

; A turn of running (person who, flee set): away from the player, along the axis they are further from them on
; (the other if that way is a wall), ready to cross roads, and without stopping before a car.
flee_way        dec flee,x
                lda #1
                sta jay,x
                lda #0
                sta stall,x
                ldy #0                  ; |dx| and |dy|, and which way is away on each
                jsr away
                sta f_x
                lda a_lo
                sta a_x
                lda a_hi
                sta a_x + 1
                ldy #2
                jsr away
                sta f_y
                lda a_lo
                sta a_y
                lda a_hi
                sta a_y + 1
                lda a_x + 1             ; the further first (across, if neither)
                cmp a_y + 1
                bne +
                lda a_x
                cmp a_y
+               lda f_x
                ldy f_y
                bcs +
                lda f_y
                ldy f_x
+               sty f_other
                ldx who
                sta way,x
                ldy #TREAD
                jsr ahead
                cmp #WALL
                bne +
                lda f_other             ; a wall that way: the other, if that is not one too
                ldy #TREAD
                jsr ahead
                cmp #WALL
                beq +
                ldx who
                lda f_other
                sta way,x
+               jmp step_on
; A = the way away from the player on axis Y (0 across, 2 down) for person who; a_lo, a_hi = how far.
away            ldx who
                lda xl,x
                sta a_lo
                lda xh,x
                cpy #0
                beq +
                lda yl,x
                sta a_lo
                lda yh,x
+               sta a_hi
                sec
                lda a_lo
                sbc player_at,y
                sta a_lo
                lda a_hi
                sbc player_at + 1,y
                sta a_hi
                bmi +
                tya                     ; no further left or up: east (0) or south (1)
                lsr
                rts
+               sec                     ; further left or up: west (2) or north (3), and the size
                lda #0
                sbc a_lo
                sta a_lo
                lda #0
                sbc a_hi
                sta a_hi
                tya
                lsr
                ora #2
                rts
ko              .fill CROWD, 0          ; 1: knocked down by a punch (they get up); 0: run over (gone)
flee            .fill CROWD, 0          ; turns left running away
punch_left      .byte 0                 ; frames until the player can punch again
a_lo            .byte 0
a_hi            .byte 0
a_x             .word 0
a_y             .word 0
f_x             .byte 0
f_y             .byte 0
f_other         .byte 0
                .send

; Its variables, here with the code (the panel screen's room for them is full with sixteen cars).
on              .fill CROWD, 0            ; 1 for someone walking, or lying
down            .fill CROWD, 0          ; frames left lying, once run over; 0 walking
xf              .fill CROWD, 0            ; x: fraction, pixel low and high
xl              .fill CROWD, 0
xh              .fill CROWD, 0
yf              .fill CROWD, 0            ; y the same
yl              .fill CROWD, 0
yh              .fill CROWD, 0
way             .fill CROWD, 0            ; 0 east, 1 south, 2 west, 3 north
stuck           .fill CROWD, 0          ; a car in the way: frames left before they turn another way, or 0
stall           .fill CROWD, 0          ; frames left standing before they step round it
aside           .fill CROWD, 0          ; the way they step round it, + 1, or 0
jay             .fill CROWD, 0          ; 1: ready to cross a road
road            .fill CROWD, 0          ; 1: on a road, as of their last step
half            .byte 0                 ; which half of them walks this frame: those with this as bit 0
crossing        .byte 0                 ; how many are on a road (update)
spd             .fill CROWD, 0            ; 1/256 pixel a frame
col             .fill CROWD, 0            ; shirt
wait            .fill CROWD, 0            ; frames until they pick a way again
phl             .fill CROWD, 0            ; how far through the walk: 1/256 pose
phh             .fill CROWD, 0
seed            .byte 0
chasing            .byte 0                 ; show: 1 if the player's car can run someone over
cx              .word 0                 ; its middle ...
cy              .word 0
fx              .word 0                 ; ... and the point ahead of it
fy              .word 0
lim             .word 0                 ; beside
d               .word 0
lull             .byte 0                 ; frames with time to spare until the next look for a place
who             .byte 0                 ; the one being moved
try             .byte 0                 ; pick
tries           .byte 0
first           .byte 0
nx              .word 0                 ; ahead: the point looked at
ny              .word 0

                .bend
