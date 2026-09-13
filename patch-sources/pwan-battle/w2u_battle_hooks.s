.thumb

.type THUMB_BRANCH_LINK_168_0x21DF2C0, %function
.type THUMB_BRANCH_LINK_168_0x21DF2F8, %function
.type THUMB_BRANCH_LINK_168_0x21DF248, %function
.type THUMB_BRANCH_LINK_167_0x21D3700, %function
.type THUMB_BRANCH_LINK_168_0x21E0822, %function
.type THUMB_BRANCH_LINK_168_0x21E0912, %function
.type THUMB_BRANCH_LINK_168_0x21DF7DC, %function

.extern W2U_BattleAnim_Update
.extern W2U_BattleAnim_Draw
.extern W2U_BattleAnim_Term
.extern W2U_BattleAnim_BeginNativeFormChange
.extern W2U_BattleAnim_EndNativeFormChange
.extern W2U_BattleAnim_OnNativeFormChangeSwap
.extern W2U_BattleAnim_ShouldSuppressNativeFormCarrier
.extern W2U_BattleAnim_RefreshPositionNow

@ BattleViewRefreshFormSprite has already updated the MCSS identity and built
@ the new MAW when it reaches this final call. For busted Mimikyu, preserve the
@ base carrier and upload PWAN immediately instead of queueing the native static
@ texture. All other form refreshes retain the original carrier replacement.
THUMB_BRANCH_LINK_168_0x21DF7DC:
    push {r0-r4, lr}
    bl W2U_BattleAnim_ShouldSuppressNativeFormCarrier
    cmp r0, #0
    beq .Lnative_form_carrier
    ldr r0, [sp, #4]
    bl W2U_BattleAnim_RefreshPositionNow
    b .Lform_carrier_done
.Lnative_form_carrier:
    ldr r0, [sp, #0]
    ldr r1, [sp, #4]
    ldr r2, [sp, #8]
    ldr r3, =0x021E7FBD
    blx r3
.Lform_carrier_done:
    pop {r0-r4}
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_168_0x21DF7DC, . - THUMB_BRANCH_LINK_168_0x21DF7DC

@ The native change-form effect snapshots the actor's current MAW here. Mark
@ that battle position as effect-owned before preserving the original call so
@ the PWAN updater does not overwrite the carrier while the snapshot is live.
THUMB_BRANCH_LINK_167_0x21D3700:
    push {r0-r3, lr}
    mov r0, r1
    bl W2U_BattleAnim_BeginNativeFormChange
    pop {r0-r3}
    ldr r3, =0x021DF6F5
    blx r3
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_167_0x21D3700, . - THUMB_BRANCH_LINK_167_0x21D3700

@ At the midpoint of the native mosaic, the game normally replaces the whole
@ MAW. A different form's NCER/NCEC anchor moves the still-mosaicked pixels. For
@ PWAN-backed changes, retain the original carrier and replace only its texture
@ and palette at this exact visual swap point. Vanilla changes keep the call.
THUMB_BRANCH_LINK_168_0x21E0822:
    push {r0-r4, lr}
    bl W2U_BattleAnim_OnNativeFormChangeSwap
    cmp r0, #0
    beq .Lnative_henge_swap
    ldr r0, [sp, #4]
    bl W2U_BattleAnim_RefreshPositionNow
    b .Lhenge_swap_done
.Lnative_henge_swap:
    ldr r0, [sp, #0]
    ldr r1, [sp, #4]
    ldr r2, [sp, #8]
    ldr r3, =0x021E7FBD
    blx r3
.Lhenge_swap_done:
    pop {r0-r4}
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_168_0x21E0822, . - THUMB_BRANCH_LINK_168_0x21E0822

@ Release the position when the native task reaches its final state. The next
@ PWAN update may then install the form carrier once, after the effect can no
@ longer restore its old snapshot over it.
THUMB_BRANCH_LINK_168_0x21E0912:
    push {r0-r3, lr}
    bl W2U_BattleAnim_EndNativeFormChange
    pop {r0-r3}
    ldr r3, =0x021E03ED
    blx r3
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_168_0x21E0912, . - THUMB_BRANCH_LINK_168_0x21E0912

@ Preserve BTLV_CLACT_Main, then update custom battle PWAN actors before
@ the native battle MCSS draw pass.
THUMB_BRANCH_LINK_168_0x21DF2C0:
    push {r0-r3, lr}
    ldr r3, =0x021E98E5
    blx r3
    bl W2U_BattleAnim_Update
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_168_0x21DF2C0, . - THUMB_BRANCH_LINK_168_0x21DF2C0

@ Native MCSS owns drawing now; this callback is intentionally a no-op after
@ the regular buffer swap, but is kept as a convenient future draw hook.
THUMB_BRANCH_LINK_168_0x21DF2F8:
    push {r0-r3, lr}
    ldr r3, =0x02049ACD
    blx r3
    bl W2U_BattleAnim_Draw
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_168_0x21DF2F8, . - THUMB_BRANCH_LINK_168_0x21DF2F8

@ Free the native battle effect work as usual, then clear custom OAM.
THUMB_BRANCH_LINK_168_0x21DF248:
    push {r0-r3, lr}
    ldr r3, =0x0203A279
    blx r3
    bl W2U_BattleAnim_Term
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_168_0x21DF248, . - THUMB_BRANCH_LINK_168_0x21DF248
