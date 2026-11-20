; SPDX-License-Identifier: GPL-2.0-or-later
; The city on screen: multicolour characters, two of them by two per tile, scrolled a pixel at a time.
;
; The window shows 38 columns and 161 lines of the city (38-column and 24-row modes hide the partly shown
; characters at the edges). The video chip's fine scroll moves the picture 0-7 pixels. When the window
; crosses a character, the whole screen has to move by one: that is done on a second screen, out of sight,
; by copying the shown one moved by a character and drawing the newly exposed row and column from the map.
; The bottom interrupt then shows the other screen from the next frame on.
;
; Colour memory cannot be doubled like that. Each character has one colour (see tools/assets.mjs), so after a
; swap colour memory is worked out again from the new screen, from the top down, straight after the bottom
; interrupt: it keeps ahead of the video chip, which reads each row's colours on that row's bad line.
;
; The cost sets the top speed. Moving a screen and drawing its edges takes about a third of a frame and
; working out colour memory about two thirds, so the window can cross at most one character every two
; frames: 4 pixels a frame, which is how fast the browser game's sports car goes. In the frame after a swap
; the window stays within its character (see move_camera).

SCREEN_A        = $3000
SCREEN_B        = $3400
ROWS            = 21            ; rows of city in each screen. Rows 21-23 are the panel, the same in both.
D018_A          = (SCREEN_A & $3fff) / $400 * 16 | (charset & $3fff) / $800 * 2
D018_B          = (SCREEN_B & $3fff) / $400 * 16 | (charset & $3fff) / $800 * 2

video           .block

                .section zp
front           .byte ?         ; the screen shown: 0 for SCREEN_A, 1 for SCREEN_B
swapped         .byte ?         ; 1 when the frame published last brings in the other screen
target          .byte ?         ; high byte of the screen being drawn
new_cell        .byte ?, ?
dcol            .byte ?         ; how far the window moved, in characters: -1, 0 or 1 (more: redraw)
drow            .byte ?
ptr             .word ?
map_ptr         .word ?
src             .word ?
dst             .word ?
city_row        .byte ?         ; the row of characters in the city that is being drawn
rows_left       .byte ?
k               .byte ?         ; tile in the map row
j               .byte ?         ; screen column
colour_from     .byte ?         ; which screen `colour` reads: 0 for SCREEN_A, 1 for SCREEN_B
                .send

; Add an 8-bit constant to a 16-bit zero page pointer.
advance         .macro pointer, amount
                clc
                lda \pointer
                adc #\amount
                sta \pointer
                bcc +
                inc \pointer + 1
+
                .endm

init            lda #BLACK
                sta VIC_BORDER
                lda #DARK_GREY          ; value 0 in a tile character: asphalt
                sta VIC_BACKGROUND
                lda #LIGHT_GREY         ; value 1: pavement and highlights
                sta VIC_MULTI1
                lda #BLACK              ; value 2: outlines
                sta VIC_MULTI2
                lda CIA2_PORT_A         ; the video chip sees the first 16K
                and #%11111100
                ora #%00000011
                sta CIA2_PORT_A
                ldx #0
                lda #' '
-               sta SCREEN_A,x
                sta SCREEN_A + $100,x
                sta SCREEN_A + $200,x
                sta SCREEN_A + $300,x
                sta SCREEN_B,x
                sta SCREEN_B + $100,x
                sta SCREEN_B + $200,x
                sta SCREEN_B + $300,x
                inx
                bne -
                lda #0                  ; the first picture goes straight onto screen A
                sta front
                sta swapped
                ldx #0
                jsr char_of
                sta cell
                ldx #1
                jsr char_of
                sta cell + 1
                lda #>SCREEN_A
                sta target
                jsr draw_all
                lda #0                  ; `colour` is assembled to read SCREEN_A
                sta colour_from
                jsr colour
                ldx #1                  ; the next screen to colour will be SCREEN_B
                jsr point_colour
                jsr fine
                lda frame.next_d011
                sta frame.cur_d011
                lda frame.next_d016
                sta frame.cur_d016
                lda #D018_A
                sta frame.cur_d018
                sta frame.next_d018
                jmp frame.init

; The fine scroll for the window's position. Scrolling the picture right by 7 - n shows it from pixel n.
fine            lda cam_lo
                and #7
                eor #7
                ora #CITY_D016
                sta frame.next_d016
                lda cam_lo + 1
                and #7
                eor #7
                ora #CITY_D011
                sta frame.next_d011
                rts

; Get the next frame ready for where the window is now: fine scroll, and the other screen if the window has
; moved to another character.
follow          jsr fine
                lda #0
                sta swapped
                ldx #0
                jsr char_of
                sta new_cell
                sec
                sbc cell
                sta dcol
                ldx #1
                jsr char_of
                sta new_cell + 1
                sec
                sbc cell + 1
                sta drow
                ora dcol
                beq show
                lda new_cell
                sta cell
                lda new_cell + 1
                sta cell + 1
                lda front
                eor #1
                tax
                lda screen_hi,x
                sta target
                lda dcol                ; one character at most each way: move the picture over
                clc
                adc #1
                cmp #3
                bcs far
                lda drow
                clc
                adc #1
                cmp #3
                bcs far
                jsr shift
                jmp +
far             jsr draw_all            ; further: draw it all
+               lda front
                eor #1
                sta front
                lda #1
                sta swapped
show            ldx front
                lda d018_of,x
                sta frame.next_d018
                rts

screen_hi       .byte >SCREEN_A, >SCREEN_B
d018_of         .byte D018_A, D018_B

; Colour memory for the screen that has just come in. Called straight after the bottom interrupt.
after_swap      lda swapped
                sta busy
                beq +
                jsr colour
                lda front               ; screens take turns, so the next one to colour is the other
                eor #1
                tax
                jmp point_colour
+               rts

; Fill the back screen with the front one moved by dcol and drow, then draw what came into view.
shift           lda drow                ; which way: (drow + 1) * 3 + dcol + 1
                asl
                clc
                adc drow
                clc
                adc dcol
                clc
                adc #4
                tay
                lda delta_lo,y
                sta src
                ldx front
                lda screen_hi,x
                clc
                adc delta_hi,y
                sta src + 1
                lda #0
                sta dst
                lda target
                sta dst + 1
                jsr copy
                ldx dcol
                beq +
                lda #0
                cpx #1
                bne edge_col
                lda #39
edge_col        jsr draw_col
+               ldx drow
                beq +
                lda #0
                cpx #1
                bne edge_row
                lda #ROWS - 1
edge_row        jmp draw_row
+               rts

; Where the new screen's characters come from in the old one: 40 * drow + dcol.
DELTAS          = (-41, -40, -39, -1, 0, 1, 39, 40, 41)
delta_lo        .byte <(DELTAS + $10000)
delta_hi        .byte >(DELTAS + $10000)

; Copy ROWS rows of 40 characters from src to dst. The loop is unrolled over the rows and the addresses are
; written into it first. What it copies from outside the old screen's city rows lands on the edges, which
; are drawn afresh after it.
copy            lda #<(body + 1)
                sta ptr
                lda #>(body + 1)
                sta ptr + 1
                ldx #ROWS
-               ldy #0
                lda src
                sta (ptr),y
                iny
                lda src + 1
                sta (ptr),y
                ldy #3
                lda dst
                sta (ptr),y
                iny
                lda dst + 1
                sta (ptr),y
                #advance src, 40
                #advance dst, 40
                #advance ptr, 6
                dex
                bne -
                ldx #39
body
                .rept ROWS
                lda $ffff,x
                sta $ffff,x
                .endrept
                dex
                bmi +
                jmp body
+               rts

; Draw every row of the screen at target from the map.
draw_all        lda #0
-               pha
                jsr draw_row
                pla
                clc
                adc #1
                cmp #ROWS
                bne -
                rts

; Draw screen row A of the screen at target from the map.
draw_row        tax
                lda row40_lo,x
                sta ptr
                lda row40_hi,x
                clc
                adc target
                sta ptr + 1
                txa
                clc
                adc cell + 1
                sta city_row
                lsr
                tax                     ; the tile row
                lda cell
                lsr                     ; the tile column; carry set when the row starts on a right half
                php
                clc
                adc row_lo,x
                sta map_ptr
                lda row_hi,x
                adc #0
                sta map_ptr + 1
                lda city_row            ; upper or lower halves of the tiles: tile_bl is two pages on
                and #1
                asl
                pha
                adc #>tile_tl
                sta left + 2
                pla
                adc #>tile_tr
                sta right + 2
                lda #0
                sta k
                tay
                plp
                bcs right_half
left_half       sty j
                ldy k
                lda (map_ptr),y
                tax
                ldy j
left            lda tile_tl,x           ; tile_tl or tile_bl
                sta (ptr),y
                iny
                cpy #40
                beq +
right_half      sty j
                ldy k
                lda (map_ptr),y
                tax
                ldy j
right           lda tile_tr,x           ; tile_tr or tile_br
                sta (ptr),y
                inc k
                iny
                cpy #40
                bne left_half
+               rts

; Draw screen column A of the screen at target from the map.
draw_col        sta j
                sta ptr
                lda target
                sta ptr + 1
                lda j
                clc
                adc cell
                lsr                     ; the tile column; carry set for the right halves
                sta k
                lda #>tile_tl
                adc #0
                sta upper + 2           ; tile_tl or tile_tr ...
                adc #2
                sta lower + 2           ; ... and two pages on, tile_bl or tile_br
                lda cell + 1
                sta city_row
                lda #ROWS
                sta rows_left
-               lda city_row
                lsr
                tax
                lda row_lo,x
                clc
                adc k
                sta map_ptr
                lda row_hi,x
                adc #0
                sta map_ptr + 1
                ldy #0
                lda (map_ptr),y
                tax
                lda city_row
                lsr
                bcs lower
upper           lda tile_tl,x
                jmp +
lower           lda tile_bl,x
+               sta (ptr),y
                #advance ptr, 40
                inc city_row
                dec rows_left
                bne -
                rts

; Colour memory for the city rows from the screen in front: each character's colour from char_colour. Row
; by row from the top, ten columns at a time, so it keeps ahead of the video chip. The loop is unrolled for
; speed and assembled to read SCREEN_A; point_colour turns it to the other screen by changing the high bytes
; of its addresses, rather than the program carrying a second copy (the music test build has no room for
; one). That is done straight after colouring, in the frame that has time to spare, for the next swap.
colour
                .for r := 0, r < ROWS, r += 1
                ldx #9
-
                .for c := 0, c < 40, c += 10
                ldy SCREEN_A + 40 * r + c,x
                lda char_colour,y
                sta COLOUR_RAM + 40 * r + c,x
                .next
                dex
                bpl -
                .next
                rts
COLOUR_ROW      = 2 + 4 * 9 + 3                 ; bytes of code per row: ldx, four lots of three, dex and bpl
                .cerror * - colour != ROWS * COLOUR_ROW + 1, "point_colour expects a different layout of colour"

; Make `colour` read screen X (0 for SCREEN_A, 1 for SCREEN_B).
point_colour    cpx colour_from
                beq pointed
                stx colour_from
                lda #<(colour + 4)      ; the high byte of the first ldy's address
                sta ptr
                lda #>(colour + 4)
                sta ptr + 1
                ldx #ROWS
next_row        ldy #0
-               lda (ptr),y
                eor #>(SCREEN_A ^ SCREEN_B)
                sta (ptr),y
                tya
                clc
                adc #9
                tay
                cpy #4 * 9
                bne -
                #advance ptr, COLOUR_ROW
                dex
                bne next_row
pointed         rts

row40_lo        .byte <(range(ROWS) * 40)
row40_hi        .byte >(range(ROWS) * 40)
; Where each row of the map starts.
row_lo          .byte <(city_map + range(MAP_SIZE) * MAP_SIZE)
row_hi          .byte >(city_map + range(MAP_SIZE) * MAP_SIZE)

                .bend
