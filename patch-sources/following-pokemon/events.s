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
branch THUMB_BRANCH_LINK_ARM9_0x02015970, FollowingEventOpcode
replace FULL_COPY_ARM9_0x02016cf8, FollowingEventCallback
replace FULL_COPY_ARM9_0x02016d08, FollowingEventFree
branch THUMB_BRANCH_LINK_12_0x02166ecc, FollowingEventAction
branch THUMB_BRANCH_LINK_12_0x02166ef4, FollowingEventAction
replace FULL_COPY_12_0x02167c0c, FollowingEventPosition
replace FULL_COPY_12_0x02166980, FollowingEventDelete
replace FULL_COPY_12_0x02167348, FollowingEventWorldStep
replace FULL_COPY_ARM9_0x020158f8, FollowingEventVmFree
.balign 4
.global THUMB_BRANCH_LINK_12_0x02166836
.type THUMB_BRANCH_LINK_12_0x02166836,%function
.thumb_func
THUMB_BRANCH_LINK_12_0x02166836:
 /* The copied 36-byte entity is at the incoming stack pointer. */
 mov r1,sp
 push {r4,lr}
 bl FollowingEventAllocate
 pop {r4,pc}
.size THUMB_BRANCH_LINK_12_0x02166836,.-THUMB_BRANCH_LINK_12_0x02166836
.balign 4
.global FollowingOriginalEventFree
.hidden FollowingOriginalEventFree
.type FollowingOriginalEventFree,%function
.thumb_func
FollowingOriginalEventFree:
 push {r4,lr}
 movs r4,r0
 ldr r0,[r4,#12]
 cmp r0,#0
 ldr r3,1f
 bx r3
.balign 4
1: .word 0x02016d11
.size FollowingOriginalEventFree,.-FollowingOriginalEventFree
.balign 4
.global FollowingOriginalPosition
.hidden FollowingOriginalPosition
.type FollowingOriginalPosition,%function
.thumb_func
FollowingOriginalPosition:
 push {r4,r5,r6,lr}
 movs r4,r1
 ldr r1,[r4]
 movs r6,r2
 ldr r3,1f
 bx r3
.balign 4
1: .word 0x02167c15
.size FollowingOriginalPosition,.-FollowingOriginalPosition
.balign 4
.global FollowingOriginalDelete
.hidden FollowingOriginalDelete
.type FollowingOriginalDelete,%function
.thumb_func
FollowingOriginalDelete:
 push {r4,lr}
 movs r4,r0
 adds r0,#0x88
 ldr r0,[r0]
 ldr r3,1f
 bx r3
.balign 4
1: .word 0x02166989
.size FollowingOriginalDelete,.-FollowingOriginalDelete

replace FULL_COPY_12_0x021671c8, FollowingAmbientUpdate
branch THUMB_BRANCH_LINK_36_0x02195714, FollowingAmbientRail
/* All four grid arguments are live: use r4, not the usual r3 veneer. */
.balign 4
.global FULL_COPY_12_0x0215e538
.type FULL_COPY_12_0x0215e538,%object
FULL_COPY_12_0x0215e538:
 push {r4,lr}
 ldr r4,1f
 blx r4
 pop {r4,pc}
1: .word FollowingAmbientGrid
.size FULL_COPY_12_0x0215e538,.-FULL_COPY_12_0x0215e538
.balign 4
.global FollowingOriginalGridCollision
.hidden FollowingOriginalGridCollision
.type FollowingOriginalGridCollision,%function
.thumb_func
FollowingOriginalGridCollision:
 push {r4,r5,r6,r7,lr}
 sub sp,#12
 str r0,[sp]
 adds r0,#0x88
 ldr r0,[r0]
 str r2,[sp,#4]
 ldr r4,1f
 bx r4
.balign 4
1: .word 0x0215e545
.size FollowingOriginalGridCollision,.-FollowingOriginalGridCollision
