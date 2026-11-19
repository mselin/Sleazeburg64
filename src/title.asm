; SPDX-License-Identifier: GPL-2.0-or-later
; Music test build: a title screen that plays a tune and credits it, then starts the game.
;
; This is a separate program wrapped around the game. It holds the title tune at the address the tune was
; written for, and behind it a copy of the game built with MUSIC=1. Fire stops the tune, moves the game down
; to where it runs from and starts it. See music/README.md: the tunes are not ours and builds are not to be
; published.
;
; Build options, set with -D on the command line:
;   AUTOPILOT          1 starts the game by itself after a while, for the emulator test

        .cpu "6502"
        .include "c64.inc"
        .include "tune-title.inc"
        .include "tune-ingame.inc"

game            .block                  ; where things are in the game this program carries
                .include "labels-ingame.txt"
                .bend

                .weak
AUTOPILOT       = 0
                .endweak

LOAD            = $0801
GAME_FILE       = "sleazeburg64-ingame.prg"
CODE_SIZE       = game.code_end - LOAD                  ; the game is code, a gap, then data:
DATA_SIZE       = game.program_end - game.charset       ; the gap is not carried
PAL_FLAG        = $02a6         ; set by the KERNAL at power-on: 1 on a PAL machine. The tune reads it too.
CIA1_DDR_A      = $dc02
VIC_IRQ         = $d019
VIC_IRQ_MASK    = $d01a
AUTO_FRAMES     = 600

from            = $fb           ; zero page the tune leaves alone, used once it has stopped
to              = $fd

; ---------- BASIC line: 2026 SYS start ----------
                * = LOAD
                .word (+), 2026
                .null $9e, format("%d", start)
+               .word 0

start           lda #BLACK
                sta VIC_BORDER
                sta VIC_BACKGROUND
                lda #%00010101          ; screen at $0400, the upper case character ROM
                sta VIC_MEMORY
                ldx #0
-               lda #' '
                sta SCREEN,x
                sta SCREEN + $100,x
                sta SCREEN + $200,x
                sta SCREEN + $300,x
                inx
                bne -

                ldx #size(row_lo) - 1   ; write the lines, last first
                lda #<(text_end - 40)
                sta from
                lda #>(text_end - 40)
                sta from + 1
next_line       lda row_lo,x
                sta to
                sta colour_at + 1
                lda row_hi,x
                sta to + 1
                clc
                adc #>(COLOUR_RAM - SCREEN)
                sta colour_at + 2
                ldy #39
-               lda (from),y
                sta (to),y
                lda row_colour,x
colour_at       sta COLOUR_RAM,y
                dey
                bpl -
                sec
                lda from
                sbc #40
                sta from
                bcs +
                dec from + 1
+               dex
                bpl next_line

                lda PAL_FLAG
                bne +
                ldx #size(ntsc_note) - 1
-               lda ntsc_note,x
                sta SCREEN + 24 * 40,x
                lda #LIGHT_RED
                sta COLOUR_RAM + 24 * 40,x
                dex
                bpl -
+
                lda #title_song
                jsr title_init          ; takes over the interrupts and returns; the tune plays from them
                lda #0                  ; nothing scans the keyboard now, so port A can simply be read
                sta CIA1_DDR_A

.if AUTOPILOT != 0
                ldx #<AUTO_FRAMES
                ldy #>AUTO_FRAMES + 1
-               jsr wait_frame
                dex
                bne -
                dey
                bne -
.else
wait_fire       lda CIA1_PORT_A         ; wait for fire on the joystick in port 2
                and #JOY_FIRE
                bne wait_fire
.endif

                sei                     ; stop the tune: no interrupts from anywhere, and a quiet SID
                lda #$7f
                sta CIA1_IRQ
                sta CIA2_IRQ
                lda CIA1_IRQ
                lda CIA2_IRQ
                lda #0
                sta VIC_IRQ_MASK
                lda #$0f
                sta VIC_IRQ
                ldx #$18
                lda #0
-               sta SID,x
                dex
                bpl -
                lda #$35                ; all RAM but the I/O area, as the game expects
                sta CPU_PORT
                jmp move_game           ; this code is about to be overwritten

.if AUTOPILOT != 0
wait_frame
-               bit VIC_CTRL1
                bmi -
                lda VIC_RASTER
                cmp #251
                bne -
-               lda VIC_RASTER
                cmp #251
                beq -
                rts
.endif

ROWS            = (2, 4, 8, 9, 12, 14, 15, 19)
row_lo          .byte <(SCREEN + ROWS * 40)
row_hi          .byte >(SCREEN + ROWS * 40)
row_colour      .byte YELLOW, LIGHT_RED, WHITE, CYAN, GREY, WHITE, CYAN, YELLOW

centred         .macro text
                .text " " x ((40 - len(\text)) / 2), \text, " " x (40 - len(\text) - (40 - len(\text)) / 2)
                .endm

                .enc "screen"
                #centred "sleazeburg 64"
                #centred "music test build - not for distribution"
                #centred title_credit_title
                #centred title_credit_by
                #centred "then, in the game"
                #centred ingame_credit_title
                #centred ingame_credit_by
                #centred "press fire - joystick in port 2"
text_end
ntsc_note       .text "ntsc machine: written for pal"
                .enc "none"
                .cerror * > title_load, "the title screen has run into its tune"

; ---------- the title tune, where it was written to be ----------
                * = title_load
                .binary "tune-title.bin"

; ---------- the game, waiting to be moved down ----------
image_code      .binary GAME_FILE, 2, CODE_SIZE
image_data      .binary GAME_FILE, 2 + game.charset - LOAD, DATA_SIZE
                ; The copies run upwards, which is safe only when each part moves down in memory.
                .cerror image_data < game.charset, "the game's data would be overwritten while it is moved"

move_game       .cerror * < game.program_end, "this routine would overwrite itself"
                ldx #<image_code
                ldy #>image_code
                stx from
                sty from + 1
                ldx #<LOAD
                ldy #>LOAD
                stx to
                sty to + 1
                ldx #<CODE_SIZE
                ldy #>CODE_SIZE
                jsr copy
                ldx #<image_data
                ldy #>image_data
                stx from
                sty from + 1
                ldx #<game.charset
                ldy #>game.charset
                stx to
                sty to + 1
                ldx #<DATA_SIZE
                ldy #>DATA_SIZE
                jsr copy
                jmp game.start

; Copy Y * 256 + X bytes from (from) to (to), lowest address first.
copy            stx last
                tya
                tax
                ldy #0
                cpx #0
                beq rest
-               lda (from),y            ; whole pages
                sta (to),y
                iny
                bne -
                inc from + 1
                inc to + 1
                dex
                bne -
rest            cpy last                ; and what is left
                beq +
                lda (from),y
                sta (to),y
                iny
                bne rest
+               rts
last            .byte 0
                .cerror * > $a000, "too long for BASIC to load and RUN"
