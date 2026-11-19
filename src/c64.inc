; SPDX-License-Identifier: GPL-2.0-or-later
; Hardware addresses and colours.

CPU_PORT        = $01           ; memory configuration
SCREEN          = $0400         ; 40x25 character codes
COLOUR_RAM      = $d800         ; 40x25 colour nybbles

VIC_CTRL1       = $d011         ; vertical scroll, 25 rows, screen on, raster bit 8
VIC_RASTER      = $d012
VIC_CTRL2       = $d016         ; horizontal scroll, 40 columns, multicolour
VIC_MEMORY      = $d018         ; where the screen and character set are
VIC_BORDER      = $d020
VIC_BACKGROUND  = $d021
VIC_MULTI1      = $d022         ; shared multicolour 1
VIC_MULTI2      = $d023         ; shared multicolour 2

CIA1_PORT_A     = $dc00         ; joystick port 2
CIA1_IRQ        = $dc0d
CIA2_PORT_A     = $dd00         ; bits 0-1 choose the VIC bank
CIA2_IRQ        = $dd0d

BLACK = 0
WHITE = 1
RED = 2
CYAN = 3
PURPLE = 4
GREEN = 5
BLUE = 6
YELLOW = 7
ORANGE = 8
BROWN = 9
LIGHT_RED = 10
DARK_GREY = 11
GREY = 12
LIGHT_GREEN = 13
LIGHT_BLUE = 14
LIGHT_GREY = 15

JOY_UP = 1
JOY_DOWN = 2
JOY_LEFT = 4
JOY_RIGHT = 8
JOY_FIRE = 16
