; SPDX-License-Identifier: GPL-2.0-or-later
; The title page (TITLE=1, the game as it is shipped): the sunset picture from the browser game's title screen
; (mselin/gta-c64, assets/title-sunset.png), with PRESS FIRE TO COMMIT CRIMES blinking under it, until fire.
; Above it, the difficulty's line, DIFFICULTY: CLASSIC - PRESS D, which D turns to MODERN and back (specs/design.md
; there, "Difficulty"): grey on classic, yellow on modern, and with it the riders (people.difficulty).
;
; It is the first thing start does, before anything is unpacked or copied up, so memory is free: the picture
; (tools/picture.mjs: a multicolour bitmap, packed, after the rest of the packed program file) is unpacked to
; the video chip's last bank, its screen at $c000 and its bitmap at $e000, and colour memory is set from it.
; What start does next writes over all of it. The screen is left blank, and the video chip in its first bank.
;
; Its code waits above where the rest is unpacked to (main.asm, title_code), with the scooter riders' frames:
; nothing there is needed once fire is pressed.

title_page      .block

PIC_SCREEN      = $c000                 ; where tools/picture.mjs puts it: the screen ...
COLOURS         = PIC_SCREEN + 1000         ; ... what goes in colour memory ...
BITMAP          = $e000                 ; ... and the bitmap
TEXT_ROW        = 24                    ; the character row of PRESS FIRE ..., in colour 1 of its cells
BLINK           = 25                    ; frames on, then off
CIA2_PRA        = $dd00                 ; bits 0-1: the video chip's bank, the other way up
CIA1_PORT_B     = $dc01                 ; the keyboard's rows, of the columns low in port A
CIA1_DDRA       = $dc02                 ; (which lines of each are written)
CIA1_DDRB       = $dc03
LINE_ROW        = 0                     ; the character row of the difficulty's line (tools/picture.mjs) ...
STASH           = PIC_SCREEN + $800     ; ... and the other setting's, its 320 bitmap bytes
D_COLUMN        = %11111011             ; D: column 2 (low in port A) ...
D_ROW           = %00000100             ; ... row 2 (low in port B when held)

swap320         .macro                 ; swap the 320 bytes at \1 and \2 (two halves of 160)
                ldx #160
-               lda \1 - 1,x
                ldy \2 - 1,x
                sta \2 - 1,x
                tya
                sta \1 - 1,x
                lda \1 + 159,x
                ldy \2 + 159,x
                sta \2 + 159,x
                tya
                sta \1 + 159,x
                dex
                bne -
                .endm

                .section title_code     ; (runs once: from above where the rest is unpacked to, main.asm)
show            lda #<packed_title      ; the picture, unpacked from the program file to $c000-$ff3f
                sta unpack.src
                lda #>packed_title
                sta unpack.src + 1
                lda #<PIC_SCREEN
                sta unpack.dst
                lda #>PIC_SCREEN
                sta unpack.dst + 1
                lda #$34                ; (all RAM: it runs under the I/O area)
                sta CPU_PORT
                jsr unpack.stream       ; (and back to $35)
                ldx #0
-               lda COLOURS,x           ; (four pages: the last 24 bytes are past the screen, which is all right)
                sta COLOUR_RAM,x
                lda COLOURS + $100,x
                sta COLOUR_RAM + $100,x
                lda COLOURS + $200,x
                sta COLOUR_RAM + $200,x
                lda COLOURS + $300,x
                sta COLOUR_RAM + $300,x
                inx
                bne -
                lda #0                  ; black round it
                sta VIC_BORDER
                sta VIC_BACKGROUND
                lda CIA2_PRA            ; the last bank, $c000-$ffff
                and #%11111100
                sta CIA2_PRA
                lda #$ff                ; port A the keyboard's columns, port B its rows (as the KERNAL left them)
                sta CIA1_DDRA
                lda #0
                sta CIA1_DDRB
                lda #(PIC_SCREEN & $3fff) / $400 * 16 | (BITMAP & $3fff) / $800 * 2
                sta VIC_MEMORY
                lda #$18                ; multicolour
                sta VIC_CTRL2
                lda #$3b                ; a bitmap, shown
                sta VIC_CTRL1
                ldy #BLINK
                ldx #0                  ; 0: waiting for fire to be let go (if it was held to start), 1: pressed
each_frame      lda VIC_RASTER          ; once a frame, below the picture
-               cmp VIC_RASTER
                beq -
                lda VIC_RASTER
                cmp #251
                bne each_frame
                dey
                bne +
                ldy #BLINK
                txa
                pha
                ldx #39
-               lda PIC_SCREEN + TEXT_ROW * 40,x
                eor #$10                ; colour 1: white, or black
                sta PIC_SCREEN + TEXT_ROW * 40,x
                dex
                bpl -
                pla
                tax
+               lda #D_COLUMN           ; D, once a press: the difficulty goes on to the next setting
                sta CIA1_PORT_A
read_keys       lda CIA1_PORT_B
got_keys        and #D_ROW              ; (a test puts what it likes in A here: the emulator has no keys)
                cmp d_was
                beq +
                sta d_was
                cmp #0
                bne +
                jsr turn
+               lda #$ff                ; no column: the joystick alone
                sta CIA1_PORT_A
                lda CIA1_PORT_A         ; fire: the bit low
                and #JOY_FIRE
                bne frame_up
                cpx #0
                beq each_frame          ; held since before: not yet
                lda #$0b                ; pressed: the screen blank, the first bank back
                sta VIC_CTRL1
                lda CIA2_PRA
                ora #%00000011
                sta CIA2_PRA
                rts
frame_up        ldx #1
                bne each_frame

; The other setting: classic and modern in turn, its line (and colour), its riders' colour and speed, and
; their frames, each swapped with the other's.
turn            txa
                pha
                tya
                pha
                lda people.difficulty
                eor #1
                sta people.difficulty
                tax
                lda rider_cols,x
                sta people.rider_col
                lda rider_spds,x
                sta people.rider_spd
                #swap320 SCOOTER_FRAMES, others ; (from line 251: done in the next frame's top border) ...
-               bit VIC_CTRL1           ; ... then the line, once the raster is past it (line 59 on), so that
                bmi -                   ; no frame shows it half swapped
                lda VIC_RASTER
                cmp #60
                bcc -
line_turns      ldx people.difficulty
                lda line_cols,x
                ldx #39
-               sta PIC_SCREEN + LINE_ROW * 40,x
                dex
                bpl -
                #swap320 BITMAP + LINE_ROW * 320, STASH
                pla
                tay
                pla
                tax
                rts

d_was           .byte 0                 ; D_ROW: D not held, as when it was last looked at (0 at first: held from
                                        ; the start, it must be let go first)
rider_cols      .byte people.SKATER, people.SCOOTER     ; by the difficulty: classic, modern
rider_spds      .byte people.SKATE_SPEED, people.SCOOT_SPEED
line_cols       .byte 12 << 4, 7 << 4   ; colour 1 of the line's cells: grey, yellow (tools/picture.mjs)
others          .binary "scooters.bin"  ; the riders the program file does not hold: modern's, then classic's
                .cerror size(others) != 5 * 64, "the riders' frames are not five"
                .send
                .bend
