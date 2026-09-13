@ ButtonScript.s

.thumb

@ Button constants
.equ AButton, 1
.equ BButton, 2
.equ SelectButton, 4
.equ StartButton, 8
.equ DPadRight, 16
.equ DPadLeft, 32
.equ DPadUp, 64
.equ DPadDown, 128
.equ RButton, 256
.equ LButton, 512
.equ XButton, 1024

.equ PCScriptID, 0x276A @ 10090

@ FieldEventProvider_Grid_CheckForEvent and FieldEventProvider_NoGrid_CheckForEvent
@ usable: gsys (r5), field (r4)
@ Both final epilogues have the same register contract and stack frame.

.type THUMB_BRANCH_LINK_FieldEventProvider_Grid_CheckForEvent_0x36E, %function
.type THUMB_BRANCH_LINK_FieldEventProvider_NoGrid_CheckForEvent_0x248, %function

@ Shared Porta PC entry for grid, rail, and hybrid maps.
THUMB_BRANCH_LINK_FieldEventProvider_Grid_CheckForEvent_0x36E:
THUMB_BRANCH_LINK_FieldEventProvider_NoGrid_CheckForEvent_0x248:
    @ Keep an event already selected by the native field checks.
    cmp     r0, #0
    bne     return
    @ Preserve eight-byte stack alignment when calling the native key helper.
    push    {r0, r1, r2, r3}
    bl      GCTX_HIDGetPressedKeys 
    ldr     r1, =StartButton
    TST     R1, R0
    pop     {r0, r1, r2, r3}
    beq     return

call_script: 
    @ldr     r0, =debug_string_pressed
    @swi     0xFC

    @ EventScriptCall_Create(GameSystem *gsys, u16 scrId, FieldActor *actor, HeapID heapId)
    MOV     R0, R4
    BL      Field_GetHeapID
    MOV     R3, r0          @ r3 = HeapID
    mov     r0, r5          @ r0 = GameSystem pointer
    ldr     r1, =PCScriptID @ r1 = ScriptID (10090)
    mov     r2, #0          @ r2 = FieldActor = NULL
    bl      EventScriptCall_Create 

return:
    ADD     SP, SP, #0x70
    POP     {R3-R7,PC}

@debug_string_pressed:
@    .ascii "BUTTON PRESSED\0"

    .size THUMB_BRANCH_LINK_FieldEventProvider_Grid_CheckForEvent_0x36E, . - THUMB_BRANCH_LINK_FieldEventProvider_Grid_CheckForEvent_0x36E
    .size THUMB_BRANCH_LINK_FieldEventProvider_NoGrid_CheckForEvent_0x248, . - THUMB_BRANCH_LINK_FieldEventProvider_NoGrid_CheckForEvent_0x248
