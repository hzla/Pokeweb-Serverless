.syntax unified
.thumb

.global THUMB_BRANCH_LINK_168_0x021e6cea
.type THUMB_BRANCH_LINK_168_0x021e6cea, %function
.thumb_func
THUMB_BRANCH_LINK_168_0x021e6cea:
    push {r0-r4, lr}
    sub sp, #16
    ldr r4, [sp, #40]
    str r4, [sp]
    str r6, [sp, #4]
    ldr r4, [sp, #48]
    str r4, [sp, #8]
    bl PWNP_BattleAdd
    add sp, #16
    str r0, [sp]
    pop {r0-r4, pc}

.macro RELOAD address
.global THUMB_BRANCH_LINK_168_\address
.type THUMB_BRANCH_LINK_168_\address, %function
.thumb_func
THUMB_BRANCH_LINK_168_\address:
    b PWNP_BattleReload
.endm
RELOAD 0x021e7e04
RELOAD 0x021e7e8c
RELOAD 0x021e7fb6
RELOAD 0x021e7ff2

.global THUMB_BRANCH_LINK_167_0x021b7d36
.type THUMB_BRANCH_LINK_167_0x021b7d36, %function
.thumb_func
THUMB_BRANCH_LINK_167_0x021b7d36:
    b PWNP_Transform

.ifndef PWNP_COMBINED
.global THUMB_BRANCH_LINK_168_0x021df248
.type THUMB_BRANCH_LINK_168_0x021df248, %function
.thumb_func
THUMB_BRANCH_LINK_168_0x021df248:
    push {r0-r3, lr}
    ldr r3, =0x0203a279
    blx r3
    bl PWNP_BattleTerm
    pop {r0-r3, pc}
.endif
