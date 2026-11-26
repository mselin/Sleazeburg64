; SPDX-License-Identifier: GPL-2.0-or-later
; The police, by the browser game's design (specs/design.md there, "Heat and the police"): the chase. Busted
; comes next.
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
; tests/e2e/traffic-model.mjs does the same in JavaScript, and the tests hold the two to each other.

police          .block

CHASE_GAP       = 110                   ; frames between police cars (2.2 seconds)
COP_CRUISE      = 255                   ; their cruising speed, in the traffic's 1/128 pixel a frame
NOTICE          = 150                   ; the police around: this many pixels either way
SIREN_TIME      = 25                    ; frames each colour of the siren (half a second)


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
sound           lda status.heat         ; the siren: with heat and the police around
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
                .bend
