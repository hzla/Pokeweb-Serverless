.syntax unified
.cpu arm946e-s
.thumb
.section .text
.balign 4
// Word-aligned absolute veneer: no hidden stack word or displaced BL half.
.global FULL_COPY_ARM9_0x0200fe34
.type FULL_COPY_ARM9_0x0200fe34,%object
FULL_COPY_ARM9_0x0200fe34:
    ldr r3,1f
    bx r3
1:  .word PokewebFollowingObjectRow
.size FULL_COPY_ARM9_0x0200fe34,.-FULL_COPY_ARM9_0x0200fe34
.balign 4
// Keep the fixed native cache; widen only the archive byte offset in r2.
.global FULL_COPY_12_0x02167fb8
.type FULL_COPY_12_0x02167fb8,%object
FULL_COPY_12_0x02167fb8:
    adds r0,r1,#4
    adds r2,r0,#0
    nop
    ldr r0,[r5,#0x18]
.size FULL_COPY_12_0x02167fb8,.-FULL_COPY_12_0x02167fb8
