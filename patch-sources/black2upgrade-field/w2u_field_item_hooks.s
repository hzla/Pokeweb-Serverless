.thumb

.type THUMB_BRANCH_LINK_165_0x219B3AC, %function
.type THUMB_BRANCH_LINK_165_0x219B3D2, %function

.extern W2U_FieldItem_CanUseItemOrAbilityFieldItem
.extern W2U_FieldItem_StartAbilityFieldItemConfirm

THUMB_BRANCH_LINK_165_0x219B3AC:
    push {r3}
    ldr r3, =W2U_FieldItem_CanUseItemOrAbilityFieldItem
    mov r12, r3
    pop {r3}
    bx r12
    .size THUMB_BRANCH_LINK_165_0x219B3AC, . - THUMB_BRANCH_LINK_165_0x219B3AC

THUMB_BRANCH_LINK_165_0x219B3D2:
    cmp r1, #120
    beq 1f
    cmp r1, #130
    beq 1f
    ldr r3, =0x021A2969
    bx r3

1:
    mov r2, r4
    bl W2U_FieldItem_StartAbilityFieldItemConfirm
    cmp r0, #0
    beq 2f

    ldr r3, =0x0219B445
    bx r3

2:
    ldr r3, =0x0219B447
    bx r3
    .size THUMB_BRANCH_LINK_165_0x219B3D2, . - THUMB_BRANCH_LINK_165_0x219B3D2
