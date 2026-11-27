; SPDX-License-Identifier: GPL-2.0-or-later
; The gun, by the browser game's design (specs/design.md there, "Fighting on foot"): fire on foot with ammo
; left shoots, one shot every 0.22 seconds, the way the player faces; with none, it is the knife or fists
; (people.punch). Nobody fires in the water.
;
; A shot: a round less, 1.5 heat, and anyone within 110 of the player runs for 4 seconds. The bullet starts 5
; pixels ahead of the player's middle (4 each way on a diagonal) and flies 4.8 pixels a frame, 240 a second,
; for 27 frames (0.55 seconds). It is spent on a wall (not water), on a passer-by within 3 pixels either way
; (killed: 6 heat, and what they drop), or on a car within 8 either way (1 heat). It is a 2 x 2 yellow square,
; a sprite listed for the multiplexer after the pickups, its top left corner at the bullet.
;
; Officers on foot shoot with it too (police.shoot_io): their bullets (own 1) share its places, and hit only the
; player (police.cop_bullet).
;
; As the arm goes out for a punch, it does for a shot: the gun's frames want sprite room there is not yet.
; tests/e2e/people-model.mjs does the same in JavaScript, and the tests hold the two to each other.

gun             .block

BULLETS         = 3                     ; at once: 27 frames each, one every 11, so never more
GUN_WAIT        = 11                    ; frames between shots (0.22 seconds)
LIFE            = 27                    ; frames a bullet flies
STRAIGHT        = 1229                  ; 4.8 pixels a frame, in 1/256 pixel ...
DIAGONAL        = 869                   ; ... and on each axis of a diagonal
HIT_PERSON      = 3                     ; how near a bullet comes to a passer-by's middle to hit them, either way
HIT_CAR         = 8                     ; ... and to a car's
SCARE_SHOT      = 110                   ; who runs from a shot
FLEE_SHOT       = 100                   ; for 4 seconds (people.asm counts their turns, every other frame)
BULLET_SPRITE   = BULLET_FRAME / 64
OFF             = 0                     ; ticks: no bullet

                .section low_code       ; (where there is room: main.asm)
; Its frame, at start (after the passers-by's frames are copied up: the page they come in reaches it).
init            ldx #63
                lda #0
-               sta BULLET_FRAME,x
                dex
                bpl -
                lda #%00001100          ; pixels 12 and 13 of lines 10 and 11: where the bullet is
                sta BULLET_FRAME + 10 * 3 + 1
                sta BULLET_FRAME + 11 * 3 + 1
                rts
                .send
                .section low_more

; Fire on foot, out of the water (foot.update): with ammo left a shot, if the last was long enough ago; with
; none, people.punch (the knife or fists).
fire            lda status.ammo
                bne +
                jmp people.punch
+               lda people.punch_left
                beq +
                rts
+               lda #GUN_WAIT
                sta people.punch_left
                lda #ARM_OUT
                sta foot.arm
                sed                     ; a round less
                sec
                lda status.ammo
                sbc #1
                sta status.ammo
                cld
                lda #1
                sta status.changed
                ldx #BULLETS - 1        ; a place for the bullet (there is always one)
-               lda ticks,x
                beq +
                dex
                bpl -
                bmi scare
+               stx who
                lda #0                  ; (the player's)
                sta own,x
                lda #LIFE
                sta ticks,x
                ldy foot.face
                lda #$80                ; its middle: half a pixel in
                sta xf,x
                sta yf,x
                lda from_x,y
                jsr signed
                clc
                adc foot.pos + 1
                sta xl,x
                lda high
                adc foot.pos + 2
                sta xh,x
                lda from_y,y
                jsr signed
                clc
                adc foot.pos + 4
                sta yl,x
                lda high
                adc foot.pos + 5
                sta yh,x
                lda vx_lo,y
                sta vxl,x
                lda vx_hi,y
                sta vxh,x
                lda vy_lo,y
                sta vyl,x
                lda vy_hi,y
                sta vyh,x
scare           lda foot.pos + 1        ; anyone within SCARE_SHOT of the player runs
                sta people.cx
                lda foot.pos + 2
                sta people.cx + 1
                lda foot.pos + 4
                sta people.cy
                lda foot.pos + 5
                sta people.cy + 1
                ldx #CROWD - 1
-               lda people.on,x
                beq +
                lda people.down,x
                bne +
                lda #SCARE_SHOT
                ldy #0
                jsr people.beside
                bcs +
                lda #FLEE_SHOT
                sta people.flee,x
+               dex
                bpl -
                lda #2 * 3 / 2          ; 1.5 heat (in halves)
                jmp status.add_heat

; A = a signed byte; high = its high byte, $ff or 0.
signed          ldx #0
                cmp #0
                bpl +
                dex
+               stx high
                ldx who
                rts

; Once a frame, after the passers-by: each bullet flies on, and is spent on what it hits.
update          ldx #BULLETS - 1
-               stx who
                lda ticks,x
                beq next
                dec ticks,x
                beq next                ; (its time is up)
                clc                     ; on
                lda xf,x
                adc vxl,x
                sta xf,x
                lda xl,x
                adc vxh,x
                sta xl,x
                lda vxh,x
                and #$80
                beq +
                lda #$ff
+               adc xh,x
                sta xh,x
                clc
                lda yf,x
                adc vyl,x
                sta yf,x
                lda yl,x
                adc vyh,x
                sta yl,x
                lda vyh,x
                and #$80
                beq +
                lda #$ff
+               adc yh,x
                sta yh,x
                jsr hits
                ldx who
next            dex
                bpl -
                rts

; Bullet who (in X): spent on a wall, a passer-by or a car.
hits            lda xl,x                ; a wall (off the map is one too)
                sta car.px
                cmp #<MAP_PIXELS
                lda xh,x
                sta car.px + 1
                sbc #>MAP_PIXELS
                bcs spent
                lda yl,x
                sta car.py
                cmp #<MAP_PIXELS
                lda yh,x
                sta car.py + 1
                sbc #>MAP_PIXELS
                bcs spent
                jsr car.kind_at
                cmp #WALL
                beq spent
                ldx who                 ; an officer's: only the player (police.cop_bullet)
                lda own,x
                beq +
                jmp police.cop_bullet
+               lda xl,x                ; a passer-by, alive (and not lying dead)
                sta people.cx
                lda xh,x
                sta people.cx + 1
                lda yl,x
                sta people.cy
                lda yh,x
                sta people.cy + 1
                ldx #CROWD - 1
each_person     lda people.on,x
                beq next_person
                lda people.down,x
                beq +
                lda people.ko,x         ; down: only someone knocked down, not someone dead
                beq next_person
+               lda #HIT_PERSON
                ldy #0
                jsr people.beside
                bcc person
next_person     dex
                bpl each_person
                ldx #SLOTS - 1          ; a car
-               lda traffic.on,x
                beq +
                lda #HIT_CAR
                jsr near_car
                bcc car_hit
+               dex
                bpl -
                rts
person          lda #people.DOWN_TIME   ; killed
                sta people.down,x
                lda #0
                sta people.ko,x
                jsr people.killed
spent           ldx who
                lda #OFF
                sta ticks,x
                rts
car_hit         lda #2 * 1              ; 1 heat
                jsr status.add_heat
                jmp spent

; Car X within A of the point people.cx, people.cy either way? C clear if it is.
near_car        sta people.lim
                sec
                lda traffic.pl,x
                sbc people.cx
                sta people.d
                lda traffic.ph,x
                sbc people.cx + 1
                jsr people.within
                bcs +
                sec
                lda traffic.pl + N1,x
                sbc people.cy
                sta people.d
                lda traffic.ph + N1,x
                sbc people.cy + 1
                jmp people.within
+               rts

; Listed for the multiplexer, after the pickups: each bullet in sight.
show            ldx #BULLETS - 1
-               lda ticks,x
                beq next_shown
                lda xl,x                ; listed as a pickup is, without the bob
                sta pickups.mid_x
                lda xh,x
                sta pickups.mid_x + 1
                lda yl,x
                sta pickups.mid_y
                lda yh,x
                sta pickups.mid_y + 1
                lda #BULLET_SPRITE
                sta sprites.sp
                lda #YELLOW             ; (a hi-res sprite: bit 7 clear)
                sta sprites.sc
                lda #0
                jsr pickups.in_view
next_shown      dex
                bpl -
                rts

; By the way the player faces: where the bullet starts from their middle, and how fast it goes each way.
from_x         .char 5, 4, 0, -4, -5, -4, 0, 4
from_y         .char 0, 4, 5, 4, 0, -4, -5, -4
vx_lo           .byte <STRAIGHT, <DIAGONAL, 0, <-DIAGONAL, <-STRAIGHT, <-DIAGONAL, 0, <DIAGONAL
vx_hi           .byte >STRAIGHT, >DIAGONAL, 0, >-DIAGONAL, >-STRAIGHT, >-DIAGONAL, 0, >DIAGONAL
vy_lo           .byte 0, <DIAGONAL, <STRAIGHT, <DIAGONAL, 0, <-DIAGONAL, <-STRAIGHT, <-DIAGONAL
vy_hi           .byte 0, >DIAGONAL, >STRAIGHT, >DIAGONAL, 0, >-DIAGONAL, >-STRAIGHT, >-DIAGONAL

ticks           .fill BULLETS, 0        ; frames left; OFF: none
                .send
                .section low_code       ; (where there is room: main.asm)
own             .fill BULLETS, 0        ; 1: an officer's (police.shoot_io), which hits only the player
                .send
                .section low_more
xf              .fill BULLETS, 0        ; where: x as fraction, pixel low and high; y the same
xl              .fill BULLETS, 0
xh              .fill BULLETS, 0
yf              .fill BULLETS, 0
yl              .fill BULLETS, 0
yh              .fill BULLETS, 0
vxl             .fill BULLETS, 0        ; how fast, signed: 1/256 pixel a frame
vxh             .fill BULLETS, 0
vyl             .fill BULLETS, 0
vyh             .fill BULLETS, 0
who             .byte 0
high             .byte 0
bullet_end
                .send
                .bend
