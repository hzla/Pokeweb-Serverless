.syntax unified
.cpu arm946e-s
.thumb
.text
#ifdef BLACK2
#define HOOK THUMB_BRANCH_LINK_167_0x0219cd92
#else
#define HOOK THUMB_BRANCH_LINK_167_0x0219cdd2
#endif
.balign 4
.global HOOK
.type HOOK, %function
.thumb_func
HOOK:
    // r0–r2 are the retail constructor arguments. The caller's r4 is
    // the party slot and its stack holds the MainModule and client index.
    ldr r3, [sp, #4]
    push {r4, r5, r6, lr}
    sub sp, #8
    ldr r5, [sp, #32]
    str r4, [sp]
    str r5, [sp, #4]
    bl CustomizeBattleMon
    add sp, #8
    pop {r4, r5, r6, pc}
.size HOOK, .-HOOK

.balign 4
.global THUMB_BRANCH_LINK_ARM9_0x02017e9a
.type THUMB_BRANCH_LINK_ARM9_0x02017e9a, %function
.thumb_func
THUMB_BRANCH_LINK_ARM9_0x02017e9a:
    // The native party builder receives its usual three arguments. Pass the
    // battle setup, client index, and calling battle format as well.
    movs r3, r4
    push {r4, r5, r6, lr}
    sub sp, #8
    lsrs r6, r6, #2
    str r6, [sp]
    ldr r5, [sp, #44]
    str r5, [sp, #4]
    bl LoadTrainerRoster
    add sp, #8
    pop {r4, r5, r6, pc}
.size THUMB_BRANCH_LINK_ARM9_0x02017e9a, .-THUMB_BRANCH_LINK_ARM9_0x02017e9a

.balign 4
.global THUMB_BRANCH_LINK_ARM9_0x02017c9e
.global THUMB_BRANCH_LINK_ARM9_0x02017cf4
.type THUMB_BRANCH_LINK_ARM9_0x02017c9e, %function
.type THUMB_BRANCH_LINK_ARM9_0x02017cf4, %function
.thumb_func
THUMB_BRANCH_LINK_ARM9_0x02017c9e:
THUMB_BRANCH_LINK_ARM9_0x02017cf4:
    ldr r3, =ClearTrainerRosters
    bx r3

#ifdef BLACK2
#define POOL_INIT THUMB_BRANCH_LINK_ARM9_0x020308ce
#define POOL_METADATA THUMB_BRANCH_LINK_ARM9_0x02030926
#define POOL_POKEMON THUMB_BRANCH_LINK_ARM9_0x0203092e
#else
#define POOL_INIT THUMB_BRANCH_LINK_ARM9_0x020308fa
#define POOL_METADATA THUMB_BRANCH_LINK_ARM9_0x02030952
#define POOL_POKEMON THUMB_BRANCH_LINK_ARM9_0x0203095a
#endif

.macro pool_hook name, target
.balign 4
.global \name
.type \name, %function
.thumb_func
\name:
    ldr r3, =\target
    bx r3
.size \name, .-\name
.endm

pool_hook POOL_INIT, InitPoolParty
pool_hook POOL_METADATA, ReadPoolTrainer
pool_hook POOL_POKEMON, ReadPoolPokemon
