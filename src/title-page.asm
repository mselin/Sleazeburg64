; SPDX-License-Identifier: GPL-2.0-or-later
; The title page (TITLE=1, the game as it is shipped): the sunset picture from the browser game's title screen
; (mselin/gta-c64, assets/title-sunset.png), with PRESS FIRE TO COMMIT CRIMES blinking under it, until fire.
;
; It is the first thing start does, before anything is unpacked or copied up, so memory is free: the picture
; (tools/picture.mjs: a multicolour bitmap, packed, after the rest of the packed program file) is unpacked to
; the video chip's last bank, its screen at $c000 and its bitmap at $e000, and colour memory is set from it.
; What start does next writes over all of it. The screen is left blank, and the video chip in its first bank.

title_page      .block

PIC_SCREEN      = $c000                 ; where tools/picture.mjs puts it: the screen ...
COLOURS         = PIC_SCREEN + 1000         ; ... what goes in colour memory ...
BITMAP          = $e000                 ; ... and the bitmap
TEXT_ROW        = 24                    ; the character row of PRESS FIRE ..., in colour 1 of its cells
BLINK           = 25                    ; frames on, then off
CIA2_PRA        = $dd00                 ; bits 0-1: the video chip's bank, the other way up

                .section low_more
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
+               lda CIA1_PORT_A         ; fire: the bit low
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
                .send
                .bend
