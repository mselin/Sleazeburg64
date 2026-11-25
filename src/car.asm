; SPDX-License-Identifier: GPL-2.0-or-later
; The car: handling along the lines of the browser game's, collisions with the map and traffic, and its
; sprite.
;
; Units. Position in 1/256 pixel (three bytes: fraction, then the pixel as 16 bits). Velocity in 1/256
; pixel a frame, signed. Direction as 1/65536 of a turn, the high byte being the 256 directions the tables
; know: 0 is east, 64 south (the screen's y grows downwards), so angles go clockwise on screen.
;
; Each frame, as the browser game does with seconds: split the velocity into forward and sideways parts
; along the car, steer (faster turning the faster the car goes, up to a limit, and never sharper than the
; tyres hold: the turn asks them for the speed times it sideways, so it is kept to grip / speed, which holds
; only the fastest, above 3.2 pixels a frame on the road), push the forward part with
; the throttle, brake, handbrake, drag and coasting, wear the sideways part down by the tyres' grip, which is
; what makes the car slide when it turns fast, and put the changes back into the velocity. Then move one
; axis at a time; an axis that would put the car into a wall bounces back at a quarter of the speed. The
; changes are put back rather than the whole velocity rebuilt, so the rounding of the sine table never
; makes the car speed up or slow down by itself.
;
; Numbers per frame at 50 frames a second, from the browser game's sports car (per second there):
; acceleration 18 (180 px/s/s), braking 40, reverse 11, handbrake 22, coasting 5, top speed 1024 (4 pixels
; a frame, as fast as the screen can scroll; the browser's is 4.3) and backwards 410, grip 50, 30 while
; braking, 14 on the handbrake, and about half that on grass. Drag takes 1/128 of the speed a frame, and
; on grass 1/64 more (the design's 0.8 of it a second): there the car gets up to 3 pixels a frame at most.
;
; tests/e2e/car-model.mjs does the same sums in JavaScript, and the tests hold the two to each other exactly.

WALL            = 1                     ; tile kinds, from tools/assets.mjs
GRASS           = 2
ACCEL           = 18
BRAKE           = 40
REVERSE         = 11
HANDBRAKE       = 22
COAST           = 5
TOP             = 1024
TOP_BACK        = 410
BRAKING         = 26                    ; forward faster than this, and down means brake, not reverse
GRIP            = 50
GRIP_BRAKING    = 30
GRIP_HAND       = 14
TURN_SPEED      = 280                   ; steering is fastest from this forward speed up
EDGE            = 8                     ; how near the edge of the city the centre can go, in pixels

car             .block

                .section zp
pos_x           .byte ?, ?, ?           ; fraction, pixel low, pixel high
pos_y           .byte ?, ?, ?
vel_x           .word ?
vel_y           .word ?
angle           .word ?                 ; fraction, direction
inside          .byte ?                 ; 1: look whether the car is inside a wall; 0: it is known not to be
colour          .byte ?                 ; its sprite's colour
thr             .byte ?                 ; 1 accelerate, $ff brake or reverse, 0 neither
turn            .byte ?                 ; 1 clockwise, $ff anticlockwise
hand            .byte ?                 ; 1 handbrake
cs              .word ?                 ; cosine and sine of the direction, 256 for 1
sn              .word ?
fwd             .word ?
lat             .word ?
nf              .word ?
nl              .word ?
mv              .word ?                 ; mul_c, mul_s: mr = mv * cs or sn / 256, rounded towards 0
mr              .word ?
msign           .byte ?
ta              .byte ?
tb              .byte ?
prod            .word ?
sum             .word ?
px              .word ?                 ; hits: the centre and direction to try
py              .word ?
dir             .byte ?
qx              .word ?
qy              .word ?
t16             .word ?
tx0             .byte ?
tx1             .byte ?
ty0             .byte ?
ty1             .byte ?
mp              .word ?
size_lo         .byte ?, ?, ?           ; |cs| and |sn|, low bytes at 0 and 2 (as cs and sn are) ...
size_hi         .byte ?, ?, ?           ; ... and high bytes (1 for 256)
sign_of         .byte ?, ?, ?           ; and their signs
nx              .byte ?, ?, ?
d16             .byte ?
held_grip       .byte ?
ground          .byte ?                 ; the kind of tile under the car's middle this frame
open_col        .byte ?                 ; open: the tile last asked about, and whether it is walled
open_row        .byte ?
open_walled     .byte ?                 ; (bit 0 a wall near, bit 1 water)
other_col       .byte ?                 ; and the tile asked about before that
other_row       .byte ?
other_walled    .byte ?
pos_off         .byte ?                 ; axis_move: 0 or 3 into pos_x, and 0 or 2 into vel_x
vel_off         .byte ?
along           .byte ?, ?, ?           ; lead: the three points' offsets along the moving axis ...
across          .byte ?, ?, ?           ; ... and across it: middle, back, front
mo              .word ?
mn              .word ?
oth             .word ?
reach           .byte ?
point           .byte ?
moves           .byte ?
                .send

; ---------- 16-bit helpers ----------
mov16           .macro from, to
                lda \from
                sta \to
                lda \from + 1
                sta \to + 1
                .endm
neg16           .macro v
                sec
                lda #0
                sbc \v
                sta \v
                lda #0
                sbc \v + 1
                sta \v + 1
                .endm
add16           .macro a, b, to
                clc
                lda \a
                adc \b
                sta \to
                lda \a + 1
                adc \b + 1
                sta \to + 1
                .endm
sub16           .macro a, b, to
                sec
                lda \a
                sbc \b
                sta \to
                lda \a + 1
                sbc \b + 1
                sta \to + 1
                .endm
asr16           .macro v                ; arithmetic shift right: rounds down, as JavaScript's >> does
                lda \v + 1
                cmp #$80
                ror \v + 1
                ror \v
                .endm
asr_to          .macro v, n             ; mr = v >> n, the shift keeping the sign (as asr16 n times), n = 1-7:
                ldy #0                  ; v as 24 bits, shifted left 8 - n times, the top two bytes kept
                lda \v + 1
                bpl +
                dey
+               sty mr + 1
                sta mr
                lda \v
.for i = 0, i < 8 - \n, i += 1
                asl
                rol mr
                rol mr + 1
.next
                .endm
mul             .macro v, s, to         ; to = v * s / 256, rounded towards 0, for s = cs or sn
                #mov16 \v, mv
.if \s == cs
                jsr mul_c
.else
                jsr mul_s
.endif
                #mov16 mr, \to
                .endm

                .section once           ; runs once, from where it waits in the program file (main.asm)
; Build the quarter square table: n * n / 4, rounded down, for n = -255..511, the low bytes at SQUARES + n
; and the high bytes at SQUARES_HI + n, so that a * b = (a + b)^2 / 4 - (a - b)^2 / 4, from the one table.
; (Before, a second table, moved along by 255, held the negative half: 1K, for what is 510 bytes.)
init            lda #0
                sta trig_set
                sta fwd_set
                sta sum
                sta sum + 1
                sta prod                ; n * n, 24 bits: prod, prod + 1, ta
                sta prod + 1
                sta ta
                tax                     ; n, low byte; tb is its high bit
                sta tb
-               lda ta                  ; store (n * n) >> 2
                sta sum + 1
                lda prod + 1
                sta sum
                lda prod
                lsr sum + 1
                ror sum
                ror
                lsr sum + 1
                ror sum
                ror
                ldy tb
                bne +
                sta SQUARES,x
                lda sum
                sta SQUARES_HI,x
                jmp ++
+               sta SQUARES + 256,x
                lda sum
                sta SQUARES_HI + 256,x
+               txa                     ; n * n + 2n + 1 = (n + 1) * (n + 1)
                asl
                sta mp
                lda tb
                rol
                sta mp + 1
                sec                     ; + 1 by the carry
                lda prod
                adc mp
                sta prod
                lda prod + 1
                adc mp + 1
                sta prod + 1
                bcc +
                inc ta
+               inx
                bne -
                inc tb
                lda tb
                cmp #2
                bne -
                ldx #1                  ; and -n the same as n, for n = 1..255
-               txa
                eor #$ff
                tay
                iny                     ; 256 - n
                lda SQUARES,x
                sta SQUARES - 256,y
                lda SQUARES_HI,x
                sta SQUARES_HI - 256,y
                inx
                bne -
                rts
                .send

; Put the car at pixel (A low, X high) across and (Y low, sum high) down, facing east, standing still.
; The tests do the same through memory, then set `inside` to 1.
place           sta pos_x + 1
                stx pos_x + 2
                sty pos_y + 1
                lda sum
                sta pos_y + 2
                lda #0
                sta pos_x
                sta pos_y
                sta vel_x
                sta vel_x + 1
                sta vel_y
                sta vel_y + 1
                sta angle
                sta angle + 1
                lda #1
                sta inside
                lda #RED
                sta colour
                rts

; One frame of driving. In: A = joystick bits.
update          tay
                lda #0
                sta thr
                sta turn
                sta hand
                tya
                and #JOY_UP | JOY_DOWN
                cmp #JOY_UP
                bne +
                inc thr
+               cmp #JOY_DOWN
                bne +
                dec thr
+               tya
                and #JOY_LEFT | JOY_RIGHT
                cmp #JOY_RIGHT
                bne +
                inc turn
+               cmp #JOY_LEFT
                bne +
                dec turn
+               tya
                and #JOY_FIRE
                beq +
                inc hand
+               lda inside              ; put inside a wall: free to move until it is out
                beq +
                jsr here
                lda angle + 1
                sta dir
                jsr hits
                lda #0
                rol
                sta inside
+               jsr here                ; what it is on, for the grip and the drag
                jsr kind_at
                sta ground
                lda #0                  ; the grip: not worked out yet this frame
                sta held_grip
                sta fwd_set
                jsr steer
                jsr trig
                lda fwd_set             ; forward = vx cos + vy sin: as steer worked it out, if the direction
                beq +                   ; is still the one it was for
                lda fwd_dir
                cmp angle + 1
                bne +
                #mov16 fwd0, fwd
                jmp ++
+               #mul vel_x, cs, fwd
                #mul vel_y, sn, mr
                #add16 fwd, mr, fwd
+               #mul vel_y, cs, lat     ; sideways = vy cos - vx sin
                #mul vel_x, sn, mr
                #sub16 lat, mr, lat
                jsr engine
                jsr tyres
                #sub16 nf, fwd, nf      ; the changes ...
                #sub16 nl, lat, nl
                lda nf                  ; ... back into the velocity (what is multiplied by 0 adds nothing):
                ora nf + 1              ; vx += dF cos - dL sin, vy += dF sin + dL cos
                beq +
                #mul nf, cs, fwd
                #add16 vel_x, fwd, vel_x
                #mul nf, sn, fwd
                #add16 vel_y, fwd, vel_y
+               lda nl
                ora nl + 1
                beq +
                #mul nl, sn, lat
                #sub16 vel_x, lat, vel_x
                #mul nl, cs, lat
                #add16 vel_y, lat, vel_y
+
                jsr traffic.nearby      ; the traffic it could run into
                jsr move_x
                jmp move_y

; px, py = the car's centre in pixels.
here            #mov16 pos_x + 1, px
                #mov16 pos_y + 1, py
                rts

trig_dir        .byte 0                 ; trig: the direction cs, sn and the tables are set for ...
trig_set        .byte 0                 ; ... if this is 1
fwd_dir         .byte 0                 ; steer: the direction it worked out the forward speed for ...
fwd_set         .byte 0                 ; ... if this is 1 (this frame only) ...
fwd0            .word 0                 ; ... and that speed

; cs, sn for the car's direction, and for multiplying by them: their sizes (0-256) and signs.
trig            ldx angle + 1
                lda trig_set            ; set for this direction already
                beq +
                cpx trig_dir
                bne +
                rts
+               stx trig_dir
                lda #1
                sta trig_set
                txa                     ; cos = sin a quarter turn on
                clc
                adc #64
                tax
                jsr sine
                sta cs
                sty cs + 1
                ldx trig_dir
                jsr sine
                sta sn
                sty sn + 1
                ldx #2
-               lda cs + 1,x            ; sign: $00 or $ff
                sta sign_of,x
                bpl +
                sec
                lda #0
                sbc cs,x
                sta size_lo,x
                lda #0
                sbc cs + 1,x
                sta size_hi,x
                jmp ++
+               lda cs,x
                sta size_lo,x
                lda cs + 1,x
                sta size_hi,x
+               dex
                dex
                bpl -
                .cerror sn - cs != 2, "trig expects sn two bytes after cs"
                lda size_lo             ; and the multiplications' table, moved along by |cs| and |sn| ...
                sta mul_c.p1 + 1
                sta mul_c.p3 + 1
                sta mul_c.p5 + 1
                sta mul_c.p7 + 1
                lda #0                  ; ... and back by them (into the page before, but for 0)
                sec
                sbc size_lo
                sta mul_c.p2 + 1
                sta mul_c.p4 + 1
                sta mul_c.p6 + 1
                sta mul_c.p8 + 1
                lda #>SQUARES - 1       ; (the carry is set for 0)
                adc #0
                sta mul_c.p2 + 2
                sta mul_c.p6 + 2
                adc #(>SQUARES_HI) - (>SQUARES) ; (the carry is clear)
                sta mul_c.p4 + 2
                sta mul_c.p8 + 2
                lda size_lo + 2
                sta mul_s.p1 + 1
                sta mul_s.p3 + 1
                sta mul_s.p5 + 1
                sta mul_s.p7 + 1
                lda #0
                sec
                sbc size_lo + 2
                sta mul_s.p2 + 1
                sta mul_s.p4 + 1
                sta mul_s.p6 + 1
                sta mul_s.p8 + 1
                lda #>SQUARES - 1
                adc #0
                sta mul_s.p2 + 2
                sta mul_s.p6 + 2
                adc #(>SQUARES_HI) - (>SQUARES)
                sta mul_s.p4 + 2
                sta mul_s.p8 + 2
                rts

; Turn by up to 2.46 directions a frame, scaled down below TURN_SPEED forward, a quarter more on the
; handbrake, and backwards when reversing. Refused if the turn would put the car into a wall, and in a frame
; of colour memory if it would turn the car's picture a step, which is when that has to be looked at.
steer           lda turn
                bne +
                rts
+               jsr trig
                #mul vel_x, cs, fwd     ; the forward speed before turning
                #mul vel_y, sn, mr
                #add16 fwd, mr, fwd
                #mov16 fwd, fwd0        ; (for update, if the direction stays the same)
                lda angle + 1
                sta fwd_dir
                lda #1
                sta fwd_set
                lda fwd
                ora fwd + 1
                bne +
                rts                     ; standing still: no turning
+               jsr grip_of             ; what the tyres hold, from the speed before turning, as the design
                lda fwd + 1             ; m = min(|fwd|, TURN_SPEED)
                php                     ; N: going backwards
                bpl +
                #neg16 fwd
+               lda fwd + 1             ; the speed in sixteenths of a pixel a frame, at most 64, for the limit
                cmp #4
                bcc +
                lda #64
                bne ++
+               asl
                asl
                asl
                asl
                sta tb
                lda fwd
                lsr
                lsr
                lsr
                lsr
                ora tb
+               pha
                lda fwd
                cmp #<TURN_SPEED
                lda fwd + 1
                sbc #>TURN_SPEED
                bcc +
                lda #<TURN_SPEED
                sta fwd
                lda #>TURN_SPEED
                sta fwd + 1
+               #mov16 fwd, mr          ; rate = 2m + m / 4
                lsr mr + 1
                ror mr
                lsr mr + 1
                ror mr
                asl fwd
                rol fwd + 1
                #add16 fwd, mr, fwd
                pla
                ldx hand                ; handbrake: a quarter more, and no limit
                bne +
                ldx held_grip           ; else never sharper than the tyres hold: at full grip that can only
                cpx #GRIP               ; be from 52 sixteenths up (and this is the busiest part of the
                bne hold                ; busiest frames)
                cmp #52
                bcc ++
hold            jsr hold_turn
                jmp ++
+               #mov16 fwd, mr
                lsr mr + 1
                ror mr
                lsr mr + 1
                ror mr
                #add16 fwd, mr, fwd
+               lda turn                ; which way: the stick's, the other way when going backwards
                plp
                bpl +
                eor #$fe                ; 1 and $ff swap
+               ora #0
                bpl +
                #neg16 fwd
+               #add16 angle, fwd, nf   ; the new direction, tried
                lda inside
                bne take
                lda nf + 1              ; same sprite direction: the same shape in the same place, still clear
                clc
                adc #8
                and #$f0
                sta tb
                lda angle + 1
                clc
                adc #8
                and #$f0
                cmp tb
                beq take
                lda busy                ; a frame of colour memory has no time to look: the picture turns a
                bne no_turn             ; step in the next frame instead (at most a fiftieth of a second)
                jsr here
                lda nf + 1
                sta dir
                jsr hits
                bcc take
no_turn         rts
take            #mov16 nf, angle
                rts

; nf = the forward speed after the engine, brakes and drag.
engine          #mov16 fwd, nf
                lda thr
                beq coasting
                bmi down
                ldy water.wet           ; accelerate: less in the water
                clc
                lda nf
                adc water.accel,y
                sta nf
                bcc drag
                inc nf + 1
                jmp drag
down            lda fwd + 1             ; brake while going forward faster than BRAKING, else reverse
                bmi do_reverse
                bne do_brake
                lda fwd
                cmp #BRAKING + 1
                bcc do_reverse
do_brake        sec
                lda nf
                sbc #BRAKE
                sta nf
                bcs drag
                dec nf + 1
                jmp drag
do_reverse      sec
                lda nf
                sbc #REVERSE
                sta nf
                bcs drag
                dec nf + 1
                jmp drag
coasting
drag            lda hand
                beq +
                ldx #HANDBRAKE
                jsr shrink_nf
+               jsr nf_less_7           ; nf -= nf >> 7
                lda thr
                bne +
                ldx #COAST
                jsr shrink_nf
+               jsr water.drag          ; and more drag in the water
                lda ground              ; and on grass, hard going: nf -= nf >> 6, the design's 0.8 of the
                cmp #GRASS              ; speed a second
                bne +
                jsr nf_less_6
+
                ldy water.wet           ; no faster than TOP forwards or TOP_BACK backwards, less in the water
                lda nf + 1
                bmi backwards
                lda water.top_lo,y
                cmp nf
                lda water.top_hi,y
                sbc nf + 1
                bcs limited             ; top >= nf
                lda water.top_lo,y
                sta nf
                lda water.top_hi,y
                sta nf + 1
                rts
backwards       lda nf
                cmp water.back_lo,y
                lda nf + 1
                sbc water.back_hi,y
                bcs limited             ; both negative: an unsigned compare will do
                lda water.back_lo,y
                sta nf
                lda water.back_hi,y
                sta nf + 1
limited         rts

; nl = the sideways speed after the tyres' grip: towards 0 by the grip, then 1/64 less.
tyres           lda held_grip           ; (worked out already if the car turned)
                bne +
                jsr grip_of
+
                #mov16 lat, nl
                ldx held_grip
                jsr shrink_nl
                #asr_to nl, 6              ; nl -= nl >> 6
                #sub16 nl, mr, nl
                rts

                .section car_extra
; held_grip = what the tyres hold sideways now, for the forward speed in fwd: less on the handbrake, braking,
; on grass and in the water.
grip_of         ldx #GRIP
                lda hand
                beq not_hand
                ldx #GRIP_HAND
                bne gripped
not_hand        lda thr                 ; braking: down, going forward faster than BRAKING
                bpl gripped
                lda fwd + 1
                bmi gripped
                bne is_braking
                lda fwd
                cmp #BRAKING + 1
                bcc gripped
is_braking      ldx #GRIP_BRAKING
gripped         stx held_grip
                lda ground              ; on grass: 9/16 of it
                cmp #GRASS
                bne grip_set
                ldx held_grip
                lda #GRIP * 9 / 16
                cpx #GRIP
                beq on_grass
                lda #GRIP_BRAKING * 9 / 16
                cpx #GRIP_BRAKING
                beq on_grass
                lda #GRIP_HAND * 9 / 16
on_grass        sta held_grip
grip_set        jmp water.grip          ; and less in the water

                .send

; nf -= nf >> 7, or >> 6, the shift keeping the sign.
nf_less_7       #asr_to nf, 7
                #sub16 nf, mr, nf
                rts
nf_less_6       #asr_to nf, 6
                #sub16 nf, mr, nf
                rts

                .section car_extra
; Turning at rate (in fwd) asks the tyres for the speed times it sideways; never more than they hold, so
; rate <= grip * 10430 / speed (10430 = 65536 / 2 pi: a radian in the angle's units). With the speed in
; sixteenths from A, by the table: rate <= grip * most_turn[A] / 4.
hold_turn       tax                     ; nf = grip * most_turn, by quarter squares (see init):
                lda most_turn,x         ; (t + g)^2 / 4 - (t - g)^2 / 4
                sta mr
                clc
                adc held_grip
                tax
                bcs +
                lda SQUARES,x
                sta nf
                lda SQUARES_HI,x
                sta nf + 1
                jmp ++
+               lda SQUARES + 256,x
                sta nf
                lda SQUARES_HI + 256,x
                sta nf + 1
+               lda mr
                sec
                sbc held_grip
                bcs +
                eor #$ff
                adc #1
+               tax
                sec
                lda nf
                sbc SQUARES,x
                sta nf
                lda nf + 1
                sbc SQUARES_HI,x
                sta nf + 1
                lsr nf + 1              ; / 4
                ror nf
                lsr nf + 1
                ror nf
                lda nf                  ; rate = min(rate, that)
                cmp fwd
                lda nf + 1
                sbc fwd + 1
                bcs +
                #mov16 nf, fwd
+               rts
                .send
                .section car_extra
; 4 * 10430 / the middle of each sixteenth, no more than 255 (which never limits: the turn is slower there).
most_turn
.for n = 0, n < 65, n += 1
                .byte 4 * 10430.378 / (16 * n + 8) + 0.5 > 255 ? 255 : int(4 * 10430.378 / (16 * n + 8) + 0.5)
.next
                .send

; Towards 0 by X, no further: nf, or nl.
shrink_nf       stx tb
                lda nf + 1
                bmi neg_nf
                bne +
                lda nf
                cmp tb
                bcc zero_nf
+               sec
                lda nf
                sbc tb
                sta nf
                bcs +
                dec nf + 1
+               rts
neg_nf          cmp #$ff
                bne +
                lda nf
                beq +                   ; -256 and below
                clc
                adc tb
                bcs zero_nf
+               clc
                lda nf
                adc tb
                sta nf
                bcc +
                inc nf + 1
+               rts
zero_nf         lda #0
                sta nf
                sta nf + 1
                rts

shrink_nl       stx tb
                lda nl + 1
                bmi neg_nl
                bne +
                lda nl
                cmp tb
                bcc zero_nl
+               sec
                lda nl
                sbc tb
                sta nl
                bcs +
                dec nl + 1
+               rts
neg_nl          cmp #$ff
                bne +
                lda nl
                beq +
                clc
                adc tb
                bcs zero_nl
+               clc
                lda nl
                adc tb
                sta nl
                bcc +
                inc nl + 1
+               rts
zero_nl         lda #0
                sta nl
                sta nl + 1
                rts

; Move across by vel_x; into a wall or a traffic car it bounces back instead, at a quarter of the speed.
move_x          ldx #0                  ; X: the position's offset from pos_x
                ldy #0                  ; Y: the velocity's offset from vel_x
                jmp axis_move
move_y          ldx #3
                ldy #2
                .cerror pos_y - pos_x != 3 || vel_y - vel_x != 2, "axis_move expects this layout"
axis_move       stx pos_off
                sty vel_off
                clc
                lda pos_x,x
                adc vel_x,y
                sta nx
                lda pos_x + 1,x
                adc vel_x + 1,y
                sta nx + 1
                lda vel_x + 1,y         ; sign extended
                and #$80
                beq +
                lda #$ff
+               adc pos_x + 2,x
                sta nx + 2
                lda inside              ; inside a wall: anywhere goes
                bne go
                lda nx + 1              ; the same pixel: still clear
                cmp pos_x + 1,x
                bne look
                lda nx + 2
                cmp pos_x + 2,x
                beq go
look            jsr lead
                bcs bounce
                jsr traffic.bump        ; no wall: a traffic car?
                bcc go
                ldy vel_off
                jsr traffic.hit         ; a wreck, if that was hard
bounce          ldx vel_off             ; bounce: v = -(v >> 2)
                lda vel_x + 1,x
                cmp #$80
                ror vel_x + 1,x
                ror vel_x,x
                lda vel_x + 1,x
                cmp #$80
                ror vel_x + 1,x
                ror vel_x,x
                sec
                lda #0
                sbc vel_x,x
                sta vel_x,x
                lda #0
                sbc vel_x + 1,x
                sta vel_x + 1,x
                rts
go              ldx pos_off             ; and no nearer the edge than EDGE
                lda nx
                sta pos_x,x
                lda nx + 2
                bmi low
                lda nx + 1
                cmp #<(MAP_PIXELS - EDGE)
                lda nx + 2
                sbc #>(MAP_PIXELS - EDGE)
                bcs high
                lda nx + 1
                cmp #<EDGE
                lda nx + 2
                sbc #>EDGE
                bcc low
                lda nx + 1
                sta pos_x + 1,x
                lda nx + 2
                sta pos_x + 2,x
                rts
low             lda #0
                sta pos_x,x
                lda #<EDGE
                sta pos_x + 1,x
                lda #>EDGE
                sta pos_x + 2,x
                rts
high            lda #0
                sta pos_x,x
                lda #<(MAP_PIXELS - EDGE)
                sta pos_x + 1,x
                lda #>(MAP_PIXELS - EDGE)
                sta pos_x + 2,x
                rts

                .section car_more       ; (from here to kind_at: where there is room, MORE_CODE)
; C set if moving along one axis, from where the car is to nx, runs it into a wall. Where it is now is
; known to be clear, so only the tiles that the leading edge of each of its three boxes moves into need
; looking at: a box is narrower than a tile, so that is at most one new column (or row) of two tiles for
; each box, and usually none. This gives the same answer as hits for the new place, for far less work.
; In: pos_off = 0 across or 3 down.
; Before the walls are looked at, the 3 by 3 tiles round where it is (survey): a move is at most 4.3 pixels, so
; every point looked at is within 14 pixels of its middle now, and if none of those tiles is a wall, none is in
; the way.
lead            lda angle + 1           ; the three points' offsets: middle, back, front
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                tax
                ldy pos_off             ; along the axis moving, and across it
                bne +
                lda axis_x,x
                sta along + 2
                lda axis_y,x
                sta across + 2
                jmp ++
+               lda axis_y,x
                sta along + 2
                lda axis_x,x
                sta across + 2
+               lda along + 2
                eor #$ff
                clc
                adc #1
                sta along + 1
                lda across + 2
                eor #$ff
                clc
                adc #1
                sta across + 1
                lda #0
                sta along
                sta across
                ldx pos_off             ; mo: where the moving axis is now, mn: where it goes, oth: the other
                lda pos_x + 1,x
                sta mo
                lda pos_x + 2,x
                sta mo + 1
                lda nx + 1
                sta mn
                lda nx + 2
                sta mn + 1
                txa
                eor #3
                tax
                lda pos_x + 1,x
                sta oth
                lda pos_x + 2,x
                sta oth + 1
                jsr here                ; (traffic.bump uses all of the above; the walls only what follows)
                jsr survey
                lsr
                bcs +
                rts                     ; (C clear: clear)
+               lda #4                  ; the leading edge: 4 pixels ahead, either way
                sta reach
                lda mn
                cmp mo
                lda mn + 1
                sbc mo + 1
                bcs +
                lda #$fc
                sta reach
+               sec                     ; how far it moves: -4 to 4 pixels, the same for every point
                lda mn
                sbc mo
                sta moves
                ldy #2
next_point      sty point
                lda along,y             ; a new tile only if where the edge is in its tile, moved that far,
                clc                     ; is outside it (and where the car is now is clear, so in the city):
                adc reach               ; the edge's pixel, low byte, is mo + along + reach
                clc
                adc mo
                and #15
                clc
                adc moves
                cmp #16
                bcs +
                jmp next                ; no new tiles for this box
+               lda along,y             ; e0 = mo + along + reach, e1 = mn + along + reach
                clc
                adc reach
                sta t16                 ; (along + reach is from -10 to 10)
                and #$80
                beq +
                lda #$ff
+               sta t16 + 1
                clc
                lda mo
                adc t16
                sta qx
                lda mo + 1
                adc t16 + 1
                sta qx + 1
                clc
                lda mn
                adc t16
                sta qy
                lda mn + 1
                adc t16 + 1
                sta qy + 1
                bpl +
                jmp stopped             ; off the west or north edge
+               lda qy
                ldx qy + 1
                jsr tile_of
                cmp #MAP_SIZE
                bcs stopped             ; off the east or south edge
                sta tx1
                lda qx
                ldx qx + 1
                jsr tile_of
                cmp tx1
                beq next                ; no new tiles for this box
                ldy point               ; the box's extent across: its two tiles
                lda across,y
                sta t16
                and #$80
                beq +
                lda #$ff
+               sta t16 + 1
                clc
                lda oth
                adc t16
                sta qx
                lda oth + 1
                adc t16 + 1
                sta qx + 1
                lda qx                  ; the tile under the point across, and the ones under its edges
                ldx qx + 1
                jsr tile_of
                sta ty0
                sta ty1
                lda qx
                and #15
                cmp #4
                bcs +
                dec ty0
+               cmp #12
                bcc +
                inc ty1
+               lda pos_off             ; look at the new tiles: (tx1, ty0) and (tx1, ty1), or the other way round
                bne down_move
                lda tx1                 ; moving across: column tx1, rows ty0 and ty1
                sta tx0
                ldx ty0
                jsr one_tile
                bcs stopped
                ldx ty1
                jsr one_tile
                bcs stopped
                jmp next
down_move       lda ty0                 ; moving down: row tx1, columns ty0 and ty1
                sta tx0
                ldx tx1
                jsr one_tile
                bcs stopped
                lda ty1
                sta tx0
                ldx tx1
                jsr one_tile
                bcs stopped
next            ldy point
                dey
                bmi +
                jmp next_point
+               clc
                rts
stopped         sec
                rts

; C set if tile tx0 of map row X is a wall.
one_tile        lda video.row_lo,x
                sta mp
                lda video.row_hi,x
                sta mp + 1
                ldy tx0
                lda (mp),y
                tax
                lda tile_kind,x
                cmp #WALL
                beq stopped
                clc
                rts

; What the 3 by 3 tiles round the tile (px, py) is in hold, kept for the last two tiles asked about (open_col,
; open_row, and other_col, other_row), which are usually the same ones: A bit 0 set if any is a wall, bit 1 if any is water, both if they
; are not all in the city.
city_edge       lda #3                  ; (for the first tests below, in reach)
                rts
survey          lda px + 1              ; (well inside the city: a high byte of 6 or less)
                cmp #7
                bcs city_edge
                lda py + 1
                cmp #7
                bcs city_edge
                lda px
                ldx px + 1
                jsr tile_of
                sta tx0
                lda py
                ldx py + 1
                jsr tile_of
                sta ty0
                lda tx0                 ; not on the city's edge
                beq edge_of_city
                cmp #MAP_SIZE - 1
                bcs edge_of_city
                lda ty0
                beq edge_of_city
                cmp #MAP_SIZE - 1
                bcs edge_of_city
                lda tx0
                cmp open_col
                bne +
                lda ty0
                cmp open_row
                bne +
                lda open_walled         ; the same tile: as before
                rts
+               lda tx0                 ; or the one before that (the car's middle before and after a move)
                cmp other_col
                bne +
                lda ty0
                cmp other_row
                bne +
                lda other_walled
                rts
+               lda open_col            ; neither: the last becomes the one before
                sta other_col
                lda open_row
                sta other_row
                lda open_walled
                sta other_walled
                lda tx0
                sta open_col
                lda ty0
                sta open_row
                lda #0
                sta open_walled
                ldx ty0
                dex
                stx ty1
-               ldx ty1
                lda video.row_lo,x
                sta mp
                lda video.row_hi,x
                sta mp + 1
                ldy tx0
                dey
                jsr survey_tile
                iny
                jsr survey_tile
                iny
                jsr survey_tile
                inc ty1
                lda ty1
                sec
                sbc ty0
                cmp #2
                bne -
                lda open_walled
                rts
edge_of_city    lda #3
                rts
survey_tile     lda (mp),y
                tax
                lda tile_kind,x
                cmp #WALL
                bne +
                lda #1
                ora open_walled
                sta open_walled
                rts
+               cmp #WATER_KIND
                bne +
                lda #2
                ora open_walled
                sta open_walled
+               rts
; C clear if none of those is a wall (and all are in the city).
open            jsr survey
                lsr
                rts

; C set if the car, centred at (px, py) and facing dir, touches a wall or the edge of the city: three points
; along it (the middle, and 6 pixels to the front and back), each with a 9 by 9 box, as the browser game does.
; Every point of those is within 10 pixels of the middle, so within the 3 by 3 tiles round the middle's tile:
; if none of those is a wall, none touches one (open), which is what the streets mostly are, and much quicker.
hits            jsr open
                bcs +
                rts                     ; (C clear: clear)
+               lda dir
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                sta d16                 ; the sprite direction, 0-15
                #mov16 px, qx
                #mov16 py, qy
                jsr box
                bcs +
                ldx d16
                sec
                lda px
                sbc axis_x,x
                sta qx
                lda axis_x,x            ; sign of the offset, for the high byte
                and #$80
                beq of1
                lda #$ff
of1             eor #$ff                ; px - offset: borrow the complement
                adc px + 1
                sta qx + 1
                sec
                lda py
                sbc axis_y,x
                sta qy
                lda axis_y,x
                and #$80
                beq of2
                lda #$ff
of2             eor #$ff
                adc py + 1
                sta qy + 1
                jsr box
                bcs +
                ldx d16
                clc
                lda px
                adc axis_x,x
                sta qx
                lda axis_x,x
                and #$80
                beq of3
                lda #$ff
of3             adc px + 1
                sta qx + 1
                clc
                lda py
                adc axis_y,x
                sta qy
                lda axis_y,x
                and #$80
                beq of4
                lda #$ff
of4             adc py + 1
                sta qy + 1
                jmp box
+               rts

; C set if the 9 by 9 box around (qx, qy) touches a wall or the edge. The box is narrower than a tile, so
; its edges are in the point's own tile or the next one: the one before if the point is less than 4 pixels
; into its tile, the one after if it is more than 11.
box             lda qx + 1              ; off the west or north edge
                bmi blocked
                lda qy + 1
                bmi blocked
                lda qx
                cmp #4
                lda qx + 1
                sbc #0
                bcc blocked             ; qx < 4
                lda qy
                cmp #4
                lda qy + 1
                sbc #0
                bcc blocked
                lda qx                  ; tile column, and the columns of the box's two edges
                ldx qx + 1
                jsr tile_of
                sta tx0
                sta tx1
                lda qx
                and #15
                cmp #4
                bcs +
                dec tx0
+               cmp #12
                bcc +
                inc tx1
+               lda tx1
                cmp #MAP_SIZE
                bcs blocked             ; off the east edge
                lda qy                  ; and the same for the rows
                ldx qy + 1
                jsr tile_of
                sta ty0
                sta ty1
                lda qy
                and #15
                cmp #4
                bcs +
                dec ty0
+               cmp #12
                bcc +
                inc ty1
+               lda ty1
                cmp #MAP_SIZE
                bcs blocked             ; off the south edge
                ldx ty0
                jsr row_check
                bcs blocked
                ldx ty1
                cpx ty0
                beq clear
                jmp row_check
clear           clc
                rts
blocked         sec
                rts

; A = the tile under pixel (A low, X high), for pixels below 4096.
tile_of         lsr
                lsr
                lsr
                lsr
                ora times16,x
                rts

; C set if tile tx0 or tx1 of map row X is a wall.
row_check       lda video.row_lo,x
                sta mp
                lda video.row_hi,x
                sta mp + 1
                ldy tx0
                lda (mp),y
                tax
                lda tile_kind,x
                cmp #WALL
                beq blocked
                ldy tx1
                cpy tx0
                beq clear
                lda (mp),y
                tax
                lda tile_kind,x
                cmp #WALL
                beq blocked
                clc
                rts

; A = t16 / 16, for t16 below 4096.
tile16          lda t16
                ldx t16 + 1
                jmp tile_of
times16         .byte range(16) * 16

; A = the kind of the tile under (px, py).
kind_at         lda py
                sta t16
                lda py + 1
                sta t16 + 1
                jsr tile16
                tax
                lda video.row_lo,x
                sta mp
                lda video.row_hi,x
                sta mp + 1
                lda px
                sta t16
                lda px + 1
                sta t16 + 1
                jsr tile16
                tay
                lda (mp),y
                tax
                lda tile_kind,x
                rts

                .send

; mr = mv * s / 256, rounded towards 0, for s = cs (mul_c) or sn (mul_s), as trig left them. With quarter
; squares (see init): trig moves the table's addresses along by |s| (the low bytes of p1, p3, p5, p7) and back
; by it (p2, p4, p6, p8, both bytes: the table goes on below), which leaves a * |s| = p1[a] - p2[a], 16 bits.
times           .macro at
                lda size_hi + \at       ; |s| = 256: mr = mv, or -mv
                beq ++
                #mov16 mv, mr
                lda sign_of + \at
                bpl +
                #neg16 mr
+               rts
+               lda mv + 1
                eor sign_of + \at
                sta msign
                lda mv + 1
                bpl +
                #neg16 mv
+               ldx mv                  ; the low byte times |s|: the high byte of that, the low only for its
                sec                     ; borrow
p1              lda SQUARES,x
p2              cmp SQUARES,x
p3              lda SQUARES_HI,x
p4              sbc SQUARES_HI,x
                sta mr
                lda #0
                sta mr + 1
                ldx mv + 1              ; plus the high byte times |s|
                beq +
                sec
p5              lda SQUARES,x
p6              sbc SQUARES,x
                tay
p7              lda SQUARES_HI,x
p8              sbc SQUARES_HI,x
                sta mr + 1
                tya
                clc
                adc mr
                sta mr
                bcc +
                inc mr + 1
+               lda msign
                bpl +
                #neg16 mr
+               rts
                .endm
mul_c           #times 0
mul_s           #times 2

                .section car_extra      ; (where there is room)
; The sprite registers for the next frame, from where the car and the window will be.
show            sec                     ; x: 31 is the window's left edge, the car's centre is sprite pixel 12
                lda pos_x + 1
                sbc cam_lo
                tax
                lda pos_x + 2
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
                sec                     ; y: the window starts on line 55, the centre is sprite line 10, and a
                lda pos_y + 1           ; sprite shows from the line after its y
                sbc cam_lo + 1
                clc
                adc #55 - 10 - 1
                sta frame.next_sy
                lda angle + 1
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                clc
                adc #CAR_SPRITE
                sta frame.next_sp
                lda colour
                sta frame.next_sc
                lda #1
                sta frame.next_d015
                rts
                .send

; A (low byte), Y (high) = sin(direction X) * 256, rounded: from the table of low bytes, the high byte being 1
; within 2 directions of a quarter turn (256, rounded), $ff past half a turn (negative) and 0 otherwise.
sine            lda sin_lo,x
                ldy #0
                cpx #129
                bcc +
                dey                     ; negative
                rts
+               cpx #62
                bcc +
                cpx #67
                bcs +
                iny                     ; 256
+               rts
sin_lo
                .for i := 0, i < 256, i += 1
                .byte <(int(round(256 * sin(i * pi / 128))) + $10000)
                .cerror (i >= 62 && i <= 66 ? 1 : 0) != (int(round(256 * sin(i * pi / 128))) > 255 ? 1 : 0), "sine: 256 at 62-66 only"
                .cerror (i > 128 ? 1 : 0) != (int(round(256 * sin(i * pi / 128))) < 0 ? 1 : 0), "sine: negative past 128 only"
                .next
; 6 pixels along the car in each of the 16 sprite directions: where the front and back points are.
axis_x
                .for k := 0, k < 16, k += 1
                .char int(round(6 * cos(k * pi / 8)))
                .next
axis_y
                .for k := 0, k < 16, k += 1
                .char int(round(6 * sin(k * pi / 8)))
                .next

                .bend
