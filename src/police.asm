; SPDX-License-Identifier: GPL-2.0-or-later
; The police, by the browser game's design (specs/design.md there, "Heat and the police"): the chase, and
; being busted.
;
; With heat, the police keep up to min(5, heat) cars chasing, adding one every CHASE_GAP frames (2.2 seconds).
; They are traffic cars (traffic.asm) marked in `cop`: white, at the fastest a traffic car goes (COP_CRUISE,
; 100 pixels a second, where the design's police car does 188: a traffic car's speed is a byte), appearing
; where traffic does. While there is heat no other traffic appears: on the C64 the traffic's few places are
; the police's. At a crossing a police car takes the way that closes the longer of its gaps to the player,
; across or down, else the other, else straight on, else the first way it can; with no heat it drives as
; traffic does.
;
; The police around: a police car within NOTICE pixels of the player either way. Then, with heat, the siren:
; the border flashes red and blue, changing every SIREN_TIME frames; and the heat does not cool
; (status.update). The design's distance is 150 / ZOOM in the city at its scale; the C64's city is drawn a
; pixel to a pixel, as at ZOOM 1.
;
; Busted: with heat, in a car slower than SLOW (12 pixels a second) either way with a police car within BOXED
; pixels either way (not a wreck), for BUSTED_AFTER frames on end. Then the police cars go; so do the heat, the
; ammo, the knife and a fifth of the money (the design's "civil asset forfeiture"); the car is left where it is,
; as when the player gets out; and the player is on foot at the police station, the window there. The design
; ends the game when the player is busted with no money; with no game over yet, here they come back as ever.
; The message cannot say how much was taken: the panel's messages are fixed.
;
; tests/e2e/traffic-model.mjs does the same in JavaScript, and the tests hold the two to each other.

police          .block

CHASE_GAP       = 110                   ; frames between police cars (2.2 seconds)
COP_CRUISE      = 255                   ; their cruising speed, in the traffic's 1/128 pixel a frame
NOTICE          = 150                   ; the police around: this many pixels either way
SIREN_TIME      = 25                    ; frames each colour of the siren (half a second)
SLOW            = 61                    ; busted: slower than this, in 1/256 pixel a frame (12 pixels a second) ...
BOXED           = 24                    ; ... with a police car this near either way ...
BUSTED_AFTER    = 100                   ; ... for this many frames (2 seconds)
STATION_X       = (6 * 12 + 7) * 16     ; the police station: where the browser game has it (its COPS)
STATION_Y       = (2 * 12 + 2) * 16 + 8


                .section police_high
; At start (after video.init, which clears the variables' screen): no police, and none due yet.
init            ldx #SLOTS - 1
                lda #0
-               sta cop,x
                dex
                bpl -
                sta chase_wait
                sta around
                sta siren
                sta flash
                rts

; traffic.try_spawn, before anything else: C set if a car may appear. With no heat, any car; with heat, only a
; police car, when one is due: the wait over, and fewer than the heat of them about.
allowed         lda status.heat
                beq yes
                lda chase_wait
                bne no
                ldx #SLOTS - 1
                ldy #0
-               lda traffic.on,x
                beq +
                lda cop,x
                beq +
                iny
+               dex
                bpl -
                cpy status.heat
                bcs no
yes             sec
                rts
no              clc
                rts

; traffic.try_spawn, a new car in place X, A its cruising speed: with heat, a police car (white, COP_CRUISE),
; the next one due CHASE_GAP frames from now; else a car as traffic. A = the cruising speed. X kept.
new_car         pha
                lda #0
                sta cop,x
                lda status.heat
                beq +
                lda #1
                sta cop,x
                lda #WHITE
                sta traffic.col,x
                lda #CHASE_GAP
                sta chase_wait
                pla
                lda #COP_CRUISE
                rts
+               pla
                rts

; traffic.enter, at a crossing, the ways it can go worked out (traffic.ways, traffic.cnt): for car Y, a police
; car with heat about, C set and A = the way to take; else C clear. Y kept.
chasing         lda cop,y
                beq not_chasing
                lda status.heat
                bne +
not_chasing     clc
                rts
+               sec                     ; the gaps to the player
                lda traffic.pl + SLOTS
                sbc traffic.pl,y
                sta dxl
                lda traffic.ph + SLOTS
                sbc traffic.ph,y
                sta dxh
                sec
                lda traffic.pl + SLOTS + N1
                sbc traffic.pl + N1,y
                sta dyl
                lda traffic.ph + SLOTS + N1
                sbc traffic.ph + N1,y
                sta dyh
                ldx #0                  ; the ways that close them: east or west, south or north
                lda dxh
                bpl +
                ldx #2
                jsr negate_x
+               stx first
                ldx #1
                lda dyh
                bpl +
                ldx #3
                jsr negate_y
+               stx second
                lda dxl                 ; the longer first: |dx| < |dy|, down first
                cmp dyl
                lda dxh
                sbc dyh
                bcs +
                lda first
                ldx second
                sta second
                stx first
+               lda first
                jsr can_go
                bcs +
                lda second
                jsr can_go
                bcs +
                lda traffic.dir,y       ; else straight on, if it can
                jsr can_go
                bcs +
                lda traffic.ways        ; else the first way it can
                sec
+               rts
; C set if way A is among the ways it can go. A, Y kept.
can_go          ldx #0
-               cpx traffic.cnt
                beq +
                cmp traffic.ways,x
                beq ++
                inx
                bne -
+               clc
+               rts
negate_x        sec
                lda #0
                sbc dxl
                sta dxl
                lda #0
                sbc dxh
                sta dxh
                rts
negate_y        sec
                lda #0
                sbc dyl
                sta dyl
                lda #0
                sbc dyh
                sta dyh
                rts

; Once a frame, after the traffic has moved: the wait for the next police car, whether one is around, and the
; siren.
watch           lda chase_wait
                beq +
                dec chase_wait
+               lda #0
                sta around
                lda status.heat         ; (with no heat, nothing more: whether they are near matters only with it)
                bne +
                rts
+               ldx #SLOTS - 1
each            stx looked
                lda traffic.on,x
                beq next
                lda cop,x
                beq next
                lda traffic.wreck,x     ; (a wreck chases nobody)
                bne next
                sec
                lda traffic.pl,x
                sbc traffic.pl + SLOTS
                tay
                lda traffic.ph,x
                sbc traffic.ph + SLOTS
                jsr within
                ldx looked
                bcs next
                sec
                lda traffic.pl + N1,x
                sbc traffic.pl + SLOTS + N1
                tay
                lda traffic.ph + N1,x
                sbc traffic.ph + SLOTS + N1
                jsr within
                ldx looked
                bcs next
                lda #1
                sta around
                bne sound
next            dex
                bpl each
sound           jsr boxed_in            ; (with heat: busted, after long enough boxed in)
                lda status.heat         ; the siren: with heat and the police near
                beq quiet
                lda around
                beq quiet
                dec siren
                bpl +
                lda #SIREN_TIME - 1
                sta siren
                lda flash
                eor #1
                sta flash
+               ldx flash
                lda siren_colours,x
                sta VIC_BORDER
                rts
quiet           lda #0                  ; (afresh when they come back)
                sta siren
                sta flash
                sta VIC_BORDER          ; (black)
                rts
; C clear if the difference A (high), Y (low) is NOTICE or less either way.
within          tax
                tya
                clc
                adc #NOTICE
                tay
                txa
                adc #0
                beq +                   ; 0-255
                cmp #1
                bne far
                cpy #2 * NOTICE + 1 - 256
                rts
+               clc
                rts
far             sec
                rts
siren_colours   .byte RED, BLUE

cop             .fill SLOTS, 0          ; 1: this place in the traffic's tables is a police car
chase_wait      .byte 0                 ; frames before another police car can appear
around          .byte 0                 ; 1: a police car within NOTICE of the player, this frame
siren           .byte 0                 ; frames before the border changes colour
flash           .byte 0                 ; the border's colour: 0 red, 1 blue
dxl             .byte 0                 ; chase: from the car to the player, across and down
dxh             .byte 0
dyl             .byte 0
dyh             .byte 0
first           .byte 0                 ; the ways that close the gaps, the longer's first
second          .byte 0
looked          .byte 0                 ; watch: the car looked at
                .send

                .section panel_code     ; (where there is room: waiting.asm)
; Once a frame with heat (watch): boxed in, slow, by a police car, BUSTED_AFTER frames on end, the player is busted.
boxed_in        lda foot.on             ; in a car ...
                bne not_boxed
                lda car.vel_x           ; ... slow either way ...
                ldx car.vel_x + 1
                jsr slower
                bcs not_boxed
                lda car.vel_y
                ldx car.vel_y + 1
                jsr slower
                bcs not_boxed
                ldx #SLOTS - 1          ; ... with a police car near
each_boxer      stx looked
                lda traffic.on,x
                beq next_boxer
                lda cop,x
                beq next_boxer
                lda traffic.wreck,x
                bne next_boxer
                sec
                lda traffic.pl,x
                sbc traffic.pl + SLOTS
                tay
                lda traffic.ph,x
                sbc traffic.ph + SLOTS
                jsr close
                bcs next_boxer
                ldx looked
                sec
                lda traffic.pl + N1,x
                sbc traffic.pl + SLOTS + N1
                tay
                lda traffic.ph + N1,x
                sbc traffic.ph + SLOTS + N1
                jsr close
                bcc boxed_now
next_boxer      ldx looked
                dex
                bpl each_boxer
not_boxed       lda #0
                sta boxed_for
                rts
boxed_now       inc boxed_for
                lda boxed_for
                cmp #BUSTED_AFTER
                bcc +
                jmp busted
+               rts
; C clear if X (high), A (low), signed, is less than SLOW either way.
slower          cpx #0
                beq +
                cpx #$ff
                bne no_slow
                cmp #256 - SLOW + 1     ; (-SLOW + 1 or more: C set, so the other way round)
                bcs is_slow
no_slow         sec
                rts
+               cmp #SLOW
                rts
is_slow         clc
                rts
; C clear if the difference A (high), Y (low) is BOXED or less either way.
close           tax
                tya
                clc
                adc #BOXED
                tay
                txa
                adc #0
                bne +
                cpy #2 * BOXED + 1
                rts
+               sec
                rts

fine            .fill 3, 0              ; busted: a fifth of the money
boxed_for       .byte 0                 ; frames boxed in
                .send

                .section low_more       ; (where there is room: main.asm)
; Busted.
busted          lda #0
                sta boxed_for
                ldx #SLOTS - 1          ; the police go
-               lda cop,x
                beq +
                lda #0
                sta cop,x
                sta traffic.on,x
+               dex
                bpl -
                lda #0                  ; so do the heat and the weapons
                sta status.heat
                sta status.points
                sta status.points + 1
                sta status.ammo
                sta status.knife
                lda #1
                sta status.stars_shown
                sta status.changed
                sed                     ; and a fifth of the money: twice it, a digit less
                clc
                ldx #0
-               lda status.money,x
                adc status.money,x
                sta fine,x
                inx
                txa
                eor #3
                bne -
                ldy #4                  ; (the carry: the digit twice the money has beyond six)
-               ror fine + 2
                ror fine + 1
                ror fine
                clc
                dey
                bne -
                sec
                ldx #0
-               lda status.money,x
                sbc fine,x
                sta status.money,x
                inx
                txa
                eor #3
                bne -
                cld
                ldx #SLOTS - 1          ; out of the car, as getting out does, where it is, into a free place
-               lda traffic.on,x
                beq +
                dex
                bpl -
+               stx foot.slot           ; (one is free: a police car has gone)
                lda car.angle + 1
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                sta foot.k
                lda #0
                sta foot.sinking
                lda car.pos_x + 1
                sta foot.tx
                lda car.pos_x + 2
                sta foot.tx + 1
                lda car.pos_y + 1
                sta foot.ty
                lda car.pos_y + 2
                sta foot.ty + 1
                jsr foot.out_here
                ldx #4                  ; and on foot at the police station, the window there
-               lda station,x
                sta foot.pos + 1,x
                dex
                bpl -
                ldx #3
-               lda window,x
                sta cam_lo,x
                dex
                bpl -
                ldx #status.MSG_BUSTED
                jmp status.say
station         .byte <STATION_X, >STATION_X, 0, <STATION_Y, >STATION_Y       ; (pos + 3, a fraction: 0)
window          .byte <(STATION_X - CENTRE_X), <(STATION_Y - CENTRE_Y), >(STATION_X - CENTRE_X), >(STATION_Y - CENTRE_Y)
                .cerror cam_hi - cam_lo != 2, "busted expects cam_hi two bytes after cam_lo"

                .send
                .bend
