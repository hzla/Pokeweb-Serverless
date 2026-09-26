.syntax unified
.cpu arm946e-s
.thumb
.text
.balign 4
/* Tail veneers retain the callsite's stack arguments and LR. */
.macro option_hook address, target
.global THUMB_BRANCH_LINK_140_\address
.type THUMB_BRANCH_LINK_140_\address,%function
.thumb_func
THUMB_BRANCH_LINK_140_\address:
 push {r3}
 ldr r3,1f
 mov ip,r3
 pop {r3}
 bx ip
 .balign 4
1: .word \target
.size THUMB_BRANCH_LINK_140_\address,.-THUMB_BRANCH_LINK_140_\address
.balign 4
.endm
option_hook 0x0219d002, FollowingOptionsInit
option_hook 0x0219d0b0, FollowingOptionsExit
option_hook 0x0219eb6e, FollowingOptionsMain
option_hook 0x0219dd8a, FollowingOptionsSelect
option_hook 0x0219ebec, FollowingOptionsCompare
option_hook 0x0219ec22, FollowingOptionsCompare
option_hook 0x0219ee2e, FollowingOptionsCommit
