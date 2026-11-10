#ifndef POKEBW2_BATTLE_BTLV_FINGER_CURSOR_H
#define POKEBW2_BATTLE_BTLV_FINGER_CURSOR_H

// Overlay 168's btlv_finger_cursor.c (named by its string), the pointing finger that the catching demonstration and
// the battle bag show tapping the touch screen. BtlvFingerCursor_Create is swan's name; the other names are ours

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Loads the finger's graphics, its palette into row paletteRow of the sub screen's OBJ palettes
BtlvFingerCursor *BtlvFingerCursor_Create(PaletteFade *fade, u32 paletteRow, HeapID heapId);
void BtlvFingerCursor_Delete(BtlvFingerCursor *cursor);
// Shows the finger at x, y; after wait frames it taps, reaching the touch screen on frame tapFrame of the tap, and
// hides hideWait frames later. Returns FALSE while a tap is still showing
BOOL BtlvFingerCursor_Start(BtlvFingerCursor *cursor, s32 x, s32 y, u32 wait, s32 tapFrame, u32 hideWait);
void BtlvFingerCursor_RemoveActor(BtlvFingerCursor *cursor);
// Whether the finger has touched the screen and is still showing
BOOL BtlvFingerCursor_IsTouched(BtlvFingerCursor *cursor);

#endif // POKEBW2_BATTLE_BTLV_FINGER_CURSOR_H
