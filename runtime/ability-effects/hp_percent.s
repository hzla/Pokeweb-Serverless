.syntax unified
.cpu arm946e-s
.thumb
.section .text.AbilityHpPercent,"ax",%progbits
.global AbilityHpPercent, AbilityHpPercentValue, AbilityHpPercentMinimum
.thumb_func
AbilityHpPercent:
    ldrh r0, [r0, #14]
    ldr r1, AbilityHpPercentValue
    muls r0, r1
    ldr r1, .Ldenominator
    movs r2, #1
    lsls r2, r2, #16
    movs r3, #0
.Ldivide:
    cmp r0, r1
    bcc .Lnext
    subs r0, r0, r1
    orrs r3, r2
.Lnext:
    lsrs r1, r1, #1
    lsrs r2, r2, #1
    bne .Ldivide
    movs r0, r3
    cmp r0, #0
    bne .Ldone
    ldr r0, AbilityHpPercentMinimum
.Ldone:
    bx lr
.balign 4
AbilityHpPercentValue: .word 0
.Ldenominator: .word 655360000
AbilityHpPercentMinimum: .word 0

.section .text.AbilityHpAtLeast,"ax",%progbits
.global AbilityHpAtLeast, AbilityHpAtLeastValue
.thumb_func
AbilityHpAtLeast:
    ldrh r1, [r0, #14]
    ldrh r0, [r0, #16]
    ldr r2, AbilityHpAtLeastValue
    muls r1, r2
    ldr r2, .Lscale
    muls r0, r2
    cmp r0, r1
    bcs .Lyes
    movs r0, #0
    bx lr
.Lyes:
    movs r0, #1
    bx lr
.balign 4
AbilityHpAtLeastValue: .word 0
.Lscale: .word 10000
