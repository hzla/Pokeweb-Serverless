.syntax unified
.cpu arm946e-s
.thumb
.text
.balign 4
.global FULL_COPY_36_0x0219a610
.type FULL_COPY_36_0x0219a610,%object
FULL_COPY_36_0x0219a610:
 ldr r3,1f
 bx r3
1: .word FollowingPlayerMoveDir
.size FULL_COPY_36_0x0219a610,.-FULL_COPY_36_0x0219a610
