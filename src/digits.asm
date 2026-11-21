; SPDX-License-Identifier: GPL-2.0-or-later
; Tables for the panel's readout (panel.asm), by tile: its number as two decimal digits, and the digit of the
; nearest crossing. Streets are 12 tiles apart and two tiles wide, so the nearest one is (tile + 5) / 12,
; counted from 1.
tens_ones       .byte (range(MAP_SIZE) / 10) * 16 + range(MAP_SIZE) % 10
crossing_digit  .byte '1' + (range(MAP_SIZE) + 5) / 12
