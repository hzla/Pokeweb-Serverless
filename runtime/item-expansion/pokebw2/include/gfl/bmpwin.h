#ifndef POKEBW2_GFL_BMPWIN_H
#define POKEBW2_GFL_BMPWIN_H

#include "types.h"
#include "gfl/bg_sys.h"
#include "gfl/bmp.h"
#include "gfl/graphics.h"
#include "gfl/heap.h"
#include "gfl/str.h"
#include "struct_decls.h"

// Windows on a BG that are drawn to as bitmaps (bmp_win.c). A window has a bitmap of its own characters, which
// BmpWin_FlushChar loads to the BG, and an area of the BG's screen buffer that BmpWin_FlushMap points at them. The area
// is the size of the bitmap unless BmpWin_SetHeight2 changes it

// The heap that windows are allocated from
void BmpWin_InitAllocator(HeapID heapId);
void BmpWin_FreeAllocator(void);
// A window of width by height tiles at x and y, whose characters are allocated in the BG's characters, from the end
// if fromEnd, or placed at charPos
BmpWin *BmpWin_CreateDynamic(u8 bg, u8 x, u8 y, u8 width, u8 height, u8 palette, u8 fromEnd);
BmpWin *BmpWin_CreateStatic(u8 bg, u8 x, u8 y, u8 width, u8 height, u8 palette, u32 charPos);
void BmpWin_Free(BmpWin *window);
void BmpWin_FlushChar(BmpWin *window);
void BmpWin_FlushMap(BmpWin *window);
// Draws a frame around the window on the BG's screen buffer, from the 8 characters from frameChar: the top left
// corner, top, top right corner, left, right, bottom left corner, bottom and bottom right corner
void BmpWin_MakeFrameScreen(BmpWin *window, u16 frameChar, u8 palette);
// Clears the window's area of its BG's screen
void BmpWin_ClearScreen(BmpWin *window);
u8 BmpWin_GetBGIndex(BmpWin *window);
// The size of the bitmap, and of the area of the screen, in tiles
u8 BmpWin_GetSizeX(BmpWin *window);
u8 BmpWin_GetSizeY(BmpWin *window);
u8 BmpWin_GetWidth1(BmpWin *window);
u8 BmpWin_GetHeight2(BmpWin *window);
u8 BmpWin_GetPosX(BmpWin *window);
u8 BmpWin_GetPosY(BmpWin *window);
u16 BmpWin_GetCharPos(BmpWin *window);
GFLBitmap *BmpWin_GetBitmap(BmpWin *window);
u8 BmpWin_GetPalette(BmpWin *window);
void BmpWin_SetPosX(BmpWin *window, u8 x);
void BmpWin_SetPosY(BmpWin *window, u8 y);
void BmpWin_SetHeight2(BmpWin *window, u8 height);
void BmpWin_SetPalette(BmpWin *window, u8 palette);

// Copies the window's characters and screen, the screen at the next VBlank
static inline void BmpWin_Transfer(BmpWin *window) {
    BmpWin_FlushChar(window);
    BmpWin_FlushMap(window);
    GFL_BGSysQueueScrLoad(BmpWin_GetBGIndex(window));
}

// BmpWin_Transfer with the screen copied at once
static inline void BmpWin_TransferNow(BmpWin *window) {
    BmpWin_FlushChar(window);
    BmpWin_FlushMap(window);
    GFL_BGSysLoadScr(BmpWin_GetBGIndex(window));
}

// Clears the window's area of the screen, and copies the screen at once
static inline void BmpWin_ClearScreenNow(BmpWin *window) {
    BmpWin_ClearScreen(window);
    GFL_BGSysLoadScr(BmpWin_GetBGIndex(window));
}

#endif // POKEBW2_GFL_BMPWIN_H
