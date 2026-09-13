.thumb

.type THUMB_BRANCH_LINK_207_0x21B333E, %function
.type THUMB_BRANCH_LINK_207_0x21B3356, %function
.type THUMB_BRANCH_LINK_207_0x21B316A, %function

.extern W2U_SummaryAnim_Update
.extern W2U_SummaryAnim_PreDraw
.extern W2U_SummaryAnim_Draw
.extern W2U_SummaryAnim_Term

@ Black 2 PSTATUS_UPDATE: retain the native tick before the PWAN update.
THUMB_BRANCH_LINK_207_0x21B333E:
    push {r0-r3, lr}
    ldr r3, =0x0204B795
    blx r3
    mov r0, r4
    bl W2U_SummaryAnim_Update
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_207_0x21B333E, . - THUMB_BRANCH_LINK_207_0x21B333E

@ Re-hide the native summary MCSS before the normal draw and PWAN OAM pass.
THUMB_BRANCH_LINK_207_0x21B3356:
    push {r0-r3, lr}
    mov r0, r4
    bl W2U_SummaryAnim_PreDraw
    pop {r0-r3}
    push {r0-r3}
    ldr r3, =0x02049AA1
    blx r3
    mov r0, r4
    bl W2U_SummaryAnim_Draw
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_207_0x21B3356, . - THUMB_BRANCH_LINK_207_0x21B3356

@ Preserve Black 2's native cell teardown, then clear the reserved OAM slots.
THUMB_BRANCH_LINK_207_0x21B316A:
    push {r0-r3, lr}
    mov r0, r5
    ldr r3, =0x021B3EB9
    blx r3
    mov r0, r5
    bl W2U_SummaryAnim_Term
    pop {r0-r3, pc}
    .size THUMB_BRANCH_LINK_207_0x21B316A, . - THUMB_BRANCH_LINK_207_0x21B316A
