#ifndef POKEBW2_SYSTEM_BLINK_PALANM_H
#define POKEBW2_SYSTEM_BLINK_PALANM_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// A palette animation for cursors: it fades part of a palette back and forth between two sets of colors, or blinks
// between them a few times when a choice is made. Our names

// The palette to animate, a BG frame from 0 to 7 or the main or sub engine's OBJ palette
#define BLINK_PALANM_OBJ_MAIN 0xfffe
#define BLINK_PALANM_OBJ_SUB 0xffff

// Animates count colors from offset in the palette
BlinkPalAnm *BlinkPalAnm_Create(u16 offset, u16 count, u16 palette, HeapID heapId);
// Loads the two sets of colors from offsets startPos and endPos of a palette file
void BlinkPalAnm_SetPalBufferArc(BlinkPalAnm *anm, u32 arcId, u32 fileId, u32 startPos, u32 endPos);
void BlinkPalAnm_SetPalBufferArcTool(BlinkPalAnm *anm, ArcTool *arc, u32 fileId, u32 startPos, u32 endPos);
void BlinkPalAnm_Free(BlinkPalAnm *anm);
// Steps the animation and queues the colors for the next V-blank
void BlinkPalAnm_Main(BlinkPalAnm *anm);
// Restarts the fade from the start colors, or from a point of its cycle (0x10000 for a full cycle)
void BlinkPalAnm_InitAnime(BlinkPalAnm *anm);
void BlinkPalAnm_SetAnimeCount(BlinkPalAnm *anm, u16 count);
// Starts blinking, and whether the blinking is over
void BlinkPalAnm_StartBlink(BlinkPalAnm *anm);
BOOL BlinkPalAnm_IsBlinkEnd(BlinkPalAnm *anm);

#endif // POKEBW2_SYSTEM_BLINK_PALANM_H
