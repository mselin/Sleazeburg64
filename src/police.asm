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
; The sound (wailing), with the siren: the SID's first voice, a square wave, the low note for NOTE frames, the
; high one for NOTE, then a frame of nothing, over and over; quiet the moment the siren stops (quiet). `tone`
; says what it plays, for the tests: the SID's registers cannot be read back.
;
; A stolen police car (cruiser): the player at the wheel of a police car (foot.take sets `stolen`, foot.out_here
; clears it and leaves the car a police car still), with heat 1 and the police around: heat 2, from its start.
;
; Officers on foot (get_out, on_foot): a police car slower than CAR_STILL and the player slower than STILL (or
; on foot), within OUT_NEAR of each other either way, and an officer gets out BESIDE pixels to its side, up to
; OFFICERS, in a passer-by's place (people.asm); the car is left empty, a wreck that keeps its cop mark. Within
; FOOT_NOTICE, an officer who is not down is the police around; within ARREST of the player on foot, they arrest
; them; within AT_WINDOW of the player's car going slower than WINDOW_SLOW, for WINDOW_AFTER frames on end, so
; do they. (Distances either way, as squares, as everywhere here.)
;
; tests/e2e/traffic-model.mjs and play.mjs do the same in JavaScript, and the tests hold the two to each other.

police          .block

CHASE_GAP       = 110                   ; frames between police cars (2.2 seconds)
COP_CRUISE      = 255                   ; their cruising speed, in the traffic's 1/128 pixel a frame
NOTICE          = 150                   ; the police around: this many pixels either way
PATROL_NOTICE   = 127                   ; a patrol car notices the player this near either way (the design's 130)
SIREN_TIME      = 25                    ; frames each colour of the siren (half a second)
WAIL_TIME       = 35                    ; the siren's sound: a wail every 0.7 seconds ...
NOTE            = 17                    ; ... of two notes this long (the design's 0.33 seconds) ...
LOW_NOTE        = 620 * 16777216 / 985248       ; ... 620 Hz then 830 Hz, in the SID's units (PAL)
HIGH_NOTE       = 830 * 16777216 / 985248
PULSE           = $40                   ; a square wave (pulse, half and half), the gate bit 0 or 1
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
HURT_FAST       = 115                   ; a car going faster than this (45 pixels a second, the traffic's units) ...
HURT_LONG       = 12                    ; ... with its body this near the player's middle on foot, along it ...
HURT_SHORT      = 7                     ; ... and across (its length and width and their shoulders) hurts them,
HURT_WAIT       = 20                    ; ... and nothing more does for this many frames (0.4 seconds)
HOSPITAL_X      = (1 * 12 + 7) * 16     ; the hospital: where the browser game has it (its HOSP)
HOSPITAL_Y      = (1 * 12 + 2) * 16 + 8
BILL            = $0500                 ; the most the hospital bills, in binary-coded decimal
SHOOT_HEAT      = 3                     ; officers shoot from this heat ...
SHOOT_RANGE     = 95                    ; ... at the player this near either way ...
AIM_MIN         = 55                    ; ... every 55 to 86 frames (the design's 1.1 to 1.7 seconds) ...
PAVE_FAST       = 77                    ; driving faster than this either way (15 pixels a second) on a pavement or
PAVE_AGAIN      = 150                   ; a plaza where the police see it is a crime, at most every 3 seconds
PAINT_X         = (1 * 12 + 7) * 16     ; the paint shop, PAINT & PRAY: where the browser game has it (its PAINT)
PAINT_Y         = (6 * 12 + 2) * 16 + 8
PAINT_NEAR      = 16                    ; driving this near it either way with heat ...
PAINT_COST      = $0200                 ; ... costs $200 (binary-coded decimal) ...
PAINT_AGAIN     = 200                   ; ... at most every 4 seconds
DOWN_TIME       = 160                   ; busted or wasted: the pause, frames (the design's 3.2 seconds)
BAND            = 9                     ; the banner: its rows of the screen, from this one ...
BAND_ROWS       = 5                     ; ... this many: the title's sprites over the first two
TITLE_Y         = 50 + BAND * 8 + 1     ; their top (as sprite registers have it)
R_BUSTED        = 0                     ; the reasons under the banner's title, by what happened
R_BOXED         = 1
R_WINDOW        = 2
R_CAR           = 3
R_SHOT          = 4
SHOT_HURT       = 11                    ; ... and a shot that hits takes this much health
STATION_X       = (6 * 12 + 7) * 16     ; the police station: where the browser game has it (its COPS)
STATION_Y       = (2 * 12 + 2) * 16 + 8


                .section police_high
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

; traffic.try_spawn, a new car in place X, A a random byte (its third): with heat, a police car (white,
; COP_CRUISE), the next one due CHASE_GAP frames from now; else a car as traffic, cruising at CRUISE_MIN plus
; the byte's low six bits, and on patrol (white) if its top two and the top bit of its first byte are all set,
; one time in eight. A = the cruising speed. X kept.
new_car         sta roll
                lda #0
                sta cop,x
                sta patrol,x
                lda status.heat
                beq +
                lda #1
                sta cop,x
                lda #WHITE
                sta traffic.col,x
                lda #CHASE_GAP
                sta chase_wait
                lda #COP_CRUISE
                jmp fit
+               lda roll
                cmp #$c0
                bcc +
                bit traffic.r1
                bpl +
                inc patrol,x            ; (a police car on patrol)
                lda #WHITE
                sta traffic.col,x
+               lda roll
                and #63
                clc
                adc #CRUISE_MIN
                jmp fit

                .section tile_room6     ; (where there is room: main.asm)
; The end of new_car: car X's driver assistance (the design's "Cursed driver assistance", modern only: on
; classic none). For now, anti-theft only (car.assist says what the byte holds): every police car has it, and
; one car in five else (a random byte under 51); its time, 17 + r/16 + r/32 steps of 32 frames, 10 to 25
; seconds. A (the cruising speed) and X kept.
fit             pha
                lda #0
                sta traffic.assist,x
                lda people.difficulty
                beq +
                lda cop,x
                ora patrol,x
                bne arm
                jsr traffic.rnd
                cmp #51
                bcs +
arm             jsr traffic.rnd
                lsr
                lsr
                lsr
                lsr
                sta traffic.assist,x    ; r/16
                lsr
                clc
                adc #17
                adc traffic.assist,x
                sta traffic.assist,x
+               pla
                rts
                .send

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
                bne with_heat           ; but for a patrol car that sees a stolen police car, or driving on the
                lda stolen              ; pavement: car.ground is the last the car was on)
                bne +
                lda car.ground
                cmp #PAVEMENT
                beq +
                rts
+               jsr patrols
                jsr cruiser
                jmp pave_look
with_heat       jsr patrols             ; (a patrol car near joins the chase)
                ldx #SLOTS - 1
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
                jsr cruiser             ; (and in a stolen police car, the heat to 2)
                jsr pave_look           ; (and driving on the pavement)
                jsr paint_look          ; (and the paint shop)
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
                jmp wailing             ; and the sound
quiet           lda #0                  ; (afresh when they come back)
                sta siren
                sta flash
                sta boxed_for           ; (and the counts to an arrest, with nobody near to arrest the player)
                sta window_for
                sta VIC_BORDER          ; (black)
                sta wail
                sta tone
                lda #PULSE              ; (the gate off: silent)
                sta SID + 4
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
patrol          .fill SLOTS, 0          ; 1: a police car on patrol in ordinary traffic
pave_wait       .byte 0                 ; frames before driving on the pavement is a crime again
patrol_near     .byte 0                 ; 1: one of them within PATROL_NOTICE of the player, this frame
roll            .byte 0                 ; new_car
aim             .fill CROWD, 0          ; an officer's frames before they can shoot again (by people's places)
shot            .byte 0                 ; 1: the player is being hurt by an officer's shot
stolen          .byte 0                 ; 1: the player's car is a police car (foot.take; foot.out_here ends it)
wail            .byte 0                 ; frames into the siren's wail
tone            .byte 0                 ; what the siren's voice plays: 0 nothing, 1 the low note, 2 the high
boxed_for       .byte 0                 ; frames boxed in (here: watch clears it in any build)
window_for      .byte 0                 ; frames with an officer at the window
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
                lda #R_BOXED
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
reach           .byte 0                 ; close: how near
span            .byte 0
how_slow            .byte 0                 ; slower: how slow
                .send

                .section low_more       ; (where there is room: main.asm)
                .send

                .section stack_code     ; (where there is room: waiting.asm)
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
                lda aim,x               ; (the time to their next shot)
                beq +
                dec aim,x
+               lda #FOOT_NOTICE
                jsr officer_near
                bcs next_officer
                lda #1
                sta around
                jsr may_shoot
                lda foot.on
                beq at_car
                lda #ARREST
                jsr officer_near
                bcs next_officer
                lda #R_BUSTED
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
                lda #R_WINDOW
                jmp busted
+               rts
                .send

                .section boot           ; (runs once: main.asm)
; At start (boot, once what runs from higher up is there; nothing here is in the screens video.init clears):
; no police, and none due yet.
init            lda #15                 ; the siren's voice (the first): full volume, a square wave, at full
                sta SID + $18           ; sustain from the first moment
                lda #8
                sta SID + 3
                lda #$f0
                sta SID + 6
                ldx #SLOTS - 1
                lda #0
                sta SID + 2
                sta SID + 5
-               sta cop,x
                dex
                bpl -
                sta chase_wait
                sta around
                sta siren
                sta flash
                rts

                .send

                .section tile_room6     ; (where there is room: main.asm)
; Once a frame with heat (watch): at the wheel within PAINT_NEAR of the paint shop, no sooner than PAINT_AGAIN
; frames after the last time, the paint shop (paint_io).
paint_look      lda paint_wait
                beq +
                dec paint_wait
                rts
+               lda foot.on
                bne +
                lda #PAINT_NEAR
                sta reach
                sec
                lda player_at
                sbc #<PAINT_X
                tay
                lda player_at + 1
                sbc #>PAINT_X
                jsr close
                bcs +
                sec
                lda player_at + 2
                sbc #<PAINT_Y
                tay
                lda player_at + 3
                sbc #>PAINT_Y
                jsr close
                bcs +
                jmp gate_paint
+               rts
paint_wait      .byte 0                 ; frames before the paint shop can be used again
                .send
                .section tile_room1
gate_paint      #io_gate paint_io
                .send

                .section police_high
gate_join       #io_gate join_io        ; (gates to under the I/O area: main.asm)
gate_pave       #io_gate pave_io
; Once a frame with heat, or on the pavement (watch): driving on it faster than PAVE_FAST either way, the police
; around or a patrol car near, is a crime (pave_io), no sooner than PAVE_AGAIN frames after the last.
pave_look       lda pave_wait
                beq +
                dec pave_wait
                rts
+               lda foot.on
                bne +
                lda car.ground
                cmp #PAVEMENT
                bne +
                lda around
                ora patrol_near
                beq +
                lda #PAVE_FAST
                jsr car_slow
                bcc +
                jmp gate_pave
+               rts
; Once a frame with heat, or with a stolen police car (watch): the patrol cars. One within PATROL_NOTICE of the
; player either way (not a wreck) notices them (patrol_near); with heat it joins the chase, a chasing police car
; from now on, at COP_CRUISE.
patrols         lda #0
                sta patrol_near
                lda #PATROL_NOTICE
                sta reach
                ldx #SLOTS - 1
each_patrol     stx looked
                lda traffic.on,x
                beq next_patrol
                lda patrol,x
                beq next_patrol
                lda traffic.wreck,x
                bne next_patrol
                sec
                lda traffic.pl,x
                sbc player_at
                tay
                lda traffic.ph,x
                sbc player_at + 1
                jsr close
                bcs next_patrol
                ldx looked
                sec
                lda traffic.pl + N1,x
                sbc player_at + 2
                tay
                lda traffic.ph + N1,x
                sbc player_at + 3
                jsr close
                bcs next_patrol
                lda #1
                sta patrol_near
                lda status.heat
                beq next_patrol
                jsr gate_join
next_patrol     ldx looked
                dex
                bpl each_patrol
                rts
                .send

                .section basic_code     ; (where there is room: waiting.asm)
; A stolen police car (watch, after boxed_in): driven with heat 1, the police around, the heat goes up to 2 (no
; crime: straight to the level's start), and the panel says they know it. Again whenever that holds.
cruiser         lda stolen
                beq +
                lda around
                ora patrol_near
                beq +
                lda status.heat
                cmp #2
                bcs +
                sec
                lda status.level_lo + 2
                sbc status.points
                jsr status.add_heat
                ldx #status.MSG_CRUISER
                jmp status.say
+               rts
                .send

                .section gap_code       ; (where there is room: waiting.asm)
; The siren's sound, a frame of it (watch, with the siren on): the low note, then the high, then a frame of
; nothing, over and over, from the low note when it starts.
wailing         ldx wail
                inx
                cpx #WAIL_TIME
                bcc +
                ldx #0
+               stx wail
                ldy #0                  ; the tone
                cpx #2 * NOTE
                bcs +
                iny
                cpx #NOTE
                bcc +
                iny
+               sty tone
                lda note_lo,y
                sta SID
                lda note_hi,y
                sta SID + 1
                lda gate,y
                sta SID + 4
                rts
note_lo         .byte 0, <LOW_NOTE, <HIGH_NOTE
note_hi         .byte 0, >LOW_NOTE, >HIGH_NOTE
gate            .byte PULSE, PULSE | 1, PULSE | 1
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
                jmp gate_officer        ; (seat_officer, from under the I/O area: main.asm)
no_officer      rts
                .send

                .section tile_room4
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
gate_shoot      #io_gate shoot_io       ; (a gate, as those in low_more)
                .send

                .section tile_room6     ; (where there is room: main.asm)
                .send

                .section panel_code
; Officer looked, near (on_foot): with heat SHOOT_HEAT or more, within SHOOT_RANGE, and ready, they shoot.
may_shoot       lda status.heat
                cmp #SHOOT_HEAT
                bcc +
                ldx looked
                lda aim,x
                bne +
                lda #SHOOT_RANGE
                jsr officer_near
                bcs +
                jmp gate_shoot
+               rts
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

                .section io_code        ; (under the I/O area: main.asm, run through a gate there)
; An officer gets out (get_out, all else holding): a place for them among the passers-by's, and where.
seat_officer
                ldy #0                  ; how many are out, and a place
                ldx #CROWD - 1
-               lda people.on,x
                beq free_place
                lda people.officer,x
                beq +
                iny
+               dex
                bpl -
                cpy #OFFICERS
                bcs none_out
                ldx #CROWD - 1          ; none free: a passer-by out of sight
-               lda people.officer,x
                bne +
                lda people.down,x
                bne +
                jsr unseen
                bcs free_place
+               dex
                bpl -
none_out        rts
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
                bne officer_out
                lda #-2 * BESIDE
                jsr side_by
                cmp #WALL
                bne officer_out
                rts

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
; The officer stands at people.nx, ny, in place people.who; police car looked is left empty.
officer_out     jsr people.set_up
                lda #LIGHT_BLUE
                sta people.col,x
                lda #people.COP_PACE
                sta people.spd,x
                lda #0
                sta aim,x               ; (ready to shoot)
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
; Officer looked shoots (may_shoot, the gate), unless in the water: a bullet, an officer's (gun.own), from
; their middle at the gun's speed, the one of eight ways nearest the player's; and the next shot in AIM_MIN to
; AIM_MIN + 31 frames. With all the gun's bullets flying, no shot yet.
shoot_io        ldx looked
                lda people.xl,x
                sta car.px
                lda people.xh,x
                sta car.px + 1
                lda people.yl,x
                sta car.py
                lda people.yh,x
                sta car.py + 1
                jsr car.kind_at
                cmp #WATER_KIND
                beq no_shot
                ldy #gun.BULLETS - 1    ; a place for it
-               lda gun.ticks,y
                beq +
                dey
                bpl -
no_shot         rts
+               sty bullet
                ldx looked
                lda #1
                sta gun.own,y
                lda #gun.LIFE
                sta gun.ticks,y
                lda #$80
                sta gun.xf,y
                sta gun.yf,y
                lda people.xl,x
                sta gun.xl,y
                lda people.xh,x
                sta gun.xh,y
                lda people.yl,x
                sta gun.yl,y
                lda people.yh,x
                sta gun.yh,y
                sec                     ; the way to the player: across, down or a diagonal
                lda player_at
                sbc people.xl,x
                sta dxl
                lda player_at + 1
                sbc people.xh,x
                sta dxh
                sec
                lda player_at + 2
                sbc people.yl,x
                sta dyl
                lda player_at + 3
                sbc people.yh,x
                sta dyh
                sta second              ; (the signs, kept)
                bpl +
                jsr negate_y
+               lda dxh
                sta first
                bpl +
                jsr negate_x
+               lda dyl                 ; |dx| over twice |dy|: across
                asl
                bcs +
                cmp dxl
                bcs +
                ldy #0
                beq across
+               lda dxl                 ; |dy| over twice |dx|: down
                asl
                bcs +
                cmp dyl
                bcs +
                ldy #2
                bne down
+               ldy #1                  ; else a diagonal
                lda first
                bpl +
                ldy #3
+               lda second
                bpl aimed
                tya
                eor #6                  ; (1 to 7, 3 to 5)
                tay
                bne aimed
across          lda first
                bpl aimed
                ldy #4
                bne aimed
down            lda second
                bpl aimed
                ldy #6
aimed           ldx bullet
                lda gun.vx_lo,y
                sta gun.vxl,x
                lda gun.vx_hi,y
                sta gun.vxh,x
                lda gun.vy_lo,y
                sta gun.vyl,x
                lda gun.vy_hi,y
                sta gun.vyh,x
                jsr people.rnd          ; the next shot
                and #31
                clc
                adc #AIM_MIN
                ldx looked
                sta aim,x
                rts
bullet          .byte 0
; Driving on the pavement where the police see it (pave_look, the gate): 4 heat, and one of the police's four
; lines, unless the heat goes up a level, whose own announcement is the line then.
pave_io         lda #PAVE_AGAIN
                sta pave_wait
                lda status.heat
                pha
                lda #2 * 4
                jsr status.heat_a
                pla
                cmp status.heat
                bne +
                jsr people.rnd
                and #3
                clc
                adc #status.MSG_PAVE
                tax
                jmp status.say
+               rts
; The paint shop (paint_look, the gate): with $200 or more, $200 less, no heat, and a new colour, at random,
; unless the car is a police car; else nothing but the line that says so.
paint_io        lda #PAINT_AGAIN
                sta paint_wait
                lda status.money + 2    ; $200 or more?
                bne +
                lda status.money + 1
                cmp #>PAINT_COST
                bcs +
                ldx #status.MSG_NO_CASH
                jmp status.say
+               sed
                sec
                lda status.money + 1
                sbc #>PAINT_COST
                sta status.money + 1
                lda status.money + 2
                sbc #0
                sta status.money + 2
                cld
                lda #0
                sta status.heat
                sta status.points
                sta status.points + 1
                lda #1
                sta status.stars_shown
                sta status.changed
                lda stolen              ; (a police car stays one)
                bne painted
                jsr people.rnd
                and #7
                tax
                lda traffic.colours,x
                cmp car.colour          ; (a new colour: not the one it has)
                bne +
                inx
                txa
                and #7
                tax
                lda traffic.colours,x
+               sta car.colour
painted         ldx #status.MSG_PAINTED
                jmp status.say
; Patrol car looked joins the chase (patrols, with heat, the gate): a chasing police car, at COP_CRUISE.
join_io         ldx looked
                lda #1
                sta cop,x
                lda #0
                sta patrol,x
                lda #COP_CRUISE
                sta traffic.cruise,x
                rts
; Busted (busted, the gate).
; Busted.
busted_io       sed                     ; a fifth of the money: twice it, a digit less
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
station_at      ldy #0                  ; and on foot at the police station, the window there
                ldx #status.MSG_BUSTED
; On foot at place Y of places (0 the police station, 9 the hospital), the window there; message X.
put_at          stx said
                lda #0                  ; (a fraction of a pixel across: none)
                sta foot.pos
                ldx #0
-               lda places,y
                sta foot.pos + 1,x
                iny
                inx
                cpx #5
                bne -
                ldx #0
-               lda places,y
                sta cam_lo,x
                iny
                inx
                cpx #4
                bne -
                lda foot.pos + 1        ; (and where the window follows them to, this frame too)
                sta player_at
                lda foot.pos + 2
                sta player_at + 1
                lda foot.pos + 4
                sta player_at + 2
                lda foot.pos + 5
                sta player_at + 3
                ldx said
                jmp status.say
place           .function px, py        ; pos + 1 to + 5 (pos + 3, a fraction: 0), then cam_lo to cam_hi + 1
                .endf (<px, >px, 0, <py, >py, <(px - CENTRE_X), <(py - CENTRE_Y), >(px - CENTRE_X), >(py - CENTRE_Y))
places          .byte place(STATION_X, STATION_Y), place(HOSPITAL_X, HOSPITAL_Y)
                .cerror cam_hi - cam_lo != 2, "put_at expects cam_hi two bytes after cam_lo"
said            .byte 0
; Busted or wasted: the police go, and the heat, and the counts to an arrest.
calm            lda #0
                sta boxed_for
                ldx #SLOTS - 1          ; the police cars ...
-               lda cop,x
                beq +
                lda #0
                sta cop,x
                sta traffic.on,x
+               dex
                bpl -
                lda #0                  ; ... and the heat
                sta status.heat
                sta status.points
                sta status.points + 1
                lda #1
                sta status.stars_shown
                sta status.changed
                jmp officers_go         ; and the officers on foot
; Wasted (wasted, the gate): the police take the weapons if they are about; the police and the heat go; full
; health; the hospital bills up to $500; and the player is at the hospital, the window there.
; Going down (go_down, the gate), busted or wasted: the police take the weapons (busted, always; wasted, with
; the police about, a patrol car near, or shot by an officer); the police and the heat go; and the banner.
down_io         ldx #status.MSG_WASTED
                lda down_kind
                beq +
                lda around
                ora patrol_near
                ora shot
                beq ++
+               lda #0
                sta status.ammo
                sta status.knife
                ldx #status.MSG_SEIZED
+               stx said
                jsr calm
                jmp make_banner
; Back from the pause (downed, the gate): wasted (busted_io for busted): full health, the hospital's bill of up
; to $500, at the hospital.
back_io         lda down_kind
                bne +
                jmp busted_io
+               lda #100
                sta status.hp
                lda status.money + 2    ; the bill: $500, or what there is
                bne pay
                lda status.money + 1
                cmp #>BILL
                bcs pay
                lda #0
                sta status.money
                sta status.money + 1
                beq billed
pay             sed
                sec
                lda status.money + 1
                sbc #>BILL
                sta status.money + 1
                lda status.money + 2
                sbc #0
                sta status.money + 2
                cld
billed          ldy #9
                ldx said
                jmp put_at

                .send

                .section low_more       ; (where there is room: main.asm)
; The gates to what runs from under the I/O area (seat_officer, busted_io).
gate_officer    #io_gate seat_officer
gate_down       #io_gate down_io
gate_back       #io_gate back_io

; On foot, once a frame (foot.update): a car on the move hits the player, for its speed * 0.28 (in pixels a
; second: the traffic's speed * 7/64), unless one has in the last HURT_WAIT frames; at no health left, wasted.
; Its body is turned to the axis it faces nearer (the design turns it all the way: the cars turn only at
; crossings).
hits            lda hit_wait
                beq +
                dec hit_wait
                rts
+               ldx #SLOTS - 1
each_hitter     stx looked
                lda traffic.on,x
                beq next_hitter
                lda traffic.sp,x
                cmp #HURT_FAST + 1
                bcc next_hitter
                lda traffic.face,x      ; (C set: + 2) 4 if it faces nearer north or south
                adc #1
                and #4
                beq +
                lda #HURT_LONG ^ HURT_SHORT
+               eor #HURT_LONG          ; HURT_LONG east or west, else HURT_SHORT
                sta reach
                sec
                lda traffic.pl,x
                sbc player_at
                tay
                lda traffic.ph,x
                sbc player_at + 1
                jsr close
                bcs next_hitter
                lda reach               ; the other way
                eor #HURT_LONG ^ HURT_SHORT
                sta reach
                ldx looked
                sec
                lda traffic.pl + N1,x
                sbc player_at + 2
                tay
                lda traffic.ph + N1,x
                sbc player_at + 3
                jsr close
                bcc struck
next_hitter     ldx looked
                dex
                bpl each_hitter
                rts
struck          ldx looked
                lda traffic.sp,x        ; speed / 8 - speed / 64
                lsr
                lsr
                lsr
                sta hurt
                lsr
                lsr
                lsr
                eor #$ff
                sec
                adc hurt
                ldx #HURT_WAIT
                stx hit_wait
; A health less; at none left, wasted (and no siren).
harm            sta hurt
                lda status.hp
                sec
                sbc hurt
                beq +
                bcs survived
+               lda #R_CAR              ; (wasted: by a car, or by an officer's shot)
                ldx shot
                beq +
                lda #R_SHOT
+               jmp wasted
survived        sta status.hp
                lda #1
                sta status.changed
                rts
hit_wait        .byte 0                 ; frames before a car can hurt the player again
hurt            .byte 0
                .send

                .section low_code       ; (where there is room: main.asm)
; Bullet gun.who, an officer's, not spent on a wall (gun.hits): it hits the player if it is within
; gun.HIT_PERSON of their middle either way, in a car or on foot: SHOT_HURT, and wasted by it, the police take
; the weapons.
cop_bullet      lda #gun.HIT_PERSON
                sta reach
                ldx gun.who
                sec
                lda gun.xl,x
                sbc player_at
                tay
                lda gun.xh,x
                sbc player_at + 1
                jsr close
                bcs +
                ldx gun.who
                sec
                lda gun.yl,x
                sbc player_at + 2
                tay
                lda gun.yh,x
                sbc player_at + 3
                jsr close
                bcs +
                lda #1
                sta shot
                lda #SHOT_HURT
                jsr harm
                lda #0
                sta shot
                jmp gun.spent
+               rts
                .send
                .section tile_room2     ; (where there is room: main.asm)
; Busted (A: the reason, R_...), or wasted: go down, and the pause.
busted          ldx #0
                beq go_down
wasted          ldx #1
; Going down: what goes now (down_io: the weapons, the police, the heat; the banner), the siren off, and then
; DOWN_TIME frames with everything still (downed, which ready jumps to meanwhile), the banner over it all.
go_down         sta down_reason
                stx down_kind
                jsr gate_down
                lda #$4c                ; (ready: jmp downed, for the pause)
                sta ready
                lda #<downed
                sta ready + 1
                lda #>downed
                sta ready + 2
                lda #DOWN_TIME
                sta paused
                ldx #BAND_ROWS * 40     ; the band's text in white (as a character's own colour: 0-7)
                lda #WHITE
-               sta COLOUR_RAM + BAND * 40 - 1,x
                dex
                bne -
                jmp quiet
                .send
                .section tile_room3     ; (where there is room: main.asm)
; A frame of the pause: only the banner's sprites, the picture still; at the end, back (back_io), and on with the
; frame as ever.
downed          dec paused
                bne +
                lda #$20                ; (ready as it was: jsr input.read)
                sta ready
                lda #<input.read
                sta ready + 1
                lda #>input.read
                sta ready + 2
                jsr gate_back
                jsr input.read
                jmp ready + 3
+               ldx #0
-               stx sprites.sp          ; (spare)
                txa                     ; its x: 24 a sprite along
                asl
                asl
                asl
                sta sprites.sx
                asl
                adc sprites.sx          ; (24 x, no carry: at most 5 * 24)
                adc banner_x
                sta sprites.sx
                lda #0
                adc #0
                sta sprites.sx + 1
                lda #TITLE_Y
                sta sprites.sy
                lda banner_colour
                sta sprites.sc
                txa
                clc
                adc banner_sprite
                sta sprites.sp
                txa
                pha
                jsr sprites.add
                pla
                tax
                inx
                cpx banner_n
                bne -
                jsr sprites.plan
                jsr video.follow
                jsr frame.publish
                jmp main_loop
paused          .byte 0                 ; frames of the pause left; 0: playing
down_kind       .byte 0                 ; 0 busted, 1 wasted
down_reason     .byte 0                 ; R_...
banner_x        .byte 0                 ; the title: its left edge (sprite x) ...
banner_n        .byte 0                 ; ... how many sprites ...
banner_sprite   .byte 0                 ; ... the first's frame (a pointer, the other screen's) ...
banner_colour   .byte 0                 ; ... and their colour
                .send

                .section io_more        ; (under the I/O area too: main.asm)
; The banner (down_io): the title, BUSTED in light blue or FLATLINED in red, in letters twice the font's size,
; made into sprites 24 pixels wide in the screen not shown (nothing scrolls in the pause: video.ahead does not
; run), centred; and across the screen shown, the band: its rows blank, the reason in the middle ones.
make_banner     ldx down_kind
                lda title_n,x
                sta banner_n
                lda title_x,x
                sta banner_x
                lda title_colour,x
                sta banner_colour
                lda title_lo,x
                sta letter + 1
                lda title_hi,x
                sta letter + 2
                lda title_len,x
                sta letters
                lda video.front         ; the other screen: its sprites' frames
                eor #1
                tax
                lda screens,x
                sta clear_at + 2
                clc
                adc #1
                sta clear_next + 2
                lda clear_at + 2
                asl                     ; (its pointer: the address / 64)
                asl
                sta banner_sprite
                ldy #0                  ; their frames clear (two pages: six sprites need 384 bytes)
                tya
clear_at        sta $ff00,y             ; (the high bytes are written above)
clear_next      sta $ff00,y
                iny
                bne clear_at
                ldx #0                  ; the letters, each 16 pixels across
each_letter     stx letter_no
letter          lda $ffff,x             ; (the title: written above)
                asl                     ; its glyph: charset + 8 * the screen code
                asl
                asl
                sta glyph + 1
                lda #0
                rol
                adc #>charset
                sta glyph + 2
                lda #0
                sta glyph_row
each_row        ldy glyph_row
glyph           lda $ffff,y
                sta glyph_bits
                lda letter_no           ; x: 16 a letter, 2 a bit
                asl
                asl
                asl
                asl
                sta dot_x
each_bit        asl glyph_bits
                bcc +
                lda glyph_row           ; y: 2 a row
                asl
                sta dot_y
                jsr plot2
                inc dot_y
                jsr plot2
+               inc dot_x
                inc dot_x
                lda glyph_bits
                bne each_bit            ; (the rest of the row is clear)
                inc glyph_row
                lda glyph_row
                cmp #8
                bne each_row
                ldx letter_no
                inx
                cpx letters
                bne each_letter
                ldx video.front         ; the band, across the screen shown: blank, and the reason in it
                lda screens,x
                clc
                adc #>(BAND * 40 - 1)
                sta band_at + 2
                lda screens,x
                clc
                adc #>((BAND + 3) * 40)
                sta line_at + 2
                ldx #BAND_ROWS * 40
                lda #' '
band_at         sta BAND * 40 - 1,x     ; (on the screen: the high byte is written above)
                dex
                bne band_at
                ldx down_reason
                lda reasons_lo,x
                sta reason + 1
                lda reasons_hi,x
                sta reason + 2
                ldx #39
reason          lda $ffff,x
line_at         sta (BAND + 3) * 40,x   ; (the same)
                dex
                bpl reason
                rts
; Pixels dot_x and dot_x + 1 of row dot_y of the title's sprites set.
plot2           jsr plot
                inc dot_x
                jsr plot
                dec dot_x
                rts
plot            lda dot_x                  ; sprite dot_x / 24, pixel dot_x % 24 in it
                ldx #0
-               cmp #24
                bcc +
                sbc #24
                inx
                bne -
+               pha
                and #7
                tay
                pla
                lsr
                lsr
                lsr
                sta byte_of
                txa                     ; 64 a sprite ...
                lsr
                lsr
                sta plot_hi
                txa
                and #3
                lsr
                ror
                ror
                sta plot_lo
                lda dot_y                  ; ... 3 a row, and the byte
                asl
                adc dot_y
                adc byte_of
                adc plot_lo             ; (no carry: at most 3 * 64 + 47)
                sta plot_at + 1
                sta plot_to + 1
                lda clear_at + 2
                adc plot_hi
                sta plot_at + 2
                sta plot_to + 2
plot_at         lda $ffff
                ora masks,y
plot_to         sta $ffff
                rts
masks           .byte $80, $40, $20, $10, $08, $04, $02, $01
screens         .byte >SCREEN_A, >SCREEN_B
letter_no       .byte 0
letters         .byte 0
glyph_row       .byte 0
glyph_bits            .byte 0
dot_x              .byte 0
dot_y              .byte 0
byte_of         .byte 0
plot_lo         .byte 0
plot_hi         .byte 0
                .enc "screen"
title_busted    .text "busted"
title_flat      .text "flatlined"
title_lo        .byte <title_busted, <title_flat
title_hi        .byte >title_busted, >title_flat
title_len       .byte 6, 9
title_n         .byte 4, 6                      ; sprites: 16 pixels a letter, 24 a sprite
title_x         .byte 24 + (320 - 6 * 16) / 2, 24 + (320 - 9 * 16) / 2
title_colour    .byte LIGHT_BLUE, RED           ; (hi-res sprites: bit 7 clear)
centred         .function t
                .endf (" " x ((40 - len(t)) / 2)) .. t .. (" " x (40 - len(t) - (40 - len(t)) / 2))
REASONS         = ("you have the right to remain broke", "boxed in. like your career prospects.", "please step out of the stolen vehicle", "a pedestrian. in this economy?", "resisting arrest. allegedly.")
r0              .text centred(REASONS[0])
r1              .text centred(REASONS[1])
r2              .text centred(REASONS[2])
r3              .text centred(REASONS[3])
r4              .text centred(REASONS[4])
reasons_lo      .byte <(r0, r1, r2, r3, r4)
reasons_hi      .byte >(r0, r1, r2, r3, r4)
                .enc "none"
                .send
                .bend
