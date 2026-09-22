.syntax unified
.cpu arm946e-s
.thumb
.text
.balign 4
.global THUMB_BRANCH_LINK_36_0x02180078
.type THUMB_BRANCH_LINK_36_0x02180078,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x02180078:
 push {r4,lr}
 bl FollowingUpdate
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x02180078,.-THUMB_BRANCH_LINK_36_0x02180078
.balign 4
.global FULL_COPY_36_0x021801e4
.type FULL_COPY_36_0x021801e4,%object
FULL_COPY_36_0x021801e4:
 ldr r3,1f
 bx r3
1: .word FollowingUnload
.size FULL_COPY_36_0x021801e4,.-FULL_COPY_36_0x021801e4
.balign 4
.global FollowingOriginalUnload
.hidden FollowingOriginalUnload
.type FollowingOriginalUnload,%function
.thumb_func
FollowingOriginalUnload:
 push {r4,r5,r6,lr}
 movs r5,r1
 movs r6,r0
 ldr r0,[r5,#0x38]
 ldr r3,2f
 bx r3
.balign 4
2: .word 0x021801ed
.size FollowingOriginalUnload,.-FollowingOriginalUnload
.thumb
.balign 4
.global __aeabi_lmul
.hidden __aeabi_lmul
.type __aeabi_lmul,%function
.thumb_func
__aeabi_lmul:
 /* RPM's immediate Thumb-to-ARM BLX encoding can set its reserved low bit
    for a halfword-aligned callsite. Keep the exported entry Thumb and switch
    locally at a fixed word-aligned address, without a BLX relocation. */
 bx pc
 nop
.arm
 push {r4,lr}
 umull r4,ip,r0,r2
 mla r1,r2,r1,ip
 mla r1,r0,r3,r1
 mov r0,r4
 pop {r4,pc}
.size __aeabi_lmul,.-__aeabi_lmul

.thumb
.balign 4
.global THUMB_BRANCH_LINK_36_0x0218122e
.type THUMB_BRANCH_LINK_36_0x0218122e,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x0218122e:
 push {r4,lr}
 bl FollowingEffectsDraw
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x0218122e,.-THUMB_BRANCH_LINK_36_0x0218122e

.thumb
.balign 4
.global THUMB_BRANCH_LINK_36_0x021818bc
.type THUMB_BRANCH_LINK_36_0x021818bc,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x021818bc:
 push {r4,lr}
 bl FollowingGridEvents
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x021818bc,.-THUMB_BRANCH_LINK_36_0x021818bc
.balign 4
.global THUMB_BRANCH_LINK_36_0x02181a6c
.type THUMB_BRANCH_LINK_36_0x02181a6c,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x02181a6c:
 push {r4,lr}
 bl FollowingRailEvents
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x02181a6c,.-THUMB_BRANCH_LINK_36_0x02181a6c

/* Main actor billboard pass; the existing sub-pass remains effects-only. */
.thumb
.balign 4
.global THUMB_BRANCH_LINK_36_0x0218119a
.type THUMB_BRANCH_LINK_36_0x0218119a,%function
.thumb_func
THUMB_BRANCH_LINK_36_0x0218119a:
 push {r4,lr}
 bl FollowingDraw
 pop {r4,pc}
.size THUMB_BRANCH_LINK_36_0x0218119a,.-THUMB_BRANCH_LINK_36_0x0218119a
