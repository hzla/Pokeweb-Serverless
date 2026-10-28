.syntax unified
.thumb
.text
.global item_type_gate
.thumb_func
item_type_gate:
    push {r4, lr}
    movs r4, r0                  @ Holder's native type pair.
    movs r0, r1                  @ BattleEventItem, passed by the donor callback.
    bl item_sub_id
    ldr r1, item_type_limit
    cmp r0, r1
    bhs no_match
    ldr r1, item_types
    ldrb r1, [r1, r0]
    cmp r1, #255
    beq no_match
    movs r0, r4
    bl type_pair_match
    pop {r4, pc}
no_match:
    movs r0, #0
    pop {r4, pc}
.balign 4
item_type_limit:
    .word 640
item_types:
    .word 0                     @ Relocated to the shared item/type table.
