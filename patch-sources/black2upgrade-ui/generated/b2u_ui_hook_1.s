@ Generated from w2u_mega_summary_hooks.s for clean US Black 2 (IREO).
.thumb

.type THUMB_BRANCH_LINK_207_0x21B3348, %function
.type THUMB_BRANCH_LINK_207_0x21B91C4, %function

@ Battle summary redraw path. Preserve the original draw helper, then refresh
@ the Mega summary cache from the resident gameplay DLL while overlay 207 is active.
THUMB_BRANCH_LINK_207_0x21B3348:
    push {r0-r3, lr}
    ldr r3, =0x02049A99
    blx r3
    bl W2U_Mega_PatchKnownSummaryCache
    pop {r0-r3}
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_207_0x21B3348, . - THUMB_BRANCH_LINK_207_0x21B3348

@ Ability text uses the current summary PP directly instead of the stat cache.
@ Replay PP_Get(PF_Ability), then substitute the mirrored Mega ability if this
@ summary entry is the active Mega.
THUMB_BRANCH_LINK_207_0x21B91C4:
    push {r4, lr}
    mov r4, r0
    bl PokeParty_GetParam
    mov r1, r4
    bl W2U_Mega_OverrideSummaryAbilityParam
    pop {r4}
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_207_0x21B91C4, . - THUMB_BRANCH_LINK_207_0x21B91C4
