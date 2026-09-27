.syntax unified
.cpu arm946e-s
.thumb
.text
.macro branch name, function
.balign 4
.global \name
.type \name,%function
.thumb_func
\name:
 push {r4,lr}
 bl \function
 pop {r4,pc}
.size \name,.-\name
.endm
.macro replace name, function
.balign 4
.global \name
.type \name,%object
\name:
 ldr r3,1f
 bx r3
1: .word \function
.size \name,.-\name
.endm
branch THUMB_BRANCH_LINK_ARM9_0x02015970, FollowingResidentOpcode
replace FULL_COPY_ARM9_0x02016cf8, FollowingResidentCallback
replace FULL_COPY_ARM9_0x02016d08, FollowingResidentFree
replace FULL_COPY_ARM9_0x020158f8, FollowingResidentVmFree
.balign 4
.global FollowingResidentOriginalEventFree
.hidden FollowingResidentOriginalEventFree
.type FollowingResidentOriginalEventFree,%function
.thumb_func
FollowingResidentOriginalEventFree:
 push {r4,lr}
 movs r4,r0
 ldr r0,[r4,#12]
 cmp r0,#0
 ldr r3,1f
 bx r3
.balign 4
1: .word 0x02016d11
.size FollowingResidentOriginalEventFree,.-FollowingResidentOriginalEventFree
