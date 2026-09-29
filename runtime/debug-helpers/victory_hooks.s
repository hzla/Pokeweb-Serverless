.syntax unified
.thumb
.text
.align 2
.global THUMB_BRANCH_LINK_BattleProcessMain_0x10
.type THUMB_BRANCH_LINK_BattleProcessMain_0x10, %function
.thumb_func
THUMB_BRANCH_LINK_BattleProcessMain_0x10:
    push {r3, lr}
    movs r0, r5
    bl InstantVictory_Main
    pop {r3, pc}
.size THUMB_BRANCH_LINK_BattleProcessMain_0x10, .-THUMB_BRANCH_LINK_BattleProcessMain_0x10
