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
OUT_NEAR        = 36                    ; an officer gets out: a police car this near the player either way ...
CAR_STILL       = 77                    ; ... going slower than this (30 pixels a second, in the traffic's units) ...
STILL           = 154                   ; ... and the player too, in 1/256 pixel a frame (or on foot)
OFFICERS        = 4                     ; at most this many on foot
BESIDE            = 12                    ; where: this far to the car's side (the design's, beside a door)
FOOT_NOTICE     = 120                   ; an officer this near either way is the police around
ARREST          = 7                     ; an officer this near either way arrests the player on foot ...
AT_WINDOW       = 13                    ; ... or this near the player's car ...
WINDOW_SLOW     = 113                   ; ... going slower than this (22 pixels a second) ...
WINDOW_AFTER    = 35                    ; ... for this many frames on end (0.7 seconds)
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
                lda traffic.wreck,x     ; (an empty one does not chase)
                bne +
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
                ldx status.heat         ; (with no heat, nothing more: whether they are near matters only with it,
                bne +                   ; and the counts to an arrest start again)
                sta boxed_for
                sta window_for
                rts
+               ldx #SLOTS - 1
each            stx looked
                lda traffic.on,x
                beq next
                lda cop,x
                beq next
                lda traffic.wreck,x     ; (a wreck chases nobody)
                bne next
                jsr get_out             ; (an officer, if it is slow and near)
                ldx looked
                lda traffic.wreck,x
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
next            dex
                bpl each
                jsr on_foot             ; the officers: near, and arresting
                lda status.heat
                beq quiet               ; (busted)
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

; In watch, with heat: the officers on foot who are not down. One within FOOT_NOTICE is the police around; one
; within ARREST of the player on foot arrests them; one within AT_WINDOW of the player's car going slower than
; WINDOW_SLOW, for WINDOW_AFTER frames on end, however many, arrests them too.
on_foot         ldy #0                  ; (1: the car is slow enough)
                lda foot.on
                bne +
                lda #WINDOW_SLOW
                jsr car_slow
                bcs +
                iny
+               sty slow_car
                lda #0
                sta windowed
                ldx #CROWD - 1
each_officer    stx looked
                lda people.on,x
                beq next_officer
                lda people.officer,x
                beq next_officer
                lda people.down,x
                bne next_officer
                lda #FOOT_NOTICE
                jsr officer_near
                bcs next_officer
                lda #1
                sta around
                lda foot.on
                beq at_car
                lda #ARREST
                jsr officer_near
                bcs next_officer
                jmp busted
at_car          lda slow_car
                beq next_officer
                lda #AT_WINDOW
                jsr officer_near
                bcs next_officer
                lda #1
                sta windowed
next_officer    ldx looked
                dex
                bpl each_officer
                lda windowed
                bne +
                sta window_for
                rts
+               inc window_for
                lda window_for
                cmp #WINDOW_AFTER
                bcc +
                jmp busted
+               rts
slow_car        .byte 0                 ; on_foot: 1 if the player's car is slow enough to be arrested in
windowed        .byte 0                 ; 1: an officer at its window this frame

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
                lda #SLOW               ; ... slow either way ...
                jsr car_slow
                bcs not_boxed
                lda #BOXED
                sta reach
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
; C clear if the player's car goes slower than A (1/256 pixel a frame) either way.
car_slow        sta how_slow
                lda car.vel_x
                ldx car.vel_x + 1
                jsr slower
                bcs +
                lda car.vel_y
                ldx car.vel_y + 1
                jmp slower
+               rts
; C clear if X (high), A (low), signed, is less than how_slow either way.
slower          cpx #0
                beq +
                inx
                bne no_slow
                clc                     ; (-how_slow + 1 or more: A + how_slow is over 256)
                adc how_slow
                beq no_slow
                bcs is_slow
no_slow         sec
                rts
+               cmp how_slow
                rts
is_slow         clc
                rts
; C clear if the difference A (high), Y (low) is reach (below 128) or less either way. X lost.
close           tax
                tya
                clc
                adc reach
                tay
                txa
                adc #0
                bne +
                lda reach
                asl
                adc #1
                sta span
                cpy span
                rts
+               sec
                rts

fine            .fill 3, 0              ; busted: a fifth of the money
boxed_for       .byte 0                 ; frames boxed in
window_for      .byte 0                 ; frames with an officer at the window
reach           .byte 0                 ; close: how near
span            .byte 0
how_slow            .byte 0                 ; slower: how slow
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
                jsr officers_go         ; the officers on foot go too
                lda foot.on             ; (on foot already: straight to the station)
                bne station_at
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
station_at      ldx #4                  ; and on foot at the police station, the window there
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

                .section tile_room5     ; (where there is room: main.asm)
; In watch, police car X (not empty) with heat: an officer gets out of it if it and the player are both slow,
; and near each other, with fewer than OFFICERS on foot and a place for one among the passers-by's (a free
; one, or a passer-by out of sight, who goes). They stand beside it, in the middle of the tile there, and
; the car is left empty.
get_out         lda traffic.sp,x
                cmp #CAR_STILL
                bcs no_officer
                lda foot.on
                bne +
                lda #STILL
                jsr car_slow
                bcs no_officer
+               lda #OUT_NEAR
                sta reach
                ldx looked
                sec
                lda traffic.pl,x
                sbc player_at
                tay
                lda traffic.ph,x
                sbc player_at + 1
                jsr close
                bcs no_officer
                ldx looked
                sec
                lda traffic.pl + N1,x
                sbc player_at + 2
                tay
                lda traffic.ph + N1,x
                sbc player_at + 3
                jsr close
                bcs no_officer
                ldy #0                  ; how many are out, and a place
                ldx #CROWD - 1
-               lda people.on,x
                beq to_place
                lda people.officer,x
                beq +
                iny
+               dex
                bpl -
                cpy #OFFICERS
                bcs no_officer
                ldx #CROWD - 1          ; none free: a passer-by out of sight
-               lda people.officer,x
                bne +
                lda people.down,x
                bne +
                jsr unseen
                bcs to_place
+               dex
                bpl -
no_officer      rts
to_place        jmp free_place
                .send

                .section tile_room4
; Person X: C set if out of sight (in no part of the window or 12 pixels round it). X kept.
unseen          stx people.who
                sec
                lda people.xl,x
                sbc cam_lo
                tay
                lda people.xh,x
                sbc cam_hi
                ldx #0
                jsr people.in_sight
                bcs +
                ldx people.who
                sec
                lda people.yl,x
                sbc cam_lo + 1
                tay
                lda people.yh,x
                sbc cam_hi + 1
                ldx #1
                jsr people.in_sight
+               ldx people.who
                rts
                .send
                .section tile_room2
; Busted: the officers on foot go.
officers_go     ldx #CROWD - 1
-               lda people.officer,x
                beq +
                lda #0
                sta people.on,x
+               dex
                bpl -
                rts
                .send

                .section police_extra   ; (where there is room: waiting.asm)
; The officer stands at people.nx, ny, in place people.who; police car looked is left empty.
officer_out     jsr people.set_up
                lda #LIGHT_BLUE
                sta people.col,x
                lda #people.COP_PACE
                sta people.spd,x
                lda #1
                sta people.officer,x
                ldx looked
                sta traffic.wreck,x
                lda #0
                sta traffic.sp,x
                sta traffic.cruise,x
                sta traffic.dlo,x
                sta traffic.dhi,x
                rts
                .send

                .section tile_room6     ; (where there is room: main.asm)
free_place      stx people.who
                ldx looked              ; beside the car: across its way, one side, else the other
                lda traffic.pl,x
                sta people.nx
                lda traffic.ph,x
                sta people.nx + 1
                lda traffic.pl + N1,x
                sta people.ny
                lda traffic.ph + N1,x
                sta people.ny + 1
                lda traffic.dir,x
                and #1
                eor #1
                asl
                tax                     ; 0: nx, 2: ny
                lda #BESIDE
                jsr side_by
                cmp #WALL
                bne +
                lda #-2 * BESIDE
                jsr side_by
                cmp #WALL
                bne +
                rts
+               jmp officer_out
; people.nx (X = 0) or ny (X = 2) moved by A, a signed byte; A = the kind of tile there. X kept.
side_by         ldy #0
                cmp #$80
                bcc +
                dey
+               clc
                adc people.nx,x
                sta people.nx,x
                tya
                adc people.nx + 1,x
                sta people.nx + 1,x
                txa
                pha
                jsr people.kind
                sta reach               ; (spare)
                pla
                tax
                lda reach
                rts
                .send

                .section panel_code
; C clear if officer looked is within A of the player either way.
officer_near    sta reach
                ldx looked
                sec
                lda people.xl,x
                sbc player_at
                tay
                lda people.xh,x
                sbc player_at + 1
                jsr close
                bcs +
                ldx looked
                sec
                lda people.yl,x
                sbc player_at + 2
                tay
                lda people.yh,x
                sbc player_at + 3
                jmp close
+               rts
                .send
                .bend
