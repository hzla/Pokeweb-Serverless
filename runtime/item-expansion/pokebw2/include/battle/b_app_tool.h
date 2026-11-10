#ifndef POKEBW2_BATTLE_B_APP_TOOL_H
#define POKEBW2_BATTLE_B_APP_TOOL_H

#include "types.h"
#include "gfl/clact.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/cursor_move.h"
#include "system/printsys.h"

// Tools shared by the battle's menus (b_app_tool.c, overlay 285), which overlays 286 and 287 call: a cursor of four
// corner actors that frames a CursorMove position, and the flushing of PrintWindows. The type names are ours

typedef struct {
    // Top left, bottom left, top right and bottom right
    ClActor *corners[4];
    u16 heapId;
    BOOL visible;
} BAppCursor;

BAppCursor *BAppCursor_Create(HeapID heapId);
void BAppCursor_Delete(BAppCursor *cursor);
// The corners use the animation sequences 0 to 3 of the resources
void BAppCursor_CreateActors(BAppCursor *cursor, ClActUnit *unit, u32 chars, u32 palette, u32 cellAnims);
void BAppCursor_DeleteActors(BAppCursor *cursor);
void BAppCursor_SetVisible(BAppCursor *cursor, BOOL visible);
// Puts the corners around the position, x and y being its center
void BAppCursor_SetPos(BAppCursor *cursor, const CursorMoveData *pos);
// Copies a window's screen at the next VBlank
void BAppTool_QueueWindowScreen(PrintWindow *printWindow);
// BAppTool_QueueWindowScreen on the windows of a list of indices that ends with 0xff
void BAppTool_QueueWindowScreens(PrintWindow *printWindows, const u8 *list);
// Runs the print queue and flushes the count windows that it has printed
void BAppTool_FlushPrintWindows(PrintWindow *printWindows, PrintQueue *queue, u32 count);

#endif // POKEBW2_BATTLE_B_APP_TOOL_H
