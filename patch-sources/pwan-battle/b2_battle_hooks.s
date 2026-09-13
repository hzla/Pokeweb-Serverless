.thumb

.type THUMB_BRANCH_LINK_168_0x21DF280, %function
.type THUMB_BRANCH_LINK_168_0x21DF2B8, %function
.type THUMB_BRANCH_LINK_168_0x21DF208, %function
.type THUMB_BRANCH_LINK_167_0x21D36C0, %function
.type THUMB_BRANCH_LINK_168_0x21E07E2, %function
.type THUMB_BRANCH_LINK_168_0x21E08D2, %function
.type THUMB_BRANCH_LINK_168_0x21DF79C, %function

.extern W2U_BattleAnim_Update
.extern W2U_BattleAnim_Draw
.extern W2U_BattleAnim_Term
.extern W2U_BattleAnim_BeginNativeFormChange
.extern W2U_BattleAnim_EndNativeFormChange
.extern W2U_BattleAnim_OnNativeFormChangeSwap
.extern W2U_BattleAnim_ShouldSuppressNativeFormCarrier
.extern W2U_BattleAnim_RefreshPositionNow

@ Black 2 counterpart of BattleViewRefreshFormSprite's carrier update.
THUMB_BRANCH_LINK_168_0x21DF79C:
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
    ldr r3, =0x021E7F7D
    blx r3
.Lform_carrier_done:
    pop {r0-r4}
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_168_0x21DF79C, . - THUMB_BRANCH_LINK_168_0x21DF79C

@ Mark the actor as native-form-effect-owned before the original call.
THUMB_BRANCH_LINK_167_0x21D36C0:
    push {r0-r3, lr}
    mov r0, r1
    bl W2U_BattleAnim_BeginNativeFormChange
    pop {r0-r3}
    ldr r3, =0x021DF6B5
    blx r3
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_167_0x21D36C0, . - THUMB_BRANCH_LINK_167_0x21D36C0

@ Keep the stable carrier through the midpoint of the native mosaic effect.
THUMB_BRANCH_LINK_168_0x21E07E2:
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
    ldr r3, =0x021E7F7D
    blx r3
.Lhenge_swap_done:
    pop {r0-r4}
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_168_0x21E07E2, . - THUMB_BRANCH_LINK_168_0x21E07E2

@ Release ownership when the native form task reaches its final state.
THUMB_BRANCH_LINK_168_0x21E08D2:
    push {r0-r3, lr}
    bl W2U_BattleAnim_EndNativeFormChange
    pop {r0-r3}
    ldr r3, =0x021E03AD
    blx r3
    pop {r1}
    bx r1
    .size THUMB_BRANCH_LINK_168_0x21E08D2, . - THUMB_BRANCH_LINK_168_0x21E08D2

@ Run the PWAN actor update before Black 2's native battle MCSS draw pass.
THUMB_BRANCH_LINK_168_0x21DF280:
    push {r0-r3, lr}
    ldr r3, =0x021E98A5
    blx r3
    bl W2U_BattleAnim_Update
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_168_0x21DF280, . - THUMB_BRANCH_LINK_168_0x21DF280

@ Preserve the regular buffer swap and retain the future draw callback.
THUMB_BRANCH_LINK_168_0x21DF2B8:
    push {r0-r3, lr}
    ldr r3, =0x02049AA1
    blx r3
    bl W2U_BattleAnim_Draw
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_168_0x21DF2B8, . - THUMB_BRANCH_LINK_168_0x21DF2B8

@ Free native battle work, then clear the PWAN battle state.
THUMB_BRANCH_LINK_168_0x21DF208:
    push {r0-r3, lr}
    ldr r3, =0x0203A24D
    blx r3
    bl W2U_BattleAnim_Term
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_168_0x21DF208, . - THUMB_BRANCH_LINK_168_0x21DF208
