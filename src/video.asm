; SPDX-License-Identifier: GPL-2.0-or-later
; The city on screen: multicolour characters, two of them by two per tile, scrolled a pixel at a time.
;
; The window shows 38 columns and 161 lines of the city (38-column and 24-row modes hide the partly shown
; characters at the edges). The video chip's fine scroll moves the picture 0-7 pixels. When the window
; crosses a character, the whole screen has to move by one: that is done on a second screen, out of sight,
; by copying the shown one moved by a character and drawing the newly exposed row and column from the map.
; The bottom interrupt then shows the other screen from the next frame on.
;
; Colour memory cannot be doubled like that. Each tile has one colour (see tools/assets.mjs), so after a swap
; colour memory is worked out again from the map, a tile at a time, from the top down, straight after the
; bottom interrupt: it keeps ahead of the video chip, which reads each row's colours on that row's bad line.
; The routines that do it are written at start (see write_colour).
;
; The cost sets the top speed. Moving a screen and drawing its edges takes about a third of a frame and
; working out colour memory about a third, and the car, the panel and the rest have to fit around them, so
; the window can cross at most one character every two frames: 4 pixels a frame, which is how fast the
; browser game's sports car goes. In the frame after a swap the window stays within its character (see
; move_camera).

SCREEN_A        = $3000
SCREEN_B        = $3400
PANEL_SCREEN    = $0400             ; the panel's own: only its rows 21-23 are shown
ROWS            = 21            ; rows of city in each screen; the panel shows rows 21-23 of PANEL_SCREEN
D018_A          = (SCREEN_A & $3fff) / $400 * 16 | (charset & $3fff) / $800 * 2
D018_B          = (SCREEN_B & $3fff) / $400 * 16 | (charset & $3fff) / $800 * 2
D018_PANEL      = (PANEL_SCREEN & $3fff) / $400 * 16 | (charset & $3fff) / $800 * 2

video           .block

                .section zp
front           .byte ?         ; the screen shown: 0 for SCREEN_A, 1 for SCREEN_B
swapped         .byte ?         ; 1 when the frame published last brings in the other screen
edges           .byte ?         ; 1 when that screen still needs the column and row that came into view
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
mp_loop         .word ?
cmap            .word ?         ; colour: the map at the window's top left tile
gx              .byte ?         ; write_colour: the window starts on a tile's second column (1) or first (0)
gy              .byte ?         ; ... and row
across          .byte ?         ; tiles across: 20, or 21 when the window cuts the first and last in half
r               .byte ?
c               .byte ?
nr              .byte ?
nc              .byte ?
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

init            lda #$ff                ; no copy made ahead yet
                sta pre_way
                lda #BLACK
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
                sta PANEL_SCREEN,x
                sta PANEL_SCREEN + $100,x
                sta PANEL_SCREEN + $200,x
                sta PANEL_SCREEN + $300,x
                inx
                bne -
                lda #0                  ; the first picture goes straight onto screen A
                sta front
                sta swapped
                sta edges
                ldx #0
                jsr char_of
                sta cell
                ldx #1
                jsr char_of
                sta cell + 1
                ldx #3                  ; the four colour routines
-               lda colour_lo,x
                sta ptr
                lda colour_hi,x
                sta ptr + 1
                txa
                and #1
                sta gx
                txa
                lsr
                sta gy
                txa
                pha
                jsr write_colour
                pla
                tax
                dex
                bpl -
                jsr write_copies
                lda #>SCREEN_A
                sta target
                jsr draw_all
                jsr colour
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
far             lda #0                  ; further: draw it all, edges included
                sta edges
                jsr draw_all
+               lda front
                eor #1
                sta front
                lda #1
                sta swapped
show            ldx front
                lda d018_of,x
                sta frame.next_d018
                rts

screen_hi       .byte >SCREEN_A, >SCREEN_B, >SCREEN_A  ; the third: "the other one" from B
d018_of         .byte D018_A, D018_B

; The screen that has just come in: its new edges, then colour memory, both from the top down and ahead of
; the video chip. Called straight after the bottom interrupt.
after_swap      lda swapped
                sta busy
                bne +
                rts
+               lda edges
                beq colour
                ldx front
                lda screen_hi,x
                sta target
                jsr draw_edges

; Colour memory for the window at cell: the routine for whether it starts on a tile's first or second column
; and row, with the map from its top left tile.
colour          lda cell + 1
                lsr
                tax
                lda cell
                lsr
                clc
                adc row_lo,x
                sta cmap
                lda row_hi,x
                adc #0
                sta cmap + 1
                lda cell + 1
                and #1
                asl
                sta k
                lda cell
                and #1
                ora k
                tax
                lda colour_lo,x
                sta colour_jump + 1
                lda colour_hi,x
                sta colour_jump + 2
colour_jump     jmp $ffff

; Fill the back screen with the front one moved by dcol and drow. What came into view is drawn once that
; screen is shown, ahead of the video chip (edges), which takes the time out of this frame and puts it in the
; next, which has more to spare.
shift           lda drow                ; which way: (drow + 1) * 3 + dcol + 1
                asl
                clc
                adc drow
                clc
                adc dcol
                clc
                adc #4
                jsr way_of
                ldx front               ; and which screen to which: nine for each
                beq +
                clc
                adc #9
+               tax
                lda #1
                sta edges
                ldy k_first             ; all of it, or what ahead has not copied already
                cpx pre_way
                bne +
                ldy pre_next
+               lda #$ff
                sta pre_way
                cpy k_last
                beq +                   ; (all of it was)
                lda k_last
                jmp part
+               rts


; Draw the column and row that came into view on the screen at target: those the copy left out.
draw_edges      ldx dcol
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

                .section video_more     ; (where there is room: waiting.asm)
; k_first, k_last = the first column of way A's copies (0-8), and the one to stop after; A kept.
way_of          tax
                lda first_col,x
                sta k_first
                lda last_col,x
                sta k_last
                lda row_count,x
                sta k_rows
                txa
                rts

; Run copy X (of the 18) for its columns from Y down, stopping when the next would be column A.
part            sty start_col
                sta stop_col
                lda copy_lo,x
                sta ptr
                lda copy_hi,x
                sta ptr + 1
                ldy #1                  ; ldx #start
                lda start_col
                sta (ptr),y
                lda k_rows              ; cpx #stop: after the start, the rows and dex
                asl
                adc k_rows
                asl
                adc #4
                tay
                lda stop_col
                sta (ptr),y
                jmp (ptr)
                .send

; In the time a frame has left once it has been published: if the window, moving on as far as it just did,
; would cross into the next character in the next pass, the first part of the copy that pass will then need
; (its columns down to HALF), made now on the screen not shown. Only when there is time for it before the
; bottom interrupt, as it goes by the raster, which is all this changes: the copy in that pass does the rest.
.if VIEWER == 0
EAGER           = 24                    ; 1/256 pixel a frame: a little more than the car speeds up by
PRE_BY          = 228                   ; the raster line it is to be done by: a column takes about 6 lines (as
                                        ; the video chip and the interrupts take time too), and it allows 8
ahead           ldx #1
-               sec                     ; the window's step this pass, and where it is now for the next
                lda cam_lo,x
                sbc last_lo,x
                sta step_lo,x
                lda cam_hi,x
                sbc last_hi,x
                sta step_hi,x
                lda cam_lo,x
                sta last_lo,x
                lda cam_hi,x
                sta last_hi,x
                dex
                bpl -
                lda swapped             ; this pass brought in the other screen: the one not shown is still on
                bne no_time             ; until the bottom interrupt
                lda VIC_RASTER          ; time: the line, then bit 8 of it (so 256 is never taken for 0)
                cmp #PRE_BY - 8
                bcs no_time
                sta lines
                lda VIC_CTRL1
                bpl +
no_time         rts
+               ldx #1
-               lda foot.on             ; where the window will be: on foot, as far on again ...
                beq in_car
                clc
                lda cam_lo,x
                adc step_lo,x
                sta guess
                lda cam_hi,x
                adc step_hi,x
                jmp guessed
in_car          ldy vel_of,x            ; ... in the car, following it to where its speed takes it, as
                lda car.vel_x,y         ; follow_car does (at most FOLLOW): the pixel the speed, a little more,
                sta guess               ; takes it into (the guess only says what to get ready); slower than
                lda car.vel_x + 1,y     ; half a pixel a frame, as it may yet stop or turn back, the nearer
                sta guess + 1           ; pixel either side within that reach
                beq forth
                cmp #$ff
                bne quick
                lda guess
                cmp #$80
                bcc quick
                eor #$ff                ; |v| = -v - 1, near enough
                jmp slow
forth           lda guess
                cmp #$80
                bcs quick
slow            clc                     ; slow: |v| and a little more ...
                adc #EAGER
                sta guess
                lda #0
                sta guess + 1
                ldy pos_of,x
                lda car.pos_x,y
                bmi add                 ; ... on, from the further half of the pixel ...
                sec                     ; ... else back
                lda #0
                sbc guess
                sta guess
                lda #$ff
                sta guess + 1
                bne add                 ; (always)
quick           lda guess + 1           ; fast: a little more, the way it goes
                bmi +
                clc
                lda guess
                adc #EAGER
                sta guess
                bcc add
                inc guess + 1
                bcs add                 ; (always)
+               sec
                lda guess
                sbc #EAGER
                sta guess
                bcs add
                dec guess + 1
add             ldy pos_of,x            ; the fraction and that: what carries into the pixel ...
                lda car.pos_x,y
                clc
                adc guess
                lda guess + 1
                sta guess
                and #$80
                beq +
                lda #$ff
+               sta guess + 1
                ldy pos_of,x
                lda car.pos_x + 1,y
                adc guess
                sta guess
                lda car.pos_x + 2,y
                adc guess + 1
                sta guess + 1
                sec                     ; less the centre and the window: how far it would move
                lda guess
                sbc follow_car.centre_lo,x
                sta guess
                lda guess + 1
                sbc follow_car.centre_hi,x
                sta guess + 1
                bpl +                   ; and as follow_car keeps it: no further than the city's edges
                lda #0
                sta guess
                sta guess + 1
+               lda guess
                cmp max_lo,x
                lda guess + 1
                sbc max_hi,x
                bcc +
                lda max_lo,x
                sta guess
                lda max_hi,x
                sta guess + 1
+               sec
                lda guess
                sbc cam_lo,x
                sta guess
                lda guess + 1
                sbc cam_hi,x
                bmi back_off
                bne fore
                lda guess
                cmp #WINDOW_STEP + 1
                bcc +
fore            lda #WINDOW_STEP
                bne +
back_off        cmp #$ff
                bne aft
                lda guess
                cmp #$100 - WINDOW_STEP
                bcs +
aft             lda #$100 - WINDOW_STEP
+               ldy #0                  ; the window there
                cmp #$80
                bcc +
                dey
+               clc
                adc cam_lo,x
                sta guess
                tya
                adc cam_hi,x
guessed         lsr                     ; the character it would be at, less the one it is at: -1, 0 or 1
                ror guess
                lsr
                ror guess
                lsr
                lda guess
                ror
                sec
                sbc cell,x
                clc
                adc #1
                cmp #3
                bcs none                ; (further: drawn afresh, nothing to get ready)
                sta guess_dc,x
                dex
                bmi +
                jmp -
+
                lda guess_dc + 1        ; which way: row * 3 + column
                asl
                adc guess_dc + 1
                adc guess_dc
                cmp #4
                beq none                ; not moving to another character
                jsr way_of
                ldx front
                beq +
                clc
                adc #9
+               tax
                ldy k_first             ; from the first column, or on from where it got to last time
                cpx pre_way
                bne +
                ldy pre_next
                cpy k_last
                beq none                ; (all of it, already)
+               sec                     ; as many columns as there is time for: (PRE_BY - line) / 8
                lda #PRE_BY
                sbc lines
                lsr
                lsr
                lsr
                sta lines
                beq none                ; (no time for a column)
                sty start_col
                sec                     ; the columns left: start - k_last (k_last is 0 or -1)
                tya
                sbc k_last
                cmp lines
                beq +
                bcs ++
+               lda k_last              ; all of them
                jmp ++
+               tya                     ; or n of them
                sec
                sbc lines
+               sta pre_next
                stx pre_way
                ldy start_col
                jmp part
none            rts
pos_of          .byte 0, 3
vel_of          .byte 0, 2
                .section video_more
last_lo         .byte 0, 0              ; where the window was when ahead last looked
last_hi         .byte 0, 0
step_lo         .byte 0, 0
step_hi         .byte 0, 0
guess           .byte 0, 0
lines           .byte 0
guess_dc        .byte 0, 0
                .send
.endif
                .section video_more     ; (not with the variables, for which the build with the most traffic
pre_way         .byte $ff               ; has no room) the copy (of the 18) whose first part ahead has made, or $ff
pre_next        .byte 0                 ; the column the rest of that copy starts from
k_first         .byte 0
k_last          .byte 0
k_rows          .byte 0
start_col       .byte 0
stop_col        .byte 0
                .send

; Where the new screen's characters come from in the old one: 40 * drow + dcol. Each way leaves out the column
; and row that came into view, which are drawn from the map afterwards (draw_edges).
DELTAS          = (-41, -40, -39, -1, 0, 1, 39, 40, 41)
first_col       .byte 39, 39, 38, 39, 39, 38, 39, 39, 38        ; the window moved right: column 39 is new
last_col        .byte 0, $ff, $ff, 0, $ff, $ff, 0, $ff, $ff     ; moved left: column 0 is new (stop at 0, not -1)
first_row       .byte 1, 1, 1, 0, 0, 0, 0, 0, 0                 ; moved up: row 0 is new
row_count       .byte ROWS - 1, ROWS - 1, ROWS - 1, ROWS, ROWS, ROWS, ROWS - 1, ROWS - 1, ROWS - 1

; The copies. Each moves ROWS rows of 40 characters from one screen to the other, from a fixed offset: an
; unrolled run of
;       lda from + 40 * row + delta,x   4 or 5 cycles
;       sta to + 40 * row,x             5
; for each row, in a loop over the 40 columns. What it copies from outside the old screen's city rows lands
; on the edges, which are drawn afresh after it. There are 18 (two screens, nine ways), made at start.
COPIES          = $c400
COPY_SIZE       = 2 + ROWS * 6 + 1 + 2 + 2 + 3 + 1      ; ldx #39, the rows, dex, cpx #stop, beq, jmp, rts
                .cerror COPIES + 18 * COPY_SIZE > $d000, "the copies run into the I/O area"
                .cerror COPIES < SQUARES + 1024, "the copies run into the multiplication tables"
copy_lo         .byte <(COPIES + range(18) * COPY_SIZE)
copy_hi         .byte >(COPIES + range(18) * COPY_SIZE)
delta_lo        .byte <(DELTAS + $10000)
delta_hi        .byte >(DELTAS + $10000)

; Write the 18 copies at COPIES.
write_copies    lda #<COPIES
                sta ptr
                lda #>COPIES
                sta ptr + 1
                lda #0
                sta j                   ; 0: SCREEN_A to SCREEN_B, then 1: the other way
next_pair       lda #0
                sta k                   ; which way, 0-8
next_way        lda j                   ; each in its own place
                asl
                asl
                asl
                adc j                   ; (the carry is clear)
                adc k
                tax
                lda copy_lo,x
                sta ptr
                lda copy_hi,x
                sta ptr + 1
                ldy #0
                lda #$a2                ; ldx: from column 39, or 38 if the new column is 39
                jsr emit
                ldx k
                lda first_col,x
                jsr emit
                ldx j                   ; from: the front screen plus the offset ...
                lda screen_hi,x
                ldx k
                clc
                adc delta_hi,x
                sta src + 1
                lda delta_lo,x
                sta src
                ldx j                   ; ... to the other screen
                lda screen_hi + 1,x
                .cerror d018_of - screen_hi != 3, "write_copies needs screen_hi's third entry"
                sta dst + 1
                lda #0
                sta dst
                ldx k                   ; from row 0, or 1 if the new row is 0
                lda first_row,x
                beq +
                #advance src, 40
                #advance dst, 40
+               lda ptr                 ; the loop starts here
                sta mp_loop
                lda ptr + 1
                sta mp_loop + 1
                ldx k
                lda row_count,x         ; all the rows but a new one
                sta rows_left
-               lda #$bd                ; lda src,x
                jsr emit
                lda src
                jsr emit
                lda src + 1
                jsr emit
                lda #$9d                ; sta dst,x
                jsr emit
                lda dst
                jsr emit
                lda dst + 1
                jsr emit
                #advance src, 40
                #advance dst, 40
                dec rows_left
                bne -
                lda #$ca                ; dex
                jsr emit
                lda #$e0                ; cpx #$ff, or #0 if the new column is 0 (part sets it for each run)
                jsr emit
                ldx k
                lda last_col,x
                jsr emit
                lda #$f0                ; beq +3
                jsr emit
                lda #3
                jsr emit
                lda #$4c                ; jmp loop
                jsr emit
                lda mp_loop
                jsr emit
                lda mp_loop + 1
                jsr emit
                lda #$60                ; rts
                jsr emit
                inc k
                lda k
                cmp #9
                beq +
                jmp next_way
+               inc j
                lda j
                cmp #2
                beq +
                jmp next_pair
+               rts

; Draw every row of the screen at target from the map.
draw_all        lda #$ff                ; (no copy made ahead is any good after this)
                sta pre_way
                lda #0
-               pha
                jsr draw_row
                pla
                clc
                adc #1
                cmp #ROWS
                bne -
                rts

; Draw screen row A of the screen at target from the map. Each tile gives two characters side by side, so
; the loop goes a tile at a time; a row that starts or ends on half a tile does that half on its own.
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
                sta last_left + 2
                pla
                adc #>tile_tr
                sta right + 2
                sta first_right + 2
                ldy #0                  ; Y: the screen column
                sty k
                plp
                bcc pairs
                lda (map_ptr),y         ; starting on a right half: that first, on its own
                tax
first_right     lda tile_tr,x
                sta (ptr),y
                iny
                inc map_ptr
                bne pairs
                inc map_ptr + 1
pairs           sty j
                ldy k
                lda (map_ptr),y         ; a whole tile: two characters
                inc k
                tax
                ldy j
left            lda tile_tl,x           ; tile_tl or tile_bl
                sta (ptr),y
                iny
                cpy #40
                beq +
right           lda tile_tr,x           ; tile_tr or tile_br
                sta (ptr),y
                iny
                cpy #39
                bcc pairs
                bne +
                sty j                   ; one column left: the left half of one more tile
                ldy k
                lda (map_ptr),y
                tax
                ldy j
last_left       lda tile_tl,x
                sta (ptr),y
+               rts

; Draw screen column A of the screen at target from the map. Each tile gives two characters one above the
; other, so the loop goes a tile at a time, writing 40 characters apart.
draw_col        sta ptr
                clc
                adc cell
                lsr                     ; the tile column; carry set for the right halves
                sta k
                lda #>tile_tl
                adc #0
                sta upper + 2           ; tile_tl or tile_tr ...
                sta last_upper + 2
                adc #2
                sta lower + 2           ; ... and two pages on, tile_bl or tile_br
                sta first_lower + 2
                lda target
                sta ptr + 1
                lda cell + 1            ; the tile row of the first character, and where it is on the map
                lsr
                tax
                php                     ; carry: the column starts on a lower half
                lda row_lo,x
                clc
                adc k
                sta map_ptr
                lda row_hi,x
                adc #0
                sta map_ptr + 1
                lda #ROWS
                sta rows_left
                ldy #0
                plp
                bcc col_pairs
                lda (map_ptr),y         ; a lower half on its own first
                tax
first_lower     lda tile_bl,x
                sta (ptr),y
                #advance ptr, 40
                #advance map_ptr, MAP_SIZE
                dec rows_left
col_pairs       lda rows_left
                cmp #2
                bcc col_end
                ldy #0
                lda (map_ptr),y         ; a whole tile: two characters, one under the other
                tax
upper           lda tile_tl,x
                sta (ptr),y
                ldy #40
lower           lda tile_bl,x
                sta (ptr),y
                #advance ptr, 80
                #advance map_ptr, MAP_SIZE
                dec rows_left
                dec rows_left
                jmp col_pairs
col_end         lda rows_left               ; one row left: the upper half of one more tile
                beq +
                ldy #0
                lda (map_ptr),y
                tax
last_upper      lda tile_tl,x
                sta (ptr),y
+               rts

; Colour memory for the city rows, from the map: each tile's colour (tile_colour) in all of its characters on
; screen, row by row from the top, so it keeps ahead of the video chip. A character only shows its colour in
; pixels of value 3, and a tile's characters that have any are drawn in its colour (tools/assets.mjs), so
; this gives every character its own colour. It is the busiest work there is, so it is a straight run of,
; for each tile on screen,
;       iny                     2 cycles (ldy #0 for the first tile in a row)
;       lda (cmap),y            5 or 6
;       tax                     2
;       lda tile_colour,x       4
;       sta COLOUR_RAM + n      4, for each of the tile's characters on screen: up to four
; and cmap moved on by a row of the map between rows of tiles: some 6800 cycles, against 10,500 for working
; it out a character at a time. Which characters each tile covers depends on whether the window starts on a
; tile's first or second column and row, so there are four routines. At 4.2K each they are too much to load,
; so init writes them, into memory the video chip does not need: end to end after the map, where what waits
; in the program file (and a music build's tune) has been copied away by then. Starting on a tile's second
; column, a routine has 21 tiles across, else 20.
COLOUR_SIZE     = 11 * 2 + 10 * 11 + 21 * 11 * 7 - 11 + ROWS * 40 * 3 + 1      ; 21 tiles across
COLOUR_SIZE_20  = 11 * 2 + 10 * 11 + 20 * 11 * 7 - 11 + ROWS * 40 * 3 + 1      ; 20
COLOUR_11       = $6d00                 ; second column, second row
COLOUR_00       = COLOUR_11 + COLOUR_SIZE       ; the window starts on a tile's first column and row
COLOUR_10       = COLOUR_00 + COLOUR_SIZE_20    ; second column, first row
COLOUR_01       = COLOUR_10 + COLOUR_SIZE       ; first column, second row
COLOUR_END      = COLOUR_01 + COLOUR_SIZE_20
                .cerror COLOUR_END > SQUARES2, "the colour routines run into multiplication tables"
                .cerror map_end > COLOUR_11, "no room after the map"
                .cerror (tile_colour & $ff) != 0, "tile_colour must start a page"
colour_lo       .byte <COLOUR_00, <COLOUR_10, <COLOUR_01, <COLOUR_11
colour_hi       .byte >COLOUR_00, >COLOUR_10, >COLOUR_01, >COLOUR_11

; Write the colour routine for a window starting on a tile's column gx and row gy (0 for the first, 1 for
; the second), at ptr. Y stays 0, for emit.
write_colour    ldy #0
                lda gx
                clc
                adc #20
                sta across
                lda #0
                sta j                   ; row of tiles
tile_row        lda j
                beq +
                ldx #0                  ; after the first: on to the next row of the map
-               lda next_row,x
                jsr emit
                inx
                cpx #size(next_row)
                bne -
+               lda #$a0                ; ldy #0
                jsr emit
                tya
                jsr emit
                sta k                   ; tile in the row
tile_col        lda k
                beq +
                lda #$c8                ; iny
                jsr emit
+               ldx #0                  ; its colour
-               lda read_tile,x
                jsr emit
                inx
                cpx #size(read_tile)
                bne -
                lda j                   ; into its characters: rows 2j - gy and the next ...
                asl
                sec
                sbc gy
                sta r
                lda #2
                sta nr
each_row        lda r
                cmp #ROWS
                bcs no_row              ; (-1 is 255)
                tax
                lda k                   ; ... and columns 2k - gx and the next
                asl
                sec
                sbc gx
                sta c
                lda #2
                sta nc
each_col        lda c
                cmp #40
                bcs no_col
                lda #$8d                ; sta COLOUR_RAM + 40 * r + c
                jsr emit
                lda c
                clc
                adc row40_lo,x
                jsr emit
                lda row40_hi,x
                adc #>COLOUR_RAM
                jsr emit
no_col          inc c
                dec nc
                bne each_col
no_row          inc r
                dec nr
                bne each_row
                inc k
                lda k
                cmp across
                bne tile_col
                inc j
                lda j
                cmp #(ROWS + 1) / 2
                beq +
                jmp tile_row
+               lda #$60                ; rts
                jmp emit
next_row        .byte $18, $a5, <cmap, $69, MAP_SIZE, $85, <cmap, $90, $02, $e6, <cmap + 1  ; cmap += MAP_SIZE
read_tile       .byte $b1, <cmap, $aa, $bd, <tile_colour, >tile_colour  ; lda (cmap),y : tax : lda tile_colour,x
                .cerror (<COLOUR_RAM) != 0, "write_colour expects colour memory to start a page"

emit            sta (ptr),y
                inc ptr
                bne +
                inc ptr + 1
+               rts

row40_lo        .byte <(range(ROWS) * 40)
row40_hi        .byte >(range(ROWS) * 40)
; Where each row of the map starts.
row_lo          .byte <(city_map + range(MAP_SIZE) * MAP_SIZE)
row_hi          .byte >(city_map + range(MAP_SIZE) * MAP_SIZE)

                .bend
