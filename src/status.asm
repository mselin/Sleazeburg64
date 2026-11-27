; SPDX-License-Identifier: GPL-2.0-or-later
; The status panel of the game, by the browser game's design (specs/design.md there, "The status panel"):
; three rows of 40 characters under the city, on black.
;
;   0         1         2         3
;   0123456789012345678901234567890123456789
;   $000000 HEAT *****  HP##### CAR### AMMO12
;   NO JOB. FOLLOW THE ARROW TO A "J".
;   FIRE: HANDBRAKE. STANDING STILL: GET OUT
;
; Row 1: the money, light green; HEAT, and a star for each level, which flash red and yellow four times a
; second (the rest dark grey); HP and the health bar, green, red at 30 or below; CAR and the car's bar, cyan,
; red under 40, only in a car; and what fire does, at the right: AMMO and two digits in yellow, or KNIFE in
; light grey or FIST in light red once the ammo runs out. The design puts the stars, HP and CAR between
; character columns; here they are rounded to whole ones. A bar is characters filled a pixel column at a time
; (tools/assets.mjs): the health bar is 40 pixels, as the browser game fills its own, and the car's 24 rather
; than 26. A character has one colour, so the part of a bar that is not filled is dark grey only in whole
; characters, and black in the one it ends in.
;
; Row 2: the job. There are no jobs yet, so it is the line for no job, in grey.
;
; Row 3: the latest message, in white, for max(4, 0.14 s a character + 1.5) seconds; one longer than 40
; characters scrolls left after a second and stops at its end. The design scrolls 70 pixels a second; here it
; is a character every 6 frames, 67. Otherwise ELECTION FUND: $ and the money / $25000, in dark grey.
;
; Heat (add_heat): points, kept in halves (the design has 0.5 and 1.5), at most 230; its level, the stars, from
; them: 1 from 8, 2 from 25, 3 from 60, 4 from 110, 5 from 180. A new level says so in row 3. With no police
; yet, nothing keeps it up: it drops a level every 9 seconds (COOL_FRAMES), its points to that level's start, the
; time counted afresh with every crime. Nothing changes the money, health or ammo yet. What does will set
; `changed`, and row 1 is drawn again in the next frame that has the time.
;
; It runs from EXTRA_CODE ($e000), with its variables that have values (the rest are full with sixteen cars).
;
; The time. Only what changed is written, and only in a frame that does not move the screen a character,
; which has none to spare (as for the water and Big Honk): the frame after one never moves it. In a frame of
; colour memory, the one after that, only row 3 is written, about 8 raster lines (16 when its colour
; changes); the rest of the panel, row 1 whole about 25 lines and the car's part about 10, waits for a frame
; that does neither. Flat out there are none of those, so the car's part shows once the car slows.

status          .block

PANEL           = PANEL_SCREEN + ROWS * 40      ; its three rows on the screen ...
COLOURS         = COLOUR_RAM + ROWS * 40        ; ... and in colour memory
ROW2            = 40
ROW3            = 80
STARS_AT        = 13
HP_BAR          = 21                    ; 5 characters, 40 pixels
CAR_AT          = 27
CAR_BAR         = 30                    ; 3 characters, 24 pixels
WEAPON_AT       = 34                    ; AMMO99, KNIFE or FIST, right-aligned: columns 34-39
BAR_FIRST       = 248                   ; character 247 + n: the left n pixel columns filled (tools/assets.mjs)
BAR_FULL        = BAR_FIRST + 7
FLASH_FRAMES    = 12                    ; the stars: four times a second, to within a frame in eight
SCROLL_START    = 50                    ; a long message waits a second ...
SCROLL_FRAMES   = 6                     ; ... then moves a character every 6 frames

                .section status         ; (the variables are full in a build with sixteen cars)
money           .fill 3                 ; binary-coded decimal, the lowest two digits first
heat            .byte ?                 ; the level, 0-5
points          .word ?                 ; heat in half points, at most 2 * 230
cool            .word ?                 ; frames before it drops a level
hp              .byte ?                 ; the player's health, 0-100
car_hp          .byte ?                 ; the car's, 0-100
ammo            .byte ?                 ; binary-coded decimal, 0-99
knife           .byte ?                 ; 1 with a knife
                .send
                .section bss
changed         .byte ?                 ; 1: draw row 1 again
car_shown       .byte ?                 ; 1: draw the CAR part again (getting in or out)
stars_shown     .byte ?                 ; 1: colour the stars again
redraw3         .byte ?                 ; 1: draw row 3 again
row3_ink        .byte ?                 ; the colour row 3 has in colour memory now ...
want_ink        .byte ?                 ; ... and the one it is to have
ink_due         .byte ?                 ; 1: write that, in the next frame with the time
text            .word ?                 ; the message: where its text is ...
most            .byte ?                 ; ... how far along it can scroll ...
left            .word ?                 ; ... frames before it goes, or 0 for none ...
offset          .byte ?                 ; ... how far it has scrolled ...
scroll_wait     .byte ?                 ; ... and frames before it does again
flash           .byte ?                 ; the stars: 0 yellow, 1 red
flash_wait      .byte ?
value           .byte ?                 ; scale
sum             .word ?
                .send
pixels          = value                 ; bar, which comes after scale
cells           = sum
ink             = sum + 1
lead            = sum                   ; printing the money (whose byte is in value): 0 while its digits are leading zeros

                .section status
; The start of a game: nothing, full health, no ammo (no gun yet); and the first message.
init            lda #0
                ldx #2
-               sta money,x
                dex
                bpl -
                sta heat
                sta points
                sta points + 1
                sta knife
                sta flash
                sta changed
                sta stars_shown
                sta car_shown
                lda #100
                sta hp
                sta car_hp
                lda #0                  ; no ammo until there is a gun: fire on foot is a punch
                sta ammo
                lda #FLASH_FRAMES
                sta flash_wait
                lda #$ff                ; row 3's colour memory: not yet any colour
                sta row3_ink
                ldx #39
-               lda row2_text,x
                sta PANEL + ROW2,x
                lda #GREY
                sta COLOURS + ROW2,x
                dex
                bpl -
                jsr draw_row1
                ldx #MSG_CAR
                jsr say
                jsr draw_row3
                jmp write_ink

; Show message X in row 3, from the next frame that has the time.
say             lda msg_lo,x
                sta text
                lda msg_hi,x
                sta text + 1
                lda msg_most,x
                sta most
                lda msg_left_lo,x
                sta left
                lda msg_left_hi,x
                sta left + 1
                lda #0
                sta offset
                lda #SCROLL_START + 1   ; (the same)
                sta scroll_wait
                lda #1
                sta redraw3
                rts

; Once a frame, after the window has moved: count the message's time and scrolling, and the
; flashing, then write what has changed if this frame has the time.
update          lda left
                ora left + 1
                beq timed
                lda left
                bne +
                dec left + 1
+               dec left
                lda left
                ora left + 1
                bne +
                lda #1                  ; its time is up
                sta redraw3
                bne timed
+               dec scroll_wait
                bne timed
                lda #SCROLL_FRAMES
                sta scroll_wait
                lda offset
                cmp most
                bcs timed               ; at its end
                inc offset
                lda #1
                sta redraw3
timed
                lda heat
                beq +
                lda police.around         ; (not while the police are near)
                bne no_cooling
                jsr cooling
no_cooling
                lda heat
                beq +
                dec flash_wait
                bne +
                lda #FLASH_FRAMES
                sta flash_wait
                lda flash
                eor #1
                sta flash
                lda #1
                sta stars_shown
+               jsr screen_moves
                bcc +
                rts
+               lda busy                ; colour memory this frame: only row 3, the rest waits
                beq +
                jmp row3_work
+               lda changed
                beq +
                jsr draw_row1
+               lda car_shown
                beq +
                jsr draw_car
+               lda stars_shown
                beq +
                jsr colour_stars
+               jmp row3_work

; Row 3: its text if it has changed, else its colour if that has. (A new colour comes a frame after the text,
; so that no frame has to write both: 80 bytes is about 16 raster lines.)
row3_work       lda redraw3
                beq +
                jmp draw_row3
+               lda ink_due
                bne write_ink
written         rts
write_ink       lda #0
                sta ink_due
                lda want_ink
                sta row3_ink
                ldx #39
-               sta COLOURS + ROW3,x
                dex
                bpl -
                rts

; ---------- row 1 ----------

draw_row1       ldx #39
-               lda row1_text,x
                sta PANEL,x
                lda row1_colours,x
                sta COLOURS,x
                dex
                bpl -
                lda #0
                sta changed
                lda #1                  ; and row 3, which may show the money
                sta redraw3
                ldx #1                  ; the money: $ and six digits
                ldy #2
-               lda money,y
                lsr
                lsr
                lsr
                lsr
                ora #'0'
                sta PANEL,x
                lda money,y
                and #15
                ora #'0'
                sta PANEL + 1,x
                inx
                inx
                dey
                bpl -
                jsr colour_stars
                lda hp                  ; health: a pixel for each 2.5
                ldx #40
                jsr scale
                ldy #GREEN
                ldx hp
                cpx #31
                bcs +
                ldy #RED
+               sty ink
                ldx #HP_BAR
                ldy #5
                jsr bar
                jsr draw_car
                lda ammo                ; what fire does
                beq +
                lsr
                lsr
                lsr
                lsr
                ora #'0'
                sta PANEL + WEAPON_AT + 4
                lda ammo
                and #15
                ora #'0'
                sta PANEL + WEAPON_AT + 5
                rts
+               ldy #5                  ; KNIFE, or FIST
                lda knife
                beq +
                ldy #11
+               ldx #5
-               lda weapon_text,y
                sta PANEL + WEAPON_AT,x
                lda weapon_ink,y
                sta COLOURS + WEAPON_AT,x
                dey
                dex
                bpl -
                rts

; CAR and its bar while the player is in a car; nothing there on foot.
draw_car        lda #0
                sta car_shown
                lda foot.on
                beq +
                ldx #CAR_BAR - CAR_AT + 2
                lda #' '
-               sta PANEL + CAR_AT,x
                dex
                bpl -
                rts
+               ldx #2
-               lda row1_text + CAR_AT,x
                sta PANEL + CAR_AT,x
                dex
                bpl -
                lda car_hp
                ldx #24
                jsr scale
                ldy #CYAN
                ldx car_hp
                cpx #40
                bcs +
                ldy #RED
+               sty ink
                ldx #CAR_BAR
                ldy #3
                jmp bar

; Heat for a crime, A half points (people, foot): at most 230 points; a level higher says so.
add_heat        clc
                adc points
                sta points
                bcc +
                inc points + 1
+               lda points + 1          ; no more than 2 * 230
                cmp #>(2 * 230)
                bcc ++
                bne +
                lda points
                cmp #<(2 * 230) + 1
                bcc ++
+               lda #<(2 * 230)
                sta points
                lda #>(2 * 230)
                sta points + 1
+               lda #<COOL_FRAMES              ; the time to cool counted afresh
                sta cool
                lda #>COOL_FRAMES
                sta cool + 1
                ldx #5                  ; the level the points reach
-               lda points
                cmp level_lo,x
                lda points + 1
                sbc level_hi,x
                bcs +
                dex
                bne -
+               cpx heat
                beq +
                bcc +
                stx heat
                lda #1
                sta stars_shown
                txa                     ; and says so
                clc
                adc #MSG_HEAT - 1
                tax
                jmp say
+               rts
; Once a frame with heat: a level less every COOL_FRAMES frames, the points down to its start.
cooling         lda cool
                bne +
                dec cool + 1
+               dec cool
                lda cool
                ora cool + 1
                bne +
                lda #<COOL_FRAMES
                sta cool
                lda #>COOL_FRAMES
                sta cool + 1
                dec heat
                ldx heat
                lda level_lo,x
                sta points
                lda level_hi,x
                sta points + 1
                lda #1
                sta stars_shown
+               rts
COOL_FRAMES     = 9 * 50
LEVELS          = (0, 8, 25, 60, 110, 180)      ; where each level starts, in points
level_lo        .byte 0, <(2 * LEVELS[1]), <(2 * LEVELS[2]), <(2 * LEVELS[3]), <(2 * LEVELS[4]), <(2 * LEVELS[5])
level_hi        .byte 0, >(2 * LEVELS[1]), >(2 * LEVELS[2]), >(2 * LEVELS[3]), >(2 * LEVELS[4]), >(2 * LEVELS[5])

; The stars: one for each level of heat, flashing; the rest dark grey.
colour_stars    lda #0
                sta stars_shown
                ldx #0
-               lda #DARK_GREY
                cpx heat
                bcs +
                lda #YELLOW
                ldy flash
                beq +
                lda #RED
+               sta COLOURS + STARS_AT,x
                inx
                cpx #5
                bne -
                rts

; A = value * X / 100, to the nearest: how many pixels of a bar of X pixels a value from 0 to 100 fills.
scale           sta value
                lda #50
                sta sum
                lda #0
                sta sum + 1
-               clc
                lda sum
                adc value
                sta sum
                bcc +
                inc sum + 1
+               dex
                bne -
                ldx #0
-               sec
                lda sum
                sbc #100
                tay
                lda sum + 1
                sbc #0
                bcc +
                sta sum + 1
                sty sum
                inx
                bne -
+               txa
                rts

; A bar of Y characters from column X with A pixel columns filled, in the colour `ink`; the characters not
; reached are dark grey.
bar             sta pixels
                sty cells
-               lda pixels
                beq empty
                cmp #8
                bcc part
                sbc #8                  ; (C is set)
                sta pixels
                lda #BAR_FULL
                ldy ink
                bne put
part            adc #BAR_FIRST - 1      ; (C is clear) the left A columns
                ldy #0
                sty pixels
                ldy ink
                bne put
empty           lda #BAR_FULL
                ldy #DARK_GREY
put             sta PANEL,x
                tya
                sta COLOURS,x
                inx
                dec cells
                bne -
                rts

; ---------- row 3 ----------

; The message, scrolled as far as it has; or with none, the election fund.
draw_row3       lda #0
                sta redraw3
                lda left
                ora left + 1
                bne +
                jmp idle
+               lda #WHITE
                jsr row3_colour
                clc
                lda text
                adc offset
                sta from + 1
                lda text + 1
                adc #0
                sta from + 2
                ldx #39
from            lda $ffff,x             ; (the address is written above)
                sta PANEL + ROW3,x
                dex
                bpl from
                rts
idle            lda #DARK_GREY
                jsr row3_colour
                ldx #0
-               lda fund_text,x
                sta PANEL + ROW3,x
                inx
                cpx #size(fund_text)
                bne -
                lda #0                  ; the money, without its leading zeros
                sta lead
                lda #2
                sta value               ; (the byte of it)
-               ldy value
                lda money,y
                lsr
                lsr
                lsr
                lsr
                jsr digit
                ldy value               ; the last digit, even if it is 0
                bne +
                inc lead
+               lda money,y
                and #15
                jsr digit
                dec value
                bpl -
                ldy #0
-               lda goal_text,y
                sta PANEL + ROW3,x
                inx
                iny
                cpy #size(goal_text)
                bne -
                lda #' '
-               sta PANEL + ROW3,x
                inx
                cpx #40
                bne -
                rts

; Digit A at column X of row 3, and X + 1; or nothing for a leading zero.
digit           tay
                bne +
                lda lead
                beq ++                  ; a leading zero
                tya
+               ora #'0'
                sta PANEL + ROW3,x
                inx
                sta lead                ; not 0
+               rts

; Row 3 is to be in colour A: from the next frame with the time, if it is not that already.
row3_colour     sta want_ink
                cmp row3_ink
                beq +
                lda #1
                sta ink_due
+               rts

; ---------- what it says ----------

                .enc "screen"
row1_text       .text "$000000 heat ***** hp      car    ammo12"
ROW1_INKS       = [LIGHT_GREEN] x 7 .. [LIGHT_GREY] x 5 .. [DARK_GREY] x 6 .. [LIGHT_GREY] x 3 .. [DARK_GREY] x 6 .. [LIGHT_GREY] x 3 .. [DARK_GREY] x 4 .. [YELLOW] x 6
row1_colours    .byte ROW1_INKS
weapon_text     .text "  fist", " knife"
weapon_ink      .byte [LIGHT_RED] x 6, [LIGHT_GREY] x 6
row2_text       .text format("%-40s", 'no job. follow the arrow to a "j".')
fund_text       .text "election fund: $"
goal_text       .text " / $25000"

; The messages: each padded to at least 40 characters, how far it can scroll, and how long it stays.
MSG_CAR         = 0
MSG_FOOT        = 1
MSG_SUNK        = 2
MSG_HEAT        = 3                     ; and on, for heat levels 1-5
MSG_BUSTED      = 8
MSG_CRUISER     = 9
MSG_WASTED      = 10
MSG_SEIZED      = 11                    ; (wasted with the police about)
MSG_PAVE        = 12                    ; and on: the police's four lines for driving on the pavement
MESSAGES        = ("fire: handbrake. standing still: get out", "stand by a car and press fire to get in", "the car is gone. swim for it. the warranty does not cover this.", "a stern letter is being drafted", "police dispatched. eventually.", "shoot first, paperwork never", "overtime has been approved", "the homeowners association has been notified", 'busted. your weapons are now evidence', "the cops know that cruiser. they do not know you.", "st. invoice hospital: ambulance ride (out of network)", "ambulance ride billed. the police kept your weapons", "officer: that is a sidewalk, not a shortcut.", "police: sidewalks are for pedestrians and parking tickets.", "the cops saw that. the pavement is not a lane.", "driving on the sidewalk. in front of the police. bold.")
                .send                   ; (the messages: in the room the tables by tile leave, main.asm)
                .section tile_room1
m0              .text format("%-40s", MESSAGES[0])
m1              .text format("%-40s", MESSAGES[1])
m3              .text format("%-40s", MESSAGES[3])
                .send
                .section tile_room2
m2              .text format("%-40s", MESSAGES[2])
m4              .text format("%-40s", MESSAGES[4])
                .send
                .section tile_room3
m5              .text format("%-40s", MESSAGES[5])
m6              .text format("%-40s", MESSAGES[6])
m7              .text format("%-40s", MESSAGES[7])
                .send
                .section tile_room4
m8              .text format("%-40s", MESSAGES[8])
                .send
                .section gap_code       ; (waiting.asm)
m9              .text format("%-40s", MESSAGES[9])
                .send
                .section tile_room5
m12             .text format("%-40s", MESSAGES[12])
                .send
                .section tile_room6
m13             .text format("%-40s", MESSAGES[13])
m14             .text format("%-40s", MESSAGES[14])
                .send
                .section tile_room4
m15             .text format("%-40s", MESSAGES[15])
                .send
                .section status
m10             .text format("%-40s", MESSAGES[10])
m11             .text format("%-40s", MESSAGES[11])
                .send
                .section status
MSG_AT          = (m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15)
msg_lo          .byte <MSG_AT
msg_hi          .byte >MSG_AT
most_of         .function m
                .endf len(m) > 40 ? len(m) - 40 : 0
frames_of       .function m             ; 50 * max(4, 0.14 * its length + 1.5), and 1 for the frame it is said
                .endf (len(m) * 7 + 75 > 200 ? len(m) * 7 + 75 : 200) + 1     ; in, which counts it down too
msg_most        .byte most_of(MESSAGES[0]), most_of(MESSAGES[1]), most_of(MESSAGES[2]), most_of(MESSAGES[3])
                .byte most_of(MESSAGES[4]), most_of(MESSAGES[5]), most_of(MESSAGES[6]), most_of(MESSAGES[7])
                .byte most_of(MESSAGES[8]), most_of(MESSAGES[9]), most_of(MESSAGES[10]), most_of(MESSAGES[11])
                .byte most_of(MESSAGES[12]), most_of(MESSAGES[13]), most_of(MESSAGES[14]), most_of(MESSAGES[15])
MSG_FRAMES      = (frames_of(MESSAGES[0]), frames_of(MESSAGES[1]), frames_of(MESSAGES[2]), frames_of(MESSAGES[3]), frames_of(MESSAGES[4]), frames_of(MESSAGES[5]), frames_of(MESSAGES[6]), frames_of(MESSAGES[7]), frames_of(MESSAGES[8]), frames_of(MESSAGES[9]), frames_of(MESSAGES[10]), frames_of(MESSAGES[11]), frames_of(MESSAGES[12]), frames_of(MESSAGES[13]), frames_of(MESSAGES[14]), frames_of(MESSAGES[15]))
msg_left_lo     .byte <MSG_FRAMES
msg_left_hi     .byte >MSG_FRAMES
                .enc "none"

                .send

                .cerror len(ROW1_INKS) != 40, "row 1 is not 40 colours"
                .cerror size(row1_text) != 40, "row 1 is not 40 characters"

                .bend
