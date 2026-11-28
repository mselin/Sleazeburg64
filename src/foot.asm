; SPDX-License-Identifier: GPL-2.0-or-later
; The player: on foot, and getting in and out of cars.
;
; The browser game's rules (specs/design.md there, and its js/player.js), with what one fire button allows.
;
; On foot. The stick walks the player eight ways at 58 pixels a second (the same along a diagonal, so less on
; each axis), and swims them at 22 through water: the canal and the fountains. Buildings, trees and the edge
; of the city stop them, one axis at a time, so they slide along a wall: their footprint is four points, 3
; pixels either side of their middle each way. Someone who is somehow inside a wall may always walk, or they
; could never leave. The view follows them as it follows the car.
;
; Getting in and out is fire, pressed with the stick centred (pressed: not held from the pass before).
; - On foot it gets into the nearest car whose middle is less than 19 pixels away, if there is one. That car
;   becomes the player's: it leaves the traffic's tables with its place, the way its picture faces, its speed
;   along its lane and its colour. A driver it had is gone: there are no people to show yet.
; - In a car going no faster than 0.9 pixels a frame along either axis it gets out. The player stands 12
;   pixels to the car's right if they fit there, else to its left; then, which the browser game does not try,
;   18 pixels behind it and in front of it (the browser game looks all round in rings instead). With nowhere
;   to stand they stay in. The car stops where it is and goes into the traffic's tables as a car with no
;   driver, in the place the tables keep free for it (traffic.asm), and it stays however far the player goes,
;   until they leave another one.
; With fire held at the start, as when the game is started with it, letting go comes first.
;
; The picture: sprite 0, as the car is, but a multicolour one (tools/assets.mjs draws it): eight directions
; in five walking poses, which follow the browser game's cycle at its nine steps a second, and two pictures
; swimming. The program file holds twelve of the 42 and the rest are their mirror images, made when the
; picture changes to one (frames.asm).
;
; The south edge. The video chip cannot cut a sprite off part way down, and a sprite reaching the black band
; under the city would upset the split (irq.asm). With the window as far south as it goes that happens 11
; pixels from the edge of the city, so that is as far south as the player's middle goes.
;
; Fire on foot, with no car within reach to get into, is a punch (people.punch): there is no gun yet, so the
; game starts with no ammo, as the design has the player punch once it runs out. Nobody fights in the water.
;
; Not here yet: the player cannot be hurt, and cars drive through them (though traffic stops for them as it
; does for a car).
;
; tests/e2e/foot-model.mjs does the same in JavaScript, and the tests hold the two to each other exactly.

PLAYER_SPRITE   = PLAYER_FRAMES / 64    ; the twelve frames the rest are made from (frames.asm)
PUNCH_SPRITE    = PUNCH_FRAMES / 64     ; punching, by direction
ARM_OUT         = 10                    ; the arm stays out 0.2 seconds
PLAYER_COLOUR   = WHITE | $80           ; $80: a multicolour sprite

foot            .block
WALK_SPEED      = 297                   ; 58 pixels a second, in 1/256 pixel a frame
WALK_DIAGONAL   = 210                   ; and that along a diagonal, on each axis
SWIM_SPEED      = 113                   ; 22 pixels a second
SWIM_DIAGONAL   = 80
STRIDE          = 184                   ; the walk moves on 0.72 of a picture a frame: 9 steps a second
SLOW            = 230                   ; getting out: no faster than this along either axis, 0.9 pixels a frame
REACH           = 90                    ; getting in: dx * dx / 4 + dy * dy / 4 below this, 19 pixels away
SOUTH           = MAP_PIXELS - 11       ; as far south as the player's middle goes

                .section bss
on              .byte ?                 ; 1: the player is on foot; 0: in the car
pos             .fill 6                 ; on foot: x as fraction, pixel low and high; then y the same
face            .byte ?                 ; the way they face: 0 east, then clockwise in eighths of a turn
phase           .word ?                 ; the walk: the high byte's low three bits are where it is in its cycle
swim            .byte ?                 ; 1: in the water
fire_was        .byte ?                 ; 1: fire was held in the pass before
joy             .byte ?                 ; this pass's joystick
use             .byte ?                 ; 1: fire has just been pressed with the stick centred
press           .byte ?                 ; 1: fire has just been pressed, the stick anywhere
arm             .byte ?                 ; frames left with the arm out, after a punch (people.punch)
stuck           .byte ?                 ; walk: inside a wall
amount          .word ?                 ; walk: how far along an axis this frame
next            .fill 3                 ; walk: where that would put them on the axis
tx              .word ?                 ; blocked: the point to try, in pixels
ty              .word ?
row0            .byte ?                 ; blocked: the map rows of its north and south corners
row1            .byte ?
best            .byte ?                 ; enter: the nearest car, and how near
best_q          .byte ?
q               .byte ?
slot            .byte ?                 ; leave: the place for the car, its picture, and which spot is tried
sinking         .byte ?                 ; leave: 1 when the car is left because it flooded (water.asm)
k               .byte ?
try             .byte ?
                .send

; After video.init, which fills where the variables are with spaces. Also the two colours every multicolour
; sprite shares: black for outlines, hair and Big Honk's shades, yellow for the player's jacket and his beak and
; chain; and the water's idea of how wet the car is, which the car's first frame uses.
init            lda #$ff                ; (car.survey: no tile asked about yet)
                sta car.open_col
                sta car.other_col
                lda #0
                sta on
                sta arm
                sta water.wet
                sta swim
                sta face
                sta phase
                sta phase + 1
                .cerror BLACK != 0, "foot.init expects black to be 0"
                sta SPRITE_MULTI1
                lda #YELLOW
                sta SPRITE_MULTI2
                lda #1
                sta fire_was
                rts

; One pass of the main loop. In: A = joystick bits. Drives the car or walks, gets in or out if asked, and
; leaves where the player is in player_at.
update          sta joy
                lda arm                 ; the arm out after a punch: ARM_OUT frames
                beq +
                dec arm
+               lda #0
                sta use
                sta press
                lda joy
                and #JOY_FIRE
                beq fire_up             ; (A is 0: not held)
                lda fire_was
                bne fire_down
                inc press
                lda joy
                and #JOY_UP | JOY_DOWN | JOY_LEFT | JOY_RIGHT
                bne fire_down
                inc use
fire_down       lda #1
fire_up         sta fire_was
                lda on
                bne walking
                lda use                 ; getting out, if the car is slow enough: then it stays where it is
                beq +                   ; this frame (and the car's frame is not worked out, which leaves
                jsr leave               ; time for the player's picture in what may be a busy frame)
                lda on
                bne where
+               lda joy
                jsr car.update
                jmp where
walking         jsr walk
                lda use
                beq +
                jsr enter               ; (into a car within reach, if there is one)
                lda on
                beq where
+
.if CROWD != 0
                lda press               ; else fire is a shot with ammo left (gun.fire), or a stab with a
                beq where               ; knife or a punch (people.punch); nobody fights in the water
                lda swim
                bne where
                jsr gun.fire
.endif
where           lda on
                bne +
                lda car.pos_x + 1
                sta player_at
                lda car.pos_x + 2
                sta player_at + 1
                lda car.pos_y + 1
                sta player_at + 2
                lda car.pos_y + 2
                sta player_at + 3
                rts
+               lda pos + 1
                sta player_at
                lda pos + 2
                sta player_at + 1
                lda pos + 4
                sta player_at + 2
                lda pos + 5
                sta player_at + 3
                jmp police.hits         ; (on foot: a car may hit them)

; A frame on foot.
walk            lda pos + 1             ; in the water?
                sta car.px
                lda pos + 2
                sta car.px + 1
                lda pos + 4
                sta car.py
                lda pos + 5
                sta car.py + 1
                jsr car.kind_at
                ldx #0
                cmp #WATER_KIND
                bne +
                inx
+               stx swim
                lda joy
                and #JOY_UP | JOY_DOWN | JOY_LEFT | JOY_RIGHT
                tax
                lda way_of,x
                bpl +
                lda #0                  ; standing still: the middle of the walk
                sta phase
                sta phase + 1
                rts
+               sta face
                clc
                lda phase
                adc #STRIDE
                sta phase
                bcc +
                inc phase + 1
+               lda face                ; how far: less along each axis of a diagonal, and less swimming
                and #1
                ldx swim
                beq +
                ora #2
+               tax
                lda amount_lo,x
                sta amount
                lda amount_hi,x
                sta amount + 1
                jsr here
                jsr blocked
                lda #0
                rol
                sta stuck
                ldx #0                  ; across, then down
                jsr along
                ldx #3
; Move along the axis whose position is at pos + X, if the stick asks for it and nothing is in the way.
along           ldy face
                cpx #0
                beq +
                lda way_y,y
                jmp ++
+               lda way_x,y
+               bne +
                rts
+               bmi back
                clc
                lda pos,x
                adc amount
                sta next
                lda pos + 1,x
                adc amount + 1
                sta next + 1
                lda pos + 2,x
                adc #0
                sta next + 2
                jmp try_it
back            sec
                lda pos,x
                sbc amount
                sta next
                lda pos + 1,x
                sbc amount + 1
                sta next + 1
                lda pos + 2,x
                sbc #0
                sta next + 2
try_it          lda stuck
                bne go
                stx try
                jsr here                ; the point it would move to: this axis moved, the other as it is
                ldx try
                beq +
                lda next + 1
                sta ty
                lda next + 2
                sta ty + 1
                jmp ++
+               lda next + 1
                sta tx
                lda next + 2
                sta tx + 1
+               jsr blocked
                ldx try
                bcs stay
go              lda next
                sta pos,x
                lda next + 1
                sta pos + 1,x
                lda next + 2
                sta pos + 2,x
stay            rts

; tx, ty = where the player is, in pixels.
here            lda pos + 1
                sta tx
                lda pos + 2
                sta tx + 1
                lda pos + 4
                sta ty
                lda pos + 5
                sta ty + 1
                rts

; C set if the player does not fit with their middle at (tx, ty): one of the four corners 3 pixels from it is
; in a wall or off the city, or it is further south than SOUTH.
blocked         sec
                lda tx
                sbc #3
                tay
                lda tx + 1
                sbc #0
                bcc hit                 ; off the west edge
                tax
                tya
                jsr car.tile_of
                sta car.tx0
                clc
                lda tx
                adc #3
                tay
                lda tx + 1
                adc #0
                tax
                cpy #<MAP_PIXELS
                sbc #>MAP_PIXELS
                bcs hit                 ; off the east edge
                tya
                jsr car.tile_of
                sta car.tx1
                sec
                lda ty
                sbc #3
                tay
                lda ty + 1
                sbc #0
                bcc hit                 ; off the north edge
                tax
                tya
                jsr car.tile_of
                sta row0
                lda ty
                cmp #<(SOUTH + 1)
                lda ty + 1
                sbc #>(SOUTH + 1)
                bcs hit                 ; too far south
                clc
                lda ty
                adc #3
                tay
                lda ty + 1
                adc #0
                tax
                tya
                jsr car.tile_of
                sta row1
                ldx row0
                jsr car.row_check
                bcs hit
                ldx row1
                cpx row0
                beq +
                jmp car.row_check
+               clc
                rts
hit             sec
                rts

; Get into the nearest car within reach, if there is one.
enter           lda #REACH
                sta best_q
                lda #$ff
                sta best
                ldx #SLOTS - 1
-               lda traffic.on,x
                beq not_this
                lda traffic.sink,x      ; nobody can get into a car that flooded
                bne not_this
                sec
                lda traffic.pl,x
                sbc pos + 1
                tay
                lda traffic.ph,x
                sbc pos + 2
                jsr span
                bcs not_this
                sta q
                sec
                lda traffic.pl + N1,x
                sbc pos + 4
                tay
                lda traffic.ph + N1,x
                sbc pos + 5
                jsr span
                bcs not_this
                tay
                lda SQUARES,y           ; a quarter of each distance squared, rounded down
                ldy q
                clc
                adc SQUARES,y
                cmp best_q
                bcs not_this            ; no nearer than the best so far
                sta best_q
                stx best
not_this        dex
                bpl -
                ldx best
                bpl take
                rts
; Car X becomes the player's (take_io, from under the I/O area: main.asm).
take            #io_gate take_io

; C clear and A = the size of the 16-bit difference in A (high byte) and Y, if that is under 20; else C set.
span            cmp #0
                beq +
                cmp #$ff
                bne far
                tya                     ; -256 to -1
                eor #$ff
                clc
                adc #1
                beq far                 ; (256)
                jmp ++
+               tya
+               cmp #20
                rts
far             sec
                rts

; Get out of the car, if it is slow enough and there is somewhere to stand.
leave           lda #0                  ; (left, not flooded)
                sta sinking
                ldy #2                  ; down, then across
-               lda car.vel_x + 1,y
                beq +
                cmp #$ff
                bne no                  ; 256 or more either way
                lda car.vel_x,y         ; -256 to -1
                cmp #256 - SLOW
                bcc no
                bcs ++
+               lda car.vel_x,y         ; 0 to 255
                cmp #SLOW + 1
                bcs no
+               dey
                dey
                bpl -
                ldx #SLOTS - 1          ; a place in the traffic's tables for the car
-               lda traffic.on,x
                beq +
                dex
                bpl -
no              rts
+               stx slot
                lda car.angle + 1       ; the car's picture: 0-15
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                sta k
                ldy #0
spot            sty try
                lda k                   ; to its right, its left, behind it, in front of it
                clc
                adc turned,y
                and #15
                tax
                cpy #2
                bcs +
                lda beside_y,x
                pha
                lda beside_x,x
                jmp ++
+               lda beyond_y,x
                pha
                lda beyond_x,x
+               ldy #0                  ; the car's middle moved by that
                cmp #0
                bpl +
                dey
+               clc
                adc car.pos_x + 1
                sta tx
                tya
                adc car.pos_x + 2
                sta tx + 1
                ldy #0
                pla
                bpl +
                dey
+               clc
                adc car.pos_y + 1
                sta ty
                tya
                adc car.pos_y + 2
                sta ty + 1
                jsr blocked
                bcc out_here
                ldy try
                iny
                cpy #4
                bne spot
                rts                     ; nowhere to stand: stay in
out_here        lda #0
                sta pos
                sta pos + 3
                sta phase
                sta phase + 1
                lda tx
                sta pos + 1
                lda tx + 1
                sta pos + 2
                lda ty
                sta pos + 4
                lda ty + 1
                sta pos + 5
                lda k                   ; facing as the car does, to the nearest eighth of a turn
                clc
                adc #1
                lsr
                and #7
                sta face
                ldx slot                ; the car stays where it is, with no driver
                lda car.pos_x
                sta traffic.pf,x
                lda car.pos_x + 1
                sta traffic.pl,x
                lda car.pos_x + 2
                sta traffic.ph,x
                lda car.pos_y
                sta traffic.pf + N1,x
                lda car.pos_y + 1
                sta traffic.pl + N1,x
                lda car.pos_y + 2
                sta traffic.ph + N1,x
                lda k
                sta traffic.face,x
                clc                     ; lying along whichever axis is nearer, for what runs into it
                adc #2
                lsr
                lsr
                and #3
                sta traffic.dir,x
                lda car.colour
                sta traffic.col,x
                jsr park                ; (A = 0)
                sta traffic.cruise,x
                sta traffic.entered,x
                sta traffic.held,x
                sta traffic.ghost,x
                sta traffic.blocked,x
                lda police.stolen       ; (a police car the player drove is one still, empty; no other is)
                sta police.cop,x
                lda #0
                sta police.patrol,x
                sta police.stolen
                sta car.vel_x
                sta car.vel_x + 1
                sta car.vel_y
                sta car.vel_y + 1
                lda sinking             ; and if it flooded, going down from now
                sta traffic.sink,x
                lda #$ff
                sta traffic.turn,x
                lda #1
                sta traffic.on,x
                sta traffic.wreck,x
                sta on
                stx traffic.mine
; The panel's message says what fire does now, or that the car is gone; and it shows the car's bar or not.
hint            ldx #status.MSG_CAR
                lda on
                beq +
                ldx #status.MSG_FOOT
                lda sinking
                beq +
                ldx #status.MSG_SUNK
+               jsr status.say
                lda #1
                sta status.car_shown
                rts

; Sprite 0 for the next frame: the car, or the player on foot, placed as the car is (car.show).
show            lda on
                bne +
                jmp car.show
+               sec
                lda pos + 1
                sbc cam_lo
                tax
                lda pos + 2
                sbc cam_hi
                tay
                txa
                clc
                adc #31 - 12
                sta frame.next_sx
                tya
                adc #0
                and #1
                sta frame.next_sxh
                sec
                lda pos + 4
                sbc cam_lo + 1
                clc
                adc #55 - 10 - 1
                sta frame.next_sy
                lda swim
                beq +
                lda traffic.tick        ; swimming: two pictures, 16 frames each
                lsr
                lsr
                lsr
                lsr
                and #1
                ora #40
                bne +++
+               lda arm                 ; a punch: the arm out, facing the way they face
                beq +
                lda face
                clc
                adc #PUNCH_SPRITE
                bne +++
+               lda phase + 1           ; walking: the pose its cycle has reached, for the way they face
                and #7
                tax
                lda face
                asl
                asl
                adc face                ; (the carry is clear)
                adc cycle,x
+               jsr frames.point        ; the frame: one of the twelve, or one made from them
+               sta frame.next_sp
                lda #PLAYER_COLOUR
                sta frame.next_sc
                lda #1
                sta frame.next_d015
                rts

; The way the stick points, by its four direction bits; $ff for none. Opposite ones together are neither.
way_of          .byte $ff, 6, 2, $ff, 4, 5, 3, 4, 0, 7, 1, 0, $ff, 6, 2, $ff
way_x           .char 1, 1, 0, -1, -1, -1, 0, 1         ; each way's steps across and down
way_y           .char 0, 1, 1, 1, 0, -1, -1, -1
amount_lo       .byte <WALK_SPEED, <WALK_DIAGONAL, <SWIM_SPEED, <SWIM_DIAGONAL
amount_hi       .byte >WALK_SPEED, >WALK_DIAGONAL, >SWIM_SPEED, >SWIM_DIAGONAL
cycle           .byte 2, 3, 4, 3, 2, 1, 0, 1    ; the walk: the pose for each part of its cycle
turned          .byte 4, 12, 8, 0               ; leave: right, left, behind, in front, in sixteenths of a turn
beside_x
                .for i := 0, i < 16, i += 1
                .char int(round(12 * cos(i * pi / 8)))
                .next
beside_y
                .for i := 0, i < 16, i += 1
                .char int(round(12 * sin(i * pi / 8)))
                .next
beyond_x
                .for i := 0, i < 16, i += 1
                .char int(round(18 * cos(i * pi / 8)))
                .next
beyond_y
                .for i := 0, i < 16, i += 1
                .char int(round(18 * sin(i * pi / 8)))
                .next
                                .section io_code        ; (under the I/O area, through the gate: main.asm)
; Car X of the traffic's tables becomes the player's: heat 4, if it is taken from its driver (one driving: a car
; left standing has none), and 16 for a police car's; a police car, driven, is a stolen one (police.cruiser).
take_io         lda police.cop,x        ; (chasing, or on patrol)
                ora police.patrol,x
                sta police.stolen
                lda traffic.cruise,x
                beq taken
                txa
                pha
                lda #2 * 4
                ldy police.stolen
                beq +
                lda #2 * 16
+               jsr status.heat_a
                pla
                tax
taken           lda traffic.pf,x
                sta car.pos_x
                lda traffic.pl,x
                sta car.pos_x + 1
                lda traffic.ph,x
                sta car.pos_x + 2
                lda traffic.pf + N1,x
                sta car.pos_y
                lda traffic.pl + N1,x
                sta car.pos_y + 1
                lda traffic.ph + N1,x
                sta car.pos_y + 2
                lda traffic.face,x      ; facing as its picture does
                asl
                asl
                asl
                asl
                sta car.angle + 1
                lda #0
                sta car.angle
                sta car.vel_x
                sta car.vel_x + 1
                sta car.vel_y
                sta car.vel_y + 1
                sta traffic.on,x
                sta on
                lda traffic.dir,x       ; and going as it was, along its lane
                lsr
                lda #0
                rol
                asl
                tay                     ; 0 for across, 2 for down
                lda traffic.dir,x
                and #2
                bne +
                lda traffic.dlo,x
                sta car.vel_x,y
                lda traffic.dhi,x
                sta car.vel_x + 1,y
                jmp ++
+               sec
                lda #0
                sbc traffic.dlo,x
                sta car.vel_x,y
                lda #0
                sbc traffic.dhi,x
                sta car.vel_x + 1,y
+               lda traffic.col,x
                sta car.colour
                lda traffic.assist,x
                sta car.assist
                lda #1
                sta car.inside          ; wherever it was left: free to move if that was in a wall
                cpx traffic.mine
                bne +
                lda #$ff
                sta traffic.mine
+               jmp got
                .send
                .section tile_room4     ; (where there is room: main.asm)
; out_here: car X left standing, with its anti-theft as far as it has counted. A = 0 after.
park            lda car.assist
                sta traffic.assist,x
                lda #0
                sta traffic.sp,x
                sta traffic.dlo,x
                sta traffic.dhi,x
                rts
                .send
                .section tile_room3     ; (where there is room: main.asm)
; take_io's end: the message, or the immobiliser's, if the car is one anti-theft has stopped (car.anti).
got             jsr hint
                lda car.assist
                cmp #1
                bne +
                ldx #status.MSG_NO
                jmp status.say
+               rts
                .send
                .bend
