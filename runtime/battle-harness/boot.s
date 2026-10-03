.syntax unified
.cpu arm946e-s
.thumb
.text
.balign 4
.global FULL_COPY_12_0x0215a790
.type FULL_COPY_12_0x0215a790,%object
FULL_COPY_12_0x0215a790:
 ldr r3,1f
 bx r3
1: .word BattleHarnessStart
.size FULL_COPY_12_0x0215a790,.-FULL_COPY_12_0x0215a790
.balign 4
.global THUMB_BRANCH_LINK_167_0x021ce9e4
.type THUMB_BRANCH_LINK_167_0x021ce9e4,%function
.thumb_func
THUMB_BRANCH_LINK_167_0x021ce9e4:
 ldr r3,2f
 bx r3
.balign 4
2: .word BattleHarnessOpening
.size THUMB_BRANCH_LINK_167_0x021ce9e4,.-THUMB_BRANCH_LINK_167_0x021ce9e4
