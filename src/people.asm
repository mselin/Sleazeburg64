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
; memory, which have no time to spare; in those they stand still for a frame. Someone in sight costs about
; 300 cycles a frame to list and sort for the multiplexer, so in the busiest frames, where four in sight would
; make the frame late, they are left out of the list for that frame (room), as the multiplexer leaves out what
; does not fit: they flicker rather than make a frame late. Listing them for the multiplexer
; happens every frame, as it must.
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
SHOW_BY_BUSY    = 140                   ; room: they are listed only if the beam is this far past the bottom
SHOW_BY         = 250                   ; interrupt at most (in a busy frame, and in any other), so no frame is late
TREAD            = 4                     ; and to take a step
ARRIVE_GAP       = 16                    ; frames with time to spare between looking for a place for someone
FAR             = $180                  ; 384: further than this from the player, they go
BACK_ODDS       = 205                   ; the way back is left for last when a random byte is below this: 0.8
JAY_ODDS        = 26                    ; ready to cross a road when a random byte is below this: 0.1
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
                ldx #CROWD - 1
-               lda on,x
                beq +
                stx who
                jsr walk
                ldx who
+               dex
                bpl -
                lda #0                  ; how many are on a road, for the traffic, which looks for them only then
                sta crossing
                ldx #CROWD - 1
-               stx who
                lda on,x
                beq +
                lda way,x
                ldy #0
                jsr ahead
                cmp #ROADWAY
                bne +
                inc crossing
+               ldx who
                dex
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
+               dec wait,x
                beq +
                lda way,x
                ldy #REACH
                jsr ahead
                jsr likes
                bcc ++
+               jsr pick
+               ldx who
                lda way,x
                ldy #TREAD
                jsr ahead
                cmp #WALL
                beq +
                ldx who
                jsr stride
+               ldx who                 ; phase += spd * 5/8, a pose every 1.6 pixels
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
                clc
                adc phl,x
                sta phl,x
                bcc +
                inc phh,x
+               rts

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
                ora #32                 ; 32-255 frames: 0.6 to 5.1 seconds
                ldx who
                sta wait,x
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
.endif

; List everyone in sight for the multiplexer, after traffic.show (which leaves the window's corner, moved by
; where a sprite can start, in traffic.cx and cy) and Big Honk, as he is listed.
show            jsr hunting             ; the player's car, if it is going fast enough to run someone over
                jsr room                ; and whether this frame has time to list them
                ldx #CROWD - 1
each            lda on,x
                bne +
                jmp hidden
+               lda down,x              ; lying: for DOWN_TIME frames, then gone
                beq +
                dec down,x
                bne listed
                lda #0
                sta on,x
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
listed          lda listing             ; listed for the multiplexer, unless this frame has no time for them (as
                bne +                   ; the multiplexer leaves out what does not fit: they show again in the
                jmp hidden              ; next)
+               sec                     ; down: 0 to LOWEST - 1 from cy
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

; listing = 1 if this frame has time for them: how far the beam is past the bottom interrupt is under
; SHOW_BY_BUSY in a frame that moves the screen or works out colour memory (about 160 lines of which are still
; to come after this), or under SHOW_BY in any other.
room            lda #0
                sta listing
                ldy #SHOW_BY
                lda busy
                bne +
                jsr screen_moves
                bcc ++
+               ldy #SHOW_BY_BUSY
+               sty first               ; (spare)
                lda VIC_RASTER          ; lines since the bottom interrupt
                ldx VIC_CTRL1
                bpl +
                clc                     ; 256 and on: - BOTTOM_LINE
                adc #256 - BOTTOM_LINE
                jmp ++
+               sec
                sbc #BOTTOM_LINE
                bcs +                   ; BOTTOM_LINE to 255
                adc #312 - 256          ; (C clear) before it: the next frame's lines, 312 on
                bcs late                ; past 255 lines: no time
+               cmp first
                bcs late
                inc listing
late            rts

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
jay             .fill CROWD, 0          ; 1: ready to cross a road
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
listing         .byte 0                 ; show: 1 if this frame has time to list them
lull             .byte 0                 ; frames with time to spare until the next look for a place
who             .byte 0                 ; the one being moved
try             .byte 0                 ; pick
tries           .byte 0
first           .byte 0
nx              .word 0                 ; ahead: the point looked at
ny              .word 0

                .bend
