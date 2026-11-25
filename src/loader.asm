; SPDX-License-Identifier: GPL-2.0-or-later
; The loader, first on the disk (build/sleazeburg64.d64, `make disk`): the sunset picture saying LOADING while
; it loads the game, the next file on the disk, then starts it, and the game shows the same picture to say
; PRESS FIRE (title-page.asm).
;
; LOAD"*",8,1 and RUN start this. It moves its own code up to $be00, where neither the game's file nor the
; picture reaches (it runs there with the BASIC ROM switched out, the KERNAL in), unpacks the picture (tools/picture.mjs) to the video chip's last bank, $c000 and $e000, as the title page
; does, shows it, and asks the KERNAL to load the game from the same drive, as LOAD would. The game's file
; ends well below $c000, so the picture stays on the screen all the while, and the game's title page then
; unpacks the same picture over it, with its own words.
;
; If the game cannot be loaded (no such file, a drive error), the border goes red and it stops there.

        .cpu "6502"
        .include "c64.inc"

game            .block                  ; where things are in the game: its start, and where its file ends
                .include "labels.txt"
                .bend

LOAD_AT         = $0801
HOME            = $be00                 ; where its code runs: clear of the game's file and of the picture
PIC_SCREEN      = $c000                 ; the picture, as tools/picture.mjs lays it out: screen ...
COLOURS         = PIC_SCREEN + 1000     ; ... what goes in colour memory ...
BITMAP          = $e000                 ; ... and the bitmap
CIA2_PRA        = $dd00                 ; bits 0-1: the video chip's bank, the other way up
SETLFS          = $ffba                 ; the KERNAL's
SETNAM          = $ffbd
LOAD            = $ffd5
LAST_DEVICE     = $ba                   ; the drive this was loaded from
src             = $fb                   ; zero page BASIC and the KERNAL leave alone
dst             = $fd
ref             = $22                   ; (BASIC's, which is not used again)

                .cerror game.file_end > HOME, "the game's file would load over the loader"

; ---------- BASIC line: 2026 SYS start ----------
                * = LOAD_AT
                .word (+), 2026
                .null $9e, format("%d", start)
+               .word 0

start           sei
                ldx #0                  ; its code up to HOME
-               lda home_image,x
                sta HOME,x
                lda home_image + $100,x
                sta HOME + $100,x
                inx
                bne -
                .cerror home_end > PIC_SCREEN, "the loader's code is more than two pages"
                lda #$36                ; BASIC out: the code is under it
                sta CPU_PORT
                jmp show

home_image
                .logical HOME
show            lda #<packed_picture    ; the picture, unpacked to $c000-$ff3f
                sta src
                lda #>packed_picture
                sta src + 1
                lda #<PIC_SCREEN
                sta dst
                lda #>PIC_SCREEN
                sta dst + 1
                lda #$34                ; all RAM: it runs under the I/O area and the ROMs
                sta CPU_PORT
                ldy #0
next            jsr get                 ; tools/pack.mjs's tokens, as unpack in main.asm reads them
                cmp #$ff
                beq unpacked
                cmp #$80
                bcs match
                tax                     ; n + 1 bytes as they are
                inx
-               jsr get
                jsr put
                dex
                bne -
                beq next
match           sbc #$80 - 3            ; (C is set) n - $80 + 3 bytes from earlier
                tax
                jsr get
                sta ref
                jsr get
                sta ref + 1
                sec
                lda dst
                sbc ref
                sta ref
                lda dst + 1
                sbc ref + 1
                sta ref + 1
-               lda (ref),y
                jsr put
                inc ref
                bne +
                inc ref + 1
+               dex
                bne -
                beq next
unpacked        lda #$36                ; the KERNAL back, for its LOAD (BASIC stays out: this is under it)
                sta CPU_PORT
                ldx #0
-               lda COLOURS,x
                sta COLOUR_RAM,x
                lda COLOURS + $100,x
                sta COLOUR_RAM + $100,x
                lda COLOURS + $200,x
                sta COLOUR_RAM + $200,x
                lda COLOURS + $300,x
                sta COLOUR_RAM + $300,x
                inx
                bne -
                lda #BLACK
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
                cli                     ; (the KERNAL's interrupt: its screen at $0400 is not the one shown)
loading         lda #size(name)         ; the game, from the drive this came from, to where its file says
                ldx #<name
                ldy #>name
                jsr SETNAM
                lda #1
                ldx LAST_DEVICE
                cpx #8                  ; (if that is not a drive, as when the emulator puts it in memory: 8)
                bcs +
                ldx #8
+               ldy #1
                jsr SETLFS
                lda #0
                jsr LOAD
                bcs failed
loaded          sei
                jmp game.start
failed          lda #RED
                sta VIC_BORDER
-               jmp -

get             lda (src),y
                inc src
                bne +
                inc src + 1
+               rts
put             sta (dst),y
                inc dst
                bne +
                inc dst + 1
+               rts
name            .text "game"              ; (--ascii: lower case here is PETSCII's plain letters, as c1541 names it)
home_end
                .endlogical

packed_picture  .binary "loading.bin"   ; the picture saying LOADING (tools/picture.mjs), packed
                .cerror * > PIC_SCREEN, "the loader's picture runs into where it is unpacked to"
