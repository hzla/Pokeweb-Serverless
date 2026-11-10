#ifndef POKEBW2_SYSTEM_BMP_WINFRAME_H
#define POKEBW2_SYSTEM_BMP_WINFRAME_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// Names from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0), except FreeCursorImageEndOfHeap,
// BmpWin_DrawFrameEndOfHeap, BmpWin_ClearFrame and the WINFRAME_TRANSFER_* values

// The system's window frames (bmp_winframe.c, a guessed name): loading a frame's characters and palette from the
// window frame archive, and drawing or clearing a frame around a window on its BG's screen. A frame is 9 characters,
// the top left corner, top, top right corner, left, middle, right, bottom left corner, bottom and bottom right corner,
// of which the middle is not drawn

// When BmpWin_DrawFrame and BmpWin_ClearFrame copy the BG's screen to VRAM
enum {
    WINFRAME_TRANSFER_NOW,
    WINFRAME_TRANSFER_VBLANK,
    WINFRAME_TRANSFER_NONE,
};

// The window frame archive's palette file for a frame type
u32 GetSysMsgBoxPaletteDatID(u8 type);
void LoadSysMsgBoxBGChar(u8 bg, u16 frameChar, u8 type, HeapID heapId);
void LoadSysMsgBoxPalette(u8 bg, u8 framePalette, u8 type, HeapID heapId);
// Loads a frame's characters at frameChar and its palette at framePalette
void LoadSysMsgBox(u8 bg, u16 frameChar, u8 framePalette, u8 type, HeapID heapId);
// Loads a frame's characters at the end of a BG's characters, and its palette. The result is their position in the low
// 16 bits and their size in the high 16, as GFL_BGSysFreeCharMemory takes them
u32 LoadCursorImageEndOfHeap(u8 bg, u8 framePalette, u8 type, HeapID heapId);
#define CHAR_POS(chars) ((chars) & 0xffff)
#define CHAR_SIZE(chars) ((u16)((chars) >> 16))
// Frees the characters LoadCursorImageEndOfHeap loaded
void FreeCursorImageEndOfHeap(u32 bg, u32 chars);
// Draws the frame at frameChar around the window, and copies the screen as transfer says
void BmpWin_DrawFrame(BmpWin *window, u8 transfer, u16 frameChar, u8 framePalette);
// BmpWin_DrawFrame for a frame LoadCursorImageEndOfHeap loaded
void BmpWin_DrawFrameEndOfHeap(BmpWin *window, u8 transfer, u32 chars, u8 framePalette);
// Clears the frame around the window
void BmpWin_ClearFrame(BmpWin *window, u8 transfer);

#endif // POKEBW2_SYSTEM_BMP_WINFRAME_H
