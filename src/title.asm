; SPDX-License-Identifier: GPL-2.0-or-later
; Music test build: a title screen that plays a tune and credits it, then starts the game.
;
; This is a separate program wrapped around the game. It holds the title tune at the address the tune was
; written for, $1000-$5150, which is right across the game's memory: the title screen's own code comes before
; the tune, and a copy of the game built with MUSIC=1 waits after it. Fire stops the tune, moves the game
; down to where it runs from and starts it. See music/README.md: the tunes are not ours and builds are not to
; be published.
;
; It is all one file, which LOAD and RUN take as far as $cfff, past the end of BASIC's memory at $a000. That
; works because the program starts at once with SYS and never asks BASIC for a variable, and it is the only
; way to test it here: the open-source ROMs the emulator tests use cannot load a second file from a disk.
; The part from $a000 lies under the BASIC ROM, so the routine that moves the game runs with the ROMs out.
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
GAME_CODE       = $080d                                 ; after the game's BASIC line, which is not needed
GAME_FILE       = "sleazeburg64-ingame.prg"
CODE_SIZE       = game.code_end - GAME_CODE             ; the game is code, a gap, then data:
DATA_SIZE       = game.program_end - game.charset       ; the gap is not carried, and the map is carried packed
BEFORE_MAP      = game.city_map - game.charset
AFTER_MAP       = game.program_end - game.map_end
MAP_RUN         = 255                                   ; in the packed map: a run (tools/assets.mjs)
LOAD_LIMIT      = $d000                                 ; LOAD stops at the I/O area
PAL_FLAG        = $02a6         ; set by the KERNAL at power-on: 1 on a PAL machine. The tune reads it too.
CIA1_DDR_A      = $dc02
AUTO_FRAMES     = 600

from            = $fb           ; zero page the tune leaves alone, used once it has stopped
to              = $fd

; ---------- BASIC line: 2026 SYS start ----------
                * = LOAD
                .word (+), 2026
                .null $9e, format("%d", start)
+               .word 0

; ---------- the title screen ----------
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
image_code      .binary GAME_FILE, 2 + GAME_CODE - LOAD, CODE_SIZE
image_data      .binary GAME_FILE, 2 + game.charset - LOAD, BEFORE_MAP
image_map       .binary "map-packed.bin"
image_rest      .binary GAME_FILE, 2 + game.map_end - LOAD, AFTER_MAP
                ; The copies run upwards, which is safe only when each part moves down in memory. The map
                ; is unpacked into place upwards, and ends before its packed copy starts.
                .cerror image_data < game.charset, "the game's data would be overwritten while it is moved"
                .cerror image_map < game.map_end, "the packed map would be overwritten while it is unpacked"
                .cerror image_rest < game.map_end, "the game's data would be overwritten while it is moved"

; Runs with the ROMs out (the title screen switches them before it jumps here), so it can be under BASIC's.
move_game       .cerror * < game.program_end, "this routine would overwrite itself"
                ldx #<image_code
                ldy #>image_code
                stx from
                sty from + 1
                ldx #<GAME_CODE
                ldy #>GAME_CODE
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
                ldx #<BEFORE_MAP
                ldy #>BEFORE_MAP
                jsr copy
                ldx #<image_map
                ldy #>image_map
                stx from
                sty from + 1
                ldx #<game.city_map
                ldy #>game.city_map
                stx to
                sty to + 1
                jsr unpack
                ldx #<image_rest
                ldy #>image_rest
                stx from
                sty from + 1
                ldx #<game.map_end
                ldy #>game.map_end
                stx to
                sty to + 1
                ldx #<AFTER_MAP
                ldy #>AFTER_MAP
                jsr copy
                jmp game.start

; Unpack the map from (from) to (to), up to the end of the map.
unpack          ldy #0
-               lda to + 1
                cmp #>game.map_end
                bne +
                lda to
                cmp #<game.map_end
                beq unpacked
+               jsr get
                cmp #MAP_RUN
                bne one
                jsr get                 ; how many
                tax
                jsr get                 ; of which tile
-               jsr put
                dex
                bne -
                beq --
one             jsr put
                jmp --
unpacked        rts
get             lda (from),y
                inc from
                bne +
                inc from + 1
+               rts
put             sta (to),y
                inc to
                bne +
                inc to + 1
+               rts

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
                .cerror * > LOAD_LIMIT, "too long to LOAD: the I/O area starts at $d000"
