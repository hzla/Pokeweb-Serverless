.thumb

.extern W2U_TrainerAnim_Prepare
.extern W2U_TrainerAnim_Commit
.extern W2U_TrainerAnim_Update
.extern W2U_TrainerAnim_Delete
.extern W2U_TrainerAnim_Term

.type THUMB_BRANCH_LINK_168_0x21E6E28, %function
THUMB_BRANCH_LINK_168_0x21E6E28:
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
    ldr r4, =0x0201A8A9
    blx r4
    add sp, #8
    str r0, [sp, #0]
    bl W2U_TrainerAnim_Commit
    pop {r0-r4, pc}

.type THUMB_BRANCH_LINK_168_0x21E68EC, %function
THUMB_BRANCH_LINK_168_0x21E68EC:
    push {r0-r4, lr}
    ldr r3, =0x02019AE9
    blx r3
    bl W2U_TrainerAnim_Update
    pop {r0-r4, pc}

.type THUMB_BRANCH_LINK_168_0x21E6E6E, %function
THUMB_BRANCH_LINK_168_0x21E6E6E:
    push {r0-r4, lr}
    mov r0, r1
    bl W2U_TrainerAnim_Delete
    ldr r0, [sp, #0]
    ldr r1, [sp, #4]
    ldr r3, =0x0201AA81
    blx r3
    pop {r0-r4, pc}

.type THUMB_BRANCH_LINK_168_0x21E6896, %function
THUMB_BRANCH_LINK_168_0x21E6896:
    push {r0-r4, lr}
    ldr r3, =0x02019A89
    blx r3
    bl W2U_TrainerAnim_Term
    pop {r0-r4, pc}
