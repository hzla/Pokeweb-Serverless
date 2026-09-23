.syntax unified
.cpu arm946e-s
.thumb
.text

#ifdef BLACK2
#define HOOK_NORMAL THUMB_BRANCH_LINK_ARM9_0x02030a30
#define HOOK_MOVES THUMB_BRANCH_LINK_ARM9_0x02030b2e
#define HOOK_ITEM THUMB_BRANCH_LINK_ARM9_0x02030c4a
#define HOOK_MULTI THUMB_BRANCH_LINK_ARM9_0x02030d5c
#define SETUP_NORMAL THUMB_BRANCH_LINK_ARM9_0x02030a20
#define SETUP_MOVES THUMB_BRANCH_LINK_ARM9_0x02030b04
#define SETUP_ITEM THUMB_BRANCH_LINK_ARM9_0x02030c2e
#define SETUP_MULTI THUMB_BRANCH_LINK_ARM9_0x02030d26
#define LEVEL_NORMAL THUMB_BRANCH_LINK_ARM9_0x02030990
#define LEVEL_MOVES THUMB_BRANCH_LINK_ARM9_0x02030a72
#define LEVEL_ITEM THUMB_BRANCH_LINK_ARM9_0x02030b80
#define LEVEL_MULTI THUMB_BRANCH_LINK_ARM9_0x02030c94
#else
#define HOOK_NORMAL THUMB_BRANCH_LINK_ARM9_0x02030a5c
#define HOOK_MOVES THUMB_BRANCH_LINK_ARM9_0x02030b5a
#define HOOK_ITEM THUMB_BRANCH_LINK_ARM9_0x02030c76
#define HOOK_MULTI THUMB_BRANCH_LINK_ARM9_0x02030d88
#define SETUP_NORMAL THUMB_BRANCH_LINK_ARM9_0x02030a4c
#define SETUP_MOVES THUMB_BRANCH_LINK_ARM9_0x02030b30
#define SETUP_ITEM THUMB_BRANCH_LINK_ARM9_0x02030c5a
#define SETUP_MULTI THUMB_BRANCH_LINK_ARM9_0x02030d52
#define LEVEL_NORMAL THUMB_BRANCH_LINK_ARM9_0x020309bc
#define LEVEL_MOVES THUMB_BRANCH_LINK_ARM9_0x02030a9e
#define LEVEL_ITEM THUMB_BRANCH_LINK_ARM9_0x02030bac
#define LEVEL_MULTI THUMB_BRANCH_LINK_ARM9_0x02030cc0
#endif

.extern Trainer_SetupEx
.extern Trainer_SetParam
.extern Trainer_ExpForLevel
.extern Trainer_Put
.extern Trainer_RecalcStats

/* Normalize the level when the retail trainer builder saves it for the RNG
   seed. This keeps personality, ability, and gender behavior independent of
   the optional nature marker. */
.balign 4
.global LEVEL_NORMAL
.type LEVEL_NORMAL, %function
.thumb_func
LEVEL_NORMAL:
    ldrb r0, [r0, #2]
    str r0, [sp, #96]
    bx lr
.size LEVEL_NORMAL, . - LEVEL_NORMAL

.balign 4
.global LEVEL_MOVES
.global LEVEL_MULTI
.type LEVEL_MOVES, %function
.type LEVEL_MULTI, %function
.thumb_func
LEVEL_MOVES:
LEVEL_MULTI:
    ldrb r0, [r6, #2]
    ldr r3, [sp, #112]
    bx lr
.size LEVEL_MOVES, . - LEVEL_MOVES
.size LEVEL_MULTI, . - LEVEL_MULTI

.balign 4
.global LEVEL_ITEM
.type LEVEL_ITEM, %function
.thumb_func
LEVEL_ITEM:
    ldrb r0, [r0, #2]
    str r0, [sp, #72]
    bx lr
.size LEVEL_ITEM, . - LEVEL_ITEM

/* The Nature marker shares the high byte of the level in the archive.
   Remove it before the retail constructor reads the two-byte level. Preserve
   the caller's stack arguments and LR by tail calling the native routine. */
.balign 4
.global SETUP_NORMAL
.global SETUP_MOVES
.global SETUP_ITEM
.global SETUP_MULTI
.type SETUP_NORMAL, %function
.type SETUP_MOVES, %function
.type SETUP_ITEM, %function
.type SETUP_MULTI, %function
.thumb_func
SETUP_NORMAL:
SETUP_MOVES:
SETUP_ITEM:
SETUP_MULTI:
    lsls r2, r2, #24
    lsrs r2, r2, #24
    push {r4}
    ldr r4, =Trainer_SetupEx
    mov r12, r4
    pop {r4}
    bx r12
.size SETUP_NORMAL, . - SETUP_NORMAL
.size SETUP_MOVES, . - SETUP_MOVES
.size SETUP_ITEM, . - SETUP_ITEM
.size SETUP_MULTI, . - SETUP_MULTI

.macro hook_prologue
    push {r4-r7, lr}
    sub sp, #4
    movs r4, r1
.endm

.macro hook_epilogue
    movs r0, r4
    movs r1, r5
    bl ApplyNature
    add sp, #4
    pop {r4-r7, pc}
.endm

/* The normal and item layouts keep the current trainer record on the stack. */
.balign 4
.global HOOK_NORMAL
.type HOOK_NORMAL, %function
.thumb_func
HOOK_NORMAL:
    hook_prologue
    ldr r5, [sp, #76]
    bl Trainer_SetParam
    hook_epilogue
.size HOOK_NORMAL, . - HOOK_NORMAL

.balign 4
.global HOOK_MOVES
.type HOOK_MOVES, %function
.thumb_func
HOOK_MOVES:
    hook_prologue
    ldr r5, [sp, #60]
    lsls r5, r5, #4
    ldr r6, [sp, #128]
    adds r5, r5, r6
    bl Trainer_SetParam
    hook_epilogue
.size HOOK_MOVES, . - HOOK_MOVES

.balign 4
.global HOOK_ITEM
.type HOOK_ITEM, %function
.thumb_func
HOOK_ITEM:
    hook_prologue
    ldr r5, [sp, #72]
    bl Trainer_SetParam
    hook_epilogue
.size HOOK_ITEM, . - HOOK_ITEM

.balign 4
.global HOOK_MULTI
.type HOOK_MULTI, %function
.thumb_func
HOOK_MULTI:
    hook_prologue
    movs r5, r7
    bl Trainer_SetParam
    hook_epilogue
.size HOOK_MULTI, . - HOOK_MULTI

/* Byte 3 is Pokeweb's optional one-based nature; byte 2 remains the level. */
.balign 4
.type ApplyNature, %function
.thumb_func
ApplyNature:
    push {r4-r7, lr}
    sub sp, #4
    movs r4, r0
    movs r5, r1
    ldrb r6, [r5, #3]
    cmp r6, #1
    blo 1f
    cmp r6, #25
    bhi 1f
    subs r6, #1
    ldrh r0, [r5, #4]
    movs r1, #0
    ldrb r2, [r5, #2]
    bl Trainer_ExpForLevel
    movs r2, r0
    movs r0, r4
    movs r1, #8
    bl Trainer_Put
    movs r0, r4
    movs r1, #0x70
    movs r2, r6
    bl Trainer_Put
    movs r0, r4
    bl Trainer_RecalcStats
1:
    add sp, #4
    pop {r4-r7, pc}
.size ApplyNature, . - ApplyNature
