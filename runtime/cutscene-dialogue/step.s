.syntax unified
.cpu arm946e-s
.thumb
.section .text
.global dialogue_step_bridge
.thumb_func
dialogue_step_bridge:
    push {r2, r3, r6, lr}
    movs r0, r6
    movs r1, r5
    bl dialogue_scene_step
    cmp r1, #0
    beq 1f
    movs r4, r7
    b 2f
1:  adds r4, #1
2:  pop {r2, r3, r6, pc}
