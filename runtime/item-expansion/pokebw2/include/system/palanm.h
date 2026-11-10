#ifndef POKEBW2_SYSTEM_PALANM_H
#define POKEBW2_SYSTEM_PALANM_H

#include "types.h"
#include "gfl/arc.h"
#include "gfl/heap.h"
#include "gfl/tcb.h"
#include "struct_decls.h"

// ColorFilter_ApplyLUT, ColorFilter_ApplyVintage and the static g_FieldColorPostFXWeightG are swan's names
// (https://github.com/ds-pokemon-hacking/swan, GPL-3.0); the others are ours, the other two weights named after it

// Palette fades (palanm.c): copies of the palettes of each kind of palette memory, unfaded and faded, which a task
// fades toward a color step by step and which PaletteFade_Transfer copies to VRAM

// The buffers, one per kind of palette memory
enum {
    PALFADE_BUFFER_MAIN_BG,
    PALFADE_BUFFER_SUB_BG,
    PALFADE_BUFFER_MAIN_OBJ,
    PALFADE_BUFFER_SUB_OBJ,
    PALFADE_BUFFER_MAIN_BG_EX0,
    PALFADE_BUFFER_MAIN_BG_EX1,
    PALFADE_BUFFER_MAIN_BG_EX2,
    PALFADE_BUFFER_MAIN_BG_EX3,
    PALFADE_BUFFER_SUB_BG_EX0,
    PALFADE_BUFFER_SUB_BG_EX1,
    PALFADE_BUFFER_SUB_BG_EX2,
    PALFADE_BUFFER_SUB_BG_EX3,
    PALFADE_BUFFER_MAIN_OBJ_EX,
    PALFADE_BUFFER_SUB_OBJ_EX,
    PALFADE_BUFFER_COUNT,
};

// The buffers of standard palettes (16 palettes of 16 colors) and of extended ones (16 of 256)
#define PALFADE_BUFFERS_STD 4

// The palette memory PaletteFade_LoadFromVRAM copies
enum {
    PALFADE_VRAM_MAIN_BG,
    PALFADE_VRAM_SUB_BG,
    PALFADE_VRAM_MAIN_OBJ,
    PALFADE_VRAM_SUB_OBJ,
};

// PaletteFade_GetColor's choice of buffer
#define PALFADE_FADED 0
#define PALFADE_UNFADED 1

PaletteFade *PaletteFade_Create(u32 heapId);
void PaletteFade_Free(PaletteFade *fade);
// Allocates a buffer's two copies of size bytes
void PaletteFade_AllocBuffer(PaletteFade *fade, u32 buffer, u32 size, HeapID heapId);
void PaletteFade_FreeBuffer(PaletteFade *fade, u32 buffer);
// Copies size bytes of colors to both copies of a buffer, from the color at offset
void PaletteFade_LoadData(PaletteFade *fade, const void *src, u32 buffer, u16 offset, u16 size);
// Loads a palette file's colors from srcOffset to a buffer at offset, size bytes of them or all for 0
void PaletteFade_LoadNCLREx(PaletteFade *fade, u32 arcId, u32 fileId, HeapID heapId, u32 buffer, u32 size, u16 offset,
                            u16 srcOffset);
void PaletteFade_LoadNCLR(PaletteFade *fade, u32 arcId, u32 fileId, HeapID heapId, u32 buffer, u32 size, u16 offset);
void PaletteFade_LoadArcNCLREx(PaletteFade *fade, ArcTool *arc, u32 fileId, HeapID heapId, u32 buffer, u32 size,
                               u16 offset, u16 srcOffset);
void PaletteFade_LoadArcNCLR(PaletteFade *fade, ArcTool *arc, u32 fileId, HeapID heapId, u32 buffer, u32 size,
                             u16 offset);
// Copies a standard palette memory's colors (PALFADE_VRAM_*) to the buffer of the same number
void PaletteFade_LoadFromVRAM(PaletteFade *fade, u32 vram, u16 offset, u32 size);
u16 *PaletteFade_GetUnfadedBuffer(PaletteFade *fade, u32 buffer);
u16 *PaletteFade_GetFadedBuffer(PaletteFade *fade, u32 buffer);
// Starts fading the buffers in bufferMask that aren't fading, the palettes in paletteMask of each, from step start to
// step end of 16 toward color, applying the first step at once. A delay of 0 or more moves 2 steps every delay + 1
// frames, a negative one -delay + 2 steps (at most 16) every frame. Returns whether a buffer started
u8 PaletteFade_StartFade(PaletteFade *fade, u16 bufferMask, u16 paletteMask, s8 delay, u8 start, u8 end, u16 color,
                         TCBManager *tcbManager);
// PaletteFade_StartFade, restarting the buffers that are fading too
u8 PaletteFade_RestartFade(PaletteFade *fade, u16 bufferMask, u16 paletteMask, s8 delay, u8 start, u8 end, u16 color,
                           TCBManager *tcbManager);
// Stops the fade task at its next step
void PaletteFade_RequestStop(PaletteFade *fade);
// Copies the faded buffers to VRAM, those that changed or all of them
void PaletteFade_Transfer(PaletteFade *fade);
// The buffers still fading
u16 PaletteFade_GetActiveMask(PaletteFade *fade);
// Makes PaletteFade_Transfer copy every buffer
void PaletteFade_SetTransferAll(PaletteFade *fade, u32 transferAll);
void PaletteFade_SetAllActive(PaletteFade *fade, u32 active);
u16 PaletteFade_GetColor(PaletteFade *fade, u32 buffer, u32 which, u16 pos);
// Blends count colors toward color by fraction of 16
void BlendColors(const u16 *src, u16 *dst, u16 count, u8 fraction, u16 color);
// BlendColors from a buffer's unfaded colors into its faded ones
void PaletteFade_BlendBuffer(PaletteFade *fade, u32 buffer, u16 offset, u16 count, u8 fraction, u16 color);
// PaletteFade_BlendBuffer for the 16-color palettes of paletteMask
void PaletteFade_BlendPalettes(PaletteFade *fade, u32 buffer, u16 paletteMask, u8 fraction, u16 color);
// Turns colors to gray and maps the grays through a table
void ColorFilter_ApplyLUT(u16 *colors, int count, const u8 *lut);
// Turns colors to sepia
void ColorFilter_ApplyVintage(u16 *colors, int count);
// Applies a buffer's fade to one 16-color palette
void PaletteFade_ApplyPalette(PaletteFade *fade, u16 palette, u16 buffer);

#endif // POKEBW2_SYSTEM_PALANM_H
