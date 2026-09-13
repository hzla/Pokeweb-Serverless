.syntax unified
.thumb
.text
.align 2

#if defined(W2U_TARGET_B1)
#define W2U_REGISTER_TARGETS_CONTINUATION 0x021CA801
#define W2U_CHECK_FAINTED_CONTINUATION 0x021C4F6D
#elif defined(W2U_TARGET_W1)
#define W2U_REGISTER_TARGETS_CONTINUATION 0x021CA821
#define W2U_CHECK_FAINTED_CONTINUATION 0x021C4F8D
#elif defined(W2U_TARGET_B2)
#define W2U_REGISTER_TARGETS_CONTINUATION 0x021AE339
#define W2U_CHECK_FAINTED_CONTINUATION 0x021A8A2D
#else
#define W2U_REGISTER_TARGETS_CONTINUATION 0x021AE379
#define W2U_CHECK_FAINTED_CONTINUATION 0x021A8A6D
#endif

// A distant THUMB_BRANCH hook replaces eight bytes at a retail function entry
// with push {lr}; bl hook; pop {pc}. Calling the public function symbol from
// the hook would therefore recurse back into the hook. These trampolines replay
// all eight overwritten bytes and continue at entry + 8 with the hook's BL
// return address still in LR.

.global W2U_BattleLog_OriginalRegisterTargets
.thumb_func
.type W2U_BattleLog_OriginalRegisterTargets, %function
W2U_BattleLog_OriginalRegisterTargets:
    // Preserve the live moveParam in r7 before using r3 for the absolute
    // continuation branch.
    push {r4-r7, lr}
    sub sp, #20
    adds r4, r0, #0
    str r2, [sp, #12]
    ldr r0, [r4, #4]
    adds r7, r3, #0
    ldr r3, =W2U_REGISTER_TARGETS_CONTINUATION
    bx r3
.size W2U_BattleLog_OriginalRegisterTargets, . - W2U_BattleLog_OriginalRegisterTargets

.global W2U_BattleLog_OriginalCheckFainted
.thumb_func
.type W2U_BattleLog_OriginalCheckFainted, %function
W2U_BattleLog_OriginalCheckFainted:
    push {r3-r7, lr}
    sub sp, #8
    adds r7, r1, #0
    adds r4, r0, #0
    ldr r2, =W2U_CHECK_FAINTED_CONTINUATION
    bx r2
.size W2U_BattleLog_OriginalCheckFainted, . - W2U_BattleLog_OriginalCheckFainted

.global W2U_BattleLog_OriginalNotifyBattleResult
.thumb_func
.type W2U_BattleLog_OriginalNotifyBattleResult, %function
W2U_BattleLog_OriginalNotifyBattleResult:
    // The retail function is only 12 bytes. Reproduce it in full because its
    // displaced conditional branch cannot be relocated instruction-for-
    // instruction into this trampoline.
    ldr r2, =0x00000444
    ldr r3, [r0, r2]
    cmp r3, #7
    bne 1f
    str r1, [r0, r2]
1:
    bx lr
.size W2U_BattleLog_OriginalNotifyBattleResult, . - W2U_BattleLog_OriginalNotifyBattleResult
