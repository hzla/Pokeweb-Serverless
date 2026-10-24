.syntax unified
.cpu arm946e-s
.thumb
.text
.balign 4
.global THUMB_BRANCH_LINK_167_0x0219f5da
.type THUMB_BRANCH_LINK_167_0x0219f5da,%function
.thumb_func
THUMB_BRANCH_LINK_167_0x0219f5da:
    // r0 is MainModule; r6 is the ServerFlow retained by the retail caller.
    movs r1, r6
    ldr r3, =TrainerFieldStart
    bx r3
.size THUMB_BRANCH_LINK_167_0x0219f5da, .-THUMB_BRANCH_LINK_167_0x0219f5da

.balign 4
.global THUMB_BRANCH_LINK_167_0x0219f688
.type THUMB_BRANCH_LINK_167_0x0219f688,%function
.thumb_func
THUMB_BRANCH_LINK_167_0x0219f688:
    ldr r3, =TrainerFieldFinish
    bx r3
.size THUMB_BRANCH_LINK_167_0x0219f688, .-THUMB_BRANCH_LINK_167_0x0219f688
