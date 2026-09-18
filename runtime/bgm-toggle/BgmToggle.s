.syntax unified
.cpu arm946e-s
.thumb

// One runtime owns all BGM interception. A toggle-only installation leaves
// the streamed-BGM flag clear; Pokeweb patches the config for a replacement.
.extern GFL_SndUpdate
.extern GFL_SndBGMGetID
.extern GFL_SndBGMPlayCore
.extern GFL_SndBGMSetVolume
.extern GFL_SndGetHeap
.extern GCTX_HIDGetHeldKeys
.extern NNS_SndPlayerSetPaused
.extern NNS_SndPlayerMoveVolume
.extern NNS_SndPlayerSetTrackVolume
.extern NNS_SndArcStrmInit
.extern NNS_SndArcStrmStart
.extern NNS_SndArcStrmStop
.extern NNS_SndArcStrmGetCurrentPlayingPos
.extern PokewebStreamSetupActive
.extern PokewebAllocStreamBuffer
.extern PokewebFindBgmStream

.equ .Ltoggle_combo, 0x304 // L | R | Select
.equ .Lflag_toggle, 1
.equ .Lflag_stream, 2

.section .text
.balign 4

// Site-specific adapter, not a replacement for NNS_SndHeapAlloc globally.
// SetupPlayer keeps its selected size in r6 after this call. Return the actual
// allocation size there as well as forwarding the original fifth argument.
.global THUMB_BRANCH_LINK_NNS_SndArcStrmSetupPlayer_0x50
.type THUMB_BRANCH_LINK_NNS_SndArcStrmSetupPlayer_0x50, %function
.thumb_func
THUMB_BRANCH_LINK_NNS_SndArcStrmSetupPlayer_0x50:
    push {r4, lr}
    sub sp, #16
    ldr r4, [sp, #24]
    str r4, [sp]
    add r4, sp, #8
    str r1, [r4]
    str r4, [sp, #4]
    bl PokewebAllocStreamBuffer
    ldr r6, [sp, #8]
    add sp, #16
    pop {r4, pc}
.size THUMB_BRANCH_LINK_NNS_SndArcStrmSetupPlayer_0x50, .-THUMB_BRANCH_LINK_NNS_SndArcStrmSetupPlayer_0x50
.ltorg

// Write the effective volume into the active native stream player. Streaming,
// buffering, and alarms remain entirely owned by the retail sound engine.
.type .Lapply_stream_volume, %function
.thumb_func
.Lapply_stream_volume:
    push {r4, lr}
    ldr r4, =.Lstream_handle
    ldr r4, [r4]
    cmp r4, #0
    beq .Lapply_stream_done
    ldr r0, =.Lmusic_disabled
    ldr r0, [r0]
    cmp r0, #0
    bne .Lapply_stream_muted
    ldr r0, =.Lrequested_volume
    ldr r1, [r0]
    b .Lapply_stream_store
.Lapply_stream_muted:
    movs r1, #0
.Lapply_stream_store:
    ldr r0, =0x160
    str r1, [r4, r0]
.Lapply_stream_done:
    pop {r4, pc}

.type .Lapply_bgm_mute, %function
.thumb_func
.Lapply_bgm_mute:
    push {r3, lr}
    ldr r0, =.Lapplying_mute
    movs r1, #1
    str r1, [r0]
    ldr r0, =.Lmusic_disabled
    ldr r0, [r0]
    cmp r0, #0
    bne .Lapply_bgm_zero
    ldr r0, =.Lrequested_volume
    ldr r1, [r0]
    b .Lapply_bgm_call
.Lapply_bgm_zero:
    movs r1, #0
.Lapply_bgm_call:
    ldr r0, =0xffff
    bl GFL_SndBGMSetVolume
    ldr r0, =.Lapplying_mute
    movs r1, #0
    str r1, [r0]
    bl .Lapply_stream_volume
    pop {r3, pc}

.type .Lstop_replacement, %function
.thumb_func
.Lstop_replacement:
    push {r3, lr}
    ldr r0, =.Lstream_active
    ldr r1, [r0]
    cmp r1, #0
    beq .Lstop_done
    ldr r0, =.Lstream_handle
    movs r1, #0
    bl NNS_SndArcStrmStop
    ldr r0, =.Lstream_active
    movs r1, #0
    str r1, [r0]
    ldr r0, =.Lstream_paused
    str r1, [r0]
    ldr r0, =.Lstream_fading
    str r1, [r0]
.Lstop_done:
    pop {r3, pc}

// r0 = new sequence. Always stop the previous mapping before selecting the
// next one, including mapped-to-mapped changes and same-ID explicit restarts.
.type .Lselect_replacement, %function
.thumb_func
.Lselect_replacement:
    push {r4, lr}
    movs r4, r0
    bl .Lstop_replacement
    ldr r0, =.Lselected_sequence
    str r4, [r0]
    movs r1, r4
    ldr r0, =PokewebBgmConfig
    bl PokewebFindBgmStream
    ldr r1, =.Lselected_stream
    str r0, [r1]
    pop {r4, pc}

.type .Lstart_replacement, %function
.thumb_func
.Lstart_replacement:
    push {r4, lr}
    ldr r4, =PokewebBgmConfig
    ldrh r0, [r4, #6]
    movs r1, #.Lflag_stream
    tst r0, r1
    beq .Lstart_done
    ldr r4, =.Lselected_stream
    ldr r4, [r4]
    ldr r0, =0xffff
    cmp r4, r0
    beq .Lstart_done
    // Title owns and frees its GFL stream wrapper. Gameplay (and Quick
    // Launch) cannot borrow that pointer. Use a separate four-byte native
    // handle; all buffers still come from the game's current sound heap.
    // Its hierarchy rollback disposes those buffers when this BGM unloads.
    bl GFL_SndGetHeap
    movs r1, r0
    ldr r2, =PokewebStreamSetupActive
    movs r0, #1
    str r0, [r2]
    movs r0, #15
    bl NNS_SndArcStrmInit
    ldr r2, =PokewebStreamSetupActive
    movs r0, #0
    str r0, [r2]
    ldr r0, =.Lstream_handle
    movs r1, r4
    movs r2, #0
    bl NNS_SndArcStrmStart
    cmp r0, #0
    beq .Lstart_failed
    ldr r0, =.Lstream_active
    movs r1, #1
    str r1, [r0]
    ldr r0, =.Lstream_paused
    movs r1, #0
    str r1, [r0]
    ldr r0, =.Lstream_fading
    str r1, [r0]
    bl .Lapply_stream_volume
.Lstart_done:
    pop {r4, pc}
.Lstart_failed:
    // Do not allocate/retry every frame if native preparation fails.
    ldr r0, =.Lstream_active
    movs r1, #2
    str r1, [r0]
    b .Lstart_done

.global THUMB_BRANCH_LINK_GameUpdate_0xE
.type THUMB_BRANCH_LINK_GameUpdate_0xE, %function
.thumb_func
THUMB_BRANCH_LINK_GameUpdate_0xE:
    push {r3, r4, r5, lr}
    bl GFL_SndUpdate
    ldr r4, =PokewebBgmConfig
    ldrh r5, [r4, #6]
    movs r0, #.Lflag_toggle
    tst r5, r0
    beq .Lupdate_stream
    bl GCTX_HIDGetHeldKeys
    ldr r1, =.Ltoggle_combo
    ands r0, r1
    cmp r0, r1
    bne .Lrelease_combo
    ldr r1, =.Lcombo_latched
    ldr r0, [r1]
    cmp r0, #0
    bne .Lupdate_stream
    movs r0, #1
    str r0, [r1]
    ldr r1, =.Lmusic_disabled
    ldr r0, [r1]
    movs r2, #1
    eors r0, r2
    str r0, [r1]
    bl .Lapply_bgm_mute
    b .Lupdate_stream
.Lrelease_combo:
    ldr r1, =.Lcombo_latched
    movs r0, #0
    str r0, [r1]
.Lupdate_stream:
    movs r0, #.Lflag_stream
    tst r5, r0
    beq .Lupdate_done
    // The verified getter returns zero for an inactive hierarchy slot,
    // including early boot. Polling also catches native fade/push/pop paths
    // that do not pass through the public play wrapper.
    bl GFL_SndBGMGetID
    ldr r1, =.Lselected_sequence
    ldr r1, [r1]
    cmp r0, r1
    beq .Lupdate_selected
    bl .Lselect_replacement
.Lupdate_selected:
    ldr r0, =.Lselected_stream
    ldr r0, [r0]
    ldr r1, =0xffff
    cmp r0, r1
    beq .Lupdate_done
    ldr r0, =.Lstream_active
    ldr r0, [r0]
    cmp r0, #2
    beq .Lupdate_done
    ldr r0, =.Lstream_paused
    ldr r0, [r0]
    cmp r0, #0
    bne .Lupdate_done
    ldr r0, =.Lstream_fading
    ldr r0, [r0]
    cmp r0, #0
    bne .Lupdate_done
    // A valid handle includes asynchronous preparation at position zero;
    // using elapsed milliseconds here continually restarts a new stream.
    ldr r0, =.Lstream_handle
    ldr r0, [r0]
    cmp r0, #0
    bne .Lupdate_done
    bl .Lstart_replacement
.Lupdate_done:
    pop {r3, r4, r5, pc}
.size THUMB_BRANCH_LINK_GameUpdate_0xE, .-THUMB_BRANCH_LINK_GameUpdate_0xE

.global THUMB_BRANCH_LINK_GFL_SndBGMPlay_0xE
.type THUMB_BRANCH_LINK_GFL_SndBGMPlay_0xE, %function
.thumb_func
THUMB_BRANCH_LINK_GFL_SndBGMPlay_0xE:
    push {r3, r4, r5, lr}
    movs r4, r0
    bl GFL_SndBGMPlayCore
    movs r5, r0
    cmp r5, #0
    beq .Lplay_done
    ldr r0, =PokewebBgmConfig
    ldrh r1, [r0, #6]
    movs r2, #.Lflag_stream
    tst r1, r2
    beq .Lplay_done
    movs r0, r4
    bl .Lselect_replacement
    bl .Lstart_replacement
.Lplay_done:
    movs r0, r5
    pop {r3, r4, r5, pc}
.size THUMB_BRANCH_LINK_GFL_SndBGMPlay_0xE, .-THUMB_BRANCH_LINK_GFL_SndBGMPlay_0xE
.ltorg

// Genuine game pause requests save and restore the stream position. The user
// shortcut never reaches this path because it is a volume mute.
.global THUMB_BRANCH_LINK_GFL_SndBGMSetPaused_0xE
.type THUMB_BRANCH_LINK_GFL_SndBGMSetPaused_0xE, %function
.thumb_func
THUMB_BRANCH_LINK_GFL_SndBGMSetPaused_0xE:
    push {r3, r4, r5, lr}
    movs r4, r1
    bl NNS_SndPlayerSetPaused
    ldr r0, =.Lstream_active
    ldr r0, [r0]
    cmp r0, #0
    beq .Lpause_done
    cmp r4, #0
    beq .Lresume_stream
    ldr r0, =.Lstream_paused
    ldr r1, [r0]
    cmp r1, #0
    bne .Lpause_done
    ldr r5, =.Lstream_handle
    movs r0, r5
    bl NNS_SndArcStrmGetCurrentPlayingPos
    // The native API reports the read head, not the DAC cursor. Remove the
    // extra prefetch introduced by the enlarged stereo PCM16 output buffer,
    // keeping resume near the previous small-buffer behavior. This remains
    // block-granular, not sample-accurate (also true of the original API).
    ldr r1, [r5]
    cmp r1, #0
    beq .Lsave_resume_position
    ldr r2, =0x138
    ldr r1, [r1, r2]
    ldr r2, =0x1000
    cmp r1, r2
    bls .Lsave_resume_position
    subs r1, r1, r2
    movs r2, #250
    muls r1, r2
    // Rounded up: extraBytes * 1000 / (32768 * 4), within 1 ms at 32728 Hz.
    ldr r2, =0x7fff
    adds r1, r1, r2
    lsrs r1, r1, #15
    cmp r0, r1
    blo .Lresume_position_zero
    subs r0, r0, r1
    b .Lsave_resume_position
.Lresume_position_zero:
    movs r0, #0
.Lsave_resume_position:
    ldr r1, =.Lresume_position
    str r0, [r1]
    movs r0, r5
    movs r1, #0
    bl NNS_SndArcStrmStop
    ldr r0, =.Lstream_paused
    movs r1, #1
    str r1, [r0]
    b .Lpause_done
.Lresume_stream:
    ldr r0, =.Lstream_paused
    ldr r1, [r0]
    cmp r1, #0
    beq .Lpause_done
    ldr r5, =.Lstream_handle
    movs r0, r5
    ldr r1, =.Lselected_stream
    ldr r1, [r1]
    ldr r2, =.Lresume_position
    ldr r2, [r2]
    bl NNS_SndArcStrmStart
    ldr r0, =.Lstream_paused
    movs r1, #0
    str r1, [r0]
    bl .Lapply_stream_volume
.Lpause_done:
    pop {r3, r4, r5, pc}
.size THUMB_BRANCH_LINK_GFL_SndBGMSetPaused_0xE, .-THUMB_BRANCH_LINK_GFL_SndBGMSetPaused_0xE

.global THUMB_BRANCH_LINK_GFL_SndBGMFadeOut_0x10
.type THUMB_BRANCH_LINK_GFL_SndBGMFadeOut_0x10, %function
.thumb_func
THUMB_BRANCH_LINK_GFL_SndBGMFadeOut_0x10:
    push {r4, lr}
    movs r4, r2
    bl NNS_SndPlayerMoveVolume
    ldr r0, =.Lstream_active
    ldr r0, [r0]
    cmp r0, #0
    beq .Lfade_done
    ldr r0, =.Lstream_handle
    movs r1, r4
    bl NNS_SndArcStrmStop
    ldr r0, =.Lstream_fading
    movs r1, #1
    str r1, [r0]
.Lfade_done:
    pop {r4, pc}
.size THUMB_BRANCH_LINK_GFL_SndBGMFadeOut_0x10, .-THUMB_BRANCH_LINK_GFL_SndBGMFadeOut_0x10

.global THUMB_BRANCH_LINK_GFL_SndBGMSetVolume_0xE
.type THUMB_BRANCH_LINK_GFL_SndBGMSetVolume_0xE, %function
.thumb_func
THUMB_BRANCH_LINK_GFL_SndBGMSetVolume_0xE:
    push {r4, r5, r6, lr}
    movs r4, r0
    movs r5, r1
    movs r6, r2
    ldr r0, =.Lapplying_mute
    ldr r0, [r0]
    cmp r0, #0
    bne .Lvolume_effective
    // Native arguments are handle, track mask, volume -- not handle,
    // volume, frames. A mixed stream can mirror only all-track changes.
    ldr r0, =0xffff
    cmp r5, r0
    bne .Lvolume_effective
    ldr r0, =.Lrequested_volume
    str r6, [r0]
.Lvolume_effective:
    ldr r0, =.Lmusic_disabled
    ldr r0, [r0]
    cmp r0, #0
    beq .Lvolume_call
    movs r6, #0
.Lvolume_call:
    movs r0, r4
    movs r1, r5
    movs r2, r6
    bl NNS_SndPlayerSetTrackVolume
    bl .Lapply_stream_volume
    pop {r4, r5, r6, pc}
.size THUMB_BRANCH_LINK_GFL_SndBGMSetVolume_0xE, .-THUMB_BRANCH_LINK_GFL_SndBGMSetVolume_0xE

.section .data
.balign 4
.global PokewebBgmConfig
.type PokewebBgmConfig, %object
PokewebBgmConfig:
    .word 0x53424750 // "PGBS" bytes
    .hword 2        // ABI version
    .hword 1        // flags: shortcut enabled, stream disabled
    .word 32        // mapping table offset relative to this header
    .hword 0        // mapping count
    .hword 10       // entry size (five u16 IDs)
    .hword 0        // reserved
    .hword 32       // structure size
    .word 0x32474250 // integrity marker "PBG2"
    .word 0x811c9dc5 // FNV-1a of the empty mapping table
    .word 0        // reserved
.size PokewebBgmConfig, .-PokewebBgmConfig
.Lrequested_volume: .word 127
.Lselected_sequence: .word 0xffff
.Lselected_stream: .word 0xffff

.section .bss
.balign 4
.Lmusic_disabled: .space 4
.Lcombo_latched: .space 4
.Lstream_active: .space 4
.Lstream_paused: .space 4
.Lstream_fading: .space 4
.Lresume_position: .space 4
.Lapplying_mute: .space 4
.Lstream_handle: .space 4
