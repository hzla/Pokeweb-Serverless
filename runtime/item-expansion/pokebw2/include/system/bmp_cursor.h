#ifndef POKEBW2_SYSTEM_BMP_CURSOR_H
#define POKEBW2_SYSTEM_BMP_CURSOR_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/printsys.h"

// BmpCursor_Create is swan's name (https://github.com/ds-pokemon-hacking/swan, GPL-3.0); the others are ours

// The cursor menus draw before their selected option (bmp_cursor.c)

BmpCursor *BmpCursor_Create(u32 heapId);
void BmpCursor_Free(BmpCursor *cursor);
// Prints the cursor at x and y into the window
void BmpCursor_Print(BmpCursor *cursor, u16 x, u16 y, PrintWindow *printWindow, PrintQueue *queue, Font *font);
// Makes the cursor the ROM's 8x8 triangle
void BmpCursor_LoadBitmap(BmpCursor *cursor, u32 heapId);

#endif // POKEBW2_SYSTEM_BMP_CURSOR_H
