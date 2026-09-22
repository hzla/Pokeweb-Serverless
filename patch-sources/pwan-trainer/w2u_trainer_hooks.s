.thumb

.extern W2U_TrainerAnim_Prepare
.extern W2U_TrainerAnim_Commit
.extern W2U_TrainerAnim_Update
.extern W2U_TrainerAnim_Delete
.extern W2U_TrainerAnim_Term

.type THUMB_BRANCH_LINK_168_0x21E6E68, %function
THUMB_BRANCH_LINK_168_0x21E6E68:
    push {r0-r4, lr}
    ldr r0, [sp, #24]
    bl W2U_TrainerAnim_Prepare
    ldr r0, [sp, #0]
    ldr r1, [sp, #4]
    ldr r2, [sp, #8]
    ldr r3, [sp, #12]
    ldr r4, [sp, #24]
    sub sp, #8
    str r4, [sp, #0]
    ldr r4, =0x0201A8D5
    blx r4
    add sp, #8
    str r0, [sp, #0]
    bl W2U_TrainerAnim_Commit
    pop {r0-r4, pc}

.type THUMB_BRANCH_LINK_168_0x21E692C, %function
THUMB_BRANCH_LINK_168_0x21E692C:
    push {r0-r4, lr}
    ldr r3, =0x02019B15
    blx r3
    bl W2U_TrainerAnim_Update
    pop {r0-r4, pc}

.type THUMB_BRANCH_LINK_168_0x21E6EAE, %function
THUMB_BRANCH_LINK_168_0x21E6EAE:
    push {r0-r4, lr}
    mov r0, r1
    bl W2U_TrainerAnim_Delete
    ldr r0, [sp, #0]
    ldr r1, [sp, #4]
    ldr r3, =0x0201AAAD
    blx r3
    pop {r0-r4, pc}

.type THUMB_BRANCH_LINK_168_0x21E68D6, %function
THUMB_BRANCH_LINK_168_0x21E68D6:
    push {r0-r4, lr}
    ldr r3, =0x02019AB5
    blx r3
    bl W2U_TrainerAnim_Term
    pop {r0-r4, pc}
