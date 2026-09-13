@ Generated from Fairy_LimitAdjust.s for clean US Black 2 (IREO).

.thumb

.equ TypeCnt, 0x12
.equ NewTagStart, 0x20

.type THUMB_BRANCH_LINK_255_0x21CF534, %function

@ BluRose's PC screen fix
FULL_COPY_255_0x21C2A10:
    .word 0xA700
    .size FULL_COPY_255_0x21C2A10, . - FULL_COPY_255_0x21C2A10

FULL_COPY_255_0x21D0806:
    cmp r4, #TypeCnt
    .size FULL_COPY_255_0x21D0806, . - FULL_COPY_255_0x21D0806

FULL_COPY_255_0x21D096C:
    .word 0xA5BC
    .size FULL_COPY_255_0x21D096C, . - FULL_COPY_255_0x21D096C

FULL_COPY_255_0x21D09C0:
    add r1, #NewTagStart
    .size FULL_COPY_255_0x21D09C0, . - FULL_COPY_255_0x21D09C0

FULL_COPY_255_0x21D09CA:
    cmp r4, #TypeCnt
    .size FULL_COPY_255_0x21D09CA, . - FULL_COPY_255_0x21D09CA

THUMB_BRANCH_LINK_255_0x21CF534:
    push {r2-r3, lr}
    ldr r1, =0xA0DC
    add r2, r1
    sub r2, r4
    ldr r3, =0xA268
    cmp r2, r3
    blt keep_r1_A0DC
    ldr r3, =0xA2AC
    cmp r2, r3
    bhi keep_r1_A0DC
    ldr r1, =0xA5BC-0x18C
keep_r1_A0DC:
    ldr r0, =0x9E94
    pop {r2-r3, pc}
   .size THUMB_BRANCH_LINK_255_0x21CF534, . - THUMB_BRANCH_LINK_255_0x21CF534
 
FULL_COPY_255_0x21BF2B0:
    mov r4, #NewTagStart
    .size FULL_COPY_255_0x21BF2B0, . - FULL_COPY_255_0x21BF2B0

FULL_COPY_255_0x21BF2C0:
    cmp r4, #(NewTagStart + TypeCnt)
    .size FULL_COPY_255_0x21BF2C0, . - FULL_COPY_255_0x21BF2C0

FULL_COPY_255_0x21D0A2E:
    mov r4, #NewTagStart
    .size FULL_COPY_255_0x21D0A2E, . - FULL_COPY_255_0x21D0A2E

FULL_COPY_255_0x21D0A3E:
    cmp r4, #(NewTagStart + TypeCnt)
    .size FULL_COPY_255_0x21D0A3E, . - FULL_COPY_255_0x21D0A3E

FULL_COPY_255_0x21D09E2:
    add r7, #NewTagStart
    .size FULL_COPY_255_0x21D09E2, . - FULL_COPY_255_0x21D09E2

FULL_COPY_255_0x21D0A0A:
    add r4, #NewTagStart
    .size FULL_COPY_255_0x21D0A0A, . - FULL_COPY_255_0x21D0A0A

@ BluRose's Hall of Fame fix

FULL_COPY_265_0x0219B8C8:
    @ TYPE_NORMAL   
    .word 0x2D
    @ TYPE_FIGHTING 
    .word 0x26
    @ TYPE_FLYING   
    .word 0x28
    @ TYPE_POISON   
    .word 0x2E
    @ TYPE_GROUND   
    .word 0x2B
    @ TYPE_ROCK     
    .word 0x30
    @ TYPE_BUG      
    .word 0x22
    @ TYPE_GHOST    
    .word 0x29
    @ TYPE_STEEL    
    .word 0x31
    @ TYPE_FIRE     
    .word 0x27
    @ TYPE_WATER    
    .word 0x32
    @ TYPE_GRASS    
    .word 0x2A
    @ TYPE_ELECTRIC 
    .word 0x25
    @ TYPE_PSYCHIC  
    .word 0x2F
    @ TYPE_ICE      
    .word 0x2C
    @ TYPE_DRAGON   
    .word 0x24
    @ TYPE_DARK     
    .word 0x23
    @ TYPE_FAIRY. TODO: Make SPA for this guy, currently loads the same as NORMAL.
    .word 0x2D 
    .size FULL_COPY_265_0x0219B8C8, . - FULL_COPY_265_0x0219B8C8

FULL_COPY_265_0x219BA9C:
    .word 4
    .size FULL_COPY_265_0x219BA9C, . - FULL_COPY_265_0x219BA9C

FULL_COPY_265_0x219BADC:
    .word 0
    .size FULL_COPY_265_0x219BADC, . - FULL_COPY_265_0x219BADC

@ Summary Screen Fixes?
FULL_COPY_207_0x021B50D0:
    lsl r2, #0x11
    .size FULL_COPY_207_0x021B50D0, . - FULL_COPY_207_0x021B50D0
FULL_COPY_207_0x021B50DA:
    mov r1, #0xB0
    .size FULL_COPY_207_0x021B50DA, . - FULL_COPY_207_0x021B50DA
FULL_COPY_207_0x021B50E6:
    mov r2, #0xB0
    .size FULL_COPY_207_0x021B50E6, . - FULL_COPY_207_0x021B50E6
FULL_COPY_207_0x021B3A1A:
    cmp r4, #TypeCnt
    .size FULL_COPY_207_0x021B3A1A, . - FULL_COPY_207_0x021B3A1A
FULL_COPY_207_0x021B39F2:
    add r0, #(0x264 - 0x1A0)
    .size FULL_COPY_207_0x021B39F2, . - FULL_COPY_207_0x021B39F2
FULL_COPY_207_0x021B6BB0:
    add r1, r6, r0
    mov r0, #(0x264 >> 2)
    lsl r0, #2
    ldr r0, [r1, r0]
    .size FULL_COPY_207_0x021B6BB0, . - FULL_COPY_207_0x021B6BB0
FULL_COPY_207_0x021B6C1C:
    mov r0, #(0x264 >> 2)
    lsl r0, #2
    add r5, sp, #0x24
    nop // one extra instruction pog
    .size FULL_COPY_207_0x021B6C1C, . - FULL_COPY_207_0x021B6C1C
FULL_COPY_207_0x021B8EA0:
    mov r0, #(0x264 >> 2)
    lsl r0, #2
    .size FULL_COPY_207_0x021B8EA0, . - FULL_COPY_207_0x021B8EA0
FULL_COPY_207_0x021B6BA0:
    ldr  r0, [sp, #0x18]
    mov  r1, #0xaf      
    mov  r2, #0         
    mov  r4, #0xaf      
    .size FULL_COPY_207_0x021B6BA0, . - FULL_COPY_207_0x021B6BA0

FULL_COPY_207_0x021B8E28: // patch 3
    add  r5, r0, #0 
    add  r0, r4, #0 
    mov  r1, #0xaf  
    mov  r2, #0     
    .size FULL_COPY_207_0x021B8E28, . - FULL_COPY_207_0x021B8E28

FULL_COPY_207_0x021B8E38:
    lsl  r0, r5, #2
    add  r1, r6, r0
    mov r0, #(0x264 >> 2)
    lsl r0, #2
    .size FULL_COPY_207_0x021B8E38, . - FULL_COPY_207_0x021B8E38

FULL_COPY_207_0x021BA808:
    lsl  r0, r6, #2
    add  r1, r5, r0
    mov r0, #(0x264 >> 2)
    lsl r0, #2
    .size FULL_COPY_207_0x021BA808, . - FULL_COPY_207_0x021BA808
