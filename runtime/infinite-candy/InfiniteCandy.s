.syntax unified
.cpu arm946e-s
.thumb

// Item 622 uses the unused retail Key Items pocket entry. The installer fills
// its item data and text; these hooks handle Key Item party routing and the
// unconditional PokeList removal.
.extern BagSave_SubItem

.section .text
.balign 4

// OpenPokeParty + 0x94 originally compares the item against Reveal Glass.
// Its caller consumes only the comparison flags, so include item 622 there.
.global THUMB_BRANCH_LINK_OpenPokeParty_0x94
.type THUMB_BRANCH_LINK_OpenPokeParty_0x94, %function
.thumb_func
THUMB_BRANCH_LINK_OpenPokeParty_0x94:
    ldr r0, =638                 // ITEM_REVEAL_GLASS
    cmp r7, r0
    beq 1f
    ldr r0, =622
    cmp r7, r0
1:
    bx lr
.size THUMB_BRANCH_LINK_OpenPokeParty_0x94, .-THUMB_BRANCH_LINK_OpenPokeParty_0x94
.ltorg

// Replace PokeList_SubItem. Retail passes the active item in r1 and takes its
// heap ID from the first halfword of PokeList (r0).
.global THUMB_BRANCH_PokeList_SubItem
.type THUMB_BRANCH_PokeList_SubItem, %function
.thumb_func
THUMB_BRANCH_PokeList_SubItem:
    push {r3, lr}
    ldr r2, =622
    cmp r1, r2
    beq 1f
    movs r3, r0
    movs r0, #163
    lsls r0, r0, #2
    ldr r0, [r3, r0]
    ldrh r3, [r3]
    ldr r0, [r0, #4]
    movs r2, #1
    bl BagSave_SubItem
    pop {r3, pc}
1:
    movs r0, #0
    pop {r3, pc}
.size THUMB_BRANCH_PokeList_SubItem, .-THUMB_BRANCH_PokeList_SubItem
.ltorg
