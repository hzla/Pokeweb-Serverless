.syntax unified
.cpu arm946e-s
.thumb

.extern LevelCaps_ApplyBattleExp
.extern LevelCaps_DenyInfiniteCandy
.extern PokeList_CanItemAfterPrologue

.section .text
.balign 4

// Replaces the BL PassPower_ApplyEXP in AddExpAndEVs. r7 is the BattleMon.
.global THUMB_BRANCH_LINK_AddExpAndEVs_0x264
.type THUMB_BRANCH_LINK_AddExpAndEVs_0x264, %function
.thumb_func
THUMB_BRANCH_LINK_AddExpAndEVs_0x264:
    push {r4, r5, r7, lr}
    movs r1, r7
    movs r2, r4
    bl LevelCaps_ApplyBattleExp
    pop {r4, r5, r7, pc}
.size THUMB_BRANCH_LINK_AddExpAndEVs_0x264, .-THUMB_BRANCH_LINK_AddExpAndEVs_0x264

// At the item eligibility entry, guard only item 622, then replay the exact
// eight retail prologue bytes and continue at +8. This preserves all other
// item behavior and the original Rare Candy exception.
.global THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed
.type THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed, %function
.thumb_func
THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed:
    push {r0-r4, lr}
    bl LevelCaps_DenyInfiniteCandy
    cmp r0, #0
    pop {r0-r4}
    mov r12, r4
    pop {r4}
    mov lr, r4
    mov r4, r12
    bne 1f
    push {r4-r7, lr}
    sub sp, #0x1c
    adds r7, r2, #0
    lsls r2, r3, #0x10
    ldr r3, =PokeList_CanItemAfterPrologue
    bx r3
1:
    movs r0, #0
    bx lr
.size THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed, .-THUMB_BRANCH_PokeList_CanItemWithBattleStatsBeUsed
.ltorg
