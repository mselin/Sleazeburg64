; SPDX-License-Identifier: GPL-2.0-or-later
; Joystick in port 2.

input           .block

; Out: A = JOY_ bits, set while held.
read
.if AUTOPILOT != 0
                ; Emulator test: head down and right for a while, then stop, so a screenshot can be compared.
                lda steps_left
                beq +
                dec steps_left
                lda #JOY_RIGHT | JOY_DOWN
                rts
+               lda #0
                rts
steps_left      .byte 120
.else
                lda CIA1_PORT_A
                eor #$ff                ; the port reads 0 for a closed switch
                and #JOY_UP | JOY_DOWN | JOY_LEFT | JOY_RIGHT | JOY_FIRE
                rts
.endif
                .bend
