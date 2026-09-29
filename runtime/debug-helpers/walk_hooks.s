.syntax unified
.thumb
.text
.align 2
.global THUMB_BRANCH_LINK_PlayerMoveCollCheck_0x9A
.type THUMB_BRANCH_LINK_PlayerMoveCollCheck_0x9A, %function
.thumb_func
THUMB_BRANCH_LINK_PlayerMoveCollCheck_0x9A:
    movs r0, r4
    ldr r1, =WalkThroughWallsEnabled
    ldr r1, [r1]
    cmp r1, #0
    beq 1f
    movs r0, #0
1:  add sp, #0x18
    pop {r3-r7, pc}
.size THUMB_BRANCH_LINK_PlayerMoveCollCheck_0x9A, .-THUMB_BRANCH_LINK_PlayerMoveCollCheck_0x9A

.align 2
.global THUMB_BRANCH_LINK_PlayerMoveCollCheckCatwalk_0x1E
.type THUMB_BRANCH_LINK_PlayerMoveCollCheckCatwalk_0x1E, %function
.thumb_func
THUMB_BRANCH_LINK_PlayerMoveCollCheckCatwalk_0x1E:
    movs r0, r4
    ldr r1, =WalkThroughWallsEnabled
    ldr r1, [r1]
    cmp r1, #0
    beq 2f
    movs r0, #0
2:  pop {r3-r5, pc}
.size THUMB_BRANCH_LINK_PlayerMoveCollCheckCatwalk_0x1E, .-THUMB_BRANCH_LINK_PlayerMoveCollCheckCatwalk_0x1E
.ltorg
