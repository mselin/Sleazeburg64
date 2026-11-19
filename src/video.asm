; SPDX-License-Identifier: GPL-2.0-or-later
; The screen: multicolour character mode, with the city drawn two characters by two per tile.

video           .block

                .section zp
map_ptr         .word ?         ; the map row being drawn, already offset to the left edge of the view
upper           .word ?         ; screen row for the top halves of the tiles
lower           .word ?         ; and the row below, for the bottom halves
upper_colour    .word ?
lower_colour    .word ?
column          .byte ?
rows_left       .byte ?
                .send

init            lda #BLACK
                sta VIC_BORDER
                lda #DARK_GREY          ; value 0 in a tile character: asphalt
                sta VIC_BACKGROUND
                lda #LIGHT_GREY         ; value 1: pavement and highlights
                sta VIC_MULTI1
                lda #BLACK              ; value 2: outlines
                sta VIC_MULTI2
                lda CIA2_PORT_A         ; VIC sees the first 16K
                and #%11111100
                ora #%00000011
                sta CIA2_PORT_A
                lda #%00011110          ; screen at $0400, character set at $3800
                sta VIC_MEMORY
                lda #%11011000          ; multicolour, 40 columns, no horizontal scroll
                sta VIC_CTRL2
                lda #%00011011          ; screen on, 25 rows, no vertical scroll
                sta VIC_CTRL1
                ldx #0
                lda #' '
-               sta SCREEN,x
                sta SCREEN + $100,x
                sta SCREEN + $200,x
                sta SCREEN + $300,x
                inx
                bne -
                rts

; Wait for the raster to reach the bottom border. Called once per frame from the main loop.
wait_frame
-               bit VIC_CTRL1           ; not while raster bit 8 is set (lines 256 and up)
                bmi -
                lda VIC_RASTER
                cmp #251
                bne -
-               lda VIC_RASTER          ; and let the line pass, so one frame is not counted twice
                cmp #251
                beq -
                rts

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

; Draw the whole view from cam_x, cam_y. About a frame's worth of work, done all at once for now.
draw            ldx cam_y
                clc
                lda row_lo,x
                adc cam_x
                sta map_ptr
                lda row_hi,x
                adc #0
                sta map_ptr + 1
                lda #<SCREEN
                sta upper
                lda #>SCREEN
                sta upper + 1
                lda #<(SCREEN + 40)
                sta lower
                lda #>(SCREEN + 40)
                sta lower + 1
                lda #<COLOUR_RAM
                sta upper_colour
                lda #>COLOUR_RAM
                sta upper_colour + 1
                lda #<(COLOUR_RAM + 40)
                sta lower_colour
                lda #>(COLOUR_RAM + 40)
                sta lower_colour + 1
                lda #VIEW_H
                sta rows_left

tile_row        lda #0
                sta column
next_tile       ldy column
                lda (map_ptr),y         ; which tile
                tax
                tya
                asl                     ; each tile is two characters wide
                tay
                lda tile_tl,x
                sta (upper),y
                lda tile_bl,x
                sta (lower),y
                lda tile_colour,x
                sta (upper_colour),y
                sta (lower_colour),y
                iny
                lda tile_tr,x
                sta (upper),y
                lda tile_br,x
                sta (lower),y
                lda tile_colour,x
                sta (upper_colour),y
                sta (lower_colour),y
                inc column
                lda column
                cmp #VIEW_W
                bne next_tile

                #advance map_ptr, MAP_SIZE
                #advance upper, 80
                #advance lower, 80
                #advance upper_colour, 80
                #advance lower_colour, 80
                dec rows_left
                bne tile_row
                rts

; Where each row of the map starts.
row_lo          .byte <(city_map + range(MAP_SIZE) * MAP_SIZE)
row_hi          .byte >(city_map + range(MAP_SIZE) * MAP_SIZE)

                .bend
