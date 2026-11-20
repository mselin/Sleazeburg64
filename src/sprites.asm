; SPDX-License-Identifier: GPL-2.0-or-later
; The sprite multiplexer: more things on screen than the video chip has sprites.
;
; Sprite 0 is the player's car, placed as before by car.show. Sprites 1-7 are shared by everything else.
; Each pass of the main loop lists what the next frame shows (add), and plan sorts the list from the top of
; the screen down and hands out sprites 1-7 in turn. The bottom interrupt puts the first seven in place for
; the frame; each one after that takes the sprite of the one seven before it, which has been drawn by then,
; and a raster interrupt rewrites that sprite's registers between the two.
;
; What fits. A sprite whose y register holds y is drawn on lines y+1 to y+21, so its hardware sprite is free
; again from line y+FREE. The interrupt that reuses it can be held up by a bad line and by the other
; sprites' fetches, so its writes are counted as done only by the end of line FREE+LATE_LINES; one that follows
; straight on in the same interrupt is counted as done LATE_LINES lines after the one before it. A sprite that
; reuses another is shown only if its writes are done before its first line is fetched, and by line
; LAST_WRITE, which keeps the multiplexer out of the way of the split's interrupt on line 213. What does not
; fit is left out of that frame. The list is made in a different order each frame (see traffic.show), and
; the sort keeps that order among things on the same line, so when too many are level with each other the
; ones left out take turns: they flicker rather than go missing.
;
; The plan is made for the next frame while the interrupts work through the one shown, so there are two
; buffers, and the bottom interrupt swaps them when it puts a new frame in place.

MAX_SPRITES     = 16                    ; things that can be listed in a frame
FREE            = 22                    ; lines from a sprite's y to when its hardware sprite is free again
LATE_LINES      = 2                     ; lines a reuse's writes can take
LAST_WRITE      = 210                   ; the last line a reuse can be written in

sprites         .block

                .section zp
n               .byte ?                 ; things listed for the next frame
nxt             .byte ?                 ; the buffer the main loop fills: 0 or MAX_SPRITES
next_end        .byte ?                 ; and where its plan ends
cur             .byte ?                 ; the buffer being shown
cur_end         .byte ?
at              .byte ?                 ; the multiplexer interrupt's next entry
ptrs            .word ?                 ; the sprite pointers of the screen being shown
sx              .word ?                 ; add: x (9 bits), y, pointer and colour of the thing to show
sy              .byte ?
sp              .byte ?
sc              .byte ?
i               .byte ?                 ; plan
key             .byte ?
v               .byte ?
o               .byte ?
kept            .byte ?
w               .byte ?
f               .byte ?
hw              .byte ?
                .send

                .section bss
u_y             .fill MAX_SPRITES       ; the list, in the order things were added
u_xl            .fill MAX_SPRITES
u_xh            .fill MAX_SPRITES
u_p             .fill MAX_SPRITES
u_c             .fill MAX_SPRITES
order           .fill MAX_SPRITES       ; the list sorted by y, as indexes into it
b_x             .fill 2 * MAX_SPRITES   ; the plans: x (low 8 bits), y, pointer, colour ...
b_y             .fill 2 * MAX_SPRITES
b_p             .fill 2 * MAX_SPRITES
b_c             .fill 2 * MAX_SPRITES
b_hw            .fill 2 * MAX_SPRITES   ; ... hardware sprite, 1-7 ...
b_hi            .fill 2 * MAX_SPRITES   ; ... its bit in SPRITE_X_HIGH if x is 256 or more, else 0 ...
b_free          .fill 2 * MAX_SPRITES   ; ... and for a reuse, the line its hardware sprite is free from
                .send

init            lda #0
                sta n
                sta nxt
                sta next_end
                sta cur
                sta cur_end
                lda #$f8
                sta ptrs
                rts

; Add a thing to the next frame's list: sx, sy, sp and sc as its sprite registers would be. One too many
; is not listed.
add             ldx n
                cpx #MAX_SPRITES
                bcs +
                lda sy
                sta u_y,x
                lda sx
                sta u_xl,x
                lda sx + 1
                sta u_xh,x
                lda sp
                sta u_p,x
                lda sc
                sta u_c,x
                inc n
+               rts

; Sort the list by y and fill the buffer nxt with the plan for the next frame. Empties the list.
plan            ldx n
                beq sorted
                dex
-               txa                     ; in the order listed ...
                sta order,x
                dex
                bpl -
                lda #1
                sta i
sort_next       lda i                   ; ... then sorted by y, by insertion, keeping that order among equals
                cmp n
                bcs sorted
                tax                     ; x: the gap
                ldy order,x
                sty v
                lda u_y,y
                sta key
-               ldy order - 1,x         ; the one before the gap: after this one?
                lda u_y,y
                cmp key
                beq +
                bcc +
                tya                     ; yes: it moves up into the gap
                sta order,x
                dex
                bne -
+               lda v
                sta order,x
                inc i
                bne sort_next
sorted          lda #0
                sta o
                sta kept
                sta w
                ldx nxt                 ; x: the next entry of the plan
entry           lda o
                cmp n
                bcs done
                inc o
                tay
                lda order,y
                tay                     ; y: the thing
                lda kept
                cmp #7
                bcc first
                lda b_y - 7,x           ; a reuse: of the sprite of the one seven before
                clc
                adc #FREE
                sta f
                cmp w                   ; written once it is free and the one before is written
                bcs +
                lda w
+               clc
                adc #LATE_LINES
                cmp #LAST_WRITE + 1
                bcs entry               ; too near the split: left out
                cmp u_y,y
                bcs entry               ; not in time for its first line: left out
                sta w
                lda f
                sta b_free,x
                lda b_hw - 7,x
                bne fill                ; (1-7)
first           lda #0                  ; one of the first seven: no line to wait for (a reuse's is never 0) ...
                sta b_free,x
                lda kept                ; ... and sprite 1-7
                clc
                adc #1
fill            sta b_hw,x
                sta hw
                lda u_y,y
                sta b_y,x
                lda u_xl,y
                sta b_x,x
                lda u_p,y
                sta b_p,x
                lda u_c,y
                sta b_c,x
                lda u_xh,y
                beq +
                ldy hw
                lda bit_set,y
+               sta b_hi,x
                inx
                inc kept
                bne entry
done            stx next_end
                lda #0
                sta n
                rts

; Bottom interrupt, once it has put the next frame in place: show the sprites of the plan that frame came
; with, and set the next interrupt: a reuse, or the split. In: whether a new frame came, in commit's place
; (the caller has cleared it): carry set if it did.
show_frame      bcc +                   ; a new frame: its plan is shown, and the next plan goes in the other
                lda next_end            ; buffer, empty until one is made
                sta cur_end
                lda nxt
                sta cur
                eor #MAX_SPRITES
                sta nxt
                sta next_end
+               ldy #>(SCREEN_A + $3f8) ; the pointers of the screen the frame shows
                lda frame.cur_d018
                cmp #D018_A
                beq +
                ldy #>(SCREEN_B + $3f8)
+               sty ptrs + 1
                lda frame.cur_sxh       ; sprite 0's x bit 8; put adds the others'
                sta SPRITE_X_HIGH
                lda cur_end             ; how many of sprites 1-7 are used
                sec
                sbc cur
                cmp #8
                bcc +
                lda #7
+               tay
                lda used,y
                ora frame.cur_d015
                sta SPRITE_ON
                ldx cur
-               cpx cur_end
                beq split_next
                lda b_free,x            ; a reuse: that is for the multiplexer's interrupt
                bne mux_next
                jsr put
                inx
                bne -
split_next      lda #<frame.split
                sta $fffe
                lda #>frame.split
                sta $ffff
                lda #SPLIT_LINE
                sta VIC_RASTER
                rts
mux_next        stx at
                sta VIC_RASTER
                lda #<mux
                sta $fffe
                lda #>mux
                sta $ffff
                rts

; Put entry X of the plan shown into its hardware sprite.
put             ldy b_hw,x
                lda b_c,x
                sta SPRITE_COLOUR,y
                lda b_p,x
                sta (ptrs),y
                lda SPRITE_X_HIGH
                and bit_clear,y
                ora b_hi,x
                sta SPRITE_X_HIGH
                lda twice,y
                tay
                lda b_x,x
                sta SPRITE_X,y
                lda b_y,x
                sta SPRITE_Y,y
                rts

; The multiplexer's interrupt: reuse sprites for the entries from at on, as long as each one's sprite is
; free by the next line; then set the interrupt for the next one, or the split's.
mux             pha
                txa
                pha
                tya
                pha
                ldx at
again           lda b_free,x            ; wait until its sprite is free (it usually is)
-               cmp VIC_RASTER
                beq +
                bcs -
+               jsr put
                inx
                cpx cur_end
                beq last
                lda VIC_RASTER          ; the next one: free by the next line?
                clc
                adc #2
                cmp b_free,x
                bcs again
                lda b_free,x            ; no: an interrupt for it
                sta VIC_RASTER
                stx at
                jmp return
last            lda #<frame.split
                sta $fffe
                lda #>frame.split
                sta $ffff
                lda #SPLIT_LINE
                sta VIC_RASTER
return          lda #1
                sta VIC_IRQ
                pla
                tay
                pla
                tax
                pla
                rti

bit_set         .byte 1, 2, 4, 8, 16, 32, 64, 128
bit_clear       .byte $fe, $fd, $fb, $f7, $ef, $df, $bf, $7f
twice           .byte 0, 2, 4, 6, 8, 10, 12, 14
used            .byte 0, 2, 6, 14, 30, 62, 126, 254     ; sprites 1 to n on

                .bend
