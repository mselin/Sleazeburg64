; SPDX-License-Identifier: GPL-2.0-or-later
; Water: what the canal and the fountains do to the player's car, and what becomes of a car that floods.
;
; The browser game's rules (specs/design.md there, "Water"), in what a frame here has time for.
;
; How wet. Three points along the car, its middle and 6 pixels ahead of and behind it (the points car.hits
; looks at), are each over water or not: wet is 0 to 3, thirds of the car. It is looked at after the window has
; moved, and not in a frame that moves the screen a character, which has no time to spare (as for Big Honk):
; the frame after one of those never moves it, so what the handling uses is at most two frames old. On foot
; there is no car, and wet is 0.
;
; Wading. With wet thirds of the car in the water (the design's w = wet / 3):
; - acceleration 18, 14, 11 or 7 (x (1 - 0.6 w));
; - on top of the drag, the forward speed loses wet times 1/32 of itself a frame (the design's 4 w a second
;   is wet times 1/37);
; - top speed 1024, 785, 546 or 307 (x (1 - 0.7 w)), and backwards 0.4 of that;
; - grip less wet times a sixth of it (x (1 - w / 2), to within one);
; - braking as on land.
;
; Flooding. Wholly in the water, the car floods: the player is out at its middle, swimming, and the car stays
; where it is as a car with no driver in the traffic's tables, as one the player leaves does (foot.asm), but
; one that nobody can get into again and that is out of the way: the player's car passes over it. The browser
; game lets it drift to a stop, and only a car on the bottom is out of the way; here it stops where it floods,
; by when wading has slowed it to little more than a pixel a frame.
;
; Sinking. A flooded car goes down over 200 frames (4 seconds), which traffic.sink counts: in its own colour
; for the first 60, awash; light blue for the next 90, water over the bodywork; and black from then on, on the
; bottom, where it stays. The browser game redraws its picture for each stage; a colour costs no sprite frames.
;
; tests/e2e/water-model.mjs does the same in JavaScript, and the tests hold the two to each other exactly.

WATER_KIND      = 3                     ; a tile's kind (tools/assets.mjs)
SINK_AWASH      = 60                    ; traffic.sink, from 1 when it floods: the last frame of each stage
SINK_UNDER      = 150
SINK_DONE       = 200

water           .block

                .section bss
wet             .byte ?                 ; thirds of the player's car in the water, 0-3
dir             .byte ?                 ; update: the car's sprite direction
sixth           .byte ?                 ; grip
drop            .word ?                 ; drag
                .send

; After the window has moved (and the traffic): how wet the player's car is, and whether it floods.
update          lda foot.on
                beq +
                lda #0                  ; on foot: no car
                sta wet
                rts
+               jsr screen_moves
                bcc +
                rts
+               lda #0
                sta wet
                jsr car.here            ; its middle ...
                jsr car.survey          ; (no water in the tiles round it: none at any of the three points,
                and #2                  ; all within 6 pixels of it)
                bne +
                rts
+               jsr point
                lda car.angle + 1
                clc
                adc #8
                lsr
                lsr
                lsr
                lsr
                sta dir
                tax                     ; ... 6 pixels ahead ...
                lda car.axis_x,x
                ldx #0
                jsr nudge
                ldx dir
                lda car.axis_y,x
                ldx #2
                jsr nudge
                jsr point
                ldx dir                 ; ... and 6 behind
                lda car.axis_x,x
                jsr twice_back
                ldx #0
                jsr nudge
                ldx dir
                lda car.axis_y,x
                jsr twice_back
                ldx #2
                jsr nudge
                jsr point
                lda wet
                cmp #3
                beq flood
                rts

; wet + 1 if the point car.px, car.py is over water.
point           jsr car.kind_at
                cmp #WATER_KIND
                bne +
                inc wet
+               rts

; car.px (X = 0) or car.py (X = 2) += A, a signed byte.
nudge           ldy #0
                cmp #0
                bpl +
                dey
+               clc
                adc car.px,x
                sta car.px,x
                tya
                adc car.px + 1,x
                sta car.px + 1,x
                rts

; A = -2 A, for a signed byte from -6 to 6: from the point ahead to the point behind.
twice_back      asl
                eor #$ff
                clc
                adc #1
                rts

; The car floods. The player is out at its middle, and it goes into the traffic's tables where it is.
flood           ldx #SLOTS - 1          ; a place for it (there always is one while the player is in a car)
-               lda traffic.on,x
                beq +
                dex
                bpl -
                rts
+               stx foot.slot
                lda dir
                sta foot.k
                lda car.pos_x + 1
                sta foot.tx
                lda car.pos_x + 2
                sta foot.tx + 1
                lda car.pos_y + 1
                sta foot.ty
                lda car.pos_y + 2
                sta foot.ty + 1
                lda #1                  ; swimming, and the car going down
                sta foot.swim
                sta foot.sinking
                lda #0
                sta wet
                jmp foot.out_here

; Wading: in car.engine, the acceleration and the top speeds; then the drag and the grip.
accel           .byte 18, 14, 11, 7
TOPS            = [1024, 785, 546, 307]
top_lo          .byte <TOPS
top_hi          .byte >TOPS
back_lo         .byte <($10000 - TOPS * 2 / 5)
back_hi         .byte >($10000 - TOPS * 2 / 5)

; car.nf -= wet * (car.nf >> 5), the shift keeping the sign.
drag            ldy wet
                beq +
                lda car.nf
                sta drop
                lda car.nf + 1
                sta drop + 1
                ldx #5
-               lda drop + 1
                cmp #$80
                ror drop + 1
                ror drop
                dex
                bne -
-               sec
                lda car.nf
                sbc drop
                sta car.nf
                lda car.nf + 1
                sbc drop + 1
                sta car.nf + 1
                dey
                bne -
+               rts

; car.held_grip -= wet * (car.held_grip / 6).
grip            ldy wet
                beq +
                lda car.held_grip
                ldx #$ff
                sec
-               inx
                sbc #6
                bcs -
                stx sixth
                lda car.held_grip
-               sec
                sbc sixth
                dey
                bne -
                sta car.held_grip
+               rts

; The colour of traffic car X: its own, or how far down it is if it flooded.
shade           lda traffic.sink,x
                beq own
                cmp #SINK_AWASH + 1
                bcc own
                cmp #SINK_UNDER + 1
                lda #LIGHT_BLUE
                bcc +
                lda #BLACK
+               rts
own             lda traffic.col,x
                rts

                .bend
