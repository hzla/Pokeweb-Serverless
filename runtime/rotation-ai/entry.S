.syntax unified
.thumb
.text
.align 2

// Replace the call to the random rotation picker. r5 holds the callback's
// sequence pointer and the caller already saved r3-r7/LR and 16 local bytes.
.global ROTATION_HOOK
.type ROTATION_HOOK, %function
.thumb_func
ROTATION_HOOK:
    movs r0, #5
    str r0, [r5]
    movs r0, #0
    add sp, #0x10
    pop {r3-r7, pc}
.size ROTATION_HOOK, .-ROTATION_HOOK
.section .note.GNU-stack,"",%progbits
