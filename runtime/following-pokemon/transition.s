.syntax unified
.cpu arm946e-s
.thumb
.text
.balign 4
.global THUMB_BRANCH_LINK_36_0x021bad80
.type THUMB_BRANCH_LINK_36_0x021bad80,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x021bad80:
 push {r4,lr}
 bl FollowingSurfEntryStep
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x021bad80,.-THUMB_BRANCH_LINK_36_0x021bad80
.balign 4
.global THUMB_BRANCH_LINK_36_0x021bad8e
.type THUMB_BRANCH_LINK_36_0x021bad8e,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x021bad8e:
 push {r4,lr}
 bl FollowingSurfEntryDone
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x021bad8e,.-THUMB_BRANCH_LINK_36_0x021bad8e
.balign 4
.global THUMB_BRANCH_LINK_36_0x02182cba
.type THUMB_BRANCH_LINK_36_0x02182cba,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x02182cba:
 push {r4,lr}
 bl FollowingSurfExitStep
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x02182cba,.-THUMB_BRANCH_LINK_36_0x02182cba
.balign 4
.global THUMB_BRANCH_LINK_36_0x02182cc0
.type THUMB_BRANCH_LINK_36_0x02182cc0,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x02182cc0:
 push {r4,lr}
 bl FollowingSurfExitDone
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x02182cc0,.-THUMB_BRANCH_LINK_36_0x02182cc0
.balign 4
.global THUMB_BRANCH_LINK_36_0x02182d6a
.type THUMB_BRANCH_LINK_36_0x02182d6a,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x02182d6a:
 push {r1,lr}
 adds r1,r6,#0
 bl FollowingShoreSpan
 pop {r1,pc}
.size THUMB_BRANCH_LINK_36_0x02182d6a,.-THUMB_BRANCH_LINK_36_0x02182d6a
